import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  MapPin,
  ArrowLeft,
  Download,
  Calendar,
  Loader2,
  Gauge,
  Route as RouteIcon,
  Clock,
  Activity,
  List,
  Map as MapIcon,
  ParkingSquare,
  TimerReset,
  WifiOff,
  User,
  ChevronLeft,
  ChevronRight,
  CalendarRange,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth, canManageSchoolSetup, homeFor } from "@/lib/auth-context";
import { AppShell, ShellMenuButton } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { reverseGeocode, cachedReverseGeocode } from "@/lib/geocode";
import { friendlyError } from "@/lib/friendly-errors";
import {
  buildDayReport,
  tripColor,
  type DayReport,
  type LatLon,
  type RawPoint,
  type SessionRow,
} from "@/lib/day-report";
import {
  daysBetween,
  fmtShortDay,
  presetRange,
  shiftDay,
  summarizeDay,
  summarizeRange,
  type DaySummary,
  type RangePreset,
  type RangeSummary,
} from "@/lib/range-report";
import { busName, db, loadFleet, type Assignment, type Fleet } from "@/lib/fleet";
import {
  fmtDuration,
  fmtLongDate,
  fmtTime,
  kigaliDayRange,
  serverNow,
  syncServerClock,
  todayKigali,
} from "@/lib/time";

const TripMap = lazy(() => import("@/components/TripMap").then((m) => ({ default: m.TripMap })));

export const Route = createFileRoute("/history")({
  head: () => ({ meta: [{ title: "Trip History — Live Track" }] }),
  component: HistoryPage,
});

/** What can be reported on: a vehicle (its tracker / current driver's phone) or an app driver. */
interface Subject {
  key: string;
  userId: string; // positions are stored per account
  title: string;
  subtitle: string | null;
  plate: string | null;
  busId: string | null;
  /** A hardware tracker: it checks in every 5 min while parked. */
  tracker: boolean;
}

// The API returns at most 1,000 rows per request; a busy day at one fix per
// 10 s is ~8,600. Page through it.
async function fetchDayPoints(userId: string, start: string, end: string) {
  const PAGE = 1000;
  const all: RawPoint[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("location_history")
      .select("latitude, longitude, speed_kmh, battery_level, recorded_at")
      .eq("user_id", userId)
      .gte("recorded_at", start)
      .lt("recorded_at", end)
      .order("recorded_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return { data: null, error };
    all.push(...((data ?? []) as RawPoint[]));
    if (!data || data.length < PAGE) return { data: all, error: null };
  }
}

/** One Kigali day for one vehicle, built exactly like the day view shows it. */
async function loadDayReport(subject: Subject, day: string): Promise<DayReport> {
  const { start, end } = kigaliDayRange(day);
  const [pointsRes, beforeRes, sessionsRes] = await Promise.all([
    fetchDayPoints(subject.userId, start, end),
    // Where it was parked when the day began.
    supabase
      .from("location_history")
      .select("latitude, longitude, speed_kmh, battery_level, recorded_at")
      .eq("user_id", subject.userId)
      .lt("recorded_at", start)
      .order("recorded_at", { ascending: false })
      .limit(1),
    db
      .from("trip_sessions")
      .select("started_at, ended_at")
      .eq("user_id", subject.userId)
      .lt("started_at", end)
      .or(`ended_at.gte.${start},ended_at.is.null`),
  ]);
  for (const r of [pointsRes, beforeRes, sessionsRes]) if (r.error) throw r.error;
  return buildDayReport(
    (pointsRes.data ?? []) as RawPoint[],
    (sessionsRes.data ?? []) as SessionRow[],
    {
      from: start,
      to: end,
      now: serverNow(),
      before: (beforeRes.data?.[0] as RawPoint | undefined) ?? null,
      parkedReports: subject.tracker,
    },
  );
}

async function loadAssignments(busId: string | null, start: string, end: string) {
  if (!busId) return [];
  const { data, error } = await db
    .from("vehicle_assignments")
    .select("id, bus_id, driver_id, started_at, ended_at")
    .eq("bus_id", busId)
    .lt("started_at", end)
    .or(`ended_at.gte.${start},ended_at.is.null`);
  if (error) throw error;
  return (data ?? []) as Assignment[];
}

const placeKey = (p: LatLon) => `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;

// Past days never change: keep their totals for the session so switching
// between "7 days" and "30 days" doesn't reload what's already known.
const daySummaryCache = new Map<string, DaySummary>();

const PRESETS: Array<{ id: RangePreset; label: string }> = [
  { id: "day", label: "One day" },
  { id: "7d", label: "Last 7 days" },
  { id: "week", label: "This week" },
  { id: "30d", label: "Last 30 days" },
  { id: "month", label: "This month" },
  { id: "custom", label: "Pick dates" },
];
const MAX_RANGE_DAYS = 366;

function HistoryPage() {
  const { user, role, loading } = useAuth();
  const navigate = useNavigate();

  const [fleet, setFleet] = useState<Fleet | null>(null);
  const [subjectKey, setSubjectKey] = useState("");
  const [date, setDate] = useState<string>(todayKigali());
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<DayReport | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [places, setPlaces] = useState<Record<string, string>>({});
  const [selectedTrip, setSelectedTrip] = useState<number | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [mobileView, setMobileView] = useState<"info" | "map">("info");
  const [preset, setPreset] = useState<RangePreset>("day");
  const [custom, setCustom] = useState<{ from: string; to: string }>(() => {
    const t = todayKigali();
    return { from: shiftDay(t, -6), to: t };
  });
  const [rangeDays, setRangeDays] = useState<Record<string, DaySummary>>({});
  const [rangeDrivers, setRangeDrivers] = useState<string[]>([]);
  const [rangeBusy, setRangeBusy] = useState(false);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const loadToken = useRef(0);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      navigate({ to: "/auth" });
      return;
    }
    if (role === null) return;
    if (!canManageSchoolSetup(role)) navigate({ to: homeFor(role) });
  }, [loading, user, role, navigate]);

  useEffect(() => {
    if (!canManageSchoolSetup(role)) return;
    void syncServerClock().then(() => setDate(todayKigali()));
    loadFleet()
      .then(setFleet)
      .catch((e) => toast.error(friendlyError(e, "Couldn't load vehicles.")));
  }, [role]);

  // Vehicles first (what owners think in), then app drivers not tied to one.
  const subjects = useMemo<Subject[]>(() => {
    if (!fleet) return [];
    const out: Subject[] = [];
    const seen = new Set<string>();
    for (const b of fleet.buses) {
      if (!b.driver_user_id) continue;
      seen.add(b.driver_user_id);
      const cur = fleet.open.find((a) => a.bus_id === b.id);
      const driver = cur ? fleet.drivers.find((d) => d.id === cur.driver_id)?.full_name : null;
      out.push({
        key: `bus:${b.id}`,
        userId: b.driver_user_id,
        title: busName(b),
        subtitle: driver ?? null,
        plate: b.plate,
        busId: b.id,
        tracker: !!b.gps_imei,
      });
    }
    for (const d of fleet.drivers) {
      if (!d.active || !d.user_id || seen.has(d.user_id)) continue;
      out.push({
        key: `drv:${d.id}`,
        userId: d.user_id,
        title: d.full_name,
        subtitle: "Driver app",
        plate: null,
        busId: null,
        tracker: false,
      });
    }
    return out;
  }, [fleet]);

  useEffect(() => {
    if (!subjectKey && subjects.length) setSubjectKey(subjects[0].key);
  }, [subjects, subjectKey]);
  const subject = subjects.find((s) => s.key === subjectKey) ?? null;

  useEffect(() => {
    if (!subject || !date || preset !== "day") return;
    let cancelled = false;
    (async () => {
      setBusy(true);
      setReport(null);
      setSelectedTrip(null);
      try {
        const { start, end } = kigaliDayRange(date);
        const [day, assigned] = await Promise.all([
          loadDayReport(subject, date),
          loadAssignments(subject.busId, start, end),
        ]);
        if (cancelled) return;
        setAssignments(assigned);
        setReport(day);
      } catch (e) {
        if (!cancelled) toast.error(friendlyError(e, "Couldn't load this day."));
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [subject?.userId, subject?.busId, subject?.tracker, date, preset]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Several days ──────────────────────────────────────────────────────────
  const today = todayKigali();
  const span = useMemo(() => {
    if (preset === "day") return null;
    const r = preset === "custom" ? custom : presetRange(preset, today);
    const to = r.to > today ? today : r.to;
    const from = r.from > to ? to : r.from;
    const days = daysBetween(from, to);
    // Most recent MAX_RANGE_DAYS if someone picks years.
    return days.length > MAX_RANGE_DAYS
      ? {
          from: days[days.length - MAX_RANGE_DAYS],
          to,
          days: days.slice(-MAX_RANGE_DAYS),
          cut: true,
        }
      : { from, to, days, cut: false };
  }, [preset, custom, today]);

  useEffect(() => {
    if (!subject || !span) return;
    const token = ++loadToken.current;
    const live = () => token === loadToken.current;
    const cacheKey = (day: string) => `${subject.userId}|${subject.tracker}|${day}`;
    const known: Record<string, DaySummary> = {};
    for (const d of span.days) {
      const c = daySummaryCache.get(cacheKey(d));
      if (c) known[d] = c;
    }
    setRangeDays(known);
    setRangeError(null);
    setRangeBusy(true);
    const todo = span.days.filter((d) => !known[d]).reverse(); // newest first
    (async () => {
      // Who drove: everyone assigned to the vehicle at some point in the period.
      try {
        const a = await loadAssignments(
          subject.busId,
          kigaliDayRange(span.from).start,
          kigaliDayRange(span.to).end,
        );
        if (!live()) return;
        const names = [
          ...new Set(a.map((x) => fleet?.drivers.find((d) => d.id === x.driver_id)?.full_name)),
        ];
        setRangeDrivers(names.filter(Boolean) as string[]);
      } catch {
        if (live()) setRangeDrivers([]);
      }
    })();
    (async () => {
      // A few days at a time: fast, without flooding the database.
      const worker = async () => {
        for (let day = todo.shift(); day; day = todo.shift()) {
          if (!live()) return;
          const sum = summarizeDay(day, await loadDayReport(subject, day));
          if (day < today) daySummaryCache.set(cacheKey(day), sum);
          if (live()) setRangeDays((prev) => ({ ...prev, [day]: sum }));
        }
      };
      try {
        await Promise.all([worker(), worker(), worker(), worker()]);
      } catch (e) {
        if (live()) setRangeError(friendlyError(e, "Couldn't load some of these days."));
      } finally {
        if (live()) setRangeBusy(false);
      }
    })();
  }, [subject?.userId, subject?.busId, subject?.tracker, span?.from, span?.to]); // eslint-disable-line react-hooks/exhaustive-deps

  const range = useMemo<RangeSummary | null>(() => {
    if (!span) return null;
    const loaded = span.days.map((d) => rangeDays[d]).filter(Boolean) as DaySummary[];
    return summarizeRange(span.from, span.to, loaded, rangeDrivers);
  }, [span, rangeDays, rangeDrivers]);
  const rangeLoaded = span ? span.days.filter((d) => rangeDays[d]).length : 0;

  const openDay = (day: string) => {
    setDate(day);
    setPreset("day");
    setMobileView("info");
  };

  // Street names for every place shown (trip ends, stops, parking spots).
  const placeList = useMemo<LatLon[]>(() => {
    if (!report) return [];
    const all: LatLon[] = [];
    for (const t of report.trips) {
      if (t.start) all.push(t.start);
      all.push(...t.stops);
      if (t.end) all.push(t.end);
    }
    all.push(...report.parked, ...report.signalLost);
    return all;
  }, [report]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const seen = new Set<string>();
      for (const p of placeList) {
        const k = placeKey(p);
        if (seen.has(k)) continue;
        seen.add(k);
        const cached = cachedReverseGeocode(p.lat, p.lon);
        const label = cached ?? (await reverseGeocode(p.lat, p.lon));
        if (cancelled) return;
        if (label) setPlaces((prev) => (prev[k] === label ? prev : { ...prev, [k]: label }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [placeList]);
  const placeOf = (p: LatLon) => places[placeKey(p)] ?? null;

  /** Who was assigned to the vehicle when a trip started. */
  const driverAt = (iso: string): string | null => {
    if (!fleet) return null;
    if (!subject?.busId) return subject?.title ?? null;
    const t = Date.parse(iso);
    const a = assignments.find(
      (x) => Date.parse(x.started_at) <= t && (x.ended_at == null || Date.parse(x.ended_at) > t),
    );
    return a ? (fleet.drivers.find((d) => d.id === a.driver_id)?.full_name ?? null) : null;
  };

  const onExportPdf = async () => {
    if (!subject) return;
    setPdfBusy(true);
    try {
      const pdf = await import("@/lib/pdf");
      if (range) {
        await pdf.generateRangeReportPdf({ vehicle: subject.title, plate: subject.plate, range });
      } else if (report) {
        await pdf.generateDayReportPdf({
          vehicle: subject.title,
          plate: subject.plate,
          day: date,
          report,
          driverAt,
        });
      }
      toast.success("PDF report downloaded");
    } catch (e) {
      toast.error(friendlyError(e, "Couldn't build the PDF report."));
    } finally {
      setPdfBusy(false);
    }
  };

  if (loading || !canManageSchoolSetup(role)) {
    return (
      <div className="min-h-screen bg-background grid place-items-center">
        <div className="flex items-center gap-3 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <span>Loading…</span>
        </div>
      </div>
    );
  }

  const hasData = !!report && report.pointCount > 0;
  const canExport = range ? !rangeBusy && range.days.length > 0 : hasData;

  const infoPanel = (
    <aside className="rounded-2xl bg-gradient-card border border-border/60 shadow-soft flex flex-col overflow-hidden flex-1 min-h-0">
      <div className="p-3 sm:p-4 space-y-3 border-b border-border/50 shrink-0">
        <div className="space-y-1.5">
          <Label htmlFor="subject">Vehicle</Label>
          <select
            id="subject"
            value={subjectKey}
            onChange={(e) => setSubjectKey(e.target.value)}
            className="w-full h-10 rounded-md bg-background/50 border border-input px-3 text-sm"
          >
            {subjects.length === 0 && <option value="">No vehicles yet</option>}
            {subjects.map((s) => (
              <option key={s.key} value={s.key}>
                {s.title}
                {s.plate && s.plate !== s.title ? ` (${s.plate})` : ""}
                {s.subtitle ? ` · ${s.subtitle}` : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label>Period</Label>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Period">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                role="radio"
                aria-checked={preset === p.id}
                onClick={() => setPreset(p.id)}
                className={`h-8 px-3 rounded-full text-xs font-medium border transition-colors ${
                  preset === p.id
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background/50 border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        {preset === "day" && (
          <div className="flex gap-1.5">
            <Button
              variant="outline"
              size="icon"
              className="h-10 w-10 shrink-0"
              aria-label="Previous day"
              onClick={() => setDate((d) => shiftDay(d, -1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="relative flex-1">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                id="date"
                aria-label="Day"
                type="date"
                value={date}
                onChange={(e) => e.target.value && setDate(e.target.value)}
                max={today}
                className="pl-9 h-10"
              />
            </div>
            <Button
              variant="outline"
              size="icon"
              className="h-10 w-10 shrink-0"
              aria-label="Next day"
              disabled={date >= today}
              onClick={() => setDate((d) => shiftDay(d, 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
        {preset === "custom" && (
          <div className="grid grid-cols-2 gap-1.5">
            <div className="space-y-1">
              <Label htmlFor="from" className="text-xs text-muted-foreground">
                From
              </Label>
              <Input
                id="from"
                type="date"
                value={custom.from}
                max={custom.to}
                onChange={(e) =>
                  e.target.value && setCustom((c) => ({ ...c, from: e.target.value }))
                }
                className="h-10"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="to" className="text-xs text-muted-foreground">
                To
              </Label>
              <Input
                id="to"
                type="date"
                value={custom.to}
                min={custom.from}
                max={today}
                onChange={(e) => e.target.value && setCustom((c) => ({ ...c, to: e.target.value }))}
                className="h-10"
              />
            </div>
          </div>
        )}
        {span && preset !== "custom" && (
          <div className="text-xs text-muted-foreground flex items-center gap-1.5">
            <CalendarRange className="h-3.5 w-3.5" />
            {fmtShortDay(span.from)} – {fmtShortDay(span.to)} · {span.days.length} days
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3 min-h-0">
        {range && span && (
          <RangeView
            range={range}
            allDays={span.days}
            loaded={rangeLoaded}
            busy={rangeBusy}
            error={rangeError}
            cut={span.cut}
            onOpenDay={openDay}
          />
        )}
        {!range && busy && (
          <div className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading the day…
          </div>
        )}
        {!range && !busy && report && !hasData && (
          <div className="text-sm text-muted-foreground text-center py-8">
            <Activity className="h-6 w-6 mx-auto mb-2 opacity-40" />
            Nothing recorded on {fmtLongDate(`${date}T12:00:00+02:00`)}.
          </div>
        )}
        {!range && !busy && report && hasData && (
          <>
            <Totals report={report} />
            <Timeline
              report={report}
              placeOf={placeOf}
              driverAt={driverAt}
              selected={selectedTrip}
              onSelect={(i) => {
                setSelectedTrip(i);
                if (i != null) setMobileView("map");
              }}
            />
          </>
        )}
      </div>
    </aside>
  );

  const mapPanel = (
    <section className="relative rounded-2xl bg-gradient-card border border-border/60 shadow-soft overflow-hidden flex-1 min-h-0">
      <Suspense
        fallback={
          <div className="h-full w-full grid place-items-center text-muted-foreground">
            <Activity className="h-5 w-5 animate-pulse mr-2" /> Loading map…
          </div>
        }
      >
        <TripMap
          trips={range ? [] : (report?.trips ?? [])}
          selected={selectedTrip}
          onSelect={setSelectedTrip}
          placeOf={placeOf}
        />
      </Suspense>
      {range && (
        <div className="absolute inset-0 z-[500] grid place-items-center bg-background/60 backdrop-blur-sm p-6">
          <div className="text-center text-sm text-muted-foreground max-w-xs">
            <MapIcon className="h-6 w-6 mx-auto mb-2 opacity-60" />
            Pick a day in the list to see its trips on the map.
          </div>
        </div>
      )}
      {!range && report && report.trips.length > 1 && (
        <div className="absolute top-2 left-2 right-2 z-[500] flex gap-1.5 overflow-x-auto [scrollbar-width:none]">
          <TripChip
            active={selectedTrip == null}
            color="#64748b"
            label="All trips"
            onClick={() => setSelectedTrip(null)}
          />
          {report.trips.map((t) => (
            <TripChip
              key={t.index}
              active={selectedTrip === t.index}
              color={tripColor(t.index)}
              label={`Trip ${t.index} · ${fmtTime(t.startedAt)}`}
              onClick={() => setSelectedTrip(t.index)}
            />
          ))}
        </div>
      )}
    </section>
  );

  return (
    <AppShell bare>
      <div className="h-full bg-background flex flex-col overflow-hidden">
        <header className="shrink-0 z-30 pt-safe backdrop-blur-xl bg-background/70 border-b border-border/50">
          <div className="mx-auto max-w-[1600px] px-3 sm:px-4 lg:px-6 h-14 sm:h-16 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <Button asChild variant="ghost" size="sm" className="hidden">
                <Link to="/dashboard">
                  <ArrowLeft className="h-4 w-4 sm:mr-1.5" />
                  <span className="hidden sm:inline">Dashboard</span>
                </Link>
              </Button>
              <ShellMenuButton />
              <Link
                to="/"
                className="flex lg:hidden items-center gap-2 font-display font-bold shrink-0"
              >
                <span className="h-8 w-8 grid place-items-center rounded-lg bg-gradient-primary shadow-glow">
                  <MapPin className="h-4 w-4 text-primary-foreground" />
                </span>
                <span className="hidden sm:inline">Live Track</span>
              </Link>
              <span className="hidden md:inline-block text-xs uppercase tracking-wider text-muted-foreground border-l border-border pl-3">
                Trip History
              </span>
            </div>
            <Button
              onClick={onExportPdf}
              disabled={!canExport || pdfBusy}
              size="sm"
              className="bg-gradient-primary shadow-glow"
            >
              {pdfBusy ? (
                <Loader2 className="h-4 w-4 sm:mr-1.5 animate-spin" />
              ) : (
                <Download className="h-4 w-4 sm:mr-1.5" />
              )}
              <span className="hidden sm:inline">Export PDF</span>
              <span className="sm:hidden">PDF</span>
            </Button>
          </div>

          <div
            className={`${range ? "hidden" : "flex"} lg:hidden mx-auto max-w-[1600px] px-3 pb-2 gap-2`}
          >
            {(["info", "map"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setMobileView(v)}
                className={`flex-1 flex items-center justify-center gap-1.5 h-9 rounded-full text-xs font-medium border transition-all ${
                  mobileView === v
                    ? "bg-primary text-primary-foreground border-primary shadow-glow"
                    : "bg-background/50 border-border text-muted-foreground"
                }`}
              >
                {v === "info" ? <List className="h-4 w-4" /> : <MapIcon className="h-4 w-4" />}
                {v === "info" ? "Day summary" : "Route"}
              </button>
            ))}
          </div>
        </header>

        <div className="flex-1 min-h-0 mx-auto max-w-[1600px] w-full px-3 sm:px-4 lg:px-6 pt-3 sm:pt-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:pb-4 flex flex-col lg:grid lg:gap-4 lg:grid-cols-[400px_1fr] lg:grid-rows-[minmax(0,1fr)]">
          <div
            className={`${mobileView === "info" || range ? "flex" : "hidden"} lg:flex flex-col flex-1 min-h-0`}
          >
            {infoPanel}
          </div>
          <div
            className={`${mobileView === "map" && !range ? "flex" : "hidden"} lg:flex flex-col flex-1 min-h-0`}
          >
            {mapPanel}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function TripChip({
  active,
  color,
  label,
  onClick,
}: {
  active: boolean;
  color: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-medium border shadow-soft backdrop-blur ${
        active
          ? "bg-background text-foreground border-foreground/30"
          : "bg-background/80 text-muted-foreground border-border"
      }`}
    >
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
      {label}
    </button>
  );
}

function Totals({ report }: { report: DayReport }) {
  const t = report.totals;
  const tiles = [
    {
      label: "Distance",
      value: `${t.distanceKm.toFixed(1)} km`,
      Icon: RouteIcon,
      color: "var(--primary)",
    },
    { label: "Driving", value: fmtDuration(t.drivingMs), Icon: Clock, color: "#22c55e" },
    { label: "Stops", value: String(t.stops), Icon: TimerReset, color: "#f59e0b" },
    {
      label: "Top speed",
      value: `${t.topSpeedKmh.toFixed(0)} km/h`,
      Icon: Gauge,
      color: "#ec4899",
    },
  ];
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-4 gap-1.5">
        {tiles.map((x) => (
          <div
            key={x.label}
            className="rounded-xl border border-border/50 bg-background/40 px-2 py-2 min-w-0"
          >
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <x.Icon className="h-3 w-3 shrink-0" /> <span className="truncate">{x.label}</span>
            </div>
            <div
              className="mt-0.5 font-display font-bold text-sm tabular-nums truncate"
              style={{ color: x.color }}
            >
              {x.value}
            </div>
          </div>
        ))}
      </div>
      <div className="text-xs text-muted-foreground">
        {t.trips === 0
          ? "No trips — parked all day."
          : `${t.trips} trip${t.trips > 1 ? "s" : ""} · ${fmtTime(t.firstStart!)}–${fmtTime(t.lastEnd!)} · engine on ${fmtDuration(t.engineOnMs)} · stopped ${fmtDuration(t.stoppedMs)} · parked ${fmtDuration(t.parkedMs)}`}
        {t.estimatedKm > 0.05 && (
          <span className="inline-flex items-center gap-1 ml-1">
            · <WifiOff className="h-3 w-3" /> {t.estimatedKm.toFixed(1)} km estimated (no signal)
          </span>
        )}
      </div>
      {t.signalLost > 0 && (
        <div className="flex items-center gap-1.5 rounded-lg border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
          <WifiOff className="h-3.5 w-3.5 shrink-0" />
          Connection lost {t.signalLost}× · {fmtDuration(t.signalLostMs)} without reports (shown
          below)
        </div>
      )}
    </div>
  );
}

type Event =
  | { kind: "parked"; at: number; p: DayReport["parked"][number] }
  | { kind: "trip"; at: number; t: DayReport["trips"][number] }
  | { kind: "lost"; at: number; g: DayReport["signalLost"][number] };

function Timeline({
  report,
  placeOf,
  driverAt,
  selected,
  onSelect,
}: {
  report: DayReport;
  placeOf: (p: LatLon) => string | null;
  driverAt: (iso: string) => string | null;
  selected: number | null;
  onSelect: (i: number | null) => void;
}) {
  const events: Event[] = [
    ...report.parked.map((p) => ({ kind: "parked" as const, at: Date.parse(p.from), p })),
    ...report.trips.map((t) => ({ kind: "trip" as const, at: Date.parse(t.startedAt), t })),
    ...report.signalLost.map((g) => ({ kind: "lost" as const, at: Date.parse(g.from), g })),
  ].sort((a, b) => a.at - b.at);

  return (
    <ol className="relative space-y-2 before:absolute before:left-[11px] before:top-2 before:bottom-2 before:w-px before:bg-border">
      {events.map((e) => {
        if (e.kind === "parked") {
          const p = e.p;
          return (
            <li
              key={`p${p.from}`}
              className="relative pl-8 text-xs text-muted-foreground flex items-center min-h-6"
            >
              <span className="absolute left-0 top-0 h-6 w-6 rounded-full bg-[#3b82f6]/15 text-[#3b82f6] grid place-items-center">
                <ParkingSquare className="h-3.5 w-3.5" />
              </span>
              <span className="truncate">
                Parked {fmtTime(p.from)}–{p.ongoing ? "now" : fmtTime(p.to)} · {fmtDuration(p.ms)}
              </span>
            </li>
          );
        }
        if (e.kind === "lost") {
          const g = e.g;
          return (
            <li
              key={`l${g.from}`}
              className="relative pl-8 text-xs text-destructive flex items-center min-h-6"
            >
              <span className="absolute left-0 top-0 h-6 w-6 rounded-full bg-destructive/15 grid place-items-center">
                <WifiOff className="h-3.5 w-3.5" />
              </span>
              <span className="min-w-0">
                <span className="font-medium">
                  Connection lost {fmtTime(g.from)}–{g.ongoing ? "now" : fmtTime(g.to)} ·{" "}
                  {fmtDuration(g.ms)}
                </span>
                <span className="text-muted-foreground">
                  {" "}
                  · {g.during === "trip" ? "on a trip" : "parked"}
                  {placeOf(g) ? ` · near ${placeOf(g)}` : ""}
                </span>
              </span>
            </li>
          );
        }
        const t = e.t;
        const color = tripColor(t.index);
        const driver = driverAt(t.startedAt);
        const active = selected === t.index;
        return (
          <li key={`t${t.index}`} className="relative pl-8">
            <span
              className="absolute left-0 top-2 h-6 w-6 rounded-full grid place-items-center text-[10px] font-bold text-white"
              style={{ background: color }}
            >
              {t.index}
            </span>
            <button
              onClick={() => onSelect(active ? null : t.index)}
              className={`w-full text-left rounded-xl border p-2.5 space-y-1 transition-colors ${
                active
                  ? "bg-accent border-foreground/20"
                  : "bg-background/40 border-border/50 hover:border-primary/40"
              }`}
              style={{ borderLeftColor: color, borderLeftWidth: 3 }}
            >
              <div className="flex items-baseline justify-between gap-2">
                <div className="text-sm font-semibold">
                  Trip {t.index} · {fmtTime(t.startedAt)}–{t.ongoing ? "now" : fmtTime(t.endedAt)}
                </div>
                <div className="text-xs font-semibold tabular-nums" style={{ color }}>
                  {t.distanceKm.toFixed(1)} km
                </div>
              </div>
              <div className="text-xs truncate">
                <span className="text-[#16a34a] font-bold">A</span>{" "}
                {t.start ? (placeOf(t.start) ?? "…") : "—"}
                <span className="text-muted-foreground"> → </span>
                <span className="text-[#dc2626] font-bold">B</span>{" "}
                {t.ongoing ? "on the road" : t.end ? (placeOf(t.end) ?? "…") : "—"}
              </div>
              <div className="text-[11px] text-muted-foreground flex flex-wrap gap-x-2">
                {driver && (
                  <span className="inline-flex items-center gap-1">
                    <User className="h-3 w-3" /> {driver}
                  </span>
                )}
                <span>{fmtDuration(t.drivingMs)} driving</span>
                <span>
                  {t.stops.length} stop{t.stops.length === 1 ? "" : "s"}
                  {t.stops.length > 0 && ` (${fmtDuration(t.stoppedMs)})`}
                </span>
                <span>top {t.topSpeedKmh.toFixed(0)} km/h</span>
                {t.gaps.length > 0 && (
                  <span className="text-destructive inline-flex items-center gap-1">
                    <WifiOff className="h-3 w-3" /> no signal{" "}
                    {fmtDuration(t.gaps.reduce((a, g) => a + g.ms, 0))}
                  </span>
                )}
              </div>
              {active && t.stops.length > 0 && (
                <ol className="space-y-1 pt-1.5 border-t border-border/40">
                  {t.stops.map((st, k) => (
                    <li key={k} className="text-xs flex gap-2 min-w-0">
                      <span className="h-4 w-4 shrink-0 rounded-full bg-[#f59e0b] text-black text-[9px] font-bold grid place-items-center mt-px">
                        {k + 1}
                      </span>
                      <span className="tabular-nums shrink-0">{fmtTime(st.startedAt)}</span>
                      <span className="text-muted-foreground shrink-0">{fmtDuration(st.ms)}</span>
                      <span className="text-muted-foreground truncate">{placeOf(st) ?? "…"}</span>
                    </li>
                  ))}
                </ol>
              )}
              {!active && t.stops.length > 0 && (
                <div className="text-[11px] text-primary">Tap to see the stops on the map</div>
              )}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function RangeView({
  range,
  allDays,
  loaded,
  busy,
  error,
  cut,
  onOpenDay,
}: {
  range: RangeSummary;
  allDays: string[];
  loaded: number;
  busy: boolean;
  error: string | null;
  cut: boolean;
  onOpenDay: (day: string) => void;
}) {
  const byDay = new Map(range.days.map((d) => [d.day, d]));
  const maxKm = Math.max(1, ...range.days.map((d) => d.distanceKm));
  const tiles = [
    { label: "Distance", value: `${range.distanceKm.toFixed(0)} km`, Icon: RouteIcon },
    { label: "Per week", value: `${range.perWeekKm.toFixed(0)} km`, Icon: CalendarRange },
    { label: "Driving", value: fmtDuration(range.drivingMs), Icon: Clock },
    { label: "Trips", value: String(range.trips), Icon: Activity },
  ];
  return (
    <div className="space-y-3">
      {busy && (
        <div className="text-xs text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading day {loaded} of {allDays.length}…
          totals update as days arrive
        </div>
      )}
      {error && <div className="text-xs text-destructive">{error}</div>}
      {cut && (
        <div className="text-xs text-muted-foreground">
          Showing the most recent {allDays.length} days of the dates you picked.
        </div>
      )}
      <div className="grid grid-cols-4 gap-1.5">
        {tiles.map((x) => (
          <div
            key={x.label}
            className="rounded-xl border border-border/50 bg-background/40 px-2 py-2 min-w-0"
          >
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <x.Icon className="h-3 w-3 shrink-0" /> <span className="truncate">{x.label}</span>
            </div>
            <div className="mt-0.5 font-display font-bold text-sm tabular-nums truncate">
              {x.value}
            </div>
          </div>
        ))}
      </div>
      <div className="text-xs text-muted-foreground space-y-0.5">
        <div>
          Used {range.activeDays} of {range.days.length} days · {range.perActiveDayKm.toFixed(0)} km
          on an average working day
          {range.trips > 0 && ` · top speed ${range.topSpeedKmh.toFixed(0)} km/h`}
        </div>
        {range.busiest && (
          <div>
            Busiest: {fmtShortDay(range.busiest.day)} · {range.busiest.distanceKm.toFixed(0)} km
          </div>
        )}
      </div>
      {range.signalLost > 0 && (
        <div className="flex items-center gap-1.5 rounded-lg border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
          <WifiOff className="h-3.5 w-3.5 shrink-0" />
          Connection lost {range.signalLost}× ({fmtDuration(range.signalLostMs)}): distance in those
          minutes may be missing
        </div>
      )}

      {range.weeks.length > 1 && (
        <div className="space-y-1">
          <div className="text-xs font-semibold">Week by week</div>
          <div className="rounded-xl border border-border/50 divide-y divide-border/40 overflow-hidden">
            {range.weeks.map((w) => (
              <div
                key={w.from}
                className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs"
              >
                <span className="text-muted-foreground">
                  {fmtShortDay(w.from)} – {fmtShortDay(w.to)}
                </span>
                <span className="tabular-nums">
                  <span className="font-semibold">{w.distanceKm.toFixed(0)} km</span>
                  <span className="text-muted-foreground">
                    {" "}
                    · {w.activeDays}/{w.days} days
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-1">
        <div className="text-xs font-semibold">Day by day · tap a day for its trips and map</div>
        <ol className="space-y-1">
          {[...allDays].reverse().map((day) => {
            const d = byDay.get(day);
            return (
              <li key={day}>
                <button
                  onClick={() => onOpenDay(day)}
                  title={d ? `${fmtShortDay(day)}: ${d.distanceKm.toFixed(1)} km` : undefined}
                  className="w-full text-left rounded-xl border border-border/50 bg-background/40 hover:border-primary/40 px-2.5 py-2 space-y-1.5 transition-colors"
                >
                  <div className="flex items-baseline justify-between gap-2 text-xs">
                    <span className="font-medium">{fmtShortDay(day)}</span>
                    {d ? (
                      <span className="tabular-nums">
                        <span className="font-semibold">{d.distanceKm.toFixed(1)} km</span>
                        <span className="text-muted-foreground">
                          {d.trips
                            ? ` · ${fmtDuration(d.drivingMs)} · ${d.trips} trip${d.trips > 1 ? "s" : ""}`
                            : d.hasData
                              ? " · parked"
                              : " · no data"}
                        </span>
                      </span>
                    ) : (
                      <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                    )}
                  </div>
                  <div className="h-1 rounded-full bg-muted overflow-hidden">
                    {d && d.distanceKm > 0 && (
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${Math.max(2, (d.distanceKm / maxKm) * 100)}%` }}
                      />
                    )}
                  </div>
                  {d && d.signalLost > 0 && (
                    <div className="text-[11px] text-destructive inline-flex items-center gap-1">
                      <WifiOff className="h-3 w-3" /> connection lost {d.signalLost}× ·{" "}
                      {fmtDuration(d.signalLostMs)}
                    </div>
                  )}
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
