// Presence rule for the parent /me screen. Pure function of a device_status
// row plus a "has open trip session" flag plus the current time. Extracted
// so scripts/test-parent-presence.ts can assert it without a browser.
//
// Freshness thresholds are the same ones the admin dashboard uses.

export const FRESH_MS = 30_000;     // < 30s: live
export const OFFLINE_MS = 90_000;   // > 90s: offline
export const MOVING_KMH = 0.8;

export interface DeviceStatusLite {
  status: "moving" | "stopped" | "idle" | "offline";
  latitude: number | null;
  longitude: number | null;
  speed_kmh: number | null;
  last_seen: string; // ISO
  is_tracking: boolean;
}

export type BannerState =
  | { kind: "moving" }
  | { kind: "stopped" }
  | { kind: "offline"; lastSeenIso: string | null; nearPlace: string | null }
  | { kind: "no-trip" };

export function derivePresence(
  ds: DeviceStatusLite | null,
  hasOpenSession: boolean,
  now: number,
): BannerState {
  if (!hasOpenSession) return { kind: "no-trip" };
  if (!ds) return { kind: "offline", lastSeenIso: null, nearPlace: null };
  const age = now - new Date(ds.last_seen).getTime();
  if (age > OFFLINE_MS) return { kind: "offline", lastSeenIso: ds.last_seen, nearPlace: null };
  if (age < FRESH_MS) {
    if ((ds.speed_kmh ?? 0) > MOVING_KMH) return { kind: "moving" };
    return { kind: "stopped" };
  }
  // 30s–90s: trust stored status only if it was moving or stopped;
  // never present anything else as "live".
  if (ds.status === "moving" && (ds.speed_kmh ?? 0) > MOVING_KMH) return { kind: "moving" };
  if (ds.status === "stopped") return { kind: "stopped" };
  return { kind: "offline", lastSeenIso: ds.last_seen, nearPlace: null };
}
