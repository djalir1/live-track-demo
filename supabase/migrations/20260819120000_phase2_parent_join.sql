-- ────────────────────────────────────────────────────────────────────────────
-- Parent-tracking Phase 2: invites, parent_students, and their RLS.
-- ────────────────────────────────────────────────────────────────────────────
-- Idempotent: every statement is safe to re-apply on a DB where it already
-- ran. Nothing is dropped or recreated. No data is deleted.
-- ────────────────────────────────────────────────────────────────────────────

-- 1. invites — school-scoped, single-use codes that link one or more students.
create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  code text unique not null,
  phone text,
  student_ids uuid[] not null,
  expires_at timestamptz,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.invites enable row level security;

-- Spec says phone is optional. If the column was previously created NOT NULL
-- (as on this DB), relax it — no data loss, just a constraint change.
alter table public.invites alter column phone drop not null;

-- 2. parent_students — links parent auth users to students they may see.
create table if not exists public.parent_students (
  parent_user_id uuid not null references public.profiles(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (parent_user_id, student_id)
);
alter table public.parent_students enable row level security;

-- 3. SECURITY DEFINER helpers. On a DB where an earlier version already
-- exists with parameter names `_student_id` / `_bus_id`, CREATE OR REPLACE
-- cannot rename them and the spec forbids DROP. We keep the existing names
-- so the function body is what CREATE OR REPLACE actually updates.
create or replace function public.is_parent_of_student(_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.parent_students
    where parent_user_id = auth.uid()
      and student_id = _student_id
  )
$$;

create or replace function public.is_parent_of_bus(_bus_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.students s
    join public.parent_students ps on ps.student_id = s.id
    where ps.parent_user_id = auth.uid()
      and s.bus_id = _bus_id
  )
$$;

-- 4. RLS policies for parent access (idempotent via DO/EXCEPTION). Nothing
-- writable for parents — server-side redeem uses service role.

do $$ begin
  create policy "parent sees own parent_students" on public.parent_students
    for select to authenticated
    using (parent_user_id = auth.uid());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "parent sees own students" on public.students
    for select to authenticated
    using (public.is_parent_of_student(id));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "parent sees own child bus" on public.buses
    for select to authenticated
    using (public.is_parent_of_bus(id));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "parent sees routes for own child bus" on public.routes
    for select to authenticated
    using (exists (
      select 1 from public.buses b
      where b.route_id = routes.id and public.is_parent_of_bus(b.id)
    ));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "parent sees stops for own child route" on public.stops
    for select to authenticated
    using (exists (
      select 1 from public.buses b
      where b.route_id = stops.route_id and public.is_parent_of_bus(b.id)
    ));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "parent sees bus device_status" on public.device_status
    for select to authenticated
    using (exists (
      select 1 from public.buses b
      where b.driver_user_id = device_status.user_id and public.is_parent_of_bus(b.id)
    ));
exception when duplicate_object then null; end $$;
