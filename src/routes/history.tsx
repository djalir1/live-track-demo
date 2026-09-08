import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { format, startOfDay, endOfDay } from "date-fns";
import {
  MapPin,
  ArrowLeft,
  Download,
  Calendar,
  Loader2,
  Gauge,
  Route as RouteIcon,
  Clock,
  Square,
  Activity,
  List,
  Map as MapIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { getVehicle, type VehicleType } from "@/lib/vehicles";
import {
  buildTripSummary,
  formatDurationMinutes,
  type RawPoint,
  type TripSummary,
} from "@/lib/trip";
import { reverseGeocode, cachedReverseGeocode } from "@/lib/geocode";
import { friendlyError } from "@/lib/friendly-errors";
import { generateTripReport } from "@/lib/pdf";

const LiveMap = lazy(() => import("@/components/LiveMap").then((m) => ({ default: m.LiveMap })));

export const Route = createFileRoute("/history")({
  head: () => ({ meta: [{ title: "Trip History — Pulse" }] }),
  component: HistoryPage,
});

interface DriverOption {
  id: string;
  display_name: string;
  vehicle_name: string | null;
  vehicle_type: VehicleType;
  plate_number: string | null;
  seats: number | null;
}

function todayISO() {
  return format(new Date(), "yyyy-MM-dd");
}

function HistoryPage() {
  const { user, role, loading } = useAuth();
  const navigate = useNavigate();

  const [drivers, setDrivers] = useState<DriverOption[]>([]);
  const [driverId, setDriverId] = useState<string>("");
  const [date, setDate] = useState<string>(todayISO());
  const [busy, setBusy] = useState(false);
  const [trip, setTrip] = useState<TripSummary | null>(null);
  const [stopAddresses, setStopAddresses] = useState<Record<string, string>>({});
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
    (async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, display_name, vehicle_name, vehicle_type, plate_number, seats")
        .order("display_name");
      if (error) {
        toast.error(friendlyError(error, "Couldn't load drivers."));
        return;
      }
      setDrivers(data ?? []);
      if ((data?.length ?? 0) > 0) setDriverId((prev) => prev || data![0].id);
    })();
  }, [role]);

  const driver = useMemo(() => drivers.find((d) => d.id === driverId) ?? null, [drivers, driverId]);

  const loadTrip = async () => {
    if (!driverId || !date) return;
    setBusy(true);
    setTrip(null);
    try {
      const day = new Date(date + "T00:00:00");
      const dayStart = startOfDay(day).toISOString();
      const dayEnd = endOfDay(day).toISOString();
      const [pointsRes, sessionsRes] = await Promise.all([
        supabase
          .from("location_history")
          .select("latitude, longitude, speed_kmh, battery_level, recorded_at")
          .eq("user_id", driverId)
          .gte("recorded_at", dayStart)
          .lte("recorded_at", dayEnd)
          .order("recorded_at", { ascending: true }),
        // Any session that overlaps the day: started before day-end AND
        // (ended after day-start OR still open).
        supabase
          .from("trip_sessions")
          .select("started_at, ended_at")
          .eq("user_id", driverId)
          .lte("started_at", dayEnd)
          .or(`ended_at.gte.${dayStart},ended_at.is.null`),
      ]);
      if (pointsRes.error) throw pointsRes.error;
      if (sessionsRes.error) throw sessionsRes.error;
      const summary = buildTripSummary(
        (pointsRes.data ?? []) as RawPoint[],
        sessionsRes.data ?? [],
      );
      setTrip(summary);
    } catch (e) {
      toast.error(friendlyError(e, "Couldn't load this trip."));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (driverId && date) void loadTrip(); /* eslint-disable-next-line */
  }, [driverId, date]);

  useEffect(() => {
    if (!trip) return;
    let cancelled = false;
    (async () => {
      const next: Record<string, string> = {};
      for (const s of trip.stops) {
        const key = `${s.lat.toFixed(4)},${s.lon.toFixed(4)}`;
        const cached = cachedReverseGeocode(s.lat, s.lon);
        if (cached) next[key] = cached;
        else {
          const label = await reverseGeocode(s.lat, s.lon);
          if (cancelled) return;
          if (label) next[key] = label;
          setStopAddresses((prev) => ({ ...prev, ...next }));
        }
      }
      setStopAddresses((prev) => ({ ...prev, ...next }));
    })();
    return () => {
      cancelled = true;
    };
  }, [trip]);

  const routePoints = useMemo<[number, number][]>(
    () => (trip?.points ?? []).map((p) => [p.latitude, p.longitude]),
    [trip],
  );
  const stopsForMap = useMemo(
    () =>
      (trip?.stops ?? []).map((s) => ({
        lat: s.lat,
        lon: s.lon,
        label:
          stopAddresses[`${s.lat.toFixed(4)},${s.lon.toFixed(4)}`] ??
          `${s.lat.toFixed(4)}, ${s.lon.toFixed(4)}`,
        when: `${format(new Date(s.startedAt), "p")} — ${format(new Date(s.endedAt), "p")} (${formatDurationMinutes(s.durationMinutes)})`,
      })),
    [trip, stopAddresses],
  );

  const onExportPdf = async () => {
    if (!trip || !driver) return;
    setPdfBusy(true);
    try {
      await generateTripReport({
        driverName: driver.display_name,
        vehicleName: driver.vehicle_name,
        vehicleType: driver.vehicle_type,
        plateNumber: driver.plate_number,
        seats: driver.seats,
        date: new Date(date + "T00:00:00"),
        trip,
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

  const infoPanel = (
    <aside className="rounded-2xl bg-gradient-card border border-border/60 shadow-soft flex flex-col overflow-hidden h-full">
      <div className="p-3 sm:p-4 space-y-3 border-b border-border/50 shrink-0">
        <div className="space-y-2">
          <Label htmlFor="driver">Driver</Label>
          <select
            id="driver"
            value={driverId}
            onChange={(e) => setDriverId(e.target.value)}
            className="w-full h-10 rounded-md bg-background/50 border border-input px-3 text-sm"
          >
            {drivers.length === 0 && <option value="">No drivers yet</option>}
            {drivers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.display_name}
                {d.vehicle_name ? ` — ${d.vehicle_name}` : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="date">Date</Label>
          <div className="relative">
            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              id="date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              max={todayISO()}
              className="pl-9 h-10"
            />
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3 min-h-0">
        {busy && (
          <div className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading trip…
          </div>
        )}
        {!busy && trip && trip.points.length === 0 && (
          <div className="text-sm text-muted-foreground text-center py-8">
            <Activity className="h-6 w-6 mx-auto mb-2 opacity-40" />
            No trip data recorded on this day.
          </div>
        )}
        {!busy && trip && trip.points.length > 0 && driver && (
          <>
            <SummaryTiles trip={trip} />
            <div className="rounded-xl border border-border/50 bg-background/40 p-3 space-y-2 text-sm">
              <div className="text-xs text-muted-foreground uppercase tracking-wider">Driver</div>
              <div className="flex items-center gap-2">
                {(() => {
                  const V = getVehicle(driver.vehicle_type).Icon;
                  return <V size={22} className="text-primary" />;
                })()}
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">{driver.display_name}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {getVehicle(driver.vehicle_type).label}
                    {driver.vehicle_name ? ` · ${driver.vehicle_name}` : ""}
                  </div>
                </div>
                {driver.plate_number && (
                  <span className="font-mono font-bold text-xs bg-muted px-2 py-1 rounded shrink-0">
                    {driver.plate_number}
                  </span>
                )}
              </div>
              {driver.seats != null && (
                <div className="text-xs text-muted-foreground">
                  Seats: <span className="font-medium text-foreground">{driver.seats}</span>
                </div>
              )}
            </div>
            {trip.gaps.length > 0 && (
              <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-3 space-y-2">
                <div className="text-xs text-destructive uppercase tracking-wider">
                  Signal lost ({trip.gaps.length})
                </div>
                <ul className="space-y-1.5 text-xs">
                  {trip.gaps.map((g, i) => (
                    <li key={i} className="flex items-center justify-between gap-2">
                      <span className="tabular-nums">
                        {format(new Date(g.from), "HH:mm")}–{format(new Date(g.to), "HH:mm")}
                      </span>
                      <span className="text-muted-foreground">
                        {formatDurationMinutes(g.durationMinutes)} · jump {g.jumpedKm.toFixed(1)} km
                        discarded
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {trip.stops.length > 0 && (
              <div className="rounded-xl border border-border/50 bg-background/40 p-3 space-y-2">
                <div className="text-xs text-muted-foreground uppercase tracking-wider">
                  Stops ({trip.stops.length})
                </div>
                <ol className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {trip.stops.map((s, i) => {
                    const key = `${s.lat.toFixed(4)},${s.lon.toFixed(4)}`;
                    return (
                      <li
                        key={i}
                        className="text-xs bg-background/50 rounded-lg p-2 border border-border/40"
                      >
                        <div className="flex items-center gap-2">
                          <span className="h-5 w-5 rounded-full bg-[var(--idle)] text-black grid place-items-center text-[10px] font-bold shrink-0">
                            {i + 1}
                          </span>
                          <div className="min-w-0">
                            <div className="truncate font-medium">
                              {stopAddresses[key] ?? "Locating…"}
                            </div>
                            <div className="text-muted-foreground">
                              {format(new Date(s.startedAt), "p")} ·{" "}
                              {formatDurationMinutes(s.durationMinutes)}
                            </div>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );

  const mapPanel = (
    <section className="rounded-2xl bg-gradient-card border border-border/60 shadow-soft overflow-hidden h-full min-h-[50vh]">
      <Suspense
        fallback={
          <div className="h-full w-full grid place-items-center text-muted-foreground">
            <Activity className="h-5 w-5 animate-pulse mr-2" /> Loading map…
          </div>
        }
      >
        <LiveMap
          users={
            driver && trip && trip.points.length > 0
              ? [
                  {
                    user_id: driver.id,
                    display_name: driver.display_name,
                    vehicle_name: driver.vehicle_name,
                    vehicle_type: driver.vehicle_type,
                    plate_number: driver.plate_number,
                    seats: driver.seats,
                    status: "stopped",
                    latitude: trip.points[trip.points.length - 1].latitude,
                    longitude: trip.points[trip.points.length - 1].longitude,
                    speed_kmh: trip.points[trip.points.length - 1].speed_kmh,
                    heading: null,
                    battery_level: trip.points[trip.points.length - 1].battery_level,
                    is_tracking: false,
                    last_seen: trip.points[trip.points.length - 1].recorded_at,
                  },
                ]
              : []
          }
          routePoints={routePoints}
          stops={stopsForMap}
        />
      </Suspense>
    </section>
  );

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col">
      <header className="sticky top-0 z-30 backdrop-blur-xl bg-background/70 border-b border-border/50">
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
              <span className="hidden sm:inline">Pulse</span>
            </Link>
            <span className="hidden md:inline-block text-xs uppercase tracking-wider text-muted-foreground border-l border-border pl-3">
              Trip History
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={onExportPdf}
              disabled={!trip || pdfBusy || (trip?.points.length ?? 0) === 0}
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
        </div>

        {/* Mobile-only view switcher */}
        <div className="lg:hidden mx-auto max-w-[1600px] px-3 pb-2 flex gap-2">
          <button
            onClick={() => setMobileView("info")}
            className={`flex-1 flex items-center justify-center gap-1.5 h-9 rounded-full text-xs font-medium border transition-all ${
              mobileView === "info"
                ? "bg-primary text-primary-foreground border-primary shadow-glow"
                : "bg-background/50 border-border text-muted-foreground"
            }`}
          >
            <List className="h-4 w-4" /> Trip details
          </button>
          <button
            onClick={() => setMobileView("map")}
            className={`flex-1 flex items-center justify-center gap-1.5 h-9 rounded-full text-xs font-medium border transition-all ${
              mobileView === "map"
                ? "bg-primary text-primary-foreground border-primary shadow-glow"
                : "bg-background/50 border-border text-muted-foreground"
            }`}
          >
            <MapIcon className="h-4 w-4" /> Route
          </button>
        </div>
      </header>

      <div className="flex-1 mx-auto max-w-[1600px] w-full px-3 sm:px-4 lg:px-6 py-3 sm:py-4 lg:grid lg:gap-4 lg:grid-cols-[360px_1fr] min-h-0">
        <div
          className={`${mobileView === "info" ? "flex" : "hidden"} lg:flex flex-col h-[calc(100dvh-8.5rem)] sm:h-[calc(100dvh-9rem)] lg:h-[calc(100dvh-6rem)]`}
        >
          {infoPanel}
        </div>
        <div
          className={`${mobileView === "map" ? "flex" : "hidden"} lg:flex flex-col h-[calc(100dvh-8.5rem)] sm:h-[calc(100dvh-9rem)] lg:h-[calc(100dvh-6rem)]`}
        >
          {mapPanel}
        </div>
      </div>
    </div>
  );
}

function SummaryTiles({ trip }: { trip: TripSummary }) {
  const tiles = [
    {
      label: "Distance",
      value: `${trip.totalDistanceKm.toFixed(2)} km`,
      Icon: RouteIcon,
      color: "var(--primary)",
    },
    {
      label: "Driving time",
      value: formatDurationMinutes(trip.totalMovingMinutes),
      Icon: Clock,
      color: "var(--moving)",
    },
    {
      label: "Stopped time",
      value: formatDurationMinutes(trip.totalStoppedMinutes),
      Icon: Square,
      color: "var(--idle)",
    },
    {
      label: "Top speed",
      value: `${trip.topSpeedKmh.toFixed(0)} km/h`,
      Icon: Gauge,
      color: "var(--stopped)",
    },
  ];
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="grid grid-cols-2 gap-2"
    >
      {tiles.map((t) => (
        <div key={t.label} className="rounded-xl border border-border/50 bg-background/40 p-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <t.Icon className="h-3.5 w-3.5" /> {t.label}
          </div>
          <div
            className="mt-1 font-display font-bold text-lg tabular-nums"
            style={{ color: t.color }}
          >
            {t.value}
          </div>
        </div>
      ))}
    </motion.div>
  );
}
