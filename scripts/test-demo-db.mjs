/**
 * Test of the demo add-on (supabase/demo/demo.sql) on an in-memory Postgres:
 * all migrations + demo.sql, seed, simulate buses, reset.
 *
 *   npm i --no-save @electric-sql/pglite@0.2.17
 *   node scripts/test-demo-db.mjs
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const { PGlite } = await import(process.env.PGLITE ?? "@electric-sql/pglite");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const db = new PGlite();
let failed = 0;
const ok = (name, cond, got) => {
  console.log(
    `  ${cond ? "PASS" : "FAIL"}  ${name}${cond || got === undefined ? "" : `  got=${JSON.stringify(got)}`}`,
  );
  if (!cond) failed++;
};

await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to authenticated, anon;
  grant execute on function auth.uid() to authenticated, anon;
  create publication supabase_realtime;
`);
for (const f of readdirSync(join(root, "supabase/migrations")).sort()) {
  try {
    await db.exec(readFileSync(join(root, "supabase/migrations", f), "utf8"));
  } catch (e) {
    ok(`migration ${f}`, false, e.message);
  }
}
try {
  await db.exec(readFileSync(join(root, "supabase/demo/demo.sql"), "utf8"));
  await db.exec(readFileSync(join(root, "supabase/demo/demo.sql"), "utf8")); // re-run safe
  ok("demo.sql applies (twice)", true);
} catch (e) {
  ok("demo.sql applies", false, e.message);
}
await db.exec(`grant usage on schema public to authenticated; grant all on all tables in schema public to authenticated;
               grant all on all sequences in schema public to authenticated;`);

// Accounts (seed.mjs creates these through the Auth API).
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const acc = {
  platform_admin: id(1),
  school_admin: id(2),
  attendants: [id(11), id(12), id(13)],
  parents: [id(21), id(22), id(23)],
  trackers: [id(31), id(32), id(33)],
};
const all = [
  acc.platform_admin,
  acc.school_admin,
  ...acc.attendants,
  ...acc.parents,
  ...acc.trackers,
];
await db.exec(
  `insert into auth.users (id, email) values ${all.map((u) => `('${u}', '${u}@x')`).join(",")}`,
);

const q = async (sql, params) => (await db.query(sql, params)).rows;
async function as(user, sql, params = []) {
  await db.exec(
    `set role authenticated; select set_config('request.jwt.claim.sub', '${user}', false);`,
  );
  try {
    return (await db.query(sql, params)).rows;
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  }
}

console.log("Seed");
const seeded = (await q(`select public.demo_seed($1::jsonb) as r`, [JSON.stringify(acc)]))[0].r;
ok("school with 30 students and 3 buses", seeded.students === 30 && seeded.buses === 3, seeded);
const counts = (
  await q(`select (select count(*) from routes)::int routes, (select count(*) from stops)::int stops,
  (select count(*) from guardians)::int guardians, (select count(*) from guardians where user_id is not null)::int active_parents,
  (select count(*) from attendants)::int attendants, (select count(*) from bus_trips)::int trips,
  (select count(*) from boarding_events)::int events, (select count(*) from parent_students)::int links`)
)[0];
ok("3 routes, 12 stops", counts.routes === 3 && counts.stops === 12, counts);
ok(
  "3 parents with the app + parents waiting with codes",
  counts.active_parents === 3 && counts.guardians === 28,
  counts,
);
ok("history trips and check-ins", counts.trips >= 50 && counts.events > 500, counts);
ok("parent links synced (Grace 2, Eric 1, Aline 2)", counts.links === 5, counts);
const roles = await q(`select role::text, count(*)::int n from user_roles group by 1 order by 1`);
ok(
  "roles assigned",
  JSON.stringify(roles) ===
    JSON.stringify([
      { role: "admin", n: 1 },
      { role: "attendant", n: 3 },
      { role: "parent", n: 3 },
      { role: "school_admin", n: 1 },
      { role: "user", n: 3 },
    ]),
  roles,
);
ok(
  "drivers shown on buses",
  (await q(`select count(*)::int n from buses where gps_driver_name not in ('No driver')`))[0].n ===
    3,
);

console.log("What each account sees");
ok(
  "school admin sees 30 students",
  (await as(acc.school_admin, `select id from students`)).length === 30,
);
ok("Grace sees her 2 children", (await as(acc.parents[0], `select id from students`)).length === 2);
ok(
  "attendant of Bus 1 sees its 10 riders",
  (await as(acc.attendants[0], `select id from students`)).length === 10,
);
ok(
  "parent can't run the simulator",
  await as(acc.parents[0], `select public.demo_tick()`).then(
    () => false,
    () => true,
  ),
);

console.log("Simulated buses");
await q(`update demo_sim set last_tick = now() - interval '10 seconds'`);
ok("tick moves 3 buses", (await q(`select public.demo_tick() as n`))[0].n === 3);
const pos = await q(
  `select latitude, longitude, is_tracking from device_status where user_id = any($1::uuid[])`,
  [acc.trackers],
);
ok(
  "3 live positions in Kigali",
  pos.length === 3 &&
    pos.every((p) => p.is_tracking && p.latitude < -1.9 && p.latitude > -2 && p.longitude > 30),
  pos,
);
// Drive Bus 1 for ~20 simulated minutes, with today's afternoon trip open.
await as(
  acc.attendants[0],
  `select public.open_bus_trip(b.id, 'afternoon') from buses b where b.label = 'Bus 1'`,
);
for (let t = 0; t < 120; t++) {
  await q(`update demo_sim set last_tick = now() - interval '10 seconds',
           dwell_until = case when dwell_until is not null then now() - interval '1 second' end`);
  await q(`select public.demo_tick()`);
}
const ev = (
  await q(`select count(*)::int n, count(distinct stop_id)::int stops from geofence_events`)
)[0];
ok("buses reach stops (arrive/depart detected)", ev.n >= 4 && ev.stops >= 3, ev);
ok("history written", (await q(`select count(*)::int n from location_history`))[0].n >= 300);
const notes = (
  await q(
    `select count(*)::int n from parent_notifications where kind in ('bus_at_stop','bus_next','no_show','trip_started')`,
  )
)[0].n;
ok("parents got trip alerts from the moving bus", notes > 0, notes);
ok(
  "open trip session for the history page",
  (await q(`select count(*)::int n from trip_sessions where ended_at is null`))[0].n === 3,
);

console.log("Reset");
const again = (await q(`select public.demo_reset() as r`))[0].r;
ok("reset rebuilds the school", again.students === 30);
ok("only one demo school", (await q(`select count(*)::int n from schools`))[0].n === 1);
ok(
  "Grace still sees 2 children after reset",
  (await as(acc.parents[0], `select id from students`)).length === 2,
);

console.log(failed ? `\n${failed} FAILED` : "\nAll passed");
process.exit(failed ? 1 : 0);
