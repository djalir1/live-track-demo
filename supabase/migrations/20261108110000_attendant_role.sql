-- ────────────────────────────────────────────────────────────────────────────
-- School attendance (manual check-in), part 1 of 2: the bus attendant role.
-- ────────────────────────────────────────────────────────────────────────────
-- Kept in its own file because Postgres can't use a new enum value in the
-- same transaction that adds it. Idempotent.
-- ────────────────────────────────────────────────────────────────────────────
alter type public.app_role add value if not exists 'attendant';
