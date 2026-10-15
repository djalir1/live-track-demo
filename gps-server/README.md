# Live Track GPS server: developer setup

Connects hardware 4G GPS trackers (GT06 / GT07L / GT08L, sold as "GPSPOS") to
Live Track. A tracker counts as a **driver's phone**: it shows on `/dashboard`,
parents see it on `/me`, stop alerts fire, and `/history` has its route, km and
speed. No frontend changes are needed per bus.

```
tracker ──4G/TCP (GT06 binary)──▶ gps-server ──REST (service role)──▶ Supabase ──Realtime──▶ dashboard / parents
```

## Why a separate server?

A tracker cannot be "called". It **dials out** to a server IP and port that you set
by SMS and streams binary GT06 packets over raw TCP. Supabase, Netlify and Vercel only
accept HTTP, so this small Node process sits in between.

## How it maps data

| Tracker | Live Track |
|---|---|
| IMEI (login packet) | `buses.gps_imei` |
| bus's driver | `buses.driver_user_id` (auto-created if empty, see below) |
| position, speed, heading | upsert `device_status` + insert `location_history` (fires the geofence trigger) |
| ignition (ACC) on / off | opens / closes `trip_sessions`, `is_tracking` |
| km | `device_status.total_distance_m`, reset at each trip start, survives restarts |
| backup battery level | `battery_level` |

**Tracker drivers.** If a bus has an IMEI but no driver, the first time the tracker
connects the server creates an auth user `gps-<imei>@livetrack.app` (random password,
nobody logs in). Its name is `buses.gps_driver_name`, or `"<bus label> (GPS)"`. It
then sets `buses.driver_user_id`. Admins set the IMEI and driver name in
**Dashboard → Vehicles**.

## Files

| Path | What |
|---|---|
| `src/gt06.js` | GT06 framing, CRC-16/X-25, decoder for login, location (0x12/0x22/0xA0), heartbeat and alarm, replies (ACKs), plus test encoders |
| `src/store.js` | IMEI→bus lookup (60 s cache), tracker-driver creation, Supabase writes |
| `src/server.js` | TCP listener and a `/` health endpoint (JSON of connected devices) |
| `fake-tracker.js` | Simulated GT06 tracker driving through Kigali |
| `test/gt06.test.js` | Decoder tests (`npm test`) |
| `../supabase/migrations/20261013120000_bus_gps_imei.sql` | `buses.gps_imei`, `buses.gps_driver_name` |

Zero npm dependencies. Needs Node ≥ 20.6 (`--env-file`).

## Run locally

```bash
cd gps-server
cp .env.example .env            # set SUPABASE_SERVICE_ROLE_KEY (Supabase → Settings → API)
npm test                        # decoder tests
npm run dry                     # no DB writes, prints what it would write
npm start                       # real mode
node fake-tracker.js 127.0.0.1 25565 123456789012345   # unknown IMEI = no DB writes
```

`.env` variables: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GPS_TCP_PORT` (default
5023, the test setup uses 25565), `HTTP_PORT` (health, default 8080), `LOG_RAW=1` (hex
dump of every packet, useful for a new tracker model).

**Never** put the service-role key in the web app or commit `.env`.

## Expose it to the internet

The tracker needs a public `host:port` that reaches `GPS_TCP_PORT`.

### For a test: pinggy (free, 60 min, no install)

Windows PowerShell, using the ssh that ships with Git for Windows:

```powershell
& "C:\Program Files\Git\usr\bin\ssh.exe" -p 443 -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30 -R0:localhost:25565 tcp@free.pinggy.io
```

It prints `tcp://<name>.run.pinggy-free.link:<port>`. Resolve the name to an IP
(`Resolve-DnsName <name>`) and SMS the tracker `SERVER,0,<ip>,<port>,0#`. The
address changes every session.

What we tried that does **not** work: playit.gg free (plain TCP is paid, and free
"Minecraft" tunnels route by the Minecraft handshake, which trackers don't send),
bore (Windows Defender quarantines it), and Oracle Cloud free (card declined).

### Production (current): Strettch Cloud, Kigali

- Server: Strettch Cloud **Kigali-1**, 1 vCPU / 512 MB / 10 GB, Ubuntu 24.04, public IP
  **102.202.208.186**. Costs 3,999 + 1,000 RWF (public IP) per month, paid by MoMo top-up.
- Trackers report to `102.202.208.186:5023`, set by SMS `SERVER,0,102.202.208.186,5023,0#`.
- Layout: code in `/opt/gps-server` (user `gps`), secrets in `/opt/gps-server/.env` (mode 600),
  Node 22 in `/opt/node-v22.13.0-linux-x64`, 1 GB swap, systemd unit `gps.service`
  (auto-restart, starts on boot). Health is `curl 127.0.0.1:8080`, run on the server (local only).
- SSH: `ssh -i ~/.ssh/livetrack_gps root@102.202.208.186`. Key auth only; the public key
  was added when the compute was created.
- Logs: `journalctl -u gps -f`. Restart: `systemctl restart gps`.
- Deploy a new version from `gps-server/` on a dev machine:
  ```bash
  tar -cf - package.json src fake-tracker.js test README.md | ssh -i ~/.ssh/livetrack_gps root@102.202.208.186 'tar -xf - -C /opt/gps-server && chown -R gps:gps /opt/gps-server && systemctl restart gps'
  ```
  Restarting drops tracker connections for a few seconds. They reconnect by themselves.

### Production (any other VPS, ~$4–5/month)

Any Linux VPS with a public IP works (Hetzner CX22, Contabo, DigitalOcean, Railway
with a TCP proxy). On Ubuntu:

```bash
sudo ufw allow 5023/tcp
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs git
git clone <repo> && cd live-track-main/gps-server && cp .env.example .env && nano .env
```

Keep it running with `/etc/systemd/system/gps.service`:

```ini
[Unit]
Description=Live Track GPS server
After=network-online.target

[Service]
WorkingDirectory=/root/live-track-main/gps-server
ExecStart=/usr/bin/node --env-file=.env src/server.js
Restart=always

[Install]
WantedBy=multi-user.target
```

Then run `sudo systemctl enable --now gps && journalctl -u gps -f`. SMS every tracker
`SERVER,0,<vps ip>,5023,0#` once. That's permanent.

## Trip alerts (phone notifications to owners)

When a vehicle starts a trip (engine on) or finishes one (parked, engine off for 90 s),
every admin, plus the school_admins of that bus's school, gets a phone notification:
"🚌 Bus A (RAB 123A) started the morning pickup · Route: Kimironko – Remera · Driver: Eloge".
Owners turn it on per phone and choose which alerts they want in **Fleet setup → Alerts**.

```
device_status.is_tracking flips ─trigger─▶ fleet_events ─(this server polls every 4 s)─▶ web push ─▶ phones
```

Setup, once:

1. Run `supabase/migrations/20261015120000_trip_notifications.sql` in the Supabase SQL editor.
2. Put `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` in `.env` (new keys: `npm run vapid`;
   the public key must equal `VAPID_PUBLIC_KEY` in `src/lib/push.ts` of the web app).
3. Restart. The log shows `🔔 trip alerts on`, then one `🔔 trip_started #12 → 2/2 device(s)` line per alert.

Phone apps need no tracker: their Start / Stop sends the same alerts. Alerts older than
20 min (server was down) are skipped, not sent late. iPhone needs iOS 16.4+ and the app
added to the Home Screen.

## Tamper alerts (GPS unplugged or removed)

Needs `supabase/migrations/20261016090000_gps_tamper_alerts.sql`. Same phones and settings as
trip alerts (**Alerts → GPS tracker unplugged or removed**).

| Signal from the tracker | Alert | Dashboard |
|---|---|---|
| Alarm packet: power cut (0x02), removed (0x13), switching off (0x11), SIM changed (0x10) | ⚠️ at once | red **Unplugged** |
| "On vehicle power" bit off in 3 heartbeats in a row (units that send no alarm) | ⚠️ | red **Unplugged** |
| No report for 30 min (backup battery dead, foil, SIM removed) | 📵 | red **Silent** |
| Power back (3 heartbeats) or reporting again | ✅ | label cleared |

The tracker's small backup battery keeps it talking for a while after it's unplugged, so it can
report the cut. Test: pull the tracker's power plug for 2 minutes. The log shows
`🔔 alarm 0x2 …` or `💓 heartbeat … power=battery`, then `🚨`. If neither appears, turn the
alarm on by SMS (`POWERALM,ON,0#` on most GT06 units; some need the password, e.g.
`POWERALM,666666,ON,0#`).

## Tracker SMS reference

Send these to the SIM number inside the tracker. Some units need a password, e.g.
`SERVER,666666,0,...#`.

| SMS | Effect |
|---|---|
| `PARAM#` / `GPRSSET#` | show settings / APN and server (save before changing!) |
| `APN,internet.mtn#` | MTN Rwanda data |
| `SERVER,0,<ip>,<port>,0#` | report to our server (`1` = domain instead of IP) |
| `TIMER,10,300#` | every 10 s moving, 300 s parked |
| `WHERE#` · `RESET#` | position by SMS · reboot |
| `SERVER,1,www.gpspos.net,6006,0#` | back to the seller's platform (original setting) |

## Reading the log

```
✅ login IMEI 865893082910557        tracker connected
📍 Test Car -1.906,30.131 32 km/h acc=on → moving
💓 heartbeat … acc=off               alive, ignition off
🟢 / 🔴 trip started / ended
👤 created tracker driver "Eloge"
⚠️ unknown IMEI …                    IMEI not set on any bus
```

## Notes

- Ignition off: the tracker reports only every `TIMER` parked interval (default
  1000 s), so the bus shows Idle and may age into Offline on the dashboard.
- A driver of a tracker bus should not also press Start on `/track`.
- Device clocks that drift more than 10 min from server time are replaced by
  receive time.
