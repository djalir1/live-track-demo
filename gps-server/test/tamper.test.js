// Tamper watch: owners are alerted when the tracker is removed, switched off or
// goes silent, never just because it lost the vehicle's power (16 Oct: a loose
// wire at engine start sent a false "unplugged" while the car drove on).
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

test("power bit that means 'charging': never a false alarm", async () => {
  assert.deepEqual(await alerts(hb(true, false, 6)), []); // plugged in, engine on
  assert.deepEqual(await alerts(hb(false, false, 20)), []); // parked overnight
  const r = await run([...hb(true, false, 1), ...hb(false, true, 3), ...hb(false, false, 5)]);
  assert.deepEqual(r.alerts, []);
  assert.equal(r.onBattery, 0);
});

test("losing the vehicle's power: dashboard warning, no alert", async () => {
  // The power bit alone says "battery" (17 Oct: parked, key off, after a
  // reconnect): not trusted to mark it on battery, only the 0x02 alarm is.
  let r = await run([...hb(false, true, 3), ...hb(false, false, 6), ...hb(false, true, 3)]);
  assert.deepEqual(r.alerts, []);
  assert.equal(r.onBattery, 0);

  // 16 Oct replay: plugged in, engine start, ACC flickers, power-cut alarm,
  // then on battery with ACC "off" for half an hour while driving.
  r = await run([
    ...hb(false, true, 2),
    ...hb(true, true, 2),
    { acc: false, charging: true },
    { acc: true, charging: true },
    { acc: false, charging: false },
    { alarm: ALARM.POWER_CUT },
    { alarm: ALARM.POWER_CUT },
    ...hb(false, false, 10),
  ]);
  assert.deepEqual(r.alerts, [], "no push for a loose wire");
  assert.equal(r.onBattery, 1, "marked on battery once");

  // Ignition wire live again = harness back.
  r = await run([{ alarm: ALARM.POWER_CUT }, ...hb(false, false, 3), ...hb(true, false, 1)]);
  assert.deepEqual(r.alerts, []);
  assert.equal(r.powerBack, 1);
});

test("power back: two 'vehicle' reports clear it, trusted bit or not", async () => {
  const r = await run([{ alarm: ALARM.POWER_CUT }, ...hb(false, false, 4), ...hb(false, true, 2)]);
  assert.deepEqual(r.alerts, []);
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
  // Unplugged, then removed from its mount: that one is real.
  assert.deepEqual(await alerts([{ alarm: ALARM.POWER_CUT }, { alarm: ALARM.REMOVED }]), [
    "gps_tamper",
  ]);
});

test("switching off because the backup battery ran out is not tampering", async () => {
  assert.deepEqual(
    await alerts([{ alarm: ALARM.POWER_CUT }, { alarm: ALARM.POWER_OFF, voltage: 1 }]),
    [],
  );
  // Full battery: someone is switching it off.
  assert.deepEqual(
    await alerts([{ alarm: ALARM.POWER_CUT }, { alarm: ALARM.POWER_OFF, voltage: 5 }]),
    ["gps_tamper"],
  );
});
