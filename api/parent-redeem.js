// Vercel serverless function — Node runtime. Reachable in production as
// /api/parent-redeem (vercel.json rewrites exclude /api/*). In dev, a tiny
// Vite middleware in vite.config.ts imports this same file and serves it.
//
// TODO: Replace phone-alias + PIN with WhatsApp OTP before scaling; register
// the WhatsApp Business number in Rwanda for the domestic authentication rate.
//
// Uses the service-role Supabase client so it can look up the invite (bypass
// RLS), auth.admin.createUser({ email_confirm: true }) (never sends a
// confirmation email to the non-deliverable @parent.pulse.local address), and
// upsert profiles / user_roles / parent_students.
//
// Env needed at runtime:
//   * SUPABASE_URL
//   * SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "@supabase/supabase-js";

function normalizePhone(input) {
  const t = String(input ?? "").trim();
  if (!t) return "";
  const plus = t.startsWith("+") ? "+" : "";
  return plus + t.replace(/\D+/g, "");
}
function localPart(phone, code) {
  const p = phone ? normalizePhone(phone) : "";
  return p || code;
}

async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body; // Vercel pre-parses
  const chunks = [];
  await new Promise((resolve, reject) => {
    req.on("data", (c) => chunks.push(c));
    req.on("end", resolve);
    req.on("error", reject);
  });
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Invalid JSON body");
  }
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return json(res, 500, {
      error: "Server misconfigured: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing",
    });
  }

  let input;
  try {
    input = await readJson(req);
  } catch (e) {
    return json(res, 400, { error: e.message });
  }
  const code = typeof input.code === "string" ? input.code.trim().toUpperCase() : "";
  const pin = typeof input.pin === "string" ? input.pin : "";
  if (!code) return json(res, 400, { error: "code is required" });
  if (!/^\d{4}$/.test(pin)) return json(res, 400, { error: "PIN must be 4 digits" });

  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    // 1. Look up the invite.
    const { data: inv, error: invErr } = await sb
      .from("invites")
      .select("*")
      .eq("code", code)
      .maybeSingle();
    if (invErr) return json(res, 500, { error: `Failed to look up invite: ${invErr.message}` });
    if (!inv) return json(res, 404, { error: "That code doesn't match any invite" });
    if (inv.used_at) return json(res, 409, { error: "This code has already been used" });
    if (inv.expires_at && new Date(inv.expires_at) < new Date()) {
      return json(res, 410, { error: "This code has expired" });
    }
    if (!inv.school_id) return json(res, 400, { error: "This code isn't linked to a school" });
    if (!Array.isArray(inv.student_ids) || inv.student_ids.length === 0) {
      return json(res, 400, { error: "This code has no students linked" });
    }

    // 2. Deterministic email.
    const email = `${localPart(inv.phone, inv.code)}@parent.pulse.local`;

    // 3. Create or find the auth user. email_confirm: true = never send email.
    let userId = null;
    const { data: created, error: createErr } = await sb.auth.admin.createUser({
      email,
      password: pin,
      email_confirm: true,
      user_metadata: { display_name: "Parent" },
    });
    if (createErr) {
      const msg = createErr.message.toLowerCase();
      const exists =
        msg.includes("already been registered") ||
        msg.includes("already exists") ||
        msg.includes("duplicate");
      if (!exists)
        return json(res, 500, { error: `Failed to create parent account: ${createErr.message}` });
      const { data: page } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const u = page.users.find((x) => x.email === email);
      if (!u) return json(res, 500, { error: "Parent account collision but user lookup failed" });
      userId = u.id;
    } else {
      userId = created.user?.id ?? null;
    }
    if (!userId) return json(res, 500, { error: "Could not resolve parent user id" });

    // 4. profiles row.
    const displayName = inv.phone ? `Parent ${inv.phone}` : `Parent ${inv.code}`;
    const { error: profErr } = await sb.from("profiles").upsert({
      id: userId,
      display_name: displayName,
      school_id: inv.school_id,
    });
    if (profErr) return json(res, 500, { error: `Failed to write profile: ${profErr.message}` });

    // 5. user_roles: parent (idempotent).
    await sb.from("user_roles").delete().eq("user_id", userId);
    const { error: roleErr } = await sb
      .from("user_roles")
      .insert({ user_id: userId, role: "parent" });
    if (roleErr)
      return json(res, 500, { error: `Failed to assign parent role: ${roleErr.message}` });

    // 6. parent_students links.
    const links = inv.student_ids.map((student_id) => ({ parent_user_id: userId, student_id }));
    const { error: linkErr } = await sb.from("parent_students").upsert(links);
    if (linkErr) return json(res, 500, { error: `Failed to link students: ${linkErr.message}` });

    // 7. Burn the code (race-safe via WHERE used_at IS NULL).
    const { error: burnErr } = await sb
      .from("invites")
      .update({ used_at: new Date().toISOString() })
      .eq("id", inv.id)
      .is("used_at", null);
    if (burnErr) return json(res, 500, { error: `Failed to mark invite used: ${burnErr.message}` });

    return json(res, 200, { email, student_ids: inv.student_ids });
  } catch (e) {
    return json(res, 500, { error: e instanceof Error ? e.message : "Unknown error" });
  }
}
