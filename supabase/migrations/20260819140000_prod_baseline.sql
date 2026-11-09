-- ────────────────────────────────────────────────────────────────────────────
-- Production baseline: objects that exist in the live database but were
-- created outside the migration files (dashboard / Lovable). Captured from
-- production on 2026-11-09 so a NEW project (staging, demo, another client)
-- built from supabase/migrations matches production exactly.
--
-- On production every statement is a no-op (IF NOT EXISTS / duplicate_object
-- guards / CREATE OR REPLACE with the same body). Idempotent.
-- ────────────────────────────────────────────────────────────────────────────

-- 1. Vehicle type on driver profiles ----------------------------------------
do $$ begin
  create type public.vehicle_type as enum ('car','suv','van','truck','pickup','bus','motorcycle','bicycle','other');
exception when duplicate_object then null; end $$;

alter table public.profiles add column if not exists vehicle_type public.vehicle_type not null default 'car';
alter table public.profiles add column if not exists vehicle_color text;
alter table public.profiles add column if not exists plate_number text;
alter table public.profiles add column if not exists seats integer;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  insert into public.profiles (id, display_name, vehicle_name, vehicle_type, vehicle_color, plate_number, seats)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'vehicle_name',
    coalesce(nullif(new.raw_user_meta_data->>'vehicle_type','')::public.vehicle_type, 'car'::public.vehicle_type),
    new.raw_user_meta_data->>'vehicle_color',
    nullif(new.raw_user_meta_data->>'plate_number',''),
    nullif(new.raw_user_meta_data->>'seats','')::int
  );
  insert into public.user_roles (user_id, role) values (new.id, 'user');
  return new;
end;
$function$;

-- 2. Trip sessions (engine on → off; written by gps-server and the driver app)
create table if not exists public.trip_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists trip_sessions_user_id_started_at_idx on public.trip_sessions (user_id, started_at desc);
alter table public.trip_sessions enable row level security;

-- 3. Free-standing geofences (legacy, still read by the app) ---------------
create table if not exists public.geofences (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  latitude double precision not null,
  longitude double precision not null,
  radius_m integer not null default 100,
  created_by uuid,
  created_at timestamptz not null default now()
);
alter table public.geofences enable row level security;

-- 4. Helper functions -------------------------------------------------------
create or replace function public.school_of_user(_user_id uuid)
returns uuid language sql stable security definer set search_path to 'public' as $function$
  select school_id from public.profiles where id = _user_id
$function$;

create or replace function public.is_school_admin_of(_school_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $function$
  select exists (
    select 1 from public.user_roles ur
    join public.profiles p on p.id = ur.user_id
    where ur.user_id = auth.uid()
      and ur.role = 'school_admin'
      and p.school_id = _school_id
  )
$function$;

create or replace function public.check_invite(_code text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare
  v_invite public.invites%rowtype;
  v_school_name text;
  v_student_names text[];
begin
  select * into v_invite from public.invites
   where code = _code and used_at is null and (expires_at is null or expires_at > now())
   limit 1;
  if not found then return null; end if;
  select name into v_school_name from public.schools where id = v_invite.school_id;
  select array_agg(name order by name) into v_student_names from public.students
    where id = any (v_invite.student_ids);
  return jsonb_build_object('valid', true, 'phone', v_invite.phone, 'school_id', v_invite.school_id,
    'school_name', v_school_name, 'student_names', v_student_names);
end;
$function$;

create or replace function public.redeem_invite(_code text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_uid uuid := auth.uid();
  v_invite public.invites%rowtype;
  v_sid uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select * into v_invite from public.invites
   where code = _code and used_at is null and (expires_at is null or expires_at > now())
   for update;
  if not found then raise exception 'invalid or expired code'; end if;
  update public.profiles set school_id = v_invite.school_id where id = v_uid;
  update public.user_roles set role = 'parent' where user_id = v_uid;
  if not found then insert into public.user_roles (user_id, role) values (v_uid, 'parent'); end if;
  foreach v_sid in array v_invite.student_ids loop
    insert into public.parent_students (parent_user_id, student_id) values (v_uid, v_sid) on conflict do nothing;
  end loop;
  update public.invites set used_at = now() where id = v_invite.id;
  return jsonb_build_object('ok', true, 'school_id', v_invite.school_id);
end;
$function$;

-- 5. Access rules present in production ------------------------------------
do $$
declare p record;
begin
  for p in
    select * from (values
      ('schools', 'super admin all schools', 'all', $q$public.has_role(auth.uid(),'admin'::app_role)$q$, $q$public.has_role(auth.uid(),'admin'::app_role)$q$),
      ('schools', 'school admin sees own school', 'select', $q$public.is_school_admin_of(id)$q$, null),
      ('schools', 'member sees own school', 'select', $q$(public.school_of_user(auth.uid()) = id)$q$, null),
      ('routes', 'school admin all routes in school', 'all', $q$public.is_school_admin_of(school_id)$q$, $q$public.is_school_admin_of(school_id)$q$),
      ('stops', 'school admin all stops in school', 'all', $q$public.is_school_admin_of(school_id)$q$, $q$public.is_school_admin_of(school_id)$q$),
      ('buses', 'school admin all buses in school', 'all', $q$public.is_school_admin_of(school_id)$q$, $q$public.is_school_admin_of(school_id)$q$),
      ('buses', 'driver sees own bus', 'select', $q$(driver_user_id = auth.uid())$q$, null),
      ('students', 'school admin all students in school', 'all', $q$public.is_school_admin_of(school_id)$q$, $q$public.is_school_admin_of(school_id)$q$),
      ('parent_students', 'super admin all parent_students', 'all', $q$public.has_role(auth.uid(),'admin'::app_role)$q$, $q$public.has_role(auth.uid(),'admin'::app_role)$q$),
      ('parent_students', 'school admin sees parent_students in school', 'select', $q$exists (select 1 from public.students s where s.id = parent_students.student_id and public.is_school_admin_of(s.school_id))$q$, null),
      ('invites', 'super admin all invites', 'all', $q$public.has_role(auth.uid(),'admin'::app_role)$q$, $q$public.has_role(auth.uid(),'admin'::app_role)$q$),
      ('invites', 'school admin all invites in school', 'all', $q$public.is_school_admin_of(school_id)$q$, $q$public.is_school_admin_of(school_id)$q$),
      ('geofence_events', 'super admin all events', 'all', $q$public.has_role(auth.uid(),'admin'::app_role)$q$, $q$public.has_role(auth.uid(),'admin'::app_role)$q$),
      ('geofence_events', 'school admin sees events', 'select', $q$exists (select 1 from public.buses b where b.id = geofence_events.bus_id and public.is_school_admin_of(b.school_id))$q$, null),
      ('geofence_events', 'driver sees events for own bus', 'select', $q$exists (select 1 from public.buses b where b.id = geofence_events.bus_id and b.driver_user_id = auth.uid())$q$, null),
      ('device_status', 'school admin sees drivers device_status', 'select', $q$public.is_school_admin_of(public.school_of_user(user_id))$q$, null),
      ('location_history', 'parent sees bus location_history', 'select', $q$exists (select 1 from public.buses b where b.driver_user_id = location_history.user_id and public.is_parent_of_bus(b.id))$q$, null),
      ('trip_sessions', 'view own sessions or admin', 'select', $q$((auth.uid() = user_id) or public.has_role(auth.uid(),'admin'::app_role))$q$, null),
      ('trip_sessions', 'parent sees bus trip_sessions', 'select', $q$exists (select 1 from public.buses b where b.driver_user_id = trip_sessions.user_id and public.is_parent_of_bus(b.id))$q$, null),
      ('profiles', 'parent sees own child bus driver profile', 'select', $q$exists (select 1 from public.buses b where b.driver_user_id = profiles.id and public.is_parent_of_bus(b.id))$q$, null),
      ('profiles', 'school admin sees profiles in school', 'select', $q$public.is_school_admin_of(school_id)$q$, null),
      ('geofences', 'any authenticated can view geofences', 'select', 'true', null),
      ('geofences', 'admin delete geofences', 'delete', $q$public.has_role(auth.uid(),'admin'::app_role)$q$, null),
      ('geofences', 'admin update geofences', 'update', $q$public.has_role(auth.uid(),'admin'::app_role)$q$, null)
    ) as t(tbl, name, cmd, using_expr, check_expr)
  loop
    begin
      execute format('create policy %I on public.%I for %s to authenticated using (%s)%s',
        p.name, p.tbl, p.cmd, p.using_expr,
        case when p.check_expr is not null then format(' with check (%s)', p.check_expr) else '' end);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- INSERT-only rules (WITH CHECK, no USING).
do $$ begin
  create policy "insert own sessions" on public.trip_sessions for insert to authenticated with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "update own sessions" on public.trip_sessions for update to authenticated using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "admin insert geofences" on public.geofences for insert to authenticated
    with check (public.has_role(auth.uid(),'admin'::app_role));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "driver inserts events for own bus" on public.geofence_events for insert to authenticated
    with check (exists (select 1 from public.buses b where b.id = geofence_events.bus_id and b.driver_user_id = auth.uid()));
exception when duplicate_object then null; end $$;

-- 6. Live updates the app subscribes to ------------------------------------
do $$
declare t text;
begin
  foreach t in array array['device_status'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null; when others then null;
    end;
  end loop;
end $$;
