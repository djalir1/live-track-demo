-- ────────────────────────────────────────────────────────────────────────────
-- School attendance (manual check-in), part 2 of 2.
-- ────────────────────────────────────────────────────────────────────────────
-- Implements Phase 1 of LIVETRACK-Student-Attendance-Plan.pdf:
--
--   guardians, student_guardians   parents registered by the school (phone
--                                  number + activation code), linked to one
--                                  or more children. Linking keeps the
--                                  existing parent_students table in sync,
--                                  so every existing parent RLS rule works.
--   attendants                     bus attendants (phone + activation code)
--   bus_trips, trip_students       one trip list per bus, per day, per run
--                                  (morning / afternoon); a status per child
--   boarding_events                append-only log of every on / off tap
--   ride_notices                   parent "not riding / I'll pick up / absent"
--   announcements                  one-tap delay and incident messages
--   parent_notifications           the parent's alert feed (and phone push)
--   school_alerts                  no-show, wrong bus, not dropped off, …
--   class_register                 present at school (bus list vs register)
--   student_transport_overrides    temporary bus / stop change for a period
--   biometric_devices,             foundation for fingerprint / card / face
--   student_credentials            check-in (UNDER CONSTRUCTION: no device
--                                  is connected yet)
--
-- Rules that matter for safety:
--   • Attendance is per trip, not per day (a child driven to school in the
--     morning and bussed home is never "absent").
--   • A trip can't be closed while a child is still marked on board, and
--     only after the attendant confirms the "bus is empty" walk-through.
--   • Nothing here can block a GPS position write: the geofence hook catches
--     every error.
--
-- Writes go through SECURITY DEFINER functions that check who is calling;
-- tables only get SELECT policies (plus full access for school admins on the
-- registration tables). Idempotent: safe to re-run.
-- ────────────────────────────────────────────────────────────────────────────

-- ── 0. Helpers ───────────────────────────────────────────────────────────────

-- Kigali has no daylight saving: school days are Kigali calendar days.
create or replace function public.kigali_today()
returns date language sql stable as $$
  select (now() at time zone 'Africa/Kigali')::date
$$;

-- Phone numbers are stored as digits with the country code: 250788123456.
-- Accepts 0788 123 456, +250 788 123 456, 250788123456, 788123456.
create or replace function public.normalize_phone(p text)
returns text language plpgsql immutable as $$
declare d text := regexp_replace(coalesce(p, ''), '\D', '', 'g');
begin
  if d = '' then return null; end if;
  if length(d) = 10 and left(d, 1) = '0' then return '250' || substr(d, 2); end if;
  if length(d) = 9 and left(d, 1) = '7' then return '250' || d; end if;
  return d;
end $$;

-- School admin of this school, or super admin. Unlike same_school(), this
-- checks the ROLE, so parents / drivers who share the school never pass.
create or replace function public.can_manage_school(p_school uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    public.has_role(auth.uid(), 'admin'::app_role)
    or (
      public.has_role(auth.uid(), 'school_admin'::app_role)
      and exists (select 1 from public.profiles where id = auth.uid() and school_id = p_school)
    )
  )
$$;
revoke all on function public.can_manage_school(uuid) from public, anon;
grant execute on function public.can_manage_school(uuid) to authenticated;

-- Six random digits for activation codes.
create or replace function public._six_digits()
returns text language sql volatile as $$
  select lpad((floor(random() * 1000000))::int::text, 6, '0')
$$;

-- ── 1. Students: registration details ───────────────────────────────────────
alter table public.students add column if not exists student_code text;
alter table public.students add column if not exists photo_url text;
alter table public.students add column if not exists morning_stop_id uuid references public.stops(id) on delete set null;
alter table public.students add column if not exists afternoon_stop_id uuid references public.stops(id) on delete set null;
alter table public.students add column if not exists active boolean not null default true;
alter table public.students add column if not exists notes text;
alter table public.students add column if not exists photo_consent boolean not null default false;
alter table public.students add column if not exists biometric_consent boolean not null default false;
alter table public.students add column if not exists consent_recorded_at timestamptz;
alter table public.students add column if not exists updated_at timestamptz not null default now();
create index if not exists students_school_name_idx on public.students (school_id, name);
create index if not exists students_bus_idx on public.students (bus_id) where active;

drop trigger if exists students_touch on public.students;
create trigger students_touch before update on public.students
  for each row execute function public.touch_updated_at();

-- ── 2. Guardians (parents) ──────────────────────────────────────────────────
create table if not exists public.guardians (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  full_name text not null check (length(btrim(full_name)) > 0),
  phone text not null check (phone ~ '^[0-9]{9,15}$'),
  relationship text,
  email text,
  user_id uuid references public.profiles(id) on delete set null,
  activation_code text,
  activation_expires_at timestamptz,
  activation_attempts integer not null default 0,
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, phone)
);
create index if not exists guardians_phone_idx on public.guardians (phone);
create index if not exists guardians_user_idx on public.guardians (user_id);
alter table public.guardians enable row level security;

create table if not exists public.student_guardians (
  student_id uuid not null references public.students(id) on delete cascade,
  guardian_id uuid not null references public.guardians(id) on delete cascade,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (student_id, guardian_id)
);
create index if not exists student_guardians_guardian_idx on public.student_guardians (guardian_id);
alter table public.student_guardians enable row level security;

-- ── 3. Attendants (bus staff who mark children on / off) ────────────────────
create table if not exists public.attendants (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  full_name text not null check (length(btrim(full_name)) > 0),
  phone text not null check (phone ~ '^[0-9]{9,15}$'),
  bus_id uuid references public.buses(id) on delete set null,
  user_id uuid references public.profiles(id) on delete set null,
  active boolean not null default true,
  activation_code text,
  activation_expires_at timestamptz,
  activation_attempts integer not null default 0,
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, phone)
);
create index if not exists attendants_bus_idx on public.attendants (bus_id);
create index if not exists attendants_user_idx on public.attendants (user_id);
alter table public.attendants enable row level security;

-- Normalise phones and hand out an activation code on create.
create or replace function public._people_before_write()
returns trigger language plpgsql as $$
begin
  new.phone := public.normalize_phone(new.phone);
  new.full_name := btrim(new.full_name);
  if tg_op = 'INSERT' and new.user_id is null and new.activation_code is null then
    new.activation_code := public._six_digits();
    new.activation_expires_at := now() + interval '30 days';
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists guardians_before_write on public.guardians;
create trigger guardians_before_write before insert or update on public.guardians
  for each row execute function public._people_before_write();
drop trigger if exists attendants_before_write on public.attendants;
create trigger attendants_before_write before insert or update on public.attendants
  for each row execute function public._people_before_write();

-- Keep parent_students (used by every existing parent RLS rule) in sync with
-- the school's guardian links.
create or replace function public._sync_parent_links()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_user uuid;
begin
  if tg_table_name = 'guardians' then
    if new.user_id is not null then
      insert into public.parent_students (parent_user_id, student_id)
      select new.user_id, sg.student_id from public.student_guardians sg where sg.guardian_id = new.id
      on conflict do nothing;
    end if;
    if tg_op = 'UPDATE' and old.user_id is not null and old.user_id is distinct from new.user_id then
      delete from public.parent_students ps
       where ps.parent_user_id = old.user_id
         and ps.student_id in (select student_id from public.student_guardians where guardian_id = new.id)
         and not exists (
           select 1 from public.student_guardians sg2 join public.guardians g2 on g2.id = sg2.guardian_id
            where g2.user_id = old.user_id and sg2.student_id = ps.student_id and g2.id <> new.id);
    end if;
    return null;
  end if;

  -- student_guardians
  if tg_op = 'INSERT' then
    select user_id into v_user from public.guardians where id = new.guardian_id;
    if v_user is not null then
      insert into public.parent_students (parent_user_id, student_id)
      values (v_user, new.student_id) on conflict do nothing;
    end if;
  elsif tg_op = 'DELETE' then
    select user_id into v_user from public.guardians where id = old.guardian_id;
    if v_user is not null and not exists (
      select 1 from public.student_guardians sg join public.guardians g on g.id = sg.guardian_id
       where g.user_id = v_user and sg.student_id = old.student_id
    ) then
      delete from public.parent_students where parent_user_id = v_user and student_id = old.student_id;
    end if;
  end if;
  return null;
end $$;

drop trigger if exists guardians_sync_links on public.guardians;
create trigger guardians_sync_links after insert or update of user_id on public.guardians
  for each row execute function public._sync_parent_links();
drop trigger if exists student_guardians_sync_links on public.student_guardians;
create trigger student_guardians_sync_links after insert or delete on public.student_guardians
  for each row execute function public._sync_parent_links();

-- New activation code (also how a forgotten password is reset).
create or replace function public.issue_activation_code(p_kind text, p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_school uuid;
  v_code text := public._six_digits();
begin
  if p_kind = 'parent' then
    select school_id into v_school from public.guardians where id = p_id;
  elsif p_kind = 'attendant' then
    select school_id into v_school from public.attendants where id = p_id;
  else
    raise exception 'Unknown account type';
  end if;
  if v_school is null then raise exception 'Not found'; end if;
  if not public.can_manage_school(v_school) then raise exception 'Not allowed'; end if;

  if p_kind = 'parent' then
    update public.guardians set activation_code = v_code, activation_expires_at = now() + interval '30 days',
      activation_attempts = 0 where id = p_id;
  else
    update public.attendants set activation_code = v_code, activation_expires_at = now() + interval '30 days',
      activation_attempts = 0 where id = p_id;
  end if;
  return v_code;
end $$;
revoke all on function public.issue_activation_code(text, uuid) from public, anon;
grant execute on function public.issue_activation_code(text, uuid) to authenticated;

-- ── 4. Who may work a bus ───────────────────────────────────────────────────
-- Attendant assigned to it, its driver (app account or current assignment),
-- or a school admin of its school.
create or replace function public.is_bus_staff(p_bus uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (
    select 1 from public.buses b
     where b.id = p_bus and (
       b.driver_user_id = auth.uid()
       or public.can_manage_school(b.school_id)
       or exists (select 1 from public.attendants a
                   where a.bus_id = b.id and a.user_id = auth.uid() and a.active)
       or exists (select 1 from public.vehicle_assignments va
                    join public.drivers d on d.id = va.driver_id
                   where va.bus_id = b.id and va.ended_at is null and d.user_id = auth.uid())
     )
  )
$$;
revoke all on function public.is_bus_staff(uuid) from public, anon;
grant execute on function public.is_bus_staff(uuid) to authenticated;

-- ── 5. Temporary changes (bus / stop for a period) ──────────────────────────
create table if not exists public.student_transport_overrides (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  from_date date not null,
  to_date date not null,
  bus_id uuid references public.buses(id) on delete cascade,
  morning_stop_id uuid references public.stops(id) on delete set null,
  afternoon_stop_id uuid references public.stops(id) on delete set null,
  note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  check (to_date >= from_date)
);
create index if not exists overrides_student_idx on public.student_transport_overrides (student_id, from_date);
alter table public.student_transport_overrides enable row level security;

-- ── 6. Trips and the per-child trip list ────────────────────────────────────
create table if not exists public.bus_trips (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  bus_id uuid not null references public.buses(id) on delete cascade,
  route_id uuid references public.routes(id) on delete set null,
  service_date date not null,
  run text not null check (run in ('morning', 'afternoon')),
  status text not null default 'open' check (status in ('open', 'closed')),
  opened_at timestamptz not null default now(),
  opened_by uuid,
  closed_at timestamptz,
  closed_by uuid,
  empty_checked_at timestamptz,
  note text,
  unique (bus_id, service_date, run)
);
create index if not exists bus_trips_school_date_idx on public.bus_trips (school_id, service_date desc);
alter table public.bus_trips enable row level security;

create table if not exists public.trip_students (
  trip_id uuid not null references public.bus_trips(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete cascade,
  stop_id uuid references public.stops(id) on delete set null,
  status text not null default 'expected'
    check (status in ('expected', 'boarded', 'dropped_off', 'not_riding', 'no_show')),
  notice_kind text check (notice_kind in ('not_riding', 'pickup', 'absent')),
  wrong_bus boolean not null default false,
  boarded_at timestamptz,
  boarded_lat double precision,
  boarded_lng double precision,
  dropped_at timestamptz,
  dropped_lat double precision,
  dropped_lng double precision,
  method text check (method in ('manual', 'card', 'fingerprint', 'face', 'system')),
  marked_by uuid,
  updated_at timestamptz not null default now(),
  primary key (trip_id, student_id)
);
create index if not exists trip_students_student_idx on public.trip_students (student_id);
alter table public.trip_students enable row level security;

create table if not exists public.boarding_events (
  id bigserial primary key,
  school_id uuid not null references public.schools(id) on delete cascade,
  trip_id uuid not null references public.bus_trips(id) on delete cascade,
  bus_id uuid references public.buses(id) on delete set null,
  student_id uuid not null references public.students(id) on delete cascade,
  action text not null check (action in ('board', 'drop', 'not_here', 'undo', 'auto_no_show')),
  occurred_at timestamptz not null default now(),
  lat double precision,
  lng double precision,
  method text not null default 'manual',
  marked_by uuid,
  -- Set by the attendant's phone so a check-in sent twice (offline retry)
  -- is saved once.
  client_id uuid unique,
  created_at timestamptz not null default now()
);
create index if not exists boarding_events_student_idx on public.boarding_events (student_id, occurred_at desc);
create index if not exists boarding_events_trip_idx on public.boarding_events (trip_id, occurred_at);
alter table public.boarding_events enable row level security;

-- ── 7. Parent notices ("not riding", "I'll pick up", "absent") ──────────────
create table if not exists public.ride_notices (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  service_date date not null,
  run text not null check (run in ('morning', 'afternoon', 'both')),
  kind text not null check (kind in ('not_riding', 'pickup', 'absent')),
  note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  cancelled_at timestamptz
);
create index if not exists ride_notices_student_date_idx on public.ride_notices (student_id, service_date);
alter table public.ride_notices enable row level security;

-- ── 8. Announcements, parent feed, school alerts, class register ───────────
create table if not exists public.announcements (
  id bigserial primary key,
  school_id uuid not null references public.schools(id) on delete cascade,
  bus_id uuid references public.buses(id) on delete cascade,
  trip_id uuid references public.bus_trips(id) on delete set null,
  kind text not null check (kind in ('traffic', 'accident', 'breakdown', 'late', 'custom', 'school')),
  delay_min integer,
  message text not null,
  recipients integer not null default 0,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists announcements_school_time_idx on public.announcements (school_id, created_at desc);
alter table public.announcements enable row level security;

create table if not exists public.parent_notifications (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  school_id uuid references public.schools(id) on delete cascade,
  student_id uuid references public.students(id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null default '',
  url text not null default '/family',
  created_at timestamptz not null default now(),
  read_at timestamptz,
  -- gps-server sends phone push for rows where this is null.
  pushed_at timestamptz
);
create index if not exists parent_notifications_user_idx on public.parent_notifications (user_id, created_at desc);
create index if not exists parent_notifications_unpushed on public.parent_notifications (id) where pushed_at is null;
alter table public.parent_notifications enable row level security;

create table if not exists public.parent_alert_prefs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  boarding boolean not null default true,      -- boarded / got off / not at the stop
  approach boolean not null default true,      -- bus at the stop before yours
  announcements boolean not null default true, -- delays, incidents, school messages
  approach_km numeric(4, 1) not null default 2.0,
  updated_at timestamptz not null default now()
);
alter table public.parent_alert_prefs enable row level security;

create table if not exists public.school_alerts (
  id bigserial primary key,
  school_id uuid not null references public.schools(id) on delete cascade,
  bus_id uuid references public.buses(id) on delete set null,
  trip_id uuid references public.bus_trips(id) on delete cascade,
  student_id uuid references public.students(id) on delete cascade,
  kind text not null check (kind in
    ('no_show', 'wrong_bus', 'not_dropped', 'far_dropoff', 'left_at_school', 'missing', 'incident')),
  severity text not null default 'warning' check (severity in ('info', 'warning', 'urgent')),
  message text not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid,
  pushed_at timestamptz
);
create index if not exists school_alerts_open_idx on public.school_alerts (school_id, created_at desc) where resolved_at is null;
alter table public.school_alerts enable row level security;

create table if not exists public.class_register (
  school_id uuid not null references public.schools(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  service_date date not null,
  present boolean not null,
  marked_by uuid default auth.uid(),
  marked_at timestamptz not null default now(),
  primary key (student_id, service_date)
);
create index if not exists class_register_school_date_idx on public.class_register (school_id, service_date);
alter table public.class_register enable row level security;

-- ── 9. Biometrics foundation (UNDER CONSTRUCTION) ───────────────────────────
-- No reader is connected yet. These tables let the school register devices
-- and track who is enrolled; mark_student() already accepts the
-- 'fingerprint' / 'card' / 'face' methods. We never store fingerprint
-- images: template_ref is the reader's own encrypted template reference.
create table if not exists public.biometric_devices (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  bus_id uuid references public.buses(id) on delete set null,
  kind text not null default 'fingerprint' check (kind in ('fingerprint', 'card', 'face')),
  name text not null,
  model text,
  serial text,
  status text not null default 'planned' check (status in ('planned', 'active', 'offline', 'retired')),
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.biometric_devices enable row level security;

create table if not exists public.student_credentials (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  kind text not null check (kind in ('fingerprint', 'card', 'face')),
  label text,
  template_ref text,
  status text not null default 'pending' check (status in ('pending', 'enrolled', 'revoked')),
  device_id uuid references public.biometric_devices(id) on delete set null,
  enrolled_at timestamptz,
  enrolled_by uuid,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists student_credentials_student_idx on public.student_credentials (student_id);
alter table public.student_credentials enable row level security;

-- Lookups used inside policies. SECURITY DEFINER so policies on bus_trips,
-- trip_students and students never evaluate each other (Postgres rejects
-- that as infinite recursion).
create or replace function public._trip_bus(p_trip uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select bus_id from public.bus_trips where id = p_trip
$$;
create or replace function public._student_bus(p_student uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select bus_id from public.students where id = p_student
$$;
create or replace function public._parent_on_trip(p_trip uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.trip_students ts
                   join public.parent_students ps on ps.student_id = ts.student_id
                  where ts.trip_id = p_trip and ps.parent_user_id = auth.uid())
$$;
create or replace function public._parent_rides_bus(p_bus uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.bus_trips t
                   join public.trip_students ts on ts.trip_id = t.id
                   join public.parent_students ps on ps.student_id = ts.student_id
                  where t.bus_id = p_bus and t.service_date >= public.kigali_today() - 1
                    and ps.parent_user_id = auth.uid())
$$;
create or replace function public._staff_has_rider(p_student uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.trip_students ts join public.bus_trips t on t.id = ts.trip_id
                  where ts.student_id = p_student and t.service_date >= public.kigali_today() - 1
                    and public.is_bus_staff(t.bus_id))
$$;
do $$
declare f text;
begin
  foreach f in array array['_trip_bus(uuid)', '_student_bus(uuid)', '_parent_on_trip(uuid)',
                           '_parent_rides_bus(uuid)', '_staff_has_rider(uuid)']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ── 10. RLS ─────────────────────────────────────────────────────────────────
-- School-admin access to the registration tables (role-checked).
do $$
declare t text;
begin
  foreach t in array array['guardians', 'student_guardians', 'attendants', 'student_transport_overrides',
                           'class_register', 'biometric_devices', 'student_credentials']
  loop
    begin
      if t = 'student_guardians' then
        execute format($p$create policy "school admin manages %1$s" on public.%1$I for all to authenticated
          using (exists (select 1 from public.students s where s.id = student_id and public.can_manage_school(s.school_id)))
          with check (exists (select 1 from public.students s where s.id = student_id and public.can_manage_school(s.school_id)))$p$, t);
      else
        execute format($p$create policy "school admin manages %1$s" on public.%1$I for all to authenticated
          using (public.can_manage_school(school_id)) with check (public.can_manage_school(school_id))$p$, t);
      end if;
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- Same role-checked access on the core tables, so a fresh database (staging)
-- gives school admins what production gives them today.
do $$
declare t text;
begin
  foreach t in array array['students', 'buses', 'routes', 'stops', 'drivers', 'vehicle_assignments']
  loop
    begin
      execute format($p$create policy "school admin manages %1$s" on public.%1$I for all to authenticated
        using (public.can_manage_school(school_id)) with check (public.can_manage_school(school_id))$p$, t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- same_school() doesn't check the role, so these let a parent of the school
-- read drivers' phone numbers. Replaced by the role-checked policies above.
drop policy if exists "school admin same_school drivers" on public.drivers;
drop policy if exists "school admin same_school assignments" on public.vehicle_assignments;

-- Read-only access for the people involved.
do $$ begin
  create policy "parent sees own guardian rows" on public.guardians for select to authenticated
    using (user_id = auth.uid());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "parent sees own guardian links" on public.student_guardians for select to authenticated
    using (exists (select 1 from public.guardians g where g.id = guardian_id and g.user_id = auth.uid()));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "attendant sees self" on public.attendants for select to authenticated
    using (user_id = auth.uid());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "bus staff sees bus" on public.buses for select to authenticated
    using (public.is_bus_staff(id));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "bus staff sees route" on public.routes for select to authenticated
    using (exists (select 1 from public.buses b where b.route_id = routes.id and public.is_bus_staff(b.id)));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "bus staff sees stops" on public.stops for select to authenticated
    using (exists (select 1 from public.buses b where b.route_id = stops.route_id and public.is_bus_staff(b.id)));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "bus staff sees riders" on public.students for select to authenticated
    using ((bus_id is not null and public.is_bus_staff(bus_id)) or public._staff_has_rider(id));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "bus staff sees bus position" on public.device_status for select to authenticated
    using (exists (select 1 from public.buses b where b.driver_user_id = device_status.user_id and public.is_bus_staff(b.id)));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "bus staff sees stop events" on public.geofence_events for select to authenticated
    using (public.is_bus_staff(bus_id));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "read trips" on public.bus_trips for select to authenticated
    using (public.can_manage_school(school_id) or public.is_bus_staff(bus_id) or public._parent_on_trip(id));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "read trip list" on public.trip_students for select to authenticated
    using (public.can_manage_school(school_id) or public.is_parent_of_student(student_id)
           or public.is_bus_staff(public._trip_bus(trip_id)));
exception when duplicate_object then null; end $$;
-- A parent follows whichever bus their child is actually on today (moved
-- trip, temporary change, wrong bus), not only the usual one.
do $$ begin
  create policy "parent sees bus of child trip" on public.buses for select to authenticated
    using (public._parent_rides_bus(id));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "parent sees position of child trip bus" on public.device_status for select to authenticated
    using (exists (select 1 from public.buses b where b.driver_user_id = device_status.user_id
                    and public._parent_rides_bus(b.id)));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "read boarding events" on public.boarding_events for select to authenticated
    using (
      public.can_manage_school(school_id) or public.is_parent_of_student(student_id)
      or (bus_id is not null and public.is_bus_staff(bus_id)));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "read ride notices" on public.ride_notices for select to authenticated
    using (public.can_manage_school(school_id) or public.is_parent_of_student(student_id)
           or public.is_bus_staff(public._student_bus(student_id)));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "read announcements" on public.announcements for select to authenticated
    using (
      public.can_manage_school(school_id)
      or (bus_id is not null and (public.is_bus_staff(bus_id) or public.is_parent_of_bus(bus_id)))
      or (bus_id is null and exists (select 1 from public.parent_students ps
                                      join public.students s on s.id = ps.student_id
                                     where ps.parent_user_id = auth.uid() and s.school_id = announcements.school_id)));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "own notifications" on public.parent_notifications for select to authenticated
    using (user_id = auth.uid());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "own alert prefs" on public.parent_alert_prefs for all to authenticated
    using (user_id = auth.uid()) with check (user_id = auth.uid());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "read school alerts" on public.school_alerts for select to authenticated
    using (public.can_manage_school(school_id) or (bus_id is not null and public.is_bus_staff(bus_id)));
exception when duplicate_object then null; end $$;

-- School admins see their own school's vehicles on the live map and in trip
-- history (production already lets super admins see everything).
do $$ begin
  create policy "school admin sees school bus positions" on public.device_status for select to authenticated
    using (exists (select 1 from public.buses b where b.driver_user_id = device_status.user_id
                    and public.can_manage_school(b.school_id)));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "school admin sees school bus history" on public.location_history for select to authenticated
    using (exists (select 1 from public.buses b where b.driver_user_id = location_history.user_id
                    and public.can_manage_school(b.school_id)));
exception when duplicate_object then null; end $$;

-- ── 11. Notification helpers ────────────────────────────────────────────────
create or replace function public._bus_name(p_bus uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(nullif(btrim(label), ''), nullif(btrim(plate), ''), 'The bus') from public.buses where id = p_bus
$$;

create or replace function public._hhmm(p_at timestamptz)
returns text language sql stable as $$
  select to_char(p_at at time zone 'Africa/Kigali', 'HH24:MI')
$$;

-- One feed row per linked parent. p_pref is the parent_alert_prefs column
-- that can mute the phone push (the row still shows in the app).
create or replace function public._notify_parents(
  p_student uuid, p_kind text, p_title text, p_body text, p_pref text default 'boarding'
) returns integer language plpgsql security definer set search_path = public as $$
declare
  v_school uuid;
  v_n integer;
begin
  select school_id into v_school from public.students where id = p_student;
  insert into public.parent_notifications (user_id, school_id, student_id, kind, title, body, pushed_at)
  select ps.parent_user_id, v_school, p_student, p_kind, p_title, coalesce(p_body, ''),
         case
           when p_pref = 'boarding' and pr.boarding = false then now()
           when p_pref = 'approach' and pr.approach = false then now()
           when p_pref = 'announcements' and pr.announcements = false then now()
         end
    from public.parent_students ps
    left join public.parent_alert_prefs pr on pr.user_id = ps.parent_user_id
   where ps.student_id = p_student;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public._notify_parents(uuid, text, text, text, text) from public, anon, authenticated;

create or replace function public._school_alert(
  p_school uuid, p_bus uuid, p_trip uuid, p_student uuid, p_kind text, p_severity text, p_message text
) returns void language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.school_alerts
              where trip_id is not distinct from p_trip and student_id is not distinct from p_student
                and kind = p_kind and resolved_at is null) then
    return;
  end if;
  insert into public.school_alerts (school_id, bus_id, trip_id, student_id, kind, severity, message)
  values (p_school, p_bus, p_trip, p_student, p_kind, p_severity, p_message);
end $$;
revoke all on function public._school_alert(uuid, uuid, uuid, uuid, text, text, text) from public, anon, authenticated;

-- ── 12. Trip lists ──────────────────────────────────────────────────────────
-- Adds every child who should ride this trip (bus + stop, with temporary
-- changes applied) and marks the ones whose parent said "not riding".
-- Safe to call again: children already on the list keep their status.
create or replace function public._fill_trip_list(p_trip uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  t public.bus_trips;
begin
  select * into t from public.bus_trips where id = p_trip;
  if not found then return; end if;

  insert into public.trip_students (trip_id, student_id, school_id, stop_id)
  select t.id, s.id, s.school_id,
         case when t.run = 'morning'
              then coalesce(o.morning_stop_id, s.morning_stop_id, s.home_stop_id)
              else coalesce(o.afternoon_stop_id, s.afternoon_stop_id, s.home_stop_id) end
    from public.students s
    left join lateral (
      select * from public.student_transport_overrides x
       where x.student_id = s.id and t.service_date between x.from_date and x.to_date
       order by x.created_at desc limit 1
    ) o on true
   where s.school_id = t.school_id and s.active
     and coalesce(o.bus_id, s.bus_id) = t.bus_id
  on conflict (trip_id, student_id) do nothing;

  update public.trip_students ts
     set status = 'not_riding', notice_kind = n.kind, updated_at = now()
    from public.ride_notices n
   where ts.trip_id = t.id and ts.status = 'expected'
     and n.student_id = ts.student_id and n.service_date = t.service_date
     and n.cancelled_at is null and n.run in (t.run, 'both');
end $$;
revoke all on function public._fill_trip_list(uuid) from public, anon, authenticated;

-- Opens (or returns) today's trip for a bus. The first open tells the parents
-- of the children on the list that the bus has started.
create or replace function public.open_bus_trip(p_bus uuid, p_run text, p_date date default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_bus public.buses;
  v_trip uuid;
  v_date date := coalesce(p_date, public.kigali_today());
  v_new boolean := false;
  r record;
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
    for r in select ts.student_id from public.trip_students ts where ts.trip_id = v_trip and ts.status = 'expected' loop
      perform public._notify_parents(r.student_id, 'trip_started',
        format('🚌 %s has started the %s %s', public._bus_name(p_bus), p_run,
               case when p_run = 'morning' then 'pickup' else 'drop-off' end),
        'Follow the bus live in Live Track.', 'approach');
    end loop;
  end if;
  return v_trip;
end $$;
revoke all on function public.open_bus_trip(uuid, text, date) from public, anon;
grant execute on function public.open_bus_trip(uuid, text, date) to authenticated;

-- The attendant's tap. p_action: board | drop | not_here | undo.
-- Returns {status, wrong_bus, duplicate, far_m}.
create or replace function public.mark_student(
  p_trip uuid, p_student uuid, p_action text,
  p_lat double precision default null, p_lng double precision default null,
  p_at timestamptz default null, p_client_id uuid default null, p_method text default 'manual'
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  t public.bus_trips;
  ts public.trip_students;
  s public.students;
  st public.stops;
  v_at timestamptz := least(coalesce(p_at, now()), now() + interval '1 minute');
  v_bus text;
  v_where text;
  v_far double precision;
  v_prev text;
  v_wrong boolean := false;
begin
  if p_action not in ('board', 'drop', 'not_here', 'undo') then raise exception 'Unknown action'; end if;
  if coalesce(p_method, 'manual') not in ('manual', 'card', 'fingerprint', 'face') then raise exception 'Unknown method'; end if;
  select * into t from public.bus_trips where id = p_trip;
  if not found then raise exception 'Trip not found'; end if;
  if not public.is_bus_staff(t.bus_id) then raise exception 'You are not assigned to this vehicle'; end if;
  if t.status = 'closed' then raise exception 'This trip is already closed'; end if;

  -- The same tap sent twice (offline retry) is saved once.
  if p_client_id is not null and exists (select 1 from public.boarding_events where client_id = p_client_id) then
    select * into ts from public.trip_students where trip_id = p_trip and student_id = p_student;
    return jsonb_build_object('status', ts.status, 'duplicate', true);
  end if;

  select * into s from public.students where id = p_student and school_id = t.school_id;
  if not found then raise exception 'Student not found in this school'; end if;

  select * into ts from public.trip_students where trip_id = p_trip and student_id = p_student;
  if not found then
    -- Not on this bus's list: accept (safety first) but flag it.
    v_wrong := true;
    insert into public.trip_students (trip_id, student_id, school_id, stop_id, wrong_bus)
    values (p_trip, p_student, t.school_id,
            case when t.run = 'morning' then coalesce(s.morning_stop_id, s.home_stop_id)
                 else coalesce(s.afternoon_stop_id, s.home_stop_id) end, true)
    returning * into ts;
  end if;
  v_prev := ts.status;

  -- A second identical tap within 2 minutes is ignored.
  if (p_action = 'board' and ts.status = 'boarded' and ts.boarded_at > v_at - interval '2 minutes')
     or (p_action = 'drop' and ts.status = 'dropped_off' and ts.dropped_at > v_at - interval '2 minutes') then
    return jsonb_build_object('status', ts.status, 'duplicate', true);
  end if;

  v_bus := public._bus_name(t.bus_id);
  select * into st from public.stops where id = ts.stop_id;

  if p_action = 'board' then
    update public.trip_students set status = 'boarded', boarded_at = v_at, boarded_lat = p_lat, boarded_lng = p_lng,
      dropped_at = null, dropped_lat = null, dropped_lng = null,
      method = coalesce(p_method, 'manual'), marked_by = auth.uid(), updated_at = now()
     where trip_id = p_trip and student_id = p_student;
    v_where := case when t.run = 'afternoon' then 'at school'
                    when st.name is not null then format('at %s stop', st.name) else '' end;
    perform public._notify_parents(p_student, 'boarded',
      format('✅ %s boarded %s %s', s.name, v_bus, v_where),
      format('At %s. %s', public._hhmm(v_at),
             case when t.run = 'morning' then 'Heading to school.' else 'Heading home.' end));
    if v_wrong then
      perform public._school_alert(t.school_id, t.bus_id, p_trip, p_student, 'wrong_bus', 'warning',
        format('%s boarded %s, which is not their usual bus.', s.name, v_bus));
      perform public._notify_parents(p_student, 'wrong_bus',
        format('ℹ️ %s is on %s today', s.name, v_bus),
        'This is not their usual bus. The school has been told.');
    end if;

  elsif p_action = 'drop' then
    update public.trip_students set status = 'dropped_off', dropped_at = v_at, dropped_lat = p_lat, dropped_lng = p_lng,
      boarded_at = coalesce(boarded_at, v_at),
      method = coalesce(p_method, 'manual'), marked_by = auth.uid(), updated_at = now()
     where trip_id = p_trip and student_id = p_student;
    if t.run = 'morning' then
      perform public._notify_parents(p_student, 'dropped_off',
        format('🏫 %s arrived at school', s.name), format('Got off %s at %s.', v_bus, public._hhmm(v_at)));
    else
      perform public._notify_parents(p_student, 'dropped_off',
        format('🏠 %s got off %s', s.name, case when st.name is not null then 'at ' || st.name || ' stop' else 'the bus' end),
        format('At %s.', public._hhmm(v_at)));
      -- Far from the child's stop? Tell the school.
      if p_lat is not null and st.lat is not null then
        v_far := public._haversine_m(p_lat, p_lng, st.lat, st.lng);
        if v_far > greatest(500, st.radius_m * 3) then
          perform public._school_alert(t.school_id, t.bus_id, p_trip, p_student, 'far_dropoff', 'warning',
            format('%s got off %s m from their stop (%s).', s.name, round(v_far)::int, st.name));
        end if;
      end if;
    end if;

  elsif p_action = 'not_here' then
    update public.trip_students set status = 'no_show', method = coalesce(p_method, 'manual'),
      marked_by = auth.uid(), updated_at = now()
     where trip_id = p_trip and student_id = p_student;
    if t.run = 'morning' then
      perform public._notify_parents(p_student, 'no_show',
        format('⚠️ %s was not at the stop', s.name),
        format('%s left %s at %s without them.', v_bus, coalesce(st.name || ' stop', 'the stop'), public._hhmm(v_at)));
    else
      perform public._notify_parents(p_student, 'no_show',
        format('⚠️ %s did not get on %s', s.name, v_bus),
        'The school has been told. Contact the school if you picked them up.');
      perform public._school_alert(t.school_id, t.bus_id, p_trip, p_student, 'left_at_school', 'urgent',
        format('%s was not on %s when it left school.', s.name, v_bus));
    end if;

  else -- undo
    update public.trip_students set
      status = case when notice_kind is not null then 'not_riding' else 'expected' end,
      boarded_at = null, boarded_lat = null, boarded_lng = null,
      dropped_at = null, dropped_lat = null, dropped_lng = null,
      marked_by = auth.uid(), updated_at = now()
     where trip_id = p_trip and student_id = p_student;
    if v_prev in ('boarded', 'dropped_off', 'no_show') then
      perform public._notify_parents(p_student, 'correction',
        format('Correction for %s', s.name),
        'The last update was tapped by mistake. You will get the right one shortly.');
    end if;
  end if;

  insert into public.boarding_events (school_id, trip_id, bus_id, student_id, action, occurred_at, lat, lng, method, marked_by, client_id)
  values (t.school_id, p_trip, t.bus_id, p_student, p_action, v_at, p_lat, p_lng, coalesce(p_method, 'manual'), auth.uid(), p_client_id);

  select * into ts from public.trip_students where trip_id = p_trip and student_id = p_student;
  return jsonb_build_object('status', ts.status, 'wrong_bus', ts.wrong_bus, 'duplicate', false);
end $$;
revoke all on function public.mark_student(uuid, uuid, text, double precision, double precision, timestamptz, uuid, text) from public, anon;
grant execute on function public.mark_student(uuid, uuid, text, double precision, double precision, timestamptz, uuid, text) to authenticated;

-- "Everyone off at school": drops every child still on board.
create or replace function public.drop_all(p_trip uuid, p_lat double precision default null, p_lng double precision default null)
returns integer language plpgsql security definer set search_path = public as $$
declare
  r record;
  n integer := 0;
begin
  for r in select student_id from public.trip_students where trip_id = p_trip and status = 'boarded' loop
    perform public.mark_student(p_trip, r.student_id, 'drop', p_lat, p_lng);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.drop_all(uuid, double precision, double precision) from public, anon;
grant execute on function public.drop_all(uuid, double precision, double precision) to authenticated;

-- Closing a trip: never while a child is still on board, and only after the
-- "bus is empty" walk-through. Children still "expected" become no-shows.
create or replace function public.close_bus_trip(p_trip uuid, p_bus_empty boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  t public.bus_trips;
  v_names text;
  r record;
begin
  select * into t from public.bus_trips where id = p_trip;
  if not found then raise exception 'Trip not found'; end if;
  if not public.is_bus_staff(t.bus_id) then raise exception 'You are not assigned to this vehicle'; end if;
  if t.status = 'closed' then return; end if;

  select string_agg(s.name, ', ' order by s.name) into v_names
    from public.trip_students ts join public.students s on s.id = ts.student_id
   where ts.trip_id = p_trip and ts.status = 'boarded';
  if v_names is not null then
    raise exception 'Still marked on board: %. Mark them off before closing the trip.', v_names;
  end if;
  if not coalesce(p_bus_empty, false) then
    raise exception 'Walk through the bus and confirm it is empty before closing the trip.';
  end if;

  for r in select ts.student_id from public.trip_students ts where ts.trip_id = p_trip and ts.status = 'expected' loop
    perform public.mark_student(p_trip, r.student_id, 'not_here');
  end loop;

  update public.bus_trips set status = 'closed', closed_at = now(), closed_by = auth.uid(), empty_checked_at = now()
   where id = p_trip;
  update public.school_alerts set resolved_at = now(), resolved_by = auth.uid()
   where trip_id = p_trip and kind = 'not_dropped' and resolved_at is null;
end $$;
revoke all on function public.close_bus_trip(uuid, boolean) from public, anon;
grant execute on function public.close_bus_trip(uuid, boolean) to authenticated;

-- Bus broke down: move the trip list to another bus in one step.
create or replace function public.move_trip(p_trip uuid, p_to_bus uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  t public.bus_trips;
  v_target uuid;
  v_to public.buses;
  r record;
begin
  select * into t from public.bus_trips where id = p_trip;
  if not found then raise exception 'Trip not found'; end if;
  if not public.can_manage_school(t.school_id) then raise exception 'Only the school can move a trip'; end if;
  select * into v_to from public.buses where id = p_to_bus and school_id = t.school_id;
  if not found then raise exception 'Vehicle not found in this school'; end if;
  if p_to_bus = t.bus_id then return p_trip; end if;

  select id into v_target from public.bus_trips where bus_id = p_to_bus and service_date = t.service_date and run = t.run;
  if v_target is null then
    update public.bus_trips set bus_id = p_to_bus, note = coalesce(note || ' · ', '') || 'Moved from ' || public._bus_name(t.bus_id)
     where id = p_trip;
    v_target := p_trip;
  else
    insert into public.trip_students (trip_id, student_id, school_id, stop_id, status, notice_kind, wrong_bus,
      boarded_at, boarded_lat, boarded_lng, dropped_at, dropped_lat, dropped_lng, method, marked_by)
    select v_target, student_id, school_id, stop_id, status, notice_kind, wrong_bus,
      boarded_at, boarded_lat, boarded_lng, dropped_at, dropped_lat, dropped_lng, method, marked_by
      from public.trip_students where trip_id = p_trip
    on conflict (trip_id, student_id) do nothing;
    delete from public.trip_students where trip_id = p_trip;
    update public.bus_trips set status = 'closed', closed_at = now(), closed_by = auth.uid(),
      note = coalesce(note || ' · ', '') || 'Moved to ' || public._bus_name(p_to_bus)
     where id = p_trip;
  end if;

  for r in select student_id from public.trip_students where trip_id = v_target and status in ('expected', 'boarded') loop
    perform public._notify_parents(r.student_id, 'bus_changed',
      format('🔁 Change of bus: %s', public._bus_name(p_to_bus)),
      format('%s is replacing %s for this trip. You are now following the new bus.',
             public._bus_name(p_to_bus), public._bus_name(t.bus_id)), 'announcements');
  end loop;
  return v_target;
end $$;
revoke all on function public.move_trip(uuid, uuid) from public, anon;
grant execute on function public.move_trip(uuid, uuid) to authenticated;

-- ── 13. Parent notices ──────────────────────────────────────────────────────
-- kind: not_riding (one run), pickup (afternoon), absent (whole day).
create or replace function public.set_ride_notice(
  p_student uuid, p_date date, p_kind text, p_run text default null, p_note text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  s public.students;
  v_run text;
  v_id uuid;
  v_label text;
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

  insert into public.ride_notices (school_id, student_id, service_date, run, kind, note)
  values (s.school_id, p_student, p_date, v_run, p_kind, nullif(btrim(p_note), ''))
  returning id into v_id;

  update public.trip_students ts set status = 'not_riding', notice_kind = p_kind, updated_at = now()
    from public.bus_trips t
   where t.id = ts.trip_id and ts.student_id = p_student and ts.status = 'expected'
     and t.service_date = p_date and (v_run = 'both' or t.run = v_run);

  v_label := case p_kind
    when 'absent' then 'is absent (no bus either way)'
    when 'pickup' then 'will be picked up from school (no afternoon bus)'
    else format('is not riding the %s bus', v_run) end;
  perform public._notify_parents(p_student, 'notice_saved',
    format('Noted: %s %s', s.name, v_label),
    format('For %s. The bus will not wait for them.', to_char(p_date, 'Dy DD Mon')), 'announcements');
  return v_id;
end $$;
revoke all on function public.set_ride_notice(uuid, date, text, text, text) from public, anon;
grant execute on function public.set_ride_notice(uuid, date, text, text, text) to authenticated;

create or replace function public.cancel_ride_notice(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  n public.ride_notices;
begin
  select * into n from public.ride_notices where id = p_id;
  if not found then raise exception 'Notice not found'; end if;
  if not (public.is_parent_of_student(n.student_id) or public.can_manage_school(n.school_id)) then
    raise exception 'Not allowed';
  end if;
  update public.ride_notices set cancelled_at = now() where id = p_id and cancelled_at is null;
  update public.trip_students ts set status = 'expected', notice_kind = null, updated_at = now()
    from public.bus_trips t
   where t.id = ts.trip_id and ts.student_id = n.student_id and ts.status = 'not_riding'
     and t.status = 'open' and t.service_date = n.service_date and (n.run = 'both' or t.run = n.run)
     and not exists (select 1 from public.ride_notices o where o.id <> n.id and o.student_id = n.student_id
                      and o.service_date = n.service_date and o.cancelled_at is null and o.run in (t.run, 'both'));
end $$;
revoke all on function public.cancel_ride_notice(uuid) from public, anon;
grant execute on function public.cancel_ride_notice(uuid) to authenticated;

-- ── 14. Announcements ───────────────────────────────────────────────────────
-- From the bus (p_bus) or from the school to everyone (p_bus null).
create or replace function public.post_announcement(
  p_school uuid, p_bus uuid, p_kind text, p_delay_min integer default null, p_message text default null
) returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_id bigint;
  v_title text;
  v_body text;
  v_bus text;
  v_trip uuid;
  v_n integer := 0;
  r record;
begin
  if p_kind not in ('traffic', 'accident', 'breakdown', 'late', 'custom', 'school') then raise exception 'Unknown message type'; end if;
  if p_bus is not null then
    if not public.is_bus_staff(p_bus) then raise exception 'You are not assigned to this vehicle'; end if;
    select school_id into p_school from public.buses where id = p_bus;
    v_bus := public._bus_name(p_bus);
    select id into v_trip from public.bus_trips
     where bus_id = p_bus and service_date = public.kigali_today() and status = 'open'
     order by opened_at desc limit 1;
  elsif not public.can_manage_school(p_school) then
    raise exception 'Only the school can message every parent';
  elsif p_kind <> 'school' then
    raise exception 'Choose a bus for this message';
  end if;

  v_title := case p_kind
    when 'traffic' then format('⚠️ %s: heavy traffic%s', v_bus, case when p_delay_min > 0 then format(', about %s min late', p_delay_min) else '' end)
    when 'late' then format('⏱️ %s is running about %s min late', v_bus, coalesce(p_delay_min, 10))
    when 'accident' then format('🚨 %s: accident on the road — all children are safe', v_bus)
    when 'breakdown' then format('🛠️ %s has broken down', v_bus)
    when 'custom' then format('💬 Message from %s', v_bus)
    else '📣 Message from the school' end;
  v_body := coalesce(nullif(btrim(p_message), ''), case p_kind
    when 'accident' then 'The school has been told and will keep you updated.'
    when 'breakdown' then 'The school is arranging another bus. You will be told when it is on its way.'
    else '' end);
  if p_kind in ('custom', 'school') and v_body = '' then raise exception 'Write a message'; end if;

  insert into public.announcements (school_id, bus_id, trip_id, kind, delay_min, message)
  values (p_school, p_bus, v_trip, p_kind, p_delay_min, v_title || case when v_body <> '' then ' — ' || v_body else '' end)
  returning id into v_id;

  for r in
    select distinct s.id from public.students s
     where s.school_id = p_school and s.active
       and (p_bus is null or s.bus_id = p_bus
            or exists (select 1 from public.trip_students ts where ts.trip_id = v_trip and ts.student_id = s.id))
  loop
    v_n := v_n + public._notify_parents(r.id, 'announcement', v_title, v_body, 'announcements');
  end loop;
  update public.announcements set recipients = v_n where id = v_id;

  if p_kind in ('accident', 'breakdown') and p_bus is not null then
    perform public._school_alert(p_school, p_bus, v_trip, null, 'incident', 'urgent', v_title);
  end if;
  return v_id;
end $$;
revoke all on function public.post_announcement(uuid, uuid, text, integer, text) from public, anon;
grant execute on function public.post_announcement(uuid, uuid, text, integer, text) to authenticated;

-- ── 15. Small RPCs for the apps ─────────────────────────────────────────────
create or replace function public.mark_notifications_read(p_ids bigint[] default null)
returns void language sql security definer set search_path = public as $$
  update public.parent_notifications set read_at = now()
   where user_id = auth.uid() and read_at is null and (p_ids is null or id = any(p_ids))
$$;
revoke all on function public.mark_notifications_read(bigint[]) from public, anon;
grant execute on function public.mark_notifications_read(bigint[]) to authenticated;

-- Attendant search when a child who isn't on the list gets on.
create or replace function public.find_student_for_trip(p_trip uuid, p_query text)
returns table (id uuid, name text, class text, photo_url text, bus_id uuid)
language plpgsql stable security definer set search_path = public as $$
declare t public.bus_trips;
begin
  select * into t from public.bus_trips where bus_trips.id = p_trip;
  if not found or not public.is_bus_staff(t.bus_id) then raise exception 'Not allowed'; end if;
  return query
    select s.id, s.name, s.class, s.photo_url, s.bus_id from public.students s
     where s.school_id = t.school_id and s.active and length(btrim(p_query)) >= 2
       and (s.name ilike '%' || btrim(p_query) || '%' or s.student_code ilike btrim(p_query) || '%')
     order by s.name limit 15;
end $$;
revoke all on function public.find_student_for_trip(uuid, text) from public, anon;
grant execute on function public.find_student_for_trip(uuid, text) to authenticated;

create or replace function public.resolve_school_alert(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare v_school uuid;
begin
  select school_id into v_school from public.school_alerts where id = p_id;
  if v_school is null or not public.can_manage_school(v_school) then raise exception 'Not allowed'; end if;
  update public.school_alerts set resolved_at = now(), resolved_by = auth.uid() where id = p_id and resolved_at is null;
end $$;
revoke all on function public.resolve_school_alert(bigint) from public, anon;
grant execute on function public.resolve_school_alert(bigint) to authenticated;

-- ── 16. Stop arrival hook (uses the existing geofence detection) ────────────
-- Arrive at a stop  → parents whose child gets on / off at the NEXT stop
--                     hear "the bus is at <stop>, yours is next"; parents
--                     whose child's stop this is hear "the bus is here".
-- Depart a stop (morning) → children still "expected" there become no-shows.
-- Never raises: an alert must not block a GPS position write.
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
    -- Next pickup stop in run order (morning: sequence up; afternoon: down).
    select s2.id into v_next from public.stops s2
     where s2.route_id = st.route_id and s2.type <> 'school' and s2.sequence is not null and st.sequence is not null
       and ((t.run = 'morning' and s2.sequence > st.sequence) or (t.run = 'afternoon' and s2.sequence < st.sequence))
     order by case when t.run = 'morning' then s2.sequence else -s2.sequence end
     limit 1;

    for r in
      select ts.student_id, s.name, ts.stop_id from public.trip_students ts join public.students s on s.id = ts.student_id
       where ts.trip_id = t.id and ts.stop_id in (new.stop_id, v_next)
         and ((t.run = 'morning' and ts.status = 'expected') or (t.run = 'afternoon' and ts.status = 'boarded'))
    loop
      if r.stop_id = new.stop_id then
        perform public._notify_parents(r.student_id, 'bus_at_stop',
          format('🚏 %s is at %s stop', v_bus, st.name),
          case when t.run = 'morning' then format('%s should get on now.', r.name)
               else format('%s is getting off now.', r.name) end, 'approach');
      else
        perform public._notify_parents(r.student_id, 'bus_next',
          format('🚌 %s is one stop away', v_bus),
          format('It just reached %s. Your stop is next.', st.name), 'approach');
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
        format('⚠️ %s was not at the stop', r.name),
        format('%s left %s stop at %s without them.', v_bus, st.name, public._hhmm(new.occurred_at)));
    end loop;
  end if;
  return null;
exception when others then
  raise warning 'attendance stop hook skipped: %', sqlerrm;
  return null;
end $$;

drop trigger if exists attendance_on_stop_event on public.geofence_events;
create trigger attendance_on_stop_event after insert on public.geofence_events
  for each row execute function public._attendance_on_stop_event();

-- ── 17. "Child left on the bus" check ───────────────────────────────────────
-- An open trip with a child still on board, 10 min after the engine stopped,
-- raises an urgent school alert. gps-server calls this every minute; the
-- school pages call it too. Idempotent.
create or replace function public.check_open_trips()
returns integer language plpgsql security definer set search_path = public as $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select t.id as trip_id, t.school_id, t.bus_id, ts.student_id, s.name
      from public.bus_trips t
      join public.buses b on b.id = t.bus_id
      join public.device_status d on d.user_id = b.driver_user_id
      join public.trip_students ts on ts.trip_id = t.id and ts.status = 'boarded'
      join public.students s on s.id = ts.student_id
     where t.status = 'open'
       and t.service_date >= public.kigali_today() - 1
       and d.is_tracking = false
       and ts.boarded_at < now() - interval '10 minutes'
       and exists (select 1 from public.fleet_events fe
                    where fe.bus_id = t.bus_id and fe.kind = 'trip_ended'
                      and fe.occurred_at > ts.boarded_at and fe.occurred_at < now() - interval '10 minutes')
  loop
    if not exists (select 1 from public.school_alerts a where a.trip_id = r.trip_id and a.student_id = r.student_id
                    and a.kind = 'not_dropped') then
      perform public._school_alert(r.school_id, r.bus_id, r.trip_id, r.student_id, 'not_dropped', 'urgent',
        format('🚨 %s is still marked on board %s, and its engine has been off for 10 min. Check the bus now.',
               r.name, public._bus_name(r.bus_id)));
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke all on function public.check_open_trips() from public, anon;
grant execute on function public.check_open_trips() to authenticated;

-- ── 18. Realtime ────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['parent_notifications', 'trip_students', 'school_alerts', 'announcements', 'bus_trips']
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
             when others then null;
    end;
  end loop;
end $$;
