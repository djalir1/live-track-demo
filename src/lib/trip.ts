// Utilities for turning raw location_history points into a trip summary
// (total distance, moving time, stops with duration/address).

export interface RawPoint {
  latitude: number;
  longitude: number;
  speed_kmh: number | null;
  battery_level: number | null;
  recorded_at: string;
}

export interface Stop {
  lat: number;
  lon: number;
  startedAt: string;
  endedAt: string;
  durationMinutes: number;
}

export interface SignalGap {
  from: string;
  to: string;
  durationMinutes: number;
  jumpedKm: number;
}

export interface TripSessionRow {
  started_at: string;
  ended_at: string | null;
}

export interface TripSummary {
  points: RawPoint[];
  totalDistanceKm: number;
  totalMovingMinutes: number;
  totalStoppedMinutes: number;
  topSpeedKmh: number;
  averageMovingSpeedKmh: number;
  stops: Stop[];
  gaps: SignalGap[];
  // Prefer trip_sessions Start/Stop; fall back to first/last GPS fix labelled approx.
  startedAt: string | null;
  endedAt: string | null;
  startedAtApprox: boolean;
  endedAtApprox: boolean;
  // Legacy: first/last GPS fix, still exposed for the map camera.
  firstAt: string | null;
  lastAt: string | null;
}

const R_M = 6371000;
function toRad(x: number) {
  return (x * Math.PI) / 180;
}
export function haversineMeters(a: [number, number], b: [number, number]) {
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]);
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R_M * Math.asin(Math.sqrt(h));
}

// Two consecutive points are considered "moving" when the driver covered
// more than this many metres between them. Below that they're a stop cluster.
const MOVE_THRESHOLD_M = 15;
// Minimum stop cluster duration to count as a real stop (seconds).
const STOP_MIN_SECONDS = 60;
// A pair of points whose interval exceeds this is treated as signal-lost.
// (Driver tracker uploads roughly every 8s, so 3 min is >20x normal cadence.)
const GAP_MAX_SECONDS = 180;
// A pair whose implied speed exceeds this is also signal-lost — a real car
// cannot teleport at 150 km/h through a GPS point cluster.
const MAX_PLAUSIBLE_KMH = 150;
// Below this implied speed, dt is accounted as stopped rather than driving.
const MOVING_KMH = 0.8;
// Two consecutive stops within this radius and separated by less than this
// gap are treated as one — prevents "creep" (a stopped bus edging forward a
// few metres for traffic) from spawning duplicate rows on the report.
const STOP_MERGE_RADIUS_M = 80;
const STOP_MERGE_GAP_MS = 4 * 60_000;

export function buildTripSummary(points: RawPoint[], sessions: TripSessionRow[] = []): TripSummary {
  const firstAt = points[0]?.recorded_at ?? null;
  const lastAt = points[points.length - 1]?.recorded_at ?? null;

  const sessionStart = sessions.reduce<string | null>(
    (acc, s) => (acc == null || s.started_at < acc ? s.started_at : acc),
    null,
  );
  const sessionEnd = sessions.reduce<string | null>(
    (acc, s) => (s.ended_at != null && (acc == null || s.ended_at > acc) ? s.ended_at : acc),
    null,
  );
  const startedAt = sessionStart ?? firstAt;
  const endedAt = sessionEnd ?? lastAt;

  const empty: TripSummary = {
    points,
    totalDistanceKm: 0,
    totalMovingMinutes: 0,
    totalStoppedMinutes: 0,
    topSpeedKmh: 0,
    averageMovingSpeedKmh: 0,
    stops: [],
    gaps: [],
    startedAt,
    endedAt,
    startedAtApprox: sessionStart == null,
    endedAtApprox: sessionEnd == null,
    firstAt,
    lastAt,
  };
  if (points.length < 2) return empty;

  let totalMeters = 0;
  let movingMs = 0;
  let stoppedMs = 0;
  let topSpeed = 0;
  const stops: Stop[] = [];
  const gaps: SignalGap[] = [];

  let clusterStart = 0; // index of the first point in a potential stop cluster
  const closeCluster = (endIdx: number) => {
    const start = points[clusterStart];
    const end = points[endIdx];
    const durMs = new Date(end.recorded_at).getTime() - new Date(start.recorded_at).getTime();
    if (durMs / 1000 >= STOP_MIN_SECONDS) {
      let sumLat = 0,
        sumLon = 0,
        n = 0;
      for (let i = clusterStart; i <= endIdx; i++) {
        sumLat += points[i].latitude;
        sumLon += points[i].longitude;
        n++;
      }
      stops.push({
        lat: sumLat / n,
        lon: sumLon / n,
        startedAt: start.recorded_at,
        endedAt: end.recorded_at,
        durationMinutes: Math.round(durMs / 60000),
      });
    }
  };

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const d = haversineMeters([prev.latitude, prev.longitude], [cur.latitude, cur.longitude]);
    const dtMs = new Date(cur.recorded_at).getTime() - new Date(prev.recorded_at).getTime();
    const dtSec = dtMs / 1000;

    // Reported/implied speed for the pair. Implied wins when there IS motion
    // (reported speed can be 0 even between moving fixes on some devices).
    const impliedKmh = dtSec > 0 ? (d / dtSec) * 3.6 : 0;
    const reportedKmh = cur.speed_kmh ?? 0;
    const pairKmh = Math.max(reportedKmh, impliedKmh);

    // ── Signal lost: drop the pair from every accumulator, close any cluster,
    // record a segment for the report, then continue past the gap.
    if (dtSec > GAP_MAX_SECONDS || impliedKmh > MAX_PLAUSIBLE_KMH) {
      if (i - 1 > clusterStart) closeCluster(i - 1);
      gaps.push({
        from: prev.recorded_at,
        to: cur.recorded_at,
        durationMinutes: Math.round(dtMs / 60000),
        jumpedKm: d / 1000,
      });
      clusterStart = i; // reset cluster origin AFTER the gap
      continue;
    }

    // Normal pair.
    if (reportedKmh > topSpeed) topSpeed = reportedKmh;

    // Distance: sum haversine but keep the min-delta GPS-noise filter.
    if (d >= MOVE_THRESHOLD_M) totalMeters += d;

    // Time bucket: driving vs stopped strictly by pair speed.
    if (pairKmh > MOVING_KMH) movingMs += dtMs;
    else stoppedMs += dtMs;

    // Stop clustering (used only for the stops list — timing already handled).
    if (d >= MOVE_THRESHOLD_M) {
      if (i - 1 > clusterStart) closeCluster(i - 1);
      clusterStart = i;
    }
  }
  if (points.length - 1 > clusterStart) closeCluster(points.length - 1);

  const mergedStops = mergeCloseStops(stops);

  const totalDistanceKm = totalMeters / 1000;
  const totalMovingMinutes = movingMs / 60000;
  const totalStoppedMinutes = stoppedMs / 60000;
  const averageMovingSpeedKmh =
    totalMovingMinutes > 0 ? totalDistanceKm / (totalMovingMinutes / 60) : 0;

  return {
    points,
    totalDistanceKm,
    totalMovingMinutes,
    totalStoppedMinutes,
    topSpeedKmh: topSpeed,
    averageMovingSpeedKmh,
    stops: mergedStops,
    gaps,
    startedAt,
    endedAt,
    startedAtApprox: sessionStart == null,
    endedAtApprox: sessionEnd == null,
    firstAt,
    lastAt,
  };
}

/**
 * Merge consecutive stops that are close enough in space and time to actually
 * be the same real-world stop (bus creeping forward at a light, GPS jitter,
 * driver nudging into a parking spot). Without this, one physical stop can
 * splinter into 3–4 near-identical rows in the report.
 */
export function mergeCloseStops(stops: Stop[]): Stop[] {
  if (stops.length < 2) return stops;
  const out: Stop[] = [];
  for (const s of stops) {
    const last = out[out.length - 1];
    if (last) {
      const dist = haversineMeters([last.lat, last.lon], [s.lat, s.lon]);
      const gap = new Date(s.startedAt).getTime() - new Date(last.endedAt).getTime();
      if (dist <= STOP_MERGE_RADIUS_M && gap <= STOP_MERGE_GAP_MS) {
        const totalMs = new Date(s.endedAt).getTime() - new Date(last.startedAt).getTime();
        out[out.length - 1] = {
          lat: (last.lat + s.lat) / 2,
          lon: (last.lon + s.lon) / 2,
          startedAt: last.startedAt,
          endedAt: s.endedAt,
          durationMinutes: Math.round(totalMs / 60000),
        };
        continue;
      }
    }
    out.push(s);
  }
  return out;
}

/**
 * Pick sparse waypoints along a trip so we can reverse-geocode them without
 * bulk-hammering Nominatim. Emits a point whenever the last-emitted was at
 * least `minKm` km away, OR at least `minMinutes` minutes earlier, OR the
 * heading has turned by at least `headingChangeDeg` degrees. Skips the first
 * and last point (those are captured separately as Start / End) and points
 * that would fall inside a signal-lost pair. Hard-caps the result at `maxCount`.
 */
export interface WaypointOpts {
  minKm?: number;
  minMinutes?: number;
  headingChangeDeg?: number;
  maxCount?: number;
}
export function selectWaypoints(points: RawPoint[], opts: WaypointOpts = {}): RawPoint[] {
  const minKm = opts.minKm ?? 2;
  const minMinutes = opts.minMinutes ?? 5;
  const headingChangeDeg = opts.headingChangeDeg ?? 45;
  const maxCount = opts.maxCount ?? 30;
  if (points.length < 3) return [];

  const bearing = (a: RawPoint, b: RawPoint) => {
    const y = Math.sin(toRad(b.longitude - a.longitude)) * Math.cos(toRad(b.latitude));
    const x =
      Math.cos(toRad(a.latitude)) * Math.sin(toRad(b.latitude)) -
      Math.sin(toRad(a.latitude)) *
        Math.cos(toRad(b.latitude)) *
        Math.cos(toRad(b.longitude - a.longitude));
    return (Math.atan2(y, x) * 180) / Math.PI;
  };

  const picked: RawPoint[] = [];
  let lastEmit = points[0];
  let lastBearing: number | null = null;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    const dt =
      (new Date(p.recorded_at).getTime() - new Date(lastEmit.recorded_at).getTime()) / 1000;
    // Skip pairs that cross a signal-lost boundary — those are already reported
    // as gaps, so we don't want a waypoint that pretends the drive was continuous.
    if (dt > 180) {
      lastEmit = p;
      lastBearing = null;
      continue;
    }

    const km =
      haversineMeters([lastEmit.latitude, lastEmit.longitude], [p.latitude, p.longitude]) / 1000;
    const mins = dt / 60;
    const brg = bearing(lastEmit, p);
    let bearingTurn = 0;
    if (lastBearing != null) {
      const diff = Math.abs(((brg - lastBearing + 540) % 360) - 180);
      bearingTurn = diff;
    }
    if (km >= minKm || mins >= minMinutes || bearingTurn >= headingChangeDeg) {
      picked.push(p);
      lastEmit = p;
      lastBearing = brg;
      if (picked.length >= maxCount) break;
    }
  }
  // Down-sample if we somehow overshot the cap (defensive; break above should hold).
  if (picked.length <= maxCount) return picked;
  const stride = Math.ceil(picked.length / maxCount);
  return picked.filter((_, i) => i % stride === 0);
}

export function formatDurationMinutes(mins: number): string {
  if (mins < 1) return "<1 min";
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  if (h === 0) return `${m} min`;
  return `${h}h ${m}m`;
}
