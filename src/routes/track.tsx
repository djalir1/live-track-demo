import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Battery,
  Wifi,
  WifiOff,
  Satellite,
  Gauge,
  Route as RouteIcon,
  Play,
  Square,
  LogOut,
  MapPin,
  Sun,
  Moon,
  ShieldCheck,
  Zap,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme";
import { useTracker } from "@/hooks/use-tracker";
import { reverseGeocode } from "@/lib/geocode";

export const Route = createFileRoute("/track")({
  head: () => ({ meta: [{ title: "Tracker — Live Track" }] }),
  component: TrackPage,
});

const STATUS_META = {
  moving: { label: "Moving", color: "var(--moving)", hint: "GPS live" },
  stopped: { label: "Parked", color: "var(--stopped)", hint: "Waiting for movement" },
  idle: { label: "Idle", color: "var(--idle)", hint: "No recent updates" },
  offline: { label: "Offline", color: "var(--offline)", hint: "Not tracking" },
} as const;

function TrackPage() {
  const { user, role, signOut, loading } = useAuth();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  const { stats, start, stop } = useTracker();
  const [address, setAddress] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth" });
  }, [loading, user, navigate]);

  useEffect(() => {
    if (!loading && user && role === "admin") {
      if (stats.isTracking) stop();
      navigate({ to: "/dashboard" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user, role]);

  useEffect(() => {
    if (
      !loading &&
      user &&
      role === "user" &&
      !stats.isTracking &&
      stats.permission !== "denied" &&
      stats.permission !== "unsupported"
    ) {
      start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user, role, stats.permission]);

  // Reverse geocode current position (throttled by the cache in geocode.ts).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (stats.latitude == null || stats.longitude == null) return;
      const label = await reverseGeocode(stats.latitude, stats.longitude);
      if (!cancelled && label) setAddress(label);
    })();
    return () => {
      cancelled = true;
    };
  }, [stats.latitude?.toFixed(3), stats.longitude?.toFixed(3)]);

  // Never render the driver UI for anyone whose role isn't confirmed "user".
  // While role is being fetched (loading=true, role=null) OR the account is
  // an admin awaiting the redirect effect, show a neutral loader. This is
  // the guarantee that an admin never sees /track for even one frame.
  if (loading || !user || role !== "user") {
    return (
      <div className="min-h-screen bg-background grid place-items-center">
        <div className="flex items-center gap-3 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <span>Loading…</span>
        </div>
      </div>
    );
  }

  const meta = STATUS_META[stats.status];
  const blocked = stats.permission === "denied" || stats.permission === "unsupported";
  const live = stats.isTracking && stats.gpsActive;

  return (
    <div className="min-h-[100dvh] bg-background pb-[calc(6rem+env(safe-area-inset-bottom))]">
      <header className="sticky top-0 z-30 pt-safe backdrop-blur-xl bg-background/70 border-b border-border/50">
        <div className="mx-auto max-w-md px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2 font-display font-bold">
            <span className="h-7 w-7 grid place-items-center rounded-lg bg-gradient-primary shadow-glow">
              <MapPin className="h-3.5 w-3.5 text-primary-foreground" />
            </span>
            Live Track
          </div>
          <div className="flex items-center gap-1">
            {role === "admin" && (
              <Button asChild variant="ghost" size="icon" title="Admin dashboard">
                <Link to="/dashboard">
                  <ShieldCheck className="h-4 w-4" />
                </Link>
              </Button>
            )}
            <Button variant="ghost" size="icon" onClick={toggle} aria-label="Toggle theme">
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <Button variant="ghost" size="icon" onClick={() => signOut()} aria-label="Sign out">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-md px-4 pt-6 space-y-5">
        {blocked && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl border border-destructive/40 bg-destructive/10 p-5 space-y-3"
          >
            <div className="flex items-start gap-3">
              <span className="h-9 w-9 grid place-items-center rounded-xl bg-destructive/20 shrink-0">
                <MapPin className="h-4 w-4 text-destructive" />
              </span>
              <div>
                <h2 className="font-display font-bold text-lg leading-tight">
                  {stats.permission === "unsupported"
                    ? "Location not supported"
                    : "Turn on location to start tracking"}
                </h2>
                <p className="text-sm text-muted-foreground mt-1">
                  {stats.permission === "unsupported"
                    ? "This device or browser doesn't support GPS. Try opening Live Track on a phone with location services."
                    : "Live Track needs your device location to go live. Enable it in your device & browser settings, then tap Retry."}
                </p>
              </div>
            </div>
            {stats.permission === "denied" && (
              <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside pl-1">
                <li>
                  Open your device <b>Settings → Location</b> and turn it ON.
                </li>
                <li>
                  In your browser, tap the lock/info icon in the address bar and allow{" "}
                  <b>Location</b> for this site.
                </li>
                <li>
                  Return here and tap <b>Retry</b>.
                </li>
              </ol>
            )}
            <div className="flex gap-2">
              <Button onClick={start} className="flex-1">
                Retry
              </Button>
              <Button variant="outline" onClick={() => location.reload()} className="flex-1">
                Reload
              </Button>
            </div>
          </motion.div>
        )}

        {/* Status hero */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative overflow-hidden rounded-3xl bg-gradient-card border border-border/60 shadow-soft p-6"
        >
          <div
            className="absolute -top-24 -right-24 h-56 w-56 rounded-full opacity-30"
            style={{ background: `radial-gradient(circle, ${meta.color}, transparent 70%)` }}
          />
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Status</p>
              <div className="mt-1 flex items-center gap-2">
                <span
                  className="inline-block h-3 w-3 rounded-full pulse-dot"
                  style={{ background: meta.color, color: meta.color }}
                />
                <span className="font-display text-2xl font-bold">{meta.label}</span>
                {live && (
                  <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-[var(--moving)]/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--moving)]">
                    <Zap className="h-3 w-3" /> Live
                  </span>
                )}
              </div>
              <div className="text-xs text-muted-foreground mt-1">{meta.hint}</div>
            </div>
            <div className="flex items-center gap-3 text-muted-foreground text-xs shrink-0">
              <span className="flex items-center gap-1" title={stats.online ? "Online" : "Offline"}>
                {stats.online ? (
                  <Wifi className="h-4 w-4 text-[var(--moving)]" />
                ) : (
                  <WifiOff className="h-4 w-4 text-[var(--idle)]" />
                )}
              </span>
              <span
                className="flex items-center gap-1"
                title={stats.gpsActive ? "GPS active" : "GPS off"}
              >
                <Satellite
                  className={`h-4 w-4 ${stats.gpsActive ? "text-[var(--moving)]" : "text-muted-foreground"}`}
                />
              </span>
              <span className="flex items-center gap-1" title="Battery">
                <Battery className="h-4 w-4" />
                {stats.batteryLevel != null ? `${stats.batteryLevel}%` : "—"}
              </span>
            </div>
          </div>

          <div className="mt-8 grid grid-cols-2 gap-3">
            <Stat
              icon={<Gauge className="h-4 w-4" />}
              label="Speed"
              value={`${stats.speedKmh.toFixed(1)}`}
              unit="km/h"
            />
            <Stat
              icon={<RouteIcon className="h-4 w-4" />}
              label="Distance"
              value={(stats.totalDistanceM / 1000).toFixed(2)}
              unit="km"
            />
          </div>

          <div className="mt-4 rounded-xl bg-muted/60 p-3 text-xs text-muted-foreground space-y-1">
            {stats.latitude != null ? (
              <>
                <div className="flex items-center gap-1.5">
                  <MapPin className="h-3 w-3" />{" "}
                  <span className="font-medium text-foreground truncate">
                    {address ?? "Locating…"}
                  </span>
                </div>
                <div className="font-mono opacity-70">
                  {stats.latitude.toFixed(5)}, {stats.longitude!.toFixed(5)} · ±
                  {stats.accuracy?.toFixed(0) ?? "—"}m
                </div>
              </>
            ) : (
              <div>Waiting for GPS fix…</div>
            )}
          </div>
        </motion.div>

        {/* Big tap button */}
        <AnimatePresence mode="wait">
          {!stats.isTracking ? (
            <motion.button
              key="start"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              onClick={start}
              className="group relative w-full h-20 rounded-3xl bg-gradient-primary text-primary-foreground font-display font-bold text-xl shadow-glow active:scale-[0.98] transition-transform"
            >
              <span className="absolute inset-0 rounded-3xl bg-white/0 group-hover:bg-white/5 transition" />
              <span className="inline-flex items-center gap-3">
                <Play className="h-6 w-6" /> Start tracking
              </span>
            </motion.button>
          ) : (
            <motion.button
              key="stop"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              onClick={stop}
              className="w-full h-20 rounded-3xl bg-[var(--stopped)] text-white font-display font-bold text-xl shadow-soft active:scale-[0.98] transition-transform"
            >
              <span className="inline-flex items-center gap-3">
                <Square className="h-6 w-6" /> Stop tracking
              </span>
            </motion.button>
          )}
        </AnimatePresence>

        {stats.error && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 text-destructive text-sm p-3">
            {stats.error}
          </div>
        )}

        <p className="text-xs text-center text-muted-foreground">
          Keep this tab open (and screen on) while tracking. On phones, install as a PWA and enable
          Wake Lock for best results.
        </p>
      </main>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  unit,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  unit: string;
}) {
  return (
    <div className="rounded-2xl bg-background/40 border border-border/50 p-4">
      <div className="flex items-center gap-2 text-muted-foreground text-xs">
        {icon} {label}
      </div>
      <div className="mt-2 flex items-baseline gap-1">
        <span className="font-display text-3xl font-bold tabular-nums">{value}</span>
        <span className="text-xs text-muted-foreground">{unit}</span>
      </div>
    </div>
  );
}
