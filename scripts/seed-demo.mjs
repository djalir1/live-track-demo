#!/usr/bin/env node
/**
 * Seed 1 admin + 2 driver accounts plus a Kigali -> Kampala day whose data
 * exercises FIX 1 (signal-lost distance/time) and FIX 2 (named-places PDF).
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed-demo.mjs
 *
 * The credentials created (email + password) are printed to stdout so a
 * reviewer can sign in and see the results in /dashboard, /track, /history.
 * Safe to re-run: existing accounts with matching emails are reused rather
 * than re-created, and the demo day is upserted idempotently.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env var.");
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });

const DEMO = [
  {
    key: "admin",
    email: "demo-admin@pulse.local",
    password: "PulseDemo!Admin1",
    display_name: "Demo Admin",
    role: "admin",
    profile: { vehicle_type: "car", vehicle_name: null, plate_number: null, seats: null },
  },
  {
    key: "driver1",
    email: "demo-driver1@pulse.local",
    password: "PulseDemo!Driver1",
    display_name: "Demo Driver One",
    role: "user",
    profile: { vehicle_type: "van", vehicle_name: "Delivery Van", plate_number: "RAD001A", seats: 3 },
  },
  {
    key: "driver2",
    email: "demo-driver2@pulse.local",
    password: "PulseDemo!Driver2",
    display_name: "Demo Driver Two",
    role: "user",
    profile: { vehicle_type: "bus", vehicle_name: "City Bus", plate_number: "RAD002B", seats: 32 },
  },
];

async function ensureUser(spec) {
  // Look up by email; if not present, create.
  const { data: page, error: listErr } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listErr) throw listErr;
  const existing = page.users.find((u) => u.email === spec.email);
  if (existing) return existing.id;
  const { data, error } = await supabase.auth.admin.createUser({
    email: spec.email,
    password: spec.password,
    email_confirm: true,
    user_metadata: { display_name: spec.display_name },
  });
  if (error) throw error;
  return data.user.id;
}

async function upsertProfileAndRole(uid, spec) {
  const { error: pErr } = await supabase.from("profiles").upsert({
    id: uid,
    display_name: spec.display_name,
    ...spec.profile,
  });
  if (pErr) throw pErr;
  // user_roles has (user_id, role) uniqueness only if a constraint exists;
  // we DELETE + INSERT to be idempotent regardless of the current schema.
  await supabase.from("user_roles").delete().eq("user_id", uid);
  const { error: rErr } = await supabase.from("user_roles").insert({ user_id: uid, role: spec.role });
  if (rErr) throw rErr;
}

// --- Kigali -> Kampala demo day (matches the SQL used to seed the real DB).
const DEMO_DAY = "2026-06-15";
const MORNING = [
  ["06:00:00", -1.9440, 30.0555,  0, 98],
  ["06:02:00", -1.9455, 30.0570, 12, 98],
  ["06:04:00", -1.9470, 30.0590, 18, 97],
  ["06:06:00", -1.9500, 30.0610, 22, 97],
  ["06:08:00", -1.9530, 30.0630, 22, 96],
  ["06:10:00", -1.9552, 30.0650, 20, 96],
  ["06:12:00", -1.9570, 30.0680, 24, 95],
  ["06:14:00", -1.9585, 30.0720, 26, 95],
  ["06:16:00", -1.9580, 30.0800, 32, 94],
  ["06:18:00", -1.9570, 30.0900, 34, 94],
  ["06:20:00", -1.9560, 30.1000, 34, 93],
  ["06:22:00", -1.9550, 30.1120, 30, 93],
  ["06:24:00", -1.9550, 30.1120,  0, 92],
  ["06:26:00", -1.9550, 30.1120,  0, 92],
];
const EVENING = [
  ["21:42:00",  0.3163, 32.5822,  0, 41],
  ["21:44:00",  0.3180, 32.5850, 22, 40],
  ["21:46:00",  0.3200, 32.5880, 25, 39],
  ["21:48:00",  0.3220, 32.5920, 28, 38],
  ["21:50:00",  0.3250, 32.5960, 30, 37],
  ["21:52:00",  0.3280, 32.6000, 24, 36],
];

async function seedDemoDay(driverUid) {
  const dayStart = `${DEMO_DAY} 00:00:00+00`;
  const dayEnd = `${DEMO_DAY} 23:59:59+00`;
  // Wipe any prior demo-day rows so this is idempotent.
  await supabase.from("location_history").delete().eq("user_id", driverUid).gte("recorded_at", dayStart).lte("recorded_at", dayEnd);
  await supabase.from("trip_sessions").delete().eq("user_id", driverUid).gte("started_at", dayStart).lte("started_at", dayEnd);

  const rows = [...MORNING, ...EVENING].map(([t, lat, lon, kmh, bat]) => ({
    user_id: driverUid,
    latitude: lat,
    longitude: lon,
    speed_kmh: kmh,
    battery_level: bat,
    recorded_at: `${DEMO_DAY}T${t}+00:00`,
  }));
  const { error: histErr } = await supabase.from("location_history").insert(rows);
  if (histErr) throw histErr;
  const { error: sesErr } = await supabase.from("trip_sessions").insert({
    user_id: driverUid,
    started_at: `${DEMO_DAY}T05:58:00+00:00`,
    ended_at: `${DEMO_DAY}T21:55:00+00:00`,
  });
  if (sesErr) throw sesErr;
  return { points: rows.length };
}

(async () => {
  const created = {};
  for (const spec of DEMO) {
    const uid = await ensureUser(spec);
    await upsertProfileAndRole(uid, spec);
    created[spec.key] = { uid, ...spec };
  }
  const demo = await seedDemoDay(created.driver1.uid);

  console.log("=".repeat(60));
  console.log("Pulse demo seed complete.");
  console.log("=".repeat(60));
  for (const spec of DEMO) {
    console.log(`  ${spec.role.padEnd(6)}  ${spec.email}  /  ${spec.password}`);
  }
  console.log("-".repeat(60));
  console.log(`  Demo day inserted for ${created.driver1.email}:`);
  console.log(`    Date:     ${DEMO_DAY}`);
  console.log(`    Points:   ${demo.points} (14 Kigali + 6 Kampala)`);
  console.log(`    Gap:      06:26 -> 21:42  (~15h 16m, ~370 km jump)`);
  console.log(`    Session:  05:58 -> 21:55  (spans both segments)`);
  console.log("=".repeat(60));
  console.log("Sign in as demo-admin, open /history, pick 'Demo Driver One',");
  console.log("choose 2026-06-15, and hit Export PDF to verify FIX 1 + FIX 2.");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
