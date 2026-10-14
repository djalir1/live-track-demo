// Time for a fleet in Rwanda, independent of the viewing device's settings.
//
// 1. Display: every time is shown in Kigali time (Africa/Kigali, UTC+2), so a
//    laptop set to the wrong timezone still prints 11:11 for an 11:11 trip.
// 2. "Now": presence ("online / offline", "updated 5 s ago") is measured
//    against Supabase's clock, not the device's. A device whose clock is off
//    (e.g. local time saved as UTC → 2 h ahead) would otherwise call every
//    vehicle offline. The offset comes from the HTTP Date header, which
//    Supabase exposes to browsers.

export const APP_TZ = "Africa/Kigali";

let offsetMs = 0;
let lastSync = 0;
let syncing: Promise<void> | null = null;

/** Milliseconds since epoch on the server's clock (best estimate). */
export function serverNow(): number {
  return Date.now() + offsetMs;
}

/** Measure the device ↔ server clock offset. Cheap; safe to call often. */
export function syncServerClock(force = false): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (!force && Date.now() - lastSync < 5 * 60_000) return syncing ?? Promise.resolve();
  if (syncing) return syncing;
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
  if (!url || !key) return Promise.resolve();
  syncing = (async () => {
    try {
      const t0 = Date.now();
      // PostgREST exposes Date to browsers (auth/v1 doesn't). Empty result under RLS.
      const res = await fetch(`${url}/rest/v1/schools?select=id&limit=0`, {
        headers: { apikey: key },
        cache: "no-store",
      });
      const t1 = Date.now();
      const date = res.headers.get("date");
      if (date) {
        // Date has 1 s resolution; +500 ms centres it. Half the round trip
        // approximates when the server stamped it.
        const server = Date.parse(date) + 500;
        const next = server - (t0 + (t1 - t0) / 2);
        // Ignore sub-2 s differences: that's resolution/latency noise.
        offsetMs = Math.abs(next) < 2000 ? 0 : next;
        lastSync = Date.now();
      }
    } catch {
      /* offline: keep the previous offset */
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(opts: Intl.DateTimeFormatOptions) {
  const k = JSON.stringify(opts);
  let f = fmtCache.get(k);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", { timeZone: APP_TZ, ...opts });
    fmtCache.set(k, f);
  }
  return f;
}
const toDate = (d: string | number | Date) => (d instanceof Date ? d : new Date(d));

/** 14:05 */
export const fmtTime = (d: string | number | Date) =>
  fmt({ hour: "2-digit", minute: "2-digit", hour12: false }).format(toDate(d));
/** 14 Oct 2026 */
export const fmtDate = (d: string | number | Date) =>
  fmt({ day: "numeric", month: "short", year: "numeric" }).format(toDate(d));
/** Wednesday 14 October 2026 */
export const fmtLongDate = (d: string | number | Date) =>
  fmt({ weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(toDate(d));
/** 14 Oct 2026, 14:05 */
export const fmtDateTime = (d: string | number | Date) => `${fmtDate(d)}, ${fmtTime(d)}`;

/** Today's date in Kigali as yyyy-MM-dd (for <input type="date">). */
export function todayKigali(): string {
  const p = fmt({ year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(
    new Date(serverNow()),
  );
  const get = (t: string) => p.find((x) => x.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** [start, end) of a Kigali calendar day (yyyy-MM-dd) as ISO instants. Kigali has no DST. */
export function kigaliDayRange(day: string): { start: string; end: string } {
  const start = new Date(`${day}T00:00:00+02:00`);
  return { start: start.toISOString(), end: new Date(start.getTime() + 86_400_000).toISOString() };
}

/** "just now", "45 s ago", "3 min ago", "2 h ago", "3 d ago" — against server time. */
export function ago(iso: string | number | Date): string {
  const s = Math.max(0, Math.round((serverNow() - toDate(iso).getTime()) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s} s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

/** 1h 05m / 12 min / <1 min */
export function fmtDuration(ms: number): string {
  const mins = ms / 60_000;
  if (mins < 1) return "<1 min";
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  if (h === 0) return `${m} min`;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}
