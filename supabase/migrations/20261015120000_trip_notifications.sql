-- ────────────────────────────────────────────────────────────────────────────
-- Trip alerts for owners (admin / school_admin), delivered as phone (PWA) push.
-- ────────────────────────────────────────────────────────────────────────────
--   fleet_events            one row per "trip started" / "parked, engine off"
--   push_subscriptions      one row per phone/browser that allowed notifications
--   notification_prefs      per-user on/off for each kind of alert
--
-- Where events come from: device_status.is_tracking flipping.
--   • GPS tracker bus: gps-server sets it true at engine on and false only after
--     90 s with no running signal (ignition off), so a red light or a traffic
--     jam never counts as "parked".
--   • Driver phone app: true on Start, false on Stop / sign-out.
-- Who sends the push: gps-server (always on, holds the service key and the
-- VAPID private key) polls fleet_events where pushed_at is null.
--
-- Idempotent: safe to re-run.
-- ────────────────────────────────────────────────────────────────────────────

-- 1. Events ───────────────────────────────────────────────────────────────────
create table if not exists public.fleet_events (
  id bigserial primary key,
  kind text not null check (kind in ('trip_started', 'trip_ended', 'test')),
  school_id uuid references public.schools(id) on delete cascade,
  bus_id uuid references public.buses(id) on delete set null,
  driver_user_id uuid references public.profiles(id) on delete set null,
  -- Snapshot at the time of the event, so the alert reads right even if the
  -- bus is renamed later.
  vehicle_label text,
  plate text,
  driver_name text,
  route_name text,
  -- trip_ended: km driven this trip and when it started.
  distance_m integer,
  trip_started_at timestamptz,
  -- 'test' events go to this one user only.
  target_user_id uuid references public.profiles(id) on delete cascade,
  occurred_at timestamptz not null default now(),
  pushed_at timestamptz,
  created_at timestamptz not null default now()
);
-- Re-run safety for a table created by an earlier draft of this file.
alter table public.fleet_events add column if not exists route_name text;

create index if not exists fleet_events_unpushed on public.fleet_events (id) where pushed_at is null;
create index if not exists fleet_events_school_time on public.fleet_events (school_id, occurred_at desc);
create index if not exists fleet_events_driver_time on public.fleet_events (driver_user_id, occurred_at desc);
alter table public.fleet_events enable row level security;

do $$ begin
  create policy "owners read fleet events" on public.fleet_events for select to authenticated
    using (
      target_user_id = auth.uid()
      or (target_user_id is null and (
        public.has_role(auth.uid(), 'admin'::app_role)
        or (school_id is not null and public.has_role(auth.uid(), 'school_admin'::app_role) and public.same_school(school_id))
      ))
    );
exception when duplicate_object then null; end $$;

-- 2. Push subscriptions (one per device) ──────────────────────────────────────
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_ok_at timestamptz
);
create index if not exists push_subscriptions_user on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;

do $$ begin
  create policy "own push subscriptions" on public.push_subscriptions for all to authenticated
    using (user_id = auth.uid()) with check (user_id = auth.uid());
exception when duplicate_object then null; end $$;

-- A phone that switches account keeps the same endpoint: hand it over to the
-- new user instead of failing on the unique endpoint.
create or replace function public.save_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, p_user_agent)
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
        user_agent = excluded.user_agent, created_at = now();
end
$$;
revoke all on function public.save_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;

-- 3. Preferences (no row = everything on) ─────────────────────────────────────
create table if not exists public.notification_prefs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  trip_started boolean not null default true,
  trip_ended boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.notification_prefs enable row level security;

do $$ begin
  create policy "own notification prefs" on public.notification_prefs for all to authenticated
    using (user_id = auth.uid()) with check (user_id = auth.uid());
exception when duplicate_object then null; end $$;

-- 4. "Send me a test" — goes through the real push path ───────────────────────
create or replace function public.send_test_notification()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if exists (
    select 1 from public.fleet_events
     where kind = 'test' and target_user_id = auth.uid() and created_at > now() - interval '10 seconds'
  ) then
    return; -- one test every 10 s is enough
  end if;
  insert into public.fleet_events (kind, target_user_id) values ('test', auth.uid());
end
$$;
revoke all on function public.send_test_notification() from public, anon;
grant execute on function public.send_test_notification() to authenticated;

-- 5. Detect trip start / end from device_status ───────────────────────────────
create or replace function public._fleet_event_from_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind text := case when new.is_tracking then 'trip_started' else 'trip_ended' end;
  v_bus public.buses;
  v_prof public.profiles;
  v_started timestamptz;
  v_route text;
begin
  -- Ignore admins / parents that happen to have a device_status row.
  if not exists (select 1 from public.user_roles where user_id = new.user_id and role = 'user') then
    return null;
  end if;

  -- A flicker (on→off→on inside a minute) must not spam owners.
  if exists (
    select 1 from public.fleet_events
     where driver_user_id = new.user_id and kind = v_kind and occurred_at > now() - interval '60 seconds'
  ) then
    return null;
  end if;

  select * into v_bus from public.buses where driver_user_id = new.user_id limit 1;
  select * into v_prof from public.profiles where id = new.user_id;
  select name into v_route from public.routes where id = v_bus.route_id;

  if v_kind = 'trip_ended' then
    select occurred_at into v_started from public.fleet_events
     where driver_user_id = new.user_id and kind = 'trip_started'
     order by occurred_at desc limit 1;
  end if;

  insert into public.fleet_events (
    kind, school_id, bus_id, driver_user_id, vehicle_label, plate, driver_name, route_name,
    distance_m, trip_started_at
  ) values (
    v_kind,
    coalesce(v_bus.school_id, v_prof.school_id),
    v_bus.id,
    new.user_id,
    coalesce(v_bus.label, v_prof.vehicle_name),
    coalesce(v_bus.plate, v_prof.plate_number),
    coalesce(nullif(btrim(v_bus.gps_driver_name), ''), v_prof.display_name),
    v_route,
    case when v_kind = 'trip_ended' then round(coalesce(new.total_distance_m, 0))::integer end,
    v_started
  );
  return null;
exception when others then
  -- An alert must never block a position write.
  raise warning 'fleet event skipped: %', sqlerrm;
  return null;
end
$$;

drop trigger if exists fleet_event_on_status_insert on public.device_status;
create trigger fleet_event_on_status_insert
  after insert on public.device_status
  for each row when (new.is_tracking)
  execute function public._fleet_event_from_status();

drop trigger if exists fleet_event_on_status_update on public.device_status;
create trigger fleet_event_on_status_update
  after update of is_tracking on public.device_status
  for each row when (old.is_tracking is distinct from new.is_tracking)
  execute function public._fleet_event_from_status();

-- Live list on the Alerts settings page.
do $$
begin
  alter publication supabase_realtime add table public.fleet_events;
exception when duplicate_object then null;
         when others then null;
end $$;

-- 6. Routes the way schools run them ─────────────────────────────────────────
-- Morning run: stops in order, then school. Afternoon run: school, then the
-- same stops in reverse. Each stop can carry the time the bus passes it.
alter table public.stops add column if not exists morning_time time;
alter table public.stops add column if not exists afternoon_time time;

-- One school stop per route (the run's destination / starting point).
create unique index if not exists stops_one_school_per_route
  on public.stops (route_id) where type = 'school';
