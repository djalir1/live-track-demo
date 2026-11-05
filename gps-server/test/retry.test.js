// A dropped connection to Supabase must not lose a position (10 were lost in
// the week to 5 Nov 2026), but must never double a trip or an event.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../src/store.js";

const UID = "driver-1";
const IMEI = "865893082910557";

function flakySupabase(failFirst) {
  const calls = [];
  const failed = new Set();
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const method = init.method ?? "GET";
    const table = u.split("/rest/v1/")[1]?.split("?")[0];
    calls.push({ method, table });
    const key = `${method} ${table}`;
    if (failFirst.includes(key) && !failed.has(key)) {
      failed.add(key);
      throw new TypeError("fetch failed");
    }
    const json = (x) => new Response(x == null ? "" : JSON.stringify(x), { status: 200 });
    if (table === "buses")
      return json([{ id: "bus-1", label: "Test Car", gps_imei: IMEI, driver_user_id: UID }]);
    if (table === "trip_sessions" && method === "GET") return json([]);
    if (table === "device_status" && method === "GET") return json([]);
    return json(null);
  };
  return { calls, count: (m, t) => calls.filter((c) => c.method === m && c.table === t).length };
}

const fix = (kmh) => ({
  valid: true,
  satellites: 12,
  latitude: -1.95,
  longitude: 30.06,
  speedKmh: kmh,
  heading: 0,
  acc: null,
  deviceTime: new Date(),
});

test("a position whose save hits 'fetch failed' is retried and kept", async () => {
  const db = flakySupabase(["POST location_history"]);
  const lines = [];
  const store = createStore({
    url: "http://db",
    serviceKey: "k",
    log: (...a) => lines.push(a.join(" ")),
  });
  await store.savePosition(IMEI, fix(0));
  assert.equal(db.count("POST", "location_history"), 2, "failed once, then sent again");
  assert.ok(!lines.some((l) => l.includes("save failed")), "nothing lost");
});

test("a trip insert that hits 'fetch failed' is not repeated", async () => {
  const db = flakySupabase(["POST trip_sessions"]);
  const lines = [];
  const store = createStore({
    url: "http://db",
    serviceKey: "k",
    log: (...a) => lines.push(a.join(" ")),
  });
  // Moving → starts a trip. The error reaches server.js, which logs "save failed".
  await assert.rejects(store.savePosition(IMEI, fix(40)), /fetch failed/);
  assert.equal(db.count("POST", "trip_sessions"), 1, "never sent twice");
});
