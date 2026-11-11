# What is different in the demo

This project was copied from the main Live Track project (`live-track-main`, branch
`feat/school-attendance`, commit `47ccf44`). This file lists every change made here since
then, newest first, so the two projects can be compared.

**"Bring to main?"** tells you whether the change also belongs in the real product:

- **Yes** — a fix or improvement that is not about the demo.
- **Demo only** — exists only to make demonstrations possible; never put it in production.
- **Already there** — came from main.

## 11 Nov 2026 — make the demo testable, clearer screens

| Change                                                                                                                                                                                             | Files                                                                                                                               | Bring to main?                                                                               |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **You can drive the buses.** Yellow box "Demo: drive the bus" on the school Overview and the attendant screen: Drive / Stop / Park, put the bus at any stop, "Start today again"                   | `src/components/DemoBusControls.tsx`, `src/routes/admin/index.tsx`, `src/routes/bus.tsx`, `supabase/demo/demo_controls.sql`         | Demo only                                                                                    |
| **Engine alerts to parents**: "Bus 1 has started its engine" / "Bus 1 is parked", once per parent                                                                                                  | `supabase/demo/demo_controls.sql` (trigger on `device_status`)                                                                      | Demo only for now. The school asked for this alert, so it is worth building properly in main |
| **Phone notifications work in the demo.** The demo has no GPS server (which sends them in production), so the website sends them itself. It sets itself up: no keys to configure                   | `api/demo-push.js`, `api/_webpush.js`, `src/lib/push.ts`, `src/routes/__root.tsx`, `vercel.json`, `supabase/demo/demo_controls.sql` | Demo only                                                                                    |
| **"Get alerts on this phone" card** at the top of the parent's home screen (it was hidden in Settings). In the demo it also has "Send a test"                                                      | `src/components/ParentPushCard.tsx`, `src/routes/family.tsx`                                                                        | Yes (without the test button)                                                                |
| **"Bus has started" sent once per parent**, not once per child                                                                                                                                     | `supabase/migrations/20261111120000_trip_started_once_per_parent.sql`                                                               | Yes                                                                                          |
| **Parent screen says the truth about the bus**: "is parked (engine off)" / "is stopped (engine on)" instead of always "is on the road"                                                             | `src/routes/family.tsx`                                                                                                             | Yes                                                                                          |
| **Add / edit a parent on the Parents page** (before: only through a student)                                                                                                                       | `src/components/school/ParentDialog.tsx`, `src/routes/admin/parents.tsx`                                                            | Yes                                                                                          |
| **Phone numbers shown the local way**: `0788 123 456` instead of `+250 788 123 456`. Typing accepts both, as before                                                                                | `src/lib/phone.ts`                                                                                                                  | Yes                                                                                          |
| **Menu without sub-menus.** Everything is visible in plain sections; it no longer opens "Students & parents" by itself. Clearer names: Today's trips, Buses, Messages to parents, Bus trip history | `src/components/nav.ts`, `src/components/AppShell.tsx`                                                                              | Yes                                                                                          |
| **Simpler words**: "Uses the app" / "Has not signed in yet" for parents; "Buses" instead of "Vehicles" on Routes & stops; the routes list stays in view while you scroll                           | `src/routes/admin/parents.tsx`, `src/routes/admin/routes.tsx`                                                                       | Yes                                                                                          |
| **One-tap demo sign-in is back**, as clear cards with name, role and login. No platform-admin button                                                                                               | `src/components/DemoLogins.tsx`, `src/lib/demo.ts`, `src/routes/auth.tsx`, `src/routes/parent.tsx`                                  | Demo only                                                                                    |
| **Demo data**: Bus 1 and 2 start parked at school, Bus 3 drives; today's trips are left free; waiting parents have real names; accounts greet people by their real name                            | `supabase/demo/demo.sql`, `scripts/demo/seed.mjs`                                                                                   | Demo only                                                                                    |
| **Attendant's phone position is ignored in the demo** (the phone is not on the bus, it would raise false "got off far from the stop" alerts)                                                       | `src/routes/bus.tsx`                                                                                                                | Demo only                                                                                    |
| Guides rewritten                                                                                                                                                                                   | `DEMO_GUIDE.md`, `DEMO_SETUP.md`, this file                                                                                         | Demo only                                                                                    |

## 10 Nov 2026

| Change                                                                                 | Files                                                                                                   | Bring to main?                    |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------- |
| **School admins see their buses on the Live map.** Before, only the platform admin did | `src/routes/dashboard.tsx`                                                                              | **Yes — the same bug is in main** |
| 4th demo parent (Jean Paul, 3 children on Bus 3)                                       | `supabase/demo/demo.sql`, `scripts/demo/seed.mjs`                                                       | Demo only                         |
| First version of the demo guide                                                        | `DEMO_GUIDE.md`                                                                                         | Demo only                         |
| Landing page and preview describe school buses + child check-in; user manual PDF added | `src/routes/index.tsx`, `src/components/AnimatedWorld.tsx`, `docs/manual/`, `LIVETRACK-User-Manual.pdf` | Already there                     |

## 9 Nov 2026 — the demo is created

| Change                                                                          | Files                                             | Bring to main? |
| ------------------------------------------------------------------------------- | ------------------------------------------------- | -------------- |
| Own Supabase project (`nkhqxwmomyitnbcbcbqc`), own GitHub repo, own Vercel site | `supabase/config.toml`, `.env.local` (not in git) | Demo only      |
| All 18 database migrations applied, then the demo add-on                        | `supabase/migrations/*`, `supabase/demo/demo.sql` | —              |

## Database objects that exist only in the demo

Created by `supabase/demo/demo.sql` and `supabase/demo/demo_controls.sql`:

- tables `demo_config`, `demo_sim`
- functions `demo_seed`, `demo_reset`, `demo_tick`, `_demo_step`, `demo_bus_control`,
  `demo_restart_today`, `demo_test_notification`, `_demo_engine_notify`, `_demo_push_kick`
- triggers `demo_engine_notify` (on `device_status`), `demo_push_kick` (on
  `parent_notifications` and `school_alerts`)
- scheduled jobs `livetrack-demo-tick` (every 10 s), `livetrack-demo-reset` (nightly)
- extensions `pg_cron`, `pg_net`
