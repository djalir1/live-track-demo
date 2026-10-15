// Replays what the real tracker did on 14 Oct (engine start with no GPS lock,
// ACC flickering while cranking, ACC wire reading "off" all drive, a long stop
// in traffic) against the store, with a fake Supabase and a fake clock.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../src/store.js";

const UID = "driver-1";
const IMEI = "865893082910557";

function fakeSupabase() {
  const calls = [];
  let openTrip = null;
  const status = {};
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method, u, body });
    const json = (x) => new Response(x == null ? "" : JSON.stringify(x), { status: 200 });
    if (u.includes("/buses?"))
      return json([{ id: "bus-1", label: "Test Car", gps_imei: IMEI, driver_user_id: UID }]);
    if (u.includes("/profiles?")) return json([]);
    if (u.includes("/trip_sessions")) {
      if (method === "GET") return json(openTrip ? [openTrip] : []);
      if (method === "POST") { openTrip = { started_at: body.started_at }; return json(null); }
      if (method === "PATCH") {
        const closed = openTrip ? [{ ...openTrip, ended_at: body.ended_at }] : [];
        openTrip = null;
        return json(closed);
      }
    }
    if (u.includes("/device_status")) {
      if (method === "GET") return json([]);
      Object.assign(status, body);
      return json(null);
    }
    if (u.includes("/location_history")) return json(null);
    return json(null);
  };
  return {
    calls,
    status,
    trips: () => calls.filter((c) => c.u.includes("/trip_sessions") && c.method !== "GET"),
  };
}

const T0 = Date.parse("2026-10-14T20:06:00Z");

async function run(fn) {
  mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: T0 });
  const db = fakeSupabase();
  const lines = [];
  const store = createStore({ url: "http://db", serviceKey: "k", log: (...a) => lines.push(a.join(" ")) });
  let clock = T0;
  const at = async (sec, step) => {
    const target = T0 + sec * 1000;
    // Advance in 1 s steps so off-timers fire at the right moments.
    while (clock < target) {
      mock.timers.tick(1000);
      clock += 1000;
      await new Promise((r) => setImmediate(r));
    }
    if (step) await step();
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  };
  const fix = (sec, lat, lon, kmh = 0, valid = true, sats = 12) =>
    store.savePosition(IMEI, {
      valid, satellites: sats, latitude: lat, longitude: lon, speedKmh: kmh, heading: 0, acc: null,
      deviceTime: new Date(T0 + sec * 1000),
    });
  const hb = (acc) => store.saveHeartbeat(IMEI, acc, 6);
  try {
    await fn({ at, fix, hb, db, lines });
  } finally {
    mock.timers.reset();
  }
}

test("engine start, cranking flicker, wrong ACC wire, traffic stop → one clean trip", async () => {
  await run(async ({ at, fix, hb, db, lines }) => {
    // Key on: no GPS lock yet for ~90 s, but the tracker reports every 10 s.
    await at(0, () => hb(true));
    for (let s = 2; s <= 90; s += 10) await at(s, () => fix(s, 0, 0, 0, false, 3));
    assert.equal(db.status.gps_fix, false, "dashboard is told the GPS is still searching");
    assert.equal(db.status.is_tracking, true, "engine shown as on while searching");

    // Cranking: ACC flickers off/on/off, then the badly wired ACC stays "off".
    await at(91, () => hb(false));
    await at(93, () => hb(true));
    await at(95, () => hb(false));

    // Idling, then driving east, then 4 min stuck in traffic, then driving on.
    let lon = 30.131;
    for (let s = 100; s <= 180; s += 10) await at(s, () => fix(s, -1.906, lon, 0));
    for (let s = 190; s <= 400; s += 10) { lon += 0.0004; await at(s, () => fix(s, -1.906, lon, 16)); }
    for (let s = 410; s <= 650; s += 10) await at(s, () => fix(s, -1.906, lon, 0));
    for (let s = 660; s <= 800; s += 10) { lon += 0.0004; await at(s, () => fix(s, -1.906, lon, 16)); }

    // Engine off: reports drop to every 5 min.
    await at(805, () => hb(false));
    await at(1100, () => fix(1100, -1.906, lon, 0));
    await at(1400, () => fix(1400, -1.906, lon, 0));

    const trips = db.trips();
    assert.equal(trips.filter((c) => c.method === "POST").length, 1, `exactly one trip started\n${lines.join("\n")}`);
    assert.equal(trips.filter((c) => c.method === "PATCH").length, 1, "exactly one trip ended");
    const ended = Date.parse(trips.find((c) => c.method === "PATCH").body.ended_at);
    assert.ok(Math.abs(ended - (T0 + 805_000)) <= 10_000, `trip ends when the engine stopped, got ${new Date(ended).toISOString()}`);
    assert.equal(db.status.status, "idle");
    assert.equal(db.status.is_tracking, false);
    assert.equal(db.status.gps_fix, true);
  });
});

test("parked: 5-minute reports and heartbeats never start a trip", async () => {
  await run(async ({ at, fix, hb, db }) => {
    for (let s = 0; s <= 3600; s += 300) {
      await at(s, () => fix(s, -1.906, 30.131, 0));
      await at(s + 180, () => hb(false));
    }
    assert.equal(db.trips().length, 0);
    assert.equal(db.status.is_tracking, false);
    assert.equal(db.status.status, "idle");
  });
});

test("key on without starting, then off → trip closes 90 s after the last report", async () => {
  await run(async ({ at, fix, hb, db }) => {
    await at(0, () => hb(true));
    for (let s = 5; s <= 45; s += 10) await at(s, () => fix(s, -1.906, 30.131, 0));
    await at(50, () => hb(false));
    await at(200);
    const trips = db.trips();
    assert.equal(trips.filter((c) => c.method === "POST").length, 1);
    assert.equal(trips.filter((c) => c.method === "PATCH").length, 1);
    assert.equal(db.status.is_tracking, false);
  });
});
