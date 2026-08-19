-- Cross-school RLS test for Phase 1 (routes/stops/buses/students).
--
-- Runs entirely inside a transaction and rolls back at the end: no rows are
-- committed to the DB, no auth.users users are touched, no persistent test
-- accounts remain. The synthetic profiles rows bypass the profiles.id FK to
-- auth.users via session_replication_role=replica (superuser-only trick).
--
-- Prints an 8-row result set; every "passed" cell must be true.
--
-- Run with:  psql "$SUPABASE_DB_URL" -f scripts/test-cross-school-rls.sql
-- or:        supabase db execute --project-ref <ref> -f scripts/test-cross-school-rls.sql

begin;

-- Results table lives in public so `authenticated` sees it. Rolled back at end.
create table if not exists public._rls_test_results(
  step text primary key,
  expected text,
  actual text,
  passed boolean
);
truncate public._rls_test_results;
grant all on public._rls_test_results to authenticated;

-- Setup — two schools with a route + bus each.
insert into schools(id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000000', '__RLS_TEST_A'),
  ('bbbbbbbb-0000-0000-0000-000000000000', '__RLS_TEST_B');
insert into routes(school_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'A-Route-1'),
  ('bbbbbbbb-0000-0000-0000-000000000000', 'B-Route-1');

-- Synthetic school_admin profiles for each school. FK to auth.users is bypassed.
set local session_replication_role = replica;
insert into profiles(id, display_name, school_id) values
  ('aaaaaaaa-1111-1111-1111-111111111111', '__RLS_TEST_admin_a', 'aaaaaaaa-0000-0000-0000-000000000000'),
  ('bbbbbbbb-1111-1111-1111-111111111111', '__RLS_TEST_admin_b', 'bbbbbbbb-0000-0000-0000-000000000000');
insert into user_roles(user_id, role) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'school_admin'),
  ('bbbbbbbb-1111-1111-1111-111111111111', 'school_admin');
set local session_replication_role = origin;

insert into buses(school_id, route_id, label)
  select 'aaaaaaaa-0000-0000-0000-000000000000', id, 'A-Bus-1' from routes where school_id='aaaaaaaa-0000-0000-0000-000000000000';
insert into buses(school_id, route_id, label)
  select 'bbbbbbbb-0000-0000-0000-000000000000', id, 'B-Bus-1' from routes where school_id='bbbbbbbb-0000-0000-0000-000000000000';

-- ── school_admin A ─────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-1111-1111-1111-111111111111","role":"authenticated"}';

insert into public._rls_test_results
  select 'A reads OWN routes', '>=1', count(*)::text, count(*) >= 1
  from routes where school_id='aaaaaaaa-0000-0000-0000-000000000000';
insert into public._rls_test_results
  select 'A reads B routes (RLS should hide them)', '0', count(*)::text, count(*) = 0
  from routes where school_id='bbbbbbbb-0000-0000-0000-000000000000';
insert into public._rls_test_results
  select 'A reads B buses (RLS should hide them)', '0', count(*)::text, count(*) = 0
  from buses where school_id='bbbbbbbb-0000-0000-0000-000000000000';

do $$
declare ok boolean := false;
begin
  begin
    insert into routes(school_id, name) values ('bbbbbbbb-0000-0000-0000-000000000000', 'A-evil-insert-into-B');
  exception when others then ok := true;
  end;
  insert into public._rls_test_results values ('A INSERTs into B routes (WITH CHECK should block)', 'blocked', case when ok then 'blocked' else 'succeeded (BAD)' end, ok);
end $$;

do $$
declare n integer;
begin
  update routes set name = name || ' hacked-by-A' where school_id='bbbbbbbb-0000-0000-0000-000000000000';
  get diagnostics n = row_count;
  insert into public._rls_test_results values ('A UPDATEs B routes (RLS filters SELECT so 0 rows match)', '0 rows', n || ' rows', n = 0);
end $$;

reset role;
reset request.jwt.claims;

-- ── school_admin B ─────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-1111-1111-1111-111111111111","role":"authenticated"}';

insert into public._rls_test_results
  select 'B reads OWN buses', '>=1', count(*)::text, count(*) >= 1
  from buses where school_id='bbbbbbbb-0000-0000-0000-000000000000';
insert into public._rls_test_results
  select 'B reads A buses (RLS should hide them)', '0', count(*)::text, count(*) = 0
  from buses where school_id='aaaaaaaa-0000-0000-0000-000000000000';

do $$
declare ok boolean := false;
begin
  begin
    insert into students(school_id, name) values ('aaaaaaaa-0000-0000-0000-000000000000', 'B-evil-student-into-A');
  exception when others then ok := true;
  end;
  insert into public._rls_test_results values ('B INSERTs student into school A (should block)', 'blocked', case when ok then 'blocked' else 'succeeded (BAD)' end, ok);
end $$;

reset role;
reset request.jwt.claims;

-- Present the results.
select step, expected, actual, passed from public._rls_test_results order by step;

-- Undo everything — no test rows persist.
rollback;
