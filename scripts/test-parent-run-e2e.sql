-- End-to-end parent run test.
--
-- Simulates Bus 1 (Guy) doing the whole Route A: Kimironko → outside →
-- Nyarugenge → outside → School. The AFTER INSERT trigger on
-- location_history fires geofence_events on every transition. Reads as
-- Parent A (who is linked to a child on Bus 1) and Parent B (linked to
-- Bus 2) to prove RLS lets A see A's events and hides them from B.
--
-- The child Aline U. is TEMPORARILY moved to home=Nyarugenge for the run
-- so pre-home = Kimironko is exercised. Everything rolls back — Aline's
-- real home_stop_id (Kimironko) is untouched after.
--
-- Run with: psql "$SUPABASE_DB_URL" -f scripts/test-parent-run-e2e.sql

begin;

create table if not exists public._run_results(
  step text primary key, expected text, actual text, passed boolean);
truncate public._run_results;
grant all on public._run_results to authenticated;

delete from public.bus_current_stop where bus_id='e463e43f-8dd2-4180-9d91-31bc51f5dcc6';
delete from public.geofence_events   where bus_id='e463e43f-8dd2-4180-9d91-31bc51f5dcc6' and occurred_at > now() - interval '30 minutes';

-- Move Aline's home to Nyarugenge for this test only (pre-home = Kimironko).
update public.students set home_stop_id='bb5cd5ef-9734-479f-99a8-1e551b45a69e'
  where id='00d3cbdf-386c-4a84-bfaf-16b75cdacbab';

-- Ensure Guy has an open trip_session so /me won't show "no-trip".
insert into public.trip_sessions(user_id, started_at, ended_at)
select 'eb8c60bb-f323-496e-8fa1-5e39f4a23f28', now(), null
where not exists (select 1 from public.trip_sessions
  where user_id='eb8c60bb-f323-496e-8fa1-5e39f4a23f28' and ended_at is null);

-- Five points along Route A. Trigger fires on each insert.
insert into public.location_history(user_id, latitude, longitude, speed_kmh, recorded_at) values
  ('eb8c60bb-f323-496e-8fa1-5e39f4a23f28', -1.9345, 30.1250, 5,  now()),                              -- inside Kimironko
  ('eb8c60bb-f323-496e-8fa1-5e39f4a23f28', -1.9420, 30.0900, 35, now() + interval '3 minutes'),        -- outside all
  ('eb8c60bb-f323-496e-8fa1-5e39f4a23f28', -1.9500, 30.0580, 6,  now() + interval '8 minutes'),        -- inside Nyarugenge (HOME)
  ('eb8c60bb-f323-496e-8fa1-5e39f4a23f28', -1.9510, 30.0700, 30, now() + interval '11 minutes'),       -- outside all
  ('eb8c60bb-f323-496e-8fa1-5e39f4a23f28', -1.9536, 30.0906, 3,  now() + interval '15 minutes');       -- inside School

-- ── As Parent A ─────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"39ea7c5f-a930-4fb6-bb5c-ff11b17751e1","role":"authenticated"}';

insert into public._run_results select 'A sees 5 events on Bus 1', '5', count(*)::text, count(*)=5
  from public.geofence_events where bus_id='e463e43f-8dd2-4180-9d91-31bc51f5dcc6'
    and occurred_at > now() - interval '30 minutes';
insert into public._run_results select 'A sees arrive(Kimironko) - pre-home', '1', count(*)::text, count(*)=1
  from public.geofence_events where bus_id='e463e43f-8dd2-4180-9d91-31bc51f5dcc6'
    and stop_id='bcf7c23e-a9ec-49d1-bd28-9bf37e83e527' and event_type='arrive' and occurred_at > now() - interval '30 minutes';
insert into public._run_results select 'A sees arrive(Nyarugenge) - HOME', '1', count(*)::text, count(*)=1
  from public.geofence_events where bus_id='e463e43f-8dd2-4180-9d91-31bc51f5dcc6'
    and stop_id='bb5cd5ef-9734-479f-99a8-1e551b45a69e' and event_type='arrive' and occurred_at > now() - interval '30 minutes';
insert into public._run_results select 'A sees depart(Nyarugenge) - Passed', '1', count(*)::text, count(*)=1
  from public.geofence_events where bus_id='e463e43f-8dd2-4180-9d91-31bc51f5dcc6'
    and stop_id='bb5cd5ef-9734-479f-99a8-1e551b45a69e' and event_type='depart' and occurred_at > now() - interval '30 minutes';
insert into public._run_results select 'A sees Bus 2 events (RLS should hide)', '0', count(*)::text, count(*)=0
  from public.geofence_events where bus_id='9d325d2a-028d-41c9-8627-81db422e1c09';

reset role; reset request.jwt.claims;

-- ── As Parent B ─────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"0b420c06-efda-4ef1-bb03-e07f58afd5d3","role":"authenticated"}';

insert into public._run_results select 'B sees Bus 1 events (RLS should hide)', '0', count(*)::text, count(*)=0
  from public.geofence_events where bus_id='e463e43f-8dd2-4180-9d91-31bc51f5dcc6'
    and occurred_at > now() - interval '30 minutes';

reset role; reset request.jwt.claims;

select step, expected, actual, passed from public._run_results order by step;

rollback;
