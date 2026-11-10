# Live Track demo — logins and test guide

Use this to show Live Track to a school, or to check that everything works.
Everything here is fictional and is rebuilt every night at 01:00 (Kigali time).

## 1. Logins (password for all: `demo1234`)

| Who                                   | Go to     | Login                       |
| ------------------------------------- | --------- | --------------------------- |
| School admin — Mrs. Claudine Mutesi   | `/admin`  | `school@demo.livetrack.app` |
| Platform admin (sees every school)    | `/admin`  | `admin@demo.livetrack.app`  |
| Bus attendant — Bus 1 (Alice)         | `/auth`   | `0788 100 001`              |
| Bus attendant — Bus 2 (Diane)         | `/auth`   | `0788 100 002`              |
| Bus attendant — Bus 3 (Josiane)       | `/auth`   | `0788 100 003`              |
| Parent — Grace Uwase (2 children)     | `/parent` | `0788 200 001`              |
| Parent — Eric Mugisha (1 child)       | `/parent` | `0788 200 002`              |
| Parent — Aline Ishimwe (2 children)   | `/parent` | `0788 200 003`              |
| Parent — Jean Paul Nkurunziza (3 ch.) | `/parent` | `0788 200 004`              |

`/admin` sends you to the sign-in page and back to the dashboard once you are in.

## 2. What is in the demo

**Sunrise Academy (Demo)** has 3 buses on real Kigali roads. Each bus drives its route and back
all day, pausing 20 s at every stop, so it moves on the map like a real GPS tracker.

| Bus               | Route                                                  | Attendant         | Parents with the app                                                           |
| ----------------- | ------------------------------------------------------ | ----------------- | ------------------------------------------------------------------------------ |
| Bus 1 · RAD 101 A | Kimironko Market → Kibagabaga → Kagugu → school        | Alice Mukeshimana | **Grace**: Amina Uwase (P1), Brian Mugisha (P2) · **Eric**: Chloe Ishimwe (P3) |
| Bus 2 · RAD 102 B | Kicukiro Centre → Sonatubes → Remera Giporoso → school | Diane Uwamahoro   | **Aline**: Kevine Uwase (P5), Liam Mugisha (P6)                                |
| Bus 3 · RAD 103 C | Nyamirambo Stadium → Kiyovu → Kacyiru → school         | Josiane Ingabire  | **Jean Paul**: Umutoni Uwase (P3), Victor Mugisha (P4), Wendy Ishimwe (P5)     |

Also included:

- 30 students (10 per bus) and 2 weeks of past trips, attendance and class registers. This is
  what fills the reports.
- 22 other parents who were registered by the school but have not activated the app yet.
- One open safety alert, two announcements, and a few old notifications in Grace's feed.

## 3. Test scripts

Tip: use **two screens**, for example the attendant on your phone and the parent in a
private/incognito window on your laptop. Each one needs its own browser session.

### A. School admin tour (2 min)

1. `/admin` → `school@demo.livetrack.app` / `demo1234`.
2. **Overview**: 3 buses, today's numbers, latest check-ins.
3. **Live map**: 3 buses moving across Kigali. Click one to see its speed, address and plate.
4. **Students & parents → Students**: 30 children with class, bus, stop and parent.
5. **Safety alerts**: the open "was not at the stop" alert. Resolve it.
6. **Reports → Attendance reports / Class register / Trip history**: 2 weeks of data, with
   Excel/PDF export.

### B. Morning trip — parent gets live notifications

1. Screen 1: `/auth` → `0788 100 001` (attendant Bus 1). Screen 2: `/parent` → `0788 200 001` (Grace).
2. Attendant: choose **Morning** → **Start morning trip**.
   → Grace sees **"🚌 Bus 1 has started the morning pickup"**.
3. Attendant: tap **On ✓** next to _Amina Uwase_.
   → Grace sees **"✅ Amina Uwase boarded Bus 1 at Kimironko Market stop"**.
4. Attendant: tap **Not here** next to _Brian Mugisha_.
   → Grace sees **"⚠️ Brian Mugisha was not at the stop"**.
5. Attendant: tap **Off at school ↓** for Amina.
   → Grace sees **"🏫 Amina Uwase arrived at school"**.
6. Attendant: **End trip** → tick "I walked through the bus" → **End trip**.
   The app refuses to end the trip while a child is still marked on board.

### C. Afternoon trip — safety alert to the school

1. Attendant Bus 3 (`0788 100 003`), parent Jean Paul (`0788 200 004`), and the school admin on
   **Safety alerts** in a third window.
2. Attendant: **Afternoon** → **Start afternoon trip**.
3. Tap **On ✓** for _Umutoni_ and _Wendy_, and **Not here** for _Victor_.
   → Jean Paul sees **"⚠️ Victor Mugisha did not get on Bus 3"**.
   → The school gets an **urgent** alert: "Victor Mugisha was not on Bus 3 when it left school."
4. Tap **Off here ↓** for Umutoni.
   → Jean Paul sees **"🏠 Umutoni Uwase got off at Kacyiru stop"**.

### D. Parent says "not riding today"

1. Parent Aline (`0788 200 003`) → open _Kevine_ → **Not riding the bus** (or **Absent**).
2. Attendant Bus 2 (`0788 100 002`) → start the next trip: Kevine is already marked as not
   riding, so nobody waits for her.

### E. Announcement to all parents on a bus

1. Attendant Bus 1 → **Tell every parent on this bus** → _Traffic_ (15 min) → **Send**.
   → Grace and Eric receive it.

## 4. About notifications

- **In the app: yes, live.** When a parent has Live Track open (on a phone or computer), each
  message pops up within a second or two and is saved in the notifications list. You can test
  this fully in the demo.
- **On a locked phone (push): no, not in the demo.** Push notifications are sent by the GPS
  server, and the demo does not run one. In the real system, parents who allow notifications
  get them on the lock screen.
- **Known quirk:** "Bus X has started" arrives once **per child**. Jean Paul (3 children on
  Bus 3) gets it 3 times.

## 5. Starting over

- Each bus has **one morning and one afternoon trip per day**. Once a trip has been ended, it
  shows as finished until the next day.
- After a rebuild in the evening, today's morning trips already count as done, so use
  **Afternoon** for live tests that day. The next morning, both runs are free.
- To reset everything right away, run `npm run demo:seed` in this folder. It takes about
  10 seconds, and the logins stay the same.
