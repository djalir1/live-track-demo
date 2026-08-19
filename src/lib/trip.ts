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

export interface TripSummary {
  points: RawPoint[];
  totalDistanceKm: number;
  totalMovingMinutes: number;
  totalStoppedMinutes: number;
  topSpeedKmh: number;
  averageMovingSpeedKmh: number;
  stops: Stop[];
  firstAt: string | null;
  lastAt: string | null;
}

const R_M = 6371000;
function toRad(x: number) { return (x * Math.PI) / 180; }
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

export function buildTripSummary(points: RawPoint[]): TripSummary {
  const empty: TripSummary = {
    points,
    totalDistanceKm: 0,
    totalMovingMinutes: 0,
    totalStoppedMinutes: 0,
    topSpeedKmh: 0,
    averageMovingSpeedKmh: 0,
    stops: [],
    firstAt: points[0]?.recorded_at ?? null,
    lastAt: points[points.length - 1]?.recorded_at ?? null,
  };
  if (points.length < 2) return empty;

  let totalMeters = 0;
  let movingMs = 0;
  let stoppedMs = 0;
  let topSpeed = 0;
  const stops: Stop[] = [];

  let clusterStart = 0; // index of the first point in a potential stop cluster
  const closeCluster = (endIdx: number) => {
    const start = points[clusterStart];
    const end = points[endIdx];
    const durMs = new Date(end.recorded_at).getTime() - new Date(start.recorded_at).getTime();
    if (durMs / 1000 >= STOP_MIN_SECONDS) {
      // Centroid of the cluster
      let sumLat = 0, sumLon = 0, n = 0;
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
      stoppedMs += durMs;
    }
  };

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const d = haversineMeters([prev.latitude, prev.longitude], [cur.latitude, cur.longitude]);
    const dtMs = new Date(cur.recorded_at).getTime() - new Date(prev.recorded_at).getTime();
    totalMeters += d;

    const speed = cur.speed_kmh ?? 0;
    if (speed > topSpeed) topSpeed = speed;

    if (d >= MOVE_THRESHOLD_M) {
      // Movement — if we were in a stop cluster, close it.
      if (i - 1 > clusterStart) closeCluster(i - 1);
      clusterStart = i;
      movingMs += dtMs;
    }
    // else: still in the cluster, keep going
  }
  // Close a trailing cluster
  if (points.length - 1 > clusterStart) closeCluster(points.length - 1);

  const totalDistanceKm = totalMeters / 1000;
  const totalMovingMinutes = movingMs / 60000;
  const totalStoppedMinutes = stoppedMs / 60000;
  const averageMovingSpeedKmh = totalMovingMinutes > 0 ? (totalDistanceKm / (totalMovingMinutes / 60)) : 0;

  return {
    points,
    totalDistanceKm,
    totalMovingMinutes,
    totalStoppedMinutes,
    topSpeedKmh: topSpeed,
    averageMovingSpeedKmh,
    stops,
    firstAt: points[0].recorded_at,
    lastAt: points[points.length - 1].recorded_at,
  };
}

export function formatDurationMinutes(mins: number): string {
  if (mins < 1) return "<1 min";
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  if (h === 0) return `${m} min`;
  return `${h}h ${m}m`;
}
