// Several days at once, for the owner's question "how much does this vehicle
// really work?": totals, km per week, day by day and week by week.
//
// Each day is still built by buildDayReport (same trips, same distance rules);
// this only keeps the per-day totals so a long period stays light in memory.
// Pure functions — exercised by scripts/test-day-report.ts.

import type { DayReport } from "./day-report";

export interface DaySummary {
  /** yyyy-MM-dd, a Kigali calendar day */
  day: string;
  distanceKm: number;
  estimatedKm: number;
  drivingMs: number;
  engineOnMs: number;
  trips: number;
  topSpeedKmh: number;
  signalLost: number;
  signalLostMs: number;
  /** Anything at all was recorded (the tracker was alive). */
  hasData: boolean;
}

export interface WeekSummary {
  from: string;
  to: string;
  days: number;
  activeDays: number;
  distanceKm: number;
  drivingMs: number;
  trips: number;
}

export interface RangeSummary {
  from: string;
  to: string;
  days: DaySummary[];
  weeks: WeekSummary[];
  drivers: string[];
  distanceKm: number;
  drivingMs: number;
  trips: number;
  topSpeedKmh: number;
  /** Days the vehicle made at least one trip. */
  activeDays: number;
  perActiveDayKm: number;
  /** Average over the whole period, scaled to 7 days. */
  perWeekKm: number;
  busiest: DaySummary | null;
  signalLost: number;
  signalLostMs: number;
}

export function summarizeDay(day: string, r: DayReport): DaySummary {
  const t = r.totals;
  return {
    day,
    distanceKm: t.distanceKm,
    estimatedKm: t.estimatedKm,
    drivingMs: t.drivingMs,
    engineOnMs: t.engineOnMs,
    trips: t.trips,
    topSpeedKmh: t.topSpeedKmh,
    signalLost: t.signalLost,
    signalLostMs: t.signalLostMs,
    hasData: r.pointCount > 0,
  };
}

const noonUtc = (day: string) => new Date(`${day}T12:00:00Z`);
const ymd = (d: Date) => d.toISOString().slice(0, 10);

export function shiftDay(day: string, by: number) {
  const d = noonUtc(day);
  d.setUTCDate(d.getUTCDate() + by);
  return ymd(d);
}

/** Every day from `from` to `to`, both included. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = shiftDay(d, 1)) out.push(d);
  return out;
}

/** Monday of the week `day` falls in. */
export function weekStart(day: string) {
  const dow = (noonUtc(day).getUTCDay() + 6) % 7; // Monday = 0
  return shiftDay(day, -dow);
}

/** "Mon 27 Oct" */
export function fmtShortDay(day: string) {
  return noonUtc(day).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export function summarizeRange(
  from: string,
  to: string,
  days: DaySummary[],
  drivers: string[] = [],
): RangeSummary {
  const sum = (f: (d: DaySummary) => number) => days.reduce((a, d) => a + f(d), 0);
  const distanceKm = sum((d) => d.distanceKm);
  const active = days.filter((d) => d.trips > 0);
  const weeks = new Map<string, WeekSummary>();
  for (const d of days) {
    const k = weekStart(d.day);
    const w = weeks.get(k) ?? {
      from: d.day,
      to: d.day,
      days: 0,
      activeDays: 0,
      distanceKm: 0,
      drivingMs: 0,
      trips: 0,
    };
    w.to = d.day;
    w.days++;
    if (d.trips > 0) w.activeDays++;
    w.distanceKm += d.distanceKm;
    w.drivingMs += d.drivingMs;
    w.trips += d.trips;
    weeks.set(k, w);
  }
  return {
    from,
    to,
    days,
    weeks: [...weeks.values()],
    drivers,
    distanceKm,
    drivingMs: sum((d) => d.drivingMs),
    trips: sum((d) => d.trips),
    topSpeedKmh: Math.max(0, ...days.map((d) => d.topSpeedKmh)),
    activeDays: active.length,
    perActiveDayKm: active.length ? distanceKm / active.length : 0,
    perWeekKm: days.length ? (distanceKm / days.length) * 7 : 0,
    busiest: active.reduce<DaySummary | null>(
      (b, d) => (!b || d.distanceKm > b.distanceKm ? d : b),
      null,
    ),
    signalLost: sum((d) => d.signalLost),
    signalLostMs: sum((d) => d.signalLostMs),
  };
}

export type RangePreset = "day" | "7d" | "30d" | "week" | "month" | "custom";

/** The [from, to] days a preset covers, ending today (Kigali). */
export function presetRange(p: RangePreset, today: string): { from: string; to: string } {
  switch (p) {
    case "7d":
      return { from: shiftDay(today, -6), to: today };
    case "30d":
      return { from: shiftDay(today, -29), to: today };
    case "week":
      return { from: weekStart(today), to: today };
    case "month":
      return { from: `${today.slice(0, 8)}01`, to: today };
    default:
      return { from: today, to: today };
  }
}
