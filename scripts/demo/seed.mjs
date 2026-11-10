/**
 * Builds the Live Track demo: creates the demo accounts (Supabase Auth) and
 * calls demo_seed() (supabase/demo/demo.sql) to create the school, buses,
 * routes, students, parents and two weeks of history.
 *
 *   npm run demo:seed            (safe to run again: it rebuilds everything)
 *
 * Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY of the DEMO project in
 * .env.local. Refuses the production database.
 */
import { createClient } from "@supabase/supabase-js";
import { demoEnv } from "./env.mjs";

const PASSWORD = "demo1234"; // listed in DEMO_GUIDE.md

const ACCOUNTS = {
  platform_admin: [{ email: "admin@demo.livetrack.app", name: "Demo Platform Admin" }],
  school_admin: [{ email: "school@demo.livetrack.app", name: "Mrs. Claudine Mutesi" }],
  attendants: [1, 2, 3].map((i) => ({
    email: `25078810000${i}@staff.livetrack.app`,
    name: `Attendant ${i}`,
  })),
  parents: [1, 2, 3, 4].map((i) => ({
    email: `25078820000${i}@parent.livetrack.app`,
    name: `Parent ${i}`,
  })),
  // The "GPS trackers" of the 3 simulated buses (nobody signs in with these).
  trackers: [1, 2, 3].map((i) => ({
    email: `gps-demo-bus-${i}@livetrack.app`,
    name: `Bus ${i}`,
    password: crypto.randomUUID(),
  })),
};

const { url, key } = demoEnv();
const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

async function allUsers() {
  const out = [];
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    out.push(...data.users);
    if (data.users.length < 1000) break;
  }
  return out;
}

async function ensureUser(existing, { email, name, password = PASSWORD }) {
  const found = existing.find((u) => u.email === email);
  if (found) {
    const { error } = await sb.auth.admin.updateUserById(found.id, {
      password,
      email_confirm: true,
    });
    if (error) throw error;
    return found.id;
  }
  const { data, error } = await sb.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: name },
  });
  if (error) throw error;
  return data.user.id;
}

console.log(`Seeding the Live Track demo in ${url} …`);
const existing = await allUsers();
const ids = {};
for (const [role, list] of Object.entries(ACCOUNTS)) {
  ids[role] = [];
  for (const a of list) ids[role].push(await ensureUser(existing, a));
}
const payload = {
  platform_admin: ids.platform_admin[0],
  school_admin: ids.school_admin[0],
  attendants: ids.attendants,
  parents: ids.parents,
  trackers: ids.trackers,
};

const { data, error } = await sb.rpc("demo_seed", { p_accounts: payload });
if (error) {
  console.error("demo_seed failed:", error.message);
  console.error("Did you run supabase/demo/demo.sql in this project's SQL editor?");
  process.exit(1);
}
// First positions so the map isn't empty before the scheduler kicks in.
await sb.rpc("demo_tick");

console.log(`\n✅ Demo ready: ${data.students} students, ${data.buses} buses.\n`);
console.log("Sign in with (password for all: demo1234):");
console.table([
  { who: "School admin", where: "/admin", login: "school@demo.livetrack.app" },
  { who: "Platform admin", where: "/admin", login: "admin@demo.livetrack.app" },
  { who: "Attendant Bus 1", where: "/auth", login: "0788 100 001" },
  { who: "Attendant Bus 2", where: "/auth", login: "0788 100 002" },
  { who: "Attendant Bus 3", where: "/auth", login: "0788 100 003" },
  { who: "Parent Grace (2 kids, Bus 1)", where: "/parent", login: "0788 200 001" },
  { who: "Parent Eric (1 kid, Bus 1)", where: "/parent", login: "0788 200 002" },
  { who: "Parent Aline (2 kids, Bus 2)", where: "/parent", login: "0788 200 003" },
  { who: "Parent Jean Paul (3 kids, Bus 3)", where: "/parent", login: "0788 200 004" },
]);
console.log(
  "Buses move by themselves if pg_cron is on (see DEMO_SETUP.md); otherwise run: npm run demo:simulate",
);
