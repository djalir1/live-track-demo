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
