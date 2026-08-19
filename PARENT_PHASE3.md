# feat/parent-phase3

Phase 3 of the school-transport layer: **the real live parent screen at `/me`.** Everything is still built strictly on the data model + RLS from Phases 1–2 — no ETA math, no arrive/depart events, no notifications. Those are Phase 4.

## Step 0 — isolation re-verified before we built anything

The exact same isolation check that closed Phase 2, re-run as Parent A:

```
step                                                     | expected | actual | passed
---------------------------------------------------------+----------+--------+-------
A reads OWN student (Aline U.)                           | 1        | 1      | true
A reads OWN bus (Isabuku)                                | 1        | 1      | true
A reads OWN driver device_status (Guy)                   | 1        | 1      | true
A reads B student (Kevine N.) — RLS should hide          | 0        | 0      | true
A reads B bus (Umuyaga) — RLS should hide                | 0        | 0      | true
A reads B driver device_status (Shema) — RLS should hide | 0        | 0      | true
```

**6 / 6 pass.** The wall Phase 2 fixed still holds. Committed as the first commit on the branch (empty commit) so the gate is on record before any UI change.

## What /me now does

`role='parent'` only; a non-parent hitting the URL is redirected to `/track`. Mobile-first, plain, big touch targets, minimal chrome. It answers one question: *where is my child's bus right now.*

Top to bottom:

1. **Child chips** — only rendered if the parent has more than one linked child. Switching child re-subscribes realtime and re-fetches for the new bus (see below); the previous subscription is torn down.
2. **Big status banner**, colour-coded, derived strictly from live signals via a pure function `derivePresence` in `src/lib/parent-presence.ts`:
   - `Bus is moving` — device_status fresh (<30 s) AND `speed_kmh > 0.8`.
   - `Bus is stopped` — fresh (<30 s) AND speed ≤ 0.8.
   - `Bus is offline` — stale (>90 s), or 30–90 s where the stored status is neither moving nor stopped.
   - `No trip yet today` — the driver has no open `trip_sessions` row.
   - In the 30–90 s middle band, a stored `moving`/`stopped` is trusted only if `speed_kmh` still supports it; anything else is called offline. This is the "never a frozen 'live' marker" guard.
   - No ETA/arrival text.
3. **Live map** (`src/components/ParentMap.tsx`, lazy-loaded, reuses the same CARTO Voyager tile config the admin map uses):
   - The bus as a coloured vehicle marker (moving = green, stopped = blue, offline = grey). "Live" pulse ring only while the banner says moving or stopped.
   - Route polyline through the bus's route stops, ordered by `sequence`.
   - Every named stop labelled by name + sequence number; the **home stop is emphasised** (larger, purple); the **school stop** is emphasised (larger, green).
   - Camera fits the route + bus on first mount, then gently pans (no zoom hop) to keep the bus in view.
4. **Trust row**: plate + label, driver name, `updated Ns ago` (a 5 s ticker keeps it honest).
5. **Offline copy is calm**, not an error: "Bus is offline. Last seen at HH:MM near <place>. We'll show it again as soon as it reports in." The `near <place>` label comes from the existing 1 rps cached Nominatim helper — never raw lat/lon in the UI.

## Live wiring (Step 2) — one channel per selected child

`useEffect` keyed on `driverUid`:

```
supabase
  .channel(`parent-me:${driverUid}`)
  .on("postgres_changes", { table: "device_status", filter: `user_id=eq.${driverUid}` }, …)
  .on("postgres_changes", { table: "trip_sessions", filter: `user_id=eq.${driverUid}` }, …)
  .subscribe();
return () => supabase.removeChannel(ch);
```

- Filter is exactly the child's bus's driver — no fan-out, no leakage.
- On child switch: cleanup runs first (`removeChannel`), then the effect re-runs with the new `driverUid`, so there is exactly one live subscription at any time.
- The 5 s `now` ticker is a plain `setInterval` cleared on unmount.
- Reverse-geocoding uses the existing cached helper: `cachedReverseGeocode` for the sync-hit fast path, otherwise queues into the shared 1 rps `reverseGeocode` — re-fires only when lat/lng rounded to 4 dp changes (about 11 m), not every metre of jitter.

## Correctness guards (Step 3)

- Freshness thresholds are the same 30 s live / 90 s offline the admin dashboard fix uses. Codified as constants in `src/lib/parent-presence.ts`.
- If a driver has an open trip_session but device_status is stale, the banner shows `offline`, not moving.
- No console errors on mount / child switch / unmount. Realtime channel is `removeChannel`-ed and the `setInterval` is cleared.
- No memory or subscription leaks on repeated child-switching — each switch tears down before subscribing again (see effect cleanup above).

## Step 4 — proof

### Pure-function tests (`scripts/test-parent-presence.ts`): 12 / 12 pass

Covers every banner state and every boundary (0 s, 5 s, 29 s, 30 s exactly, 60 s, 180 s), including the "no frozen live" guard (60 s stale + stored=moving + speed 0 → offline).

```
$ npx tsx scripts/test-parent-presence.ts
  PASS  no session → no-trip
  PASS  no session + no ds → no-trip
  PASS  session + no ds → offline (null lastSeen)
  PASS  fresh 5s, speed 42 → moving
  PASS  fresh 5s, speed 0 → stopped
  PASS  30s (stored moving+speed) → moving (middle branch)
  PASS  60s stale, stored=moving,speed=42 → moving
  PASS  60s stale, stored=idle → offline
  PASS  60s stale, stored=moving but speed 0 → offline
  PASS  180s stale → offline (with lastSeen)
  PASS  29s stale → moving (fresh branch)
  PASS  fresh, speed 0.5 → stopped

12 passed, 0 failed
```

### DB-side live test (`scripts/test-parent-live.sql`): 6 / 6 pass

Inside a rolled-back transaction: fresh-moving Guy, stale-15min Shema, an open trip_session for Guy, and Parent A's session is simulated via `SET LOCAL role = authenticated; SET LOCAL request.jwt.claims`. Then Guy is flipped stale (>90 s) and read again.

```
step                                                        | expected | actual | passed
------------------------------------------------------------+----------+--------+-------
A sees Guy device_status (fresh <30s)                       | true     | true   | true
A sees Guy speed_kmh > 0.8 (moving)                         | true     | true   | true
A sees Guy has open trip_session                            | true     | true   | true
A sees Shema device_status (RLS should hide)                | 0        | 0      | true
After stall: A still SEEs Guy row (client derives offline)  | true     | true   | true
After stall: age > 90s (client shows offline)               | true     | true   | true
```

Read the two rows together: as long as Guy's row was fresh + moving, the derivePresence rule returns `{kind: "moving"}` (proved by row 1 of the SQL test and row "fresh 5s, speed 42" of the pure test). Once Guy's `last_seen` is 3 minutes old, the row is still visible under RLS (row 5) but its `age > 90 s` (row 6) so derivePresence returns `{kind: "offline"}` (proved by "180s stale → offline" in the pure test). The client-side "offline" transition therefore fires purely from the DB signal, without any RLS change.

Parent A never sees Shema's row (row 4). That is the isolation guarantee from Step 0, still holding under Phase 3's live subscriptions.

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

## Fixed along the way

`src/lib/parent-join.server.ts` from Phase 2 called `.validator(...)` — that name doesn't exist on this project's `@tanstack/start-client-core`. Correct fluent name is `.inputValidator`. Without this fix the `/me` and `/join` routes fail to load (the loader chain re-imports the server file). One-line fix, committed with Phase 3's UI so `/me` actually works.

## Files added / touched

- `src/lib/parent-presence.ts` — pure `derivePresence` function + freshness constants, shared by `/me` and the test.
- `src/components/ParentMap.tsx` — Leaflet map: route line, labelled stops, emphasised home + school, live bus marker, camera governor.
- `src/routes/me.tsx` — full rewrite: child chips, banner, map, trust row, realtime channel keyed by driverUid.
- `src/lib/parent-join.server.ts` — `.validator` → `.inputValidator`.
- `scripts/test-parent-presence.ts` — pure-function tests (12 assertions).
- `scripts/test-parent-live.sql` — DB-side live-signal + isolation test (6 assertions).

## Scope guardrails — what was NOT done

- **Not pushed.** Branch `feat/parent-phase3` sits on top of `feat/parent-phase2`. Nothing lands without your review.
- **No ETA math, no geofence arrive/depart, no notifications.** Phase 4.
- **No changes to landing page, driver tracker, admin dashboard, `/history`, or `/join` beyond the one-line fix that unblocked its loader.**
- **No RLS weakening.** The only Phase 2 addendum stayed exactly as it was.
- **English only** throughout the new UI, per spec.
