// Where the hardware GPS trackers report to (gps-server on Strettch Cloud,
// Kigali). Shown to admins as the SMS commands for a new tracker.
export const GPS_SERVER = { host: "102.202.208.186", port: 5023 } as const;

export const TRACKER_SETUP_SMS = [
  { sms: "APN,internet.mtn#", why: "Mobile data on the MTN SIM" },
  { sms: `SERVER,0,${GPS_SERVER.host},${GPS_SERVER.port},0#`, why: "Report to Live Track" },
  { sms: "TIMER,10,300#", why: "Every 10 s while driving, 5 min parked" },
] as const;
