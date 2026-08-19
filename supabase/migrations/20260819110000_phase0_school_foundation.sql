-- ────────────────────────────────────────────────────────────────────────────
-- Parent-tracking Phase 0: tenant foundation.
-- ────────────────────────────────────────────────────────────────────────────
-- Idempotent: every statement can be re-run safely on a DB where it has
-- already been applied. Nothing is dropped or recreated.
-- ────────────────────────────────────────────────────────────────────────────

-- 1. app_role enum: ensure the two new values exist. On a DB that already has
-- them, this is a no-op.
alter type public.app_role add value if not exists 'parent';
alter type public.app_role add value if not exists 'school_admin';

-- 2. schools tenant table.
create table if not exists public.schools (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

alter table public.schools enable row level security;

-- 3. profiles.school_id — nullable so super-admin accounts (has_role admin)
-- can remain unassigned. FK guarded so we don't create it twice.
alter table public.profiles
  add column if not exists school_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_school_id_fkey'
  ) then
    alter table public.profiles
      add constraint profiles_school_id_fkey
      foreign key (school_id) references public.schools(id) on delete set null;
  end if;
end $$;

-- 4. same_school helper — true if caller is super-admin OR caller's profile
-- belongs to target_school. SECURITY DEFINER so the caller doesn't need
-- read access to profiles to evaluate it.
create or replace function public.same_school(target_school uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school uuid;
begin
  if public.has_role(auth.uid(), 'admin'::app_role) then
    return true;
  end if;
  select school_id into v_school from public.profiles where id = auth.uid();
  return v_school is not null and v_school = target_school;
end
$$;
