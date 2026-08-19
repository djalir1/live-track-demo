-- Parent isolation test — the CHILD-SAFETY check for Phase 2.
-- 18 assertions, all under RLS. Every "passed" cell must be true.
--
-- The whole test lives in ONE transaction that rolls back at the end.
-- Nothing persists: no data changes, no test rows leak.
--
-- Assumes the following seed rows exist (created by scripts/seed-school.mjs
-- + scripts/seed-parents.mjs):
--   Parent A = Umubyeyi Aline  (uid 39ea7c5f-…)  linked to Aline U.
--                (Bus Isabuku e463e43f-…, driver Guy eb8c60bb-…)
--   Parent B = Umubyeyi Kevine (uid 0b420c06-…)  linked to Kevine N.
--                (Bus Umuyaga 9d325d2a-…, driver Shema 7a79ba0f-…)
--   Invite codes KIGALI-DEMO-A1 and KIGALI-DEMO-B2, both unused.
--
-- Adjust the UUIDs below if you rerun on a fresh seed.
--
-- Run with: psql "$SUPABASE_DB_URL" -f scripts/test-parent-isolation.sql

begin;

create table if not exists public._iso_results(
  step text primary key, expected text, actual text, passed boolean);
truncate public._iso_results;
grant all on public._iso_results to authenticated;

-- ── (i)  A reads own data  &&  (ii) A cannot see B's ────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"39ea7c5f-a930-4fb6-bb5c-ff11b17751e1","role":"authenticated"}';

insert into public._iso_results
  select 'A reads OWN student (Aline U.)', '1', count(*)::text, count(*) = 1
    from students where id='00d3cbdf-386c-4a84-bfaf-16b75cdacbab';
insert into public._iso_results
  select 'A reads OWN bus (Isabuku)', '1', count(*)::text, count(*) = 1
    from buses where id='e463e43f-8dd2-4180-9d91-31bc51f5dcc6';
insert into public._iso_results
  select 'A reads OWN driver device_status (Guy)', '1', count(*)::text, count(*) = 1
    from device_status where user_id='eb8c60bb-f323-496e-8fa1-5e39f4a23f28';
insert into public._iso_results
  select 'A reads OWN parent_students', '>=1', count(*)::text, count(*) >= 1
    from parent_students where parent_user_id='39ea7c5f-a930-4fb6-bb5c-ff11b17751e1';

insert into public._iso_results
  select 'A reads B student (Kevine N.) — RLS should hide', '0', count(*)::text, count(*) = 0
    from students where id='6f19e413-647a-4d48-866e-baa52946ea30';
insert into public._iso_results
  select 'A reads B bus (Umuyaga) — RLS should hide', '0', count(*)::text, count(*) = 0
    from buses where id='9d325d2a-028d-41c9-8627-81db422e1c09';
insert into public._iso_results
  select 'A reads B driver device_status (Shema) — RLS should hide', '0', count(*)::text, count(*) = 0
    from device_status where user_id='7a79ba0f-4068-44d8-be57-7a600be05d01';
insert into public._iso_results
  select 'A reads B parent_students — RLS should hide', '0', count(*)::text, count(*) = 0
    from parent_students where parent_user_id='0b420c06-efda-4ef1-bb03-e07f58afd5d3';

-- ── (iii) A cannot write anything ──────────────────────────────────────────
do $$ declare ok bool := false; begin
  begin insert into students(school_id, name) values ('418a2a9d-12f7-4d1f-8c6a-4018eacff158','A-evil'); exception when others then ok := true; end;
  insert into public._iso_results values ('A INSERT into students blocked', 'blocked', case when ok then 'blocked' else 'succeeded (BAD)' end, ok);
end $$;
do $$ declare ok bool := false; begin
  begin insert into buses(school_id, label) values ('418a2a9d-12f7-4d1f-8c6a-4018eacff158','A-evil-bus'); exception when others then ok := true; end;
  insert into public._iso_results values ('A INSERT into buses blocked', 'blocked', case when ok then 'blocked' else 'succeeded (BAD)' end, ok);
end $$;
do $$ declare ok bool := false; begin
  begin insert into parent_students(parent_user_id, student_id) values ('39ea7c5f-a930-4fb6-bb5c-ff11b17751e1','6f19e413-647a-4d48-866e-baa52946ea30'); exception when others then ok := true; end;
  insert into public._iso_results values ('A INSERT parent_students self->B student blocked', 'blocked', case when ok then 'blocked' else 'succeeded (BAD)' end, ok);
end $$;
do $$ declare n int; begin
  update device_status set battery_level = 0 where user_id='7a79ba0f-4068-44d8-be57-7a600be05d01';
  get diagnostics n = row_count;
  insert into public._iso_results values ('A UPDATE B driver device_status affects 0 rows', '0 rows', n||' rows', n = 0);
end $$;
do $$ declare n int; begin
  update students set name = name || ' hacked' where id='6f19e413-647a-4d48-866e-baa52946ea30';
  get diagnostics n = row_count;
  insert into public._iso_results values ('A UPDATE B student affects 0 rows', '0 rows', n||' rows', n = 0);
end $$;

reset role; reset request.jwt.claims;

-- Symmetric: B cannot see A's data
set local role authenticated;
set local request.jwt.claims = '{"sub":"0b420c06-efda-4ef1-bb03-e07f58afd5d3","role":"authenticated"}';

insert into public._iso_results
  select 'B reads A student (Aline U.) — RLS should hide', '0', count(*)::text, count(*) = 0
    from students where id='00d3cbdf-386c-4a84-bfaf-16b75cdacbab';
insert into public._iso_results
  select 'B reads A bus (Isabuku) — RLS should hide', '0', count(*)::text, count(*) = 0
    from buses where id='e463e43f-8dd2-4180-9d91-31bc51f5dcc6';
insert into public._iso_results
  select 'B reads A driver device_status (Guy) — RLS should hide', '0', count(*)::text, count(*) = 0
    from device_status where user_id='eb8c60bb-f323-496e-8fa1-5e39f4a23f28';

reset role; reset request.jwt.claims;

-- ── (iv) Used code cannot be redeemed twice; expired code is rejected ──────
-- Simulate the server-side "is this invite valid?" filter:
--   used_at is null AND (expires_at is null OR expires_at > now())
do $$ declare hit int; begin
  update invites set used_at = now() where code='KIGALI-DEMO-A1' and used_at is null;
  select count(*) into hit from invites
    where code='KIGALI-DEMO-A1' and used_at is null
      and (expires_at is null or expires_at > now());
  insert into public._iso_results values ('Used code KIGALI-DEMO-A1 no longer redeemable', '0', hit::text, hit = 0);
end $$;
do $$ declare hit int; begin
  update invites set expires_at = now() - interval '1 minute' where code='KIGALI-DEMO-B2' and used_at is null;
  select count(*) into hit from invites
    where code='KIGALI-DEMO-B2' and used_at is null
      and (expires_at is null or expires_at > now());
  insert into public._iso_results values ('Expired code KIGALI-DEMO-B2 no longer redeemable', '0', hit::text, hit = 0);
end $$;

select step, expected, actual, passed from public._iso_results order by step;

rollback;
