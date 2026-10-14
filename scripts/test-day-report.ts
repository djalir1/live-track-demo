/**
 * Pure-logic tests for src/lib/day-report.ts.
 * Run with: npx tsx scripts/test-day-report.ts
 */
import { buildDayReport, type RawPoint } from "../src/lib/day-report";

let failed = 0;
function ok(name: string, cond: boolean, got?: unknown) {
  console.log(
    `  ${cond ? "PASS" : "FAIL"}  ${name}${cond || got === undefined ? "" : `  got=${JSON.stringify(got)}`}`,
  );
  if (!cond) failed++;
}
const DAY = {
  from: "2026-10-14T00:00:00Z",
  to: "2026-10-15T00:00:00Z",
  now: Date.parse("2026-10-15T00:00:00Z"),
};
const at = (h: number, m: number, s = 0) => new Date(Date.UTC(2026, 9, 14, h, m, s)).toISOString();
const pt = (iso: string, lat: number, lon: number, kmh = 0): RawPoint => ({
  latitude: lat,
  longitude: lon,
  speed_kmh: kmh,
  battery_level: 100,
  recorded_at: iso,
});

// 1. Parked all day, tracker reporting every 5 min with ±5 m jitter: no trips, no "signal lost".
{
  const pts: RawPoint[] = [];
  for (let m = 0; m < 24 * 60; m += 5)
    pts.push(pt(at(Math.floor(m / 60), m % 60), -1.9061 + (m % 3) * 3e-5, 30.1314));
  const r = buildDayReport(pts, [], DAY);
  console.log("Parked all day");
  ok("no trips", r.trips.length === 0, r.trips.length);
  ok("no signal gaps", r.totals.gaps === 0, r.totals.gaps);
  ok(
    "one parked period ≈ 24 h",
    r.parked.length === 1 && r.parked[0].ms > 23 * 3_600_000,
    r.parked,
  );
}

// 2. A → B → A in one session, fixes every 10 s, ~20 km/h east then back: distance both ways.
{
  const pts: RawPoint[] = [];
  let s = 0;
  const add = (lon: number, kmh: number) => {
    pts.push(pt(at(8, 0, s), -1.95, lon, kmh));
    s += 10;
  };
  for (let i = 0; i <= 60; i++) add(30.06 + i * 0.0005, 20); // ~3.3 km east
  for (let i = 0; i < 12; i++) add(30.09, 0); // 2 min stop at B
  for (let i = 60; i >= 0; i--) add(30.06 + i * 0.0005, 20); // back
  const r = buildDayReport(pts, [{ started_at: at(7, 59), ended_at: at(8, 30) }], DAY);
  console.log("A → B → A");
  ok("one trip", r.trips.length === 1, r.trips.length);
  ok(
    "distance ≈ 6.7 km both ways",
    Math.abs(r.totals.distanceKm - 6.68) < 0.2,
    r.totals.distanceKm,
  );
  ok(
    "one stop at B (~2 min)",
    r.trips[0].stops.length === 1 && r.trips[0].stops[0].ms >= 100_000,
    r.trips[0].stops,
  );
  ok("no signal gaps", r.totals.gaps === 0);
}

// 3. Sessions 9 s apart (ignition flicker) are one trip.
{
  const r = buildDayReport(
    [pt(at(9, 12), -1.9, 30.1)],
    [
      { started_at: at(9, 11, 34), ended_at: at(9, 13, 50) },
      { started_at: at(9, 13, 59), ended_at: at(9, 41, 48) },
    ],
    DAY,
  );
  console.log("Ignition flicker");
  ok(
    "merged into one trip",
    r.trips.length === 1 && r.trips[0].endedAt === at(9, 41, 48),
    r.trips.length,
  );
}

// 4. Signal lost mid-trip for 6 min while covering ~3 km: flagged and bridged (estimated).
{
  const pts = [
    pt(at(10, 0), -1.95, 30.06, 30),
    pt(at(10, 0, 10), -1.95, 30.0608, 30),
    pt(at(10, 6, 10), -1.95, 30.0878, 30),
    pt(at(10, 6, 20), -1.95, 30.0886, 30),
  ];
  const r = buildDayReport(pts, [{ started_at: at(9, 59), ended_at: at(10, 7) }], DAY);
  console.log("Signal lost while driving");
  ok("one gap", r.totals.gaps === 1, r.totals.gaps);
  ok("≈3 km bridged as estimate", Math.abs(r.totals.estimatedKm - 3.0) < 0.2, r.totals.estimatedKm);
}

// 5. Parked jitter inside a trip (engine on, 5 min waiting) adds no distance.
{
  const pts: RawPoint[] = [];
  for (let s = 0; s < 300; s += 10)
    pts.push(pt(at(7, 0, s), -1.95 + ((s / 10) % 2) * 6e-5, 30.06, 1));
  const r = buildDayReport(pts, [{ started_at: at(7, 0), ended_at: at(7, 5) }], DAY);
  console.log("Engine on, waiting");
  ok("distance < 50 m", r.totals.distanceKm < 0.05, r.totals.distanceKm);
  ok("all stopped, no driving", r.totals.drivingMs === 0, r.totals.drivingMs);
}

console.log(failed ? `\n${failed} FAILED` : "\nAll passed");
process.exit(failed ? 1 : 0);
