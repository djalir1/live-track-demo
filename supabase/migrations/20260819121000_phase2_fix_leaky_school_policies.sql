-- ────────────────────────────────────────────────────────────────────────────
-- Phase 2 addendum: fix leaky same-school policies that broke parent isolation.
-- ────────────────────────────────────────────────────────────────────────────
-- The Phase 2 isolation test (scripts/test-parent-isolation.sql) proved a
-- critical child-safety leak: a parent whose profiles.school_id matched
-- another child's school could SELECT, UPDATE and INSERT students, buses,
-- routes and stops in that whole school. Two families of policies caused it:
--
--   1. Four "school admin same_school X" policies added in Phase 1 used
--      same_school() FOR ALL. same_school() is loose by Phase 0 spec — it
--      only checks profiles.school_id, not the caller's role. Parents share
--      the school, so they passed.
--
--   2. Two pre-existing "member sees routes/stops in school" SELECT
--      policies granted read to any authenticated user of the school —
--      again, parents included.
--
-- Fix: drop these six policies. School-admin CRUD is still covered by the
-- pre-existing "school admin all X in school" policies (which use
-- is_school_admin_of() and DO check role). Drivers keep their "driver
-- select own X" reads (Phase 1). Parents keep the Phase 2 "parent sees ..."
-- reads for their own child.
--
-- Idempotent: DROP POLICY IF EXISTS is safe to re-apply.

drop policy if exists "school admin same_school routes"   on public.routes;
drop policy if exists "school admin same_school stops"    on public.stops;
drop policy if exists "school admin same_school buses"    on public.buses;
drop policy if exists "school admin same_school students" on public.students;

drop policy if exists "member sees routes in school" on public.routes;
drop policy if exists "member sees stops in school"  on public.stops;
