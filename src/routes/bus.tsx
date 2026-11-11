import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Loader2,
  LogOut,
  MapPin,
  Megaphone,
  CheckCheck,
  Lock,
  CloudOff,
  RefreshCw,
  Search,
  Fingerprint,
  Undo2,
  UserPlus,
  ShieldCheck,
  Moon,
  Sun,
  ArrowLeft,
  TrafficCone,
  Clock3,
  Siren,
  Wrench,
  MessageSquare,
  Sunrise,
  Sunset,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  NativeSelect,
  Pill,
  StatusPill,
  StudentAvatar,
  UnderConstruction,
} from "@/components/school/ui";
import { useAuth, homeFor } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme";
import { db } from "@/lib/fleet";
import { DEMO_MODE } from "@/lib/demo";
import { DemoBusControls } from "@/components/DemoBusControls";
import { friendlyError } from "@/lib/friendly-errors";
import {
  countTrip,
  defaultRun,
  groupByStop,
  kigaliDate,
  NOTICE_LABEL,
  type RiderStatus,
  type Run,
} from "@/lib/attendance";
import {
  busName,
  isMissingTable,
  type BusLite,
  type StopRow,
  type StudentRow,
  type Trip,
  type TripRider,
} from "@/lib/school";
import {
  enqueue,
  flushPending,
  isNetworkError,
  loadPending,
  newClientId,
  sendMark,
  type PendingMark,
} from "@/lib/offline-queue";
import { FINGERPRINT_STATUS } from "@/lib/biometrics";
import { SchoolBusArt } from "@/components/SchoolBusArt";
import { fmtTime } from "@/lib/time";

export const Route = createFileRoute("/bus")({
  head: () => ({ meta: [{ title: "Bus check-in — Live Track" }] }),
  validateSearch: (s: Record<string, unknown>): { bus?: string; run?: Run } => ({
    bus: typeof s.bus === "string" ? s.bus : undefined,
    run: s.run === "morning" || s.run === "afternoon" ? s.run : undefined,
  }),
  component: BusPage,
});

const MOVING_KMH = 5;

function BusPage() {
  const { user, role, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const { theme, toggle } = useTheme();

  const [buses, setBuses] = useState<BusLite[] | null>(null);
  const [busId, setBusId] = useState<string | null>(search.bus ?? null);
  const [run, setRun] = useState<Run>(search.run ?? defaultRun());
  const [isAttendant, setIsAttendant] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!user) navigate({ to: "/auth" });
    else if (role === "parent") navigate({ to: homeFor(role) });
  }, [loading, user, role, navigate]);

  // Which buses may I work? (RLS returns exactly those, plus all for admins.)
  useEffect(() => {
    if (!user || !role || role === "parent") return;
    (async () => {
      const [{ data: mine, error: aErr }, { data: list }] = await Promise.all([
        db.from("attendants").select("bus_id, active").eq("user_id", user.id),
        db.from("buses").select("*").order("label"),
      ]);
      if (isMissingTable(aErr))
        return setProblem("The attendance system isn't set up in this database yet.");
      const all = (list ?? []) as BusLite[];
      const assigned = ((mine ?? []) as { bus_id: string | null; active: boolean }[]).find(
        (a) => a.active && a.bus_id,
      )?.bus_id;
      setIsAttendant(!!assigned);
      const mineAsDriver = all.filter((b) => b.driver_user_id === user.id);
      const usable =
        role === "admin" || role === "school_admin"
          ? all
          : all.filter((b) => b.id === assigned || mineAsDriver.some((m) => m.id === b.id));
      setBuses(usable);
      setBusId(
        (cur) =>
          cur ?? assigned ?? mineAsDriver[0]?.id ?? (usable.length === 1 ? usable[0].id : null),
      );
      if (!usable.length)
        setProblem(
          "No bus is assigned to you yet. Ask the school to add you as the attendant of a bus.",
        );
    })();
  }, [user, role]);

  const bus = buses?.find((b) => b.id === busId) ?? null;
  const isDriverOnly =
    !!bus &&
    bus.driver_user_id === user?.id &&
    !isAttendant &&
    role !== "admin" &&
    role !== "school_admin";

  if (loading || !user || buses == null) {
    return problem ? (
      <Centered>{problem}</Centered>
    ) : (
      <div className="min-h-[100dvh] grid place-items-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col">
      <header className="sticky top-0 z-30 pt-safe bg-background/85 backdrop-blur-xl border-b border-border/60">
        <div className="h-14 px-3 flex items-center gap-2">
          {(role === "admin" || role === "school_admin") && (
            <Button variant="ghost" size="icon" asChild>
              <Link to="/admin/trips" aria-label="Back to school dashboard">
                <ArrowLeft className="h-5 w-5" />
              </Link>
            </Button>
          )}
          <SchoolBusArt size={44} className="shrink-0 hidden min-[360px]:block" />
          <div className="min-w-0 flex-1">
            {buses.length > 1 ? (
              <NativeSelect
                value={busId ?? ""}
                onChange={(v) => setBusId(v)}
                className="h-9 font-semibold"
              >
                <option value="" disabled>
                  Choose a bus
                </option>
                {buses.map((b) => (
                  <option key={b.id} value={b.id}>
                    {busName(b)}
                  </option>
                ))}
              </NativeSelect>
            ) : (
              <div className="font-display font-bold truncate">{busName(bus)}</div>
            )}
          </div>
          <Button variant="ghost" size="icon" onClick={toggle} aria-label="Theme">
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
          <Button variant="ghost" size="icon" onClick={() => void signOut()} aria-label="Sign out">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
        <div className="px-3 pb-2 grid grid-cols-2 gap-2">
          {(["morning", "afternoon"] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRun(r)}
              className={`h-9 rounded-full text-sm font-medium border ${run === r ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground"}`}
            >
              <span className="inline-flex items-center gap-1.5">
                {r === "morning" ? <Sunrise className="h-4 w-4" /> : <Sunset className="h-4 w-4" />}
                {r === "morning" ? "Morning" : "Afternoon"}
              </span>
            </button>
          ))}
        </div>
      </header>
      {bus && (
        <div className="px-3 pt-3">
          <DemoBusControls busId={bus.id} collapsible />
        </div>
      )}
      {bus ? (
        <TripScreen key={`${bus.id}:${run}`} bus={bus} run={run} driverOnly={isDriverOnly} />
      ) : (
        <Centered>Choose your bus above.</Centered>
      )}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 min-h-[60dvh] grid place-items-center px-6 text-center text-muted-foreground">
      {children}
    </div>
  );
}

// ── One trip ────────────────────────────────────────────────────────────────

function useGeo() {
  const pos = useRef<{ lat: number; lng: number } | null>(null);
  useEffect(() => {
    // Demo: the phone is not on the bus, so its position would only raise
    // false "got off far from the stop" alerts.
    if (DEMO_MODE || !("geolocation" in navigator)) return;
    const id = navigator.geolocation.watchPosition(
      (p) => (pos.current = { lat: p.coords.latitude, lng: p.coords.longitude }),
      () => {},
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: 20_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);
  return pos;
}

function TripScreen({ bus, run, driverOnly }: { bus: BusLite; run: Run; driverOnly: boolean }) {
  const date = kigaliDate();
  const [trip, setTrip] = useState<Trip | null | undefined>(undefined);
  const [riders, setRiders] = useState<TripRider[]>([]);
  const [students, setStudents] = useState<Map<string, StudentRow>>(new Map());
  const [stops, setStops] = useState<StopRow[]>([]);
  const [currentStop, setCurrentStop] = useState<string | null>(null);
  const [speed, setSpeed] = useState(0);
  const [pending, setPending] = useState(loadPending().length);
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [starting, setStarting] = useState(false);
  const [announce, setAnnounce] = useState(false);
  const [closing, setClosing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState("");
  const geo = useGeo();

  const load = useCallback(async () => {
    const { data: t } = await db
      .from("bus_trips")
      .select("*")
      .eq("bus_id", bus.id)
      .eq("service_date", date)
      .eq("run", run)
      .maybeSingle();
    setTrip((t as Trip | null) ?? null);
    const [st, ev] = await Promise.all([
      bus.route_id
        ? db.from("stops").select("*").eq("route_id", bus.route_id)
        : Promise.resolve({ data: [] }),
      db
        .from("geofence_events")
        .select("stop_id, event_type, occurred_at")
        .eq("bus_id", bus.id)
        .order("occurred_at", { ascending: false })
        .limit(1),
    ]);
    setStops((st.data ?? []) as StopRow[]);
    const last = (ev.data ?? [])[0] as
      { stop_id: string; event_type: string; occurred_at: string } | undefined;
    setCurrentStop(
      last &&
        last.event_type === "arrive" &&
        Date.now() - new Date(last.occurred_at).getTime() < 30 * 60_000
        ? last.stop_id
        : null,
    );
    if (!t) return setRiders([]);
    const { data: r } = await db
      .from("trip_students")
      .select("*")
      .eq("trip_id", (t as Trip).id);
    const rs = (r ?? []) as TripRider[];
    setRiders(rs);
    if (rs.length) {
      const { data: s } = await db
        .from("students")
        .select("*")
        .in(
          "id",
          rs.map((x) => x.student_id),
        );
      setStudents(new Map(((s ?? []) as StudentRow[]).map((x) => [x.id, x])));
    }
  }, [bus.id, bus.route_id, date, run]);

  useEffect(() => {
    void load();
  }, [load]);

  // Live: other devices marking, stop arrivals, bus speed (driver lock).
  useEffect(() => {
    const ch = db
      .channel(`bus:${bus.id}:${run}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "trip_students",
          filter: trip ? `trip_id=eq.${trip.id}` : "trip_id=eq.none",
        },
        (p) => {
          const row = p.new as TripRider;
          if (row?.student_id)
            setRiders((list) =>
              list.some((x) => x.student_id === row.student_id)
                ? list.map((x) => (x.student_id === row.student_id ? row : x))
                : [...list, row],
            );
        },
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "geofence_events",
          filter: `bus_id=eq.${bus.id}`,
        },
        (p) => {
          const e = p.new as { stop_id: string; event_type: string };
          setCurrentStop(e.event_type === "arrive" ? e.stop_id : null);
          if (e.event_type === "arrive") navigator.vibrate?.(120);
        },
      );
    if (bus.driver_user_id)
      ch.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "device_status",
          filter: `user_id=eq.${bus.driver_user_id}`,
        },
        (p) => {
          setSpeed(Number((p.new as { speed_kmh?: number }).speed_kmh ?? 0));
        },
      );
    ch.subscribe();
    return () => void db.removeChannel(ch);
  }, [bus.id, bus.driver_user_id, run, trip]);

  // Offline queue: send waiting check-ins when the network is back.
  useEffect(() => {
    const flush = async () => {
      if (!loadPending().length) return;
      const r = await flushPending();
      setPending(r.left);
      if (r.sent) toast.success(`${r.sent} check-in${r.sent > 1 ? "s" : ""} sent`);
      r.refused.forEach((m) => toast.error(m));
      if (r.sent) void load();
    };
    const up = () => {
      setOnline(true);
      void flush();
    };
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    const iv = setInterval(flush, 20_000);
    void flush();
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
      clearInterval(iv);
    };
  }, [load]);

  const locked = driverOnly && speed > MOVING_KMH;

  async function start() {
    setStarting(true);
    const { error } = await db.rpc("open_bus_trip", { p_bus: bus.id, p_run: run });
    setStarting(false);
    if (error) return toast.error(friendlyError(error, "Couldn't start the trip"));
    toast.success("Trip started — parents are told the bus is on its way");
    void load();
  }

  async function mark(
    studentId: string,
    action: PendingMark["action"],
    method: PendingMark["method"] = "manual",
  ) {
    if (!trip) return;
    if (locked) return toast.error("Stop the bus before marking children.");
    const m: PendingMark = {
      client_id: newClientId(),
      trip_id: trip.id,
      student_id: studentId,
      action,
      lat: geo.current?.lat ?? null,
      lng: geo.current?.lng ?? null,
      at: new Date().toISOString(),
      method,
    };
    // Show it at once; the server confirms (or corrects) a moment later.
    const optimistic: Record<PendingMark["action"], RiderStatus> = {
      board: "boarded",
      drop: "dropped_off",
      not_here: "no_show",
      undo: "expected",
    };
    const prev = riders.find((r) => r.student_id === studentId);
    setRiders((list) =>
      list.some((r) => r.student_id === studentId)
        ? list.map((r) =>
            r.student_id === studentId
              ? {
                  ...r,
                  status: optimistic[action],
                  boarded_at: action === "board" ? m.at : r.boarded_at,
                  dropped_at: action === "drop" ? m.at : r.dropped_at,
                }
              : r,
          )
        : list,
    );
    navigator.vibrate?.(30);
    try {
      const res = await sendMark(m);
      if (res.wrong_bus && action === "board")
        toast.warning("Not their usual bus — the school and parent have been told.");
      if (!prev) void load();
    } catch (e) {
      if (isNetworkError(e)) {
        enqueue(m);
        setPending(loadPending().length);
        toast.message("Saved on this phone — will send when the network is back");
      } else {
        toast.error(friendlyError(e, "Couldn't save"));
        void load();
      }
    }
  }

  async function dropAll() {
    if (!trip) return;
    if (
      !window.confirm(
        `Mark all ${counts.onBoard} children on board as got off${run === "morning" ? " at school" : ""}?`,
      )
    )
      return;
    const { data, error } = await db.rpc("drop_all", {
      p_trip: trip.id,
      p_lat: geo.current?.lat ?? null,
      p_lng: geo.current?.lng ?? null,
    });
    if (error) return toast.error(friendlyError(error, "Couldn't save"));
    toast.success(`${data} children marked off`);
    void load();
  }

  const counts = countTrip(riders);
  const filtered = q.trim()
    ? riders.filter((r) =>
        students.get(r.student_id)?.name.toLowerCase().includes(q.trim().toLowerCase()),
      )
    : riders;
  const groups = useMemo(
    () => groupByStop(filtered, stops, run, currentStop),
    [filtered, stops, run, currentStop],
  );

  if (trip === undefined)
    return (
      <Centered>
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </Centered>
    );

  if (!trip) {
    return (
      <div className="flex-1 px-4 py-8 max-w-md mx-auto w-full text-center space-y-5">
        <SchoolBusArt size={180} className="mx-auto text-primary" moving />
        <div>
          <h1 className="font-display text-2xl font-bold">Start the {run} trip</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {run === "morning" ? "Home stops → school." : "School → home stops."} The trip list
            opens and parents are told the bus is on its way.
          </p>
        </div>
        <Button
          size="lg"
          className="w-full h-14 text-base bg-gradient-primary shadow-glow"
          onClick={start}
          disabled={starting}
        >
          {starting ? <Loader2 className="h-5 w-5 animate-spin" /> : `Start ${run} trip`}
        </Button>
      </div>
    );
  }

  const closed = trip.status === "closed";

  return (
    <>
      <div className="px-3 pt-3 space-y-3">
        <div className="grid grid-cols-4 gap-2 text-center">
          {[
            { n: counts.onBoard, l: "On board", c: "text-success" },
            {
              n: counts.expected,
              l: run === "morning" ? "To pick up" : "Waiting",
              c: "text-primary",
            },
            { n: counts.droppedOff, l: "Got off", c: "" },
            { n: counts.noShow + counts.notRiding, l: "Absent", c: "text-muted-foreground" },
          ].map((x) => (
            <div key={x.l} className="rounded-xl border border-border bg-card py-2">
              <div className={`font-display text-2xl font-bold tabular-nums ${x.c}`}>{x.n}</div>
              <div className="text-[10px] text-muted-foreground">{x.l}</div>
            </div>
          ))}
        </div>

        {(!online || pending > 0) && (
          <div className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm flex items-center gap-2">
            <CloudOff className="h-4 w-4 text-warning" />
            <span className="flex-1">
              {online
                ? `${pending} check-in${pending > 1 ? "s" : ""} waiting to send`
                : "No network — check-ins are saved on this phone"}
            </span>
            {online && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void flushPending().then((r) => setPending(r.left))}
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            )}
          </div>
        )}

        {closed && (
          <div className="rounded-xl border border-success/40 bg-success/10 px-3 py-2 text-sm flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-success" /> Trip closed at{" "}
            {fmtTime(trip.closed_at!)} — bus checked empty.
          </div>
        )}

        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Find a child"
              className="pl-9 h-11"
            />
          </div>
          {!closed && (
            <Button
              variant="outline"
              className="h-11"
              onClick={() => setAdding(true)}
              title="A child who is not on this list"
            >
              <UserPlus className="h-4 w-4" />
            </Button>
          )}
          <Button
            variant="outline"
            className="h-11 opacity-70"
            title={FINGERPRINT_STATUS.detail}
            onClick={() =>
              toast.info(
                `Fingerprint check-in: ${FINGERPRINT_STATUS.label.toLowerCase()}. ${FINGERPRINT_STATUS.detail}`,
              )
            }
          >
            <Fingerprint className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <main className="flex-1 px-3 pt-3 pb-40 space-y-5">
        {groups.length === 0 && (
          <p className="text-center text-muted-foreground py-10">Nobody on this list.</p>
        )}
        {groups.map((g) => (
          <section key={g.stop?.id ?? "none"}>
            <div
              className={`sticky top-[104px] z-10 -mx-3 px-3 py-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide ${g.isCurrent ? "bg-success/15 text-success" : "bg-background/90 text-muted-foreground"} backdrop-blur`}
            >
              <MapPin className="h-3.5 w-3.5" />
              {g.stop?.name ?? "No stop"}
              {g.isCurrent && <span className="normal-case font-bold">· Bus is here</span>}
            </div>
            <ul className="mt-2 space-y-2">
              {g.riders.map((r) => {
                const s = students.get(r.student_id);
                return (
                  <RiderCard
                    key={r.student_id}
                    rider={r}
                    student={s}
                    run={run}
                    disabled={closed || locked}
                    onMark={(a) => void mark(r.student_id, a)}
                  />
                );
              })}
            </ul>
          </section>
        ))}
      </main>

      {!closed && (
        <div className="fixed bottom-0 inset-x-0 z-30 border-t border-border bg-background/95 backdrop-blur-xl px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="max-w-2xl mx-auto grid grid-cols-3 gap-2">
            <Button
              variant="outline"
              className="h-12 flex-col gap-0.5 text-xs"
              onClick={() => setAnnounce(true)}
            >
              <Megaphone className="h-4 w-4" /> Announce
            </Button>
            <Button
              variant="outline"
              className="h-12 flex-col gap-0.5 text-xs"
              disabled={!counts.onBoard || locked}
              onClick={dropAll}
            >
              <CheckCheck className="h-4 w-4" />{" "}
              {run === "morning" ? "All off at school" : "All off"}
            </Button>
            <Button
              className="h-12 flex-col gap-0.5 text-xs bg-gradient-primary"
              disabled={locked}
              onClick={() => setClosing(true)}
            >
              <ShieldCheck className="h-4 w-4" /> End trip
            </Button>
          </div>
        </div>
      )}

      {locked && (
        <div className="fixed inset-x-0 top-[104px] bottom-[84px] z-20 bg-background/80 backdrop-blur-sm grid place-items-center px-8 text-center">
          <div>
            <Lock className="h-10 w-10 mx-auto text-warning" />
            <h2 className="mt-3 font-display text-xl font-bold">The bus is moving</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Check-in is locked while you drive. Announcements still work.
            </p>
          </div>
        </div>
      )}

      <AnnounceSheet open={announce} onOpenChange={setAnnounce} busId={bus.id} />
      {closing && (
        <CloseDialog
          trip={trip}
          riders={riders}
          students={students}
          onClose={() => setClosing(false)}
          onDone={() => {
            setClosing(false);
            void load();
          }}
        />
      )}
      {adding && (
        <AddRiderDialog
          trip={trip}
          onClose={() => setAdding(false)}
          onPick={(id) => {
            setAdding(false);
            void mark(id, "board");
          }}
        />
      )}
    </>
  );
}

function RiderCard({
  rider,
  student,
  run,
  disabled,
  onMark,
}: {
  rider: TripRider;
  student: StudentRow | undefined;
  run: Run;
  disabled: boolean;
  onMark: (a: PendingMark["action"]) => void;
}) {
  const name = student?.name ?? "Student";
  const done = rider.status === "dropped_off" || rider.status === "not_riding";
  return (
    <li
      className={`rounded-2xl border bg-card p-3 ${rider.wrong_bus ? "border-destructive/50" : "border-border"} ${done ? "opacity-70" : ""}`}
    >
      <div className="flex items-center gap-3">
        <StudentAvatar name={name} photo={student?.photo_url} size={52} />
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-[15px] truncate">{name}</div>
          <div className="text-xs text-muted-foreground truncate">
            {student?.class ? `Class ${student.class}` : ""}
            {rider.notice_kind ? ` · ${NOTICE_LABEL[rider.notice_kind]}` : ""}
            {rider.boarded_at && rider.status === "boarded"
              ? ` · on at ${fmtTime(rider.boarded_at)}`
              : ""}
            {rider.dropped_at && rider.status === "dropped_off"
              ? ` · off at ${fmtTime(rider.dropped_at)}`
              : ""}
          </div>
          {student?.notes && (
            <div className="text-[11px] text-warning truncate">⚑ {student.notes}</div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          <StatusPill status={rider.status} />
          {rider.wrong_bus && <Pill tone="danger">Not their bus</Pill>}
        </div>
      </div>
      {!disabled && (
        <div className="mt-3 flex gap-2">
          {rider.status === "expected" ||
          rider.status === "no_show" ||
          rider.status === "not_riding" ? (
            <>
              <Button
                className="flex-1 h-12 text-base bg-success hover:bg-success/90 text-white"
                onClick={() => onMark("board")}
              >
                On ✓
              </Button>
              {rider.status === "expected" && (
                <Button
                  variant="outline"
                  className="flex-1 h-12 text-base"
                  onClick={() => onMark("not_here")}
                >
                  {run === "morning" ? "Not here" : "Not coming"}
                </Button>
              )}
            </>
          ) : rider.status === "boarded" ? (
            <Button className="flex-1 h-12 text-base" onClick={() => onMark("drop")}>
              Off {run === "morning" ? "at school" : "here"} ↓
            </Button>
          ) : null}
          {(rider.status === "boarded" ||
            rider.status === "dropped_off" ||
            rider.status === "no_show") && (
            <Button
              variant="ghost"
              className="h-12 px-3"
              title="Undo (tapped by mistake)"
              onClick={() => onMark("undo")}
            >
              <Undo2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

// ── Announcements ───────────────────────────────────────────────────────────

function AnnounceSheet({
  open,
  onOpenChange,
  busId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  busId: string;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  async function send(kind: string, delay: number | null = null, message: string | null = null) {
    setBusy(true);
    const { error } = await db.rpc("post_announcement", {
      p_school: null,
      p_bus: busId,
      p_kind: kind,
      p_delay_min: delay,
      p_message: message,
    });
    setBusy(false);
    if (error) return toast.error(friendlyError(error, "Couldn't send"));
    toast.success("Sent to every parent on this bus");
    setText("");
    onOpenChange(false);
  }
  const Row = ({
    Icon,
    label,
    children,
  }: {
    Icon: typeof Clock3;
    label: string;
    children: React.ReactNode;
  }) => (
    <div>
      <div className="text-sm font-medium flex items-center gap-2 mb-2">
        <Icon className="h-4 w-4 text-primary" /> {label}
      </div>
      <div className="grid grid-cols-3 gap-2">{children}</div>
    </div>
  );
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-3xl max-h-[90dvh] overflow-y-auto pb-[max(1.5rem,env(safe-area-inset-bottom))]"
      >
        <SheetHeader className="text-left">
          <SheetTitle>Tell every parent on this bus</SheetTitle>
          <SheetDescription>One tap. They get it as a notification at once.</SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-5">
          <Row Icon={TrafficCone} label="Heavy traffic">
            {[10, 20, 30].map((d) => (
              <Button
                key={d}
                variant="outline"
                disabled={busy}
                onClick={() => void send("traffic", d)}
              >
                +{d} min
              </Button>
            ))}
          </Row>
          <Row Icon={Clock3} label="Running late">
            {[10, 20, 30].map((d) => (
              <Button
                key={d}
                variant="outline"
                disabled={busy}
                onClick={() => void send("late", d)}
              >
                +{d} min
              </Button>
            ))}
          </Row>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              className="h-14 border-destructive/40 text-destructive"
              disabled={busy}
              onClick={() =>
                window.confirm(
                  "Send: accident on the road, all children are safe? The school is alerted too.",
                ) && void send("accident")
              }
            >
              <Siren className="h-4 w-4 mr-1.5" /> Accident — all safe
            </Button>
            <Button
              variant="outline"
              className="h-14 border-warning/40 text-warning"
              disabled={busy}
              onClick={() =>
                window.confirm("Send: the bus has broken down? The school is alerted too.") &&
                void send("breakdown")
              }
            >
              <Wrench className="h-4 w-4 mr-1.5" /> Breakdown
            </Button>
          </div>
          <div>
            <div className="text-sm font-medium flex items-center gap-2 mb-2">
              <MessageSquare className="h-4 w-4 text-primary" /> Your own message
            </div>
            <div className="flex gap-2">
              <Input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="e.g. Road closed, taking the Remera road"
                maxLength={200}
              />
              <Button
                disabled={busy || !text.trim()}
                onClick={() => void send("custom", null, text)}
              >
                Send
              </Button>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── End of trip: "bus is empty" ─────────────────────────────────────────────

function CloseDialog({
  trip,
  riders,
  students,
  onClose,
  onDone,
}: {
  trip: Trip;
  riders: TripRider[];
  students: Map<string, StudentRow>;
  onClose: () => void;
  onDone: () => void;
}) {
  const [empty, setEmpty] = useState(false);
  const [busy, setBusy] = useState(false);
  const onBoard = riders.filter((r) => r.status === "boarded");
  const waiting = riders.filter((r) => r.status === "expected");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>End this trip</DialogTitle>
          <DialogDescription>
            No child may be left on the bus. Walk to the back and check every seat.
          </DialogDescription>
        </DialogHeader>
        {onBoard.length > 0 ? (
          <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm">
            <b>Still marked on board:</b>{" "}
            {onBoard.map((r) => students.get(r.student_id)?.name ?? "Student").join(", ")}.
            <div className="text-muted-foreground mt-1">Mark them off first.</div>
          </div>
        ) : (
          <>
            {waiting.length > 0 && (
              <div className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">
                {waiting.length} child{waiting.length > 1 ? "ren" : ""} never got on (
                {waiting.map((r) => students.get(r.student_id)?.name).join(", ")}). They will be
                marked as no-show and their parents told.
              </div>
            )}
            <label className="flex items-start gap-3 rounded-xl border border-border p-3 text-sm">
              <Checkbox className="mt-0.5" checked={empty} onCheckedChange={(v) => setEmpty(!!v)} />
              <span>
                <b>I walked through the bus.</b> It is empty — no child is asleep or hiding on a
                seat.
              </span>
            </label>
          </>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!empty || onBoard.length > 0 || busy}
            onClick={async () => {
              setBusy(true);
              const { error } = await db.rpc("close_bus_trip", {
                p_trip: trip.id,
                p_bus_empty: true,
              });
              setBusy(false);
              if (error) return toast.error(friendlyError(error, "Couldn't end the trip"));
              toast.success("Trip ended. Thank you!");
              onDone();
            }}
          >
            End trip
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddRiderDialog({
  trip,
  onClose,
  onPick,
}: {
  trip: Trip;
  onClose: () => void;
  onPick: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<
    { id: string; name: string; class: string | null; photo_url: string | null }[]
  >([]);
  useEffect(() => {
    if (q.trim().length < 2) return setRes([]);
    const t = setTimeout(async () => {
      const { data } = await db.rpc("find_student_for_trip", { p_trip: trip.id, p_query: q });
      setRes((data ?? []) as typeof res);
    }, 250);
    return () => clearTimeout(t);
  }, [q, trip.id]);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>A child who is not on this list</DialogTitle>
          <DialogDescription>
            Safety first: they can ride. The school and their parent are told.
          </DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Type their name"
        />
        <ul className="space-y-1 max-h-72 overflow-y-auto">
          {res.map((s) => (
            <li key={s.id}>
              <button
                className="w-full flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-accent text-left"
                onClick={() => onPick(s.id)}
              >
                <StudentAvatar name={s.name} photo={s.photo_url} size={36} />
                <span className="flex-1">
                  <span className="font-medium block">{s.name}</span>
                  <span className="text-xs text-muted-foreground">{s.class}</span>
                </span>
                <span className="text-sm text-success font-medium">On ✓</span>
              </button>
            </li>
          ))}
        </ul>
        <UnderConstruction title="Fingerprint">{FINGERPRINT_STATUS.detail}</UnderConstruction>
      </DialogContent>
    </Dialog>
  );
}
