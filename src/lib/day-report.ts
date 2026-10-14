// Turns one vehicle's day of GPS points into what a fleet owner needs to know:
// its trips (engine/tracking on → off), where and how long it stopped during
// each trip, where it was parked in between, and honest day totals.
//
// Pure functions (no DOM, no Supabase) — exercised by scripts/test-day-report.ts.
//
// Rules, and why:
//  • Trips come from trip_sessions (ignition on/off for hardware trackers,
//    Start/Stop for the phone app). Without sessions, trips are inferred from
//    movement. Sessions a few minutes apart are one trip (ignition flicker,
//    a quick restart at a stop).
//  • A parked tracker reports every 5 min. That is normal, NOT lost signal.
//    Only gaps inside a trip count, and only when the vehicle moved meanwhile.
//  • Distance follows an anchor: a new leg is counted once the vehicle is ≥ 15 m
//    from the last counted position. That removes parked GPS jitter without
//    losing slow crawling in traffic (fixes every 10 s at 5 km/h are 14 m apart).
//  • Across a lost-signal gap the straight-line distance is added and flagged
//    as estimated (the road distance is at least that).

export interface RawPoint {
  latitude: number;
  longitude: number;
  speed_kmh: number | null;
  battery_level: number | null;
  recorded_at: string;
}
export interface SessionRow {
  started_at: string;
  ended_at: string | null;
}

export interface LatLon {
  lat: number;
  lon: number;
}
export interface TripStop extends LatLon {
  startedAt: string;
  endedAt: string;
  ms: number;
}
export interface SignalGap extends LatLon {
  from: string;
  to: string;
  ms: number;
  estimatedKm: number;
}
export interface Trip {
  index: number; // 1-based
  startedAt: string;
  endedAt: string;
  ongoing: boolean;
  start: LatLon | null;
  end: LatLon | null;
  points: RawPoint[];
  distanceKm: number;
  estimatedKm: number; // part of distanceKm bridged across signal gaps
  engineOnMs: number;
  drivingMs: number;
  stoppedMs: number; // engine on, not moving (traffic, pick-ups)
  topSpeedKmh: number;
  avgMovingKmh: number;
  stops: TripStop[];
  gaps: SignalGap[];
  batteryStart: number | null;
  batteryEnd: number | null;
}
export interface ParkedPeriod extends LatLon {
  from: string;
  to: string;
  ms: number;
  /** Still parked at the end of the report window. */
  ongoing: boolean;
}
export interface DayReport {
  trips: Trip[];
  parked: ParkedPeriod[];
  totals: {
    trips: number;
    distanceKm: number;
    estimatedKm: number;
    engineOnMs: number;
    drivingMs: number;
    stoppedMs: number;
    parkedMs: number;
    stops: number;
    topSpeedKmh: number;
    avgMovingKmh: number;
    gaps: number;
    gapMs: number;
    firstStart: string | null;
    lastEnd: string | null;
  };
  pointCount: number;
}

// ── Tunables ────────────────────────────────────────────────────────────────
const ANCHOR_M = 15; // min movement counted as distance (GPS jitter floor)
const MOVING_KMH = 3; // below this a pair is "stopped" (jitter reads 1–2 km/h)
const STOP_RADIUS_M = 35; // a stop is staying within this radius…
const STOP_MIN_MS = 60_000; // …for at least this long
const GAP_MS = 120_000; // no fix for 2 min while on a trip = possible signal loss
const GAP_MIN_MOVE_M = 250; // …and it counts as lost only if it moved this far meanwhile
const MAX_KMH = 160; // faster implied speed = GPS jump, discard the pair
const MERGE_SESSIONS_MS = 3 * 60_000;
const INFER_PARK_MS = 10 * 60_000; // no sessions: stationary this long ends a trip
const MIN_PARK_MS = 2 * 60_000;

const R_M = 6371000;
const toRad = (x: number) => (x * Math.PI) / 180;
export function distM(a: LatLon, b: LatLon) {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_M * Math.asin(Math.sqrt(h));
}
const ll = (p: RawPoint): LatLon => ({ lat: p.latitude, lon: p.longitude });
const t = (iso: string) => new Date(iso).getTime();
const iso = (ms: number) => new Date(ms).toISOString();

interface Window_ {
  start: number;
  end: number;
  ongoing: boolean;
}

/** Sessions → merged, clamped trip windows inside [from, to). */
function sessionWindows(sessions: SessionRow[], from: number, to: number, now: number): Window_[] {
  const ws = sessions
    .map((s) => {
      const open = s.ended_at == null;
      const end = open ? Math.min(now, to) : Math.min(t(s.ended_at!), to);
      return { start: Math.max(t(s.started_at), from), end, ongoing: open && now < to };
    })
    .filter((w) => w.end > w.start)
    .sort((a, b) => a.start - b.start);
  const out: Window_[] = [];
  for (const w of ws) {
    const last = out[out.length - 1];
    if (last && w.start - last.end <= MERGE_SESSIONS_MS) {
      last.end = Math.max(last.end, w.end);
      last.ongoing = last.ongoing || w.ongoing;
    } else out.push({ ...w });
  }
  return out;
}

/** No sessions (old data, or a phone that never pressed Start): infer from movement. */
function inferredWindows(points: RawPoint[], now: number, to: number): Window_[] {
  const out: Window_[] = [];
  let cur: Window_ | null = null;
  let anchor: RawPoint | null = null;
  let lastMoveAt = 0;
  for (const p of points) {
    if (!anchor) {
      anchor = p;
      continue;
    }
    const moved = distM(ll(anchor), ll(p)) >= ANCHOR_M * 2 || (p.speed_kmh ?? 0) > 8;
    const pt = t(p.recorded_at);
    if (moved) {
      if (!cur) cur = { start: t(anchor.recorded_at), end: pt, ongoing: false };
      cur.end = pt;
      lastMoveAt = pt;
      anchor = p;
    } else if (cur && pt - lastMoveAt > INFER_PARK_MS) {
      out.push(cur);
      cur = null;
      anchor = p;
    }
  }
  if (cur) {
    cur.ongoing = now - lastMoveAt < INFER_PARK_MS && now < to;
    out.push(cur);
  }
  return out;
}

function buildTrip(index: number, w: Window_, points: RawPoint[]): Trip {
  const pts = points.filter((p) => {
    const pt = t(p.recorded_at);
    return pt >= w.start && pt <= w.end;
  });
  const trip: Trip = {
    index,
    startedAt: iso(w.start),
    endedAt: iso(w.end),
    ongoing: w.ongoing,
    start: pts[0] ? ll(pts[0]) : null,
    end: pts.length ? ll(pts[pts.length - 1]) : null,
    points: pts,
    distanceKm: 0,
    estimatedKm: 0,
    engineOnMs: w.end - w.start,
    drivingMs: 0,
    stoppedMs: 0,
    topSpeedKmh: 0,
    avgMovingKmh: 0,
    stops: [],
    gaps: [],
    batteryStart: pts.find((p) => p.battery_level != null)?.battery_level ?? null,
    batteryEnd: [...pts].reverse().find((p) => p.battery_level != null)?.battery_level ?? null,
  };
  if (pts.length === 0) {
    trip.stoppedMs = trip.engineOnMs;
    return trip;
  }

  let meters = 0;
  let estMeters = 0;
  let anchor = pts[0];
  // Stop detection: the vehicle staying within STOP_RADIUS_M of `stopOrigin`.
  let stopOrigin = pts[0];
  let stopFirst = pts[0];
  let stopLast = pts[0];
  const closeStop = () => {
    const ms = t(stopLast.recorded_at) - t(stopFirst.recorded_at);
    if (ms >= STOP_MIN_MS) {
      trip.stops.push({
        ...ll(stopOrigin),
        startedAt: stopFirst.recorded_at,
        endedAt: stopLast.recorded_at,
        ms,
      });
    }
  };

  // Time before the first fix / after the last fix of the window counts as stopped.
  trip.stoppedMs += Math.max(0, t(pts[0].recorded_at) - w.start);

  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const dt = t(b.recorded_at) - t(a.recorded_at);
    if (dt <= 0) continue;
    const d = distM(ll(a), ll(b));
    const implied = (d / (dt / 1000)) * 3.6;
    if (implied > MAX_KMH) continue; // GPS jump: ignore this pair entirely

    if (dt > GAP_MS && d >= GAP_MIN_MOVE_M) {
      // Lost signal while driving: bridge with the straight line, flag it.
      trip.gaps.push({
        ...ll(a),
        from: a.recorded_at,
        to: b.recorded_at,
        ms: dt,
        estimatedKm: d / 1000,
      });
      estMeters += d;
      meters += d;
      trip.drivingMs += dt;
      anchor = b;
      closeStop();
      stopOrigin = stopFirst = stopLast = b;
      continue;
    }

    const reported = b.speed_kmh ?? 0;
    if (reported <= MAX_KMH) trip.topSpeedKmh = Math.max(trip.topSpeedKmh, reported);
    if (Math.max(reported, implied) > MOVING_KMH) trip.drivingMs += dt;
    else trip.stoppedMs += dt;

    const fromAnchor = distM(ll(anchor), ll(b));
    if (fromAnchor >= ANCHOR_M) {
      meters += fromAnchor;
      anchor = b;
    }

    if (distM(ll(stopOrigin), ll(b)) <= STOP_RADIUS_M) {
      stopLast = b;
    } else {
      closeStop();
      stopOrigin = stopFirst = stopLast = b;
    }
  }
  // A stop still open at the end is the final parking spot, not a mid-trip stop.
  trip.stoppedMs += Math.max(0, w.end - t(pts[pts.length - 1].recorded_at));

  trip.distanceKm = meters / 1000;
  trip.estimatedKm = estMeters / 1000;
  trip.avgMovingKmh = trip.drivingMs > 0 ? trip.distanceKm / (trip.drivingMs / 3_600_000) : 0;
  return trip;
}

export interface DayReportOptions {
  /** Report window, ISO instants (e.g. a Kigali calendar day). */
  from: string;
  to: string;
  /** Server "now" — caps an ongoing trip. */
  now?: number;
  /** Last known position before the window, to place an early parked period. */
  before?: RawPoint | null;
}

export function buildDayReport(
  points: RawPoint[],
  sessions: SessionRow[],
  opts: DayReportOptions,
): DayReport {
  const from = t(opts.from);
  const to = t(opts.to);
  const now = opts.now ?? Date.now();
  const sorted = [...points].sort((a, b) => t(a.recorded_at) - t(b.recorded_at));

  const windows = sessions.length
    ? sessionWindows(sessions, from, to, now)
    : inferredWindows(sorted, now, to);
  const trips = windows.map((w, i) => buildTrip(i + 1, w, sorted));

  // Parked periods: before the first trip, between trips, after the last.
  const parked: ParkedPeriod[] = [];
  const end = Math.min(now, to);
  const lastPosBefore = (ms: number): LatLon | null => {
    let found: RawPoint | null = opts.before ?? null;
    for (const p of sorted) {
      if (t(p.recorded_at) <= ms) found = p;
      else break;
    }
    return found ? ll(found) : null;
  };
  const firstPosAfter = (ms: number): LatLon | null => {
    const p = sorted.find((x) => t(x.recorded_at) >= ms);
    return p ? ll(p) : null;
  };
  const addPark = (a: number, b: number, pos: LatLon | null, ongoing: boolean) => {
    if (b - a < MIN_PARK_MS || !pos) return;
    parked.push({ ...pos, from: iso(a), to: iso(b), ms: b - a, ongoing });
  };
  if (sorted.length || trips.length) {
    let cursor = from;
    for (const tr of trips) {
      addPark(cursor, t(tr.startedAt), tr.start ?? lastPosBefore(t(tr.startedAt)), false);
      cursor = t(tr.endedAt);
    }
    const last = trips[trips.length - 1];
    if (!last?.ongoing)
      addPark(cursor, end, last?.end ?? lastPosBefore(end) ?? firstPosAfter(from), true);
  }

  const sum = (f: (x: Trip) => number) => trips.reduce((acc, x) => acc + f(x), 0);
  const distanceKm = sum((x) => x.distanceKm);
  const drivingMs = sum((x) => x.drivingMs);
  const gaps = trips.flatMap((x) => x.gaps);
  return {
    trips,
    parked,
    totals: {
      trips: trips.length,
      distanceKm,
      estimatedKm: sum((x) => x.estimatedKm),
      engineOnMs: sum((x) => x.engineOnMs),
      drivingMs,
      stoppedMs: sum((x) => x.stoppedMs),
      parkedMs: parked.reduce((a, p) => a + p.ms, 0),
      stops: sum((x) => x.stops.length),
      topSpeedKmh: Math.max(0, ...trips.map((x) => x.topSpeedKmh)),
      avgMovingKmh: drivingMs > 0 ? distanceKm / (drivingMs / 3_600_000) : 0,
      gaps: gaps.length,
      gapMs: gaps.reduce((a, g) => a + g.ms, 0),
      firstStart: trips[0]?.startedAt ?? null,
      lastEnd: trips.length ? trips[trips.length - 1].endedAt : null,
    },
    pointCount: sorted.length,
  };
}

/** Distinct colours per trip so A→B and B→A never look like one line. */
export const TRIP_COLORS = [
  "#6366f1",
  "#f97316",
  "#10b981",
  "#ec4899",
  "#0ea5e9",
  "#eab308",
  "#8b5cf6",
  "#ef4444",
];
export const tripColor = (index: number) => TRIP_COLORS[(index - 1) % TRIP_COLORS.length];
