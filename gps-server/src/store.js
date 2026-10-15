// Writes decoded tracker positions into the same tables the phone tracker
// uses, so the dashboard, parent /me screen, history and the geofence
// trigger (AFTER INSERT on location_history) work unchanged.
//
//   IMEI → buses.gps_imei → buses.driver_user_id → device_status / location_history
//
// Talks to Supabase over plain REST with the service-role key (server only),
// so this process has zero npm dependencies.

const MOVING_KMH = 0.8; // same threshold as src/lib/parent-presence.ts
// Movement counts as "engine on": a GPS speed above this, or ≥25 m covered at
// an implied speed above it (some trackers report 0 km/h at walking pace).
const MOTION_KMH = 6;
// Engine counts as off after this long with no running signal (see below).
const ENGINE_OFF_AFTER_MS = 90_000;
// Two reports closer than this = the tracker's running rhythm (10 s, vs 5 min parked).
const FAST_REPORT_MS = 40_000;
const BUS_CACHE_MS = 60_000;
// Tamper watch. A parked tracker still checks in every 5 min (heartbeat every 3),
// so 30 min of silence means it lost power, was removed, or has no SIM credit.
const SILENT_AFTER_MS = 30 * 60_000;
// Trackers that were already dead long before are not news.
const SILENT_IGNORE_AFTER_MS = 6 * 3_600_000;
// After this server restarts, give trackers time to reconnect before judging.
const STARTUP_GRACE_MS = 10 * 60_000;
// One "unplugged" alert per incident, not one per repeated alarm packet.
const TAMPER_REPEAT_MS = 15 * 60_000;
// Reports in a row without vehicle power before calling it unplugged.
const POWER_OFF_CONFIRM = 3;

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
      // gps-<imei>@livetrack.app, or older hand-made ones like eloge.gps-tracker@livetrack.app
      trackerAccount.set(uid, /gps.*@livetrack\.app$/i.test((await res.json()).email ?? ""));
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

  // ── Per-bus running state (distance, trip session, engine) ───────────────
  //
  // Engine on/off is decided from several signals, because none is reliable
  // alone on cheap GT06 trackers:
  //   • ACC flag in heartbeats: arrives only every few minutes, flickers while
  //     the engine cranks, and on badly wired trackers reads "off" all drive.
  //   • Reporting rhythm: with TIMER,10,300 the tracker sends every 10 s while
  //     it considers the vehicle running and every 5 min parked. Two quick
  //     reports in a row = running, whatever the ACC flag says.
  //   • Movement: GPS speed, or distance covered between fixes.
  // "On" is immediate. "Off" needs ENGINE_OFF_AFTER_MS without any on-signal,
  // so cranking flicker, short stops in traffic and late heartbeats never end
  // a trip, and the trip's end time is the last moment it was seen running.
  const state = new Map(); // driver_user_id → running state

  function haversine(a, b) {
    const R = 6371000, r = (x) => (x * Math.PI) / 180;
    const dLat = r(b.latitude - a.latitude), dLon = r(b.longitude - a.longitude);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.latitude)) * Math.cos(r(b.latitude)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  // One tracker's messages are handled strictly in order (server.js), but the
  // off-timer runs on its own; this lock keeps both from racing on one bus.
  const locks = new Map();
  function withLock(uid, fn) {
    const prev = locks.get(uid) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    locks.set(uid, next.catch(() => {}));
    return next;
  }

  async function getState(uid) {
    if (!state.has(uid)) {
      let row = null;
      if (!dryRun) {
        const rows = await call(`device_status?select=*&user_id=eq.${uid}`).catch(() => []);
        row = rows?.[0] ?? null;
      }
      state.set(uid, {
        powerCutAt: row?.power_cut_at ? Date.parse(row.power_cut_at) : 0,
        silentSince: row?.silent_since ?? null,
        powerOffReports: 0,
        powerOnReports: 0,
        // Can this tracker's "on vehicle power" bit be believed? See notePower.
        powerBit: "unknown",
        lastTamperAt: 0,
        last: null,
        totalM: row?.total_distance_m ?? 0,
        tripOpen: null,
        acc: null,
        engine: row?.is_tracking ?? false,
        onAt: row?.is_tracking ? nowMs() : 0, // last moment we had evidence it runs
        arrivals: [], // receive times of the last position reports
        offTimer: null,
        lastSaved: null,
        lastSavedAt: 0,
      });
      // Restarted while a bus was running: let the off-timer settle it.
      if (row?.is_tracking) scheduleOffCheck(uid);
    }
    return state.get(uid);
  }

  async function ensureTrip(uid, open, atMs = nowMs()) {
    const s = state.get(uid);
    if (s.tripOpen === open) return;
    const at = new Date(atMs).toISOString();
    if (open) {
      const existing = await call(`trip_sessions?select=started_at&user_id=eq.${uid}&ended_at=is.null&limit=1`).catch(() => []);
      if (!existing?.length) {
        await call("trip_sessions", { method: "POST", body: JSON.stringify({ user_id: uid, started_at: at }) });
        s.totalM = 0; // km counter is per trip, like the phone tracker
        log(`🟢 trip started for ${uid}`);
      }
    } else {
      const closed = await call(`trip_sessions?user_id=eq.${uid}&ended_at=is.null`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ ended_at: at }),
      });
      if (closed?.length) log(`🔴 trip ended for ${uid}`);
    }
    s.tripOpen = open;
  }

  /** Some on-signal arrived: engine is running as of now. */
  async function engineEvidence(uid, why) {
    const s = state.get(uid);
    s.onAt = nowMs();
    scheduleOffCheck(uid);
    if (!s.engine) {
      s.engine = true;
      log(`🔑 engine on (${why})`);
    }
    await ensureTrip(uid, true);
  }

  function scheduleOffCheck(uid) {
    const s = state.get(uid);
    if (!s) return;
    clearTimeout(s.offTimer);
    s.offTimer = setTimeout(() => {
      withLock(uid, () => checkEngineOff(uid)).catch((e) => log(`💥 engine-off check: ${e.message}`));
    }, ENGINE_OFF_AFTER_MS + 1000);
    s.offTimer.unref?.();
  }

  async function checkEngineOff(uid) {
    const s = state.get(uid);
    if (!s?.engine) return;
    const quietMs = nowMs() - s.onAt;
    if (s.acc === true || quietMs < ENGINE_OFF_AFTER_MS) {
      scheduleOffCheck(uid); // still running (or not quiet long enough yet)
      return;
    }
    s.engine = false;
    log(`🅿️  engine off (no running signal for ${Math.round(quietMs / 1000)} s)`);
    await ensureTrip(uid, false, s.onAt);
    await patchStatus(uid, { status: "idle", speed_kmh: 0, is_tracking: false });
  }

  // device_status gained gps_fix / satellites (migration 20261015090000).
  // If that SQL hasn't been run yet, keep working without them.
  let extraColumns = true;
  async function writeStatus(uid, body, extra) {
    const send = (b) =>
      call("device_status", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(b),
      });
    if (!extraColumns) return send(body);
    try {
      return await send({ ...body, ...extra });
    } catch (e) {
      if (!/gps_fix|satellites|PGRST204|column/i.test(e.message)) throw e;
      extraColumns = false;
      log("⚠️  device_status has no gps_fix/satellites columns — run the 20261015090000 migration; continuing without them");
      return send(body);
    }
  }
  async function patchStatus(uid, body) {
    await call(`device_status?user_id=eq.${uid}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(body),
    });
  }

  /**
   * Note a position report; true when the tracker is in its fast (running)
   * rhythm. Uses the GPS timestamp when there is one, so a burst of buffered
   * old reports after a reconnect doesn't look like 10-second reporting.
   */
  function fastRhythm(s, t) {
    s.arrivals.push(t);
    if (s.arrivals.length > 3) s.arrivals.shift();
    if (s.arrivals.length < 3) return false;
    const [a, b, c] = s.arrivals;
    return b - a < FAST_REPORT_MS && c - b < FAST_REPORT_MS;
  }

  async function resolveBus(imei) {
    const bus = await findBus(imei);
    if (!bus) { log(`⚠️  unknown IMEI ${imei} — set buses.gps_imei in Dashboard → Vehicles`); return null; }
    if (!bus.driver_user_id) { log(`⚠️  bus ${bus.label ?? bus.id} has no driver assigned — position dropped`); return null; }
    return bus;
  }

  /** Save one position report. `fix.valid` false = tracker has no GPS lock yet. */
  async function savePosition(imei, fix) {
    const bus = await resolveBus(imei);
    if (!bus) return;
    const uid = bus.driver_user_id;
    await getState(uid);
    return withLock(uid, () => savePositionLocked(bus, uid, fix));
  }

  async function savePositionLocked(bus, uid, fix) {
    const s = state.get(uid);
    const now = nowMs();
    if (fix.acc != null) s.acc = fix.acc;
    await markAlive(bus, uid);
    const name = bus.label ?? bus.plate ?? bus.id;

    // Running signals.
    if (fix.acc === true) await engineEvidence(uid, "ignition flag");
    if (fastRhythm(s, fix.valid ? fix.deviceTime.getTime() : now)) await engineEvidence(uid, "reporting every 10 s");

    // No GPS lock yet (just powered up, garage, tunnel): the tracker is alive,
    // so keep it online and say so, but don't move the vehicle or log history.
    if (!fix.valid) {
      await writeStatus(
        uid,
        {
          user_id: uid,
          status: s.engine ? "stopped" : "idle",
          speed_kmh: 0,
          is_tracking: s.engine,
          ...(s.battery != null ? { battery_level: s.battery } : {}),
          last_seen: new Date(now).toISOString(),
        },
        { gps_fix: false, satellites: fix.satellites ?? null },
      );
      log(`🛰️  ${name} searching for GPS (${fix.satellites} satellites) engine=${s.engine ? "on" : "off"}`);
      return;
    }
    learnClock(fix.deviceTime);

    // Movement since the previous fix (device clock; both from the same tracker).
    let impliedKmh = 0;
    if (s.last) {
      const d = haversine(s.last, fix);
      const dtH = (fix.deviceTime - s.last.deviceTime) / 3_600_000;
      if (d >= 25 && dtH > 0) impliedKmh = d / 1000 / dtH;
      if (impliedKmh > 160) impliedKmh = 0; // GPS jump, not driving
    }
    const speedKmh = fix.speedKmh > 0 ? fix.speedKmh : Math.round(impliedKmh);
    if (speedKmh > MOTION_KMH) await engineEvidence(uid, "moving");

    const engineOn = s.engine;
    if (s.last && engineOn) {
      const d = haversine(s.last, fix);
      if (d > 3 && d < 5000) s.totalM += d; // ignore parked jitter and GPS jumps
    }
    s.last = fix;

    // Device clock can be on local time or drift; trust it only if close to now.
    const recordedAt = Math.abs(fix.deviceTime.getTime() - now) < 10 * 60_000 ? fix.deviceTime : new Date(now);
    const status = !engineOn ? "idle" : speedKmh > MOVING_KMH ? "moving" : "stopped";

    await writeStatus(
      uid,
      {
        user_id: uid,
        status,
        latitude: fix.latitude,
        longitude: fix.longitude,
        speed_kmh: speedKmh,
        heading: fix.heading,
        accuracy: null,
        is_tracking: engineOn,
        ...(s.battery != null ? { battery_level: s.battery } : {}),
        total_distance_m: Math.round(s.totalM),
        last_seen: new Date(now).toISOString(),
      },
      { gps_fix: true, satellites: fix.satellites ?? null },
    );
    // Parked (engine off) and not moved: one history row per 30 min is
    // plenty — device_status above already says it's alive. Saves ~250
    // identical rows per vehicle per night.
    const parkedRepeat =
      !engineOn && s.lastSaved && haversine(s.lastSaved, fix) < 30 && now - s.lastSavedAt < 30 * 60_000;
    if (!parkedRepeat) {
      await call("location_history", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          user_id: uid,
          latitude: fix.latitude,
          longitude: fix.longitude,
          speed_kmh: speedKmh,
          ...(s.battery != null ? { battery_level: s.battery } : {}),
          recorded_at: recordedAt.toISOString(),
        }),
      });
      s.lastSaved = fix;
      s.lastSavedAt = now;
    }
    const accNote = s.acc === false && engineOn ? " (ACC wire says off)" : "";
    log(`📍 ${name} ${fix.latitude.toFixed(6)},${fix.longitude.toFixed(6)} ${speedKmh} km/h engine=${engineOn ? "on" : "off"}${accNote} → ${status}`);
  }

  // GT06 voltage level 0–6 → rough percent of the tracker's backup battery.
  const BATTERY_PCT = [0, 5, 15, 30, 60, 80, 100];

  /** Heartbeat: keeps the tracker online; its ACC flag is one engine signal. */
  async function saveHeartbeat(imei, acc, voltageLevel, charging = null) {
    const bus = await findBus(imei);
    if (!bus?.driver_user_id) return;
    const uid = bus.driver_user_id;
    await getState(uid);
    return withLock(uid, async () => {
      const s = state.get(uid);
      await markAlive(bus, uid);
      if (charging != null) await notePower(bus, uid, charging, acc);
      s.acc = acc;
      if (voltageLevel != null && voltageLevel <= 6) s.battery = BATTERY_PCT[voltageLevel];
      if (acc) await engineEvidence(uid, "ignition flag");
      // "off" is never acted on directly: the off-timer decides (see above).
      else if (s.engine) scheduleOffCheck(uid);
      await patchStatus(uid, {
        last_seen: nowIso(),
        is_tracking: s.engine,
        ...(s.battery != null ? { battery_level: s.battery } : {}),
        ...(s.engine ? {} : { status: "idle", speed_kmh: 0 }),
      });
    });
  }

  // ── Tamper watch: unplugged, removed, or silent trackers ─────────────────
  //
  //   • Alarm packet "power cut" / "removed" / "switched off" / "SIM changed":
  //     the tracker says so itself, on its backup battery → alert at once.
  //   • Vehicle-power bit off in POWER_OFF_CONFIRM reports in a row → alert,
  //     but only on a tracker that has proven the bit works (see notePower).
  //     Many GT06 clones set it only while the backup battery is *charging*,
  //     so a full battery reads "unplugged" (a false alarm on the Test Car).
  //   • No report for SILENT_AFTER_MS (backup battery dead, wrapped in foil,
  //     SIM pulled) → alert. Any report afterwards → "back" alert.
  // State lives in device_status.power_cut_at / silent_since, so a restart
  // doesn't repeat alerts and the dashboard shows the same thing.
  let tamperColumns = true;
  async function patchTamper(uid, body) {
    if (!tamperColumns || dryRun) return;
    try {
      await patchStatus(uid, body);
    } catch (e) {
      if (!/power_cut_at|silent_since|PGRST204|column/i.test(e.message)) throw e;
      tamperColumns = false;
      log("⚠️  device_status has no power_cut_at/silent_since — run migration 20261016090000 for tamper alerts");
    }
  }

  async function fleetEvent(bus, kind, detail, at = nowIso()) {
    const row = {
      kind,
      school_id: bus.school_id,
      bus_id: bus.id,
      driver_user_id: bus.driver_user_id,
      vehicle_label: bus.label,
      plate: bus.plate,
      driver_name: bus.gps_driver_name,
      detail,
      occurred_at: at,
    };
    log(`🚨 ${bus.label ?? bus.plate ?? bus.id}: ${kind} ${detail}`);
    if (dryRun) return;
    await call("fleet_events", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(row) })
      .catch((e) => log(`⚠️  tamper alert not saved (run migration 20261016090000?): ${e.message}`));
  }

  /** Any report from the tracker: it's alive. Ends a "silent" incident. */
  async function markAlive(bus, uid) {
    const s = state.get(uid);
    if (!s.silentSince) return;
    const since = s.silentSince;
    s.silentSince = null;
    await patchTamper(uid, { silent_since: null });
    const mins = Math.round((nowMs() - Date.parse(since)) / 60_000);
    await fleetEvent(bus, "gps_back", `GPS tracker reporting again after ${mins} min of silence`);
  }

  async function raiseTamper(bus, uid, detail) {
    const s = state.get(uid);
    const now = nowMs();
    if (now - s.lastTamperAt < TAMPER_REPEAT_MS) return;
    s.lastTamperAt = now;
    if (!s.powerCutAt) {
      s.powerCutAt = now;
      await patchTamper(uid, { power_cut_at: new Date(now).toISOString() });
    }
    await fleetEvent(bus, "gps_tamper", detail);
  }

  async function powerBack(bus, uid, why) {
    const s = state.get(uid);
    if (!s.powerCutAt) return;
    s.powerCutAt = 0;
    s.powerOnReports = 0;
    s.lastTamperAt = 0;
    await patchTamper(uid, { power_cut_at: null });
    await fleetEvent(bus, "gps_back", why);
  }

  /**
   * The "on vehicle power" bit from a heartbeat or alarm packet, with the ACC
   * (ignition wire) flag of the same report.
   *
   * The bit is only acted on once the tracker has proven it means "plugged
   * in": POWER_OFF_CONFIRM "vehicle" reports in a row. "Battery" while the
   * ignition wire reads ON proves the opposite: the harness is connected, so
   * the bit is lying (it means "charging") and is ignored from then on.
   */
  async function notePower(bus, uid, onPower, acc = null) {
    const s = state.get(uid);
    // Ignition wire live = the tracker's harness is plugged into the vehicle.
    if (acc === true) await powerBack(bus, uid, "GPS tracker is connected to the vehicle again (ignition on)");
    if (!onPower && acc === true && s.powerBit !== "unreliable") {
      s.powerBit = "unreliable";
      log(`ℹ️  ${bus.label ?? bus.id}: power bit says "battery" with ignition on, so it means "charging" on this tracker; ignoring it (alarms and the 30-min silence check still work)`);
    }
    if (onPower) {
      s.powerOffReports = 0;
      if (s.powerBit === "unknown" && ++s.powerOnReports >= POWER_OFF_CONFIRM) {
        s.powerBit = "trusted";
        s.powerOnReports = 0;
      } else if (s.powerBit === "trusted" && s.powerCutAt && ++s.powerOnReports >= POWER_OFF_CONFIRM) {
        await powerBack(bus, uid, "GPS tracker is on the vehicle's power again");
      }
      return;
    }
    s.powerOnReports = 0;
    if (s.powerBit !== "trusted") return;
    if (++s.powerOffReports >= POWER_OFF_CONFIRM && !s.powerCutAt) {
      await raiseTamper(bus, uid, "GPS tracker unplugged: lost the vehicle's power");
    }
  }

  const ALARM_TEXT = {
    0x02: "GPS tracker unplugged: lost the vehicle's power",
    0x13: "GPS tracker removed from where it was mounted",
    0x11: "GPS tracker is being switched off",
    0x10: "GPS tracker's SIM card was changed",
  };

  /** Alarm packet: position (if any) plus tamper alarms. */
  async function saveAlarm(imei, msg) {
    const bus = await resolveBus(imei);
    if (!bus) return;
    const uid = bus.driver_user_id;
    await getState(uid);
    if (msg.valid) await withLock(uid, () => savePositionLocked(bus, uid, msg));
    return withLock(uid, async () => {
      await markAlive(bus, uid);
      const text = ALARM_TEXT[msg.alarm];
      log(`🔔 alarm 0x${(msg.alarm ?? 0).toString(16)} from ${bus.label ?? imei}${text ? ` (${text})` : ""}`);
      if (text) await raiseTamper(bus, uid, text);
      else if (msg.charging != null) await notePower(bus, uid, msg.charging, msg.acc);
    });
  }

  const kigaliTime = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Kigali", hour: "2-digit", minute: "2-digit" });
  const startedAt = Date.now();
  async function checkSilent() {
    if (dryRun || !tamperColumns || Date.now() - startedAt < STARTUP_GRACE_MS) return;
    if (Date.now() - busCacheAt > BUS_CACHE_MS) await refreshBuses();
    const buses = [...busCache.values()].filter((b) => b.driver_user_id);
    if (!buses.length) return;
    const rows = await call(`device_status?select=*&user_id=in.(${buses.map((b) => b.driver_user_id).join(",")})`);
    const now = nowMs();
    for (const row of rows) {
      const bus = buses.find((b) => b.driver_user_id === row.user_id);
      const age = now - Date.parse(row.last_seen);
      if (!("silent_since" in row)) { tamperColumns = false; return; }
      if (row.silent_since || age < SILENT_AFTER_MS || age > SILENT_IGNORE_AFTER_MS) continue;
      await getState(row.user_id);
      await withLock(row.user_id, async () => {
        const s = state.get(row.user_id);
        if (s.silentSince) return;
        s.silentSince = row.last_seen;
        await patchTamper(row.user_id, { silent_since: row.last_seen });
        await fleetEvent(bus, "gps_offline", kigaliTime.format(new Date(row.last_seen)));
      });
    }
  }
  if (!dryRun) setInterval(() => checkSilent().catch((e) => log(`⚠️  silent check: ${e.message}`)), 60_000).unref();

  return { savePosition, saveHeartbeat, saveAlarm };
}
