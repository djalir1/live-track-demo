// Tamper watch: owners are alerted when the tracker is removed, switched off,
// unplugged while parked, or goes silent; never because it lost power while
// the engine runs (16 Oct: the Test Car's wiring did that at every start).
// Timed rules (3 min parked, silence) are in engine.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../src/store.js";
import { decodeFrame, encodeAlarm, encodeHeartbeat, ALARM } from "../src/gt06.js";

async function run(steps) {
  const alerts = [];
  const lines = [];
  const store = createStore({
    dryRun: true,
    log: (...a) => {
      const line = a.join(" ");
      lines.push(line);
      const m = line.match(/🚨 .*?: (gps_\w+)/);
      if (m) alerts.push(m[1]);
    },
  });
  for (const st of steps) {
    if (st.alarm)
      await store.saveAlarm(
        "x",
        decodeFrame(encodeAlarm({ latitude: -1.95, longitude: 30.06, ...st })),
      );
    else {
      const m = decodeFrame(encodeHeartbeat(st));
      await store.saveHeartbeat("x", m.acc, m.voltageLevel, m.charging);
    }
  }
  return {
    alerts,
    onBattery: lines.filter((l) => l.includes("🔋")).length,
    powerBack: lines.filter((l) => l.includes("🔌")).length,
  };
}
const alerts = async (steps) => (await run(steps)).alerts;
const hb = (acc, charging, n) => Array(n).fill({ acc, charging });

test("power lost while the engine runs: badge only, no alert", async () => {
  // 16 Oct replay (Test Car wiring): plugged in, engine start, ACC flickers,
  // power-cut alarm, then on battery with ACC "off" while driving.
  let r = await run([
    ...hb(false, true, 2),
    ...hb(true, true, 2),
    { acc: false, charging: true },
    { acc: true, charging: true },
    { acc: false, charging: false },
    { alarm: ALARM.POWER_CUT },
    { alarm: ALARM.POWER_CUT },
    ...hb(false, false, 10),
  ]);
  assert.deepEqual(r.alerts, [], "no push for the wiring fault");
  assert.equal(r.onBattery, 1, "marked on battery once");

  // Ignition wire live again = harness back.
  r = await run([...hb(true, true, 1), { alarm: ALARM.POWER_CUT }, ...hb(true, false, 1)]);
  assert.deepEqual(r.alerts, []);
  assert.equal(r.powerBack, 1);
});

test("power bit: two 'battery' reports mark it, one is noise", async () => {
  assert.equal((await run([...hb(false, true, 3), ...hb(false, false, 1)])).onBattery, 0);
  assert.equal((await run([...hb(false, true, 3), ...hb(false, false, 2)])).onBattery, 1);
});

test("parked: power-cut alarm → 'unplugged' at once; two 'vehicle' reports → back", async () => {
  const r = await run([{ alarm: ALARM.POWER_CUT }, ...hb(false, false, 4), ...hb(false, true, 2)]);
  assert.deepEqual(r.alerts, ["gps_tamper", "gps_back"]);
  assert.equal(r.onBattery, 1);
  assert.equal(r.powerBack, 1);
});

test("tracker tamper alarms alert at once, once per incident", async () => {
  assert.deepEqual(await alerts([{ alarm: ALARM.REMOVED }]), ["gps_tamper"]);
  assert.deepEqual(await alerts([{ alarm: ALARM.REMOVED }, { alarm: ALARM.REMOVED }]), [
    "gps_tamper",
  ]);
  assert.deepEqual(await alerts([{ alarm: ALARM.POWER_OFF }]), ["gps_tamper"]);
  assert.deepEqual(await alerts([{ alarm: ALARM.SOS }]), []);
  // Unplugged, then removed from its mount: one incident, one alert.
  assert.deepEqual(await alerts([{ alarm: ALARM.POWER_CUT }, { alarm: ALARM.REMOVED }]), [
    "gps_tamper",
  ]);
});

test("switching off because the backup battery ran out is not tampering", async () => {
  // Engine running (wiring fault, no alert), battery runs flat.
  const running = hb(true, true, 1);
  assert.deepEqual(
    await alerts([...running, { alarm: ALARM.POWER_CUT }, { alarm: ALARM.POWER_OFF, voltage: 1 }]),
    [],
  );
  // Full battery: someone is switching it off.
  assert.deepEqual(
    await alerts([...running, { alarm: ALARM.POWER_CUT }, { alarm: ALARM.POWER_OFF, voltage: 5 }]),
    ["gps_tamper"],
  );
});
