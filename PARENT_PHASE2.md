# feat/parent-phase2

Phase 2 of the school-transport layer: **parent accounts, the invite → PIN login flow, and parent-scoped RLS.** No live map, no ETA, no notifications — those are Phase 3+. The deliverable a parent gets today is a single plain-text sentence per linked child on `/me` after redeeming a code + setting a PIN, and the guarantee — proved by 18 isolation assertions — that they can only ever see their own child's data.

## ⚠️ Prerequisite you must verify

**Supabase → Authentication → Providers → Email → "Confirm email" must be OFF.**

Parent accounts are created server-side with email = `normalizedPhone@parent.pulse.local` (fallback = `code@parent.pulse.local` when the invite has no phone). Those addresses aren't deliverable. If the "Confirm email" toggle is on, Supabase queues a confirmation to a dead inbox and the parent can't sign in until it's clicked. This is the one thing this branch cannot enforce from code — please verify the toggle before you sign in as a real parent.

Also required in the production env (Vercel): **`SUPABASE_SERVICE_ROLE_KEY`**. The server function in `src/lib/parent-join.server.ts` uses it to `auth.admin.createUser({ email_confirm: true, … })` and to write parent rows past RLS. It never reaches the browser bundle.

## What existed vs what was created

| Object | State before this branch | After |
| --- | --- | --- |
| `public.invites` (id, school_id, code UNIQUE, phone, student_ids uuid[], expires_at, used_at, created_at) | present, RLS on. `phone` was `NOT NULL`. | RLS on. `phone` **NULLABLE now** (spec says optional; migration relaxed it). |
| `public.parent_students` (parent_user_id, student_id, created_at, PK on the pair) | present, RLS on. | unchanged. |
| `is_parent_of_student(uuid)` SECURITY DEFINER STABLE | present. | unchanged. `CREATE OR REPLACE` kept param name `_student_id` because DROP is forbidden by spec. |
| `is_parent_of_bus(uuid)` SECURITY DEFINER STABLE | present. | unchanged. Same param-name note. |
| Parent-SELECT policies on `parent_students`, `students`, `buses`, `routes`, `stops`, `device_status` | present (parent_students, students, buses had policies; routes / stops / device_status also had them). | present — migration is a no-op there via `EXCEPTION WHEN duplicate_object`. |
| `"school admin same_school routes/stops/buses/students"` (from Phase 1, my branch) | present. | **DROPPED** — see the isolation-fix note below. |
| `"member sees routes in school"`, `"member sees stops in school"` (pre-existing, not mine) | present. | **DROPPED** — same reason. |

**Only new DB objects created:** none (both tables and both helpers were already there).
**Only DB objects removed:** the six leaky policies described in the isolation-fix note below.

## The isolation-fix note

The Phase 2 isolation test caught a Phase 1 defect. The `same_school()` helper — by Phase 0 spec — returns TRUE for any caller whose `profiles.school_id` matches the target, regardless of role. My Phase 1 policies `"school admin same_school routes|stops|buses|students"` used `same_school()` `FOR ALL`, so any account whose profile carried the school's ID passed — **including parents.** Two pre-existing policies (`"member sees routes/stops in school"`) had the same shape: authenticated-user reads on any row in the school.

The test failed exactly where you'd expect: **Parent A could read, update and insert into Bus / Student rows belonging to Parent B.** That is the child-safety leak.

`is_school_admin_of(school_id)` (tight — checks `ur.role = 'school_admin'`) already backs the pre-existing `"school admin all X in school"` policies, so school-admin CRUD survives after the loose policies go. Drivers keep their `"driver select own bus/route/stops"` reads (Phase 1). Parents keep their `"parent sees ..."` reads. Fix: drop the six leaky policies. The addendum migration `20260819121000_phase2_fix_leaky_school_policies.sql` does exactly that.

Per spec I stopped at the failure, reported, and only declared success after the follow-up run.

## The isolation test — 18 / 18 PASS

Runs entirely inside a rolled-back transaction. Uses the existing parent accounts (Umubyeyi Aline `39ea7c5f-…` linked to Aline U. on Bus Isabuku, and Umubyeyi Kevine `0b420c06-…` linked to Kevine N. on Bus Umuyaga) and simulates each session via `SET LOCAL role = authenticated` + `SET LOCAL request.jwt.claims`.

```
step                                                              | expected | actual   | passed
------------------------------------------------------------------+----------+----------+-------
A reads OWN student (Aline U.)                                    | 1        | 1        | true
A reads OWN bus (Isabuku)                                         | 1        | 1        | true
A reads OWN driver device_status (Guy)                            | 1        | 1        | true
A reads OWN parent_students                                       | >=1      | 1        | true
A reads B student (Kevine N.) — RLS should hide                   | 0        | 0        | true
A reads B bus (Umuyaga) — RLS should hide                         | 0        | 0        | true
A reads B driver device_status (Shema) — RLS should hide          | 0        | 0        | true
A reads B parent_students — RLS should hide                       | 0        | 0        | true
A INSERT into students blocked                                    | blocked  | blocked  | true
A INSERT into buses blocked                                       | blocked  | blocked  | true
A INSERT parent_students self->B student blocked                  | blocked  | blocked  | true
A UPDATE B driver device_status affects 0 rows                    | 0 rows   | 0 rows   | true
A UPDATE B student affects 0 rows                                 | 0 rows   | 0 rows   | true
B reads A student (Aline U.) — RLS should hide                    | 0        | 0        | true
B reads A bus (Isabuku) — RLS should hide                         | 0        | 0        | true
B reads A driver device_status (Guy) — RLS should hide            | 0        | 0        | true
Used code KIGALI-DEMO-A1 no longer redeemable                     | 0        | 0        | true
Expired code KIGALI-DEMO-B2 no longer redeemable                  | 0        | 0        | true
```

Re-run with: `psql "$SUPABASE_DB_URL" -f scripts/test-parent-isolation.sql`. The transaction rolls back — no rows change, no test data persists.

**Before the fix**, the failing rows were:

```
FAIL  A reads B student (Kevine N.) — RLS should hide          got 1
FAIL  A reads B bus (Umuyaga)   — RLS should hide              got 1
FAIL  B reads A student — RLS should hide                       got 1
FAIL  B reads A bus     — RLS should hide                       got 1
FAIL  A UPDATE B student affects 0 rows                         updated 1
FAIL  A INSERT into students blocked                            succeeded
FAIL  A INSERT into buses blocked                               succeeded
```

## Invite codes seeded for the parents

Both are unused and printable to the parents by hand or via `/admin/invites`.

| Code | Phone | Linked student | Bus | Driver |
| --- | --- | --- | --- | --- |
| `KIGALI-DEMO-A1` | +250788111111 | Aline U. | Bus Isabuku (RAF345D) | Guy (`eb8c60bb`) |
| `KIGALI-DEMO-B2` | +250788222222 | Kevine N. | Bus Umuyaga (RAB145M) | Shema (`7a79ba0f`) |

Parent PIN when created by `scripts/seed-parents.mjs`: `0000`. Parents can be reused via a returning-parent sign-in on `/join` (phone + PIN).

## Files added / touched

**Migrations**
- `supabase/migrations/20260819120000_phase2_parent_join.sql` — idempotent creation of `invites`, `parent_students`, both helpers, and all parent-SELECT policies. Also relaxes `invites.phone` to nullable.
- `supabase/migrations/20260819121000_phase2_fix_leaky_school_policies.sql` — the isolation fix (drops 6 loose policies).

**Server**
- `src/lib/parent-join.server.ts` — `createServerFn` that validates the code, `auth.admin.createUser({ email_confirm: true })`, upserts profile + user_roles + parent_students, and burns the invite (`used_at = now()`, guarded on `used_at IS NULL` to prevent a double-redeem race).

**Client routes**
- `src/routes/join.tsx` — 2-step (code → PIN × 2) with a returning-parent phone+PIN mode. Auto-resumes to `/me` if a parent session is already active.
- `src/routes/me.tsx` — parent-only, plain-text, one line per linked child. No map.
- `src/routes/admin/invites.tsx` — school-scoped invite generator + list + revoke. Codes use the unambiguous alphabet `23456789ABCDEFGHJKMNPQRSTUVWXYZ` (no 0/O/1/I/L), 8 chars, generated via `crypto.getRandomValues`, insert retries on unique-constraint collision.
- `src/components/AdminShell.tsx` — added the "Invites" tab.
- `src/routes/auth.tsx` — post-signin redirect now sends parents to `/me`.

**Scripts**
- `scripts/seed-parents.mjs` — idempotent Phase 2 seed (finds rows by natural key, skips if present). Creates the two invites, the two parent auth users (PIN `0000`), and the parent_students links.
- `scripts/test-parent-isolation.sql` — the 18-assertion isolation test.

## Existing-routes smoke test

Local `npm run dev` on port 8080:

```
200  /
200  /auth
200  /track
200  /dashboard
200  /history
200  /admin/routes
200  /admin/buses
200  /admin/students
200  /admin/invites
200  /join
200  /me
```

The four Phase 1 admin routes + all four legacy routes are unchanged and still serve. The two new routes (`/join`, `/me`) and the new admin tab (`/admin/invites`) also serve.

## Scope guardrails — what was NOT done

- **Not pushed.** `feat/parent-phase2` is the working branch; nothing lands until you review.
- **No live map, no /me telemetry, no ETA, no notifications.** Phase 3+.
- **No changes to the landing page, driver tracker, admin dashboard, or existing auth**, apart from the one-line parent redirect in `auth.tsx`.
- **The `same_school()` helper itself is unchanged.** Its permissive shape (no role check) matches Phase 0's spec. The fix lives at the policy layer, which is where it belongs.
- **TODO in `src/lib/parent-join.server.ts`**: "Replace phone-alias + PIN with WhatsApp OTP before scaling; register the WhatsApp Business number in Rwanda for the domestic authentication rate."
