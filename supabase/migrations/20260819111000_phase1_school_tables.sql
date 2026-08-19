-- ────────────────────────────────────────────────────────────────────────────
-- Parent-tracking Phase 1: school setup tables.
-- ────────────────────────────────────────────────────────────────────────────
-- Idempotent: safe to re-apply. Nothing is dropped, wiped, or recreated.
-- On this DB the four tables and their existing policies were already added
-- by prior work; these statements are no-ops there. The file exists so a
-- fresh DB gets the correct shape from repo history alone.
-- ────────────────────────────────────────────────────────────────────────────

-- 1. routes
create table if not exists public.routes (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
alter table public.routes enable row level security;

-- 2. stops (named geofences)
create table if not exists public.stops (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references public.routes(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete cascade,
  name text not null,
  lat double precision,
  lng double precision,
  radius_m integer not null default 120,
  sequence integer,
  type text not null default 'pickup' check (type in ('school','pickup')),
  created_at timestamptz not null default now()
);
alter table public.stops enable row level security;

-- 3. buses (live position = device_status of driver_user_id)
create table if not exists public.buses (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  route_id uuid references public.routes(id) on delete set null,
  plate text,
  label text,
  capacity integer,
  driver_user_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.buses enable row level security;

-- 4. students
create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  bus_id uuid references public.buses(id) on delete set null,
  name text not null,
  home_stop_id uuid references public.stops(id) on delete set null,
  class text,
  created_at timestamptz not null default now()
);
alter table public.students enable row level security;

-- ── RLS policies (idempotent via DO blocks) ─────────────────────────────────
-- Postgres has no CREATE POLICY IF NOT EXISTS; we swallow duplicate_object
-- so a re-apply doesn't error.

-- super-admin: full ALL access on all four tables
do $$ begin
  create policy "super admin all routes" on public.routes for all to authenticated
    using (public.has_role(auth.uid(),'admin'::app_role))
    with check (public.has_role(auth.uid(),'admin'::app_role));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "super admin all stops" on public.stops for all to authenticated
    using (public.has_role(auth.uid(),'admin'::app_role))
    with check (public.has_role(auth.uid(),'admin'::app_role));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "super admin all buses" on public.buses for all to authenticated
    using (public.has_role(auth.uid(),'admin'::app_role))
    with check (public.has_role(auth.uid(),'admin'::app_role));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "super admin all students" on public.students for all to authenticated
    using (public.has_role(auth.uid(),'admin'::app_role))
    with check (public.has_role(auth.uid(),'admin'::app_role));
exception when duplicate_object then null; end $$;

-- school_admin: full CRUD, scoped to own school via same_school()
do $$ begin
  create policy "school admin same_school routes" on public.routes for all to authenticated
    using (public.same_school(school_id))
    with check (public.same_school(school_id));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "school admin same_school stops" on public.stops for all to authenticated
    using (public.same_school(school_id))
    with check (public.same_school(school_id));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "school admin same_school buses" on public.buses for all to authenticated
    using (public.same_school(school_id))
    with check (public.same_school(school_id));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "school admin same_school students" on public.students for all to authenticated
    using (public.same_school(school_id))
    with check (public.same_school(school_id));
exception when duplicate_object then null; end $$;

-- driver ('user'): SELECT the bus / route / stops they're assigned to. No writes.
do $$ begin
  create policy "driver select own bus" on public.buses for select to authenticated
    using (driver_user_id = auth.uid());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "driver select own route" on public.routes for select to authenticated
    using (exists (
      select 1 from public.buses b
      where b.route_id = routes.id and b.driver_user_id = auth.uid()
    ));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "driver select own stops" on public.stops for select to authenticated
    using (exists (
      select 1 from public.buses b
      where b.route_id = stops.route_id and b.driver_user_id = auth.uid()
    ));
exception when duplicate_object then null; end $$;

-- Parent access is deferred to Phase 2 and is intentionally not added here.
