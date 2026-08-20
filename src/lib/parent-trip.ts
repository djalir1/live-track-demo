// Pure math for the parent live screen: progress along the route, remaining
// distance to the child's home stop, rolling speed, ETA. Extracted so
// scripts/test-parent-trip.ts can exercise it without a browser.

const R_M = 6371000;
const rad = (x: number) => (x * Math.PI) / 180;

export function haversineM(a: [number, number], b: [number, number]): number {
  const dLat = rad(b[0] - a[0]);
  const dLon = rad(b[1] - a[1]);
  const la1 = rad(a[0]); const la2 = rad(b[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R_M * Math.asin(Math.sqrt(h));
}

export interface StopPt { id: string; lat: number; lng: number; sequence: number | null; }
export interface EventLite { stop_id: string; event_type: "arrive" | "depart"; occurred_at: string; }

/** Sort stops by sequence (nulls last) for consistent ordering. */
export function orderedStops(stops: StopPt[]): StopPt[] {
  return [...stops].sort((a, b) => (a.sequence ?? 1e9) - (b.sequence ?? 1e9));
}

/**
 * Project a bus point onto the polyline formed by the stops in sequence order.
 * Returns the segment index and the fractional position within that segment,
 * plus the accumulated distance from the first stop to the projection point.
 * Uses a local flat-earth approximation via a metre-scale conversion at each
 * segment's midpoint — accurate to well within 1% at Rwanda-scale distances.
 */
export function projectOnRoute(bus: [number, number], stopsIn: StopPt[]) {
  const stops = orderedStops(stopsIn);
  if (stops.length < 2) {
    return { segIdx: 0, fraction: 0, cumulativeM: 0, bestDistM: Infinity };
  }
  let best = { segIdx: 0, fraction: 0, cumulativeM: 0, bestDistM: Infinity };
  let cum = 0;
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i], b = stops[i + 1];
    // Local metric: convert lat/lng deltas to metres at the segment midpoint.
    const midLat = (a.lat + b.lat) / 2;
    const mPerDegLat = 111_320;
    const mPerDegLng = 111_320 * Math.cos(rad(midLat));
    const ax = 0;
    const ay = 0;
    const bx = (b.lng - a.lng) * mPerDegLng;
    const by = (b.lat - a.lat) * mPerDegLat;
    const px = (bus[1] - a.lng) * mPerDegLng;
    const py = (bus[0] - a.lat) * mPerDegLat;
    const segLenSq = bx * bx + by * by;
    const segLen = Math.sqrt(segLenSq);
    let t = segLenSq > 0 ? ((px - ax) * bx + (py - ay) * by) / segLenSq : 0;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    const projX = ax + t * bx;
    const projY = ay + t * by;
    const dx = px - projX;
    const dy = py - projY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < best.bestDistM) {
      best = { segIdx: i, fraction: t, cumulativeM: cum + t * segLen, bestDistM: dist };
    }
    cum += segLen;
  }
  return best;
}

/** Total polyline length in metres. */
export function routeLengthM(stopsIn: StopPt[]): number {
  const stops = orderedStops(stopsIn);
  let sum = 0;
  for (let i = 0; i < stops.length - 1; i++) {
    sum += haversineM([stops[i].lat, stops[i].lng], [stops[i + 1].lat, stops[i + 1].lng]);
  }
  return sum;
}

/**
 * Remaining metres along the route from the bus's projection point to the
 * target stop. Returns null if the target isn't found or the bus has already
 * passed it (projection cumulative > target's cumulative).
 */
export function remainingMetresToStop(
  bus: [number, number],
  stopsIn: StopPt[],
  targetStopId: string,
): number | null {
  const stops = orderedStops(stopsIn);
  const targetIdx = stops.findIndex((s) => s.id === targetStopId);
  if (targetIdx < 0) return null;

  // Cumulative distance to each stop.
  const cumTo: number[] = [0];
  for (let i = 1; i < stops.length; i++) {
    cumTo[i] = cumTo[i - 1] + haversineM([stops[i - 1].lat, stops[i - 1].lng], [stops[i].lat, stops[i].lng]);
  }

  const proj = projectOnRoute(bus, stops);
  const projCum = proj.cumulativeM;
  const targetCum = cumTo[targetIdx];
  const rem = targetCum - projCum;
  if (rem <= 0) return null; // already past
  return rem;
}

/**
 * Rolling average speed in km/h computed from consecutive haversine deltas
 * over the given time window. Returns null if there are fewer than 2 usable
 * points or the total elapsed time is essentially zero.
 */
export interface HistoryPt { latitude: number; longitude: number; recorded_at: string; }
export function rollingSpeedKmh(points: HistoryPt[], windowMinutes = 5, nowMs = Date.now()): number | null {
  if (points.length < 2) return null;
  const cutoff = nowMs - windowMinutes * 60_000;
  const inWindow = points
    .filter((p) => new Date(p.recorded_at).getTime() >= cutoff)
    .sort((a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime());
  if (inWindow.length < 2) return null;
  let dm = 0;
  for (let i = 1; i < inWindow.length; i++) {
    dm += haversineM(
      [inWindow[i - 1].latitude, inWindow[i - 1].longitude],
      [inWindow[i].latitude, inWindow[i].longitude],
    );
  }
  const dt = (new Date(inWindow[inWindow.length - 1].recorded_at).getTime() -
              new Date(inWindow[0].recorded_at).getTime()) / 1000;
  if (dt < 5) return null;
  return (dm / dt) * 3.6;
}

// ── ETA state ───────────────────────────────────────────────────────────────

export type EtaState =
  | { kind: "eta"; minutes: number; approximate: true }
  | { kind: "arriving" }         // < 2 minutes
  | { kind: "passed" }           // depart(home) already seen this trip
  | { kind: "unknown" };         // insufficient info

export const FALLBACK_SPEED_KMH = 20;

export function computeEta(params: {
  bus: [number, number] | null;
  stops: StopPt[];
  homeStopId: string | null;
  events: EventLite[]; // for the current open session only
  liveSpeedKmh: number | null;
}): EtaState {
  const { bus, stops, homeStopId, events, liveSpeedKmh } = params;
  if (!homeStopId) return { kind: "unknown" };

  // Passed if a depart event for home stop exists in this session.
  if (events.some((e) => e.stop_id === homeStopId && e.event_type === "depart")) {
    return { kind: "passed" };
  }

  if (!bus) return { kind: "unknown" };
  const remM = remainingMetresToStop(bus, stops, homeStopId);
  if (remM == null) {
    // Home isn't ahead on the route — either home was skipped or the bus is
    // past it without a recorded depart. Fall through to "passed" only if
    // we've seen an arrive; otherwise we just can't tell yet.
    if (events.some((e) => e.stop_id === homeStopId && e.event_type === "arrive")) {
      return { kind: "arriving" };
    }
    return { kind: "unknown" };
  }
  const speed = liveSpeedKmh && liveSpeedKmh > 1 ? liveSpeedKmh : FALLBACK_SPEED_KMH;
  const minutes = (remM / 1000) / speed * 60;
  if (minutes < 2) return { kind: "arriving" };
  return { kind: "eta", minutes: Math.round(minutes), approximate: true };
}

// ── Stop statuses along the route ──────────────────────────────────────────

export type StopStatus = "done" | "current" | "pending";
export function stopStatuses(stops: StopPt[], events: EventLite[]): Map<string, StopStatus> {
  const out = new Map<string, StopStatus>();
  for (const s of orderedStops(stops)) {
    const arrived = events.some((e) => e.stop_id === s.id && e.event_type === "arrive");
    const departed = events.some((e) => e.stop_id === s.id && e.event_type === "depart");
    if (arrived && !departed) out.set(s.id, "current");
    else if (arrived) out.set(s.id, "done");
    else out.set(s.id, "pending");
  }
  return out;
}

/** The stop immediately before the given home stop in sequence order, if any. */
export function preHomeStopId(stops: StopPt[], homeStopId: string): string | null {
  const ordered = orderedStops(stops);
  const idx = ordered.findIndex((s) => s.id === homeStopId);
  if (idx <= 0) return null;
  return ordered[idx - 1].id;
}
