/**
 * Pure-logic tests for the parent trip math: projection, remaining metres,
 * rolling speed, ETA, stop statuses, pre-home stop.
 * Run with: npx tsx scripts/test-parent-trip.ts
 */
import {
  bannerForEvent, computeEta, haversineM, projectOnRoute, preHomeStopId,
  remainingMetresToStop, rollingSpeedKmh, stopStatuses, orderedStops,
  type EventLite, type HistoryPt, type StopPt,
} from "../src/lib/parent-trip";

let passed = 0, failed = 0;
function ok(name: string, cond: boolean, got?: unknown) {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else      { failed++; console.log(`  FAIL  ${name}${got !== undefined ? `  got=${JSON.stringify(got)}` : ""}`); }
}

// Three real stops from the seed: Kimironko, Nyarugenge, School.
const stops: StopPt[] = [
  { id: "kim",   lat: -1.9345, lng: 30.1250, sequence: 1 },
  { id: "nyar",  lat: -1.9500, lng: 30.0580, sequence: 2 },
  { id: "school",lat: -1.9536, lng: 30.0906, sequence: 3 },
];

console.log("haversineM");
ok("Kimironko → Nyarugenge distance is 7-8 km",
  (() => { const d = haversineM([-1.9345, 30.1250], [-1.9500, 30.0580]) / 1000; return d > 6.5 && d < 8.5; })());

console.log("\nprojectOnRoute");
{
  // Bus sits AT Kimironko → projection is start of segment 0, cumulative ≈ 0.
  const p = projectOnRoute([-1.9345, 30.1250], stops);
  ok("bus at Kimironko → seg 0, fraction 0, cumM ≈ 0", p.segIdx === 0 && p.fraction < 0.02 && p.cumulativeM < 100);
}
{
  // Bus AT School → projection at end of last segment, cumulativeM ≈ full route length.
  const p = projectOnRoute([-1.9536, 30.0906], stops);
  ok("bus at School → seg 1, fraction ≈ 1", p.segIdx === 1 && p.fraction > 0.98);
}

console.log("\nremainingMetresToStop");
{
  const r = remainingMetresToStop([-1.9345, 30.1250], stops, "school"); // start → School
  ok("Kimironko → School has ~11 km remaining", r != null && r > 9000 && r < 13000, r);
}
{
  const r = remainingMetresToStop([-1.9500, 30.0580], stops, "school"); // Nyarugenge → School
  ok("Nyarugenge → School has ~3-4 km remaining", r != null && r > 2500 && r < 5000, r);
}
{
  const r = remainingMetresToStop([-1.9536, 30.0906], stops, "kim"); // past Kimironko already
  ok("At School, remaining to Kimironko is null (already passed)", r === null);
}

console.log("\nrollingSpeedKmh");
{
  const now = Date.parse("2026-08-20T06:00:00Z");
  const p = (secAgo: number, lat: number, lng: number): HistoryPt => ({
    latitude: lat, longitude: lng, recorded_at: new Date(now - secAgo * 1000).toISOString(),
  });
  // 3 points moving ~1 km/min along a line → ~60 km/h.
  const speed = rollingSpeedKmh([
    p(120, -1.9500, 30.0580),
    p(60,  -1.9500, 30.0680),
    p(0,   -1.9500, 30.0780),
  ], 5, now);
  ok("~1 km per 60s → ~60 km/h", speed != null && speed > 40 && speed < 80, speed);

  ok("empty → null", rollingSpeedKmh([], 5, now) === null);
  ok("one point → null", rollingSpeedKmh([p(30, -1.95, 30.06)], 5, now) === null);
}

console.log("\ncomputeEta");
{
  // Bus at Nyarugenge, home = School, no events yet, live speed 30 km/h.
  const eta = computeEta({ bus: [-1.9500, 30.0580], stops, homeStopId: "school", events: [], liveSpeedKmh: 30 });
  ok("Nyarugenge → School @ 30 km/h → eta ≈ 6-10 min", eta.kind === "eta" && eta.minutes > 4 && eta.minutes < 12, eta);
}
{
  // Live speed near-zero → fallback 20 km/h kicks in.
  const eta = computeEta({ bus: [-1.9500, 30.0580], stops, homeStopId: "school", events: [], liveSpeedKmh: 0.2 });
  ok("stopped speed 0.2 → fallback 20 km/h → eta > 4 min", eta.kind === "eta" && eta.minutes >= 4, eta);
}
{
  // Bus very close to home (~500 m at 60 km/h → < 2 min → "arriving").
  const eta = computeEta({ bus: [-1.9518, 30.0745], stops, homeStopId: "school", events: [], liveSpeedKmh: 60 });
  ok("bus very close at 60 km/h → arriving", eta.kind === "arriving", eta);
}
{
  const events: EventLite[] = [
    { stop_id: "school", event_type: "arrive", occurred_at: "2026-08-20T06:00:00Z" },
    { stop_id: "school", event_type: "depart", occurred_at: "2026-08-20T06:03:00Z" },
  ];
  const eta = computeEta({ bus: [-1.9536, 30.0906], stops, homeStopId: "school", events, liveSpeedKmh: 30 });
  ok("depart(home) seen → passed", eta.kind === "passed");
}
{
  const eta = computeEta({ bus: null, stops, homeStopId: "school", events: [], liveSpeedKmh: 30 });
  ok("no bus → unknown", eta.kind === "unknown");
}

console.log("\nstopStatuses");
{
  const events: EventLite[] = [
    { stop_id: "kim",  event_type: "arrive", occurred_at: "2026-08-20T06:00:00Z" },
    { stop_id: "kim",  event_type: "depart", occurred_at: "2026-08-20T06:02:00Z" },
    { stop_id: "nyar", event_type: "arrive", occurred_at: "2026-08-20T06:15:00Z" },
    // still inside Nyarugenge
  ];
  const st = stopStatuses(stops, events);
  ok("Kimironko → done",     st.get("kim")    === "done");
  ok("Nyarugenge → current", st.get("nyar")   === "current");
  ok("School → pending",     st.get("school") === "pending");
}

console.log("\npreHomeStopId");
ok("home = School → pre = Nyarugenge", preHomeStopId(stops, "school") === "nyar");
ok("home = Kimironko (first) → null",  preHomeStopId(stops, "kim") === null);
ok("home = unknown id → null",         preHomeStopId(stops, "nope") === null);

console.log("\nbannerForEvent (Aline lives at Nyarugenge; pre-home = Kimironko)");
{
  const home = "nyar", pre = "kim";
  ok("arrive(home)  → arrived",  bannerForEvent({ stop_id: "nyar", event_type: "arrive", occurred_at: "" }, home, pre) === "arrived");
  ok("arrive(pre)   → approach", bannerForEvent({ stop_id: "kim",  event_type: "arrive", occurred_at: "" }, home, pre) === "approach");
  ok("depart(home)  → null",     bannerForEvent({ stop_id: "nyar", event_type: "depart", occurred_at: "" }, home, pre) === null);
  ok("arrive(other) → null",     bannerForEvent({ stop_id: "school", event_type: "arrive", occurred_at: "" }, home, pre) === null);
  ok("home=null → null",         bannerForEvent({ stop_id: "kim", event_type: "arrive", occurred_at: "" }, null, pre) === null);
  ok("no pre-home  → still arrived at home",
    bannerForEvent({ stop_id: "kim", event_type: "arrive", occurred_at: "" }, "kim", null) === "arrived");
}

console.log("\norderedStops");
{
  const shuffled: StopPt[] = [stops[2], stops[0], stops[1]];
  const ordered = orderedStops(shuffled).map((s) => s.id);
  ok("sorts by sequence asc", ordered[0] === "kim" && ordered[1] === "nyar" && ordered[2] === "school");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
