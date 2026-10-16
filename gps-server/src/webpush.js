// Minimal Web Push sender (RFC 8030 + RFC 8291 aes128gcm + RFC 8292 VAPID)
// on node:crypto, so the server keeps zero npm dependencies.
import crypto from "node:crypto";
import https from "node:https";

const b64u = (buf) => Buffer.from(buf).toString("base64url");
const unb64u = (s) => Buffer.from(s, "base64url");

/** New VAPID key pair: { publicKey, privateKey } as base64url (65-byte point, 32-byte scalar). */
export function generateVapidKeys() {
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  return { publicKey: b64u(ecdh.getPublicKey()), privateKey: b64u(ecdh.getPrivateKey()) };
}

function vapidKeyObject(publicKey, privateKey) {
  const pub = unb64u(publicKey);
  if (pub.length !== 65 || pub[0] !== 4)
    throw new Error("VAPID public key must be a 65-byte uncompressed P-256 point");
  return crypto.createPrivateKey({
    key: {
      kty: "EC",
      crv: "P-256",
      x: b64u(pub.subarray(1, 33)),
      y: b64u(pub.subarray(33)),
      d: privateKey,
    },
    format: "jwk",
  });
}

/** Authorization header value for one push endpoint (RFC 8292). */
export function vapidAuthorization(
  endpoint,
  { publicKey, privateKey, subject },
  nowSec = Math.floor(Date.now() / 1000),
) {
  const header = b64u(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const claims = b64u(
    JSON.stringify({ aud: new URL(endpoint).origin, exp: nowSec + 12 * 3600, sub: subject }),
  );
  const sig = crypto.sign("sha256", Buffer.from(`${header}.${claims}`), {
    key: vapidKeyObject(publicKey, privateKey),
    dsaEncoding: "ieee-p1363",
  });
  return `vapid t=${header}.${claims}.${b64u(sig)}, k=${publicKey}`;
}

/**
 * Encrypt a payload for one subscription (RFC 8291, single aes128gcm record).
 * `asKeys` / `salt` are only passed by tests.
 */
export function encryptPayload(payload, { p256dh, auth }, { asKeys, salt } = {}) {
  const uaPublic = unb64u(p256dh);
  const authSecret = unb64u(auth);
  const ecdh = crypto.createECDH("prime256v1");
  if (asKeys) ecdh.setPrivateKey(asKeys);
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);
  salt ??= crypto.randomBytes(16);

  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]);
  const ikm = Buffer.from(crypto.hkdfSync("sha256", shared, authSecret, keyInfo, 32));
  const cek = Buffer.from(
    crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16),
  );
  const nonce = Buffer.from(
    crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12),
  );

  const cipher = crypto.createCipheriv("aes-128-gcm", cek, nonce);
  const body = Buffer.concat([
    cipher.update(Buffer.from(payload)),
    cipher.update(Buffer.from([2])),
    cipher.final(),
    cipher.getAuthTag(),
  ]);

  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, body]);
}

/**
 * POST over plain node:https, IPv4, with a generous timeout. Node's fetch
 * (undici) kept timing out to Apple's push servers from Kigali while curl got
 * through, so iPhones never received anything.
 */
function post(endpoint, headers, body, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      endpoint,
      {
        method: "POST",
        family: 4,
        timeout: timeoutMs,
        headers: { ...headers, "Content-Length": body.length },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString() }),
        );
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error(`no answer in ${timeoutMs / 1000} s`)));
    req.on("error", reject);
    req.end(body);
  });
}

/**
 * Send one notification. Resolves to { ok, status, gone, text }. gone means
 * the subscription no longer exists (uninstalled, permission revoked) and
 * should be deleted.
 */
export async function sendPush(
  subscription,
  payload,
  vapid,
  { ttl = 3600, urgency = "high" } = {},
) {
  const { status, text } = await post(
    subscription.endpoint,
    {
      Authorization: vapidAuthorization(subscription.endpoint, vapid),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(ttl),
      Urgency: urgency,
    },
    encryptPayload(JSON.stringify(payload), subscription),
  );
  const ok = status >= 200 && status < 300;
  return { ok, status, gone: status === 404 || status === 410, text: ok ? "" : text };
}
