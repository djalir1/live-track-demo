import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Bell,
  BellRing,
  Bus as BusIcon,
  CalendarX,
  Car,
  Home,
  Loader2,
  LogOut,
  MapPin,
  Moon,
  Settings,
  Sun,
  History,
  X,
  Navigation,
  School,
  Sunrise,
  Sunset,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Pill, StatusPill, StudentAvatar } from "@/components/school/ui";
import { useAuth, homeFor } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme";
import { db } from "@/lib/fleet";
import { friendlyError } from "@/lib/friendly-errors";
import {
  defaultRun,
  kigaliDate,
  NOTICE_LABEL,
  type NoticeKind,
  type RiderStatus,
  type Run,
} from "@/lib/attendance";
import {
  busName,
  isMissingTable,
  type BusLite,
  type ParentNotification,
  type RideNotice,
  type StopRow,
  type StudentRow,
} from "@/lib/school";
import { computeEta, remainingMetresToStop, type EventLite, type StopPt } from "@/lib/parent-trip";
import { enablePush, getPushState, type PushState } from "@/lib/push";
import { fmtTime } from "@/lib/time";
import { SchoolBusArt } from "@/components/SchoolBusArt";

const ParentMap = lazy(() =>
  import("@/components/ParentMap").then((m) => ({ default: m.ParentMap })),
);

export const Route = createFileRoute("/family")({
  head: () => ({ meta: [{ title: "My children — Live Track" }] }),
  component: FamilyPage,
});

interface TodayTrip {
  trip_id: string;
  run: Run;
  status: RiderStatus;
  notice_kind: NoticeKind | null;
  boarded_at: string | null;
  dropped_at: string | null;
  bus_id: string;
  trip_status: "open" | "closed";
  stop_id: string | null;
}

interface Pos {
  latitude: number | null;
  longitude: number | null;
  speed_kmh: number | null;
  is_tracking: boolean;
  last_seen: string;
}

interface Prefs {
  boarding: boolean;
  approach: boolean;
  announcements: boolean;
  approach_km: number;
}

function FamilyPage() {
  const { user, role, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const { theme, toggle } = useTheme();
  const today = kigaliDate();

  const [kids, setKids] = useState<StudentRow[] | null>(null);
  const [sel, setSel] = useState(0);
  const [trips, setTrips] = useState<Map<string, TodayTrip[]>>(new Map());
  const [buses, setBuses] = useState<Map<string, BusLite>>(new Map());
  const [stops, setStops] = useState<StopRow[]>([]);
  const [notices, setNotices] = useState<RideNotice[]>([]);
  const [feed, setFeed] = useState<ParentNotification[]>([]);
  const [pos, setPos] = useState<Pos | null>(null);
  const [events, setEvents] = useState<EventLite[]>([]);
  const [missing, setMissing] = useState(false);
  const [feedOpen, setFeedOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [noticeOpen, setNoticeOpen] = useState<NoticeKind | null>(null);
  const [prefs, setPrefs] = useState<Prefs>({
    boarding: true,
    approach: true,
    announcements: true,
    approach_km: 2,
  });
  const warned = useRef<string | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!user) navigate({ to: "/parent" });
    else if (role && role !== "parent") navigate({ to: homeFor(role) });
  }, [loading, user, role, navigate]);

  const load = useCallback(async () => {
    if (!user) return;
    const { data: links } = await db
      .from("parent_students")
      .select("student_id")
      .eq("parent_user_id", user.id);
    const ids = ((links ?? []) as { student_id: string }[]).map((l) => l.student_id);
    if (!ids.length) return setKids([]);
    const [s, ts, n, f, pr] = await Promise.all([
      db.from("students").select("*").in("id", ids).order("name"),
      db
        .from("trip_students")
        .select(
          "trip_id, student_id, status, notice_kind, boarded_at, dropped_at, stop_id, bus_trips!inner(run, bus_id, service_date, status)",
        )
        .in("student_id", ids)
        .eq("bus_trips.service_date", today),
      db
        .from("ride_notices")
        .select("*")
        .in("student_id", ids)
        .gte("service_date", today)
        .is("cancelled_at", null)
        .order("service_date"),
      db
        .from("parent_notifications")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50),
      db.from("parent_alert_prefs").select("*").eq("user_id", user.id).maybeSingle(),
    ]);
    if (isMissingTable(ts.error) || isMissingTable(n.error)) setMissing(true);
    const students = (s.data ?? []) as StudentRow[];
    setKids(students);
    const tm = new Map<string, TodayTrip[]>();
    for (const r of (ts.data ?? []) as unknown as (TodayTrip & {
      student_id: string;
      bus_trips: { run: Run; bus_id: string; status: "open" | "closed" };
    })[]) {
      tm.set(r.student_id, [
        ...(tm.get(r.student_id) ?? []),
        { ...r, run: r.bus_trips.run, bus_id: r.bus_trips.bus_id, trip_status: r.bus_trips.status },
      ]);
    }
    setTrips(tm);
    setNotices((n.data ?? []) as RideNotice[]);
    setFeed((f.data ?? []) as ParentNotification[]);
    if (pr.data) setPrefs(pr.data as Prefs);
    const busIds = [
      ...new Set(
        [...students.map((x) => x.bus_id), ...[...tm.values()].flat().map((t) => t.bus_id)].filter(
          Boolean,
        ) as string[],
      ),
    ];
    if (busIds.length) {
      const { data: b } = await db.from("buses").select("*").in("id", busIds);
      const bl = (b ?? []) as BusLite[];
      setBuses(new Map(bl.map((x) => [x.id, x])));
      const routeIds = [...new Set(bl.map((x) => x.route_id).filter(Boolean) as string[])];
      if (routeIds.length) {
        const { data: st } = await db.from("stops").select("*").in("route_id", routeIds);
        setStops((st ?? []) as StopRow[]);
      }
    }
  }, [user, today]);

  useEffect(() => {
    void load();
  }, [load]);

  // New alerts arrive live (also as phone push when enabled).
  useEffect(() => {
    if (!user) return;
    const ch = db
      .channel(`family:${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "parent_notifications",
          filter: `user_id=eq.${user.id}`,
        },
        (p) => {
          const n = p.new as ParentNotification;
          setFeed((f) => [n, ...f]);
          toast(n.title, { description: n.body || undefined });
          navigator.vibrate?.([60, 40, 60]);
          void load();
        },
      )
      .subscribe();
    return () => void db.removeChannel(ch);
  }, [user, load]);

  const kid = kids?.[sel] ?? null;
  const run = defaultRun();
  const kidTrips = (kid && trips.get(kid.id)) || [];
  const liveTrip =
    kidTrips.find((t) => t.run === run && t.trip_status === "open") ??
    kidTrips.find((t) => t.trip_status === "open");
  const followBusId = liveTrip?.bus_id ?? kid?.bus_id ?? null;
  const bus = followBusId ? (buses.get(followBusId) ?? null) : null;
  const followRun: Run = liveTrip?.run ?? run;
  const myStopId =
    liveTrip?.stop_id ??
    (followRun === "morning"
      ? (kid?.morning_stop_id ?? kid?.home_stop_id)
      : (kid?.afternoon_stop_id ?? kid?.morning_stop_id ?? kid?.home_stop_id)) ??
    null;
  const routeStops = stops.filter(
    (s) => s.route_id === bus?.route_id && s.lat != null && s.lng != null,
  );

  // Live bus position + stop events for the bus being followed.
  useEffect(() => {
    if (!bus?.driver_user_id) return setPos(null);
    let alive = true;
    void db
      .from("device_status")
      .select("latitude, longitude, speed_kmh, is_tracking, last_seen")
      .eq("user_id", bus.driver_user_id)
      .maybeSingle()
      .then(({ data }) => alive && setPos(data as Pos | null));
    const since = new Date(Date.now() - 3 * 3_600_000).toISOString();
    void db
      .from("geofence_events")
      .select("stop_id, event_type, occurred_at")
      .eq("bus_id", bus.id)
      .gte("occurred_at", since)
      .order("occurred_at")
      .then(({ data }) => alive && setEvents((data ?? []) as EventLite[]));
    const ch = db
      .channel(`family-bus:${bus.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "device_status",
          filter: `user_id=eq.${bus.driver_user_id}`,
        },
        (p) => setPos(p.new as Pos),
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "geofence_events",
          filter: `bus_id=eq.${bus.id}`,
        },
        (p) => setEvents((e) => [...e, p.new as EventLite]),
      )
      .subscribe();
    return () => {
      alive = false;
      void db.removeChannel(ch);
    };
  }, [bus?.id, bus?.driver_user_id]);

  // Route order for this run (afternoon runs the stops backwards).
  const runStops: StopPt[] = useMemo(
    () =>
      routeStops.map((s) => ({
        id: s.id,
        lat: s.lat!,
        lng: s.lng!,
        sequence: s.sequence == null ? null : followRun === "afternoon" ? -s.sequence : s.sequence,
      })),
    [routeStops, followRun],
  );
  const live = !!pos && Date.now() - new Date(pos.last_seen).getTime() < 10 * 60_000;
  const busPt: [number, number] | null =
    pos?.latitude != null && pos.longitude != null ? [pos.latitude, pos.longitude] : null;
  const eta = computeEta({
    bus: live ? busPt : null,
    stops: runStops,
    homeStopId: myStopId,
    events,
    liveSpeedKmh: pos?.speed_kmh ?? null,
  });
  const kmLeft =
    busPt && myStopId && live ? remainingMetresToStop(busPt, runStops, myStopId) : null;
  const myStop = stops.find((s) => s.id === myStopId);

  // "Bus is X km away" warning while the app is open.
  useEffect(() => {
    if (!prefs.approach || kmLeft == null || !liveTrip || liveTrip.trip_status !== "open") return;
    const key = `${liveTrip.trip_id}:${kid?.id}`;
    if (kmLeft / 1000 <= prefs.approach_km && warned.current !== key) {
      warned.current = key;
      toast.message(
        `🚌 ${busName(bus)} is ${(kmLeft / 1000).toFixed(1)} km from ${myStop?.name ?? "your stop"}`,
        {
          description:
            eta.kind === "eta"
              ? `About ${eta.minutes} min.`
              : eta.kind === "arriving"
                ? "Arriving now."
                : undefined,
        },
      );
      navigator.vibrate?.(200);
    }
  }, [kmLeft, prefs, liveTrip, kid?.id, bus, myStop?.name, eta]);

  const unread = feed.filter((f) => !f.read_at).length;
  const kidNotices = notices.filter((n) => n.student_id === kid?.id);

  if (loading || kids == null)
    return (
      <div className="min-h-[100dvh] grid place-items-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );

  return (
    <div className="min-h-[100dvh] bg-background">
      <header className="sticky top-0 z-30 pt-safe bg-background/85 backdrop-blur-xl border-b border-border/60">
        <div className="max-w-5xl mx-auto h-14 px-3 flex items-center gap-2">
          <span className="h-8 w-8 grid place-items-center rounded-lg bg-gradient-primary shadow-glow">
            <MapPin className="h-4 w-4 text-primary-foreground" />
          </span>
          <div className="flex-1 min-w-0">
            <div className="font-display font-bold leading-tight">Live Track</div>
            <div className="text-[11px] text-muted-foreground leading-tight truncate">
              Hello {(user?.user_metadata?.display_name as string | undefined)?.split(" ")[0] ?? ""}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="relative"
            onClick={() => {
              setFeedOpen(true);
              if (unread)
                void db
                  .rpc("mark_notifications_read", { p_ids: null })
                  .then(() =>
                    setFeed((f) =>
                      f.map((x) => ({ ...x, read_at: x.read_at ?? new Date().toISOString() })),
                    ),
                  );
            }}
            aria-label="Notifications"
          >
            <Bell className="h-5 w-5" />
            {unread > 0 && (
              <span className="absolute top-1.5 right-1.5 min-w-4 h-4 px-1 rounded-full bg-destructive text-[10px] font-bold text-white grid place-items-center">
                {unread}
              </span>
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSettingsOpen(true)}
            aria-label="Settings"
          >
            <Settings className="h-5 w-5" />
          </Button>
        </div>
      </header>

      {missing && (
        <div className="max-w-5xl mx-auto px-4 pt-4 text-sm text-warning">
          Some features aren't available on this server yet.
        </div>
      )}

      {kids.length === 0 ? (
        <div className="max-w-md mx-auto px-6 py-16 text-center">
          <div className="mx-auto h-14 w-14 rounded-2xl bg-primary/10 text-primary grid place-items-center">
            <School className="h-7 w-7" />
          </div>
          <h1 className="mt-4 font-display text-xl font-bold">No child linked yet</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Ask your child's school to add your phone number to their record.
          </p>
          <Button variant="outline" className="mt-6" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      ) : (
        <main className="max-w-5xl mx-auto px-3 sm:px-4 py-4 pb-[max(2rem,env(safe-area-inset-bottom))] space-y-4">
          {kids.length > 1 && (
            <div className="flex gap-2 overflow-x-auto [scrollbar-width:none] -mx-3 px-3">
              {kids.map((k, i) => (
                <button
                  key={k.id}
                  onClick={() => setSel(i)}
                  className={`shrink-0 flex items-center gap-2 rounded-full border pl-1 pr-4 py-1 ${i === sel ? "border-primary bg-primary/10" : "border-border"}`}
                >
                  <StudentAvatar name={k.name} photo={k.photo_url} size={32} />
                  <span className="text-sm font-medium">{k.name.split(" ")[0]}</span>
                </button>
              ))}
            </div>
          )}

          {kid && (
            <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
              <div className="space-y-4">
                {/* Today */}
                <section className="rounded-3xl border border-border bg-card p-4 shadow-soft">
                  <div className="flex items-center gap-3">
                    <StudentAvatar name={kid.name} photo={kid.photo_url} size={56} />
                    <div className="min-w-0 flex-1">
                      <div className="font-display text-lg font-bold truncate">{kid.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {kid.class ? `Class ${kid.class} · ` : ""}
                        {bus ? busName(bus) : "No bus"}
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    {(["morning", "afternoon"] as const).map((r) => {
                      const t = kidTrips.find((x) => x.run === r);
                      const n = kidNotices.find(
                        (x) => x.service_date === today && (x.run === r || x.run === "both"),
                      );
                      return (
                        <div key={r} className="rounded-2xl bg-muted/50 p-3">
                          <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
                            <span className="inline-flex items-center gap-1.5">
                              {r === "morning" ? (
                                <Sunrise className="h-3.5 w-3.5" />
                              ) : (
                                <Sunset className="h-3.5 w-3.5" />
                              )}
                              {r === "morning" ? "To school" : "Home"}
                            </span>
                          </div>
                          <div className="mt-1.5">
                            {t ? (
                              <StatusPill status={t.status} />
                            ) : n ? (
                              <Pill tone="muted">{NOTICE_LABEL[n.kind]}</Pill>
                            ) : (
                              <Pill tone="neutral">Not started</Pill>
                            )}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {t?.boarded_at && `On ${fmtTime(t.boarded_at)}`}
                            {t?.dropped_at && ` · off ${fmtTime(t.dropped_at)}`}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>

                {/* Live bus */}
                <section className="rounded-3xl border border-border bg-card overflow-hidden shadow-soft">
                  <div className="p-4 flex items-start gap-3">
                    <div className={`relative shrink-0 ${live ? "" : "grayscale opacity-70"}`}>
                      <SchoolBusArt
                        size={64}
                        moving={live && (pos?.speed_kmh ?? 0) > 3}
                        className="text-success"
                      />
                      {live && (
                        <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-success ring-2 ring-card" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold">
                        {!bus
                          ? "No bus assigned"
                          : !live
                            ? `${busName(bus)} isn't sending its position right now`
                            : eta.kind === "eta"
                              ? `About ${eta.minutes} min to ${myStop?.name ?? "your stop"}`
                              : eta.kind === "arriving"
                                ? `Arriving at ${myStop?.name ?? "your stop"}`
                                : eta.kind === "passed"
                                  ? `${busName(bus)} has passed ${myStop?.name ?? "your stop"}`
                                  : `${busName(bus)} is on the road`}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {kmLeft != null ? `${(kmLeft / 1000).toFixed(1)} km away · ` : ""}
                        {pos ? `updated ${fmtTime(pos.last_seen)}` : ""}
                      </div>
                    </div>
                  </div>
                  <div className="h-[46dvh] min-h-[280px] lg:h-[420px] border-t border-border">
                    <Suspense
                      fallback={
                        <div className="h-full grid place-items-center text-muted-foreground">
                          <Loader2 className="h-5 w-5 animate-spin" />
                        </div>
                      }
                    >
                      <ParentMap
                        bus={
                          bus
                            ? {
                                lat: pos?.latitude ?? null,
                                lng: pos?.longitude ?? null,
                                vehicleType: "bus",
                                status: !live
                                  ? "offline"
                                  : (pos?.speed_kmh ?? 0) > 3
                                    ? "moving"
                                    : "stopped",
                                live,
                              }
                            : null
                        }
                        stops={routeStops.map((s) => ({
                          id: s.id,
                          name: s.name,
                          lat: s.lat!,
                          lng: s.lng!,
                          type: s.type,
                          sequence: s.sequence,
                        }))}
                        homeStopId={myStopId}
                        className="h-full"
                      />
                    </Suspense>
                  </div>
                </section>
              </div>

              <div className="space-y-4">
                <section className="rounded-3xl border border-border bg-card p-4 shadow-soft">
                  <h2 className="font-semibold">Change of plan?</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    The bus won't wait, and the school knows.
                  </p>
                  <div className="mt-3 grid gap-2">
                    <Button
                      variant="outline"
                      className="h-12 justify-start"
                      onClick={() => setNoticeOpen("not_riding")}
                    >
                      <Car className="h-4 w-4 mr-2 text-primary" /> Not riding the bus
                    </Button>
                    <Button
                      variant="outline"
                      className="h-12 justify-start"
                      onClick={() => setNoticeOpen("pickup")}
                    >
                      <Home className="h-4 w-4 mr-2 text-primary" /> I'll pick up from school
                    </Button>
                    <Button
                      variant="outline"
                      className="h-12 justify-start"
                      onClick={() => setNoticeOpen("absent")}
                    >
                      <CalendarX className="h-4 w-4 mr-2 text-primary" /> Absent (sick, travelling)
                    </Button>
                  </div>
                  {kidNotices.length > 0 && (
                    <ul className="mt-3 space-y-2">
                      {kidNotices.map((n) => (
                        <li
                          key={n.id}
                          className="flex items-center gap-2 rounded-xl bg-muted/50 px-3 py-2 text-sm"
                        >
                          <span className="flex-1">
                            <b>{NOTICE_LABEL[n.kind]}</b>
                            {n.kind === "not_riding"
                              ? ` (${n.run === "both" ? "all day" : n.run})`
                              : ""}{" "}
                            ·{" "}
                            {n.service_date === today
                              ? "today"
                              : new Date(`${n.service_date}T12:00:00`).toLocaleDateString("en-GB", {
                                  weekday: "short",
                                  day: "numeric",
                                  month: "short",
                                })}
                          </span>
                          <button
                            className="h-7 w-7 grid place-items-center rounded-full hover:bg-background"
                            aria-label="Cancel notice"
                            onClick={async () => {
                              const { error } = await db.rpc("cancel_ride_notice", { p_id: n.id });
                              if (error)
                                return toast.error(friendlyError(error, "Couldn't cancel"));
                              toast.success("Cancelled — the bus expects them again");
                              void load();
                            }}
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="rounded-3xl border border-border bg-card p-4 shadow-soft">
                  <div className="flex items-center justify-between">
                    <h2 className="font-semibold">Latest</h2>
                    <Button variant="ghost" size="sm" onClick={() => setHistoryOpen(true)}>
                      <History className="h-4 w-4 mr-1" /> Trip history
                    </Button>
                  </div>
                  <FeedList
                    items={feed.filter((f) => !f.student_id || f.student_id === kid.id).slice(0, 5)}
                  />
                </section>
              </div>
            </div>
          )}
        </main>
      )}

      <Sheet open={feedOpen} onOpenChange={setFeedOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Notifications</SheetTitle>
            <SheetDescription>Boarding, arrivals, delays and school messages.</SheetDescription>
          </SheetHeader>
          <div className="mt-4">
            <FeedList items={feed} />
          </div>
        </SheetContent>
      </Sheet>

      <SettingsSheet
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        prefs={prefs}
        setPrefs={setPrefs}
        userId={user?.id ?? ""}
        onSignOut={() => void signOut()}
        theme={theme}
        toggleTheme={toggle}
      />
      {kid && historyOpen && <HistoryDialog student={kid} onClose={() => setHistoryOpen(false)} />}
      {kid && noticeOpen && (
        <NoticeDialog
          kind={noticeOpen}
          student={kid}
          onClose={() => setNoticeOpen(null)}
          onSaved={() => {
            setNoticeOpen(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

function FeedList({ items }: { items: ParentNotification[] }) {
  if (!items.length)
    return (
      <p className="text-sm text-muted-foreground py-3">
        Nothing yet. You'll be told when the bus starts and when your child gets on and off.
      </p>
    );
  return (
    <ul className="divide-y divide-border">
      {items.map((n) => (
        <li key={n.id} className="py-2.5 flex gap-3">
          <span
            className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${n.read_at ? "bg-transparent" : "bg-primary"}`}
          />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium leading-snug">{n.title}</div>
            {n.body && <div className="text-xs text-muted-foreground mt-0.5">{n.body}</div>}
          </div>
          <span className="text-[11px] text-muted-foreground tabular-nums whitespace-nowrap">
            {fmtTime(n.created_at)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function NoticeDialog({
  kind,
  student,
  onClose,
  onSaved,
}: {
  kind: NoticeKind;
  student: StudentRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const today = kigaliDate();
  const tomorrow = kigaliDate(new Date(Date.now() + 86_400_000));
  const [date, setDate] = useState(today);
  const [run, setRun] = useState<Run>(defaultRun() === "afternoon" ? "afternoon" : "morning");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const title =
    kind === "absent"
      ? `${student.name.split(" ")[0]} is absent`
      : kind === "pickup"
        ? "I'll pick up from school"
        : `${student.name.split(" ")[0]} is not riding`;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {kind === "absent"
              ? "No bus either way. The school sees it as excused."
              : kind === "pickup"
                ? "They're taken off the afternoon bus list."
                : "Only this trip. The other trip stays as usual."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            {[
              { v: today, l: "Today" },
              { v: tomorrow, l: "Tomorrow" },
            ].map((d) => (
              <Button
                key={d.v}
                variant={date === d.v ? "default" : "outline"}
                onClick={() => setDate(d.v)}
              >
                {d.l}
              </Button>
            ))}
            <Input
              type="date"
              value={date}
              min={today}
              onChange={(e) => setDate(e.target.value || today)}
              className="px-2"
            />
          </div>
          {kind === "not_riding" && (
            <div className="grid grid-cols-2 gap-2">
              {(["morning", "afternoon"] as const).map((r) => (
                <Button
                  key={r}
                  variant={run === r ? "default" : "outline"}
                  onClick={() => setRun(r)}
                >
                  {r === "morning" ? (
                    <Sunrise className="h-4 w-4 mr-1.5" />
                  ) : (
                    <Sunset className="h-4 w-4 mr-1.5" />
                  )}
                  {r === "morning" ? "Morning" : "Afternoon"}
                </Button>
              ))}
            </div>
          )}
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note for the school (optional)"
            maxLength={200}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const { error } = await db.rpc("set_ride_notice", {
                p_student: student.id,
                p_date: date,
                p_kind: kind,
                p_run: kind === "not_riding" ? run : null,
                p_note: note || null,
              });
              setBusy(false);
              if (error) return toast.error(friendlyError(error, "Couldn't save"));
              toast.success("Saved — the attendant and the school can see it");
              onSaved();
            }}
          >
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HistoryDialog({ student, onClose }: { student: StudentRow; onClose: () => void }) {
  const [rows, setRows] = useState<
    | {
        id: number;
        action: string;
        occurred_at: string;
        trip: { run: Run; service_date: string } | null;
      }[]
    | null
  >(null);
  useEffect(() => {
    void db
      .from("boarding_events")
      .select("id, action, occurred_at, trip:bus_trips(run, service_date)")
      .eq("student_id", student.id)
      .order("occurred_at", { ascending: false })
      .limit(60)
      .then(({ data }) => setRows((data ?? []) as unknown as typeof rows));
  }, [student.id]);
  const label: Record<string, string> = {
    board: "Got on",
    drop: "Got off",
    not_here: "Not at the stop",
    auto_no_show: "Missed the bus",
    undo: "Correction",
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{student.name}'s trips</DialogTitle>
          <DialogDescription>Every time they got on and off the bus.</DialogDescription>
        </DialogHeader>
        {rows == null ? (
          <Loader2 className="h-5 w-5 animate-spin mx-auto text-primary" />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No trips yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <li key={r.id} className="py-2 flex items-center justify-between text-sm">
                <span>
                  <b>{label[r.action] ?? r.action}</b>
                  <span className="text-muted-foreground">
                    {" "}
                    · {r.trip?.run === "afternoon" ? "afternoon" : "morning"}
                  </span>
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {new Date(r.occurred_at).toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "short",
                  })}{" "}
                  {fmtTime(r.occurred_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SettingsSheet({
  open,
  onOpenChange,
  prefs,
  setPrefs,
  userId,
  onSignOut,
  theme,
  toggleTheme,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  prefs: Prefs;
  setPrefs: (p: Prefs) => void;
  userId: string;
  onSignOut: () => void;
  theme: string;
  toggleTheme: () => void;
}) {
  const [push, setPush] = useState<PushState | null>(null);
  useEffect(() => {
    if (open) void getPushState().then(setPush);
  }, [open]);
  async function save(p: Prefs) {
    setPrefs(p);
    const { error } = await db
      .from("parent_alert_prefs")
      .upsert({ user_id: userId, ...p, updated_at: new Date().toISOString() });
    if (error) toast.error(friendlyError(error, "Couldn't save"));
  }
  const Row = ({
    k,
    label,
    hint,
  }: {
    k: "boarding" | "approach" | "announcements";
    label: string;
    hint: string;
  }) => (
    <label className="flex items-center justify-between gap-3 py-3">
      <span>
        <span className="text-sm font-medium block">{label}</span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </span>
      <Switch checked={prefs[k]} onCheckedChange={(v) => void save({ ...prefs, [k]: v })} />
    </label>
  );
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Settings</SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-6">
          <div className="rounded-2xl border border-border p-4">
            <div className="flex items-center gap-2 font-semibold text-sm">
              <BellRing className="h-4 w-4 text-primary" /> Phone notifications
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {push === "on"
                ? "On for this phone."
                : push === "ios-install"
                  ? "On iPhone: tap Share → Add to Home Screen, open Live Track from there, then turn this on."
                  : push === "denied"
                    ? "Blocked in your phone's settings for this site."
                    : push === "unsupported"
                      ? "This browser can't receive notifications."
                      : "Get alerts even when the app is closed."}
            </p>
            {push === "off" && (
              <Button className="mt-3 w-full" onClick={async () => setPush(await enablePush())}>
                Turn on notifications
              </Button>
            )}
          </div>
          <div className="divide-y divide-border">
            <Row
              k="boarding"
              label="Gets on and off the bus"
              hint="Boarded, got off, not at the stop"
            />
            <Row
              k="approach"
              label="Bus is coming"
              hint="When the bus starts and is one stop away"
            />
            <Row
              k="announcements"
              label="Delays and school messages"
              hint="Traffic, breakdowns, notices"
            />
          </div>
          <div>
            <div className="text-sm font-medium mb-2">Warn me when the bus is</div>
            <div className="grid grid-cols-4 gap-2">
              {[1, 2, 3, 5].map((k) => (
                <Button
                  key={k}
                  variant={Number(prefs.approach_km) === k ? "default" : "outline"}
                  onClick={() => void save({ ...prefs, approach_km: k })}
                >
                  {k} km
                </Button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1.5">
              …from your stop (while Live Track is open).
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={toggleTheme}>
              {theme === "dark" ? (
                <Sun className="h-4 w-4 mr-1.5" />
              ) : (
                <Moon className="h-4 w-4 mr-1.5" />
              )}
              {theme === "dark" ? "Light mode" : "Dark mode"}
            </Button>
            <Button variant="outline" className="flex-1 text-destructive" onClick={onSignOut}>
              <LogOut className="h-4 w-4 mr-1.5" /> Sign out
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
            <BusIcon className="h-3.5 w-3.5" /> Live Track · school transport
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
