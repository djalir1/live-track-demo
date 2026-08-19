#!/usr/bin/env node
/**
 * Idempotent Phase 2 seed: creates 2 parent invite codes (each linking a
 * student on a different bus) and — optionally — 2 parent auth users linked
 * via parent_students so the isolation test has known-safe subjects.
 *
 * Safe to run against the current DB (all rows are found by natural key and
 * skipped if present) or against a fresh Phase 1 DB.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed-parents.mjs
 *
 * PREREQUISITE (verify manually in Supabase dashboard):
 *   Authentication > Providers > Email > "Confirm email" must be OFF.
 *   Parent accounts use non-deliverable @parent.pulse.local addresses;
 *   a confirmation email to that domain will lock them out.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env var.");
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });

const SCHOOL_NAME = "Kigali Model Academy";
const CODES = [
  { code: "KIGALI-DEMO-A1", phone: "+250788111111", parentDisplayName: "Umubyeyi Aline",  targetStudent: "Aline U.",  bus: "Bus Isabuku" },
  { code: "KIGALI-DEMO-B2", phone: "+250788222222", parentDisplayName: "Umubyeyi Kevine", targetStudent: "Kevine N.", bus: "Bus Umuyaga" },
];

function normalizePhone(p) {
  const t = (p ?? "").trim();
  const plus = t.startsWith("+") ? "+" : "";
  return plus + t.replace(/\D+/g, "");
}
function localPart(phone, code) {
  const p = normalizePhone(phone);
  return p || code;
}

async function findOrCreateInvite({ school, code, phone, studentIds }) {
  const { data: hit } = await supabase.from("invites").select("*").eq("code", code).maybeSingle();
  if (hit) return { row: hit, created: false };
  const { data, error } = await supabase.from("invites").insert({
    school_id: school.id, code, phone, student_ids: studentIds,
  }).select().single();
  if (error) throw error;
  return { row: data, created: true };
}

async function ensureParentAccount({ email, phone, displayName, schoolId, studentIds }) {
  // 1. Auth user (idempotent — reuse if it exists).
  let userId;
  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    email, password: "0000", email_confirm: true, user_metadata: { display_name: displayName },
  });
  if (createErr) {
    const msg = createErr.message.toLowerCase();
    const exists = msg.includes("already been registered") || msg.includes("already exists") || msg.includes("duplicate");
    if (!exists) throw createErr;
    const { data: page } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const u = page.users.find((x) => x.email === email);
    if (!u) throw new Error(`Could not find existing parent ${email}`);
    userId = u.id;
  } else {
    userId = created.user.id;
  }
  // 2. profile with school
  await supabase.from("profiles").upsert({ id: userId, display_name: displayName, phone, school_id: schoolId });
  // 3. role=parent (idempotent)
  await supabase.from("user_roles").delete().eq("user_id", userId);
  await supabase.from("user_roles").insert({ user_id: userId, role: "parent" });
  // 4. parent_students links
  const links = studentIds.map((sid) => ({ parent_user_id: userId, student_id: sid }));
  await supabase.from("parent_students").upsert(links);
  return userId;
}

(async () => {
  const summary = [];

  const { data: schools, error: schErr } = await supabase.from("schools").select("*").eq("name", SCHOOL_NAME).limit(1);
  if (schErr) throw schErr;
  const school = schools?.[0];
  if (!school) throw new Error(`School "${SCHOOL_NAME}" not found — run scripts/seed-school.mjs first`);
  summary.push(`school found: ${SCHOOL_NAME} (${school.id})`);

  for (const spec of CODES) {
    const { data: student, error: sErr } = await supabase.from("students")
      .select("id, name, bus_id, buses(label, plate)").eq("school_id", school.id).eq("name", spec.targetStudent).maybeSingle();
    if (sErr) throw sErr;
    if (!student) { summary.push(`  SKIP ${spec.code} — student "${spec.targetStudent}" not found`); continue; }

    const email = `${localPart(spec.phone, spec.code)}@parent.pulse.local`;
    const { row: inv, created: invCreated } = await findOrCreateInvite({
      school, code: spec.code, phone: spec.phone, studentIds: [student.id],
    });
    summary.push(`  invite ${invCreated ? "CREATED" : "found"}: ${inv.code} phone=${inv.phone} students=[${student.name}] (${spec.bus})`);

    const uid = await ensureParentAccount({
      email, phone: spec.phone, displayName: spec.parentDisplayName,
      schoolId: school.id, studentIds: [student.id],
    });
    summary.push(`    parent account: ${email} (uid ${uid.slice(0,8)}…) linked to ${student.name} · default PIN 0000`);
  }

  console.log("=".repeat(64));
  console.log("Phase 2 parent seed:");
  console.log("=".repeat(64));
  for (const line of summary) console.log(" " + line);
  console.log(`\nInvite codes (share with parents):`);
  for (const c of CODES) console.log(`  ${c.code}  (${c.phone})  -> ${c.parentDisplayName}`);
})().catch((e) => { console.error(e); process.exit(1); });
