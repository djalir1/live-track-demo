-- Parent /me live-signal test. Simulates Bus 1 (Guy) actively reporting and
-- Bus 2 (Shema) being stale, then reads under Parent A's session to prove:
--   * Parent A observes Guy's fresh moving row → banner would say "moving"
--   * Parent A observes Guy's open trip_session
--   * Parent A does NOT observe Shema's row (RLS)
--   * If Guy's row goes stale (>90s), Parent A still sees the row but with
--     an old last_seen — the derivePresence rule (client-side) flips the
--     banner to "offline". The row itself never becomes invisible under RLS.
--
-- Everything runs in a single transaction and rolls back at the end, so
-- Guy's real device_status is untouched after the run.
--
-- Run with: psql "$SUPABASE_DB_URL" -f scripts/test-parent-live.sql

begin;

create table if not exists public._live_results(
  step text primary key, expected text, actual text, passed boolean);
truncate public._live_results;
grant all on public._live_results to authenticated;

-- Guy needs an OPEN trip_session for the "not no-trip-today" branch to fire.
insert into trip_sessions(user_id, started_at, ended_at)
select 'eb8c60bb-f323-496e-8fa1-5e39f4a23f28', now(), null
where not exists (
  select 1 from trip_sessions
  where user_id='eb8c60bb-f323-496e-8fa1-5e39f4a23f28' and ended_at is null
);

-- Bus 1 (Guy): fresh, moving.
update device_status set
  latitude=-1.9536, longitude=30.0605, speed_kmh=42, status='moving',
  is_tracking=true, last_seen=now(), updated_at=now()
where user_id='eb8c60bb-f323-496e-8fa1-5e39f4a23f28';

-- Bus 2 (Shema): deliberately stale.
update device_status set
  latitude=0.3163, longitude=32.5822, speed_kmh=0, status='moving',
  last_seen = now() - interval '15 minutes'
where user_id='7a79ba0f-4068-44d8-be57-7a600be05d01';

-- ── As Parent A ─────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"39ea7c5f-a930-4fb6-bb5c-ff11b17751e1","role":"authenticated"}';

with q as (select now() - last_seen as age from device_status
           where user_id='eb8c60bb-f323-496e-8fa1-5e39f4a23f28')
insert into public._live_results
  select 'A sees Guy device_status (fresh <30s)', 'true',
         (age < interval '30 seconds')::text,  age < interval '30 seconds'
  from q;

with q as (select speed_kmh from device_status
           where user_id='eb8c60bb-f323-496e-8fa1-5e39f4a23f28')
insert into public._live_results
  select 'A sees Guy speed_kmh > 0.8 (moving)', 'true',
         (coalesce(speed_kmh, 0) > 0.8)::text,  coalesce(speed_kmh, 0) > 0.8
  from q;

insert into public._live_results
  select 'A sees Guy has open trip_session', 'true', (count(*) > 0)::text, count(*) > 0
  from trip_sessions
  where user_id='eb8c60bb-f323-496e-8fa1-5e39f4a23f28' and ended_at is null;

-- Isolation: Parent A gets 0 rows for Shema's device_status.
insert into public._live_results
  select 'A sees Shema device_status (RLS should hide)', '0', count(*)::text, count(*) = 0
  from device_status where user_id='7a79ba0f-4068-44d8-be57-7a600be05d01';

reset role; reset request.jwt.claims;

-- ── Flip Guy stale (>90s), re-read as A ─────────────────────────────────────
update device_status set last_seen = now() - interval '3 minutes'
  where user_id='eb8c60bb-f323-496e-8fa1-5e39f4a23f28';

set local role authenticated;
set local request.jwt.claims = '{"sub":"39ea7c5f-a930-4fb6-bb5c-ff11b17751e1","role":"authenticated"}';

insert into public._live_results
  select 'After stall: A still SEEs Guy row (client derives offline)', 'true',
         (count(*) = 1)::text, count(*) = 1
  from device_status where user_id='eb8c60bb-f323-496e-8fa1-5e39f4a23f28';

with q as (select now() - last_seen as age from device_status
           where user_id='eb8c60bb-f323-496e-8fa1-5e39f4a23f28')
insert into public._live_results
  select 'After stall: age > 90s (client shows offline)', 'true',
         (age > interval '90 seconds')::text,  age > interval '90 seconds'
  from q;

reset role; reset request.jwt.claims;

select step, expected, actual, passed from public._live_results order by step;

rollback;
