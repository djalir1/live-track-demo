import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Search,
  LogOut,
  Sun,
  Moon,
  MapPin,
  Smartphone,
  Activity,
  History,
  Bell,
  Loader2,
  List,
  Map as MapIcon,
  Battery,
  BatteryWarning,
  PowerOff,
  Bus,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme";
import { supabase } from "@/integrations/supabase/client";
import type { LiveUser, TrackingStatus } from "@/types/tracking";
import { getVehicle } from "@/lib/vehicles";
import { reverseGeocode, cachedReverseGeocode } from "@/lib/geocode";
import { STATUS_COLOR, STATUS_LABEL, deviceHealth } from "@/lib/status";
import { db } from "@/lib/fleet";
import { ago, serverNow, syncServerClock } from "@/lib/time";
import type { Database } from "@/integrations/supabase/types";

const LiveMap = lazy(() => import("@/components/LiveMap").then((m) => ({ default: m.LiveMap })));

export const Route = createFileRoute("/dashboard")({
  head: () => ({ meta: [{ title: "Admin Dashboard — Live Track" }] }),
  component: Dashboard,
});

const FILTERS: { key: "all" | TrackingStatus; label: string }[] = [
  { key: "all", label: "All" },
  { key: "moving", label: "Moving" },
  { key: "stopped", label: STATUS_LABEL.stopped },
  { key: "idle", label: STATUS_LABEL.idle },
  { key: "offline", label: "Offline" },
];

const DOT = STATUS_COLOR;

type DeviceRow = Database["public"]["Tables"]["device_status"]["Row"];
type ProfileLite = Pick<
  Database["public"]["Tables"]["profiles"]["Row"],
  "id" | "display_name" | "vehicle_name" | "vehicle_type" | "plate_number" | "seats"
>;
interface Meta {
  profiles: Map<string, ProfileLite>;
  driverIds: Set<string>;
  trackerDrivers: Set<string | null>;
}
// ~100 m cell, the granularity street names are looked up at.
const addrKey = (lat: number | null, lon: number | null) =>
  `${(lat ?? 0).toFixed(3)},${(lon ?? 0).toFixed(3)}`;

function Dashboard() {
  const { user, role, loading, signOut } = useAuth();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | TrackingStatus>("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<"list" | "map">("list");

  useEffect(() => {
    if (loading) return;
    if (!user) {
      navigate({ to: "/auth" });
      return;
    }
    if (role === null) return;
    if (role !== "admin") navigate({ to: "/track" });
  }, [user, role, loading, navigate]);

  // Device rows come in by realtime, one vehicle at a time; names/roles change
  // rarely and are refreshed every minute. Nothing is re-queried per GPS fix.
  const [rows, setRows] = useState<Map<string, DeviceRow>>(new Map());
  const [meta, setMeta] = useState<Meta | null>(null);
  const [addresses, setAddresses] = useState<Record<string, string>>({});
  const [, setTick] = useState(0);

  const loadMeta = async (): Promise<boolean> => {
    const [statusesRes, profilesRes, driversRes, trackersRes] = await Promise.all([
      supabase.from("device_status").select("*"),
      supabase
        .from("profiles")
        .select("id, display_name, vehicle_name, vehicle_type, plate_number, seats"),
      // Only accounts explicitly assigned the 'user' (driver) role can appear
      // in the live list. Admin/parent/school_admin accounts are excluded.
      supabase.from("user_roles").select("user_id").eq("role", "user"),
      // Drivers whose vehicle carries a hardware GPS tracker.
      db.from("buses").select("driver_user_id").not("gps_imei", "is", null),
    ]);
    const err = statusesRes.error ?? profilesRes.error ?? driversRes.error ?? trackersRes.error;
    if (err) {
      // Keep showing the last good data (never blank the map on a hiccup). An
      // expired session after the phone slept is the usual cause: refresh it.
      console.error("[dashboard] load error", err);
      if (/jwt|token|401/i.test(`${err.message} ${(err as { code?: string }).code ?? ""}`)) {
        await supabase.auth.refreshSession().catch(() => null);
      }
      return false;
    }
    setMeta({
      profiles: new Map((profilesRes.data ?? []).map((p) => [p.id, p])),
      driverIds: new Set((driversRes.data ?? []).map((r) => r.user_id)),
      trackerDrivers: new Set(
        ((trackersRes.data ?? []) as { driver_user_id: string | null }[]).map(
          (b) => b.driver_user_id,
        ),
      ),
    });
    setRows(new Map((statusesRes.data ?? []).map((r) => [r.user_id, r as DeviceRow])));
    return true;
  };

  useEffect(() => {
    if (role !== "admin") return;
    void syncServerClock();
    let failures = 0;
    const refresh = async () => {
      const ok = await loadMeta();
      failures = ok ? 0 : failures + 1;
      if (failures === 3) toast.error("Can't reach the server — showing the last known positions.");
    };
    void refresh();
    const ch = supabase
      .channel("device_status_realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "device_status" },
        (payload) => {
          const row = (payload.new ?? null) as DeviceRow | null;
          if (!row?.user_id) return;
          setRows((prev) => new Map(prev).set(row.user_id, row));
        },
      )
      .subscribe();
    const metaTimer = window.setInterval(refresh, 60_000);
    // Re-evaluate freshness (moving -> offline) without any network traffic.
    const tickTimer = window.setInterval(() => setTick((n) => n + 1), 5_000);
    // Phone back from sleep: resync the clock and catch up immediately.
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void syncServerClock(true);
      void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      supabase.removeChannel(ch);
      window.clearInterval(metaTimer);
      window.clearInterval(tickTimer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [role]);

  const now = serverNow();
  const users: LiveUser[] = [];
  if (meta) {
    for (const s of rows.values()) {
      if (!meta.driverIds.has(s.user_id)) continue;
      const p = meta.profiles.get(s.user_id);
      // Presence = freshness, measured on the server's clock. Phones upsert
      // about every 8 s while tracking. Hardware trackers report every 10 s with
      // ignition on but only every 5 min parked (TIMER,10,300#) plus a 3-min
      // heartbeat, so they get a wider window.
      const gpsTracker = meta.trackerDrivers.has(s.user_id);
      const freshMs = gpsTracker ? (s.is_tracking ? 60_000 : 7 * 60_000) : 45_000;
      const ageMs = now - new Date(s.last_seen).getTime();
      const fresh = ageMs < freshMs;
      // gps_fix / satellites come from migration 20261015090000 (not in the generated types).
      const extra = s as DeviceRow & { gps_fix?: boolean | null; satellites?: number | null };
      users.push({
        user_id: s.user_id,
        display_name: p?.display_name ?? "Unknown",
        vehicle_name: p?.vehicle_name ?? null,
        vehicle_type: p?.vehicle_type ?? "car",
        plate_number: p?.plate_number ?? null,
        seats: p?.seats ?? null,
        status: fresh ? s.status : "offline",
        latitude: s.latitude,
        longitude: s.longitude,
        speed_kmh: fresh ? s.speed_kmh : 0,
        heading: s.heading ?? null,
        battery_level: s.battery_level,
        is_tracking: fresh && s.is_tracking,
        last_seen: s.last_seen,
        address:
          addresses[addrKey(s.latitude, s.longitude)] ??
          cachedReverseGeocode(s.latitude, s.longitude),
        gps_tracker: gpsTracker,
        health: deviceHealth({
          gpsTracker,
          fresh,
          ageMs,
          engineOn: s.is_tracking,
          gpsFix: extra.gps_fix,
          satellites: extra.satellites,
        }),
      });
    }
  }

  // Street names: at most one lookup per ~100 m cell (geocode.ts caches and
  // rate-limits to 1/s), so a moving fleet doesn't hammer the geocoder.
  const addrNeeded = users
    .filter((u) => u.latitude != null && !u.address)
    .map((u) => addrKey(u.latitude, u.longitude))
    .join("|");
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const key of addrNeeded ? addrNeeded.split("|") : []) {
        const [lat, lon] = key.split(",").map(Number);
        const label = await reverseGeocode(lat, lon);
        if (cancelled) return;
        if (label) setAddresses((prev) => ({ ...prev, [key]: label }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [addrNeeded]);

  // The list is filtered by status + search. The MAP still shows every driver
  // so admins never lose sight of a vehicle when they narrow the filter.
  const filteredList = (() => {
    return users.filter((u) => {
      if (filter !== "all" && u.status !== filter) return false;
      if (
        search &&
        !`${u.display_name} ${u.vehicle_name ?? ""} ${u.plate_number ?? ""} ${u.address ?? ""}`
          .toLowerCase()
          .includes(search.toLowerCase())
      )
        return false;
      return true;
    });
  })();

  const counts = ((): Record<"all" | TrackingStatus, number> => ({
    all: users.length,
    moving: users.filter((u) => u.status === "moving").length,
    stopped: users.filter((u) => u.status === "stopped").length,
    idle: users.filter((u) => u.status === "idle").length,
    offline: users.filter((u) => u.status === "offline").length,
  }))();

  // Buses that are actively online right now — moving buses first (most
  // urgent), then idle, then parked. Offline devices are excluded so the strip
  // only shows what an admin can currently intervene on.
  const activeBuses = (() => {
    const order: Record<TrackingStatus, number> = { moving: 0, stopped: 1, idle: 2, offline: 3 };
    return users
      .filter((u) => u.status !== "offline" && u.is_tracking && u.latitude != null)
      .sort((a, b) => order[a.status] - order[b.status] || (b.speed_kmh ?? 0) - (a.speed_kmh ?? 0));
  })();

  if (loading || role !== "admin") {
    return (
      <div className="min-h-screen bg-background grid place-items-center">
        <div className="flex items-center gap-3 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <span>Loading dashboard…</span>
        </div>
      </div>
    );
  }

  const listPanel = (
    <aside className="rounded-2xl bg-gradient-card border border-border/60 shadow-soft flex flex-col overflow-hidden flex-1 min-h-0">
      <div className="p-3 sm:p-4 border-b border-border/50 space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, plate, vehicle or street…"
            className="pl-9 h-10"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => {
            const key = f.key === "all" ? "all" : f.key;
            return (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-all ${
                  filter === f.key
                    ? "bg-primary text-primary-foreground border-primary shadow-glow"
                    : "bg-background/50 border-border hover:border-primary/40"
                }`}
              >
                {f.label}
                <span className="ml-1.5 opacity-70">{counts[key]}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 min-h-0">
        {filteredList.length === 0 && (
          <div className="text-center text-sm text-muted-foreground py-12 px-4">
            <Smartphone className="h-8 w-8 mx-auto mb-3 opacity-50" />
            No devices match. Have drivers sign up and tap <b>Start tracking</b>.
          </div>
        )}
        {filteredList.map((u) => {
          const v = getVehicle(u.vehicle_type);
          const phoneOff = !u.is_tracking;
          const lowBattery = (u.battery_level ?? 100) <= 20;
          return (
            <motion.button
              key={u.user_id}
              onClick={() => {
                setSelected(u.user_id);
                setMobileView("map");
              }}
              whileTap={{ scale: 0.98 }}
              className={`w-full text-left p-3 rounded-xl mb-1 transition-colors flex items-center gap-3 ${
                selected === u.user_id ? "bg-accent" : "hover:bg-accent/50"
              }`}
            >
              <span
                className="h-11 w-11 rounded-xl grid place-items-center shrink-0 text-white"
                style={{ background: DOT[u.status] }}
              >
                <v.Icon size={22} />
              </span>
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate flex items-center gap-2">
                  {u.display_name}
                  {u.status === "moving" && (
                    <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--moving)]/15 text-[var(--moving)]">
                      Live
                    </span>
                  )}
                  {phoneOff && (
                    <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground inline-flex items-center gap-1">
                      <PowerOff className="h-2.5 w-2.5" />{" "}
                      {u.gps_tracker ? "Engine off" : "Phone off"}
                    </span>
                  )}
                  {u.health && (
                    <span
                      title={u.health.detail}
                      className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded inline-flex items-center gap-1 ${
                        u.health.tone === "error"
                          ? "bg-destructive/15 text-destructive"
                          : "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                      }`}
                    >
                      <AlertTriangle className="h-2.5 w-2.5" /> {u.health.short}
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground truncate flex items-center gap-1.5">
                  {v.label}
                  {u.vehicle_name ? ` · ${u.vehicle_name}` : ""}
                  {u.plate_number && (
                    <span className="font-mono font-bold text-[10px] bg-muted px-1.5 py-0.5 rounded text-foreground">
                      {u.plate_number}
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground truncate mt-0.5 flex items-center gap-2">
                  <span>{u.speed_kmh?.toFixed(0) ?? 0} km/h</span>
                  {u.address && <span className="truncate">📍 {u.address}</span>}
                </div>
              </div>
              <div className="text-right text-xs shrink-0 space-y-0.5">
                <div
                  className={`flex items-center justify-end gap-1 font-semibold ${lowBattery ? "text-destructive" : "text-muted-foreground"}`}
                >
                  {lowBattery ? (
                    <BatteryWarning className="h-3 w-3" />
                  ) : (
                    <Battery className="h-3 w-3" />
                  )}
                  {u.battery_level ?? "—"}%
                </div>
                <div className="text-muted-foreground">{ago(u.last_seen)}</div>
              </div>
            </motion.button>
          );
        })}
      </div>
    </aside>
  );

  const mapPanel = (
    <section className="rounded-2xl bg-gradient-card border border-border/60 shadow-soft overflow-hidden h-full min-h-0 flex-1">
      <Suspense
        fallback={
          <div className="h-full w-full grid place-items-center text-muted-foreground">
            <Activity className="h-5 w-5 animate-pulse mr-2" /> Loading map…
          </div>
        }
      >
        {/* Always render EVERY driver on the map — filtering only affects the list. */}
        <LiveMap users={users} selectedId={selected} />
      </Suspense>
    </section>
  );

  return (
    <div className="h-[100dvh] bg-background flex flex-col overflow-hidden">
      <header className="shrink-0 z-30 backdrop-blur-xl bg-background/70 border-b border-border/50 pt-safe">
        <div className="mx-auto max-w-[1600px] px-3 sm:px-4 lg:px-6 h-14 sm:h-16 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <Link to="/" className="flex items-center gap-2 font-display font-bold shrink-0">
              <span className="h-8 w-8 grid place-items-center rounded-lg bg-gradient-primary shadow-glow">
                <MapPin className="h-4 w-4 text-primary-foreground" />
              </span>
              <span className="hidden sm:inline">Live Track</span>
            </Link>
            <span className="hidden md:inline-block text-xs uppercase tracking-wider text-muted-foreground border-l border-border pl-3">
              Admin Dashboard
            </span>
          </div>
          <div className="flex items-center gap-1 sm:gap-2">
            <KPI
              label="Active"
              value={counts.moving + counts.idle + counts.stopped}
              color="var(--moving)"
            />
            <KPI label="Offline" value={counts.offline} color="var(--offline)" />
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="px-2 sm:px-3"
              title="Add and manage vehicles"
            >
              <Link to="/admin/buses">
                <Bus className="h-4 w-4 sm:mr-1.5" />
                <span className="hidden sm:inline">Vehicles</span>
              </Link>
            </Button>
            <Button asChild variant="ghost" size="icon" title="Trip alerts">
              <Link to="/admin/alerts" aria-label="Trip alerts">
                <Bell className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm" className="px-2 sm:px-3" title="Trip history">
              <Link to="/history">
                <History className="h-4 w-4 sm:mr-1.5" />
                <span className="hidden sm:inline">History</span>
              </Link>
            </Button>
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="px-2 sm:px-3 hidden sm:inline-flex"
              title="My tracker"
            >
              <Link to="/track">My tracker</Link>
            </Button>
            <Button variant="ghost" size="icon" onClick={toggle} aria-label="Toggle theme">
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <Button variant="ghost" size="icon" onClick={() => signOut()} aria-label="Sign out">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="lg:hidden mx-auto max-w-[1600px] px-3 pb-2 flex gap-2">
          <button
            onClick={() => setMobileView("list")}
            className={`flex-1 flex items-center justify-center gap-1.5 h-9 rounded-full text-xs font-medium border transition-all ${
              mobileView === "list"
                ? "bg-primary text-primary-foreground border-primary shadow-glow"
                : "bg-background/50 border-border text-muted-foreground"
            }`}
          >
            <List className="h-4 w-4" /> Drivers ({counts.all})
          </button>
          <button
            onClick={() => setMobileView("map")}
            className={`flex-1 flex items-center justify-center gap-1.5 h-9 rounded-full text-xs font-medium border transition-all ${
              mobileView === "map"
                ? "bg-primary text-primary-foreground border-primary shadow-glow"
                : "bg-background/50 border-border text-muted-foreground"
            }`}
          >
            <MapIcon className="h-4 w-4" /> Map
          </button>
        </div>
      </header>

      {activeBuses.length > 0 && (
        <div
          className={`${mobileView === "map" ? "hidden lg:block" : ""} shrink-0 mx-auto max-w-[1600px] w-full px-3 sm:px-4 lg:px-6 pt-3`}
        >
          <div className="rounded-2xl bg-gradient-card border border-border/60 shadow-soft px-3 py-2.5">
            <div className="flex items-center gap-2 mb-2 px-1">
              <span className="h-2 w-2 rounded-full bg-[var(--moving)] animate-pulse" />
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Active now
              </span>
              <span className="text-xs text-muted-foreground">
                · {activeBuses.length} {activeBuses.length === 1 ? "bus" : "buses"} online
              </span>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
              {activeBuses.map((u) => {
                const V = getVehicle(u.vehicle_type).Icon;
                const isSelected = selected === u.user_id;
                return (
                  <button
                    key={u.user_id}
                    onClick={() => {
                      setSelected(u.user_id);
                      setMobileView("map");
                    }}
                    className={`shrink-0 w-56 sm:w-64 text-left rounded-xl border p-2.5 transition-all flex items-center gap-2.5 ${
                      isSelected
                        ? "bg-primary/10 border-primary shadow-glow"
                        : "bg-background/50 border-border/60 hover:border-primary/40"
                    }`}
                  >
                    <span
                      className="h-9 w-9 rounded-lg grid place-items-center shrink-0 text-white"
                      style={{ background: DOT[u.status] }}
                    >
                      <V size={18} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="font-medium text-sm truncate">{u.display_name}</span>
                        {u.plate_number && (
                          <span className="font-mono text-[10px] font-bold bg-muted px-1.5 py-0.5 rounded shrink-0">
                            {u.plate_number}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground truncate flex items-center gap-1.5">
                        <span
                          className="font-semibold tabular-nums"
                          style={{ color: DOT[u.status] }}
                        >
                          {u.speed_kmh?.toFixed(0) ?? 0} km/h
                        </span>
                        {u.address && <span className="truncate">· 📍 {u.address}</span>}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 mx-auto max-w-[1600px] w-full px-3 sm:px-4 lg:px-6 pt-3 sm:pt-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:pb-4 flex flex-col lg:grid lg:gap-4 lg:grid-cols-[400px_1fr] lg:grid-rows-[minmax(0,1fr)]">
        <div
          className={`${mobileView === "list" ? "flex" : "hidden"} lg:flex flex-col flex-1 min-h-0`}
        >
          {listPanel}
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

function KPI({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted/50 border border-border/50">
      <span className="h-2 w-2 rounded-full" style={{ background: color }} />
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-bold tabular-nums">{value}</span>
    </div>
  );
}
