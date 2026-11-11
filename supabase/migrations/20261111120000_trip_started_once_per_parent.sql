-- "Bus X has started the morning pickup" was sent once per CHILD, so a parent
-- with three children on the bus got it three times. Now once per parent.
-- (Found in the demo; safe for production too. Idempotent.)
create or replace function public.open_bus_trip(p_bus uuid, p_run text, p_date date default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_bus public.buses;
  v_trip uuid;
  v_date date := coalesce(p_date, public.kigali_today());
  v_new boolean := false;
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
    insert into public.parent_notifications (user_id, school_id, kind, title, body, pushed_at)
    select distinct ps.parent_user_id, v_bus.school_id, 'trip_started',
           format('🚌 %s has started the %s %s', public._bus_name(p_bus), p_run,
                  case when p_run = 'morning' then 'pickup' else 'drop-off' end),
           'Follow the bus live in Live Track.',
           case when pr.approach = false then now() end
      from public.trip_students ts
      join public.parent_students ps on ps.student_id = ts.student_id
      left join public.parent_alert_prefs pr on pr.user_id = ps.parent_user_id
     where ts.trip_id = v_trip and ts.status = 'expected';
  end if;
  return v_trip;
end $$;
revoke all on function public.open_bus_trip(uuid, text, date) from public, anon;
grant execute on function public.open_bus_trip(uuid, text, date) to authenticated;
