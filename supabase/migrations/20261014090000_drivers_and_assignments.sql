-- ────────────────────────────────────────────────────────────────────────────
-- Drivers as first-class records + who-drove-which-vehicle-when history.
-- ────────────────────────────────────────────────────────────────────────────
--   drivers              one row per person (with or without the driver app)
--   vehicle_assignments  driver ↔ bus over time; ended_at null = current
--
-- buses.driver_user_id / buses.gps_driver_name stay as the "current driver"
-- the gps-server and dashboard already read. Triggers below keep them in sync
-- with the open assignment, so nothing else has to change:
--   • driver with the app      → driver_user_id = their account, gps_driver_name null
--   • driver without the app   → gps_driver_name = their name; driver_user_id keeps
--                                the bus's tracker account (gps-server creates it)
--   • no driver, has tracker   → gps_driver_name = 'No driver'
-- Positions stay keyed by user_id, so "who drove bus X at time T" is a join of
-- location_history/trip_sessions time with vehicle_assignments.
--
-- Idempotent: safe to re-run.
-- ────────────────────────────────────────────────────────────────────────────

create table if not exists public.drivers (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  full_name text not null check (length(btrim(full_name)) > 0),
  phone text,
  license_number text,
  notes text,
  -- Their Live Track driver-app account, when they use the phone app.
  user_id uuid unique references public.profiles(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists drivers_school_idx on public.drivers (school_id, full_name);
alter table public.drivers enable row level security;

drop trigger if exists drivers_touch on public.drivers;
create trigger drivers_touch before update on public.drivers
  for each row execute function public.touch_updated_at();

create table if not exists public.vehicle_assignments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  bus_id uuid not null references public.buses(id) on delete cascade,
  -- restrict: a driver with history is archived (active = false), not deleted.
  driver_id uuid not null references public.drivers(id) on delete restrict,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  assigned_by uuid default auth.uid() references auth.users(id) on delete set null,
  constraint vehicle_assignments_period check (ended_at is null or ended_at >= started_at)
);
create unique index if not exists vehicle_assignments_one_open_per_bus
  on public.vehicle_assignments (bus_id) where ended_at is null;
create unique index if not exists vehicle_assignments_one_open_per_driver
  on public.vehicle_assignments (driver_id) where ended_at is null;
create index if not exists vehicle_assignments_bus_time on public.vehicle_assignments (bus_id, started_at desc);
create index if not exists vehicle_assignments_driver_time on public.vehicle_assignments (driver_id, started_at desc);
alter table public.vehicle_assignments enable row level security;

-- ── RLS ─────────────────────────────────────────────────────────────────────
do $$ begin
  create policy "school admin same_school drivers" on public.drivers for all to authenticated
    using (public.same_school(school_id)) with check (public.same_school(school_id));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "driver select self" on public.drivers for select to authenticated
    using (user_id = auth.uid());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "school admin same_school assignments" on public.vehicle_assignments for all to authenticated
    using (public.same_school(school_id)) with check (public.same_school(school_id));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "driver select own assignments" on public.vehicle_assignments for select to authenticated
    using (exists (select 1 from public.drivers d where d.id = driver_id and d.user_id = auth.uid()));
exception when duplicate_object then null; end $$;

-- ── Keep buses' "current driver" columns in sync ────────────────────────────
create or replace function public.sync_bus_driver(p_bus uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.buses;
  d public.drivers;
begin
  select * into b from public.buses where id = p_bus;
  if not found then return; end if;

  select dr.* into d
    from public.vehicle_assignments va
    join public.drivers dr on dr.id = va.driver_id
   where va.bus_id = p_bus and va.ended_at is null;

  if d.id is not null and d.user_id is not null then
    update public.buses set driver_user_id = d.user_id, gps_driver_name = null where id = p_bus;
  else
    update public.buses
       set gps_driver_name = case
             when d.id is not null then d.full_name
             when b.gps_imei is not null then 'No driver'
             else null end,
           -- keep the tracker account only if the bus was already in tracker mode
           driver_user_id = case when b.gps_driver_name is not null then b.driver_user_id else null end
     where id = p_bus;
  end if;
end
$$;
revoke all on function public.sync_bus_driver(uuid) from public, anon, authenticated;

create or replace function public.vehicle_assignments_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then perform public.sync_bus_driver(old.bus_id); end if;
  if tg_op in ('INSERT', 'UPDATE') and (tg_op = 'INSERT' or new.bus_id <> old.bus_id) then
    perform public.sync_bus_driver(new.bus_id);
  end if;
  return null;
end
$$;
drop trigger if exists vehicle_assignments_sync on public.vehicle_assignments;
create trigger vehicle_assignments_sync after insert or update or delete on public.vehicle_assignments
  for each row execute function public.vehicle_assignments_sync();

create or replace function public.drivers_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_bus uuid;
begin
  if new.full_name is distinct from old.full_name or new.user_id is distinct from old.user_id then
    for v_bus in select bus_id from public.vehicle_assignments where driver_id = new.id and ended_at is null loop
      perform public.sync_bus_driver(v_bus);
    end loop;
  end if;
  return null;
end
$$;
drop trigger if exists drivers_sync on public.drivers;
create trigger drivers_sync after update on public.drivers
  for each row execute function public.drivers_sync();

-- ── assign_driver(bus, driver|null): the one way the app changes drivers ────
-- Ends the bus's current assignment and the driver's assignment elsewhere,
-- then opens a new one. Runs as the caller, so RLS still applies.
create or replace function public.assign_driver(p_bus uuid, p_driver uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_school uuid;
begin
  select school_id into v_school from public.buses where id = p_bus for update;
  if v_school is null then raise exception 'Vehicle not found'; end if;

  if p_driver is not null and exists (
    select 1 from public.vehicle_assignments where bus_id = p_bus and driver_id = p_driver and ended_at is null
  ) then
    return; -- already assigned
  end if;

  if p_driver is not null and not exists (
    select 1 from public.drivers where id = p_driver and school_id = v_school
  ) then
    raise exception 'Driver not found in this school';
  end if;

  update public.vehicle_assignments set ended_at = now()
   where ended_at is null and (bus_id = p_bus or (p_driver is not null and driver_id = p_driver));

  if p_driver is not null then
    insert into public.vehicle_assignments (school_id, bus_id, driver_id) values (v_school, p_bus, p_driver);
  end if;
end
$$;
grant execute on function public.assign_driver(uuid, uuid) to authenticated;

-- ── Backfill from today's buses (only when nothing has been migrated yet) ───
do $$
declare
  r record;
  v_driver uuid;
begin
  if exists (select 1 from public.drivers) then return; end if;

  -- 1. Everyone already driving with the app (role 'user', has a school),
  --    except the gps-server's tracker accounts.
  insert into public.drivers (school_id, full_name, user_id)
  select p.school_id, coalesce(nullif(btrim(p.display_name), ''), 'Driver'), p.id
    from public.profiles p
    join public.user_roles ur on ur.user_id = p.id and ur.role = 'user'
    join auth.users u on u.id = p.id
   where p.school_id is not null
     and u.email not like 'gps-%@livetrack.app';

  -- 2. Each bus's current driver → a driver row (if needed) + open assignment.
  for r in
    select b.*, p.display_name
      from public.buses b
      left join public.profiles p on p.id = b.driver_user_id
  loop
    v_driver := null;
    if r.gps_driver_name is not null and r.gps_driver_name <> 'No driver' then
      insert into public.drivers (school_id, full_name) values (r.school_id, r.gps_driver_name)
      returning id into v_driver;
    elsif r.gps_driver_name is null and r.driver_user_id is not null then
      select id into v_driver from public.drivers where user_id = r.driver_user_id;
    end if;
    if v_driver is not null then
      insert into public.vehicle_assignments (school_id, bus_id, driver_id, started_at, assigned_by)
      values (r.school_id, r.id, v_driver, r.created_at, null)
      on conflict do nothing;
    end if;
  end loop;
end
$$;
