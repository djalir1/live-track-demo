// GT06 / Concox binary protocol decoder (GT06, GT06N, GT07L, GT08L, most
// "GPSPOS" 4G boxes). Packet layout:
//
//   78 78 | len(1) | proto(1) | content | serial(2) | crc(2) | 0D 0A
//   79 79 | len(2) | proto(1) | content | serial(2) | crc(2) | 0D 0A
//
// len counts proto + content + serial + crc. CRC is CRC-16/X-25 (CRC-ITU)
// over len..serial. Reference: Concox GT06 protocol v1.8 and Traccar's
// Gt06ProtocolDecoder.

export const PROTO = {
  LOGIN: 0x01,
  GPS_LBS: 0x12,
  STATUS: 0x13,
  STRING: 0x15,
  ALARM: 0x16,
  GPS_LBS_2: 0x22,
  STATUS_2: 0x23,
  ALARM_2: 0x26,
  TIME_REQUEST: 0x8a,
  INFO: 0x94,
  GPS_LBS_4G: 0xa0,
  ALARM_4G: 0xa4,
};

const LOCATION_TYPES = new Set([PROTO.GPS_LBS, PROTO.GPS_LBS_2, PROTO.GPS_LBS_4G]);
const ALARM_TYPES = new Set([PROTO.ALARM, PROTO.ALARM_2, PROTO.ALARM_4G]);

export function crc16x25(buf) {
  let crc = 0xffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0x8408 : crc >>> 1;
  }
  return ~crc & 0xffff;
}

/**
 * Pull complete frames out of a growing TCP buffer.
 * Returns { frames, rest } where rest is the unconsumed tail.
 */
export function splitFrames(buf) {
  const frames = [];
  let i = 0;
  while (i + 5 <= buf.length) {
    const h0 = buf[i], h1 = buf[i + 1];
    const short = h0 === 0x78 && h1 === 0x78;
    const long = h0 === 0x79 && h1 === 0x79;
    if (!short && !long) { i++; continue; } // resync on garbage
    const len = short ? buf[i + 2] : buf.readUInt16BE(i + 2);
    const headLen = short ? 3 : 4;
    const total = headLen + len + 2; // + 0D 0A
    if (i + total > buf.length) break; // wait for more bytes
    frames.push(buf.subarray(i, i + total));
    i += total;
  }
  return { frames, rest: buf.subarray(i) };
}

/** Build a server→device reply (ACK) with the given protocol + serial. */
export function buildReply(proto, serial, content = Buffer.alloc(0)) {
  const body = Buffer.alloc(1 + 1 + content.length + 2);
  body[0] = 1 + content.length + 2 + 2; // proto + content + serial + crc
  body[1] = proto;
  content.copy(body, 2);
  body.writeUInt16BE(serial, 2 + content.length);
  const crc = Buffer.alloc(2);
  crc.writeUInt16BE(crc16x25(body));
  return Buffer.concat([Buffer.from([0x78, 0x78]), body, crc, Buffer.from([0x0d, 0x0a])]);
}

function decodeImei(content) {
  // 8 bytes BCD, 16 digits with a leading 0 → 15-digit IMEI.
  return content.subarray(0, 8).toString("hex").replace(/^0/, "");
}

function decodeGps(c, off) {
  const t = new Date(Date.UTC(2000 + c[off], c[off + 1] - 1, c[off + 2], c[off + 3], c[off + 4], c[off + 5]));
  const satellites = c[off + 6] & 0x0f;
  let lat = c.readUInt32BE(off + 7) / 1800000;
  let lon = c.readUInt32BE(off + 11) / 1800000;
  const speed = c[off + 15]; // km/h
  const flags = c.readUInt16BE(off + 16);
  if (!(flags & 0x0400)) lat = -lat; // bit10: 1 = north
  if (flags & 0x0800) lon = -lon;    // bit11: 1 = west
  return {
    deviceTime: t,
    satellites,
    latitude: lat,
    longitude: lon,
    speedKmh: speed,
    heading: flags & 0x03ff,
    valid: Boolean(flags & 0x1000), // bit12: GPS positioned
    next: off + 18,
  };
}

/** ACC (ignition) byte location after the GPS block, per packet type. */
function readAcc(proto, c, off) {
  try {
    if (proto === PROTO.GPS_LBS_2) {
      // MCC2 MNC1 LAC2 CELL3 ACC1
      return c[off + 8] === 1;
    }
    if (proto === PROTO.GPS_LBS_4G) {
      // MCC2 (bit15 → 2-byte MNC) MNC1|2 LAC4 CELL8 ACC1
      const mcc = c.readUInt16BE(off);
      const mncLen = mcc & 0x8000 ? 2 : 1;
      return c[off + 2 + mncLen + 4 + 8] === 1;
    }
  } catch {
    /* short packet: ACC not present */
  }
  return null; // 0x12 has no ACC byte
}

/**
 * Decode one frame. Returns
 *   { proto, serial, type: 'login'|'location'|'status'|'alarm'|'other', ... , reply?: Buffer }
 * or null if the CRC fails.
 */
export function decodeFrame(frame) {
  const short = frame[0] === 0x78;
  const headLen = short ? 3 : 4;
  const len = short ? frame[2] : frame.readUInt16BE(2);
  const crcGot = frame.readUInt16BE(headLen + len - 2);
  const crcWant = crc16x25(frame.subarray(2, headLen + len - 2));
  if (crcGot !== crcWant) return null;

  const proto = frame[headLen];
  const content = frame.subarray(headLen + 1, headLen + len - 4);
  const serial = frame.readUInt16BE(headLen + len - 4);
  const out = { proto, serial, type: "other" };

  if (proto === PROTO.LOGIN) {
    out.type = "login";
    out.imei = decodeImei(content);
    out.reply = buildReply(proto, serial);
  } else if (LOCATION_TYPES.has(proto)) {
    out.type = "location";
    const g = decodeGps(content, 0);
    Object.assign(out, g, { acc: readAcc(proto, content, g.next) });
    delete out.next;
  } else if (ALARM_TYPES.has(proto)) {
    out.type = "alarm";
    const g = decodeGps(content, 0);
    Object.assign(out, g, { acc: null });
    delete out.next;
    out.reply = buildReply(proto, serial);
  } else if (proto === PROTO.STATUS || proto === PROTO.STATUS_2) {
    out.type = "status";
    const info = content[0];
    out.acc = Boolean(info & 0x02);
    out.charging = Boolean(info & 0x04);
    out.voltageLevel = content.length > 1 ? content[1] : null;
    out.reply = buildReply(proto, serial);
  } else if (proto === PROTO.TIME_REQUEST) {
    const now = new Date();
    out.reply = buildReply(proto, serial, Buffer.from([
      now.getUTCFullYear() - 2000, now.getUTCMonth() + 1, now.getUTCDate(),
      now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds(),
    ]));
  }
  return out;
}

// ── Encoders, used by the fake tracker and the tests ────────────────────────

function frame(proto, content, serial) {
  const body = Buffer.alloc(1 + 1 + content.length + 2);
  body[0] = 1 + content.length + 2 + 2;
  body[1] = proto;
  content.copy(body, 2);
  body.writeUInt16BE(serial, 2 + content.length);
  const crc = Buffer.alloc(2);
  crc.writeUInt16BE(crc16x25(body));
  return Buffer.concat([Buffer.from([0x78, 0x78]), body, crc, Buffer.from([0x0d, 0x0a])]);
}

export function encodeLogin(imei, serial = 1) {
  return frame(PROTO.LOGIN, Buffer.from(imei.padStart(16, "0"), "hex"), serial);
}

export function encodeLocation({ latitude, longitude, speedKmh = 0, heading = 0, acc = true, time = new Date() }, serial = 2) {
  const c = Buffer.alloc(18 + 9 + 3);
  c[0] = time.getUTCFullYear() - 2000; c[1] = time.getUTCMonth() + 1; c[2] = time.getUTCDate();
  c[3] = time.getUTCHours(); c[4] = time.getUTCMinutes(); c[5] = time.getUTCSeconds();
  c[6] = 0xc9; // 12-byte GPS info, 9 satellites
  c.writeUInt32BE(Math.round(Math.abs(latitude) * 1800000), 7);
  c.writeUInt32BE(Math.round(Math.abs(longitude) * 1800000), 11);
  c[15] = Math.round(speedKmh);
  let flags = 0x1000 | (Math.round(heading) & 0x3ff);
  if (latitude >= 0) flags |= 0x0400;
  if (longitude < 0) flags |= 0x0800;
  c.writeUInt16BE(flags, 16);
  c.writeUInt16BE(635, 18); // MCC Rwanda
  c[20] = 10;               // MNC MTN
  c.writeUInt16BE(1, 21);   // LAC
  c.writeUIntBE(1, 23, 3);  // Cell ID
  c[26] = acc ? 1 : 0;      // ACC
  c[27] = 0; c[28] = 0; c[29] = 0; // upload mode, realtime, padding
  return frame(PROTO.GPS_LBS_2, c, serial);
}

export function encodeHeartbeat({ acc = true } = {}, serial = 3) {
  return frame(PROTO.STATUS, Buffer.from([acc ? 0x46 : 0x44, 0x06, 0x04, 0x00, 0x01]), serial);
}
