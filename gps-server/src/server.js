// Live Track GPS server: accepts GT06 trackers over TCP and writes their
// positions into Supabase. Run with:  node --env-file=.env src/server.js
import net from "node:net";
import http from "node:http";
import { splitFrames, decodeFrame } from "./gt06.js";
import { createStore } from "./store.js";
import { createNotifier } from "./notify.js";

// Node tries each address of a host for only 250 ms ("happy eyeballs") before
// moving on. From Kigali, Apple's push servers take longer than that, so every
// attempt was cut off (ETIMEDOUT) and iPhones never got alerts. Connect normally.
net.setDefaultAutoSelectFamily(false);

const GPS_PORT = Number(process.env.GPS_TCP_PORT || 5023);
const HTTP_PORT = Number(process.env.HTTP_PORT || 8080);
const DRY_RUN = process.env.DRY_RUN === "1";
const IDLE_TIMEOUT_MS = 10 * 60_000; // GT06 heartbeats every few minutes

if (!DRY_RUN && (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY)) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (or set DRY_RUN=1)");
  process.exit(1);
}

const ts = () => new Date().toISOString().slice(11, 19);
const log = (...a) => console.log(ts(), ...a);

const store = createStore({
  url: process.env.SUPABASE_URL,
  serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  dryRun: DRY_RUN,
  log,
});

// Trip alerts to owners' phones (web push; keys from `npm run vapid`).
if (!DRY_RUN && process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  createNotifier({
    url: process.env.SUPABASE_URL,
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    vapid: {
      publicKey: process.env.VAPID_PUBLIC_KEY,
      privateKey: process.env.VAPID_PRIVATE_KEY,
      subject: process.env.VAPID_SUBJECT || "mailto:admin@livetrack.app",
    },
    log,
  }).start();
} else if (!DRY_RUN) {
  log("⚠️  trip alerts off: set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY in .env");
}

const devices = new Map(); // imei → { remote, connectedAt, lastPacket, packets }

const sockets = new Map(); // imei → its current socket

const server = net.createServer((socket) => {
  const remote = `${socket.remoteAddress}:${socket.remotePort}`;
  let imei = null;
  let buf = Buffer.alloc(0);
  // Every message from one tracker is handled strictly in order, even when
  // TCP delivers several at once; otherwise a late "ignition off" could be
  // saved after a newer "on", or two handlers could end the same trip.
  let queue = Promise.resolve();
  log(`🔌 connect ${remote}`);
  socket.setTimeout(IDLE_TIMEOUT_MS);
  socket.setKeepAlive(true, 60_000);

  socket.on("data", (chunk) => {
    queue = queue.then(() => handle(chunk)).catch((e) => log(`💥 ${imei ?? remote}: ${e.message}`));
  });

  async function handle(chunk) {
    if (process.env.LOG_RAW === "1") log(`raw ${remote} ${chunk.toString("hex")}`);
    buf = Buffer.concat([buf, chunk]);
    const { frames, rest } = splitFrames(buf);
    buf = Buffer.from(rest);
    if (buf.length > 4096) buf = Buffer.alloc(0); // not a GT06 device; drop junk

    for (const f of frames) {
      const msg = decodeFrame(f);
      if (!msg) {
        log(`❌ bad CRC from ${remote}: ${f.toString("hex")}`);
        continue;
      }
      if (msg.reply && !socket.destroyed) socket.write(msg.reply);

      if (msg.type === "login") {
        imei = msg.imei;
        // A tracker that changed cell/IP reconnects before the old connection
        // has timed out; drop the old one so only one is ever live.
        const old = sockets.get(imei);
        if (old && old !== socket) old.destroy();
        sockets.set(imei, socket);
        devices.set(imei, { remote, connectedAt: new Date(), lastPacket: new Date(), packets: 0 });
        log(`✅ login IMEI ${imei} from ${remote}`);
        await store.noteLogin(imei).catch((e) => log(`💥 login note for ${imei}: ${e.message}`));
        continue;
      }
      if (!imei) {
        log(`⚠️  packet 0x${msg.proto.toString(16)} before login from ${remote}`);
        continue;
      }
      const d = devices.get(imei);
      if (d) {
        d.lastPacket = new Date();
        d.packets++;
      }

      try {
        if (msg.type === "alarm") {
          // Tamper alarms (power cut, removed…) plus the position it carries.
          await store.saveAlarm(imei, msg);
        } else if (msg.type === "location") {
          // Without a GPS lock too: it proves the tracker is alive and running.
          await store.savePosition(imei, msg);
        } else if (msg.type === "status") {
          log(
            `💓 heartbeat ${imei} acc=${msg.acc ? "on" : "off"} power=${msg.charging ? "vehicle" : "battery"} level=${msg.voltageLevel}`,
          );
          await store.saveHeartbeat(imei, msg.acc, msg.voltageLevel, msg.charging);
        } else {
          log(`ℹ️  ${imei} packet 0x${msg.proto.toString(16)}`);
        }
      } catch (e) {
        log(`💥 save failed for ${imei}: ${e.message}`);
      }
    }
  }

  socket.on("timeout", () => {
    log(`⏱️  idle timeout ${imei ?? remote}`);
    socket.destroy();
  });
  socket.on("close", () => {
    if (imei && sockets.get(imei) === socket) sockets.delete(imei);
    log(`📴 disconnect ${imei ?? remote}`);
  });
  socket.on("error", (e) => log(`socket error ${imei ?? remote}: ${e.message}`));
});

server.listen(GPS_PORT, () =>
  log(`🚌 GT06 listener on TCP ${GPS_PORT}${DRY_RUN ? " (DRY RUN — no DB writes)" : ""}`),
);

// Tiny health endpoint so you can check the server from a browser.
http
  .createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify(
        {
          ok: true,
          devices: Object.fromEntries(
            [...devices].map(([k, v]) => [
              k,
              {
                ...v,
                connected: sockets.has(k),
                connectedAt: v.connectedAt.toISOString(),
                lastPacket: v.lastPacket.toISOString(),
              },
            ]),
          ),
        },
        null,
        2,
      ),
    );
  })
  .listen(HTTP_PORT, "127.0.0.1", () =>
    log(`🩺 health on http://127.0.0.1:${HTTP_PORT} (local only)`),
  );
