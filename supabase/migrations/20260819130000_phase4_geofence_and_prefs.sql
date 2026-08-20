-- ────────────────────────────────────────────────────────────────────────────
-- Parent-tracking Phase 4: geofence_events detection + notification prefs.
-- ────────────────────────────────────────────────────────────────────────────
-- Idempotent. Safe on this DB (where geofence_events already exists with
-- its RLS policies from earlier work) and on a fresh DB.
--
-- Detection runs SERVER-SIDE via an AFTER INSERT trigger on location_history.
-- Every driver upload lands there (use-tracker.ts persist() inserts one row
-- per fresh GPS point while is_tracking=true), so events fire regardless of
-- whether any parent has /me open.
-- ────────────────────────────────────────────────────────────────────────────

-- 1. Ensure geofence_events exists with the right shape. NOTE: the existing
-- table on this DB has `id bigint` (not uuid); we keep it — dropping is
-- forbidden and 0 rows presently rely on it, so no data risk. Rows are
-- addressed by (bus_id, event_type, occurred_at) anyway.
create table if not exists public.geofence_events (
  id bigserial primary key,
  bus_id uuid not null references public.buses(id) on delete cascade,
  stop_id uuid not null references public.stops(id) on delete cascade,
  event_type text not null check (event_type in ('arrive','depart')),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
alter table public.geofence_events add column if not exists created_at timestamptz not null default now();
alter table public.geofence_events enable row level security;

create index if not exists geofence_events_bus_time_idx
  on public.geofence_events(bus_id, occurred_at desc);
create index if not exists location_history_user_time_idx
  on public.location_history(user_id, recorded_at desc);

-- Parent RLS already present ("parent sees events for own child bus" — using
-- is_parent_of_bus(bus_id)). Re-declare idempotently in case a fresh DB
-- doesn't have it.
do $$ begin
  create policy "parent sees events for own child bus" on public.geofence_events
    for select to authenticated using (public.is_parent_of_bus(bus_id));
exception when duplicate_object then null; end $$;

-- 2. Small internal table that remembers which stop each bus is currently
-- inside. Only the SECURITY DEFINER trigger touches it; RLS is enabled
-- with no policies so no client can read or write.
create table if not exists public.bus_current_stop (
  bus_id uuid primary key references public.buses(id) on delete cascade,
  stop_id uuid not null references public.stops(id) on delete cascade,
  since timestamptz not null default now()
);
alter table public.bus_current_stop enable row level security;
-- Intentionally NO policies → deny by default.

-- 3. Haversine in metres (immutable, safe to reuse inside the trigger).
create or replace function public._haversine_m(
  lat1 double precision, lon1 double precision,
  lat2 double precision, lon2 double precision
) returns double precision
language sql immutable parallel safe as $$
  select 2 * 6371000 * asin(sqrt(
    sin(radians((lat2 - lat1) / 2)) ^ 2 +
    cos(radians(lat1)) * cos(radians(lat2)) *
    sin(radians((lon2 - lon1) / 2)) ^ 2
  ))
$$;

-- 4. Detection trigger. Fires on every location_history insert.
--
-- Transitions:
--   prev null   → new X    : arrive(X)
--   prev X      → new null : depart(X)
--   prev X      → new Y    : depart(X) + arrive(Y)
--   prev X      → new X    : no-op
--
-- Dedupe: even if the state machine somehow tries again, we won't insert an
-- arrive or depart for the same (bus, stop, type) within 60 seconds.
--
-- SECURITY DEFINER so bus_current_stop (no policies) and geofence_events
-- inserts don't need the caller to hold the driver INSERT policy.
create or replace function public._geofence_scan()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bus_id   uuid;
  v_route_id uuid;
  v_new_stop uuid;
  v_prev_stop uuid;
  v_ts       timestamptz := coalesce(new.recorded_at, now());
begin
  select b.id, b.route_id into v_bus_id, v_route_id
    from public.buses b where b.driver_user_id = new.user_id limit 1;
  if v_bus_id is null or v_route_id is null then return new; end if;

  select s.id into v_new_stop
    from public.stops s
    where s.route_id = v_route_id
      and s.lat is not null and s.lng is not null
      and public._haversine_m(new.latitude, new.longitude, s.lat, s.lng) <= s.radius_m
    order by public._haversine_m(new.latitude, new.longitude, s.lat, s.lng) asc
    limit 1;

  select stop_id into v_prev_stop from public.bus_current_stop where bus_id = v_bus_id;

  if v_new_stop is not distinct from v_prev_stop then
    return new;
  end if;

  if v_prev_stop is null and v_new_stop is not null then
    if not exists (
      select 1 from public.geofence_events
       where bus_id = v_bus_id and stop_id = v_new_stop
         and event_type = 'arrive'
         and occurred_at > now() - interval '60 seconds'
    ) then
      insert into public.geofence_events(bus_id, stop_id, event_type, occurred_at)
        values (v_bus_id, v_new_stop, 'arrive', v_ts);
    end if;
    insert into public.bus_current_stop(bus_id, stop_id, since)
      values (v_bus_id, v_new_stop, v_ts)
      on conflict (bus_id) do update set stop_id = excluded.stop_id, since = excluded.since;

  elsif v_prev_stop is not null and v_new_stop is null then
    if not exists (
      select 1 from public.geofence_events
       where bus_id = v_bus_id and stop_id = v_prev_stop
         and event_type = 'depart'
         and occurred_at > now() - interval '60 seconds'
    ) then
      insert into public.geofence_events(bus_id, stop_id, event_type, occurred_at)
        values (v_bus_id, v_prev_stop, 'depart', v_ts);
    end if;
    delete from public.bus_current_stop where bus_id = v_bus_id;

  else
    -- prev X → new Y (different, both non-null)
    insert into public.geofence_events(bus_id, stop_id, event_type, occurred_at)
      values (v_bus_id, v_prev_stop, 'depart', v_ts),
             (v_bus_id, v_new_stop,  'arrive', v_ts);
    update public.bus_current_stop set stop_id = v_new_stop, since = v_ts
      where bus_id = v_bus_id;
  end if;

  return new;
end
$$;

drop trigger if exists geofence_scan_on_location on public.location_history;
create trigger geofence_scan_on_location
  after insert on public.location_history
  for each row execute function public._geofence_scan();

-- 5. Enable Supabase Realtime for geofence_events (idempotent).
do $$
begin
  alter publication supabase_realtime add table public.geofence_events;
exception when duplicate_object then null;
         when others then null;
end $$;

-- 6. Per-parent notification prefs (web push subscription lives here later).
create table if not exists public.parent_notification_prefs (
  parent_user_id uuid primary key references public.profiles(id) on delete cascade,
  notify_enabled boolean not null default false,
  push_subscription jsonb,
  updated_at timestamptz not null default now()
);
alter table public.parent_notification_prefs enable row level security;

do $$ begin
  create policy "parent manages own prefs" on public.parent_notification_prefs
    for all to authenticated
    using (parent_user_id = auth.uid())
    with check (parent_user_id = auth.uid());
exception when duplicate_object then null; end $$;
