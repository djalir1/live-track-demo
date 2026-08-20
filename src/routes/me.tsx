import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bell, BellOff, Check, Circle, Loader2, LogOut, MapPin, PowerOff, Wifi, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import type { VehicleType } from "@/lib/vehicles";
import { getVehicle } from "@/lib/vehicles";
import { cachedReverseGeocode, reverseGeocode } from "@/lib/geocode";
import { derivePresence, type BannerState, type DeviceStatusLite } from "@/lib/parent-presence";
import {
  bannerForEvent, computeEta, preHomeStopId, rollingSpeedKmh, stopStatuses,
  type EventLite, type HistoryPt, type StopPt, type EtaState, type StopStatus,
} from "@/lib/parent-trip";

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

// device_status row shape as we fetch it. Fields the banner needs live in
// DeviceStatusLite (imported); user_id is only used for realtime keying.
interface DeviceStatusRow extends DeviceStatusLite { user_id: string; }

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

  // ── Live device_status + open trip_session + geofence events + recent history ──
  const [ds, setDs] = useState<DeviceStatusRow | null>(null);
  const [sessionStart, setSessionStart] = useState<string | null>(null);
  const [events, setEvents] = useState<EventLite[]>([]);
  const [recentHistory, setRecentHistory] = useState<HistoryPt[]>([]);
  const [nowTick, setNowTick] = useState<number>(Date.now());
  const [nearPlace, setNearPlace] = useState<string | null>(null);

  // Refetch when the driver_user_id changes (child switch).
  const driverUid = child?.driverUserId ?? null;
  const busId = child?.busId ?? null;
  const hasOpenSession = sessionStart != null;

  useEffect(() => {
    if (!driverUid || !busId) {
      setDs(null); setSessionStart(null); setEvents([]); setRecentHistory([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const [dsRes, sessRes] = await Promise.all([
        supabase.from("device_status")
          .select("user_id, status, latitude, longitude, speed_kmh, last_seen, is_tracking")
          .eq("user_id", driverUid).maybeSingle(),
        supabase.from("trip_sessions")
          .select("started_at").eq("user_id", driverUid)
          .is("ended_at", null)
          .order("started_at", { ascending: false }).limit(1).maybeSingle(),
      ]);
      if (cancelled) return;
      if (dsRes.error) console.error("[me] device_status error", dsRes.error);
      if (sessRes.error) console.error("[me] trip_sessions error", sessRes.error);
      setDs((dsRes.data as DeviceStatusRow | null) ?? null);
      const sStart = sessRes.data?.started_at ?? null;
      setSessionStart(sStart);

      if (sStart) {
        // Events for THIS open session only (occurred at or after its start).
        // RLS-scoped: parent policy = is_parent_of_bus(bus_id), so we can only
        // read events for their own child's bus.
        const evRes = await supabase.from("geofence_events")
          .select("stop_id, event_type, occurred_at")
          .eq("bus_id", busId)
          .gte("occurred_at", sStart)
          .order("occurred_at", { ascending: true });
        if (cancelled) return;
        if (evRes.error) console.error("[me] geofence_events error", evRes.error);
        setEvents((evRes.data ?? []) as EventLite[]);

        // Recent history for rolling speed (last 5 min).
        const since = new Date(Date.now() - 5 * 60_000).toISOString();
        const hRes = await supabase.from("location_history")
          .select("latitude, longitude, recorded_at")
          .eq("user_id", driverUid)
          .gte("recorded_at", since)
          .order("recorded_at", { ascending: true });
        if (cancelled) return;
        if (hRes.error) console.error("[me] location_history error", hRes.error);
        setRecentHistory((hRes.data ?? []) as HistoryPt[]);
      } else {
        setEvents([]);
        setRecentHistory([]);
      }
    })();
    return () => { cancelled = true; };
  }, [driverUid, busId]);

  // Realtime subscription — filter to THIS driver / THIS bus only, and
  // re-scope cleanly whenever the selected child (and thus driverUid/busId)
  // changes. Three streams: device_status (marker), trip_sessions
  // (open?), geofence_events (progress + arrival banners).
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const [arrivalBanner, setArrivalBanner] = useState<{ kind: "approach" | "arrived"; stopName: string; at: number } | null>(null);
  useEffect(() => {
    if (!driverUid || !busId) return;
    const ch = supabase
      .channel(`parent-me:${driverUid}:${busId}`)
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
          supabase.from("trip_sessions").select("started_at").eq("user_id", driverUid)
            .is("ended_at", null).order("started_at", { ascending: false }).limit(1).maybeSingle()
            .then(({ data }) => setSessionStart(data?.started_at ?? null));
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "geofence_events", filter: `bus_id=eq.${busId}` },
        (payload) => {
          const ev = payload.new as EventLite | undefined;
          if (!ev) return;
          // Belt-and-braces: RLS already limits us to our own bus, but re-check.
          setEvents((prev) => [...prev, ev]);
        },
      )
      .subscribe();
    channelRef.current = ch;
    return () => {
      supabase.removeChannel(ch);
      channelRef.current = null;
    };
  }, [driverUid, busId]);

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

  // ── Trip progress + ETA (derived) ─────────────────────────────────────────
  const stopPts: StopPt[] = useMemo(
    () => (child?.stops ?? []).map((s) => ({ id: s.id, lat: s.lat, lng: s.lng, sequence: s.sequence })),
    [child],
  );
  const statuses: Map<string, StopStatus> = useMemo(
    () => stopStatuses(stopPts, events),
    [stopPts, events],
  );
  const speedKmh = useMemo(
    () => rollingSpeedKmh(recentHistory, 5, nowTick) ?? (ds?.speed_kmh ?? null),
    [recentHistory, nowTick, ds?.speed_kmh],
  );
  const eta: EtaState = useMemo(
    () => computeEta({
      bus: ds?.latitude != null && ds?.longitude != null ? [ds.latitude, ds.longitude] : null,
      stops: stopPts,
      homeStopId: child?.homeStopId ?? null,
      events,
      liveSpeedKmh: speedKmh,
    }),
    [ds?.latitude, ds?.longitude, stopPts, child?.homeStopId, events, speedKmh],
  );
  const preHomeId = useMemo(
    () => (child?.homeStopId ? preHomeStopId(stopPts, child.homeStopId) : null),
    [stopPts, child?.homeStopId],
  );

  // Compute done stop ids for the map's "faded" render.
  const doneStopIds = useMemo(
    () => Array.from(statuses.entries()).filter(([, s]) => s === "done").map(([id]) => id),
    [statuses],
  );

  // ── Arrival banners driven by NEW events for our own bus ──────────────────
  // Track which event ids we've already reacted to so a re-subscribe (or a
  // page refresh mid-run) doesn't fire the banner again for the same arrive.
  const reactedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    // Consider only 'arrive' events; look for pre-home and home.
    for (const e of events) {
      const key = `${e.stop_id}|${e.event_type}|${e.occurred_at}`;
      if (reactedRef.current.has(key)) continue;
      reactedRef.current.add(key);
      // LINKAGE GUARD: we only process events for stops on THIS child's
      // route. RLS already limits reads by is_parent_of_bus; this is a
      // second line of defence for the notification decision.
      if (!stopPts.some((s) => s.id === e.stop_id)) continue;
      const intent = bannerForEvent(e, child?.homeStopId ?? null, preHomeId);
      if (!intent) continue;
      const stop = child?.stops.find((s) => s.id === e.stop_id);
      if (intent === "arrived") {
        setArrivalBanner({ kind: "arrived", stopName: stop?.name ?? "your stop", at: Date.now() });
        maybePush("Arrived at your stop", `${child?.studentName}'s bus arrived at ${stop?.name}.`);
      } else {
        setArrivalBanner({ kind: "approach", stopName: stop?.name ?? "the stop before", at: Date.now() });
        maybePush("Approaching your stop", `${child?.studentName}'s bus arrived at ${stop?.name}. Yours is next.`);
      }
    }
  }, [events, child, preHomeId, stopPts]);

  // Auto-dismiss the arrival banner after 30s.
  useEffect(() => {
    if (!arrivalBanner) return;
    const t = window.setTimeout(() => setArrivalBanner(null), 30_000);
    return () => window.clearTimeout(t);
  }, [arrivalBanner]);

  // ── Notification prefs (per-parent, self-scoped RLS) ──────────────────────
  const [notifyEnabled, setNotifyEnabled] = useState<boolean>(false);
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase.from("parent_notification_prefs")
        .select("notify_enabled").eq("parent_user_id", user.id).maybeSingle();
      setNotifyEnabled(Boolean(data?.notify_enabled));
    })();
  }, [user]);

  const toggleNotify = useCallback(async () => {
    if (!user) return;
    const next = !notifyEnabled;
    setNotifyEnabled(next);
    if (next && typeof Notification !== "undefined" && Notification.permission === "default") {
      try { await Notification.requestPermission(); } catch { /* ignore */ }
    }
    const { error } = await supabase.from("parent_notification_prefs")
      .upsert({ parent_user_id: user.id, notify_enabled: next, updated_at: new Date().toISOString() });
    if (error) { toast.error(error.message); setNotifyEnabled(!next); }
    else toast.success(next ? "Notifications on" : "Notifications off");
  }, [user, notifyEnabled]);

  // Fire an OS-level notification if the user opted in AND the tab is
  // backgrounded. The Notification API delivers even without web push if the
  // page is open in the background; true web push (page closed) requires a
  // service worker + VAPID keys — see TODO below.
  const maybePush = (title: string, body: string) => {
    if (!notifyEnabled) return;
    if (typeof Notification === "undefined") return;
    if (Notification.permission !== "granted") return;
    try { new Notification(title, { body, icon: "/favicon.ico" }); } catch { /* ignore */ }
    // TODO(phase-5, push): sender-side web push via a Postgres NOTIFY -> edge
    // function -> web-push library, using push_subscription from
    // parent_notification_prefs and VAPID keys held in Vercel env. The parent
    // linkage guard for that hook: only send to parent_user_ids whose
    // parent_students.student.bus_id == geofence_events.bus_id.
    // TODO: WhatsApp notification channel later (register Rwanda WhatsApp
    // Business number, domestic authentication/utility rate).
  };

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
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={toggleNotify} title={notifyEnabled ? "Notifications on" : "Notifications off"}>
              {notifyEnabled ? <Bell className="h-4 w-4 sm:mr-1.5 text-[var(--moving)]" /> : <BellOff className="h-4 w-4 sm:mr-1.5 text-muted-foreground" />}
              <span className="hidden sm:inline">{notifyEnabled ? "Notify me" : "Notify me"}</span>
            </Button>
            <Button variant="ghost" size="sm" onClick={doSignOut}>
              <LogOut className="h-4 w-4 sm:mr-1.5" /><span className="hidden sm:inline">Sign out</span>
            </Button>
          </div>
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
            {arrivalBanner && (
              <ArrivalBanner
                kind={arrivalBanner.kind}
                stopName={arrivalBanner.stopName}
                childName={child.studentName}
                eta={eta}
                onDismiss={() => setArrivalBanner(null)}
              />
            )}
            <StatusBanner banner={banner} childName={child.studentName} eta={mapBusLive ? eta : { kind: "unknown" }} />

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
                  doneStopIds={doneStopIds}
                />
              </Suspense>
            </div>

            <TripProgress stops={child.stops} statuses={statuses} homeStopId={child.homeStopId} />

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

function etaSentence(eta: EtaState): string | null {
  switch (eta.kind) {
    case "eta": return `Arriving in ~${eta.minutes} min (approx)`;
    case "arriving": return "Arriving now";
    case "passed": return "Passed your stop";
    case "unknown": return null;
  }
}

function StatusBanner({ banner, childName, eta }: { banner: BannerState; childName: string; eta: EtaState }) {
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
  const etaLine = etaSentence(eta);
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
      {etaLine && banner.kind !== "offline" && banner.kind !== "no-trip" && (
        <div className="mt-3 text-sm font-medium">
          <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 border border-border/60 bg-background/60">
            {etaLine}
          </span>
        </div>
      )}
    </div>
  );
}

function TripProgress({
  stops, statuses, homeStopId,
}: {
  stops: Array<{ id: string; name: string; sequence: number | null }>;
  statuses: Map<string, StopStatus>;
  homeStopId: string | null;
}) {
  const ordered = [...stops].sort((a, b) => (a.sequence ?? 1e9) - (b.sequence ?? 1e9));
  if (ordered.length === 0) return null;
  return (
    <div className="rounded-2xl border border-border/60 bg-card/40 p-3 sm:p-4">
      <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Trip progress</div>
      <ol className="flex flex-wrap gap-2">
        {ordered.map((s) => {
          const st = statuses.get(s.id) ?? "pending";
          const isHome = s.id === homeStopId;
          const styles =
            st === "done"    ? "bg-muted/70 text-muted-foreground line-through opacity-70 border-border" :
            st === "current" ? "bg-[var(--moving)]/20 text-foreground border-[var(--moving)]/60" :
            /* pending */      "bg-background/60 text-foreground border-border/60";
          return (
            <li key={s.id} className={`inline-flex items-center gap-1.5 px-2.5 h-8 rounded-full border text-xs ${styles} ${isHome ? "ring-2 ring-primary/50" : ""}`}>
              {st === "done"
                ? <Check className="h-3.5 w-3.5" />
                : st === "current"
                  ? <span className="h-2 w-2 rounded-full bg-[var(--moving)] animate-pulse" />
                  : <Circle className="h-3.5 w-3.5" />}
              <span className="font-medium">{s.name}</span>
              {isHome && <span className="ml-1 text-[10px] uppercase tracking-wider text-primary font-bold">Home</span>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function ArrivalBanner({
  kind, stopName, childName, eta, onDismiss,
}: {
  kind: "approach" | "arrived";
  stopName: string;
  childName: string;
  eta: EtaState;
  onDismiss: () => void;
}) {
  const title = kind === "arrived" ? "Arrived at your stop" : "Approaching";
  const sub = kind === "arrived"
    ? `${childName}'s bus is at ${stopName}.`
    : `${childName}'s bus just reached ${stopName}${eta.kind === "eta" ? ` — arriving in ~${eta.minutes} min` : ""}${eta.kind === "arriving" ? " — arriving now" : ""}.`;
  const bg = kind === "arrived" ? "var(--moving)" : "var(--idle)";
  return (
    <div className="rounded-2xl p-4 border border-border/60 shadow-soft flex items-start gap-3" style={{ background: `color-mix(in oklch, ${bg} 30%, transparent)` }}>
      <span className="relative flex h-3 w-3 mt-1.5">
        <span className="absolute inset-0 rounded-full animate-ping opacity-60" style={{ background: bg }} />
        <span className="relative h-3 w-3 rounded-full" style={{ background: bg }} />
      </span>
      <div className="flex-1 min-w-0">
        <div className="font-display font-bold text-lg">{title}</div>
        <div className="text-sm text-muted-foreground">{sub}</div>
      </div>
      <button onClick={onDismiss} className="text-xs text-muted-foreground hover:text-foreground shrink-0">Dismiss</button>
    </div>
  );
}
