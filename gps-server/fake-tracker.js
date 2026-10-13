// Pretends to be a GT06 tracker: sends a real binary login, then location
// packets every 5 s driving east through Kigali. Usage:
//   node fake-tracker.js [host] [port] [imei]
import net from "node:net";
import { encodeLogin, encodeLocation, encodeHeartbeat, splitFrames } from "./src/gt06.js";

const [host = "127.0.0.1", port = "5023", imei = "865893082910557"] = process.argv.slice(2);
let lat = -1.90611, lon = 30.13144, serial = 1;

const sock = net.connect(Number(port), host, () => {
  console.log(`connected to ${host}:${port} as ${imei}`);
  sock.write(encodeLogin(imei, serial++));
  setInterval(() => {
    lon += 0.0004;
    lat += (Math.random() - 0.5) * 0.0002;
    sock.write(encodeLocation({ latitude: lat, longitude: lon, speedKmh: 30 + Math.random() * 15, heading: 90, acc: true }, serial++));
    console.log(`sent ${lat.toFixed(6)}, ${lon.toFixed(6)}`);
  }, 5000);
  setInterval(() => sock.write(encodeHeartbeat({ acc: true }, serial++)), 30000);
});
sock.on("data", (d) => splitFrames(d).frames.forEach((f) => console.log(`server ACK ${f.toString("hex")}`)));
sock.on("error", (e) => console.error("error:", e.message));
sock.on("close", () => { console.log("closed"); process.exit(0); });
