# Live Track demo — logins and test guide

Use this to show Live Track to a school, or to check that everything works.
Everything here is fictional and is rebuilt every night at 01:00 (Kigali time).

## 1. Signing in

On the sign-in pages there is a yellow box, **"Demo: tap a person to sign in"**. One tap and you
are in — no typing.

| Who                                               | Page      | Login (if you type it)      |
| ------------------------------------------------- | --------- | --------------------------- |
| School admin — Mrs. Claudine Mutesi               | `/auth`   | `school@demo.livetrack.app` |
| Bus attendant — Bus 1 (Alice Mukeshimana)         | `/auth`   | `0788 100 001`              |
| Bus attendant — Bus 2 (Diane Uwamahoro)           | `/auth`   | `0788 100 002`              |
| Bus attendant — Bus 3 (Josiane Ingabire)          | `/auth`   | `0788 100 003`              |
| Parent — Grace Uwase (Amina, Brian · Bus 1)       | `/parent` | `0788 200 001`              |
| Parent — Eric Mugisha (Chloe · Bus 1)             | `/parent` | `0788 200 002`              |
| Parent — Aline Ishimwe (Kevine, Liam · Bus 2)     | `/parent` | `0788 200 003`              |
| Parent — Jean Paul Nkurunziza (3 children, Bus 3) | `/parent` | `0788 200 004`              |
| Platform admin (no button, type it)               | `/auth`   | `admin@demo.livetrack.app`  |

Password for everyone: **`demo1234`**.

## 2. What is in the demo

**Sunrise Academy (Demo)**: 3 buses, 3 routes on real Kigali roads, 30 students (10 per bus),
26 parents (4 use the app, 22 still have their code to start), 2 weeks of past trips for the
reports.

| Bus               | Stops, in order                                       | Attendant | Parents you can sign in as                                  |
| ----------------- | ----------------------------------------------------- | --------- | ----------------------------------------------------------- |
| Bus 1 · RAD 101 A | 1 Kimironko Market → 2 Kibagabaga → 3 Kagugu → School | Alice     | Grace (Amina: stop 1, Brian: stop 2) · Eric (Chloe: stop 3) |
| Bus 2 · RAD 102 B | 1 Kicukiro Centre → 2 Sonatubes → 3 Remera → School   | Diane     | Aline (Kevine: stop 2, Liam: stop 3)                        |
| Bus 3 · RAD 103 C | 1 Nyamirambo Stadium → 2 Kiyovu → 3 Kacyiru → School  | Josiane   | Jean Paul (Umutoni: stop 3, Victor: stop 1, Wendy: stop 2)  |

Every morning the demo starts like this: **Bus 1 and Bus 2 are parked at the school**
(engine off), waiting for you. **Bus 3 drives its route by itself** so the live map is never
empty. No trip has been done yet today.

## 3. You drive the bus

There is no real bus, so the demo gives you the driver's seat. Look for the yellow box
**"Demo: drive the bus"**:

- school admin: top of **Overview** (all 3 buses);
- bus attendant: top of the check-in screen (tap the box to open it).

| Button                 | What the bus does                                           |
| ---------------------- | ----------------------------------------------------------- |
| **Drive**              | Drives its route by itself, pausing 20 seconds at each stop |
| **Stop**               | Stands still with the engine on                             |
| **Park**               | Engine off. Parents get "🅿️ Bus 1 is parked"                |
| **1 … 2 … 3 … School** | Puts the bus at that stop at once (engine on, waiting)      |
| **Start today again**  | Deletes today's trips so you can show the same trip again   |

When a parked bus is switched on (Drive, Stop or a stop button), parents get
"🚌 Bus 1 has started its engine".

## 4. Phone notifications (do this once per phone)

1. Open the demo on the phone and sign in as a parent, for example **Grace** on `/parent`.
   On an iPhone, first add the site to the Home Screen (Share → Add to Home Screen) and open it
   from there.
2. At the top there is a blue card, **"Get alerts on this phone"**. Tap **Turn on** and allow.
3. The card turns green. Tap **Send a test**, then lock the phone. Within a few seconds
   "🔔 Test notification" arrives.

If you had turned notifications on before this update, open the app once and wait a few
seconds: it re-registers the phone by itself. If the test does not arrive, see section 7.

One phone holds one person at a time: if you sign in as another parent on the same phone,
the alerts move to that parent.

## 5. Main test: a morning trip (about 3 minutes)

You need two screens: **the attendant** (laptop or second phone) and **Grace** (the phone
with notifications on).

| #   | On the attendant screen (Alice, Bus 1)                      | Grace's phone receives                                                     |
| --- | ----------------------------------------------------------- | -------------------------------------------------------------------------- |
| 1   | Choose **Morning** → **Start morning trip**                 | 🚌 Bus 1 is on its way to pick up Amina and Brian                          |
| 2   | Open "Demo: drive the bus" → tap **1 Kimironko Market**     | 🚌 Bus 1 has started its engine · 🚏 Bus 1 is at Kimironko Market stop now |
| 3   | Tap **On ✓** next to Amina Uwase                            | ✅ Amina Uwase boarded Bus 1 at Kimironko Market stop                      |
| 4   | Tap **2 Kibagabaga**                                        | 🚏 Bus 1 is at Kibagabaga stop now — Brian should get on now               |
| 5   | Tap **Not here** next to Brian Mugisha                      | ⚠️ Brian Mugisha was not at the stop                                       |
| 6   | Tap **School**                                              | (nothing — the bus is driving to school)                                   |
| 7   | Tap **Off at school ↓** for Amina (or "everyone off")       | 🏫 Amina Uwase arrived at school                                           |
| 8   | **End trip** → confirm the bus is empty → then tap **Park** | 🅿️ Bus 1 is parked                                                         |

Good to know:

- When the bus **leaves** a stop in the morning, children of that stop who were not ticked are
  marked "missed the bus" and their parents are told. That is the real behaviour — so tick
  the children **before** you move the bus on.
- On Grace's screen the map shows the bus jump to each stop, and each child's card changes
  (Not started → On the bus → At school).
- To show it again: **Start today again**.

## 6. More tests

**Afternoon trip + safety alert (Bus 3, Jean Paul).** First tap **Stop** on Bus 3 (it drives by
itself), then **School**. Attendant Josiane: **Afternoon** → **Start afternoon trip** → **On ✓**
for Umutoni and Wendy, **Not here** for Victor. Jean Paul gets "⚠️ Victor did not get on Bus 3"
and the school admin gets an urgent alert under **Safety alerts**. Then tap **3 Kacyiru** and
**Off here ↓** for Umutoni → "🏠 Umutoni got off at Kacyiru stop".

**Parent says the child won't take the bus.** As Aline, under "Kevine won't take the bus?":

- **Skip one bus trip** (to school or home), **I'll collect from school** (no bus home) or
  **Not coming to school** (no bus all day). Aline gets "📝 Noted: …"; when the Bus 2 attendant
  starts the trip, Kevine is already marked as not riding.
- Tap the **✕** next to the notice to cancel it → "↩️ Kevine takes the bus again".
- Rules: once the child is **on the bus**, that trip can't be changed (the app says so and
  asks to call the school). A trip already done can't be changed either. A child marked
  "missed the bus" can still be marked as skipping (it then counts as excused).

**Message to all parents of a bus.** Attendant: **megaphone button** → Traffic → Send. Every
parent of that bus gets it.

**School side (admin).**

1. **Overview** — the three buses, today's numbers, the demo controls.
2. **Live map** — where every bus is now.
3. **Today's trips** — who is on board, who got off, who is missing, per bus.
4. **Students** — the children, their class, bus and stop; open one to change the bus or stop.
5. **Parents** — **Add a parent**, choose their children, give them their 6-digit code.
6. **Attendance reports** — who rode and who did not, per day or month (Excel / PDF).

**A brand-new parent.** Admin → Parents → **Add a parent** (phone like `0788 555 111`, tick a
child). Note the code. On `/parent` → **First time here?** → phone + code + a new password.

## 7. If something does not work

| Problem                                     | What to do                                                                                              |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| No notification on the phone                | Open the app, check the card is green, tap **Send a test**. iPhone: must be opened from the Home Screen |
| A screen (Settings, a pop-up) won't close   | Tap the round **✕** at the top, **Done**, or the phone's Back. (Fixed: the map used to cover them)      |
| Card says "Notifications are blocked"       | Allow notifications for the site in the phone's settings, then reopen the app                           |
| "Start trip" shows an already finished trip | Tap **Start today again** in the demo box                                                               |
| Children marked "missed the bus" too early  | The bus left their stop before you ticked them. Start today again and tick first                        |
| Everything looks wrong / data is messy      | Run `npm run demo:seed` in this folder (10 seconds, same logins)                                        |

What the demo cannot do: it has no real GPS tracker. Positions come from the demo buttons and
a small simulator. Everything else — check-in, alerts, reports, parent app — is the real system.
