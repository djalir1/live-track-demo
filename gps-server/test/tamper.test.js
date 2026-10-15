// Tamper watch: no false "unplugged" from trackers whose power bit means
// "charging" (the Test Car), real alerts from alarms or a proven power bit.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../src/store.js";
import { decodeFrame, encodeAlarm, encodeHeartbeat, ALARM } from "../src/gt06.js";

async function alerts(steps) {
  const out = [];
  const store = createStore({ dryRun: true, log: (...a) => { const m = a.join(" ").match(/🚨 .*?: (gps_\w+)/); if (m) out.push(m[1]); } });
  for (const st of steps) {
    if (st.alarm) await store.saveAlarm("x", decodeFrame(encodeAlarm({ latitude: -1.95, longitude: 30.06, alarm: st.alarm })));
    else { const m = decodeFrame(encodeHeartbeat(st)); await store.saveHeartbeat("x", m.acc, m.voltageLevel, m.charging); }
  }
  return out;
}
const hb = (acc, charging, n) => Array(n).fill({ acc, charging });

test("power bit that means 'charging': never a false alarm", async () => {
  assert.deepEqual(await alerts(hb(true, false, 6)), []); // plugged in, engine on
  assert.deepEqual(await alerts(hb(false, false, 20)), []); // parked overnight
  assert.deepEqual(await alerts([...hb(true, false, 1), ...hb(false, true, 3), ...hb(false, false, 5)]), []);
});

test("proven power bit: unplugged, then back", async () => {
  assert.deepEqual(await alerts([...hb(false, true, 3), ...hb(false, false, 3), ...hb(false, true, 3)]), ["gps_tamper", "gps_back"]);
});

test("tracker alarms alert at once, ignition on clears", async () => {
  assert.deepEqual(await alerts([{ alarm: ALARM.POWER_CUT }, { alarm: ALARM.POWER_CUT }, ...hb(false, false, 3), ...hb(true, false, 1)]), ["gps_tamper", "gps_back"]);
  assert.deepEqual(await alerts([{ alarm: ALARM.REMOVED }]), ["gps_tamper"]);
  assert.deepEqual(await alerts([{ alarm: ALARM.SOS }]), []);
});
