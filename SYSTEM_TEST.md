# SYSTEM_TEST

End-to-end verification of the integrated Pulse system (driver + admin + parent) against the live Supabase project (`livetrack`, ref `xtvomhbolgrzlkaocyju`).

## ⚠️ Scope of these tests

Everything below verifies **logic and RLS**. Automated checks run against the real DB (server-side triggers, RLS policies, pure-function math). They do NOT — and cannot — verify:

- **Real-world background GPS tracking on a phone.** Whether the driver's Android/iOS keeps `watchPosition` alive while the screen is locked, when the OEM battery-optimiser kills the tab, when the browser is backgrounded, or when the app is swiped away. That must be tested **on a real phone, on a real route, over hours**.
- **Real web-push delivery when the tab is closed.** The in-app banners and OS-level `Notification` when the tab is backgrounded work now; true page-closed push needs VAPID keys, a service worker and an edge-function sender, which are marked TODO in Phase 4 code.
- **CARTO tile availability** and **Nominatim rate limits** in production traffic.

## ⚠️ Integration note

`fix/core-bugs` (Kigali-gap distance/time fix, named-places PDF, 1 rps Nominatim, role-flash fix, offline-presence + admin-excluded dashboard) was on a parallel branch that had NOT been merged into the parent chain. On this `test/full-system` branch I merged `fix/core-bugs` into `feat/parent-phase4` (commit `67cacd7`) so the full system under test is actually the full system. Auto-merge on `dashboard.tsx` and `auth-context.tsx` succeeded cleanly.

**Before shipping, either merge `fix/core-bugs` into `master` first (then rebase the parent chain onto it), or merge all six branches together in a single reviewed integration.** Otherwise those regressions will land unfixed.

---

## The 10 checks

### 1. Admin/driver auth — no role-flash

**Verdict:** PASS (logic). Cannot prove "zero-frame flash" without pixel-accurate browser timing.

`AuthProvider` derives `loading = !initialised || (user != null && role == null)` — so no consumer sees `loading=false` before `role` resolves. `TrackPage` guards its render with `if (loading || !user || role !== "user") return <Loader/>`, so an admin never renders the driver UI. `/auth` post-signin redirect gates on `role !== null` first, so an admin lands on `/dashboard`, a school_admin on `/admin/routes`, a parent on `/me`, else `/track`.

Backing tests: 12 presence assertions in `scripts/test-parent-presence.ts` (Phase 3), 12 pure-logic assertions in `scripts/test-fixes.ts` (Fix 1 + Fix 4).

### 2. Driver tracking — start / stop write behaviour

**Verdict:** PASS (logic + trigger). Real-phone background behaviour NOT covered.

`useTracker.persist()` upserts `device_status` and inserts `location_history` on every `watchPosition` callback (~8 s) while `is_tracking=true`. `useTracker.stop()` writes `status='offline', is_tracking=false, last_seen=now()`. `signOut()` runs an `UPDATE device_status SET status='offline', is_tracking=false` for the current uid before `supabase.auth.signOut()` (fix/core-bugs).

Server-side proof: the AFTER-INSERT trigger `geofence_scan_on_location` fires on every `location_history` insert regardless of client — proved by the Check 9 e2e run below (5 inserts produced 5 events with no client involvement).

### 3. Dashboard presence — <30 s live, >90 s offline, admins excluded

**Verdict:** PASS.

`src/routes/dashboard.tsx:82` — `const fresh = Date.now() - new Date(s.last_seen).getTime() < 30_000;` and `status: fresh ? s.status : "offline"`. Admin/parent/school_admin filtered out: `dashboard.tsx:74` — `.filter((s) => driverIds.has(s.user_id))` where `driverIds` = uids with `user_roles.role='user'`.

`scripts/test-fixes.ts` Fix-4 block:

```
FIX 4 — presence is derived from last_seen freshness (<30s)
  fresh(5s)   stored=moving  -> moving
  stale(45s)  stored=moving  -> offline
  stale(120s) stored=stopped -> offline
  PASS  fresh driver keeps their stored status
  PASS  driver stale by 45s reads as offline
  PASS  driver stale by 2min reads as offline
```

### 4. Kigali → Kampala gap-day report — no fabricated distance/time

**Verdict:** PASS.

`scripts/test-fixes.ts` FIX 1 block, run on the seed's gap day:

```
FIX 1 — Kigali -> Kampala with a 15 h 16 m signal-lost gap
  totalDistanceKm      = 9.347 km
  totalMovingMinutes   = 32.0
  totalStoppedMinutes  = 4.0
  gaps                 = 1
    2026-06-15T06:26:00+00:00  ->  2026-06-15T21:42:00+00:00   (916 min, jump 373.1 km discarded)
  stops                = 1
  startedAt (approx=false) = 2026-06-15T05:58:00+00:00
  endedAt   (approx=false) = 2026-06-15T21:55:00+00:00
```

Before the fix, this day reported ~377 km / 15h26m driving. After: **9.347 km / 32 min driving**, one signal-lost segment (916 min, 373.1 km jump discarded), Started/Ended non-approx (from `trip_sessions`). PDF now uses named places (`reverseGeocodeAddress` composes road + suburb/neighbourhood + city_district) and the raw lat/lon table was removed.

### 5. Cross-school RLS — school A admin walled off from school B

**Verdict:** PASS.

Raw output from `scripts/test-cross-school-rls.sql` pattern re-run:

```
step                                      | expected | actual  | passed
------------------------------------------+----------+---------+-------
school_admin A INSERT into B blocked      | blocked  | blocked | true
school_admin A sees B school routes       | 0        | 0       | true
school_admin A sees own school routes     | >=1      | 1       | true
```

The Phase 2 addendum (dropped `"school admin same_school routes|stops|buses|students"` and `"member sees routes|stops in school"`) is still in effect — same_school() alone no longer grants CRUD; only `is_school_admin_of()` does.

### 6. Parent auth — invite code → PIN → session → /me; used and expired rejected

**Verdict:** PASS (logic). Full end-to-end sign-in requires a live browser + service-role key on the backend for `redeemJoinCode`.

Server function `src/lib/parent-join.server.ts` looks up the invite (service role, RLS bypassed), rejects `used_at != null` or `expires_at < now()`, creates the parent via `auth.admin.createUser({ email_confirm: true })` (so no confirmation email is sent — parent emails are `@parent.pulse.local`), inserts profile + role='parent' + parent_students, and burns the invite (`used_at=now()` guarded on `used_at IS NULL` — race-safe).

Raw SQL check on the same-day server-side redemption filter:

```
step                                            | expected | actual | passed
------------------------------------------------+----------+--------+-------
Used code KIGALI-DEMO-A1 no longer redeemable   | 0        | 0      | true
Expired code KIGALI-DEMO-B2 no longer redeemable| 0        | 0      | true
```

### 7. Parent isolation (CRITICAL) — zero-rows proof

**Verdict:** PASS. Raw:

```
step                                      | expected | actual | passed
------------------------------------------+----------+--------+-------
A reads OWN student (Aline U.)            | 1        | 1      | true
A reads OWN bus (Isabuku)                 | 1        | 1      | true
A reads OWN driver device_status (Guy)    | 1        | 1      | true
A reads B student (Kevine N.)             | 0        | 0      | true
A reads B bus (Umuyaga)                   | 0        | 0      | true
A reads B driver device_status (Shema)    | 0        | 0      | true
A reads B parent_students                 | 0        | 0      | true
```

Parent A's session simulated with `SET LOCAL role = authenticated; SET LOCAL request.jwt.claims = '{"sub":"<A-uid>","role":"authenticated"}'`. Every one of B's rows returns zero under RLS.

### 8. Parent live /me — realtime updates, offline detection, clean child switch

**Verdict:** PASS (logic + subscription hygiene). Real-network Realtime latency and Leaflet render need a browser to observe.

`/me` uses one Supabase channel per selected `driverUid`/`busId` with three `postgres_changes` streams (device_status, trip_sessions, geofence_events), all `filter=eq.<uid|busId>`. Cleanup removes the channel on unmount and re-runs the effect on child switch — no leaked subscriptions.

Presence rule (`src/lib/parent-presence.ts`): same 30 s / 90 s thresholds as the dashboard; a stale row is never presented as live.

Backing pure-function tests:

```
scripts/test-parent-presence.ts   12 passed, 0 failed
scripts/test-parent-trip.ts       27 passed, 0 failed
```

### 9. Geofence + ETA + notifications — server-side detection, isolation

**Verdict:** PASS.

**Detection runs server-side.** `AFTER INSERT ON location_history` fires `_geofence_scan()` (SECURITY DEFINER). The e2e SQL test inserts 5 location points from a plain psql session with no client attached — the trigger writes the events anyway:

```
step                                            | expected | actual | passed
------------------------------------------------+----------+--------+-------
A sees 5 events on Bus 1                        | 5        | 5      | true
A sees arrive(Kimironko) — pre-home             | 1        | 1      | true
A sees arrive(Nyarugenge) — HOME                | 1        | 1      | true
A sees depart(Nyarugenge) — Passed              | 1        | 1      | true
A sees Bus 2 events (RLS hide)                  | 0        | 0      | true
B sees Bus 1 events (RLS hide)                  | 0        | 0      | true
```

Ordered event log the trigger produced during that run:

```
arrive  Kimironko    → bannerForEvent = "approach" (Kimironko is pre-home in the test)
depart  Kimironko    → null (departs never notify)
arrive  Nyarugenge   → "arrived at your stop" (Nyarugenge is home in the test)
depart  Nyarugenge   → null; computeEta returns "passed" from here on
arrive  School       → null (neither home nor pre-home)
```

`computeEta` never goes negative — `depart(home)` seen → returns `passed` regardless of position. Dedupe: the trigger won't insert the same `(bus, stop, type)` within 60 s. In-app banner logic is pure-function and tested (`bannerForEvent`): `arrive(home)` → arrived, `arrive(pre-home)` → approach, everything else → null. Home = null ⇒ never any notification (fixed).

**Parent A never notified about Parent B's bus.** Three linkage guards stacked:
- Broker-side filter `bus_id=eq.<childBusId>` on the postgres_changes subscription.
- RLS on `geofence_events`: `is_parent_of_bus(bus_id)`.
- Client re-check: `stop_id ∈ child's stops` before firing the banner.

Row 5 (Parent A sees zero for Bus 2) and row 6 (Parent B sees zero for Bus 1) prove RLS holds.

Web-push toggle persists to `parent_notification_prefs` with self-only RLS. OS notifications via the Notification API work when the tab is backgrounded. **True page-closed web push is TODO** — see `TODO(phase-5, push)` in `src/routes/me.tsx`.

### 10. Regression — all existing routes still 200

**Verdict:** PASS. Local dev server on port 8083:

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

---

## Aggregate test totals

| Suite | Passed | Failed |
| --- | --- | --- |
| `scripts/test-fixes.ts` (Fix 1 + Fix 4) | 12 | 0 |
| `scripts/test-parent-presence.ts` (Phase 3) | 12 | 0 |
| `scripts/test-parent-trip.ts` (Phase 4) | 27 | 0 |
| Parent isolation SQL (Check 7) | 7 | 0 |
| Cross-school RLS SQL (Check 5) | 3 | 0 |
| Used/expired codes SQL (Check 6) | 2 | 0 |
| Geofence + isolation e2e SQL (Check 9) | 6 | 0 |
| **Total** | **69** | **0** |

## Things NOT working / caveats to fix before pilot

- **`fix/core-bugs` is on its own branch.** For production it must be merged into the parent chain (either merged into `master` first, then the parent chain rebased, or merged all together in one integration commit). This test branch has already merged them so the results above stand; but the parent branches shipped alone would ship without the fixes.
- **True web push (page closed).** Toggle + storage + linkage-guarded server hook seam are in place; the actual VAPID + service-worker + edge function sender is TODO in `src/routes/me.tsx`.
- **WhatsApp OTP for parent auth** deferred — invite-code + PIN stays for the pilot.
- **Real-device background tracking** requires physical-phone QA on a real route. Not verifiable here.
- **Supabase "Confirm email" toggle** must be OFF in the Auth → Providers → Email settings so `@parent.pulse.local` addresses aren't emailed. Also `SUPABASE_SERVICE_ROLE_KEY` must be present in Vercel env for `redeemJoinCode` to run.

## What automated tests can vs. can't tell you

**Can tell you:**
- RLS holds for every table and every parent-vs-parent / admin-vs-admin pair we tested.
- The server-side geofence trigger fires the right events in the right order for a real driver's location inserts.
- Pure-function math (presence, gap detection, projection, ETA, banner mapping) is correct across every boundary condition we asserted.
- SSR renders every route (200) on `npm run dev`.

**Can't tell you:**
- Whether a real driver phone will keep uploading with the screen off, the browser backgrounded, or the OEM battery optimiser active. **This must be validated on a real phone on a real route.**
- Whether Realtime latency is acceptable for parents in Kigali under 3G/4G reality.
- Whether Leaflet + CARTO Voyager renders correctly on every parent's device.
- Whether the browser Notification API + service worker will deliver on the parents' actual devices (Android WebView vs. Chrome vs. Safari differ).
