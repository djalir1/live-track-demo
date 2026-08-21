-- ============================================================================
-- SCRIPT 3 — FRESH-PILOT RESET (safe if you know what you're doing)
-- ============================================================================
-- Wipes everything a pilot start should not carry over:
--   * every parent auth user + their profile, role, parent_students, invite
--   * every location point, trip session, device_status, geofence event,
--     bus_current_stop, parent_notification_prefs
--   * every invite (used, expired, or unused)
--
-- KEEPS:
--   * the 4 non-parent auth users (2 admins + 2 drivers) and their profiles,
--     roles, and school link
--   * the school itself, routes, stops, buses, students (the setup you'd
--     otherwise have to rebuild by hand)
--
-- Idempotent — running it again on an already-clean DB is a no-op.
-- Nothing outside this file is affected.
--
-- Run with:
--   psql "$SUPABASE_DB_URL" -f scripts/reset-fresh-pilot.sql

begin;

-- 1. Runtime / tracking data — none of it is real.
delete from public.geofence_events           where 1=1;
delete from public.bus_current_stop          where 1=1;
delete from public.location_history          where 1=1;
delete from public.trip_sessions             where 1=1;
delete from public.device_status             where 1=1;
delete from public.parent_notification_prefs where 1=1;

-- 2. Parent linkage + invites (both are per-parent).
delete from public.parent_students where 1=1;
delete from public.invites         where 1=1;

-- 3. All parent user_roles rows.
delete from public.user_roles where role = 'parent';

-- 4. Parent profiles.
delete from public.profiles
  where id in (select id from auth.users where email like '%@parent.pulse.local');

-- 5. Parent auth users (final "revoke sign-in" step).
delete from auth.users where email like '%@parent.pulse.local';

-- 6. Post-clean inventory — every row should be zero except the four
-- non-parent auth users and the intact school setup.
select 'auth.users'          t, count(*) n from auth.users
union all select 'profiles',          count(*) from public.profiles
union all select 'user_roles',        count(*) from public.user_roles
union all select 'schools',           count(*) from public.schools
union all select 'routes',            count(*) from public.routes
union all select 'stops',             count(*) from public.stops
union all select 'buses',             count(*) from public.buses
union all select 'students',          count(*) from public.students
union all select 'invites',           count(*) from public.invites
union all select 'parent_students',   count(*) from public.parent_students
union all select 'device_status',     count(*) from public.device_status
union all select 'location_history',  count(*) from public.location_history
union all select 'trip_sessions',     count(*) from public.trip_sessions
union all select 'geofence_events',   count(*) from public.geofence_events
union all select 'bus_current_stop',  count(*) from public.bus_current_stop
union all select 'parent_notification_prefs', count(*) from public.parent_notification_prefs
order by t;

commit;
