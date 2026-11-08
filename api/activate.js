// Vercel serverless function: /api/activate
//
// First sign-in for a parent or a bus attendant. The school registers the
// person with their phone number, and the system gives them a 6-digit
// activation code. They enter phone + code + a password of their choice
// here; we create (or update) their account and link it to their children
// (parents) or their bus (attendants). Afterwards they sign in with phone +
// password. A new code from the school also resets a forgotten password.
//
// Accounts are Supabase users with a non-deliverable email built from the
// phone number (250788123456@parent.livetrack.app), created with
// email_confirm: true so no email is ever sent.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (server only).
import { createClient } from "@supabase/supabase-js";

const MAX_ATTEMPTS = 5;

/** Same rules as public.normalize_phone() and src/lib/phone.ts. */
export function normalizePhone(input) {
  const d = String(input ?? "").replace(/\D+/g, "");
  if (!d) return null;
  if (d.length === 10 && d.startsWith("0")) return `250${d.slice(1)}`;
  if (d.length === 9 && d.startsWith("7")) return `250${d}`;
  return d.length >= 9 && d.length <= 15 ? d : null;
}

const KINDS = {
  parent: { table: "guardians", role: "parent", domain: "parent.livetrack.app" },
  attendant: { table: "attendants", role: "attendant", domain: "staff.livetrack.app" },
};

async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  await new Promise((resolve, reject) => {
    req.on("data", (c) => chunks.push(c));
    req.on("end", resolve);
    req.on("error", reject);
  });
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

async function findUserIdByEmail(sb, email) {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const u = data.users.find((x) => x.email === email);
    if (u) return u.id;
    if (data.users.length < 1000) return null;
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    return json(res, 500, { error: "Activation is not set up on this server yet." });

  let input;
  try {
    input = await readJson(req);
  } catch {
    return json(res, 400, { error: "Invalid request" });
  }
  const kind = KINDS[input.kind] ? input.kind : null;
  const phone = normalizePhone(input.phone);
  const code = String(input.code ?? "").replace(/\D+/g, "");
  const password = typeof input.password === "string" ? input.password : "";
  if (!kind) return json(res, 400, { error: "Unknown account type" });
  if (!phone) return json(res, 400, { error: "Enter a valid phone number, e.g. 0788 123 456" });
  if (code.length !== 6) return json(res, 400, { error: "The activation code has 6 digits" });
  if (password.length < 6 || password.length > 72)
    return json(res, 400, { error: "Choose a password of at least 6 characters" });

  const { table, role, domain } = KINDS[kind];
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    // 1. Who is this? (Checked before any account is touched.)
    const { data: rows, error } = await sb
      .from(table)
      .select(
        "id, school_id, full_name, user_id, activation_code, activation_expires_at, activation_attempts",
      )
      .eq("phone", phone);
    if (error)
      return json(res, 500, { error: "Activation is not available yet. Please try later." });
    if (!rows?.length)
      return json(res, 404, {
        error: "This phone number isn't registered. Ask the school to add it.",
      });

    const now = Date.now();
    const match = rows.find(
      (r) =>
        r.activation_code === code &&
        (r.activation_attempts ?? 0) < MAX_ATTEMPTS &&
        (!r.activation_expires_at || new Date(r.activation_expires_at).getTime() > now),
    );
    if (!match) {
      const pending = rows.filter((r) => r.activation_code);
      await Promise.all(
        pending.map((r) =>
          sb
            .from(table)
            .update({ activation_attempts: (r.activation_attempts ?? 0) + 1 })
            .eq("id", r.id),
        ),
      );
      const locked =
        pending.length > 0 &&
        pending.every((r) => (r.activation_attempts ?? 0) + 1 >= MAX_ATTEMPTS);
      return json(res, 401, {
        error: locked
          ? "Too many wrong codes. Ask the school for a new code."
          : pending.length
            ? "That code is wrong or has expired."
            : "This account is already active. Sign in, or ask the school for a new code to reset your password.",
      });
    }

    // 2. Create the account, or set the new password on the existing one.
    const email = `${phone}@${domain}`;
    let userId = rows.find((r) => r.user_id)?.user_id ?? null;
    if (userId) {
      const { error: upErr } = await sb.auth.admin.updateUserById(userId, { password });
      if (upErr) return json(res, 500, { error: "Couldn't save your password. Please try again." });
    } else {
      const { data: created, error: cErr } = await sb.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { display_name: match.full_name, phone },
      });
      if (cErr) {
        if (!/already|registered|exists|duplicate/i.test(cErr.message))
          return json(res, 500, { error: "Couldn't create your account. Please try again." });
        userId = await findUserIdByEmail(sb, email);
        if (!userId)
          return json(res, 500, { error: "Couldn't find your account. Contact support." });
        await sb.auth.admin.updateUserById(userId, { password });
      } else {
        userId = created.user?.id ?? null;
      }
    }
    if (!userId)
      return json(res, 500, { error: "Couldn't create your account. Please try again." });

    // 3. Role (sign-up gives every new user the driver role 'user'), profile.
    await sb.from("user_roles").delete().eq("user_id", userId).eq("role", "user");
    const { error: roleErr } = await sb
      .from("user_roles")
      .upsert({ user_id: userId, role }, { onConflict: "user_id,role", ignoreDuplicates: true });
    if (roleErr) return json(res, 500, { error: "Couldn't finish setting up your account." });
    await sb
      .from("profiles")
      .upsert({ id: userId, display_name: match.full_name, school_id: match.school_id, phone });

    // 4. Link every registration with this phone (a parent can be at two
    //    schools). For parents a DB trigger links their children.
    const { error: linkErr } = await sb
      .from(table)
      .update({
        user_id: userId,
        activated_at: new Date().toISOString(),
        activation_code: null,
        activation_attempts: 0,
      })
      .eq("phone", phone);
    if (linkErr) return json(res, 500, { error: "Couldn't link your account. Please try again." });

    return json(res, 200, { email, name: match.full_name });
  } catch {
    return json(res, 500, { error: "Something went wrong. Please try again." });
  }
}
