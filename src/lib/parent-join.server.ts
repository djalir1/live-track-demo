// Parent JOIN redeem — server-only entry point.
//
// TODO: Replace phone-alias + PIN with WhatsApp OTP before scaling; register
// the WhatsApp Business number in Rwanda for the domestic authentication rate.
//
// Runs on the server (TanStack Start server bundle), never on the client.
// Uses the service-role Supabase client so it can:
//   * look up the invite bypassing RLS,
//   * create the parent's auth user with email_confirm: true (so no
//     confirmation email is ever sent — the @parent.pulse.local domain is
//     non-deliverable), and
//   * insert profiles / user_roles / parent_students rows.
//
// The service-role key is loaded from process.env.SUPABASE_SERVICE_ROLE_KEY.
// The route uses it via a validated input; the client only ever receives
// the parent's email back (so it can call signInWithPassword) plus the
// list of student ids that were linked.

import { createServerFn } from "@tanstack/start-client-core";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

function admin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Server misconfigured: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

// Normalize a phone number to a compact form suitable for use inside an
// email local-part: strip all non-digits, keep the "+" if present.
function normalizePhone(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  const plus = trimmed.startsWith("+") ? "+" : "";
  const digits = trimmed.replace(/\D+/g, "");
  return plus + digits;
}

function localPart(invite: { phone: string | null; code: string }): string {
  const p = invite.phone ? normalizePhone(invite.phone) : "";
  return p || invite.code;
}

export interface RedeemResult {
  email: string;
  student_ids: string[];
}

export const redeemJoinCode = createServerFn({ method: "POST" })
  .validator((raw: unknown): { code: string; pin: string } => {
    if (typeof raw !== "object" || raw == null) throw new Error("Invalid request");
    const r = raw as { code?: unknown; pin?: unknown };
    if (typeof r.code !== "string" || r.code.trim().length === 0) throw new Error("code is required");
    if (typeof r.pin !== "string" || !/^\d{4}$/.test(r.pin)) throw new Error("PIN must be 4 digits");
    return { code: r.code.trim().toUpperCase(), pin: r.pin };
  })
  .handler(async ({ data }): Promise<RedeemResult> => {
    const sb = admin();

    // 1. Look up the invite.
    const { data: inv, error: invErr } = await sb
      .from("invites").select("*").eq("code", data.code).maybeSingle();
    if (invErr) throw new Error(`Failed to look up invite: ${invErr.message}`);
    if (!inv) throw new Error("That code doesn't match any invite");
    if (inv.used_at) throw new Error("This code has already been used");
    if (inv.expires_at && new Date(inv.expires_at) < new Date()) throw new Error("This code has expired");
    if (!inv.school_id) throw new Error("This code isn't linked to a school");
    if (!Array.isArray(inv.student_ids) || inv.student_ids.length === 0) {
      throw new Error("This code has no students linked");
    }

    // 2. Compose deterministic email for this parent.
    const email = `${localPart({ phone: inv.phone, code: inv.code })}@parent.pulse.local`;

    // 3. Create or find the auth user. email_confirm: true so Supabase never
    // tries to send a confirmation to the non-deliverable address.
    let userId: string | null = null;
    const { data: created, error: createErr } = await sb.auth.admin.createUser({
      email,
      password: data.pin,
      email_confirm: true,
      user_metadata: { display_name: "Parent" },
    });
    if (createErr) {
      // If the account already exists (e.g. same phone on a re-issued invite),
      // look it up by email and continue. Any other error is fatal.
      const msg = createErr.message.toLowerCase();
      const exists = msg.includes("already been registered") || msg.includes("already exists") || msg.includes("duplicate");
      if (!exists) throw new Error(`Failed to create parent account: ${createErr.message}`);
      const { data: page } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const u = page.users.find((x) => x.email === email);
      if (!u) throw new Error("Parent account collision but user lookup failed");
      userId = u.id;
    } else {
      userId = created.user?.id ?? null;
    }
    if (!userId) throw new Error("Could not resolve parent user id");

    // 4. profiles row — display_name defaults to phone or code.
    const displayName = inv.phone ? `Parent ${inv.phone}` : `Parent ${inv.code}`;
    const { error: profErr } = await sb.from("profiles").upsert({
      id: userId,
      display_name: displayName,
      school_id: inv.school_id,
    });
    if (profErr) throw new Error(`Failed to write profile: ${profErr.message}`);

    // 5. user_roles: mark as parent (idempotent).
    await sb.from("user_roles").delete().eq("user_id", userId);
    const { error: roleErr } = await sb.from("user_roles").insert({ user_id: userId, role: "parent" });
    if (roleErr) throw new Error(`Failed to assign parent role: ${roleErr.message}`);

    // 6. parent_students links — one row per invited student.
    const links = inv.student_ids.map((student_id: string) => ({ parent_user_id: userId!, student_id }));
    const { error: linkErr } = await sb.from("parent_students").upsert(links);
    if (linkErr) throw new Error(`Failed to link students: ${linkErr.message}`);

    // 7. Burn the code.
    const { error: burnErr } = await sb.from("invites")
      .update({ used_at: new Date().toISOString() })
      .eq("id", inv.id).is("used_at", null); // only if still unused (prevents double-redeem race)
    if (burnErr) throw new Error(`Failed to mark invite used: ${burnErr.message}`);

    return { email, student_ids: inv.student_ids };
  });
