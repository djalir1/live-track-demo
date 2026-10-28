/**
 * Pure-logic tests for src/lib/day-report.ts.
 * Run with: npx tsx scripts/test-day-report.ts
 */
import { buildDayReport, type RawPoint } from "../src/lib/day-report";
import {
  daysBetween,
  presetRange,
  summarizeRange,
  weekStart,
  type DaySummary,
} from "../src/lib/range-report";

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

// 6. Today's real pattern (28 Oct): mobile data drops every ~12 min. While crawling
//    in traffic (moved only ~150 m) and while parked — both must show as signal lost.
{
  const pts: RawPoint[] = [];
  // Driving 10:00–10:20, fixes every 10 s, crawling; silent 10:10–10:18.
  for (let s = 0; s <= 20 * 60; s += 10) {
    if (s > 600 && s < 1080) continue;
    pts.push(pt(at(10, 0, s), -1.81 + s * 1e-6, 30.12, 8));
  }
  // Parked from 10:23, every 5 min until 10:43, then silent until 11:05.
  for (let m = 23; m <= 43; m += 5) pts.push(pt(at(10, m), -1.8088, 30.12, 0));
  for (let m = 65; m < 14 * 60; m += 5)
    pts.push(pt(at(10 + Math.floor(m / 60), m % 60), -1.8088, 30.12, 0));
  const sessions = [{ started_at: at(10, 0), ended_at: at(10, 20, 5) }];
  const r = buildDayReport(pts, sessions, { ...DAY, parkedReports: true });
  console.log("Connection lost (crawling + parked)");
  ok("two losses", r.signalLost.length === 2, r.signalLost);
  ok(
    "first: on the trip, ~8 min",
    r.signalLost[0]?.during === "trip" && Math.abs(r.signalLost[0].ms - 480_000) < 15_000,
    r.signalLost[0],
  );
  ok(
    "second: parked, 22 min",
    r.signalLost[1]?.during === "parked" && r.signalLost[1].ms === 22 * 60_000,
    r.signalLost[1],
  );
  ok("no estimated km (it hardly moved)", r.totals.gaps === 0, r.totals.gaps);
  const phone = buildDayReport(pts, sessions, DAY);
  ok("phone app: parked silence is normal", phone.signalLost.length === 1, phone.signalLost);
}

// 7. Parked with normal 5-min check-ins, and a trip whose last fix is just
//    before engine-off: no false "signal lost".
{
  const pts: RawPoint[] = [];
  for (let s = 0; s <= 600; s += 10) pts.push(pt(at(14, 0, s), -1.9, 30.1 + s * 1e-5, 30));
  for (let m = 15; m < 24 * 60 - 14 * 60; m += 5)
    pts.push(pt(at(14 + Math.floor(m / 60), m % 60), -1.9, 30.106, 0));
  const r = buildDayReport(pts, [{ started_at: at(14, 0), ended_at: at(14, 11) }], {
    ...DAY,
    parkedReports: true,
  });
  console.log("Normal parked check-ins");
  ok("no signal lost", r.signalLost.length === 0, r.signalLost);
}

// 8. Period summary: 14 days, used Mon–Fri at 80 km/day → 400 km a week.
{
  const days = daysBetween("2026-10-12", "2026-10-25"); // Mon 12 → Sun 25
  const sums: DaySummary[] = days.map((day, i) => {
    const work = i % 7 < 5;
    return {
      day,
      distanceKm: work ? 80 : 0,
      estimatedKm: 0,
      drivingMs: work ? 3 * 3_600_000 : 0,
      engineOnMs: 0,
      trips: work ? 4 : 0,
      topSpeedKmh: work ? 70 : 0,
      signalLost: i === 3 ? 2 : 0,
      signalLostMs: i === 3 ? 600_000 : 0,
      hasData: true,
    };
  });
  const r = summarizeRange(days[0], days[days.length - 1], sums);
  console.log("Period summary");
  ok("14 days listed", days.length === 14, days.length);
  ok("800 km total", r.distanceKm === 800, r.distanceKm);
  ok("400 km per week", Math.abs(r.perWeekKm - 400) < 0.01, r.perWeekKm);
  ok("80 km per working day", r.perActiveDayKm === 80, r.perActiveDayKm);
  ok("two Monday–Sunday weeks", r.weeks.length === 2 && r.weeks[0].to === "2026-10-18", r.weeks);
  ok("signal losses summed", r.signalLost === 2, r.signalLost);
  ok("week of Wed 28 Oct starts Mon 26", weekStart("2026-10-28") === "2026-10-26");
  const p = presetRange("7d", "2026-10-28");
  ok("last 7 days = 22–28 Oct", p.from === "2026-10-22" && p.to === "2026-10-28", p);
  ok("this month starts on the 1st", presetRange("month", "2026-10-28").from === "2026-10-01");
}

console.log(failed ? `\n${failed} FAILED` : "\nAll passed");
process.exit(failed ? 1 : 0);
