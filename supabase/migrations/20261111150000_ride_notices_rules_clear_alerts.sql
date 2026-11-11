-- 1. "Not riding / I'll collect / Absent" follow clear rules (found while testing the demo):
--    a parent could say "not riding" for a child who was already on the bus; the notice was
--    saved and the parent told "Noted", but the bus list did not change. Now:
--      - child already on the bus for that trip      -> refused, "call the school"
--      - trip already done (got off / trip finished) -> refused, says so
--      - child was marked "missed the bus"           -> allowed, becomes "not riding" (excused)
--      - the same notice twice                       -> refused, "already noted"
-- 2. Cancelling a notice tells the parent the bus expects the child again.
-- 3. Clearer parent alerts: they name the child and say what to do.
-- Safe for production. Idempotent (create or replace).

-- Same day/run already covered by an active notice?
create or replace function public._ride_notice_block(p_student uuid, p_date date, p_kind text, p_run text)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  s public.students;
  r record;
  v_first text;
begin
  select * into s from public.students where id = p_student;
  v_first := split_part(s.name, ' ', 1);

  if exists (select 1 from public.ride_notices n
              where n.student_id = p_student and n.service_date = p_date and n.cancelled_at is null
                and n.kind = p_kind and (n.run = p_run or n.run = 'both')) then
    return format('This is already noted for %s.', v_first);
  end if;

  if p_date <> public.kigali_today() then return null; end if;

  for r in
    select t.run, t.status as trip_status, ts.status
      from public.trip_students ts join public.bus_trips t on t.id = ts.trip_id
     where ts.student_id = p_student and t.service_date = p_date
       and (p_run = 'both' or t.run = p_run)
     order by case t.run when 'morning' then 1 else 2 end
  loop
    if r.status = 'boarded' and r.trip_status = 'open' then
      return format('%s is already on the bus for the %s trip, so it can''t be changed now. '
                    'If you need them back, call the school.', v_first, r.run);
    end if;
    if r.status in ('boarded', 'dropped_off') or (r.trip_status = 'closed' and r.status <> 'no_show') then
      if p_kind = 'absent' and r.run = 'morning' then
        return format('%s already came to school on the morning bus today. '
                      'For the way home, choose "I''ll collect from school" instead.', v_first);
      end if;
      return format('%s has already done the %s trip today.', v_first, r.run);
    end if;
  end loop;
  return null;
end $$;
revoke all on function public._ride_notice_block(uuid, date, text, text) from public, anon;
grant execute on function public._ride_notice_block(uuid, date, text, text) to authenticated;

create or replace function public.set_ride_notice(
  p_student uuid, p_date date, p_kind text, p_run text default null, p_note text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  s public.students;
  v_run text;
  v_id uuid;
  v_label text;
  v_block text;
begin
  select * into s from public.students where id = p_student;
  if not found then raise exception 'Student not found'; end if;
  if not (public.is_parent_of_student(p_student) or public.can_manage_school(s.school_id)) then
    raise exception 'Not allowed';
  end if;
  if p_date < public.kigali_today() then raise exception 'That day has already passed'; end if;
  v_run := case p_kind when 'absent' then 'both' when 'pickup' then 'afternoon' else p_run end;
  if p_kind not in ('not_riding', 'pickup', 'absent') or v_run not in ('morning', 'afternoon', 'both') then
    raise exception 'Unknown notice';
  end if;

  v_block := public._ride_notice_block(p_student, p_date, p_kind, v_run);
  if v_block is not null then raise exception '%', v_block; end if;

  insert into public.ride_notices (school_id, student_id, service_date, run, kind, note)
  values (s.school_id, p_student, p_date, v_run, p_kind, nullif(btrim(p_note), ''))
  returning id into v_id;

  -- Still waiting, or already marked "missed the bus": now "not riding" (excused).
  update public.trip_students ts set status = 'not_riding', notice_kind = p_kind, updated_at = now()
    from public.bus_trips t
   where t.id = ts.trip_id and ts.student_id = p_student and ts.status in ('expected', 'no_show')
     and t.service_date = p_date and (v_run = 'both' or t.run = v_run);

  v_label := case p_kind
    when 'absent' then 'is not coming to school (no bus morning or afternoon)'
    when 'pickup' then 'will be collected from school (no bus home)'
    else format('is not taking the %s bus', v_run) end;
  perform public._notify_parents(p_student, 'notice_saved',
    format('📝 Noted: %s %s', s.name, v_label),
    format('For %s. The attendant and the school can see it, and the bus won''t wait. '
           'Changed your mind? Cancel it in Live Track.',
           case when p_date = public.kigali_today() then 'today' else to_char(p_date, 'FMDay DD Mon') end),
    'announcements');
  return v_id;
end $$;
revoke all on function public.set_ride_notice(uuid, date, text, text, text) from public, anon;
grant execute on function public.set_ride_notice(uuid, date, text, text, text) to authenticated;

create or replace function public.cancel_ride_notice(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  n public.ride_notices;
  s public.students;
begin
  select * into n from public.ride_notices where id = p_id;
  if not found then raise exception 'Notice not found'; end if;
  if not (public.is_parent_of_student(n.student_id) or public.can_manage_school(n.school_id)) then
    raise exception 'Not allowed';
  end if;
  if n.cancelled_at is not null then return; end if;
  update public.ride_notices set cancelled_at = now() where id = p_id;
  update public.trip_students ts set status = 'expected', notice_kind = null, updated_at = now()
    from public.bus_trips t
   where t.id = ts.trip_id and ts.student_id = n.student_id and ts.status = 'not_riding'
     and t.status = 'open' and t.service_date = n.service_date and (n.run = 'both' or t.run = n.run)
     and not exists (select 1 from public.ride_notices o where o.id <> n.id and o.student_id = n.student_id
                      and o.service_date = n.service_date and o.cancelled_at is null and o.run in (t.run, 'both'));
  select * into s from public.students where id = n.student_id;
  perform public._notify_parents(n.student_id, 'notice_cancelled',
    format('↩️ %s takes the bus again', s.name),
    format('Your change for %s is cancelled. The bus expects them as usual.',
           case when n.service_date = public.kigali_today() then 'today' else to_char(n.service_date, 'FMDay DD Mon') end),
    'announcements');
end $$;
revoke all on function public.cancel_ride_notice(uuid) from public, anon;
grant execute on function public.cancel_ride_notice(uuid) to authenticated;

-- "Amina", "Amina and Brian", "Umutoni, Victor and Wendy"
create or replace function public._name_list(p_names text[])
returns text language sql immutable as $$
  select case
    when coalesce(array_length(p_names, 1), 0) = 0 then 'your child'
    when array_length(p_names, 1) = 1 then p_names[1]
    else array_to_string(p_names[1:array_length(p_names, 1) - 1], ', ') || ' and ' || p_names[array_length(p_names, 1)]
  end
$$;

-- "Bus has started": once per parent, naming their children and saying what to do.
create or replace function public.open_bus_trip(p_bus uuid, p_run text, p_date date default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_bus public.buses;
  v_trip uuid;
  v_date date := coalesce(p_date, public.kigali_today());
  v_new boolean := false;
  v_name text;
begin
  if p_run not in ('morning', 'afternoon') then raise exception 'Run must be morning or afternoon'; end if;
  select * into v_bus from public.buses where id = p_bus;
  if not found then raise exception 'Vehicle not found'; end if;
  if not public.is_bus_staff(p_bus) then raise exception 'You are not assigned to this vehicle'; end if;

  insert into public.bus_trips (school_id, bus_id, route_id, service_date, run, opened_by)
  values (v_bus.school_id, p_bus, v_bus.route_id, v_date, p_run, auth.uid())
  on conflict (bus_id, service_date, run) do nothing
  returning id into v_trip;
  v_new := v_trip is not null;
  if not v_new then
    select id into v_trip from public.bus_trips where bus_id = p_bus and service_date = v_date and run = p_run;
  end if;

  perform public._fill_trip_list(v_trip);

  if v_new and v_date = public.kigali_today() then
    v_name := public._bus_name(p_bus);
    insert into public.parent_notifications (user_id, school_id, kind, title, body, pushed_at)
    select k.parent_user_id, v_bus.school_id, 'trip_started',
           case when p_run = 'morning'
                then format('🚌 %s is on its way to pick up %s', v_name, k.kids)
                else format('🚌 %s is starting the trip home', v_name) end,
           case when p_run = 'morning'
                then format('Please have %s ready at the stop. We''ll tell you when the bus is one stop away.', k.kids)
                else format('We''ll tell you when %s gets on, and when the bus is one stop from your stop.', k.kids) end,
           case when k.muted then now() end
      from (select ps.parent_user_id,
                   public._name_list(array_agg(split_part(s.name, ' ', 1) order by s.name)) as kids,
                   bool_or(pr.approach = false) as muted
              from public.trip_students ts
              join public.students s on s.id = ts.student_id
              join public.parent_students ps on ps.student_id = ts.student_id
              left join public.parent_alert_prefs pr on pr.user_id = ps.parent_user_id
             where ts.trip_id = v_trip and ts.status = 'expected'
             group by ps.parent_user_id) k;
  end if;
  return v_trip;
end $$;
revoke all on function public.open_bus_trip(uuid, text, date) from public, anon;
grant execute on function public.open_bus_trip(uuid, text, date) to authenticated;

-- Bus at a stop / one stop away / left without a child: name the child and the stop.
create or replace function public._attendance_on_stop_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  t public.bus_trips;
  st public.stops;
  v_next uuid;
  v_bus text;
  r record;
begin
  select * into st from public.stops where id = new.stop_id;
  if not found or st.type = 'school' then return null; end if;

  select * into t from public.bus_trips
   where bus_id = new.bus_id and service_date = (new.occurred_at at time zone 'Africa/Kigali')::date and status = 'open'
   order by opened_at desc limit 1;
  if not found then return null; end if;
  v_bus := public._bus_name(t.bus_id);

  if new.event_type = 'arrive' then
    select s2.id into v_next from public.stops s2
     where s2.route_id = st.route_id and s2.type <> 'school' and s2.sequence is not null and st.sequence is not null
       and ((t.run = 'morning' and s2.sequence > st.sequence) or (t.run = 'afternoon' and s2.sequence < st.sequence))
     order by case when t.run = 'morning' then s2.sequence else -s2.sequence end
     limit 1;

    for r in
      select ts.student_id, s.name, ts.stop_id, my.name as my_stop
        from public.trip_students ts
        join public.students s on s.id = ts.student_id
        left join public.stops my on my.id = ts.stop_id
       where ts.trip_id = t.id and ts.stop_id in (new.stop_id, v_next)
         and ((t.run = 'morning' and ts.status = 'expected') or (t.run = 'afternoon' and ts.status = 'boarded'))
    loop
      if r.stop_id = new.stop_id then
        perform public._notify_parents(r.student_id, 'bus_at_stop',
          format('🚏 %s is at %s stop now', v_bus, st.name),
          case when t.run = 'morning' then format('%s should get on now. The bus will not wait long.', r.name)
               else format('%s is getting off here. Please meet them.', r.name) end, 'approach');
      else
        perform public._notify_parents(r.student_id, 'bus_next',
          format('🚌 %s is one stop away from %s', v_bus, coalesce(r.my_stop || ' stop', 'your stop')),
          case when t.run = 'morning'
               then format('It just reached %s. Please have %s ready at the stop.', st.name, r.name)
               else format('It just reached %s. %s gets off at the next stop — please be there.', st.name, r.name) end,
          'approach');
      end if;
    end loop;

  elsif new.event_type = 'depart' and t.run = 'morning' then
    for r in
      select ts.student_id, s.name from public.trip_students ts join public.students s on s.id = ts.student_id
       where ts.trip_id = t.id and ts.stop_id = new.stop_id and ts.status = 'expected'
    loop
      update public.trip_students set status = 'no_show', method = 'system', updated_at = now()
       where trip_id = t.id and student_id = r.student_id;
      insert into public.boarding_events (school_id, trip_id, bus_id, student_id, action, occurred_at, method)
      values (t.school_id, t.id, t.bus_id, r.student_id, 'auto_no_show', new.occurred_at, 'system');
      perform public._notify_parents(r.student_id, 'no_show',
        format('⚠️ %s missed the bus', r.name),
        format('%s left %s stop at %s without them. Please take them to school, or tell the school '
               'in Live Track ("Skip one bus trip").', v_bus, st.name, public._hhmm(new.occurred_at)));
    end loop;
  end if;
  return null;
exception when others then
  raise warning 'attendance stop hook skipped: %', sqlerrm;
  return null;
end $$;
