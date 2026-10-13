-- Hardware GPS trackers (GT06) identify themselves by IMEI. The gps-server
-- maps IMEI → bus → driver_user_id and writes device_status/location_history
-- for that driver, so every existing screen keeps working unchanged.
alter table public.buses add column if not exists gps_imei text;

create unique index if not exists buses_gps_imei_key
  on public.buses (gps_imei) where gps_imei is not null;

alter table public.buses drop constraint if exists buses_gps_imei_format;
alter table public.buses add constraint buses_gps_imei_format
  check (gps_imei is null or gps_imei ~ '^[0-9]{15}$');

-- Name shown for the bus's driver when the tracker itself is the "driver"
-- (no phone app). The gps-server creates that driver account on first contact.
alter table public.buses add column if not exists gps_driver_name text;
