import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
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
  Power,
  TimerReset,
  WifiOff,
  User,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth-context";
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

const placeKey = (p: LatLon) => `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;

function shiftDay(day: string, by: number) {
  const d = new Date(`${day}T12:00:00+02:00`);
  d.setUTCDate(d.getUTCDate() + by);
  return d.toISOString().slice(0, 10);
}

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

  useEffect(() => {
    if (loading) return;
    if (!user) {
      navigate({ to: "/auth" });
      return;
    }
    if (role === null) return;
    if (role !== "admin") navigate({ to: "/track" });
  }, [loading, user, role, navigate]);

  useEffect(() => {
    if (role !== "admin") return;
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
      });
    }
    return out;
  }, [fleet]);

  useEffect(() => {
    if (!subjectKey && subjects.length) setSubjectKey(subjects[0].key);
  }, [subjects, subjectKey]);
  const subject = subjects.find((s) => s.key === subjectKey) ?? null;

  useEffect(() => {
    if (!subject || !date) return;
    let cancelled = false;
    (async () => {
      setBusy(true);
      setReport(null);
      setSelectedTrip(null);
      try {
        const { start, end } = kigaliDayRange(date);
        const [pointsRes, beforeRes, sessionsRes, assignRes] = await Promise.all([
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
          subject.busId
            ? db
                .from("vehicle_assignments")
                .select("id, bus_id, driver_id, started_at, ended_at")
                .eq("bus_id", subject.busId)
                .lt("started_at", end)
                .or(`ended_at.gte.${start},ended_at.is.null`)
            : Promise.resolve({ data: [], error: null }),
        ]);
        for (const r of [pointsRes, beforeRes, sessionsRes, assignRes]) if (r.error) throw r.error;
        if (cancelled) return;
        setAssignments((assignRes.data ?? []) as Assignment[]);
        setReport(
          buildDayReport(
            (pointsRes.data ?? []) as RawPoint[],
            (sessionsRes.data ?? []) as SessionRow[],
            {
              from: start,
              to: end,
              now: serverNow(),
              before: (beforeRes.data?.[0] as RawPoint | undefined) ?? null,
            },
          ),
        );
      } catch (e) {
        if (!cancelled) toast.error(friendlyError(e, "Couldn't load this day."));
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [subject?.userId, subject?.busId, date]); // eslint-disable-line react-hooks/exhaustive-deps

  // Street names for every place shown (trip ends, stops, parking spots).
  const placeList = useMemo<LatLon[]>(() => {
    if (!report) return [];
    const all: LatLon[] = [];
    for (const t of report.trips) {
      if (t.start) all.push(t.start);
      all.push(...t.stops);
      if (t.end) all.push(t.end);
    }
    all.push(...report.parked);
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
    if (!report || !subject) return;
    setPdfBusy(true);
    try {
      const { generateDayReportPdf } = await import("@/lib/pdf");
      await generateDayReportPdf({
        vehicle: subject.title,
        plate: subject.plate,
        day: date,
        report,
        driverAt,
      });
      toast.success("PDF report downloaded");
    } catch (e) {
      toast.error(friendlyError(e, "Couldn't build the PDF report."));
    } finally {
      setPdfBusy(false);
    }
  };

  if (loading || role !== "admin") {
    return (
      <div className="min-h-screen bg-background grid place-items-center">
        <div className="flex items-center gap-3 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <span>Loading…</span>
        </div>
      </div>
    );
  }

  const today = todayKigali();
  const hasData = !!report && report.pointCount > 0;

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
          <Label htmlFor="date">Day</Label>
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
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3 min-h-0">
        {busy && (
          <div className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading the day…
          </div>
        )}
        {!busy && report && !hasData && (
          <div className="text-sm text-muted-foreground text-center py-8">
            <Activity className="h-6 w-6 mx-auto mb-2 opacity-40" />
            Nothing recorded on {fmtLongDate(`${date}T12:00:00+02:00`)}.
          </div>
        )}
        {!busy && report && hasData && (
          <>
            <Totals report={report} />
            {report.trips.length === 0 && (
              <div className="rounded-xl border border-border/50 bg-background/40 p-3 text-sm text-muted-foreground">
                No trips — the vehicle stayed parked all day.
              </div>
            )}
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
          trips={report?.trips ?? []}
          selected={selectedTrip}
          onSelect={setSelectedTrip}
          placeOf={placeOf}
        />
      </Suspense>
      {report && report.trips.length > 1 && (
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
    <div className="h-[100dvh] bg-background flex flex-col overflow-hidden">
      <header className="shrink-0 z-30 pt-safe backdrop-blur-xl bg-background/70 border-b border-border/50">
        <div className="mx-auto max-w-[1600px] px-3 sm:px-4 lg:px-6 h-14 sm:h-16 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <Button asChild variant="ghost" size="sm" className="px-2 sm:px-3">
              <Link to="/dashboard">
                <ArrowLeft className="h-4 w-4 sm:mr-1.5" />
                <span className="hidden sm:inline">Dashboard</span>
              </Link>
            </Button>
            <Link to="/" className="flex items-center gap-2 font-display font-bold shrink-0">
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
            disabled={!hasData || pdfBusy}
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

        <div className="lg:hidden mx-auto max-w-[1600px] px-3 pb-2 flex gap-2">
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
          className={`${mobileView === "info" ? "flex" : "hidden"} lg:flex flex-col flex-1 min-h-0`}
        >
          {infoPanel}
        </div>
        <div
          className={`${mobileView === "map" ? "flex" : "hidden"} lg:flex flex-col flex-1 min-h-0`}
        >
          {mapPanel}
        </div>
      </div>
    </div>
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
    { label: "Engine on", value: fmtDuration(t.engineOnMs), Icon: Power, color: "#6366f1" },
    {
      label: "Stopped, engine on",
      value: fmtDuration(t.stoppedMs),
      Icon: TimerReset,
      color: "#f59e0b",
    },
    { label: "Parked", value: fmtDuration(t.parkedMs), Icon: ParkingSquare, color: "#3b82f6" },
    {
      label: "Top / avg speed",
      value: `${t.topSpeedKmh.toFixed(0)} / ${t.avgMovingKmh.toFixed(0)} km/h`,
      Icon: Gauge,
      color: "#ec4899",
    },
  ];
  return (
    <div className="space-y-2">
      <div className="text-xs text-muted-foreground">
        {t.trips === 0
          ? "No trips"
          : `${t.trips} trip${t.trips > 1 ? "s" : ""} · ${t.stops} stop${t.stops === 1 ? "" : "s"} · first start ${fmtTime(t.firstStart!)} · last stop ${fmtTime(t.lastEnd!)}`}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {tiles.map((x) => (
          <div key={x.label} className="rounded-xl border border-border/50 bg-background/40 p-2.5">
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <x.Icon className="h-3.5 w-3.5 shrink-0" />{" "}
              <span className="truncate">{x.label}</span>
            </div>
            <div
              className="mt-0.5 font-display font-bold text-base tabular-nums"
              style={{ color: x.color }}
            >
              {x.value}
            </div>
          </div>
        ))}
      </div>
      {t.estimatedKm > 0.05 && (
        <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
          <WifiOff className="h-3.5 w-3.5 shrink-0 mt-px" />
          Signal was lost {t.gaps} time{t.gaps > 1 ? "s" : ""} while driving ({fmtDuration(t.gapMs)}
          ); {t.estimatedKm.toFixed(1)} km of the distance is estimated as a straight line across
          those gaps.
        </p>
      )}
    </div>
  );
}

type Event =
  | { kind: "parked"; at: number; p: DayReport["parked"][number] }
  | { kind: "trip"; at: number; t: DayReport["trips"][number] };

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
  ].sort((a, b) => a.at - b.at);

  return (
    <ol className="relative space-y-2 before:absolute before:left-[11px] before:top-2 before:bottom-2 before:w-px before:bg-border">
      {events.map((e) => {
        if (e.kind === "parked") {
          const p = e.p;
          return (
            <li key={`p${p.from}`} className="relative pl-8">
              <span className="absolute left-0 top-1.5 h-6 w-6 rounded-full bg-[#3b82f6]/15 text-[#3b82f6] grid place-items-center">
                <ParkingSquare className="h-3.5 w-3.5" />
              </span>
              <div className="text-xs">
                <span className="font-medium">
                  Parked {fmtTime(p.from)}–{p.ongoing ? "now" : fmtTime(p.to)}
                </span>
                <span className="text-muted-foreground"> · {fmtDuration(p.ms)}</span>
              </div>
              <div className="text-xs text-muted-foreground truncate">
                {placeOf(p) ?? "Locating…"}
              </div>
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
              className={`w-full text-left rounded-xl border p-3 space-y-2 transition-colors ${
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
              {driver && (
                <div className="text-xs text-muted-foreground flex items-center gap-1">
                  <User className="h-3 w-3" /> {driver}
                </div>
              )}
              <div className="text-xs space-y-0.5">
                <div className="flex gap-1.5 min-w-0">
                  <span className="h-4 w-4 shrink-0 rounded-full bg-[#16a34a] text-white text-[9px] font-bold grid place-items-center">
                    A
                  </span>
                  <span className="truncate">
                    {t.start ? (placeOf(t.start) ?? "Locating…") : "—"}
                  </span>
                </div>
                <div className="flex gap-1.5 min-w-0">
                  <span className="h-4 w-4 shrink-0 rounded-full bg-[#dc2626] text-white text-[9px] font-bold grid place-items-center">
                    B
                  </span>
                  <span className="truncate">
                    {t.ongoing ? "On the road" : t.end ? (placeOf(t.end) ?? "Locating…") : "—"}
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-1.5 text-[11px]">
                <Mini label="Driving" value={fmtDuration(t.drivingMs)} />
                <Mini label="Stopped" value={fmtDuration(t.stoppedMs)} />
                <Mini label="Top speed" value={`${t.topSpeedKmh.toFixed(0)} km/h`} />
              </div>
              {t.stops.length > 0 && (
                <ol className="space-y-1 pt-1 border-t border-border/40">
                  {t.stops.map((s, i) => (
                    <li key={i} className="text-xs flex gap-2">
                      <span className="h-4 w-4 shrink-0 rounded-full bg-[#f59e0b] text-black text-[9px] font-bold grid place-items-center mt-px">
                        {i + 1}
                      </span>
                      <span className="min-w-0">
                        <span className="tabular-nums">
                          {fmtTime(s.startedAt)}–{fmtTime(s.endedAt)}
                        </span>
                        <span className="text-muted-foreground"> · {fmtDuration(s.ms)} · </span>
                        <span className="text-muted-foreground">{placeOf(s) ?? "Locating…"}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              )}
              {t.gaps.length > 0 && (
                <div className="text-[11px] text-destructive flex items-center gap-1">
                  <WifiOff className="h-3 w-3" /> Signal lost {t.gaps.length}× (
                  {fmtDuration(t.gaps.reduce((a, g) => a + g.ms, 0))})
                </div>
              )}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-background/60 border border-border/40 px-2 py-1">
      <div className="text-muted-foreground">{label}</div>
      <div className="font-semibold tabular-nums">{value}</div>
    </div>
  );
}
