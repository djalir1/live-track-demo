import type { TrackingStatus } from "@/types/tracking";

// One meaning per status, everywhere (dashboard list, map, filters):
//   moving  — driving
//   stopped — engine on / tracking on, not moving (traffic, pick-up)
//   idle    — parked: ignition off (tracker) or tracking just started (phone)
//   offline — no report recently
export const STATUS_COLOR: Record<TrackingStatus, string> = {
  moving: "#22c55e",
  stopped: "#f59e0b",
  idle: "#3b82f6",
  offline: "#71717a",
};
export const STATUS_LABEL: Record<TrackingStatus, string> = {
  moving: "Moving",
  stopped: "Stopped",
  idle: "Parked",
  offline: "Offline",
};

/** A problem worth showing next to a vehicle, in plain words. */
export interface DeviceHealth {
  tone: "warn" | "error";
  /** 1–2 words for chips and map labels */
  short: string;
  /** one sentence: what is happening and what is shown */
  detail: string;
}

const clock = (iso: string) =>
  // Kigali time, like the push alerts: without it the dashboard showed UTC
  // ("lost power at 19:09" for a 21:09 event).
  new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Kigali",
  });

const mins = (ms: number) => {
  const m = Math.round(ms / 60_000);
  return m < 1 ? `${Math.round(ms / 1000)} s` : m < 120 ? `${m} min` : `${Math.round(m / 60)} h`;
};

/**
 * Why a vehicle may look wrong, so the dashboard explains it instead of
 * looking frozen. `ageMs` = time since the last report (server clock).
 */
export function deviceHealth(o: {
  gpsTracker: boolean;
  fresh: boolean;
  ageMs: number;
  engineOn: boolean;
  gpsFix: boolean | null | undefined;
  satellites: number | null | undefined;
  /** Tracker reported losing vehicle power / being removed (gps-server). */
  powerCutAt?: string | null;
  /** Tracker silent for 30+ min: last report time (gps-server). */
  silentSince?: string | null;
}): DeviceHealth | null {
  if (o.gpsTracker && o.silentSince && !o.fresh)
    return {
      tone: "error",
      short: "Silent",
      detail: o.powerCutAt
        ? `Lost the vehicle's power at ${clock(o.powerCutAt)} and no report since ${clock(o.silentSince)}. The tracker may have been removed, or its backup battery is empty. Check the vehicle. Showing the last known position.`
        : `No report since ${clock(o.silentSince)}. The tracker may have been unplugged or removed, or its SIM has no credit. Check the vehicle. Showing the last known position.`,
    };
  // Still reporting, just not powered by the vehicle (loose wire, fuse,
  // unplugged): tracking works until the backup battery runs out. Not an alarm.
  const onBattery =
    o.gpsTracker && o.powerCutAt
      ? ` The tracker has been on its backup battery since ${clock(o.powerCutAt)}: have its power wire checked.`
      : "";
  if (!o.fresh) {
    // A phone whose driver simply isn't tracking is not a problem.
    if (!o.gpsTracker && !o.engineOn) return null;
    if (!o.gpsTracker)
      return {
        tone: "error",
        short: "No signal",
        detail: `No report for ${mins(o.ageMs)}: the app may be closed, the phone offline or switched off. Showing the last known position.`,
      };
    return {
      tone: "error",
      short: "No signal",
      detail: `${
        o.engineOn
          ? `No report for ${mins(o.ageMs)} while the engine was on: the tracker is probably out of mobile coverage and will catch up when it reconnects. Showing the last known position.`
          : `Parked and silent for ${mins(o.ageMs)} (it normally checks in every 5 min): check the tracker's power and SIM credit. Showing the last known position.`
      }${onBattery}`,
    };
  }
  // Parked and without the vehicle's power: unplugged or removed (gps-server
  // alerts owners for the same thing). While the engine runs it is a wiring
  // fault instead: the tracker loses power at engine start.
  if (onBattery && !o.engineOn)
    return {
      tone: "error",
      short: "Unplugged",
      detail: `The GPS tracker has had no power from the vehicle since ${clock(o.powerCutAt!)} while parked: it was unplugged or removed. It still reports from its own backup battery until that runs out. Check the vehicle.`,
    };
  if (onBattery)
    return {
      tone: "warn",
      short: "On battery",
      detail: `Tracking normally, but the tracker lost the vehicle's power while driving (a loose wire or blown fuse).${onBattery}`,
    };
  if (o.gpsTracker && o.gpsFix === false)
    return {
      tone: "warn",
      short: "Finding GPS",
      detail: `Tracker online, waiting for satellites${o.satellites != null ? ` (${o.satellites} in view)` : ""}. This takes 1–2 min after the engine starts, longer in a garage or under a roof. Showing the last known position.`,
    };
  if (o.gpsTracker && o.engineOn && o.ageMs > 45_000)
    return {
      tone: "warn",
      short: "Delayed",
      detail: `Last report ${mins(o.ageMs)} ago (expected every 10 s): weak mobile signal where the vehicle is.`,
    };
  return null;
}
