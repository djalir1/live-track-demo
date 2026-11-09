-- ────────────────────────────────────────────────────────────────────────────
-- Live Track DEMO database add-on. Run ONLY in the demo project — never in
-- production. Apply after every file in supabase/migrations.
--
--   demo_seed(accounts)  builds a full fictional school (routes on real
--                        Kigali roads, 3 buses, drivers, attendants, 30
--                        students, parents, 2 weeks of trips & attendance)
--   demo_reset()         rebuilds it with the same accounts (nightly)
--   demo_tick()          moves every demo bus along its route like a GPS
--                        tracker would (every 10 s): live map, stop
--                        arrivals, parent ETAs and alerts all work
--
-- Accounts are created by scripts/demo/seed.mjs (Supabase Auth admin API),
-- which then calls demo_seed() with their ids. Only the service role can
-- run these functions. Idempotent.
-- ────────────────────────────────────────────────────────────────────────────

create table if not exists public.demo_config (
  id integer primary key default 1 check (id = 1),
  accounts jsonb not null,
  school_id uuid,
  seeded_at timestamptz not null default now()
);
alter table public.demo_config enable row level security; -- no policies: service role only

create table if not exists public.demo_sim (
  bus_id uuid primary key references public.buses(id) on delete cascade,
  tracker_user_id uuid not null,
  progress_m double precision not null default 0,
  speed_kmh double precision not null default 28,
  dwell_until timestamptz,
  last_tick timestamptz not null default now()
);
alter table public.demo_sim enable row level security;

-- ── Build the demo school ───────────────────────────────────────────────────
create or replace function public.demo_seed(p_accounts jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_school uuid;
  v_admin uuid := (p_accounts->>'platform_admin')::uuid;
  v_sadmin uuid := (p_accounts->>'school_admin')::uuid;
  v_att uuid[] := array(select (jsonb_array_elements_text(p_accounts->'attendants'))::uuid);
  v_par uuid[] := array(select (jsonb_array_elements_text(p_accounts->'parents'))::uuid);
  v_trk uuid[] := array(select (jsonb_array_elements_text(p_accounts->'trackers'))::uuid);
  v_routes uuid[] := '{}';
  v_buses uuid[] := '{}';
  v_route uuid;
  v_bus uuid;
  v_driver uuid;
  v_stop uuid;
  v_sch_stop uuid;
  v_students uuid[] := '{}';
  v_sid uuid;
  v_gid uuid;
  v_trip uuid;
  v_day date;
  v_today date := public.kigali_today();
  v_now_kgl time := (now() at time zone 'Africa/Kigali')::time;
  r record;
  i int;
  b int;
  k int;
  v_status text;
  v_base timestamptz;
  -- Real places in Kigali (approximate).
  v_route_names text[] := array['Kimironko line', 'Kicukiro line', 'Nyamirambo line'];
  v_stops jsonb := '[
    [["Kimironko Market",-1.9496,30.1262],["Kibagabaga",-1.9330,30.1172],["Kagugu",-1.9262,30.1005]],
    [["Kicukiro Centre",-1.9702,30.1036],["Sonatubes",-1.9627,30.1080],["Remera Giporoso",-1.9566,30.1146]],
    [["Nyamirambo Stadium",-1.9790,30.0440],["Kiyovu",-1.9505,30.0610],["Kacyiru",-1.9385,30.0870]]
  ]';
  v_bus_labels text[] := array['Bus 1', 'Bus 2', 'Bus 3'];
  v_plates text[] := array['RAD 101 A', 'RAD 102 B', 'RAD 103 C'];
  v_drivers text[] := array['Jean Bosco Habimana', 'Claude Nshimiyimana', 'Patrick Mugabo'];
  v_att_names text[] := array['Alice Mukeshimana', 'Diane Uwamahoro', 'Josiane Ingabire'];
  v_first text[] := array['Amina','Brian','Chloe','Daniel','Esther','Fabrice','Gisele','Hirwa','Ines','Joel',
                          'Kevine','Liam','Mireille','Noah','Olivia','Prince','Queen','Ryan','Sonia','Teta',
                          'Umutoni','Victor','Wendy','Xavier','Yvette','Zawadi','Aimable','Belyse','Cedric','Divine'];
  v_last text[] := array['Uwase','Mugisha','Ishimwe','Habimana','Mukamana','Niyonzima','Umutoni','Nkurunziza',
                         'Iradukunda','Ndayisaba'];
  v_parent_names text[] := array['Grace Uwase', 'Eric Mugisha', 'Aline Ishimwe'];
begin
  if v_sadmin is null or coalesce(array_length(v_trk, 1), 0) < 3 or coalesce(array_length(v_att, 1), 0) < 3
     or coalesce(array_length(v_par, 1), 0) < 3 then
    raise exception 'demo_seed needs platform_admin, school_admin, 3 attendants, 3 parents, 3 trackers';
  end if;

  -- 1. Start clean (everything hangs off the school and cascades).
  delete from public.schools where id in (select school_id from public.demo_config) or name = 'Sunrise Academy (Demo)';
  delete from public.location_history where user_id = any (v_trk);
  delete from public.device_status where user_id = any (v_trk);
  delete from public.trip_sessions where user_id = any (v_trk);
  delete from public.fleet_events where driver_user_id = any (v_trk);
  delete from public.parent_notifications where user_id = any (v_par);
  delete from public.parent_students where parent_user_id = any (v_par);

  insert into public.schools (name) values ('Sunrise Academy (Demo)') returning id into v_school;

  -- 2. Accounts → roles, names, school.
  delete from public.user_roles where user_id = any (array[v_admin, v_sadmin] || v_att || v_par || v_trk);
  if v_admin is not null then
    insert into public.user_roles (user_id, role) values (v_admin, 'admin');
    update public.profiles set display_name = 'Demo Platform Admin', school_id = null where id = v_admin;
  end if;
  insert into public.user_roles (user_id, role) values (v_sadmin, 'school_admin');
  update public.profiles set display_name = 'Mrs. Claudine Mutesi', school_id = v_school where id = v_sadmin;
  for i in 1..3 loop
    insert into public.user_roles (user_id, role) values (v_att[i], 'attendant'), (v_par[i], 'parent'), (v_trk[i], 'user');
    update public.profiles set display_name = v_att_names[i], school_id = v_school, phone = '25078810000' || i where id = v_att[i];
    update public.profiles set display_name = v_parent_names[i], school_id = v_school, phone = '25078820000' || i where id = v_par[i];
    update public.profiles set display_name = v_bus_labels[i], school_id = v_school, vehicle_type = 'bus',
      vehicle_name = v_bus_labels[i], plate_number = v_plates[i], seats = 30 where id = v_trk[i];
  end loop;

  -- 3. Routes, stops, buses, drivers, attendants.
  for b in 1..3 loop
    insert into public.routes (school_id, name) values (v_school, v_route_names[b]) returning id into v_route;
    v_routes := v_routes || v_route;
    for k in 0..2 loop
      insert into public.stops (route_id, school_id, name, lat, lng, radius_m, sequence, type, morning_time, afternoon_time)
      values (v_route, v_school, v_stops->(b-1)->k->>0, (v_stops->(b-1)->k->>1)::float8, (v_stops->(b-1)->k->>2)::float8,
              150, k + 1, 'pickup', (time '06:30' + (k * interval '12 minutes')), (time '16:30' - (k * interval '10 minutes')));
    end loop;
    insert into public.stops (route_id, school_id, name, lat, lng, radius_m, sequence, type, morning_time, afternoon_time)
    values (v_route, v_school, 'Sunrise Academy', -1.9447, 30.0988, 180, 4, 'school', '07:30', '15:45');

    insert into public.buses (school_id, route_id, label, plate, capacity, driver_user_id, gps_imei, gps_driver_name)
    values (v_school, v_route, v_bus_labels[b], v_plates[b], 30, v_trk[b], '99000000000000' || b, 'No driver')
    returning id into v_bus;
    v_buses := v_buses || v_bus;

    insert into public.drivers (school_id, full_name, phone, license_number)
    values (v_school, v_drivers[b], '25078840000' || b, 'RW-DL-' || (40210 + b)) returning id into v_driver;
    insert into public.vehicle_assignments (school_id, bus_id, driver_id, started_at) values (v_school, v_bus, v_driver, now() - interval '60 days');

    insert into public.attendants (school_id, full_name, phone, bus_id, user_id, activated_at)
    values (v_school, v_att_names[b], '25078810000' || b, v_bus, v_att[b], now());

    insert into public.demo_sim (bus_id, tracker_user_id, progress_m, speed_kmh)
    values (v_bus, v_trk[b], b * 900, 24 + b * 4)
    on conflict (bus_id) do update set progress_m = excluded.progress_m, speed_kmh = excluded.speed_kmh,
      tracker_user_id = excluded.tracker_user_id, dwell_until = null, last_tick = now();
  end loop;
  -- An extra attendant with a code still to activate (shows the flow).
  insert into public.attendants (school_id, full_name, phone, bus_id) values (v_school, 'Samuel Hakizimana', '250788100009', null);

  -- 4. Students (10 per bus) and their parents.
  for i in 1..30 loop
    b := ((i - 1) / 10) + 1;
    select id into v_stop from public.stops where route_id = v_routes[b] and type = 'pickup' and sequence = ((i - 1) % 3) + 1;
    insert into public.students (school_id, bus_id, name, class, student_code, home_stop_id, morning_stop_id,
      photo_consent, biometric_consent, consent_recorded_at, notes)
    values (v_school, v_buses[b], v_first[i] || ' ' || v_last[((i - 1) % 10) + 1], 'P' || (((i - 1) % 6) + 1),
            'SA-' || lpad(i::text, 4, '0'), v_stop, v_stop, true, i % 3 = 0, now(),
            case when i = 4 then 'Asthma inhaler in school bag' when i = 17 then 'Gets off with older sister' end)
    returning id into v_sid;
    v_students := v_students || v_sid;
  end loop;

  -- Demo parents with app accounts: Grace (2 kids, Bus 1), Eric (1 kid, Bus 1), Aline (2 kids, Bus 2).
  for r in select * from (values (1, 1), (1, 2), (2, 3), (3, 11), (3, 12)) t(p, s) loop
    select id into v_gid from public.guardians where school_id = v_school and user_id = v_par[r.p];
    if v_gid is null then
      insert into public.guardians (school_id, full_name, phone, relationship, user_id, activated_at)
      values (v_school, v_parent_names[r.p], '25078820000' || r.p, case when r.p = 2 then 'Father' else 'Mother' end, v_par[r.p], now())
      returning id into v_gid;
    end if;
    insert into public.student_guardians (student_id, guardian_id, is_primary) values (v_students[r.s], v_gid, true)
    on conflict do nothing;
  end loop;
  -- Everyone else: a parent registered by the school, code not used yet.
  for i in 1..30 loop
    continue when i in (1, 2, 3, 11, 12);
    insert into public.guardians (school_id, full_name, phone, relationship)
    values (v_school, 'Parent of ' || split_part(v_first[i] || ' ' || v_last[((i - 1) % 10) + 1], ' ', 1) || ' ' || v_last[((i - 1) % 10) + 1],
            '250788300' || lpad(i::text, 3, '0'), case when i % 2 = 0 then 'Father' else 'Mother' end)
    returning id into v_gid;
    insert into public.student_guardians (student_id, guardian_id, is_primary) values (v_students[i], v_gid, true);
  end loop;

  -- 5. History: the last 10 school days (+ today's morning if it's past 09:00).
  for v_day in
    select d::date from generate_series(v_today - 16, v_today, interval '1 day') d
     where extract(isodow from d) < 6 and (d::date < v_today or v_now_kgl > time '09:00')
  loop
    for b in 1..3 loop
      for k in 0..1 loop
        continue when v_day = v_today and k = 1;
        insert into public.bus_trips (school_id, bus_id, route_id, service_date, run, status, opened_at, closed_at, empty_checked_at,
                                      opened_by, closed_by)
        values (v_school, v_buses[b], v_routes[b], v_day, case k when 0 then 'morning' else 'afternoon' end, 'closed',
                (v_day + case k when 0 then time '06:20' else time '15:35' end) at time zone 'Africa/Kigali',
                (v_day + case k when 0 then time '07:42' else time '16:55' end) at time zone 'Africa/Kigali',
                (v_day + case k when 0 then time '07:42' else time '16:55' end) at time zone 'Africa/Kigali',
                v_att[b], v_att[b])
        returning id into v_trip;
        v_base := (v_day + case k when 0 then time '06:30' else time '15:40' end) at time zone 'Africa/Kigali';
        for i in ((b - 1) * 10 + 1)..(b * 10) loop
          -- Deterministic mix: mostly rode; some notices and no-shows.
          v_status := case
            when (i * 7 + extract(doy from v_day)::int + k) % 23 = 0 then 'not_riding'
            when (i * 5 + extract(doy from v_day)::int) % 29 = 0 then 'no_show'
            else 'dropped_off' end;
          insert into public.trip_students (trip_id, student_id, school_id, stop_id, status, notice_kind,
            boarded_at, dropped_at, method, marked_by)
          select v_trip, s.id, v_school, s.morning_stop_id, v_status,
                 case when v_status = 'not_riding' then 'not_riding' end,
                 case when v_status = 'dropped_off' then v_base + ((i % 10) * interval '4 minutes') end,
                 case when v_status = 'dropped_off' then v_base + interval '60 minutes' + ((i % 10) * interval '2 minutes') end,
                 'manual', v_att[b]
            from public.students s where s.id = v_students[i];
          if v_status = 'dropped_off' then
            insert into public.boarding_events (school_id, trip_id, bus_id, student_id, action, occurred_at, method, marked_by)
            values (v_school, v_trip, v_buses[b], v_students[i], 'board', v_base + ((i % 10) * interval '4 minutes'), 'manual', v_att[b]),
                   (v_school, v_trip, v_buses[b], v_students[i], 'drop', v_base + interval '60 minutes' + ((i % 10) * interval '2 minutes'), 'manual', v_att[b]);
          elsif v_status = 'no_show' then
            insert into public.boarding_events (school_id, trip_id, bus_id, student_id, action, occurred_at, method, marked_by)
            values (v_school, v_trip, v_buses[b], v_students[i], 'not_here', v_base + ((i % 10) * interval '4 minutes'), 'manual', v_att[b]);
          end if;
        end loop;
      end loop;
    end loop;
    -- Class register: everyone present except no-show + not-riding pairs from the morning.
    insert into public.class_register (school_id, student_id, service_date, present, marked_by)
    select v_school, ts.student_id, v_day, ts.status <> 'no_show', v_sadmin
      from public.trip_students ts join public.bus_trips t on t.id = ts.trip_id
     where t.school_id = v_school and t.service_date = v_day and t.run = 'morning'
    on conflict do nothing;
  end loop;

  -- 6. Things to look at: an open alert, announcements, a parent's feed.
  insert into public.school_alerts (school_id, bus_id, student_id, kind, severity, message, pushed_at)
  values (v_school, v_buses[2], v_students[15], 'no_show', 'warning',
          v_first[15] || ' ' || v_last[5] || ' was not at Remera Giporoso stop this morning (no notice from the parent).', now());
  insert into public.announcements (school_id, bus_id, kind, delay_min, message, recipients, created_by, created_at)
  values (v_school, v_buses[1], 'traffic', 15, '⚠️ Bus 1: heavy traffic, about 15 min late', 10, v_att[1], now() - interval '1 day'),
         (v_school, null, 'school', null, '📣 Message from the school — Parents'' meeting on Friday at 16:00 in the main hall.', 30, v_sadmin, now() - interval '2 days');
  insert into public.parent_notifications (user_id, school_id, student_id, kind, title, body, created_at, read_at, pushed_at)
  values (v_par[1], v_school, v_students[1], 'dropped_off', '🏫 ' || v_first[1] || ' ' || v_last[1] || ' arrived at school',
          'Got off Bus 1 at 07:38.', now() - interval '20 hours', now(), now()),
         (v_par[1], v_school, v_students[1], 'boarded', '✅ ' || v_first[1] || ' ' || v_last[1] || ' boarded Bus 1 at Kimironko Market stop',
          'At 06:34. Heading to school.', now() - interval '21 hours', now(), now()),
         (v_par[1], v_school, null, 'announcement', '📣 Message from the school',
          'Parents'' meeting on Friday at 16:00 in the main hall.', now() - interval '2 days', null, now());

  insert into public.demo_config (id, accounts, school_id, seeded_at) values (1, p_accounts, v_school, now())
  on conflict (id) do update set accounts = excluded.accounts, school_id = excluded.school_id, seeded_at = now();

  return jsonb_build_object('school_id', v_school, 'students', array_length(v_students, 1), 'buses', array_length(v_buses, 1));
end $$;

create or replace function public.demo_reset()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  select accounts into v from public.demo_config where id = 1;
  if v is null then raise exception 'Run scripts/demo/seed.mjs first'; end if;
  return public.demo_seed(v);
end $$;

-- ── Move the buses ──────────────────────────────────────────────────────────
-- Each bus drives its route stops → school → back, looping, pausing 20 s at
-- every stop. Positions go through the same tables as a real GT06 tracker
-- (device_status + location_history), so the stop-detection trigger, the
-- attendance alerts, the live map and parent ETAs all react as in real life.
create or replace function public.demo_tick()
returns integer language plpgsql security definer set search_path = public as $$
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
  step float8;
  p float8;
  seg float8;
  f float8;
  la float8;
  lo float8;
  heading float8;
  moved int := 0;
  dwelling boolean;
begin
  for s in select ds.*, b.route_id from public.demo_sim ds join public.buses b on b.id = ds.bus_id loop
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
    continue when n < 2;
    cum := array[0::float8];
    for i in 2..n + 1 loop
      cum := cum || (cum[i - 1] + public._haversine_m(lat[i - 1], lng[i - 1], lat[((i - 1) % n) + 1], lng[((i - 1) % n) + 1]));
    end loop;
    total := cum[n + 1];

    dwelling := s.dwell_until is not null and s.dwell_until > now();
    dt := least(extract(epoch from now() - s.last_tick), 30);
    pa := s.progress_m - total * floor(s.progress_m / total); -- position on the loop
    step := 0;
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

    update public.demo_sim set progress_m = p, last_tick = now(),
      dwell_until = case when dwelling and (s.dwell_until is null or s.dwell_until <= now()) then now() + interval '20 seconds'
                         when dwelling then s.dwell_until else null end
     where bus_id = s.bus_id;

    insert into public.device_status (user_id, status, latitude, longitude, speed_kmh, heading, accuracy, battery_level,
                                      is_tracking, total_distance_m, last_seen, gps_fix, satellites)
    values (s.tracker_user_id, (case when dwelling then 'idle' else 'moving' end)::public.tracking_status, la, lo,
            case when dwelling then 0 else s.speed_kmh end, heading, 8, 100, true, 0, now(), true, 11)
    on conflict (user_id) do update set status = excluded.status, latitude = excluded.latitude, longitude = excluded.longitude,
      speed_kmh = excluded.speed_kmh, heading = excluded.heading, is_tracking = true, last_seen = now(),
      total_distance_m = public.device_status.total_distance_m + step,
      gps_fix = true, satellites = 11, power_cut_at = null, silent_since = null;

    insert into public.location_history (user_id, latitude, longitude, speed_kmh, battery_level, recorded_at)
    values (s.tracker_user_id, la, lo, case when dwelling then 0 else s.speed_kmh end, 100, now());

    if not exists (select 1 from public.trip_sessions where user_id = s.tracker_user_id and ended_at is null) then
      insert into public.trip_sessions (user_id, started_at) values (s.tracker_user_id, now());
    end if;
    moved := moved + 1;
  end loop;
  -- Keep the demo light: one week of positions is plenty.
  delete from public.location_history
   where recorded_at < now() - interval '7 days'
     and user_id in (select tracker_user_id from public.demo_sim);
  return moved;
end $$;

do $$
declare f text;
begin
  foreach f in array array['demo_seed(jsonb)', 'demo_reset()', 'demo_tick()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- ── Schedule (Supabase: Database → Extensions → enable pg_cron first) ──────
-- Every 10 s the buses move; at 01:00 Kigali the demo school is rebuilt.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('livetrack-demo-tick', '10 seconds', 'select public.demo_tick()');
    perform cron.schedule('livetrack-demo-reset', '0 23 * * *', 'select public.demo_reset()');
  else
    raise notice 'pg_cron is not enabled: enable it and re-run this file, or run "npm run demo:simulate".';
  end if;
end $$;
