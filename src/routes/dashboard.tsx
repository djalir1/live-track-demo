import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
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
  Loader2,
  List,
  Map as MapIcon,
  Battery,
  BatteryWarning,
  PowerOff,
  Bus,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme";
import { supabase } from "@/integrations/supabase/client";
import type { LiveUser, TrackingStatus } from "@/types/tracking";
import { getVehicle } from "@/lib/vehicles";
import { reverseGeocode, cachedReverseGeocode } from "@/lib/geocode";
import { friendlyError } from "@/lib/friendly-errors";

const LiveMap = lazy(() => import("@/components/LiveMap").then((m) => ({ default: m.LiveMap })));

export const Route = createFileRoute("/dashboard")({
  head: () => ({ meta: [{ title: "Admin Dashboard — Live Track" }] }),
  component: Dashboard,
});

const FILTERS: { key: "all" | TrackingStatus; label: string }[] = [
  { key: "all", label: "All" },
  { key: "moving", label: "Moving" },
  { key: "stopped", label: "Parked" },
  { key: "idle", label: "Idle" },
  { key: "offline", label: "Offline" },
];

const DOT: Record<TrackingStatus, string> = {
  moving: "var(--moving)",
  stopped: "var(--stopped)",
  idle: "var(--idle)",
  offline: "var(--offline)",
};

function Dashboard() {
  const { user, role, loading, signOut } = useAuth();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  const [users, setUsers] = useState<LiveUser[]>([]);
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

  const load = async () => {
    const [statusesRes, profilesRes, driversRes, trackersRes] = await Promise.all([
      supabase.from("device_status").select("*"),
      supabase
        .from("profiles")
        .select("id, display_name, vehicle_name, vehicle_type, plate_number, seats"),
      // Only accounts explicitly assigned the 'user' (driver) role can appear
      // in the live list. Admin/parent/school_admin accounts are excluded.
      supabase.from("user_roles").select("user_id").eq("role", "user"),
      // Drivers whose vehicle carries a hardware GPS tracker.
      supabase.from("buses").select("driver_user_id").not("gps_imei", "is", null),
    ]);
    if (statusesRes.error) {
      console.error("[dashboard] device_status error", statusesRes.error);
      toast.error(friendlyError(statusesRes.error, "Couldn't load the driver list right now."));
    }
    if (profilesRes.error) console.error("[dashboard] profiles error", profilesRes.error);
    if (driversRes.error) console.error("[dashboard] user_roles error", driversRes.error);
    const statuses = statusesRes.data ?? [];
    const profiles = profilesRes.data ?? [];
    const driverIds = new Set((driversRes.data ?? []).map((r) => r.user_id));
    const profileMap = new Map(profiles.map((p) => [p.id, p]));
    const trackerDrivers = new Set(
      ((trackersRes.data ?? []) as { driver_user_id: string | null }[]).map(
        (b) => b.driver_user_id,
      ),
    );
    const merged: LiveUser[] = statuses
      .filter((s) => driverIds.has(s.user_id))
      .map((s) => {
        const p = profileMap.get(s.user_id);
        // Presence = freshness. Tracker upserts roughly every 8s while active,
        // so if we haven't heard in 30s the phone is either off, backgrounded
        // hard, or lost network — all of which are "offline" for the admin's
        // purposes. Otherwise trust the tracker's own state (moving / stopped
        // / idle) since it reflects the last real GPS reading.
        // Hardware trackers report every 10 s with ignition on but only every
        // 5 min parked (TIMER,10,300#), so they get a wider window.
        const gpsTracker = trackerDrivers.has(s.user_id);
        const freshMs = gpsTracker ? (s.is_tracking ? 60_000 : 7 * 60_000) : 30_000;
        const fresh = Date.now() - new Date(s.last_seen).getTime() < freshMs;
        return {
          user_id: s.user_id,
          display_name: p?.display_name ?? "Unknown",
          vehicle_name: p?.vehicle_name ?? null,
          vehicle_type: p?.vehicle_type ?? "car",
          plate_number: p?.plate_number ?? null,
          seats: p?.seats ?? null,
          status: fresh ? s.status : "offline",
          latitude: s.latitude,
          longitude: s.longitude,
          speed_kmh: s.speed_kmh,
          heading: s.heading ?? null,
          battery_level: s.battery_level,
          is_tracking: s.is_tracking,
          last_seen: s.last_seen,
          address: cachedReverseGeocode(s.latitude, s.longitude),
          gps_tracker: gpsTracker,
        };
      });
    setUsers(merged);
  };

  useEffect(() => {
    if (role !== "admin") return;
    load();
    const ch = supabase
      .channel("device_status_realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "device_status" }, () =>
        load(),
      )
      .subscribe();
    const i = window.setInterval(load, 15000);
    return () => {
      supabase.removeChannel(ch);
      window.clearInterval(i);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const u of users) {
        if (u.latitude == null || u.longitude == null) continue;
        if (u.address) continue;
        const label = await reverseGeocode(u.latitude, u.longitude);
        if (cancelled) return;
        if (label)
          setUsers((prev) =>
            prev.map((x) => (x.user_id === u.user_id ? { ...x, address: label } : x)),
          );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [users.map((u) => `${u.user_id}:${u.latitude}:${u.longitude}`).join("|")]);

  // The list is filtered by status + search. The MAP still shows every driver
  // so admins never lose sight of a vehicle when they narrow the filter.
  const filteredList = useMemo(() => {
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
  }, [users, filter, search]);

  const counts = useMemo(
    () => ({
      all: users.length,
      moving: users.filter((u) => u.status === "moving").length,
      stopped: users.filter((u) => u.status === "stopped").length,
      idle: users.filter((u) => u.status === "idle").length,
      offline: users.filter((u) => u.status === "offline").length,
    }),
    [users],
  );

  // Buses that are actively online right now — moving buses first (most
  // urgent), then idle, then parked. Offline devices are excluded so the strip
  // only shows what an admin can currently intervene on.
  const activeBuses = useMemo(() => {
    const order: Record<TrackingStatus, number> = { moving: 0, idle: 1, stopped: 2, offline: 3 };
    return users
      .filter((u) => u.status !== "offline" && u.is_tracking && u.latitude != null)
      .sort((a, b) => order[a.status] - order[b.status] || (b.speed_kmh ?? 0) - (a.speed_kmh ?? 0));
  }, [users]);

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
                      {u.gps_tracker ? "Ignition off" : "Phone off"}
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
                <div className="text-muted-foreground">
                  {formatDistanceToNow(new Date(u.last_seen), { addSuffix: false })}
                </div>
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
