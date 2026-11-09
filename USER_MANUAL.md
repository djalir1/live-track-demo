# Live Track — User Manual (school transport, manual check-in)

Live Track tells a school and its parents where every bus is and **which child is on it**.
In this first version the **bus attendant ticks each child on a phone**. Later, a fingerprint
reader will do the tick (marked *under construction* in the app); everything else stays the same.

| Who | Signs in at | With |
|---|---|---|
| School admin | `/auth` | email + password |
| Bus attendant | `/auth` | phone number + password |
| Parent | `/parent` | phone number + password |
| Driver | nothing to do — the GPS tracker in the bus reports by itself | |

> **Accounts are created by the school.** Parents and attendants get a **6-digit code** to choose
> their own password the first time ("First time here?"). The same code flow resets a forgotten
> password. There is no public sign-up.

---

## 1. Setting up a school (school admin, once)

Work through the left menu from top to bottom of **Fleet**, then **Students & parents**:

1. **Fleet → Vehicles** — add each bus (name, plate, seats). If it has a GPS tracker, enter its IMEI.
2. **Fleet → Routes & stops** — create one route per bus. Add the stops **in order** on the map
   (morning order: first pick-up → … → school) and finish with the **school** stop.
   Each stop has a circle: when the bus enters it, Live Track knows the bus is *at* that stop.
3. **Fleet → Drivers** — add the drivers and assign each to a bus.
4. **Fleet → Bus attendants** — add each attendant with their phone number and bus.
   A 6-digit **activation code** appears: give it to the attendant.
5. **Students & parents → Students** — **Add student** (or **Import CSV** for many at once):
   - name, class, student number, photo (only with the parent's photo consent),
   - **bus**, **morning pick-up stop**, **afternoon drop-off stop** (can differ),
   - **one or two parents** with their phone numbers,
   - consent boxes (photo; fingerprint — recorded now, used when readers are installed),
   - a note for the attendant (allergies, "gets off with sister", …).
   New parents get an activation code — copy the ready-made WhatsApp/SMS message.
6. **Students & parents → Parents** — see who has activated the app, copy invitations again,
   or **Reset password** (gives a new code).

Tip: press **Ctrl K** (or the search box at the top) to jump to any page, student, parent or bus.

---

## 2. A school day

### Morning (home → school)

| Step | Who | What happens |
|---|---|---|
| Before the bus leaves | Parent (optional) | Taps **Not riding** / **Absent** for today → the child is marked *Not riding* and the bus won't wait. |
| Start | Attendant | Opens Live Track → **Start morning trip**. The list of children opens, **grouped by stop in route order**. Parents get "🚌 Bus 1 has started the morning pickup". |
| Approaching | System | When the bus reaches the stop before a child's stop: "🚌 Bus 1 is one stop away". At the child's stop: "🚏 Bus 1 is at Kimironko stop". That stop jumps to the top of the attendant's list. |
| Child gets on | Attendant | Taps **On ✓** → parent: "✅ Amina boarded Bus 1 at Kimironko stop · 06:58". |
| Child not there | Attendant or system | **Not here**, or automatically when the bus leaves the stop → *No-show*, parent told at once. |
| Delay | Attendant | **Announce** → Heavy traffic +10/+20/+30 · Running late · Accident (all safe) · Breakdown · own text → every parent on the bus is told. Accident/breakdown also alert the school. |
| At school | Attendant | **All off at school** → parents: "🏫 Amina arrived at school". |
| End | Attendant | **End trip** → walks to the back of the bus and confirms **"the bus is empty"**. The trip can't be closed while a child is still marked on board. |

### Afternoon (school → home)
Same screen, **Afternoon** tab: tick children **On** at school, **Off here** at their stop
(parent: "🏠 Amina got off at Kimironko stop"). A child dropped far from home raises a school alert.

### Rules that keep children safe
- **Per trip, not per day:** driven to school by car in the morning and bussed home = never "absent".
- **Wrong bus:** the child is accepted (safety first), flagged, and the school and parent are told.
- **Child left on the bus:** still marked on board 10 min after the engine stops → urgent alert.
- **No network:** the attendant's taps are saved on the phone and sent later with their real time.
- **Mistake:** the ↶ button undoes a tap (the parent gets a short correction).
- **Driver lock:** if the driver opens the check-in screen, it locks while the bus moves.
- **Breakdown:** *Trips & check-in → Move to another bus* moves the whole list; parents follow the new bus.

---

## 3. The school dashboard

| Page | Use it to |
|---|---|
| **Overview** | Morning / afternoon: on board, still to pick up, dropped, not riding, no-shows; every bus live; latest check-ins; parent notices. |
| **Live map** | Every bus on the map. Collapse the sidebar (button next to the logo) for a bigger map. |
| **Trips & check-in** | Each bus's list for any date, stop by stop, with times. Open a list, move a trip to another bus. |
| **Safety alerts** | No-shows, wrong bus, left at school, far drop-off, child left on bus, incidents. Call the parent (tap the number), then **Handled**. |
| **Announcements** | Message all parents, or the parents of one bus. |
| **Class register** | Tick present/absent. Live Track compares it with the bus: *All good*, *Came by car*, *Came another way*, *Absent (excused)*, **Check now**, **Urgent**. |
| **Attendance reports** | Week / month / custom: rides per day and per child, no-shows, ridership %. **Excel** and **PDF**. |
| **Trip history** | Where each bus went, km driven, stops, signal losses — per day or period. |
| **Fingerprint check-in** | *Under construction* — consent counts and reader registry. |

---

## 4. The parent app (`/parent` → My children)

- One screen for all your children (tap a name to switch).
- **To school / Home** status for today, with times.
- The bus live on the map with **minutes and km to your stop**; a warning when it is 1–5 km away (choose in ⚙ Settings).
- **Change of plan:** *Not riding the bus* · *I'll pick up from school* · *Absent* — for today, tomorrow or a date. Cancel with ✕.
- 🔔 all messages: boarding, arrivals, delays, school messages. **Trip history** per child.
- ⚙ Settings: turn on phone notifications, choose which alerts, light/dark mode, sign out.
- **Install it:** on Android tap *Install app*; on iPhone *Share → Add to Home Screen*.

---

## 5. Demo version — accounts and data

The demo project (see `DEMO_SETUP.md`) is filled with fictional data by `npm run demo:seed`.
**Password for every demo account: `demo1234`.** In demo mode the sign-in pages also show
one-tap buttons for these accounts.

| Role | Sign in at | Login | Notes |
|---|---|---|---|
| School admin | `/auth` | `school@demo.livetrack.app` | Sunrise Academy (Demo) |
| Platform admin | `/auth` | `admin@demo.livetrack.app` | sees all schools |
| Attendant — Bus 1 | `/auth` | `0788 100 001` | Alice Mukeshimana · Kimironko line |
| Attendant — Bus 2 | `/auth` | `0788 100 002` | Diane Uwamahoro · Kicukiro line |
| Attendant — Bus 3 | `/auth` | `0788 100 003` | Josiane Ingabire · Nyamirambo line |
| Parent — Grace Uwase | `/parent` | `0788 200 001` | 2 children on Bus 1 |
| Parent — Eric Mugisha | `/parent` | `0788 200 002` | 1 child on Bus 1 |
| Parent — Aline Ishimwe | `/parent` | `0788 200 003` | 2 children on Bus 2 |

What the demo contains:
- **Sunrise Academy (Demo)**, 3 routes on real Kigali roads (Kimironko, Kicukiro, Nyamirambo lines), 4 stops each.
- **3 buses** (RAD 101 A/B/C) with drivers, attendants and a simulated GPS: they drive their
  route and back all day, pausing 20 s at each stop, so the live map, stop alerts and parent
  ETAs work exactly like with a real tracker.
- **30 students**, 3 parents with the app, 25 parents still waiting with activation codes
  (Parents page), one attendant waiting to activate (Samuel, `0788 100 009`).
- **Two weeks of trips** with check-ins, a few no-shows and parent notices, class registers,
  announcements and one open safety alert → reports and history have data.
- The demo **rebuilds itself every night at 01:00** (Kigali), so visitors can't break it.

### A 5-minute demo script
1. **School admin** → Overview → Live map (collapse the sidebar) → Students → open Amina.
2. In a second browser: **Attendant Bus 1** → *Afternoon* → **Start afternoon trip** → tick children **On**.
3. In a phone-size window: **Parent Grace** → see "boarded" arrive live, the bus on the map and the minutes to the stop.
4. Attendant → **Announce → Heavy traffic +15** → the parent gets it instantly.
5. Attendant → **All off** → **End trip** (bus-empty check). School admin → Attendance reports → **PDF**.
