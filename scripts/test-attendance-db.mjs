/**
 * End-to-end test of the school attendance database (migrations + RLS + RPCs)
 * on an in-memory Postgres (PGlite), with a stub of Supabase's auth schema.
 *
 *   npm i --no-save @electric-sql/pglite@0.2.17
 *   node scripts/test-attendance-db.mjs
 *
 * (Or point PGLITE at an installed copy: PGLITE=file:///…/pglite/dist/index.js)
 *
 * Runs every migration in supabase/migrations in order, then plays a school
 * day as the school admin, the attendant and two parents, with RLS on.
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

// ── Supabase stand-ins ───────────────────────────────────────────────────────
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
    console.log(`  FAIL  migration ${f}: ${e.message}`);
    failed++;
  }
}
// Re-running must be harmless (every migration is idempotent).
for (const f of ["20261108110000_attendant_role.sql", "20261108120000_school_attendance.sql"]) {
  try {
    await db.exec(readFileSync(join(root, "supabase/migrations", f), "utf8"));
    ok(`re-run ${f}`, true);
  } catch (e) {
    ok(`re-run ${f}`, false, e.message);
  }
}
await db.exec(`
  grant usage on schema public to authenticated, anon;
  grant all on all tables in schema public to authenticated;
  grant all on all sequences in schema public to authenticated;
`);

// ── Seed (as the database owner) ─────────────────────────────────────────────
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const U = { admin: id(1), sa: id(2), att: id(3), p1: id(4), p2: id(5), drv: id(6), sa2: id(7) };
const S1 = id(101),
  S2 = id(102),
  R = id(201),
  ST1 = id(301),
  ST2 = id(302),
  SCH = id(303);
const B1 = id(401),
  B2 = id(402),
  B3 = id(403);
const AMINA = id(501),
  BRIAN = id(502),
  CHLOE = id(503),
  DAN = id(504),
  ERIC = id(505);

await db.exec(`
  insert into auth.users (id, email) values
    ('${U.admin}','admin@x'),('${U.sa}','sa@x'),('${U.att}','att@x'),('${U.p1}','p1@x'),
    ('${U.p2}','p2@x'),('${U.drv}','gps-1@livetrack.app'),('${U.sa2}','sa2@x');
  update public.user_roles set role = 'admin' where user_id = '${U.admin}';
  update public.user_roles set role = 'school_admin' where user_id in ('${U.sa}','${U.sa2}');
  update public.user_roles set role = 'attendant' where user_id = '${U.att}';
  update public.user_roles set role = 'parent' where user_id in ('${U.p1}','${U.p2}');
  insert into public.schools (id, name) values ('${S1}','Kigali Model Academy'),('${S2}','Other School');
  update public.profiles set school_id = '${S1}' where id in ('${U.sa}','${U.att}','${U.p1}','${U.p2}','${U.drv}');
  update public.profiles set school_id = '${S2}' where id = '${U.sa2}';
  insert into public.routes (id, school_id, name) values ('${R}','${S1}','Kimironko');
  insert into public.stops (id, route_id, school_id, name, lat, lng, radius_m, sequence, type) values
    ('${ST1}','${R}','${S1}','Kimironko',-1.9500,30.1200,120,1,'pickup'),
    ('${ST2}','${R}','${S1}','Remera',-1.9600,30.1100,120,2,'pickup'),
    ('${SCH}','${R}','${S1}','School',-1.9700,30.1000,150,3,'school');
  insert into public.buses (id, school_id, route_id, label, plate, driver_user_id) values
    ('${B1}','${S1}','${R}','Bus A','RAA001A','${U.drv}'),
    ('${B2}','${S1}','${R}','Bus B','RAB002B',null),
    ('${B3}','${S2}',null,'Bus Z','RAZ999Z',null);
  insert into public.students (id, school_id, bus_id, name, home_stop_id, class) values
    ('${AMINA}','${S1}','${B1}','Amina','${ST1}','P3'),
    ('${BRIAN}','${S1}','${B1}','Brian','${ST2}','P5'),
    ('${ERIC}','${S1}','${B1}','Eric','${ST2}','P1'),
    ('${CHLOE}','${S1}','${B2}','Chloe','${ST1}','P2'),
    ('${DAN}','${S2}','${B3}','Dan',null,'S1');
`);

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
async function fails(user, sql, params = []) {
  try {
    await as(user, sql, params);
    return null;
  } catch (e) {
    return e.message;
  }
}

// ── Registration ─────────────────────────────────────────────────────────────
console.log("Registration");
const [g1] = await as(
  U.sa,
  `insert into public.guardians (school_id, full_name, phone, relationship)
  values ($1, 'Grace Uwase', '0788 123 456', 'Mother') returning *`,
  [S1],
);
ok("phone normalised to 250…", g1.phone === "250788123456", g1.phone);
ok("activation code issued", /^\d{6}$/.test(g1.activation_code ?? ""), g1.activation_code);
await as(
  U.sa,
  `insert into public.student_guardians (student_id, guardian_id, is_primary) values ($1,$3,true),($2,$3,false)`,
  [AMINA, BRIAN, g1.id],
);
const [g2] = await as(
  U.sa,
  `insert into public.guardians (school_id, full_name, phone) values ($1,'Paul','+250 722 000 111') returning *`,
  [S1],
);
await as(U.sa, `insert into public.student_guardians (student_id, guardian_id) values ($1,$2)`, [
  CHLOE,
  g2.id,
]);
const [a1] = await as(
  U.sa,
  `insert into public.attendants (school_id, full_name, phone, bus_id) values ($1,'Alice','0733000222',$2) returning *`,
  [S1, B1],
);
ok("attendant code issued", /^\d{6}$/.test(a1.activation_code ?? ""));
ok(
  "other school's admin can't see guardians",
  (await as(U.sa2, `select * from public.guardians`)).length === 0,
);
ok(
  "parent can't register a guardian",
  !!(await fails(
    U.p1,
    `insert into public.guardians (school_id, full_name, phone) values ($1,'X','0788000000')`,
    [S1],
  )),
);
ok(
  "parent can't read drivers via same_school",
  (await as(U.p1, `select * from public.drivers`)).length === 0,
);
const code = (await as(U.sa, `select public.issue_activation_code('parent', $1) as c`, [g1.id]))[0]
  .c;
ok("new code on request", /^\d{6}$/.test(code));
ok(
  "parent can't issue codes",
  !!(await fails(U.p1, `select public.issue_activation_code('parent', $1)`, [g1.id])),
);

// Activation (what api/activate.js does with the service key).
await db.exec(`update public.guardians set user_id='${U.p1}', activated_at=now(), activation_code=null where id='${g1.id}';
               update public.guardians set user_id='${U.p2}' where id='${g2.id}';
               update public.attendants set user_id='${U.att}' where id='${a1.id}';`);
const kids = await as(U.p1, `select name from public.students order by name`);
ok("parent sees exactly their 2 children", kids.map((k) => k.name).join() === "Amina,Brian", kids);
ok("parent sees their child's bus", (await as(U.p1, `select id from public.buses`)).length === 1);
ok(
  "attendant sees only Bus A riders",
  (await as(U.att, `select name from public.students order by name`)).map((k) => k.name).join() ===
    "Amina,Brian,Eric",
);

// ── Morning trip ─────────────────────────────────────────────────────────────
console.log("Morning trip");
await as(
  U.p1,
  `select public.set_ride_notice($1, public.kigali_today(), 'not_riding', 'morning', 'Driving him')`,
  [BRIAN],
);
ok(
  "parent can't give notice for another child",
  !!(await fails(U.p1, `select public.set_ride_notice($1, public.kigali_today(), 'absent')`, [
    CHLOE,
  ])),
);
ok(
  "parent can't open a trip",
  !!(await fails(U.p1, `select public.open_bus_trip($1,'morning')`, [B1])),
);
ok(
  "attendant can't open another bus's trip",
  !!(await fails(U.att, `select public.open_bus_trip($1,'morning')`, [B2])),
);
const trip = (await as(U.att, `select public.open_bus_trip($1,'morning') as id`, [B1]))[0].id;
const again = (await as(U.att, `select public.open_bus_trip($1,'morning') as id`, [B1]))[0].id;
ok("opening twice returns the same trip", trip === again);
const list = await as(
  U.att,
  `select s.name, ts.status from public.trip_students ts join public.students s on s.id = ts.student_id where trip_id=$1 order by s.name`,
  [trip],
);
ok(
  "list: Amina expected, Brian not riding, Eric expected",
  JSON.stringify(list) ===
    JSON.stringify([
      { name: "Amina", status: "expected" },
      { name: "Brian", status: "not_riding" },
      { name: "Eric", status: "expected" },
    ]),
  list,
);
ok(
  "trip-start alert sent to Amina's parent",
  (await as(U.p1, `select * from public.parent_notifications where kind='trip_started'`)).length ===
    1,
);

// Bus arrives at Kimironko (via the real GPS path: location_history → geofence → hook).
await db.exec(
  `insert into public.location_history (user_id, latitude, longitude, speed_kmh) values ('${U.drv}', -1.95001, 30.12001, 3)`,
);
const atStop = await as(
  U.p1,
  `select title from public.parent_notifications where kind='bus_at_stop'`,
);
ok(
  "'bus is at your stop' sent",
  atStop.length === 1 && atStop[0].title.includes("Kimironko"),
  atStop,
);

const cid = "11111111-1111-1111-1111-111111111111";
const r1 = (
  await as(U.att, `select public.mark_student($1,$2,'board',-1.95,30.12,null,$3) as r`, [
    trip,
    AMINA,
    cid,
  ])
)[0].r;
ok("Amina boarded", r1.status === "boarded", r1);
const r2 = (
  await as(U.att, `select public.mark_student($1,$2,'board',-1.95,30.12,null,$3) as r`, [
    trip,
    AMINA,
    cid,
  ])
)[0].r;
ok("offline retry saved once", r2.duplicate === true);
const r3 = (await as(U.att, `select public.mark_student($1,$2,'board') as r`, [trip, AMINA]))[0].r;
ok("second tap within 2 min ignored", r3.duplicate === true);
const boarded = await as(
  U.p1,
  `select title, body from public.parent_notifications where kind='boarded'`,
);
ok(
  "parent told 'Amina boarded Bus A at Kimironko stop'",
  boarded.length === 1 && /Amina boarded Bus A at Kimironko stop/.test(boarded[0].title),
  boarded,
);
ok(
  "other parent got nothing about Amina",
  (await as(U.p2, `select * from public.parent_notifications where student_id=$1`, [AMINA]))
    .length === 0,
);
ok(
  "parent can't mark children",
  !!(await fails(U.p1, `select public.mark_student($1,$2,'drop')`, [trip, AMINA])),
);
ok(
  "parent can't write the feed directly",
  !!(await fails(
    U.p1,
    `insert into public.parent_notifications (user_id, kind, title) values ($1,'x','x')`,
    [U.p1],
  )),
);

// Chloe (Bus B) gets on Bus A by mistake: accepted and flagged.
const r4 = (await as(U.att, `select public.mark_student($1,$2,'board') as r`, [trip, CHLOE]))[0].r;
ok("wrong bus accepted and flagged", r4.status === "boarded" && r4.wrong_bus === true, r4);
ok(
  "school alerted: wrong bus",
  (await as(U.sa, `select * from public.school_alerts where kind='wrong_bus'`)).length === 1,
);
ok(
  "Chloe's parent told which bus",
  (await as(U.p2, `select * from public.parent_notifications where kind='wrong_bus'`)).length === 1,
);
ok(
  "Chloe's parent can now follow Bus A",
  (await as(U.p2, `select id from public.buses where id=$1`, [B1])).length === 1,
);
ok(
  "attendant can't add a child from another school",
  !!(await fails(U.att, `select public.mark_student($1,$2,'board')`, [trip, DAN])),
);

// Bus leaves Remera with Eric still "expected" → no-show.
await db.exec(
  `insert into public.location_history (user_id, latitude, longitude) values ('${U.drv}', -1.96001, 30.11001)`,
);
await db.exec(
  `insert into public.location_history (user_id, latitude, longitude) values ('${U.drv}', -1.9650, 30.1050)`,
);
const eric = await as(
  U.sa,
  `select status from public.trip_students where trip_id=$1 and student_id=$2`,
  [trip, ERIC],
);
ok("Eric became a no-show when the bus left his stop", eric[0]?.status === "no_show", eric);
ok(
  "Brian (not riding) was left alone",
  (
    await as(U.sa, `select status from public.trip_students where trip_id=$1 and student_id=$2`, [
      trip,
      BRIAN,
    ])
  )[0].status === "not_riding",
);

// Delay announcement from the bus.
await as(U.att, `select public.post_announcement(null, $1, 'traffic', 15)`, [B1]);
const ann = await as(
  U.p1,
  `select title from public.parent_notifications where kind='announcement'`,
);
ok(
  "traffic message reached the parent",
  ann.length >= 1 && /heavy traffic, about 15 min late/.test(ann[0].title),
  ann,
);
ok(
  "parent can read the announcement",
  (await as(U.p1, `select * from public.announcements`)).length === 1,
);
ok(
  "attendant can't message the whole school",
  !!(await fails(U.att, `select public.post_announcement($1, null, 'school', null, 'Hi')`, [S1])),
);

// Closing: not while children are on board, not without the empty check.
const e1 = await fails(U.att, `select public.close_bus_trip($1, true)`, [trip]);
ok("can't close with children on board", /Still marked on board: Amina, Chloe/.test(e1 ?? ""), e1);
const n = (await as(U.att, `select public.drop_all($1) as n`, [trip]))[0].n;
ok("'Everyone off at school' dropped 2", n === 2, n);
ok(
  "parent told 'Amina arrived at school'",
  (await as(U.p1, `select * from public.parent_notifications where kind='dropped_off'`)).length ===
    1,
);
ok(
  "can't close without the empty check",
  /empty/.test((await fails(U.att, `select public.close_bus_trip($1, false)`, [trip])) ?? ""),
);
await as(U.att, `select public.close_bus_trip($1, true)`, [trip]);
ok(
  "trip closed",
  (await as(U.sa, `select status from public.bus_trips where id=$1`, [trip]))[0].status ===
    "closed",
);
ok(
  "no marks on a closed trip",
  !!(await fails(U.att, `select public.mark_student($1,$2,'board')`, [trip, AMINA])),
);

// ── Afternoon: child left on the bus ─────────────────────────────────────────
console.log("Afternoon trip");
await as(U.p1, `select public.set_ride_notice($1, public.kigali_today(), 'pickup')`, [BRIAN]);
const pm = (await as(U.att, `select public.open_bus_trip($1,'afternoon') as id`, [B1]))[0].id;
const pmList = await as(
  U.att,
  `select s.name, ts.status, ts.notice_kind from public.trip_students ts join public.students s on s.id=ts.student_id where trip_id=$1 order by s.name`,
  [pm],
);
ok(
  "Brian off the afternoon list (pickup)",
  pmList.find((x) => x.name === "Brian")?.notice_kind === "pickup",
  pmList,
);
ok(
  "Chloe (usual Bus B) not on Bus A's afternoon list",
  !pmList.some((x) => x.name === "Chloe"),
  pmList,
);
await as(
  U.att,
  `select public.mark_student($1,$2,'board', null, null, now() - interval '30 minutes')`,
  [pm, AMINA],
);
await db.exec(`insert into public.device_status (user_id, is_tracking) values ('${U.drv}', false)
               on conflict (user_id) do update set is_tracking = false;
               insert into public.fleet_events (kind, school_id, bus_id, occurred_at) values ('trip_ended','${S1}','${B1}', now() - interval '15 minutes');`);
const flagged = (await as(U.sa, `select public.check_open_trips() as n`))[0].n;
ok("'child still on board 10 min after engine off' alert", flagged === 1, flagged);
ok("…only once", (await as(U.sa, `select public.check_open_trips() as n`))[0].n === 0);
const far = (
  await as(U.att, `select public.mark_student($1,$2,'drop',-1.90,30.20) as r`, [pm, AMINA])
)[0].r;
ok("dropped far from home", far.status === "dropped_off");
ok(
  "school alerted: far drop-off",
  (await as(U.sa, `select * from public.school_alerts where kind='far_dropoff'`)).length === 1,
);

// Cancelled notice puts the child back on an open trip.
const [nt] = await as(
  U.p1,
  `select id from public.ride_notices where student_id=$1 and kind='pickup'`,
  [BRIAN],
);
await as(U.p1, `select public.cancel_ride_notice($1)`, [nt.id]);
ok(
  "cancel 'I'll pick up' → Brian expected again",
  (
    await as(U.att, `select status from public.trip_students where trip_id=$1 and student_id=$2`, [
      pm,
      BRIAN,
    ])
  )[0].status === "expected",
);

// Breakdown: school moves the list to Bus B.
await as(U.sa, `select public.move_trip($1,$2)`, [pm, B2]);
ok(
  "trip moved to Bus B",
  (await as(U.sa, `select bus_id from public.bus_trips where id=$1`, [pm]))[0].bus_id === B2,
);
ok(
  "parents told about the new bus",
  (await as(U.p1, `select * from public.parent_notifications where kind='bus_changed'`)).length >=
    1,
);
ok(
  "attendant can't move trips",
  !!(await fails(U.att, `select public.move_trip($1,$2)`, [pm, B1])),
);

// Feed housekeeping.
await as(U.p1, `select public.mark_notifications_read(null)`);
ok(
  "parent marked feed read",
  (await as(U.p1, `select * from public.parent_notifications where read_at is null`)).length === 0,
);
ok(
  "other school's admin sees no trips",
  (await as(U.sa2, `select * from public.bus_trips`)).length === 0,
);
ok(
  "other school's admin sees no alerts",
  (await as(U.sa2, `select * from public.school_alerts`)).length === 0,
);

console.log(failed ? `\n${failed} FAILED` : "\nAll passed");
process.exit(failed ? 1 : 0);
