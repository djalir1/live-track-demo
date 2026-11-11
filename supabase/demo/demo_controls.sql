-- ────────────────────────────────────────────────────────────────────────────
-- Live Track DEMO — bus controls, engine alerts and phone push.
-- Run ONLY in the demo project, AFTER supabase/demo/demo.sql. Idempotent.
--
--   demo_bus_control(bus, action, stop)  drive | stopped | off | goto <stop>
--   demo_restart_today(bus)              delete today's trips so a run can be repeated
--   demo_test_notification()             a test alert to the signed-in parent
--   device_status trigger                engine on / off → alert to the bus's parents
--   parent_notifications / school_alerts → pg_net → <site>/api/demo-push (web push)
-- ────────────────────────────────────────────────────────────────────────────

create extension if not exists pg_net;

alter table public.demo_sim add column if not exists mode text not null default 'drive'
  check (mode in ('drive', 'stopped', 'off'));
alter table public.demo_sim add column if not exists goto_stop uuid;

-- Where the push sender lives and its keys (filled in by api/demo-push.js).
alter table public.demo_config add column if not exists site_url text;
alter table public.demo_config add column if not exists vapid_public text;
alter table public.demo_config add column if not exists vapid_private text;

-- The app shows each bus's mode (not secret in a demo).
do $$ begin
  create policy "demo: read bus modes" on public.demo_sim for select to authenticated using (true);
exception when duplicate_object then null; end $$;

-- ── One bus, one step ───────────────────────────────────────────────────────
-- drive: follows the route loop, pausing 20 s at each stop.
-- stopped: engine on, standing still.   off: parked, engine off.
-- goto_stop: jump to that stop first (then keep the mode).
create or replace function public._demo_step(p_bus uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  s record;
  lat float8[];
  lng float8[];
  cum float8[];
  n int;
  i int;
  total float8;
  dt float8;
  pa float8;
  step float8 := 0;
  p float8;
  seg float8;
  f float8;
  la float8;
  lo float8;
  heading float8;
  dwelling boolean := false;
  v_on boolean;
  v_status public.tracking_status;
  v_speed float8;
begin
  select ds.*, b.route_id into s from public.demo_sim ds join public.buses b on b.id = ds.bus_id
   where ds.bus_id = p_bus;
  if not found then return; end if;

  -- Loop path: stops in order to school, then back (no repeated end points).
  select array_agg(x.lat order by x.o), array_agg(x.lng order by x.o) into lat, lng from (
    select st.lat, st.lng, st.sequence as o from public.stops st where st.route_id = s.route_id and st.lat is not null
    union all
    select st.lat, st.lng, 100 - st.sequence from public.stops st
     where st.route_id = s.route_id and st.lat is not null
       and st.sequence not in ((select max(sequence) from public.stops where route_id = s.route_id),
                               (select min(sequence) from public.stops where route_id = s.route_id))
  ) x;
  n := coalesce(array_length(lat, 1), 0);
  if n < 2 then return; end if;
  cum := array[0::float8];
  for i in 2..n + 1 loop
    cum := cum || (cum[i - 1] + public._haversine_m(lat[i - 1], lng[i - 1], lat[((i - 1) % n) + 1], lng[((i - 1) % n) + 1]));
  end loop;
  total := cum[n + 1];

  pa := s.progress_m - total * floor(s.progress_m / total); -- position on the loop
  if s.goto_stop is not null then
    select count(*) into i from public.stops st
     where st.route_id = s.route_id and st.lat is not null
       and st.sequence <= (select sequence from public.stops where id = s.goto_stop);
    if i between 1 and n then pa := cum[i]; end if;
  elsif s.mode = 'drive' then
    dwelling := s.dwell_until is not null and s.dwell_until > now();
    dt := least(extract(epoch from now() - s.last_tick), 30);
    if not dwelling then
      step := (s.speed_kmh / 3.6) * dt;
      -- Reaching a stop on the way? Stop exactly on it for 20 s.
      for i in 2..n + 1 loop
        if cum[i] > pa and cum[i] <= pa + step then
          step := cum[i] - pa;
          dwelling := true;
          exit;
        end if;
      end loop;
    end if;
  end if;
  p := pa + step;
  p := p - total * floor(p / total);

  i := 1;
  while i < n and cum[i + 1] <= p loop i := i + 1; end loop;
  seg := cum[i + 1] - cum[i];
  f := case when seg > 0 then (p - cum[i]) / seg else 0 end;
  la := lat[i] + (lat[(i % n) + 1] - lat[i]) * f;
  lo := lng[i] + (lng[(i % n) + 1] - lng[i]) * f;
  heading := degrees(atan2(lng[(i % n) + 1] - lng[i], lat[(i % n) + 1] - lat[i]));
  if heading < 0 then heading := heading + 360; end if;

  v_on := s.mode <> 'off';
  v_status := (case when s.mode = 'off' then 'stopped' when s.mode = 'stopped' or dwelling then 'idle' else 'moving' end)::public.tracking_status;
  v_speed := case when v_status = 'moving' then s.speed_kmh else 0 end;

  update public.demo_sim set progress_m = p, last_tick = now(), goto_stop = null,
    dwell_until = case when s.mode <> 'drive' then null
                       when dwelling and (s.dwell_until is null or s.dwell_until <= now()) then now() + interval '20 seconds'
                       when dwelling then s.dwell_until else null end
   where bus_id = s.bus_id;

  insert into public.device_status (user_id, status, latitude, longitude, speed_kmh, heading, accuracy, battery_level,
                                    is_tracking, total_distance_m, last_seen, gps_fix, satellites)
  values (s.tracker_user_id, v_status, la, lo, v_speed, heading, 8, 100, v_on, 0, now(), true, 11)
  on conflict (user_id) do update set status = excluded.status, latitude = excluded.latitude, longitude = excluded.longitude,
    speed_kmh = excluded.speed_kmh, heading = excluded.heading, is_tracking = excluded.is_tracking, last_seen = now(),
    total_distance_m = public.device_status.total_distance_m + step,
    gps_fix = true, satellites = 11, power_cut_at = null, silent_since = null;

  if v_on or s.goto_stop is not null then
    insert into public.location_history (user_id, latitude, longitude, speed_kmh, battery_level, recorded_at)
    values (s.tracker_user_id, la, lo, v_speed, 100, now());
  end if;

  if v_on then
    if not exists (select 1 from public.trip_sessions where user_id = s.tracker_user_id and ended_at is null) then
      insert into public.trip_sessions (user_id, started_at) values (s.tracker_user_id, now());
    end if;
  else
    update public.trip_sessions set ended_at = now() where user_id = s.tracker_user_id and ended_at is null;
  end if;
end $$;

create or replace function public.demo_tick()
returns integer language plpgsql security definer set search_path = public as $$
declare
  r record;
  moved int := 0;
begin
  for r in select bus_id from public.demo_sim loop
    perform public._demo_step(r.bus_id);
    moved := moved + 1;
  end loop;
  -- Old positions are cleared by the nightly demo_reset().
  return moved;
end $$;

-- ── The buttons in the app ──────────────────────────────────────────────────
create or replace function public.demo_bus_control(p_bus uuid, p_action text, p_stop uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_bus public.buses;
begin
  select * into v_bus from public.buses where id = p_bus;
  if not found or not exists (select 1 from public.demo_sim where bus_id = p_bus) then
    raise exception 'This is not a demo bus';
  end if;
  if not (public.can_manage_school(v_bus.school_id) or public.is_bus_staff(p_bus)) then
    raise exception 'You cannot control this bus';
  end if;
  if p_action = 'goto' then
    if not exists (select 1 from public.stops where id = p_stop and route_id = v_bus.route_id and lat is not null) then
      raise exception 'That stop is not on this bus''s route';
    end if;
    -- Arrive with the engine on and wait there.
    update public.demo_sim set mode = 'stopped', goto_stop = p_stop, dwell_until = null, last_tick = now() where bus_id = p_bus;
  elsif p_action in ('drive', 'stopped', 'off') then
    update public.demo_sim set mode = p_action, dwell_until = null, last_tick = now() where bus_id = p_bus;
  else
    raise exception 'Unknown action %', p_action;
  end if;
  perform public._demo_step(p_bus);
  return (select jsonb_build_object('mode', mode) from public.demo_sim where bus_id = p_bus);
end $$;

-- Delete today's trips (one bus, or the whole school) so a run can be shown again.
create or replace function public.demo_restart_today(p_bus uuid default null)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_school uuid;
  v_n integer;
begin
  select school_id into v_school from public.demo_config where id = 1;
  if not (public.can_manage_school(v_school)
          or exists (select 1 from public.attendants a where a.user_id = auth.uid() and a.school_id = v_school)) then
    raise exception 'Only the school or a bus attendant can do this';
  end if;
  delete from public.bus_trips
   where school_id = v_school and service_date = public.kigali_today() and (p_bus is null or bus_id = p_bus);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create or replace function public.demo_test_notification()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  insert into public.parent_notifications (user_id, school_id, kind, title, body)
  values (auth.uid(), (select school_id from public.profiles where id = auth.uid()), 'test',
          '🔔 Test notification', 'If you can read this, notifications work on this phone.');
end $$;

do $$
declare f text;
begin
  foreach f in array array['_demo_step(uuid)', 'demo_tick()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  foreach f in array array['demo_bus_control(uuid, text, uuid)', 'demo_restart_today(uuid)', 'demo_test_notification()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ── Engine on / off → the parents of that bus ───────────────────────────────
create or replace function public._demo_engine_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_bus public.buses;
begin
  if new.is_tracking is not distinct from old.is_tracking then return null; end if;
  select b.* into v_bus from public.buses b join public.demo_sim ds on ds.bus_id = b.id
   where b.driver_user_id = new.user_id limit 1;
  if not found then return null; end if;
  insert into public.parent_notifications (user_id, school_id, kind, title, body)
  select distinct ps.parent_user_id, v_bus.school_id,
         case when new.is_tracking then 'engine_on' else 'engine_off' end,
         case when new.is_tracking then format('🚌 %s has started its engine', public._bus_name(v_bus.id))
              else format('🅿️ %s is parked', public._bus_name(v_bus.id)) end,
         case when new.is_tracking then 'The bus is on. You can follow it live on the map.'
              else 'The engine is off.' end
    from public.parent_students ps join public.students s on s.id = ps.student_id
   where s.bus_id = v_bus.id;
  return null;
exception when others then
  raise warning 'demo engine alert skipped: %', sqlerrm;
  return null;
end $$;

create or replace trigger demo_engine_notify after update of is_tracking on public.device_status
  for each row execute function public._demo_engine_notify();

-- ── Phone push: wake the sender whenever there is something new ─────────────
create or replace function public._demo_push_kick()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_url text;
begin
  select site_url into v_url from public.demo_config where id = 1;
  if v_url is not null then
    perform net.http_post(url := v_url || '/api/demo-push', body := '{}'::jsonb, timeout_milliseconds := 20000);
  end if;
  return null;
exception when others then
  return null;
end $$;

create or replace trigger demo_push_kick after insert on public.parent_notifications
  for each statement execute function public._demo_push_kick();
create or replace trigger demo_push_kick after insert on public.school_alerts
  for each statement execute function public._demo_push_kick();
