// Live Track GPS server: accepts GT06 trackers over TCP and writes their
// positions into Supabase. Run with:  node --env-file=.env src/server.js
import net from "node:net";
import http from "node:http";
import { splitFrames, decodeFrame } from "./gt06.js";
import { createStore } from "./store.js";

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

const devices = new Map(); // imei → { remote, lastPacket, packets }

const server = net.createServer((socket) => {
  const remote = `${socket.remoteAddress}:${socket.remotePort}`;
  let imei = null;
  let buf = Buffer.alloc(0);
  log(`🔌 connect ${remote}`);
  socket.setTimeout(IDLE_TIMEOUT_MS);
  socket.setKeepAlive(true, 60_000);

  socket.on("data", async (chunk) => {
    if (process.env.LOG_RAW === "1") log(`raw ${remote} ${chunk.toString("hex")}`);
    buf = Buffer.concat([buf, chunk]);
    const { frames, rest } = splitFrames(buf);
    buf = Buffer.from(rest);
    if (buf.length > 4096) buf = Buffer.alloc(0); // not a GT06 device; drop junk

    for (const f of frames) {
      const msg = decodeFrame(f);
      if (!msg) { log(`❌ bad CRC from ${remote}: ${f.toString("hex")}`); continue; }
      if (msg.reply) socket.write(msg.reply);

      if (msg.type === "login") {
        imei = msg.imei;
        devices.set(imei, { remote, lastPacket: new Date(), packets: 0 });
        log(`✅ login IMEI ${imei} from ${remote}`);
        continue;
      }
      if (!imei) { log(`⚠️  packet 0x${msg.proto.toString(16)} before login from ${remote}`); continue; }
      const d = devices.get(imei);
      d.lastPacket = new Date();
      d.packets++;

      try {
        if ((msg.type === "location" || msg.type === "alarm") && msg.valid) {
          await store.savePosition(imei, msg);
        } else if (msg.type === "location") {
          log(`… ${imei} no GPS fix yet (satellites=${msg.satellites})`);
        } else if (msg.type === "status") {
          log(`💓 heartbeat ${imei} acc=${msg.acc ? "on" : "off"}`);
          await store.saveHeartbeat(imei, msg.acc, msg.voltageLevel);
        } else {
          log(`ℹ️  ${imei} packet 0x${msg.proto.toString(16)}`);
        }
      } catch (e) {
        log(`💥 save failed for ${imei}: ${e.message}`);
      }
    }
  });

  socket.on("timeout", () => { log(`⏱️  idle timeout ${imei ?? remote}`); socket.destroy(); });
  socket.on("close", () => log(`📴 disconnect ${imei ?? remote}`));
  socket.on("error", (e) => log(`socket error ${imei ?? remote}: ${e.message}`));
});

server.listen(GPS_PORT, () => log(`🚌 GT06 listener on TCP ${GPS_PORT}${DRY_RUN ? " (DRY RUN — no DB writes)" : ""}`));

// Tiny health endpoint so you can check the server from a browser.
http.createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({
    ok: true,
    devices: Object.fromEntries([...devices].map(([k, v]) => [k, { ...v, lastPacket: v.lastPacket.toISOString() }])),
  }, null, 2));
}).listen(HTTP_PORT, () => log(`🩺 health on http://localhost:${HTTP_PORT}`));
