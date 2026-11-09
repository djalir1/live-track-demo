# Live Track — School Attendance: technology, fingerprint machines & prices

Branch: `feat/school-attendance` (not on `main`, not in production).
Plan it implements: `LIVETRACK-Student-Attendance-Plan.pdf` (Phase 1, manual check-in).

## 1. What is built (manual phase, fully working)

| Who | Where | What they do |
|---|---|---|
| School admin | `/admin` (sidebar dashboard) | Students (photo, class, bus, morning + afternoon stop, 1–2 parents, consent, CSV import), parents (activation codes, password reset), bus attendants, routes & stops, live trips board, class register, announcements, safety alerts, attendance reports (Excel + PDF), fingerprint foundation |
| Bus attendant | `/bus` (phone) | Starts the morning / afternoon trip, list grouped by stop (current stop on top), big **On / Not here / Off** buttons, "everyone off at school", one-tap announcements (traffic, late, accident, breakdown, custom), **"bus is empty" check before the trip can end**, works offline |
| Parent | `/parent` → `/family` | Sign in with **phone + password** (first time: phone + 6-digit code from the school), all their children on one screen, live bus + km/minutes to their stop, "not riding / I'll pick up / absent" buttons, notifications feed, trip history, alert settings |
| Driver | `/track` (unchanged) | Drives. If a driver opens `/bus`, check-in **locks while the bus is moving** |

Automatic rules (in the database, so they work from any device):
attendance per trip (morning ≠ afternoon), no-show when the bus leaves a stop, "your stop is next" and "bus is at your stop" alerts (uses the existing stop detection), wrong-bus flag, drop-off far from home, **child still on board 10 min after engine off → urgent school alert**, bus breakdown → move the whole trip list to another bus, temporary bus/stop change for a period, two parents per child, siblings on one account.

When the GPS tracker problem is solved, nothing else is needed for tracking — positions already feed the trip lists and alerts.

## 2. Technologies

| Part | Technology |
|---|---|
| Web app (school, attendant, parent) | React 19 + TanStack Start/Router, Tailwind CSS 4, shadcn/Radix UI, Leaflet/MapLibre maps — installable PWA (no app store needed) |
| Database, logins, live updates | Supabase (PostgreSQL + Row-Level Security + Realtime). All rules are SQL functions; every role sees only its own data |
| Parent / attendant accounts | Phone number + password; activation code from the school; `/api/activate` (Vercel serverless function) |
| Notifications | In-app feed (Realtime) + Web Push to phones, sent by the GPS server (`gps-server/src/attendance-notify.js`) |
| GPS | Existing GT06 server (Node.js, VPS in Kigali) |
| Offline check-in | Taps saved on the phone, sent with their real time and place when the network returns |
| Fingerprint (next) | USB-OTG reader on the attendant's Android phone + the maker's Android SDK, wrapped in a small Android app (Capacitor) — the web screens stay the same |

## 3. Fingerprint check-in — status: UNDER CONSTRUCTION

Already done: consent per child, reader registry (`/admin/biometrics`), `student_credentials` table (stores only the reader's encrypted template reference, never images), check-in already records the method (`manual / fingerprint / card / face`), fingerprint button on the attendant screen (shows "under construction").

To finish: pick a reader → add its SDK in an Android wrapper app → enrol 2 fingers per child → pilot on 1–2 buses.

### Recommended machines

Prices are **estimates (Nov 2026) from online listings**, before shipping, Rwanda import duty/VAT (~18%) and local margin. **Get quotes from a Kigali supplier before buying.** 1 USD ≈ 1,450 RWF.

| Option | Model (examples) | How it connects | Approx. price | For |
|---|---|---|---|---|
| **A. Recommended** — reader plugged into the attendant's phone | **SecuGen Hamster Pro 20 (HU20-A)** — FBI-certified sensor, Android SDK | USB-OTG to Android | **$70–145** (~100k–210k RWF) | Best quality/price, good with small fingers |
| A-budget | **Mantra MFS110 L1** | USB / Type-C OTG, Android 7+ | **~$25–45** (~40k–65k RWF) | Cheapest; confirm SDK licence for non-Aadhaar use |
| A-wireless | **HFSecurity HF7000** | USB or Bluetooth to phone | **$65–110** (~95k–160k RWF) | No cable at the door |
| B. All-in-one terminal (no attendant phone) | **HFSecurity FP07** (7" Android tablet, fingerprint, 4G) / **FP09** (handheld, fingerprint + NFC + 4G + printer) | Own SIM / 4G | **$195–390** (~285k–565k RWF) | Large fleets, fixed at the bus door |

Also needed: OTG cable/adapter (~$3), phone holder at the door (~$10), consumables (cleaning wipes).

### Budget example (pilot: 1 school, 5 buses)

| Item | Qty | Low | High |
|---|---|---|---|
| Fingerprint reader (Option A) | 5 + 1 spare | $150 (Mantra) | $870 (SecuGen) |
| OTG cables + holders | 6 | $40 | $80 |
| Attendant phones (if the school has none, basic Android with OTG) | 5 | $0 | $600 |
| Import, VAT, delivery (~30%) | — | $60 | $460 |
| **Total** | | **≈ $250 (~360k RWF)** | **≈ $2,000 (~2.9M RWF)** |

Software (enrolment screen, Android wrapper, SDK integration) is our development work, no licence cost for SecuGen/Mantra SDKs on Android (confirm with the vendor).

### Our recommendation

1. **Pilot with SecuGen Hamster Pro 20 on the attendant's Android phone** (Option A). It is reliable, affordable, and needs no installation in the bus.
2. **Enrol two fingers per child** and **keep the manual tap** as a fallback. Fingerprints often fail for young children with small, wet or dirty fingers. The plan also recommends NFC cards for this reason, and the same screens support cards if fingerprints prove too slow.
3. **Legal first.** Fingerprints are sensitive personal data under Rwanda **Law N° 058/2021**. Get written parental consent (already recorded per child), register with the data protection authority (NCSA), store templates only, and delete them when a child leaves. Confirm with a legal advisor before the pilot.
4. Move to all-in-one 4G terminals (Option B) only once the fleet is large.

## 4. Testing, demo and copies

- **User manual** (how the manual check-in works, every role): `USER_MANUAL.md`.
- **Demo / any new copy** (own database, seeded data, simulated buses): `DEMO_SETUP.md`.
  The migrations in `supabase/migrations/` rebuild the production database exactly
  (including `20260819140000_prod_baseline.sql`, captured from production).
- Tests without a database: `npm i --no-save @electric-sql/pglite@0.2.17 && npm run test:db && npm run test:logic`,
  and `cd gps-server && node --test`.
