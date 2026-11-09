-- School attendance: lock down internal helpers (Supabase security advisor).
-- Trigger functions and _bus_name are only called by other SQL; nobody
-- should reach them through the API. Pin search_path on plain helpers.
-- Applied to production on 2026-11-09. Idempotent.
revoke all on function public._bus_name(uuid) from public, anon, authenticated;
revoke all on function public._attendance_on_stop_event() from public, anon, authenticated;
revoke all on function public._sync_parent_links() from public, anon, authenticated;
revoke all on function public._people_before_write() from public, anon, authenticated;
alter function public.kigali_today() set search_path = public;
alter function public.normalize_phone(text) set search_path = public;
alter function public._six_digits() set search_path = public;
alter function public._hhmm(timestamptz) set search_path = public;
alter function public._people_before_write() set search_path = public;
