// Pure logic for school attendance (no React, no Supabase) so
// scripts/test-attendance.ts can check it. The database decides statuses;
// this file only reads them: labels, counts, grouping by stop, and the
// "bus list vs class register" comparison from the attendance plan.

export type Run = "morning" | "afternoon";
export type RiderStatus = "expected" | "boarded" | "dropped_off" | "not_riding" | "no_show";
export type NoticeKind = "not_riding" | "pickup" | "absent";

export const STATUS_META: Record<RiderStatus, { label: string; tone: Tone; short: string }> = {
  expected: { label: "Expected", short: "Expected", tone: "neutral" },
  boarded: { label: "On board", short: "On board", tone: "success" },
  dropped_off: { label: "Dropped off", short: "Off", tone: "info" },
  not_riding: { label: "Not riding", short: "Not riding", tone: "muted" },
  no_show: { label: "Missed the bus", short: "Missed", tone: "warning" },
};

export const NOTICE_LABEL: Record<NoticeKind, string> = {
  not_riding: "Skips the bus",
  pickup: "Collected from school",
  absent: "Not coming to school",
};

export type Tone = "neutral" | "success" | "info" | "muted" | "warning" | "danger";

/** Tailwind classes for a status pill. */
export const TONE_CLASS: Record<Tone, string> = {
  neutral: "bg-secondary text-secondary-foreground border-border",
  success: "bg-success/15 text-success border-success/30",
  info: "bg-primary/12 text-primary border-primary/30",
  muted: "bg-muted text-muted-foreground border-border",
  warning: "bg-warning/15 text-warning border-warning/30",
  danger: "bg-destructive/15 text-destructive border-destructive/30",
};

export interface RiderLite {
  student_id: string;
  status: RiderStatus;
  stop_id: string | null;
  wrong_bus?: boolean;
}

export interface TripCounts {
  total: number;
  expected: number;
  onBoard: number;
  droppedOff: number;
  notRiding: number;
  noShow: number;
  /** Everyone who should still be picked up or is on board. */
  pending: number;
}

export function countTrip(list: RiderLite[]): TripCounts {
  const c: TripCounts = {
    total: list.length,
    expected: 0,
    onBoard: 0,
    droppedOff: 0,
    notRiding: 0,
    noShow: 0,
    pending: 0,
  };
  for (const r of list) {
    if (r.status === "expected") c.expected++;
    else if (r.status === "boarded") c.onBoard++;
    else if (r.status === "dropped_off") c.droppedOff++;
    else if (r.status === "not_riding") c.notRiding++;
    else if (r.status === "no_show") c.noShow++;
  }
  c.pending = c.expected + c.onBoard;
  return c;
}

/** Morning before noon (Kigali), afternoon after. */
export function defaultRun(now = new Date()): Run {
  const h = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Kigali", hour: "2-digit", hour12: false })
      .format(now)
      .slice(0, 2),
  );
  return h < 12 ? "morning" : "afternoon";
}

/** YYYY-MM-DD in Kigali. */
export function kigaliDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Kigali",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export interface StopLite {
  id: string;
  name: string;
  sequence: number | null;
  type?: string;
}

export interface StopGroup<T extends RiderLite> {
  stop: StopLite | null;
  riders: T[];
  isCurrent: boolean;
}

/**
 * The attendant's list: children grouped by stop in run order (morning:
 * sequence up; afternoon: down). The stop the bus is at moves to the top.
 * Children without a stop come last.
 */
export function groupByStop<T extends RiderLite>(
  riders: T[],
  stops: StopLite[],
  run: Run,
  currentStopId: string | null,
): StopGroup<T>[] {
  const order = [...stops]
    .filter((s) => s.type !== "school")
    .sort((a, b) => {
      const d = (a.sequence ?? 1e9) - (b.sequence ?? 1e9);
      return run === "morning" ? d : -d;
    });
  const byStop = new Map<string, T[]>();
  const none: T[] = [];
  for (const r of riders) {
    if (r.stop_id && order.some((s) => s.id === r.stop_id)) {
      const arr = byStop.get(r.stop_id) ?? [];
      arr.push(r);
      byStop.set(r.stop_id, arr);
    } else none.push(r);
  }
  const groups: StopGroup<T>[] = order
    .filter((s) => byStop.has(s.id))
    .map((s) => ({ stop: s, riders: byStop.get(s.id)!, isCurrent: s.id === currentStopId }));
  const cur = groups.findIndex((g) => g.isCurrent);
  if (cur > 0) groups.unshift(...groups.splice(cur, 1));
  if (none.length) groups.push({ stop: null, riders: none, isCurrent: false });
  return groups;
}

// ── Bus list vs class register (plan p.4) ───────────────────────────────────

export type RegisterResult =
  | "ok" // boarded and at school
  | "came_by_car" // parent said not riding, at school
  | "came_another_way" // no-show without notice, but at school
  | "absent_excused" // parent said not riding / absent, not at school
  | "check_now" // no-show without notice, not at school → school calls parent
  | "urgent" // boarded the bus but not in class
  | "not_on_bus" // doesn't ride this bus (no morning trip), at school
  | "absent" // doesn't ride the bus and not at school
  | "unknown"; // register not taken yet

export const REGISTER_META: Record<RegisterResult, { label: string; tone: Tone; hint: string }> = {
  ok: { label: "All good", tone: "success", hint: "On the bus and in class" },
  came_by_car: { label: "All good", tone: "success", hint: "Came by car (parent told us)" },
  came_another_way: {
    label: "Came another way",
    tone: "info",
    hint: "Missed the bus, but in class",
  },
  absent_excused: { label: "Absent, excused", tone: "muted", hint: "Parent told us" },
  check_now: {
    label: "Check now",
    tone: "danger",
    hint: "Not on the bus, not in class — call the parent",
  },
  urgent: { label: "Urgent", tone: "danger", hint: "Got on the bus but never reached class" },
  not_on_bus: { label: "In class", tone: "success", hint: "Doesn't ride a bus this morning" },
  absent: { label: "Absent", tone: "warning", hint: "Not in class" },
  unknown: { label: "Register not taken", tone: "neutral", hint: "Tick the class register" },
};

/**
 * @param bus the child's morning-trip status (null = not on any morning trip)
 * @param present class register (null = not taken yet)
 */
export function compareWithRegister(
  bus: RiderStatus | null,
  present: boolean | null,
): RegisterResult {
  if (present == null) return "unknown";
  if (bus == null) return present ? "not_on_bus" : "absent";
  if (bus === "boarded" || bus === "dropped_off") return present ? "ok" : "urgent";
  if (bus === "not_riding") return present ? "came_by_car" : "absent_excused";
  // expected (trip not finished) or no_show
  return present ? "came_another_way" : "check_now";
}

/** Results that need someone to act. */
export function needsAction(r: RegisterResult): boolean {
  return r === "check_now" || r === "urgent";
}

// ── Reports ─────────────────────────────────────────────────────────────────

export interface RideRow {
  student_id: string;
  service_date: string;
  run: Run;
  status: RiderStatus;
}

export interface StudentUsage {
  rides: number; // boarded or dropped off
  noShows: number;
  notRiding: number;
  trips: number; // trips the child was on the list for
  rate: number; // rides / (trips - notRiding), 0..1
}

/** Per-child usage over a period (for monthly reports and fair billing). */
export function usageByStudent(rows: RideRow[]): Map<string, StudentUsage> {
  const out = new Map<string, StudentUsage>();
  for (const r of rows) {
    const u = out.get(r.student_id) ?? { rides: 0, noShows: 0, notRiding: 0, trips: 0, rate: 0 };
    u.trips++;
    if (r.status === "boarded" || r.status === "dropped_off") u.rides++;
    else if (r.status === "no_show") u.noShows++;
    else if (r.status === "not_riding") u.notRiding++;
    out.set(r.student_id, u);
  }
  for (const u of out.values()) {
    const planned = u.trips - u.notRiding;
    u.rate = planned > 0 ? u.rides / planned : 0;
  }
  return out;
}

/** CSV with a BOM so Excel opens accents correctly. */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? "" : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "\uFEFF" + rows.map((r) => r.map(esc).join(",")).join("\r\n");
}

/** Parses a simple CSV (quoted fields, comma or semicolon). */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, "");
  const sep =
    (src.split(/\r?\n/)[0].match(/;/g)?.length ?? 0) >
    (src.split(/\r?\n/)[0].match(/,/g)?.length ?? 0)
      ? ";"
      : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((c) => c.trim() !== "")) rows.push(row.map((c) => c.trim()));
      row = [];
      cell = "";
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row.map((c) => c.trim()));
  return rows;
}
