// Writes decoded tracker positions into the same tables the phone tracker
// uses, so the dashboard, parent /me screen, history and the geofence
// trigger (AFTER INSERT on location_history) work unchanged.
//
//   IMEI → buses.gps_imei → buses.driver_user_id → device_status / location_history
//
// Talks to Supabase over plain REST with the service-role key (server only),
// so this process has zero npm dependencies.

const MOVING_KMH = 0.8; // same threshold as src/lib/parent-presence.ts
const BUS_CACHE_MS = 60_000;

export function createStore({ url, serviceKey, dryRun = false, log = console.log }) {
  const rest = `${url}/rest/v1`;
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };

  async function call(path, init = {}) {
    if (dryRun && init.method && init.method !== "GET") {
      log(`[dry-run] ${init.method} ${path} ${init.body ?? ""}`);
      return null;
    }
    const res = await fetch(`${rest}/${path}`, { ...init, headers: { ...headers, ...init.headers } });
    if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} → ${res.status} ${await res.text()}`);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  // ── Clock: trust GPS satellite time over the host clock ──────────────────
  // A host with the wrong timezone (local time labelled as UTC) would stamp
  // every row hours off. GPS fixes carry true UTC, so learn the host's offset
  // from them, rounded to 15 min (timezone-sized) so a delayed/buffered fix
  // can't skew it.
  let clockOffsetMs = 0;
  const nowMs = () => Date.now() + clockOffsetMs;
  const nowIso = () => new Date(nowMs()).toISOString();
  function learnClock(deviceTime) {
    const t = deviceTime.getTime();
    if (!Number.isFinite(t) || deviceTime.getUTCFullYear() < 2024) return;
    const off = Math.round((t - Date.now()) / 900_000) * 900_000;
    if (off !== clockOffsetMs) {
      clockOffsetMs = off;
      log(`🕒 host clock is ${-off / 60_000} min off GPS time — correcting timestamps`);
    }
  }

  // ── IMEI → bus lookup (cached) ────────────────────────────────────────────
  let busCache = new Map();
  let busCacheAt = 0;
  async function refreshBuses() {
    const rows = await call("buses?select=id,school_id,label,plate,gps_imei,gps_driver_name,driver_user_id&gps_imei=not.is.null");
    busCache = new Map(rows.map((r) => [r.gps_imei, r]));
    busCacheAt = Date.now();
    if (!dryRun) await syncTrackerProfiles(rows).catch((e) => log(`⚠️  driver profile sync: ${e.message}`));
  }

  // Admins edit the driver name / vehicle name / plate on the bus row, but the
  // dashboard reads them from the driver's profile, which admins can't write.
  // Copy them onto tracker-driver accounts (never onto a real person's account).
  const trackerAccount = new Map(); // uid → boolean
  async function isTrackerAccount(uid) {
    if (!trackerAccount.has(uid)) {
      const res = await fetch(`${url}/auth/v1/admin/users/${uid}`, { headers });
      if (!res.ok) return false;
      trackerAccount.set(uid, /^gps-\d{15}@livetrack\.app$/.test((await res.json()).email ?? ""));
    }
    return trackerAccount.get(uid);
  }
  async function syncTrackerProfiles(rows) {
    const linked = rows.filter((b) => b.driver_user_id);
    if (!linked.length) return;
    const profiles = await call(`profiles?select=id,display_name,vehicle_name,plate_number&id=in.(${linked.map((b) => b.driver_user_id).join(",")})`);
    const byId = new Map(profiles.map((p) => [p.id, p]));
    for (const b of linked) {
      const p = byId.get(b.driver_user_id);
      if (!p) continue;
      const want = {
        display_name: b.gps_driver_name?.trim() || p.display_name,
        vehicle_name: b.label ?? p.vehicle_name,
        plate_number: b.plate ?? p.plate_number,
      };
      if (want.display_name === p.display_name && want.vehicle_name === p.vehicle_name && want.plate_number === p.plate_number) continue;
      if (!(await isTrackerAccount(b.driver_user_id))) continue;
      await call(`profiles?id=eq.${b.driver_user_id}`, { method: "PATCH", body: JSON.stringify(want) });
      log(`✏️  synced tracker driver "${want.display_name}" for ${b.label ?? b.plate ?? b.id}`);
    }
  }
  // Keep names in sync even while the tracker is offline.
  if (!dryRun) setInterval(() => refreshBuses().catch((e) => log(`⚠️  bus refresh: ${e.message}`)), BUS_CACHE_MS).unref();
  async function findBus(imei) {
    if (Date.now() - busCacheAt > BUS_CACHE_MS || !busCache.has(imei)) {
      if (dryRun && !url) return { id: "dry-run-bus", label: "Dry-run bus", driver_user_id: "dry-run-driver" };
      await refreshBuses();
    }
    const bus = busCache.get(imei) ?? null;
    if (bus && !bus.driver_user_id && !dryRun) bus.driver_user_id = await createTrackerDriver(bus);
    return bus;
  }

  // A bus with a tracker but no driver app gets a "tracker driver" account, so
  // the tracker shows up everywhere exactly like a driver's phone. Nobody logs
  // in with it (random password).
  async function createTrackerDriver(bus) {
    const name = bus.gps_driver_name?.trim() || `${bus.label ?? bus.plate ?? "Bus"} (GPS)`;
    const email = `gps-${bus.gps_imei}@livetrack.app`;
    const authRes = await fetch(`${url}/auth/v1/admin/users`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        email,
        password: crypto.randomUUID() + crypto.randomUUID(),
        email_confirm: true,
        user_metadata: { display_name: name, vehicle_name: bus.label ?? "Bus" },
      }),
    });
    let uid;
    if (authRes.ok) {
      uid = (await authRes.json()).id;
    } else {
      // Already created on an earlier run (e.g. driver later unassigned): reuse it.
      const list = await fetch(`${url}/auth/v1/admin/users?per_page=1000`, { headers }).then((r) => r.json());
      uid = list.users?.find((u) => u.email === email)?.id;
      if (!uid) throw new Error(`could not create tracker driver: ${await authRes.text()}`);
    }
    await call(`profiles?id=eq.${uid}`, {
      method: "PATCH",
      body: JSON.stringify({ display_name: name, school_id: bus.school_id, plate_number: bus.plate, vehicle_name: bus.label, vehicle_type: "bus" }),
    });
    // Record the name on the bus too: the Vehicles page edits it there, and a
    // bus with gps_driver_name set marks its driver as a tracker account.
    await call(`buses?id=eq.${bus.id}`, { method: "PATCH", body: JSON.stringify({ driver_user_id: uid, gps_driver_name: name }) });
    bus.gps_driver_name = name;
    log(`👤 created tracker driver "${name}" for ${bus.label ?? bus.id}`);
    return uid;
  }

  // ── Per-bus running state (distance, trip session) ────────────────────────
  const state = new Map(); // driver_user_id → { last, totalM, tripOpen }

  function haversine(a, b) {
    const R = 6371000, r = (x) => (x * Math.PI) / 180;
    const dLat = r(b.latitude - a.latitude), dLon = r(b.longitude - a.longitude);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.latitude)) * Math.cos(r(b.latitude)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  async function getState(uid) {
    if (!state.has(uid)) {
      let totalM = 0;
      if (!dryRun) {
        const rows = await call(`device_status?select=total_distance_m&user_id=eq.${uid}`).catch(() => []);
        totalM = rows?.[0]?.total_distance_m ?? 0;
      }
      state.set(uid, { last: null, totalM, tripOpen: null, acc: null });
    }
    return state.get(uid);
  }

  async function ensureTrip(uid, open) {
    const s = state.get(uid);
    if (s.tripOpen === open) return;
    if (open) {
      const existing = await call(`trip_sessions?select=started_at&user_id=eq.${uid}&ended_at=is.null&limit=1`).catch(() => []);
      if (!existing?.length) {
        await call("trip_sessions", { method: "POST", body: JSON.stringify({ user_id: uid, started_at: nowIso() }) });
        s.totalM = 0; // km counter is per trip, like the phone tracker
        log(`🟢 trip started for ${uid}`);
      }
    } else {
      await call(`trip_sessions?user_id=eq.${uid}&ended_at=is.null`, {
        method: "PATCH",
        body: JSON.stringify({ ended_at: nowIso() }),
      });
      log(`🔴 trip ended for ${uid}`);
    }
    s.tripOpen = open;
  }

  /** Save one position fix. `acc` = ignition, null when the packet has none. */
  async function savePosition(imei, fix) {
    const bus = await findBus(imei);
    if (!bus) { log(`⚠️  unknown IMEI ${imei} — set buses.gps_imei in Dashboard → Vehicles`); return; }
    const uid = bus.driver_user_id;
    if (!uid) { log(`⚠️  bus ${bus.label ?? bus.id} has no driver assigned — position dropped`); return; }

    if (fix.valid) learnClock(fix.deviceTime);
    const s = await getState(uid);
    if (fix.acc != null) s.acc = fix.acc;
    const ignitionOn = s.acc ?? true; // no ACC info → assume running

    await ensureTrip(uid, ignitionOn);
    if (s.last && ignitionOn) {
      const d = haversine(s.last, fix);
      if (d > 3 && d < 5000) s.totalM += d; // ignore parked jitter and GPS jumps
    }
    s.last = fix;

    // Device clock can be on local time or drift; trust it only if close to now.
    const now = nowMs();
    const recordedAt = Math.abs(fix.deviceTime.getTime() - now) < 10 * 60_000 ? fix.deviceTime : new Date(now);
    const status = !ignitionOn ? "idle" : fix.speedKmh > MOVING_KMH ? "moving" : "stopped";

    await call("device_status", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        user_id: uid,
        status,
        latitude: fix.latitude,
        longitude: fix.longitude,
        speed_kmh: fix.speedKmh,
        heading: fix.heading,
        accuracy: null,
        is_tracking: ignitionOn,
        ...(s.battery != null ? { battery_level: s.battery } : {}),
        total_distance_m: Math.round(s.totalM),
        last_seen: new Date(now).toISOString(),
      }),
    });
    await call("location_history", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        user_id: uid,
        latitude: fix.latitude,
        longitude: fix.longitude,
        speed_kmh: fix.speedKmh,
        ...(s.battery != null ? { battery_level: s.battery } : {}),
        recorded_at: recordedAt.toISOString(),
      }),
    });
    log(`📍 ${bus.label ?? bus.plate ?? bus.id} ${fix.latitude.toFixed(6)},${fix.longitude.toFixed(6)} ${fix.speedKmh} km/h acc=${ignitionOn ? "on" : "off"} → ${status}`);
  }

  /** Heartbeat with ACC info: keeps last_seen fresh and opens/closes trips. */
  // GT06 voltage level 0–6 → rough percent of the tracker's backup battery.
  const BATTERY_PCT = [0, 5, 15, 30, 60, 80, 100];

  async function saveHeartbeat(imei, acc, voltageLevel) {
    const bus = await findBus(imei);
    if (!bus?.driver_user_id) return;
    const uid = bus.driver_user_id;
    const s = await getState(uid);
    s.acc = acc;
    if (voltageLevel != null && voltageLevel <= 6) s.battery = BATTERY_PCT[voltageLevel];
    await ensureTrip(uid, acc);
    await call(`device_status?user_id=eq.${uid}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ last_seen: nowIso(), is_tracking: acc, ...(s.battery != null ? { battery_level: s.battery } : {}), ...(acc ? {} : { status: "idle", speed_kmh: 0 }) }),
    });
  }

  return { savePosition, saveHeartbeat };
}
