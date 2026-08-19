import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, LogOut, MapPin, Wifi, WifiOff, PowerOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import type { VehicleType } from "@/lib/vehicles";
import { getVehicle } from "@/lib/vehicles";
import { cachedReverseGeocode, reverseGeocode } from "@/lib/geocode";

const ParentMap = lazy(() => import("@/components/ParentMap").then((m) => ({ default: m.ParentMap })));

export const Route = createFileRoute("/me")({
  head: () => ({ meta: [{ title: "My child — Pulse" }] }),
  component: MePage,
});

// ── Types ───────────────────────────────────────────────────────────────────

interface Child {
  studentId: string;
  studentName: string;
  studentClass: string | null;
  busId: string | null;
  busLabel: string | null;
  busPlate: string | null;
  vehicleType: VehicleType | null;
  routeId: string | null;
  routeName: string | null;
  driverUserId: string | null;
  driverName: string | null;
  homeStopId: string | null;
  stops: Array<{
    id: string; name: string; lat: number; lng: number;
    type: "pickup" | "school"; sequence: number | null;
  }>;
}

interface DeviceStatusRow {
  user_id: string;
  status: "moving" | "stopped" | "idle" | "offline";
  latitude: number | null;
  longitude: number | null;
  speed_kmh: number | null;
  last_seen: string;
  is_tracking: boolean;
}

type BannerState =
  | { kind: "moving" }
  | { kind: "stopped" }
  | { kind: "offline"; lastSeenIso: string | null; nearPlace: string | null }
  | { kind: "no-trip" };

// ── Freshness rules (match dashboard fix) ───────────────────────────────────
const FRESH_MS = 30_000;      // < 30s: live
const OFFLINE_MS = 90_000;    // > 90s: offline
const MOVING_KMH = 0.8;

function derivePresence(ds: DeviceStatusRow | null, hasOpenSession: boolean, now: number): BannerState {
  if (!hasOpenSession) return { kind: "no-trip" };
  if (!ds) return { kind: "offline", lastSeenIso: null, nearPlace: null };
  const age = now - new Date(ds.last_seen).getTime();
  if (age > OFFLINE_MS) {
    return { kind: "offline", lastSeenIso: ds.last_seen, nearPlace: null };
  }
  if (age < FRESH_MS) {
    if ((ds.speed_kmh ?? 0) > MOVING_KMH) return { kind: "moving" };
    return { kind: "stopped" };
  }
  // 30s – 90s: between fresh and offline. Trust the stored status only if it
  // was moving/stopped; otherwise treat as offline to avoid a frozen "live".
  if (ds.status === "moving" && (ds.speed_kmh ?? 0) > MOVING_KMH) return { kind: "moving" };
  if (ds.status === "stopped") return { kind: "stopped" };
  return { kind: "offline", lastSeenIso: ds.last_seen, nearPlace: null };
}

// ── Component ───────────────────────────────────────────────────────────────

function MePage() {
  const { user, role, loading, signOut } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    if (!user) { navigate({ to: "/join" }); return; }
    if (role == null) return;
    if (role !== "parent") navigate({ to: "/track" });
  }, [loading, user, role, navigate]);

  const [children, setChildren] = useState<Child[] | null>(null);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  // Load the parent's children with everything needed to render one screen.
  useEffect(() => {
    if (!user || role !== "parent") return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("parent_students")
        .select(`
          students!inner (
            id, name, class, home_stop_id, bus_id,
            buses (
              id, label, plate, driver_user_id, route_id,
              driver:profiles!buses_driver_user_id_fkey ( id, display_name, vehicle_type ),
              routes ( id, name, stops ( id, name, lat, lng, type, sequence ) )
            )
          )
        `)
        .eq("parent_user_id", user.id);
      if (cancelled) return;
      if (error) { setLoadErr(error.message); return; }
      type Row = {
        students: {
          id: string; name: string; class: string | null; home_stop_id: string | null; bus_id: string | null;
          buses: {
            id: string; label: string | null; plate: string | null;
            driver_user_id: string | null; route_id: string | null;
            driver: { id: string; display_name: string; vehicle_type: VehicleType | null } | null;
            routes: {
              id: string; name: string;
              stops: Array<{ id: string; name: string; lat: number | null; lng: number | null; type: "pickup" | "school"; sequence: number | null }>;
            } | null;
          } | null;
        };
      };
      const rows = (data ?? []) as unknown as Row[];
      const cs: Child[] = rows.map((r) => {
        const s = r.students; const b = s.buses;
        const stops = (b?.routes?.stops ?? [])
          .filter((x) => x.lat != null && x.lng != null)
          .map((x) => ({ id: x.id, name: x.name, lat: x.lat!, lng: x.lng!, type: x.type, sequence: x.sequence }));
        return {
          studentId: s.id, studentName: s.name, studentClass: s.class,
          busId: b?.id ?? null, busLabel: b?.label ?? null, busPlate: b?.plate ?? null,
          vehicleType: b?.driver?.vehicle_type ?? null,
          routeId: b?.routes?.id ?? null, routeName: b?.routes?.name ?? null,
          driverUserId: b?.driver?.id ?? null, driverName: b?.driver?.display_name ?? null,
          homeStopId: s.home_stop_id, stops,
        };
      });
      setChildren(cs);
    })();
    return () => { cancelled = true; };
  }, [user, role]);

  const child = children?.[selectedIdx] ?? null;

  // ── Live device_status + open trip_session for the selected child's bus ──
  const [ds, setDs] = useState<DeviceStatusRow | null>(null);
  const [hasOpenSession, setHasOpenSession] = useState<boolean>(false);
  const [nowTick, setNowTick] = useState<number>(Date.now());
  const [nearPlace, setNearPlace] = useState<string | null>(null);

  // Refetch when the driver_user_id changes (child switch).
  const driverUid = child?.driverUserId ?? null;

  useEffect(() => {
    if (!driverUid) { setDs(null); setHasOpenSession(false); return; }
    let cancelled = false;
    (async () => {
      const [dsRes, sessRes] = await Promise.all([
        supabase.from("device_status")
          .select("user_id, status, latitude, longitude, speed_kmh, last_seen, is_tracking")
          .eq("user_id", driverUid).maybeSingle(),
        supabase.from("trip_sessions")
          .select("id").eq("user_id", driverUid).is("ended_at", null).limit(1),
      ]);
      if (cancelled) return;
      if (dsRes.error) console.error("[me] device_status error", dsRes.error);
      if (sessRes.error) console.error("[me] trip_sessions error", sessRes.error);
      setDs((dsRes.data as DeviceStatusRow | null) ?? null);
      setHasOpenSession((sessRes.data?.length ?? 0) > 0);
    })();
    return () => { cancelled = true; };
  }, [driverUid]);

  // Realtime subscription — filter to THIS driver only, and re-scope cleanly
  // whenever the selected child (and thus driverUid) changes.
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  useEffect(() => {
    if (!driverUid) return;
    const ch = supabase
      .channel(`parent-me:${driverUid}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "device_status", filter: `user_id=eq.${driverUid}` },
        (payload) => {
          const row = (payload.new ?? payload.old) as DeviceStatusRow | undefined;
          if (row && row.user_id === driverUid) setDs(row);
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "trip_sessions", filter: `user_id=eq.${driverUid}` },
        () => {
          // Sessions changed — refetch the "open session?" flag.
          supabase.from("trip_sessions").select("id").eq("user_id", driverUid).is("ended_at", null).limit(1)
            .then(({ data }) => setHasOpenSession((data?.length ?? 0) > 0));
        },
      )
      .subscribe();
    channelRef.current = ch;
    return () => {
      supabase.removeChannel(ch);
      channelRef.current = null;
    };
  }, [driverUid]);

  // Ticker so "updated Ns ago" stays honest and staleness re-evaluates.
  useEffect(() => {
    const t = window.setInterval(() => setNowTick(Date.now()), 5_000);
    return () => window.clearInterval(t);
  }, []);

  // Reverse-geocode the bus's current point — only for the "near <place>"
  // label. Cache hit is synchronous; otherwise the shared 1-rps queue in
  // geocode.ts handles pacing.
  useEffect(() => {
    if (!ds?.latitude || !ds?.longitude) { setNearPlace(null); return; }
    const cached = cachedReverseGeocode(ds.latitude, ds.longitude);
    if (cached) { setNearPlace(cached); return; }
    let cancelled = false;
    (async () => {
      const label = await reverseGeocode(ds.latitude, ds.longitude);
      if (!cancelled && label) setNearPlace(label);
    })();
    return () => { cancelled = true; };
    // Round to 4dp so we don't re-fire on every metre of jitter.
  }, [ds?.latitude?.toFixed(4), ds?.longitude?.toFixed(4)]);

  const banner = useMemo(
    () => derivePresence(ds, hasOpenSession, nowTick),
    [ds, hasOpenSession, nowTick],
  );

  const busStatusForMap: "moving" | "stopped" | "offline" =
    banner.kind === "moving" ? "moving" :
    banner.kind === "stopped" ? "stopped" : "offline";
  const mapBusLive = banner.kind === "moving" || banner.kind === "stopped";

  const updatedAgoText = useMemo(() => {
    if (!ds) return null;
    const sec = Math.max(0, Math.round((nowTick - new Date(ds.last_seen).getTime()) / 1000));
    if (sec < 5) return "updated just now";
    if (sec < 60) return `updated ${sec}s ago`;
    const mins = Math.floor(sec / 60);
    if (mins < 60) return `updated ${mins} min ago`;
    const hrs = Math.floor(mins / 60);
    return `updated ${hrs}h ago`;
  }, [ds, nowTick]);

  const doSignOut = useCallback(async () => {
    await signOut();
    toast.success("Signed out");
    navigate({ to: "/join" });
  }, [signOut, navigate]);

  if (loading || !user || role !== "parent") {
    return (
      <div className="min-h-screen bg-background grid place-items-center">
        <div className="flex items-center gap-3 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <span>Loading…</span>
        </div>
      </div>
    );
  }

  if (loadErr) {
    return (
      <div className="min-h-screen bg-background grid place-items-center px-4">
        <div className="max-w-md text-center">
          <div className="text-sm text-destructive">Couldn't load your child's bus.</div>
          <div className="mt-1 text-xs text-muted-foreground">{loadErr}</div>
        </div>
      </div>
    );
  }

  const showSwitcher = (children?.length ?? 0) > 1;
  const vehicleLabel = child ? getVehicle(child.vehicleType).label : "Bus";
  const busName = child ? (child.busLabel ?? child.busPlate ?? "Bus") : "Bus";

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col">
      <header className="border-b border-border/50 backdrop-blur-xl bg-background/70 sticky top-0 z-30">
        <div className="mx-auto max-w-3xl px-4 h-14 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 font-display font-bold">
            <span className="h-7 w-7 grid place-items-center rounded-lg bg-gradient-primary shadow-glow">
              <MapPin className="h-3.5 w-3.5 text-primary-foreground" />
            </span>
            Pulse
          </Link>
          <Button variant="ghost" size="sm" onClick={doSignOut}>
            <LogOut className="h-4 w-4 sm:mr-1.5" /><span className="hidden sm:inline">Sign out</span>
          </Button>
        </div>
      </header>

      <main className="flex-1 mx-auto max-w-3xl w-full px-4 py-4 space-y-4">
        {showSwitcher && (
          <div className="flex flex-wrap gap-2">
            {(children ?? []).map((c, i) => (
              <button
                key={c.studentId}
                onClick={() => setSelectedIdx(i)}
                className={`px-4 h-10 rounded-full text-sm font-medium border transition-all ${
                  i === selectedIdx
                    ? "bg-primary text-primary-foreground border-primary shadow-glow"
                    : "bg-background/50 border-border text-muted-foreground hover:border-primary/40"
                }`}
              >
                {c.studentName}
              </button>
            ))}
          </div>
        )}

        {child == null ? (
          <div className="rounded-2xl border border-border/50 bg-card/40 p-6 text-sm text-muted-foreground text-center">
            No linked children yet. Ask your school to send you a fresh invite code.
          </div>
        ) : (
          <>
            <StatusBanner banner={banner} childName={child.studentName} />

            <div className="relative rounded-2xl overflow-hidden border border-border/60 shadow-soft h-[52vh] min-h-[380px] bg-card/40">
              <Suspense fallback={<div className="h-full w-full grid place-items-center text-muted-foreground text-sm"><Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading map…</div>}>
                <ParentMap
                  bus={{
                    lat: ds?.latitude ?? null,
                    lng: ds?.longitude ?? null,
                    vehicleType: child.vehicleType,
                    status: busStatusForMap,
                    live: mapBusLive,
                  }}
                  stops={child.stops}
                  homeStopId={child.homeStopId}
                />
              </Suspense>
            </div>

            <div className="rounded-2xl border border-border/60 bg-card/40 p-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-xs uppercase tracking-wider text-muted-foreground">Bus</span>
                <span className="font-mono font-bold">{child.busPlate ?? child.busLabel ?? "—"}</span>
                {child.busLabel && child.busPlate && (
                  <span className="text-xs text-muted-foreground">· {child.busLabel}</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs uppercase tracking-wider text-muted-foreground">Driver</span>
                <span className="font-medium">{child.driverName ?? "unassigned"}</span>
              </div>
              <div className="flex items-center gap-2 ml-auto">
                {banner.kind === "moving" || banner.kind === "stopped"
                  ? <Wifi className="h-3.5 w-3.5 text-[var(--moving)]" />
                  : banner.kind === "no-trip"
                    ? <PowerOff className="h-3.5 w-3.5 text-muted-foreground" />
                    : <WifiOff className="h-3.5 w-3.5 text-muted-foreground" />}
                <span className="text-xs text-muted-foreground">
                  {banner.kind === "no-trip" ? "no active trip" :
                   updatedAgoText ?? "waiting for first update"}
                </span>
              </div>
            </div>

            {child.routeName && (
              <div className="text-xs text-muted-foreground text-center">
                Route: <span className="font-medium text-foreground">{child.routeName}</span> · {vehicleLabel} · {busName}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function StatusBanner({ banner, childName }: { banner: BannerState; childName: string }) {
  const cfg = (() => {
    switch (banner.kind) {
      case "moving":  return { bg: "var(--moving)",  text: "Bus is moving",  sub: `${childName}'s bus is on the way.` };
      case "stopped": return { bg: "var(--stopped)", text: "Bus is stopped", sub: `${childName}'s bus is currently parked.` };
      case "no-trip": return { bg: "var(--offline)", text: "No trip yet today", sub: `${childName}'s bus hasn't started a run.` };
      case "offline": {
        const time = banner.lastSeenIso ? new Date(banner.lastSeenIso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null;
        const near = banner.nearPlace ? ` near ${banner.nearPlace}` : "";
        const sub = time ? `Last seen at ${time}${near}. We'll show it again as soon as it reports in.` : `We haven't heard from the bus yet. We'll show it as soon as it reports in.`;
        return { bg: "var(--offline)", text: "Bus is offline", sub };
      }
    }
  })();
  return (
    <div className="rounded-2xl p-5 sm:p-6 border border-border/60 shadow-soft" style={{ background: `color-mix(in oklch, ${cfg.bg} 22%, transparent)` }}>
      <div className="flex items-center gap-3">
        <span className="relative flex h-3 w-3">
          {(banner.kind === "moving" || banner.kind === "stopped") && (
            <span className="absolute inset-0 rounded-full animate-ping opacity-60" style={{ background: cfg.bg }} />
          )}
          <span className="relative h-3 w-3 rounded-full" style={{ background: cfg.bg }} />
        </span>
        <div className="font-display text-xl sm:text-2xl font-bold tracking-tight">{cfg.text}</div>
      </div>
      <div className="mt-1.5 text-sm text-muted-foreground">{cfg.sub}</div>
    </div>
  );
}
