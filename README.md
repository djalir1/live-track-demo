# Live Track — Real-time GPS Tracking

A phone-as-tracker web app: drivers open the app on their phone and their live
location streams to an admin dashboard. Built on **TanStack Start + React 19**
with a **Supabase** backend (Auth, Postgres, RLS, Realtime).

## Features

- **Signup / sign-in** with driver name, vehicle name, plate number, vehicle
  type (Car / SUV / Van / Truck / Pickup / Bus / Motorcycle / Bicycle / Other)
  and seat count where applicable.
- **Driver tracker** — real-time GPS via `watchPosition`, speed / distance /
  battery, reverse-geocoded current street, Wake Lock keeps the screen on.
- **Admin dashboard** — every driver on one map with custom vehicle marker,
  live/parked/idle/offline status, battery, phone on/off, plate number, and
  street address. Filters + search. Realtime updates via Supabase channels.
- **Trip history** — pick any driver + any date, see the full route polyline
  and stops on the map, with summary tiles (distance, driving time, stopped
  time, top speed).
- **PDF report** — one-click download of a full daily report with driver,
  plate, vehicle, battery start/end, stops with addresses/times, and every
  trip point.
- **Mobile-friendly** — dashboard and history collapse to a tab-switch
  (Drivers ⇄ Map) layout on small screens.

- **Hardware GPS trackers** — buses can carry a 4G GT06 tracker instead of a
  driver phone. See [`gps-server/README.md`](gps-server/README.md) for setup
  and the *GPS trackers in the buses* chapter of `LIVETRACK-System-Guide.pdf`.

## Local development

```bash
npm install
cp .env.example .env
# fill in your Supabase URL + publishable key
npm run dev
```

App runs on http://localhost:8080.

## Environment variables

See `.env.example`. In short:

| Variable                        | Where it's used                          |
|---------------------------------|------------------------------------------|
| `VITE_SUPABASE_URL`             | Browser Supabase client                  |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Browser Supabase client                  |
| `SUPABASE_URL`                  | SSR fallback                             |
| `SUPABASE_PUBLISHABLE_KEY`      | SSR fallback                             |

The publishable / anon key is safe to expose to the browser. **Never** commit
the `SUPABASE_SERVICE_ROLE_KEY` — the client doesn't need it and it bypasses
row-level security.

## Deploying to Vercel

1. Push this repo to GitHub.
2. On Vercel: **Add New Project → Import** the repo.
3. **Framework preset**: `Other` (leave as detected — `vercel.json` handles it).
4. **Environment variables**: add the four Supabase entries from `.env.example`.
5. **Deploy**.

`vercel.json` tells Vercel to:
- Build with `npm run build` (produces `dist/client` + `dist/server`).
- Serve `dist/client/` as the static site.
- Route every non-static URL through `api/ssr.js`, a Node.js function that
  hands the request to the TanStack Start SSR bundle.

That's it — no other configuration required.

## Database

Schema lives in `supabase/migrations/`. RLS policies isolate drivers to their
own rows; admins can see everyone. New signups are auto-confirmed (no email
verification) via a `BEFORE INSERT` trigger. To promote a user to admin:

```sql
UPDATE public.user_roles
SET role = 'admin'
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'you@example.com');
```

## Docs

- `USER_MANUAL.md` — how schools, attendants and parents use Live Track (manual check-in).
- `ATTENDANCE_SYSTEM.md` — technologies, fingerprint readers and prices.
- `DEMO_SETUP.md` — copy this project into a separate demo (own database, fictional data,
  simulated buses), with a ready-made prompt for Claude Code.

## Tech stack

- **Framework**: TanStack Start (React 19 + Router)
- **UI**: Tailwind CSS 4, shadcn/ui components, Framer Motion, Lucide icons
- **Backend**: Supabase (Auth + Postgres + RLS + Realtime)
- **Map**: Leaflet + react-leaflet + CARTO Voyager tiles
- **Geocoding**: OpenStreetMap Nominatim (client-side, cached)
- **PDF**: jsPDF + jsPDF-autoTable
