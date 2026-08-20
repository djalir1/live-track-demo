# fix/core-bugs

Scoped work on the `fix/core-bugs` branch. Four bugs, one branch, one commit per fix, no unrelated refactoring, no new features, no route or landing-page changes.

## What the DB looked like before

Nothing had to be created. Every core object the spec named was already present in the connected Supabase project `livetrack` (`xtvomhbolgrzlkaocyju`):

| Object | State |
| --- | --- |
| `public.profiles` | present, RLS on, 6 rows |
| `public.user_roles` (enum `app_role` = admin \| user \| parent \| school_admin) | present, RLS on, 6 rows |
| `public.device_status` (enum `tracking_status`) | present, RLS on, 3 rows |
| `public.location_history` | present, RLS on, 262 rows |
| `public.trip_sessions` | present, RLS on, 5 rows |
| `has_role(uuid, app_role) → boolean` | present, `SECURITY DEFINER` |

Extra tables from the school/bus/parent subsystem (`schools`, `routes`, `stops`, `buses`, `students`, `parent_students`, `invites`, `geofences`, `geofence_events`) also exist. They are out of scope for this branch and were not touched.

Policies on the five core tables already gate admin reads on `has_role(auth.uid(),'admin'::app_role)` and self-writes on `auth.uid()=user_id`. No policy changes were needed.

**No migration was applied.** The spec's "add ONLY what's missing" clause fired as a no-op.

## What changed, per fix

### FIX 1 — GPS-gap distance & driving-time fabrication
Commit `4657940`

`src/lib/trip.ts` now treats any pair of consecutive points whose interval exceeds 180 s OR whose implied speed exceeds 150 km/h as **signal-lost**. Those pairs contribute 0 to distance, 0 to driving time, and 0 to stopped time; they are recorded as `SignalGap { from, to, durationMinutes, jumpedKm }`. Within-segment time is bucketed strictly by per-pair speed: `>0.8 km/h` counts as driving, otherwise stopped. Distance still passes through the existing 15 m GPS-noise filter. Trip Started/Ended come from `trip_sessions` when a session overlaps the day; otherwise fall back to first/last GPS fix and flag `startedAtApprox` / `endedAtApprox`.

`src/routes/history.tsx` fetches trip_sessions in parallel with location_history, passes them to `buildTripSummary`, and renders a red "Signal lost" panel listing each gap segment.

`src/lib/pdf.ts` uses `trip.startedAt/endedAt` (labelled `(approx)` where applicable) and adds a Signal Lost table between the summary and the stops list.

### FIX 2 — Raw lat/lon in the report
Commit `a47ff66`

`src/lib/geocode.ts` now serializes every network call through a global 1-request/second queue (Nominatim usage policy). Cache stores both the composed label and parsed `AddressParts` (`road / suburb / neighbourhood / city_district / city / county / country`), so a caller that only wants the district doesn't re-fetch. Label composition is `road, suburb|neighbourhood, city_district|county`.

`src/lib/trip.ts` gains `selectWaypoints(points, opts)`: emits one waypoint whenever the last emitted was at least 2 km away, or ≥5 min earlier, or heading turned ≥45°. Hard-capped at 30 waypoints. Skips pairs across signal-lost boundaries.

`src/lib/pdf.ts` **removes the raw Latitude/Longitude points table entirely**. The report now reads as a narrative: header carries `city · district`; the Route section is a `Start → waypoint 1..N → End` table with named places; Stops table still there, named place per stop. Names carry an OpenStreetMap credit line ("formal road codes may appear").

Honest constraint: OSM's Nominatim returns official road codes (e.g. `KG 11 Ave`) rather than colloquial names (`Remera Gisimenti`). We report whatever Nominatim returns and never fabricate.

### FIX 3 — Role flash between /track and /dashboard
Commit `3b43179`

`src/lib/auth-context.tsx` used to flip `loading=false` on `INITIAL_SESSION` before the role fetch resolved, so `(loading=false, role=null)` was briefly observable. `AuthProvider` now derives `loading = !initialised || (user != null && role == null)`. Role is wiped only when the user identity actually changes (token refresh keeps it). `signOut` clears the id ref too.

`src/routes/track.tsx` now guards its render with `if (loading || !user || role !== "user") return <Loader/>`. An admin never sees the driver UI, not even for one frame. Dashboard and history already had the symmetric gate on `role !== "admin"` and get the same benefit for free from the new `loading` semantics. `auth.tsx`'s post-signin redirect (`role === "admin" ? "/dashboard" : "/track"`) is also fixed by the same change: it waits until role is known before navigating.

### FIX 4 — Stale drivers shown as "online"; admins in the live list
Commit `590940c`

`src/routes/dashboard.tsx` fetches `user_roles.select('user_id').eq('role','user')` alongside `device_status` and `profiles`, and filters device_status rows to that driver set. Admin, parent, school_admin accounts never appear in the live list. Presence is now derived strictly from freshness: `fresh = last_seen < 30s`; if not fresh, `status = 'offline'`, regardless of the stored value.

`src/lib/auth-context.tsx` `signOut` now writes `UPDATE device_status SET status='offline', is_tracking=false, last_seen=now() WHERE user_id=<current>` before calling `supabase.auth.signOut()`. UPDATE (not upsert) so admin accounts without a device_status row stay clean. The driver Stop button already did the offline write in `useTracker.stop()`, so between the two paths a stopped or signed-out driver flips to offline immediately.

## Proof

`scripts/seed-demo.mjs` creates 1 admin + 2 drivers (idempotent — reuses accounts that already exist by email) and inserts the Kigali → Kampala day for driver 1 (14 morning points around Kigali, 6 evening points in Kampala, one full-day trip_session, deliberate 15 h 16 m silent gap between them).

Run it with:

```bash
SUPABASE_URL="https://xtvomhbolgrzlkaocyju.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="<service role key>" \
node scripts/seed-demo.mjs
```

Credentials printed on success (safe to publish here — these are demo-only local accounts):

| Role | Email | Password |
| --- | --- | --- |
| admin | `demo-admin@pulse.local` | `PulseDemo!Admin1` |
| driver | `demo-driver1@pulse.local` | `PulseDemo!Driver1` |
| driver | `demo-driver2@pulse.local` | `PulseDemo!Driver2` |

The same Kigali → Kampala day was **also inserted directly for existing driver "Guy"** (`elogechris4@gmail.com`, uid `eb8c60bb-…`) on `2026-06-15` via a one-off SQL insert. Signing in as any admin, opening `/history`, picking "Guy", choosing 2026-06-15 exercises both fixes in the real UI without needing to run the seed script first. 20 points + 1 session were inserted; nothing existing was modified.

### Pure-logic test results

Run with `npx tsx scripts/test-fixes.ts`:

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
  PASS  distance < 30 km (the 370 km gap jump was discarded)
  PASS  driving < 60 min (not the ~15h wall clock of the gap)
  PASS  exactly one signal-lost gap recorded
  PASS  that gap is >= 15 hours
  PASS  the discarded jump is >= 300 km
  PASS  startedAt from trip_session (not approx)
  PASS  endedAt   from trip_session (not approx)
  PASS  no session -> startedAt is first fix, labelled approx
  PASS  no session -> endedAt   is last fix, labelled approx

FIX 4 — presence is derived from last_seen freshness (<30s)
  fresh(5s)   stored=moving  -> moving
  stale(45s)  stored=moving  -> offline
  stale(120s) stored=stopped -> offline
  PASS  fresh driver keeps their stored status
  PASS  driver stale by 45s reads as offline
  PASS  driver stale by 2min reads as offline

12 passed, 0 failed
```

### Route smoke test

Dev server (`npm run dev`, port 8081 — 8080 is taken on this machine):

```
200  /
200  /auth
200  /track
200  /dashboard
200  /history
```

All four SSR routes render. No startup errors, HMR clean across every touched file.

## What was NOT done, and why

- **Not pushed.** As instructed. Branch `fix/core-bugs` is the working branch; `master` still points at the untouched baseline commit `3a0de44`.
- **No new features, no route additions, no landing-page edits.** Every edit lives inside the four fixes and their acceptance criteria.
- **No parent-tracking work.** The `parent` / `school_admin` roles and `buses` / `students` tables were not touched; their policies still reference `has_role`, `is_parent_of_bus`, `is_school_admin_of`, and `school_of_user` as before.
- **`.env` still holds real Supabase creds and is git-ignored;** `.env.example` continues to document the shape.
