// Trip alerts: turns new fleet_events rows (written by a DB trigger when a
// vehicle's engine goes on / off) into phone notifications for the owners —
// every admin, plus school_admins of the bus's school — on each device they
// allowed notifications on, respecting their on/off settings.
//
// Needs migration 20261015120000_trip_notifications.sql and VAPID keys in .env.
import { sendPush } from "./webpush.js";

const POLL_MS = 4000;
const MISSING_TABLE_RETRY_MS = 5 * 60_000;
// After downtime, don't wake owners up with alerts about old trips.
const STALE_MS = 20 * 60_000;

const kigali = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Kigali", hour: "2-digit", minute: "2-digit" });
const hhmm = (iso) => kigali.format(new Date(iso));
const kigaliHour = (iso) => Number(hhmm(iso).slice(0, 2));

function fmtDuration(ms) {
  const min = Math.max(1, Math.round(ms / 60_000));
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")} min`;
}

/** Title / body / link for one event, as the phone shows it. */
export function messageFor(e) {
  const name = e.vehicle_label?.trim() || e.plate?.trim() || "Vehicle";
  const vehicle = e.plate && e.vehicle_label && e.plate !== e.vehicle_label ? `${name} (${e.plate})` : name;
  const driver = e.driver_name?.trim() ? `Driver: ${e.driver_name.trim()}` : "No driver set";
  if (e.kind === "test") {
    return { title: "Live Track alerts are on", body: "This phone will get a notification when a vehicle starts a trip or parks.", url: "/admin/alerts" };
  }
  // A bus on a route is doing the morning pickup or the afternoon drop-off,
  // told apart by when the trip started (Kigali time).
  const run = e.route_name?.trim()
    ? kigaliHour(e.trip_started_at ?? e.occurred_at) < 12 ? "morning pickup" : "afternoon drop-off"
    : null;
  const route = run ? `Route: ${e.route_name.trim()} · ` : "";
  if (e.kind === "trip_started") {
    return {
      title: run ? `🚌 ${vehicle} started the ${run}` : `🚌 ${vehicle} started a trip`,
      body: `${route}${driver} · engine on at ${hhmm(e.occurred_at)}`,
      url: "/dashboard",
    };
  }
  const parts = [`${route}${driver} · parked, engine off at ${hhmm(e.occurred_at)}`];
  const facts = [];
  if (e.trip_started_at) facts.push(`trip ${fmtDuration(new Date(e.occurred_at) - new Date(e.trip_started_at))}`);
  if (e.distance_m > 0) facts.push(`${(e.distance_m / 1000).toFixed(1)} km`);
  if (facts.length) parts.push(facts.join(", "));
  return {
    title: run ? `🅿️ ${vehicle} finished the ${run}` : `🅿️ ${vehicle} is parked`,
    body: parts.join(" · "),
    url: "/history",
  };
}

export function createNotifier({ url, serviceKey, vapid, log = console.log }) {
  const rest = `${url}/rest/v1`;
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
  async function call(path, init = {}) {
    const res = await fetch(`${rest}/${path}`, { ...init, headers: { ...headers, ...init.headers } });
    if (!res.ok) {
      const err = new Error(`${init.method ?? "GET"} ${path} → ${res.status} ${await res.text()}`);
      err.status = res.status;
      throw err;
    }
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  /** User ids that own this event (before preferences). */
  async function ownersOf(e) {
    if (e.target_user_id) return [e.target_user_id];
    const roles = await call("user_roles?select=user_id,role&role=in.(admin,school_admin)");
    const admins = roles.filter((r) => r.role === "admin").map((r) => r.user_id);
    const schoolAdmins = roles.filter((r) => r.role === "school_admin").map((r) => r.user_id);
    let mine = [];
    if (e.school_id && schoolAdmins.length) {
      const profiles = await call(`profiles?select=id&school_id=eq.${e.school_id}&id=in.(${schoolAdmins.join(",")})`);
      mine = profiles.map((p) => p.id);
    }
    return [...new Set([...admins, ...mine])];
  }

  async function deliver(e) {
    const owners = await ownersOf(e);
    if (!owners.length) return 0;
    const list = owners.join(",");
    const [subs, prefs] = await Promise.all([
      call(`push_subscriptions?select=id,user_id,endpoint,p256dh,auth&user_id=in.(${list})`),
      call(`notification_prefs?select=user_id,trip_started,trip_ended&user_id=in.(${list})`),
    ]);
    const prefOf = new Map(prefs.map((p) => [p.user_id, p]));
    const wanted = subs.filter((s) => e.kind === "test" || prefOf.get(s.user_id)?.[e.kind] !== false);
    const msg = messageFor(e);
    const payload = { ...msg, tag: `${e.kind}-${e.driver_user_id ?? e.id}`, eventId: e.id };
    let sent = 0;
    await Promise.all(
      wanted.map(async (s) => {
        try {
          const r = await sendPush(s, payload, vapid);
          if (r.ok) {
            sent++;
            await call(`push_subscriptions?id=eq.${s.id}`, { method: "PATCH", body: JSON.stringify({ last_ok_at: new Date().toISOString() }) });
          } else if (r.gone) {
            await call(`push_subscriptions?id=eq.${s.id}`, { method: "DELETE" });
            log(`🔕 removed expired push subscription ${s.id}`);
          } else {
            log(`⚠️  push ${r.status} for subscription ${s.id}: ${r.text.slice(0, 200)}`);
          }
        } catch (err) {
          log(`⚠️  push failed for subscription ${s.id}: ${err.message}`);
        }
      }),
    );
    return { sent, devices: wanted.length, msg };
  }

  let timer = null;
  let running = false;
  async function tick() {
    if (running) return;
    running = true;
    let wait = POLL_MS;
    try {
      const events = await call("fleet_events?select=*&pushed_at=is.null&order=id.asc&limit=25");
      for (const e of events) {
        const stale = Date.now() - new Date(e.created_at).getTime() > STALE_MS;
        let note = "skipped (old)";
        if (!stale) {
          const r = await deliver(e);
          note = r ? `→ ${r.sent}/${r.devices} device(s): ${r.msg.title}` : "→ no owners";
        }
        await call(`fleet_events?id=eq.${e.id}`, { method: "PATCH", body: JSON.stringify({ pushed_at: new Date().toISOString() }) });
        log(`🔔 ${e.kind} #${e.id} ${note}`);
      }
    } catch (err) {
      if (err.status === 404 || /PGRST205|fleet_events/.test(err.message)) {
        log("⚠️  trip alerts off: run supabase/migrations/20261015120000_trip_notifications.sql — retrying in 5 min");
        wait = MISSING_TABLE_RETRY_MS;
      } else {
        log(`⚠️  trip alerts: ${err.message}`);
        wait = 15_000;
      }
    } finally {
      running = false;
      timer = setTimeout(tick, wait);
      timer.unref?.();
    }
  }

  return {
    start() {
      log("🔔 trip alerts on (web push)");
      tick();
    },
    stop() {
      clearTimeout(timer);
    },
  };
}
