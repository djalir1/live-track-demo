-- ────────────────────────────────────────────────────────────────────────────
-- GPS-tracker vehicles, set up from the Vehicles page only:
--   1. A vehicle with a GPS tracker always reports under its own tracker
--      account, even when its driver also has the driver app. Before, picking
--      an app driver pointed the tracker at that person's account, so the
--      tracker and the phone overwrote each other's position.
--   2. Deleting a tracker vehicle (or removing its tracker) takes it off the
--      live dashboard and closes its open trip. Before, its last position
--      stayed on the dashboard forever.
-- Idempotent: safe to re-run.
-- ────────────────────────────────────────────────────────────────────────────

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

  if b.gps_imei is null and d.id is not null and d.user_id is not null then
    -- Phone-tracked vehicle: positions come from the driver's app.
    update public.buses set driver_user_id = d.user_id, gps_driver_name = null where id = p_bus;
  else
    update public.buses
       set gps_driver_name = case
             when d.id is not null then d.full_name
             when b.gps_imei is not null then 'No driver'
             else null end,
           -- keep the tracker account only if the bus was already in tracker
           -- mode; otherwise gps-server creates one on the tracker's first report
           driver_user_id = case when b.gps_driver_name is not null then b.driver_user_id else null end
     where id = p_bus;
  end if;
end
$$;
revoke all on function public.sync_bus_driver(uuid) from public, anon, authenticated;

-- A tracker gained or lost on an existing vehicle: re-derive who it reports as.
create or replace function public.buses_imei_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.sync_bus_driver(new.id);
  return null;
end
$$;
drop trigger if exists buses_imei_sync on public.buses;
create trigger buses_imei_sync after update of gps_imei on public.buses
  for each row when ((old.gps_imei is null) <> (new.gps_imei is null))
  execute function public.buses_imei_sync();

-- Tracker vehicle deleted, or its tracker removed: clear its live status.
create or replace function public.buses_tracker_gone()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.gps_imei is not null and old.gps_driver_name is not null and old.driver_user_id is not null
     and (tg_op = 'DELETE' or new.gps_imei is null) then
    update public.trip_sessions set ended_at = now()
     where user_id = old.driver_user_id and ended_at is null;
    delete from public.device_status where user_id = old.driver_user_id;
  end if;
  return null;
end
$$;
drop trigger if exists buses_tracker_gone on public.buses;
create trigger buses_tracker_gone after delete or update of gps_imei on public.buses
  for each row execute function public.buses_tracker_gone();
