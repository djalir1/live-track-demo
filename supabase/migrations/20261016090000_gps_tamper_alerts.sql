-- ────────────────────────────────────────────────────────────────────────────
-- GPS tracker tamper alerts + push delivery errors.
-- ────────────────────────────────────────────────────────────────────────────
-- gps-server writes these fleet_events itself (not a trigger):
--   gps_tamper   tracker says it lost the vehicle's power / was removed /
--                is switching off / SIM changed (detail = what happened)
--   gps_offline  no report for 30 min (detail = last report, Kigali time)
--   gps_back     power back or reporting again
-- device_status.power_cut_at / silent_since hold the open incident, so the
-- dashboard can flag the vehicle and a server restart doesn't repeat alerts.
--
-- Idempotent: safe to re-run.
-- ────────────────────────────────────────────────────────────────────────────

-- 1. New event kinds ───────────────────────────────────────────────────────────
do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.fleet_events'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%kind%'
  loop
    execute format('alter table public.fleet_events drop constraint %I', c);
  end loop;
end $$;
alter table public.fleet_events add constraint fleet_events_kind_check
  check (kind in ('trip_started', 'trip_ended', 'test', 'gps_tamper', 'gps_offline', 'gps_back'));
alter table public.fleet_events add column if not exists detail text;

-- 2. Open tamper incident per tracker (read by the dashboard) ────────────────
alter table public.device_status add column if not exists power_cut_at timestamptz;
alter table public.device_status add column if not exists silent_since timestamptz;

-- 3. On/off setting (no row = on) ──────────────────────────────────────────────
alter table public.notification_prefs add column if not exists gps_tamper boolean not null default true;

-- 4. Why a phone gets nothing (shown on the Alerts page) ─────────────────────
alter table public.push_subscriptions add column if not exists last_error text;
alter table public.push_subscriptions add column if not exists last_error_at timestamptz;
