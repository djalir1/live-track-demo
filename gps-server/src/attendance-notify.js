// School attendance alerts (feat/school-attendance branch).
//
//   parent_notifications  → web push to that parent's phones
//   school_alerts         → web push to the school's admins (+ super admins)
//   check_open_trips()    → every minute: "child still on board 10 min after
//                           the engine stopped" becomes an urgent school alert
//
// Rows are written by the database functions in
// supabase/migrations/20261108120000_school_attendance.sql. Until that
// migration is applied, this module notices the missing tables and sleeps
// (one log line every 10 min) — it never touches the GPS socket path.
import { sendPush } from "./webpush.js";

const POLL_MS = 4000;
const CHECK_TRIPS_MS = 60_000;
const MISSING_RETRY_MS = 10 * 60_000;
const STALE_MS = 20 * 60_000; // after downtime, don't push old news

const isMissing = (err) =>
  err.status === 404 || /PGRST20[25]|does not exist|schema cache/.test(err.message);

export function createAttendanceNotifier({
  url,
  serviceKey,
  vapid,
  log = console.log,
  send = sendPush,
}) {
  const rest = `${url}/rest/v1`;
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };
  async function call(path, init = {}) {
    const res = await fetch(`${rest}/${path}`, {
      ...init,
      headers: { ...headers, ...init.headers },
    });
    if (!res.ok) {
      const err = new Error(`${init.method ?? "GET"} ${path} → ${res.status} ${await res.text()}`);
      err.status = res.status;
      throw err;
    }
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  /** Push one message to every device of these users. */
  async function pushTo(userIds, payload) {
    if (!userIds.length) return { sent: 0, devices: 0 };
    const subs = await call(
      `push_subscriptions?select=id,user_id,endpoint,p256dh,auth&user_id=in.(${userIds.join(",")})`,
    );
    let sent = 0;
    await Promise.all(
      subs.map(async (s) => {
        try {
          const r = await send(s, payload, vapid);
          if (r.ok) sent++;
          else if (r.gone) await call(`push_subscriptions?id=eq.${s.id}`, { method: "DELETE" });
          else log(`⚠️  attendance push ${r.status} for ${s.id}`);
        } catch (err) {
          log(`⚠️  attendance push failed for ${s.id}: ${err.message}`);
        }
      }),
    );
    return { sent, devices: subs.length };
  }

  async function schoolOwners(schoolId) {
    const roles = await call("user_roles?select=user_id,role&role=in.(admin,school_admin)");
    const admins = roles.filter((r) => r.role === "admin").map((r) => r.user_id);
    const sa = roles.filter((r) => r.role === "school_admin").map((r) => r.user_id);
    const mine = sa.length
      ? await call(`profiles?select=id&school_id=eq.${schoolId}&id=in.(${sa.join(",")})`)
      : [];
    return [...new Set([...admins, ...mine.map((p) => p.id)])];
  }

  const done = (table, id) =>
    call(`${table}?id=eq.${id}`, {
      method: "PATCH",
      body: JSON.stringify({ pushed_at: new Date().toISOString() }),
    });

  async function tickParents() {
    const rows = await call(
      "parent_notifications?select=*&pushed_at=is.null&order=id.asc&limit=50",
    );
    for (const n of rows) {
      const fresh = Date.now() - new Date(n.created_at).getTime() < STALE_MS;
      if (fresh)
        await pushTo([n.user_id], {
          title: n.title,
          body: n.body,
          url: n.url || "/family",
          tag: `${n.kind}-${n.student_id ?? n.id}`,
        });
      await done("parent_notifications", n.id);
    }
    return rows.length;
  }

  async function tickSchool() {
    const rows = await call("school_alerts?select=*&pushed_at=is.null&order=id.asc&limit=25");
    for (const a of rows) {
      const fresh = Date.now() - new Date(a.created_at).getTime() < STALE_MS;
      if (fresh) {
        const r = await pushTo(await schoolOwners(a.school_id), {
          title: a.severity === "urgent" ? "🚨 Safety alert" : "⚠️ School transport",
          body: a.message,
          url: "/admin/incidents",
          tag: `school-alert-${a.id}`,
        });
        log(`🛡️  school alert #${a.id} (${a.kind}) → ${r.sent}/${r.devices} device(s)`);
      }
      await done("school_alerts", a.id);
    }
  }

  let timer = null;
  let lastTripCheck = 0;
  let running = false;
  async function tick() {
    if (running) return;
    running = true;
    let wait = POLL_MS;
    try {
      if (Date.now() - lastTripCheck > CHECK_TRIPS_MS) {
        lastTripCheck = Date.now();
        const n = await call("rpc/check_open_trips", { method: "POST", body: "{}" });
        if (typeof n === "number" && n > 0)
          log(`🚨 ${n} child(ren) still marked on board after engine off`);
      }
      await tickParents();
      await tickSchool();
    } catch (err) {
      if (isMissing(err)) {
        log("ℹ️  attendance alerts idle: attendance migration not applied — retrying in 10 min");
        wait = MISSING_RETRY_MS;
      } else {
        log(`⚠️  attendance alerts: ${err.message}`);
        wait = 15_000;
      }
    } finally {
      running = false;
      timer = setTimeout(tick, wait);
      timer.unref?.();
    }
  }

  return {
    tick,
    start() {
      log("🎒 attendance alerts on (parents + schools)");
      void tick();
    },
    stop() {
      clearTimeout(timer);
    },
  };
}
