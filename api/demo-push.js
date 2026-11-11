// Vercel serverless function: /api/demo-push   (DEMO project only)
//
// In production, phone notifications are sent by gps-server. The demo has no
// GPS server, so this function does that one job: it sends every waiting
// parent notification and school alert as a web push.
//
//   database trigger (pg_net) ──POST──▶ /api/demo-push ──web push──▶ phones
//   the app, on load          ──GET───▶ /api/demo-push            (fallback)
//   push sign-up              ──GET───▶ /api/demo-push?key=1  → { publicKey }
//
// It configures itself: the VAPID key pair is created on first use and kept
// in demo_config (service role only), together with this site's address so
// the database knows where to call. On any database without demo_config
// (production) it does nothing.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (server only).
import { createClient } from "@supabase/supabase-js";
import { generateVapidKeys, sendPush } from "./_webpush.js";

const STALE_MS = 20 * 60_000; // never push old news
const SUBJECT = "mailto:demo@livetrack.app";

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return json(res, 500, { error: "Server is not configured" });
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    let { data: cfg, error } = await sb
      .from("demo_config")
      .select("site_url, vapid_public, vapid_private")
      .eq("id", 1)
      .maybeSingle();
    if (error || !cfg) return json(res, 404, { error: "Not a seeded demo database" });

    if (!cfg.vapid_public || !cfg.vapid_private) {
      const k = generateVapidKeys();
      await sb
        .from("demo_config")
        .update({ vapid_public: k.publicKey, vapid_private: k.privateKey })
        .eq("id", 1)
        .is("vapid_public", null);
      ({ data: cfg } = await sb
        .from("demo_config")
        .select("site_url, vapid_public, vapid_private")
        .eq("id", 1)
        .single());
    }

    // Tell the database where this site lives (production deployment only).
    const host =
      process.env.VERCEL_PROJECT_PRODUCTION_URL ||
      req.headers["x-forwarded-host"] ||
      req.headers.host;
    const site = host && !/^(localhost|127\.|\[::1\])/.test(host) ? `https://${host}` : null;
    if (site && process.env.VERCEL_ENV !== "preview" && cfg.site_url !== site) {
      await sb.from("demo_config").update({ site_url: site }).eq("id", 1);
    }

    const query = new URL(req.url, "http://x").searchParams;
    if (query.has("key")) return json(res, 200, { publicKey: cfg.vapid_public });

    const vapid = { publicKey: cfg.vapid_public, privateKey: cfg.vapid_private, subject: SUBJECT };
    const now = () => new Date().toISOString();
    const fresh = (row) => Date.now() - new Date(row.created_at).getTime() < STALE_MS;
    let sent = 0;
    let devices = 0;

    async function pushTo(userIds, payload) {
      if (!userIds.length) return;
      const { data: subs } = await sb
        .from("push_subscriptions")
        .select("id, endpoint, p256dh, auth")
        .in("user_id", userIds);
      devices += subs?.length ?? 0;
      await Promise.all(
        (subs ?? []).map(async (s) => {
          try {
            const r = await sendPush(s, payload, vapid);
            if (r.ok) {
              sent++;
              await sb.from("push_subscriptions").update({ last_ok_at: now() }).eq("id", s.id);
            } else if (r.gone) {
              await sb.from("push_subscriptions").delete().eq("id", s.id);
            } else {
              await sb
                .from("push_subscriptions")
                .update({ last_error: `${r.status} ${r.text}`.slice(0, 300), last_error_at: now() })
                .eq("id", s.id);
            }
          } catch (err) {
            await sb
              .from("push_subscriptions")
              .update({ last_error: String(err.message).slice(0, 300), last_error_at: now() })
              .eq("id", s.id);
          }
        }),
      );
    }

    // Claim the waiting rows first (so two calls at once never send twice).
    const { data: notes } = await sb
      .from("parent_notifications")
      .update({ pushed_at: now() })
      .is("pushed_at", null)
      .select("*");
    for (const n of (notes ?? []).filter(fresh).sort((a, b) => a.id - b.id)) {
      await pushTo([n.user_id], {
        title: n.title,
        body: n.body,
        url: n.url || "/family",
        tag: `${n.kind}-${n.student_id ?? n.id}`,
      });
    }

    const { data: alerts } = await sb
      .from("school_alerts")
      .update({ pushed_at: now() })
      .is("pushed_at", null)
      .select("*");
    for (const a of (alerts ?? []).filter(fresh)) {
      const { data: roles } = await sb
        .from("user_roles")
        .select("user_id, role")
        .in("role", ["admin", "school_admin"]);
      const admins = (roles ?? []).filter((r) => r.role === "admin").map((r) => r.user_id);
      const schoolAdmins = (roles ?? [])
        .filter((r) => r.role === "school_admin")
        .map((r) => r.user_id);
      const { data: mine } = schoolAdmins.length
        ? await sb.from("profiles").select("id").eq("school_id", a.school_id).in("id", schoolAdmins)
        : { data: [] };
      await pushTo([...new Set([...admins, ...(mine ?? []).map((p) => p.id)])], {
        title: a.severity === "urgent" ? "🚨 Safety alert" : "⚠️ School transport",
        body: a.message,
        url: "/admin/incidents",
        tag: `school-alert-${a.id}`,
      });
    }

    return json(res, 200, {
      ok: true,
      notifications: notes?.length ?? 0,
      alerts: alerts?.length ?? 0,
      devices,
      sent,
    });
  } catch (err) {
    console.error("[demo-push]", err);
    return json(res, 500, { error: "Push failed" });
  }
}
