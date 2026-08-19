#!/usr/bin/env node
/**
 * Idempotent Phase 1 school seed. Safe to run against the current DB (all
 * these objects already exist by name — the script finds them and skips) or
 * against a fresh DB (creates the whole thing).
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed-school.mjs
 *
 * What it makes:
 *   * 1 school:  "Kigali Model Academy"
 *   * 1 route:   "Route A — Morning"
 *   * 3 stops:   Kimironko (seq 1, pickup), Nyarugenge (seq 2, pickup), School (seq 3, school)
 *   * 2 buses:   Bus Isabuku / Bus Umuyaga, each tied to an existing driver
 *   * 4 students: Aline U., Eric M. (Isabuku/Kimironko), Kevine N., Patrick I. (Umuyaga/Nyarugenge)
 *   * profiles.school_id set to the school for every existing super-admin whose
 *     email is passed via ADMIN_EMAILS (comma-separated). Super-admins whose
 *     school_id you want to stay NULL should be omitted from that list.
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
const ROUTE_NAME = "Route A — Morning";
const STOP_DEFS = [
  { name: "Kimironko",  sequence: 1, type: "pickup", lat: -1.9491, lng: 30.1244, radius_m: 150 },
  { name: "Nyarugenge", sequence: 2, type: "pickup", lat: -1.9464, lng: 30.0587, radius_m: 150 },
  { name: "School",     sequence: 3, type: "school", lat: -1.9550, lng: 30.0910, radius_m: 120 },
];
const BUS_DEFS = [
  { label: "Bus Isabuku", plate: "RAF345D", capacity: 30 },
  { label: "Bus Umuyaga", plate: "RAB145M", capacity: 30 },
];
const STUDENT_DEFS = [
  { name: "Aline U.",   busIdx: 0, stopName: "Kimironko",  cls: "P4" },
  { name: "Eric M.",    busIdx: 0, stopName: "Kimironko",  cls: "P5" },
  { name: "Kevine N.",  busIdx: 1, stopName: "Nyarugenge", cls: "P6" },
  { name: "Patrick I.", busIdx: 1, stopName: "Nyarugenge", cls: "P3" },
];

async function findOrCreate(table, match, insert) {
  const q = supabase.from(table).select("*").limit(1);
  for (const [k, v] of Object.entries(match)) q.eq(k, v);
  const { data: hit, error: selErr } = await q;
  if (selErr) throw selErr;
  if (hit && hit.length > 0) return { row: hit[0], created: false };
  const { data: created, error: insErr } = await supabase.from(table).insert(insert).select().single();
  if (insErr) throw insErr;
  return { row: created, created: true };
}

async function firstDriverIdMatching(plateOrLabelHint) {
  // Try to find an existing driver whose profile matches by plate, else any driver.
  const { data: roles } = await supabase.from("user_roles").select("user_id").eq("role", "user");
  const ids = (roles ?? []).map((r) => r.user_id);
  if (ids.length === 0) return null;
  const { data: profiles } = await supabase
    .from("profiles").select("id, display_name, plate_number").in("id", ids);
  const byPlate = (profiles ?? []).find((p) => p.plate_number && plateOrLabelHint && p.plate_number.toUpperCase() === plateOrLabelHint.toUpperCase());
  if (byPlate) return byPlate.id;
  return profiles?.[0]?.id ?? null;
}

(async () => {
  const summary = [];

  // 1. school
  const { row: school, created: schoolCreated } =
    await findOrCreate("schools", { name: SCHOOL_NAME }, { name: SCHOOL_NAME });
  summary.push(`school "${SCHOOL_NAME}" ${schoolCreated ? "CREATED" : "found"} (${school.id})`);

  // 2. route
  const { row: route, created: routeCreated } = await findOrCreate(
    "routes",
    { school_id: school.id, name: ROUTE_NAME },
    { school_id: school.id, name: ROUTE_NAME },
  );
  summary.push(`route  "${ROUTE_NAME}" ${routeCreated ? "CREATED" : "found"} (${route.id})`);

  // 3. stops
  const stopsByName = {};
  for (const def of STOP_DEFS) {
    const { row, created } = await findOrCreate(
      "stops",
      { route_id: route.id, name: def.name },
      { ...def, route_id: route.id, school_id: school.id },
    );
    stopsByName[def.name] = row;
    summary.push(`  stop "${def.name}" ${created ? "CREATED" : "found"} (seq ${row.sequence}, ${row.type})`);
  }

  // 4. buses (paired with any two available drivers)
  const busRows = [];
  for (const def of BUS_DEFS) {
    const driverId = await firstDriverIdMatching(def.plate);
    const { row, created } = await findOrCreate(
      "buses",
      { school_id: school.id, label: def.label },
      { ...def, school_id: school.id, route_id: route.id, driver_user_id: driverId },
    );
    busRows.push(row);
    summary.push(`  bus "${def.label}" ${created ? "CREATED" : "found"} (driver ${row.driver_user_id ?? "unassigned"})`);
  }

  // 5. students
  for (const def of STUDENT_DEFS) {
    const bus = busRows[def.busIdx];
    const stop = stopsByName[def.stopName];
    const { row, created } = await findOrCreate(
      "students",
      { school_id: school.id, name: def.name },
      { school_id: school.id, name: def.name, class: def.cls, bus_id: bus.id, home_stop_id: stop.id },
    );
    summary.push(`   student "${def.name}" ${created ? "CREATED" : "found"} (bus=${bus.label}, home=${def.stopName})`);
    void row;
  }

  // 6. link admins to the school (optional — controlled by env)
  const wantedEmails = (process.env.ADMIN_EMAILS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (wantedEmails.length > 0) {
    const { data: authList } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
    for (const email of wantedEmails) {
      const u = authList?.users.find((x) => x.email === email);
      if (!u) { summary.push(`  admin link "${email}" — no such auth user`); continue; }
      const { error } = await supabase.from("profiles").update({ school_id: school.id }).eq("id", u.id);
      if (error) { summary.push(`  admin link "${email}" — FAILED (${error.message})`); continue; }
      summary.push(`  admin link "${email}" -> school ${school.id}`);
    }
  } else {
    summary.push(`  (skip admin-link step — set ADMIN_EMAILS="a@x,b@y" to link super-admins)`);
  }

  console.log("=".repeat(64));
  console.log("Phase 1 school seed:");
  console.log("=".repeat(64));
  for (const line of summary) console.log(" " + line);
})().catch((e) => { console.error(e); process.exit(1); });
