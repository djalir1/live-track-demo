# Live Track — set up the DEMO project (a separate copy with its own database)

The demo is a **separate project**: its own folder/repo, its own Supabase database, its own
Vercel site. It runs the **full system** (fleet tracking + school attendance) with **fictional
data** and **simulated buses** — no GPS tracker, no GPS server, nothing shared with production.

---

## ▶ Prompt for Claude Code (paste this in the new demo folder)

```
You are setting up the Live Track DEMO: a separate copy of this project with its own Supabase
database and Vercel site. Follow DEMO_SETUP.md exactly, step by step, and stop to ask me for
anything only I can provide (Supabase project keys, DB password, Vercel login).

Hard rules:
- NEVER use the production Supabase project (ref xtvomhbolgrzlkaocyju) or its keys. If any env
  value contains that ref, stop and tell me.
- Apply supabase/migrations/*.sql ONE FILE AT A TIME, in filename order (never pasted together).
- Then apply supabase/demo/demo.sql (demo only — it must never go to production).
- Do not deploy or touch gps-server/ (the demo has no GPS server).
- After each step, run the "Check" listed in DEMO_SETUP.md and show me the result.
At the end, give me the demo URL and the account table from USER_MANUAL.md section 5.
```

---

## Step 0 — Copy the project

```bash
git clone https://github.com/djalir1/live-track.git live-track-demo
cd live-track-demo
git checkout feat/school-attendance      # the branch with the full system
git checkout -b main                     # becomes the demo's main branch
git remote remove origin                 # detach from the production repo
# create an empty GitHub repo (e.g. live-track-demo) and:
git remote add origin https://github.com/<you>/live-track-demo.git
git push -u origin main
npm install
```
**Check:** `git remote -v` shows the *demo* repo, not `djalir1/live-track`.

## Step 1 — Create the demo database

1. supabase.com → **New project** → name `livetrack-demo`, region **eu-west-1** (or the closest to Rwanda), set a DB password.
2. **Database → Extensions → enable `pg_cron`** (moves the buses and resets the demo nightly).
3. **Settings → API**: copy the *Project URL*, *anon / publishable key* and *service_role key*.

**Check:** the project ref (in the URL) is **not** `xtvomhbolgrzlkaocyju`.

## Step 2 — Create the tables (identical to production)

Apply every file in `supabase/migrations/` **in filename order, one file per run**
(`20260504215655_…` first, `20261109120000_…` last). Any of these works:

- **Supabase MCP** (Claude Code): `apply_migration` once per file, name = file name without `.sql`.
- **Supabase CLI:**
  ```bash
  npx supabase link --project-ref <DEMO_REF>     # asks for the DB password
  npx supabase db push
  ```
- **SQL editor:** open each file, paste, Run — one file at a time.

> Why one at a time: some files add account roles (`parent`, `school_admin`, `attendant`) that
> the next files use; Postgres only allows that after the first file is committed.

Then apply the demo add-on **`supabase/demo/demo.sql`** (SQL editor or `apply_migration`, name `demo_addon`).

**Check** (SQL editor):
```sql
select count(*) as tables from information_schema.tables where table_schema = 'public';   -- 38 (36 + demo_config + demo_sim)
select jobname, schedule from cron.job;                                                   -- livetrack-demo-tick (10 seconds), livetrack-demo-reset
select proname from pg_proc where proname in ('demo_seed','demo_tick','mark_student');     -- 3 rows
```
If `cron.job` is empty, pg_cron was not enabled: enable it and run `demo.sql` again.

## Step 3 — Point the app at the demo database

Create `.env.local` (never committed):
```env
VITE_SUPABASE_PROJECT_ID="<DEMO_REF>"
VITE_SUPABASE_URL="https://<DEMO_REF>.supabase.co"
VITE_SUPABASE_PUBLISHABLE_KEY="<demo anon/publishable key>"
SUPABASE_URL="https://<DEMO_REF>.supabase.co"
SUPABASE_PUBLISHABLE_KEY="<demo anon/publishable key>"
SUPABASE_SERVICE_ROLE_KEY="<demo service_role key>"
VITE_DEMO_MODE="true"
```
Also replace the values in `.env` with the same demo values (or delete `.env`) so nothing points at production,
and set `project_id` in `supabase/config.toml` to `<DEMO_REF>`.

**Check:** `grep -r xtvomhbolgrzlkaocyju .env .env.local supabase/config.toml` prints nothing.

## Step 4 — Fill it with demo data

```bash
npm run demo:seed
```
Creates the accounts (password `demo1234`) and the school: 3 routes on real Kigali roads,
3 buses, drivers, attendants, 30 students, parents, two weeks of trips and attendance.
Safe to run again — it rebuilds everything. It refuses to run against production.

**Check:** the script prints "✅ Demo ready: 30 students, 3 buses" and the account table. Then:
```sql
select user_id, latitude, longitude, speed_kmh, last_seen from device_status order by last_seen desc limit 3;
```
Run it twice, 20 s apart: `last_seen` and positions change → the buses are moving.
(No pg_cron? Keep `npm run demo:simulate` running instead.)

## Step 5 — Try it locally

```bash
npm run dev            # http://localhost:8080
```
- `/auth` shows **Demo accounts** buttons → *School admin* → Overview, Live map (3 buses moving), Students, Reports.
- `/parent` → *Grace Uwase* → her 2 children, the bus live with minutes to the stop.
- `/auth` → *Bus attendant (Bus 1)* → Afternoon → Start trip → tick children → Grace sees it live.

## Step 6 — Put it online (Vercel)

1. vercel.com → **Add New Project** → import the **demo** repo (Framework: Other — `vercel.json` sets everything).
2. **Environment Variables** (Production + Preview): the 7 values from Step 3 (with `VITE_DEMO_MODE=true`).
3. Deploy. **Check:** open `<demo-url>/auth` → the yellow **DEMO** badge and demo account buttons appear.

## What is different from production

| | Production | Demo |
|---|---|---|
| Database | `xtvomhbolgrzlkaocyju` | its own project |
| Positions | real GT06 trackers → `gps-server` | `demo_tick()` every 10 s (pg_cron) |
| Data | real school | fictional, rebuilt nightly at 01:00 Kigali (`demo_reset()`) |
| Sign-in pages | normal | + DEMO badge and one-tap demo accounts (`VITE_DEMO_MODE=true`) |
| Phone push | via `gps-server` | not set up (in-app notifications work live) |

## Troubleshooting

| Problem | Fix |
|---|---|
| `unsafe use of new value "school_admin"` | Migrations were run together — run them one file at a time. |
| `demo_seed failed … does not exist` | `supabase/demo/demo.sql` was not applied. |
| Buses don't move | Enable pg_cron and re-run `demo.sql`, or run `npm run demo:simulate`. |
| "Database not set up for attendance" in the app | `.env.local` points at a database without the migrations. |
| Demo buttons say "account not found" | Run `npm run demo:seed` against the same database the app uses. |
| Blank page in `npm run dev` | Stop it and run `npx vite dev --port 8080 --force` once (clears Vite's cache). |

Tests (no database needed): `npm i --no-save @electric-sql/pglite@0.2.17 && npm run test:db && npm run test:logic`.
