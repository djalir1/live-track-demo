/**
 * Pure-logic test for the parent /me banner. Exercises derivePresence
 * across all the states the spec calls out. Run with:
 *   npx tsx scripts/test-parent-presence.ts
 */
import { derivePresence, type DeviceStatusLite } from "../src/lib/parent-presence";

let passed = 0, failed = 0;
function ok(name: string, cond: boolean, got?: unknown) {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else      { failed++; console.log(`  FAIL  ${name}${got !== undefined ? `  got=${JSON.stringify(got)}` : ""}`); }
}
const now = Date.parse("2026-08-19T21:00:00Z");
const iso = (dtSec: number) => new Date(now - dtSec * 1000).toISOString();
const row = (o: Partial<DeviceStatusLite>): DeviceStatusLite => ({
  status: "moving", latitude: -1.95, longitude: 30.06, speed_kmh: 30,
  last_seen: iso(1), is_tracking: true, ...o,
});

console.log("derivePresence — banner state matrix");

// No open trip session → no-trip, regardless of device status
ok("no session → no-trip", derivePresence(row({}), false, now).kind === "no-trip");
ok("no session + no ds → no-trip", derivePresence(null, false, now).kind === "no-trip");

// Open session but no ds row → offline with null lastSeen
{
  const s = derivePresence(null, true, now);
  ok("session + no ds → offline (null lastSeen)", s.kind === "offline" && s.kind === "offline" && (s as any).lastSeenIso === null);
}

// Fresh (<30s) + speed>0.8 → moving
ok("fresh 5s, speed 42 → moving", derivePresence(row({ last_seen: iso(5), speed_kmh: 42 }), true, now).kind === "moving");

// Fresh (<30s) + speed 0 → stopped
ok("fresh 5s, speed 0 → stopped", derivePresence(row({ last_seen: iso(5), speed_kmh: 0, status: "stopped" }), true, now).kind === "stopped");

// Boundary: 30s exactly → NOT fresh; falls through to the middle branch
{
  const r = row({ last_seen: iso(30), status: "moving", speed_kmh: 42 });
  ok("30s (stored moving+speed) → moving (middle branch)", derivePresence(r, true, now).kind === "moving");
}

// 60s stale + moving stored + speed 42 → still moving (middle branch keeps recent moving)
ok("60s stale, stored=moving,speed=42 → moving",
  derivePresence(row({ last_seen: iso(60), status: "moving", speed_kmh: 42 }), true, now).kind === "moving");

// 60s stale + idle stored → offline (never a frozen "live")
ok("60s stale, stored=idle → offline",
  derivePresence(row({ last_seen: iso(60), status: "idle", speed_kmh: 0 }), true, now).kind === "offline");

// 60s stale + moving stored but speed 0 → offline (guards against frozen live)
ok("60s stale, stored=moving but speed 0 → offline",
  derivePresence(row({ last_seen: iso(60), status: "moving", speed_kmh: 0 }), true, now).kind === "offline");

// > 90s stale → offline with lastSeen
{
  const s = derivePresence(row({ last_seen: iso(180) }), true, now);
  ok("180s stale → offline (with lastSeen)", s.kind === "offline" && (s as any).lastSeenIso != null);
}

// Just at freshness edge (29s) treated as fresh
ok("29s stale → moving (fresh branch)",
  derivePresence(row({ last_seen: iso(29), speed_kmh: 42 }), true, now).kind === "moving");

// Speed under threshold in fresh branch → stopped, not moving
ok("fresh, speed 0.5 → stopped",
  derivePresence(row({ last_seen: iso(3), speed_kmh: 0.5 }), true, now).kind === "stopped");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
