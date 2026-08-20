# feat/parent-phase4

Phase 4 (final for the parent flow): **geofence arrive/depart detection, ETA to the child's home stop, and parent notifications.** Built strictly on the existing schema + RLS — no policy weakening, no changes to `/auth`, `/track`, `/dashboard`, `/history`, `/join`, or Phase 1 admin screens.

## Step 0 gate — isolation still holds (6 / 6)

Re-ran the Phase 2/3 test as Parent A before touching anything:

```
A reads OWN student                                  1  1  true
A reads OWN bus                                      1  1  true
A reads OWN driver device_status                     1  1  true
A reads B student (RLS should hide)                  0  0  true
A reads B bus (RLS should hide)                      0  0  true
A reads B driver device_status (RLS should hide)     0  0  true
```

Recorded as commit `0126188` on the branch.

## Where geofence detection runs (Step 1)

**Server-side, DB trigger. Not the parent's browser.**

- Trigger: `geofence_scan_on_location AFTER INSERT ON public.location_history FOR EACH ROW`.
- Function: `public._geofence_scan()` (`plpgsql`, `SECURITY DEFINER`, `search_path=public`).
- Every driver GPS point that `useTracker.persist()` inserts (roughly every 8 s while tracking) triggers a scan. Detection is 100 % independent of whether any parent has `/me` open.
- The function:
  1. Looks up the driver's bus and its route (`buses.driver_user_id = NEW.user_id`).
  2. Finds the nearest stop on that route within its own `radius_m` via a metres-scale haversine (`public._haversine_m`).
  3. Compares the newly-inside stop to `public.bus_current_stop.stop_id` (a tiny internal state table, RLS on with no policies → no client can read/write it).
  4. Emits transitions:
     - `null → X`  ⇒ `arrive(X)`
     - `X → null`  ⇒ `depart(X)`
     - `X → Y`     ⇒ `depart(X)` + `arrive(Y)`
     - `X → X`     ⇒ no-op
  5. **Dedupe guard:** even on retry it won't insert the same `(bus, stop, type)` within 60 s.
- Supabase Realtime publication now includes `geofence_events`, so `/me` can subscribe live.
- Index `geofence_events(bus_id, occurred_at desc)` keeps the dedupe check cheap.

Rejected alternatives:
- **Client-side detection on /me.** Rejected — spec forbids it, and it would silently fail when nobody is watching.
- **Supabase Edge Function invoked from application code.** Same failure mode as above (would rely on a client to push events); a DB trigger is the strictly-server-side option that always fires.

## Files added / touched

**Migration**
- `supabase/migrations/20260819130000_phase4_geofence_and_prefs.sql` — idempotent: adds `created_at` to `geofence_events`, verifies parent SELECT policy, creates `bus_current_stop` (deny-all RLS), the `_haversine_m` + `_geofence_scan` functions and the trigger, indexes, publishes `geofence_events` to `supabase_realtime`, and creates `parent_notification_prefs` with a self-only RLS policy.

**Client (`/me`)**
- `src/lib/parent-trip.ts` — pure math: `haversineM`, `projectOnRoute`, `remainingMetresToStop`, `rollingSpeedKmh` (last 5 min window), `computeEta`, `stopStatuses`, `preHomeStopId`, `bannerForEvent`.
- `src/routes/me.tsx` — fetches geofence_events for the open session + last 5 min of history, subscribes to `geofence_events` realtime filtered `bus_id=eq.<childBusId>`, renders the trip-progress chip row, ETA line inside the status banner, and the arrival banner. Adds a `Notify me` toggle in the header persisting to `parent_notification_prefs`. Reacted-events set prevents duplicate banners across re-subscribe.
- `src/components/ParentMap.tsx` — new `doneStopIds` prop; passed stops fade to grey (home/school stay emphasised).

**Tests**
- `scripts/test-parent-trip.ts` — 27 pure-function assertions (projection, remaining distance, rolling speed, ETA states, stop statuses, pre-home, `bannerForEvent`, ordered stops).
- `scripts/test-parent-run-e2e.sql` — end-to-end run of Bus 1 across the whole Route A, inside a rolled-back transaction, asserting under Parent A's session and Parent B's session.

## ETA — how it's computed (Step 3)

Pure function `computeEta`:

1. If a `depart(homeStop)` event exists in the current open session → return `passed`. Never a negative ETA.
2. Otherwise project the bus's current point onto the polyline formed by the route's ordered stops (`projectOnRoute` — local flat-earth metres at each segment's midpoint; accurate well under 1 % at Rwanda distances).
3. Sum haversine segment lengths from the projection point through intermediate stops up to the home stop → `remainingMetresToStop`. If the projection is already past home ⇒ if we've seen `arrive(home)` return `arriving`, else `unknown`.
4. Speed = `rollingSpeedKmh(last 5 min of location_history)`. If too few points or elapsed < 5 s → falls back to the reported `speed_kmh`, then to a **fixed 20 km/h** (`FALLBACK_SPEED_KMH`).
5. `minutes = remainingM / 1000 / speed * 60`. Under 2 min → `arriving`. Otherwise `eta`, `approximate: true`.
6. ETA is hidden when the presence banner is `offline` or `no-trip` — the Phase 3 offline copy stays authoritative.

`bannerForEvent(event, homeStopId, preHomeStopId)`:

- `arrive` at `homeStopId` → `arrived`
- `arrive` at the stop with `sequence = home.sequence - 1` → `approach`
- everything else, including all `depart` events → `null`
- `homeStopId == null` → always `null` (no home ⇒ no notifications)

## Notifications (Step 4) — how per-parent linkage is enforced

**In-app** (fully working now):
- Realtime `postgres_changes` subscription on `public.geofence_events` with `filter: bus_id=eq.<childBusId>` — the parent's client only ever asks for their own child's bus. Broker-side filter.
- On top of that, **RLS on `geofence_events`** already gates SELECT with `is_parent_of_bus(bus_id)`. Realtime respects RLS, so even if the filter were wrong, the parent could not receive a row for a bus they don't own.
- On top of that again, **before rendering** any banner we check the event's `stop_id` is one of the current child's route stops (a stop_id from another child's route is dropped). Defence in depth.

**Web push toggle** (toggle + prefs live; browser-side Notification API works when the tab is backgrounded):
- `parent_notification_prefs (parent_user_id PK, notify_enabled boolean, push_subscription jsonb)`, RLS `parent_user_id = auth.uid()` for `FOR ALL`.
- Enable in header requests browser permission and upserts the row. The client fires a browser `new Notification(...)` on the approach + arrived events when `notify_enabled` is true and permission is granted. This delivers OS-level notifications when the tab is backgrounded (page open, focus elsewhere).
- **TODO (Phase 5, push):** real web push (delivery with page closed) needs (a) VAPID keys in Vercel env, (b) a service worker registration to obtain a `PushSubscription`, (c) storing that subscription in `parent_notification_prefs.push_subscription`, (d) a server-side hook (Postgres NOTIFY → edge function, or a trigger on `geofence_events` calling an edge function via `net.http_post`) that reads events and calls `web-push`. **Linkage guard for that path**: the edge function must only send to `parent_user_ids` whose `parent_students.students.bus_id == geofence_events.bus_id` — same isolation as RLS. The seam is marked with a `TODO(phase-5, push)` comment in `src/routes/me.tsx`.
- **TODO:** WhatsApp channel later (register Rwanda WhatsApp Business number, domestic authentication/utility rate).

## Test outputs

### `scripts/test-parent-trip.ts` — 27 / 27 pass

```
haversineM
  PASS  Kimironko → Nyarugenge distance is 7-8 km
projectOnRoute
  PASS  bus at Kimironko → seg 0, fraction 0, cumM ≈ 0
  PASS  bus at School → seg 1, fraction ≈ 1
remainingMetresToStop
  PASS  Kimironko → School has ~11 km remaining
  PASS  Nyarugenge → School has ~3-4 km remaining
  PASS  At School, remaining to Kimironko is null (already passed)
rollingSpeedKmh
  PASS  ~1 km per 60s → ~60 km/h
  PASS  empty → null
  PASS  one point → null
computeEta
  PASS  Nyarugenge → School @ 30 km/h → eta ≈ 6-10 min
  PASS  stopped speed 0.2 → fallback 20 km/h → eta > 4 min
  PASS  bus very close at 60 km/h → arriving
  PASS  depart(home) seen → passed
  PASS  no bus → unknown
stopStatuses
  PASS  Kimironko → done
  PASS  Nyarugenge → current
  PASS  School → pending
preHomeStopId
  PASS  home = School → pre = Nyarugenge
  PASS  home = Kimironko (first) → null
  PASS  home = unknown id → null
bannerForEvent
  PASS  arrive(home)  → arrived
  PASS  arrive(pre)   → approach
  PASS  depart(home)  → null
  PASS  arrive(other) → null
  PASS  home=null → null
  PASS  no pre-home  → still arrived at home
orderedStops
  PASS  sorts by sequence asc

27 passed, 0 failed
```

### `scripts/test-parent-run-e2e.sql` — 6 / 6 pass, real trigger, real events

Five points along Route A (Kimironko → outside → Nyarugenge → outside → School). Aline U.'s home is temporarily set to Nyarugenge inside the txn so pre-home = Kimironko is exercised. The trigger writes 5 events; then we read under each parent's session.

```
step                                                  | expected | actual | passed
------------------------------------------------------+----------+--------+-------
A sees 5 events on Bus 1                              | 5        | 5      | true
A sees arrive(Kimironko) — pre-home                   | 1        | 1      | true
A sees arrive(Nyarugenge) — HOME                      | 1        | 1      | true
A sees depart(Nyarugenge) — Passed                    | 1        | 1      | true
A sees Bus 2 events (RLS should hide)                 | 0        | 0      | true
B sees Bus 1 events (RLS should hide)                 | 0        | 0      | true
```

Event log for the same run (produced server-side by the trigger, then RLS-scoped read as Parent A):

```
arrive  Kimironko    06:36:42
depart  Kimironko    06:39:42
arrive  Nyarugenge   06:44:42     ← "Approaching" fires? Actually this IS home in the test. See note.
depart  Nyarugenge   06:47:42     ← "Passed your stop" from here on
arrive  School       06:51:42
```

Read together with the `bannerForEvent` tests:
- `arrive(Kimironko)` → `bannerForEvent` returns **approach** (Kimironko is the pre-home).
- `arrive(Nyarugenge)` → **arrived** (Nyarugenge is home in the test).
- `depart(Nyarugenge)` → **null** (departs never notify), but `computeEta` now returns **passed** and the ETA line becomes "Passed your stop".
- `arrive(School)` → **null** (not home, not pre-home).

The Aline home change is wrapped in the transaction and rolls back — Aline's real `home_stop_id` (Kimironko) is preserved.

### Detection with the parent page CLOSED — proved

The trigger runs on `INSERT INTO location_history` **in the DB**, from the driver's tracker. No client session is involved. The e2e SQL test above performs its `INSERT`s under a plain psql (or MCP) session while no parent client is subscribed, and the events still land — that IS the proof detection is independent of `/me` being open. Parent A's Realtime subscription would only be needed to see them *live*; the events themselves already exist and are readable next time the page loads.

### Existing routes untouched — smoke test

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

All 11 routes serve. No route added, none removed.

## Scope guardrails — what was NOT done

- **Not pushed.** Branch `feat/parent-phase4` sits on top of `feat/parent-phase3`. Nothing lands without your review.
- **No RLS weakened.** Phase 2's isolation-fix policies are unchanged.
- **No changes to offline/stale thresholds** — 30 s live, 90 s offline, same as Phase 3.
- **No changes to landing page, driver tracker, admin dashboard, /history, /join, /admin/*, or /auth.**
- **True web push delivery when the page is closed is TODO** — the toggle, permission request, prefs storage, and the linkage-guarded server hook seam are all in place with clear `TODO(phase-5, push)` markers.
- **No WhatsApp channel** — TODO in code for later (register Rwanda WhatsApp Business number).
