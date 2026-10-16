import { test } from "node:test";
import assert from "node:assert/strict";
import {
  crc16x25,
  splitFrames,
  decodeFrame,
  encodeLogin,
  encodeLocation,
  encodeHeartbeat,
} from "../src/gt06.js";

const hex = (s) => Buffer.from(s.replace(/\s+/g, ""), "hex");

test("decodes the reference login packet from the Concox spec", () => {
  // 78 78 0D 01 01 23 45 67 89 01 23 45 00 01 8C DD 0D 0A
  const msg = decodeFrame(hex("78780D01012345678901234500018CDD0D0A"));
  assert.equal(msg.type, "login");
  assert.equal(msg.imei, "123456789012345");
  // Reply must be 78 78 05 01 00 01 D9 DC 0D 0A
  assert.equal(msg.reply.toString("hex"), "787805010001d9dc0d0a");
});

test("round-trips our own encoder (southern / eastern hemisphere, ACC)", () => {
  const login = decodeFrame(encodeLogin("865893082910557"));
  assert.equal(login.imei, "865893082910557");
  const loc = decodeFrame(
    encodeLocation({
      latitude: -1.90611,
      longitude: 30.13144,
      speedKmh: 42,
      heading: 90,
      acc: true,
    }),
  );
  assert.ok(Math.abs(loc.latitude + 1.90611) < 1e-5);
  assert.ok(Math.abs(loc.longitude - 30.13144) < 1e-5);
  assert.equal(loc.speedKmh, 42);
  assert.equal(loc.heading, 90);
  assert.equal(loc.acc, true);
  const hb = decodeFrame(encodeHeartbeat({ acc: false }));
  assert.equal(hb.type, "status");
  assert.equal(hb.acc, false);
});

test("splits concatenated and partial frames", () => {
  const a = encodeLogin("865893082910557"),
    b = encodeLocation({ latitude: -1.9, longitude: 30.1 });
  const all = Buffer.concat([a, b]);
  const r1 = splitFrames(all.subarray(0, a.length + 5));
  assert.equal(r1.frames.length, 1);
  const r2 = splitFrames(Buffer.concat([r1.rest, all.subarray(a.length + 5)]));
  assert.equal(r2.frames.length, 1);
  assert.equal(r2.rest.length, 0);
});

test("rejects a corrupted CRC", () => {
  const f = encodeLogin("865893082910557");
  f[f.length - 3] ^= 0xff;
  assert.equal(decodeFrame(f), null);
  assert.equal(typeof crc16x25(Buffer.from([1])), "number");
});

test("alarm packets: power cut, removal, and the vehicle-power bit", async () => {
  const { encodeAlarm, ALARM } = await import("../src/gt06.js");
  const cut = decodeFrame(
    encodeAlarm({ latitude: -1.95, longitude: 30.06, alarm: ALARM.POWER_CUT }),
  );
  assert.equal(cut.type, "alarm");
  assert.equal(cut.alarm, ALARM.POWER_CUT);
  assert.equal(cut.charging, false);
  assert.ok(Math.abs(cut.latitude + 1.95) < 1e-5);
  const removed = decodeFrame(
    encodeAlarm({ latitude: -1.95, longitude: 30.06, alarm: ALARM.REMOVED, charging: true }),
  );
  assert.equal(removed.alarm, ALARM.REMOVED);
  assert.equal(removed.charging, true);
  // Real 0x16 from the Concox spec layout: alarm byte 0, power-cut bits in terminal info.
  const bitsOnly = decodeFrame(encodeAlarm({ latitude: -1.95, longitude: 30.06, alarm: 0 }));
  assert.equal(bitsOnly.alarm, 0);
  assert.equal(decodeFrame(encodeHeartbeat({ acc: true, charging: false })).charging, false);
  assert.equal(decodeFrame(encodeHeartbeat({ acc: true })).charging, true);
});
