// Web push: payload encryption round-trips the way a browser decrypts it
// (RFC 8291), VAPID JWTs verify, and alert texts read right.
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { encryptPayload, vapidAuthorization, generateVapidKeys } from "../src/webpush.js";
import { messageFor, prefKey } from "../src/notify.js";

/** What the phone does on receipt (user-agent side of RFC 8291). */
function browserDecrypt(body, ua, authSecret) {
  const salt = body.subarray(0, 16);
  const idLen = body[20];
  const asPublic = body.subarray(21, 21 + idLen);
  const data = body.subarray(21 + idLen);
  const shared = ua.computeSecret(asPublic);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), ua.getPublicKey(), asPublic]);
  const ikm = Buffer.from(crypto.hkdfSync("sha256", shared, authSecret, keyInfo, 32));
  const cek = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const d = crypto.createDecipheriv("aes-128-gcm", cek, nonce);
  d.setAuthTag(data.subarray(data.length - 16));
  const plain = Buffer.concat([d.update(data.subarray(0, data.length - 16)), d.final()]);
  assert.equal(plain[plain.length - 1], 2, "last-record delimiter");
  return plain.subarray(0, -1).toString();
}

test("payload decrypts on the receiving device", () => {
  const ua = crypto.createECDH("prime256v1");
  ua.generateKeys();
  const auth = crypto.randomBytes(16);
  const msg = JSON.stringify({ title: "🚌 Bus A started a trip", body: "Driver: Eloge" });
  const body = encryptPayload(msg, { p256dh: ua.getPublicKey("base64url"), auth: auth.toString("base64url") });
  assert.equal(body.readUInt32BE(16), 4096);
  assert.equal(browserDecrypt(body, ua, auth), msg);
});

test("VAPID JWT is signed by the public key it advertises", () => {
  const keys = generateVapidKeys();
  const h = vapidAuthorization("https://web.push.apple.com/abc", { ...keys, subject: "mailto:x@y.z" }, 1_000_000);
  const [, jwt, k] = h.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.equal(k, keys.publicKey);
  const [head, claims, sig] = jwt.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(claims, "base64url")), { aud: "https://web.push.apple.com", exp: 1_000_000 + 43200, sub: "mailto:x@y.z" });
  const pub = Buffer.from(k, "base64url");
  const key = crypto.createPublicKey({
    key: { kty: "EC", crv: "P-256", x: pub.subarray(1, 33).toString("base64url"), y: pub.subarray(33).toString("base64url") },
    format: "jwk",
  });
  assert.ok(crypto.verify("sha256", Buffer.from(`${head}.${claims}`), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(sig, "base64url")));
});

test("alert texts", () => {
  const start = messageFor({
    kind: "trip_started", vehicle_label: "Bus A", plate: "RAB 123A", driver_name: "Eloge",
    occurred_at: "2026-10-15T04:40:00Z",
  });
  assert.equal(start.title, "🚌 Bus A (RAB 123A) started a trip");
  assert.equal(start.body, "Driver: Eloge · engine on at 06:40"); // Kigali = UTC+2

  const end = messageFor({
    kind: "trip_ended", vehicle_label: null, plate: "RAB 123A", driver_name: null,
    occurred_at: "2026-10-15T06:05:00Z", trip_started_at: "2026-10-15T04:40:00Z", distance_m: 12430,
  });
  assert.equal(end.title, "🅿️ RAB 123A is parked");
  assert.equal(end.body, "No driver set · parked, engine off at 08:05 · trip 1 h 25 min, 12.4 km");

  // On a route: says which run, by the trip's start time in Kigali.
  const amStart = messageFor({
    kind: "trip_started", vehicle_label: "Bus A", plate: "RAB 123A", driver_name: "Eloge",
    route_name: "Kimironko – Remera", occurred_at: "2026-10-15T04:10:00Z",
  });
  assert.equal(amStart.title, "🚌 Bus A (RAB 123A) started the morning pickup");
  assert.equal(amStart.body, "Route: Kimironko – Remera · Driver: Eloge · engine on at 06:10");

  const amEnd = messageFor({
    kind: "trip_ended", vehicle_label: "Bus A", plate: null, driver_name: "Eloge", route_name: "Kimironko – Remera",
    occurred_at: "2026-10-15T05:20:00Z", trip_started_at: "2026-10-15T04:10:00Z", distance_m: 0,
  });
  assert.equal(amEnd.title, "🅿️ Bus A finished the morning pickup");

  const pm = messageFor({
    kind: "trip_started", vehicle_label: "Bus A", plate: null, driver_name: "Eloge",
    route_name: "Kimironko – Remera", occurred_at: "2026-10-15T14:30:00Z",
  });
  assert.equal(pm.title, "🚌 Bus A started the afternoon drop-off");
});

test("tamper alert texts", () => {
  const base = { vehicle_label: "Bus A", plate: "RAB 123A", driver_name: "Eloge", occurred_at: "2026-10-15T18:05:00Z" };
  const cut = messageFor({ ...base, kind: "gps_tamper", detail: "GPS tracker unplugged: lost the vehicle's power" });
  assert.equal(cut.title, "⚠️ Bus A (RAB 123A): GPS tracker unplugged");
  assert.equal(cut.body, "Lost the vehicle's power at 20:05. Check the vehicle. Driver: Eloge");
  const removed = messageFor({ ...base, kind: "gps_tamper", detail: "GPS tracker removed from where it was mounted" });
  assert.equal(removed.title, "⚠️ Bus A (RAB 123A): GPS tracker removed from where it was mounted");
  const silent = messageFor({ ...base, kind: "gps_offline", detail: "19:30" });
  assert.equal(silent.title, "📵 Bus A (RAB 123A): GPS tracker silent");
  assert.match(silent.body, /^No signal since 19:30\./);
  assert.equal(prefKey("gps_offline"), "gps_tamper");
  assert.equal(prefKey("trip_started"), "trip_started");
});
