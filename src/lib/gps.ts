// Where the hardware GPS trackers report to (gps-server on Strettch Cloud,
// Kigali). Shown to admins as the SMS commands for a new tracker.
export const GPS_SERVER = { host: "102.202.208.186", port: 5023 } as const;

export const TRACKER_SETUP_SMS = [
  { sms: "APN,internet.mtn#", why: "Mobile data (MTN SIM; other networks use their own APN)" },
  { sms: `SERVER,0,${GPS_SERVER.host},${GPS_SERVER.port},0#`, why: "Report to Live Track" },
  { sms: "TIMER,10,300#", why: "Every 10 s while driving, 5 min parked" },
  { sms: "RESET#", why: "Restart so it uses the new settings" },
] as const;

/** 15 digits with a valid check digit (catches a mistyped IMEI). */
export function isValidImei(imei: string): boolean {
  if (!/^[0-9]{15}$/.test(imei)) return false;
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    let d = Number(imei[14 - i]);
    if (i % 2) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}
