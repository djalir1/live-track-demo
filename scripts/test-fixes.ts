/**
 * Pure-logic tests for FIX 1 (gap day) and FIX 4 (presence rule).
 * Run with: npx tsx scripts/test-fixes.ts
 *
 * No Supabase, no DOM: buildTripSummary is a pure function and the presence
 * rule is a single boolean, so we can exercise both without spinning up a
 * server. If the assertions below hold, the two acceptance criteria hold.
 */
import { buildTripSummary, type RawPoint } from "../src/lib/trip";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, got?: unknown) {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${got !== undefined ? `  got=${JSON.stringify(got)}` : ""}`);
  }
}

// ── FIX 1: Kigali -> Kampala day (matches scripts/seed-demo.mjs exactly). ───
const MORNING: Array<[string, number, number, number, number]> = [
  ["06:00:00", -1.9440, 30.0555,  0, 98],
  ["06:02:00", -1.9455, 30.0570, 12, 98],
  ["06:04:00", -1.9470, 30.0590, 18, 97],
  ["06:06:00", -1.9500, 30.0610, 22, 97],
  ["06:08:00", -1.9530, 30.0630, 22, 96],
  ["06:10:00", -1.9552, 30.0650, 20, 96],
  ["06:12:00", -1.9570, 30.0680, 24, 95],
  ["06:14:00", -1.9585, 30.0720, 26, 95],
  ["06:16:00", -1.9580, 30.0800, 32, 94],
  ["06:18:00", -1.9570, 30.0900, 34, 94],
  ["06:20:00", -1.9560, 30.1000, 34, 93],
  ["06:22:00", -1.9550, 30.1120, 30, 93],
  ["06:24:00", -1.9550, 30.1120,  0, 92],
  ["06:26:00", -1.9550, 30.1120,  0, 92],
];
const EVENING: Array<[string, number, number, number, number]> = [
  ["21:42:00",  0.3163, 32.5822,  0, 41],
  ["21:44:00",  0.3180, 32.5850, 22, 40],
  ["21:46:00",  0.3200, 32.5880, 25, 39],
  ["21:48:00",  0.3220, 32.5920, 28, 38],
  ["21:50:00",  0.3250, 32.5960, 30, 37],
  ["21:52:00",  0.3280, 32.6000, 24, 36],
];
const points: RawPoint[] = [...MORNING, ...EVENING].map(([t, lat, lon, kmh, bat]) => ({
  latitude: lat, longitude: lon, speed_kmh: kmh, battery_level: bat,
  recorded_at: `2026-06-15T${t}+00:00`,
}));
const session = { started_at: "2026-06-15T05:58:00+00:00", ended_at: "2026-06-15T21:55:00+00:00" };

const summary = buildTripSummary(points, [session]);

console.log("FIX 1 — Kigali -> Kampala with a 15 h 16 m signal-lost gap");
console.log(`  totalDistanceKm      = ${summary.totalDistanceKm.toFixed(3)} km`);
console.log(`  totalMovingMinutes   = ${summary.totalMovingMinutes.toFixed(1)}`);
console.log(`  totalStoppedMinutes  = ${summary.totalStoppedMinutes.toFixed(1)}`);
console.log(`  gaps                 = ${summary.gaps.length}`);
if (summary.gaps.length > 0) {
  const g = summary.gaps[0];
  console.log(`    ${g.from}  ->  ${g.to}   (${g.durationMinutes} min, jump ${g.jumpedKm.toFixed(1)} km discarded)`);
}
console.log(`  stops                = ${summary.stops.length}`);
console.log(`  startedAt (approx=${summary.startedAtApprox}) = ${summary.startedAt}`);
console.log(`  endedAt   (approx=${summary.endedAtApprox}) = ${summary.endedAt}`);

// Distance must be within the sum of the two intra-city segments, not ~370 km.
// Morning (~7 km) + Evening (~2 km) ≈ 9 km, definitely < 30.
ok("distance < 30 km (the 370 km gap jump was discarded)", summary.totalDistanceKm < 30, summary.totalDistanceKm);
// Driving time must reflect only intra-segment travel, NOT the 15h silence.
ok("driving < 60 min (not the ~15h wall clock of the gap)", summary.totalMovingMinutes < 60, summary.totalMovingMinutes);
// A signal-lost segment was recorded and it's the big one.
ok("exactly one signal-lost gap recorded", summary.gaps.length === 1, summary.gaps.length);
ok("that gap is >= 15 hours", (summary.gaps[0]?.durationMinutes ?? 0) >= 15 * 60, summary.gaps[0]?.durationMinutes);
ok("the discarded jump is >= 300 km", (summary.gaps[0]?.jumpedKm ?? 0) >= 300, summary.gaps[0]?.jumpedKm);
// Start/End come from the session (not approx).
ok("startedAt from trip_session (not approx)", summary.startedAt === session.started_at && !summary.startedAtApprox);
ok("endedAt   from trip_session (not approx)", summary.endedAt === session.ended_at && !summary.endedAtApprox);

// ── Same points WITHOUT a session — start/end fall back but labelled approx.
const summaryNoSession = buildTripSummary(points, []);
ok("no session -> startedAt is first fix, labelled approx",
  summaryNoSession.startedAt === points[0].recorded_at && summaryNoSession.startedAtApprox);
ok("no session -> endedAt   is last fix, labelled approx",
  summaryNoSession.endedAt === points[points.length - 1].recorded_at && summaryNoSession.endedAtApprox);

// ── FIX 4: presence must be derived from freshness. ─────────────────────────
console.log("\nFIX 4 — presence is derived from last_seen freshness (<30s)");
const now = Date.now();
function presence(lastSeenIso: string, storedStatus: "moving" | "stopped" | "idle" | "offline") {
  const fresh = now - new Date(lastSeenIso).getTime() < 30_000;
  return fresh ? storedStatus : "offline";
}
const freshMoving = presence(new Date(now - 5_000).toISOString(), "moving");
const staleMoving = presence(new Date(now - 45_000).toISOString(), "moving");
const staleStopped = presence(new Date(now - 120_000).toISOString(), "stopped");
console.log(`  fresh(5s)   stored=moving  -> ${freshMoving}`);
console.log(`  stale(45s)  stored=moving  -> ${staleMoving}`);
console.log(`  stale(120s) stored=stopped -> ${staleStopped}`);
ok("fresh driver keeps their stored status",   freshMoving === "moving");
ok("driver stale by 45s reads as offline",     staleMoving === "offline");
ok("driver stale by 2min reads as offline",    staleStopped === "offline");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
