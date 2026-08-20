-- ============================================================================
-- SCRIPT 1 — CLEAR SIMULATED TRACKING DATA ONLY (safe)
-- ============================================================================
-- What this script deletes:
--    * location_history         (all GPS points)
--    * device_status            (all live-position rows)
--    * trip_sessions            (all Start/Stop button records)
--    * geofence_events          (all arrive/depart events)
--    * bus_current_stop         (internal geofence state)
--    * parent_notification_prefs (parent push-toggle state — fresh subs on pilot)
--
-- What this script KEEPS (untouched):
--    * auth.users                          — every login stays
--    * profiles, user_roles                — admin, drivers, parents keep access
--    * schools, routes, stops, buses, students — school setup intact
--    * invites, parent_students            — parent linkage intact
--
-- Effect: the pilot starts with a clean movement history. Admin can still log
-- in, drivers can still open /track, parents can still open /me. There will be
-- no fake positions or events on the map until real driver phones start
-- reporting.
--
-- Idempotent: safe to re-run. Deletion is with WHERE 1=1 so the row-count
-- reported after each statement is auditable in the psql output.
--
-- Run with:
--    psql "$SUPABASE_DB_URL" -f scripts/reset-tracking-only.sql
-- or via the Supabase SQL editor. Both surface the "DELETE N" counts.
-- ============================================================================

begin;

-- Order matters if FKs exist; these tables have no cross-refs that would
-- block deletion, but the order below matches "leaves first" for clarity.
delete from public.geofence_events         where 1=1;
delete from public.bus_current_stop        where 1=1;
delete from public.location_history        where 1=1;
delete from public.trip_sessions           where 1=1;
delete from public.device_status           where 1=1;
delete from public.parent_notification_prefs where 1=1;

-- Sanity: every simulated-tracking table is now empty; every setup table is
-- still populated.
select 'device_status'             t, count(*) n from public.device_status
union all select 'location_history',      count(*) from public.location_history
union all select 'trip_sessions',         count(*) from public.trip_sessions
union all select 'geofence_events',       count(*) from public.geofence_events
union all select 'bus_current_stop',      count(*) from public.bus_current_stop
union all select 'parent_notification_prefs', count(*) from public.parent_notification_prefs
union all select '--',                    NULL
union all select 'auth.users',            count(*) from auth.users
union all select 'profiles',              count(*) from public.profiles
union all select 'user_roles',            count(*) from public.user_roles
union all select 'schools',               count(*) from public.schools
union all select 'routes',                count(*) from public.routes
union all select 'stops',                 count(*) from public.stops
union all select 'buses',                 count(*) from public.buses
union all select 'students',              count(*) from public.students
union all select 'invites',               count(*) from public.invites
union all select 'parent_students',       count(*) from public.parent_students
order by t nulls last;

commit;
