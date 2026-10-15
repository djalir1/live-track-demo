-- GPS lock state from hardware trackers, so the dashboard can say "searching
-- for GPS" (engine just started, garage, tunnel) instead of looking frozen.
-- Written by gps-server; phones leave them at the defaults.
alter table public.device_status
  add column if not exists gps_fix boolean not null default true,
  add column if not exists satellites smallint;

comment on column public.device_status.gps_fix is
  'false while a hardware tracker is online but has no GPS lock; position is the last known one';
comment on column public.device_status.satellites is
  'satellites in view reported by a hardware tracker';
