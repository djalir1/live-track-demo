import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Bus as BusIcon,
  UserCheck,
  Clock,
  UserX,
  ShieldAlert,
  ClipboardCheck,
  Megaphone,
  ArrowRight,
  Navigation,
  ParkingCircle,
  WifiOff,
  GraduationCap,
  CheckCircle2,
} from "lucide-react";
import { AppShell, PageHeader, useCurrentSchool } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import {
  EmptyState,
  Loading,
  MigrationNotice,
  Panel,
  Pill,
  StatCard,
  StudentAvatar,
} from "@/components/school/ui";
import { db } from "@/lib/fleet";
import { defaultRun, kigaliDate, type Run } from "@/lib/attendance";
import { ALERT_KIND_LABEL, busName } from "@/lib/school";
import { busLiveState, useSchoolDay, type BusLiveState } from "@/lib/use-school-day";
import { fmtTime } from "@/lib/time";
import { SchoolBusArt } from "@/components/SchoolBusArt";
import { DemoBusControls } from "@/components/DemoBusControls";

export const Route = createFileRoute("/admin/")({
  head: () => ({ meta: [{ title: "Overview — Live Track" }] }),
  component: () => (
    <AppShell>
      <Overview />
    </AppShell>
  ),
});

const LIVE: Record<
  BusLiveState,
  { label: string; tone: "success" | "info" | "muted" | "neutral"; Icon: typeof Navigation }
> = {
  moving: { label: "Moving", tone: "success", Icon: Navigation },
  parked: { label: "Parked", tone: "info", Icon: ParkingCircle },
  offline: { label: "No signal", tone: "muted", Icon: WifiOff },
  no_tracker: { label: "No tracker", tone: "neutral", Icon: WifiOff },
};

const ACTION_LABEL: Record<string, string> = {
  board: "boarded",
  drop: "got off",
  not_here: "was not at the stop",
  undo: "— correction",
  auto_no_show: "missed the bus",
};

function greeting() {
  const h = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Kigali", hour: "2-digit", hour12: false })
      .format(new Date())
      .slice(0, 2),
  );
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

function Overview() {
  const { school, schoolId } = useCurrentSchool();
  const date = kigaliDate();
  const day = useSchoolDay(schoolId, date);
  const [run, setRun] = useState<Run>(defaultRun());

  // The "child left on the bus" check also runs from the GPS server; running
  // it here means the school sees it even if that server is behind.
  useEffect(() => {
    if (schoolId && !day.missing) void db.rpc("check_open_trips");
  }, [schoolId, day.missing]);

  const totals = useMemo(() => {
    const t = { onBoard: 0, expected: 0, droppedOff: 0, notRiding: 0, noShow: 0, total: 0 };
    for (const trip of day.trips.filter((x) => x.run === run)) {
      const c = day.countsFor(trip.id);
      t.onBoard += c.onBoard;
      t.expected += c.expected;
      t.droppedOff += c.droppedOff;
      t.notRiding += c.notRiding;
      t.noShow += c.noShow;
      t.total += c.total;
    }
    return t;
  }, [day, run]);

  if (day.missing)
    return (
      <>
        <PageHeader title="Overview" />
        <MigrationNotice />
      </>
    );

  const dateLabel = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Kigali",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());
  const urgent = day.alerts.filter((a) => a.severity === "urgent").length;

  return (
    <>
      <PageHeader
        title={`${greeting()} 👋`}
        description={`${dateLabel} · ${school?.name ?? ""}`}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/admin/announcements">
                <Megaphone className="h-4 w-4 mr-1.5" /> Message parents
              </Link>
            </Button>
            <Button asChild className="bg-gradient-primary shadow-glow">
              <Link to="/bus">
                <ClipboardCheck className="h-4 w-4 mr-1.5" /> Open check-in
              </Link>
            </Button>
          </>
        }
      />

      <DemoBusControls schoolId={schoolId} className="mb-5" />

      {urgent > 0 && (
        <Link
          to="/admin/incidents"
          className="mb-5 flex items-center gap-3 rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm hover:bg-destructive/15"
        >
          <ShieldAlert className="h-5 w-5 text-destructive shrink-0" />
          <span className="flex-1">
            <b>
              {urgent} urgent safety alert{urgent > 1 ? "s" : ""}
            </b>{" "}
            — {day.alerts.find((a) => a.severity === "urgent")?.message}
          </span>
          <ArrowRight className="h-4 w-4" />
        </Link>
      )}

      <div className="flex items-center gap-2 mb-4">
        {(["morning", "afternoon"] as const).map((r) => (
          <button
            key={r}
            onClick={() => setRun(r)}
            className={`h-9 px-4 rounded-full text-sm font-medium border transition-colors ${
              run === r
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {r === "morning" ? "Morning run" : "Afternoon run"}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4 mb-6">
        <StatCard label="On board now" value={totals.onBoard} Icon={UserCheck} tone="success" />
        <StatCard
          label={run === "morning" ? "Still to pick up" : "Still at school"}
          value={totals.expected}
          Icon={Clock}
          tone="info"
        />
        <StatCard
          label={run === "morning" ? "Arrived at school" : "Dropped home"}
          value={totals.droppedOff}
          Icon={CheckCircle2}
        />
        <StatCard
          label="Not riding (notice)"
          value={totals.notRiding}
          Icon={GraduationCap}
          tone="muted"
        />
        <StatCard
          label="No-shows"
          value={totals.noShow}
          Icon={UserX}
          tone={totals.noShow ? "warning" : "neutral"}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <Panel
          title="Buses"
          description="Live position and who is on board"
          actions={
            <Button variant="ghost" size="sm" asChild>
              <Link to="/admin/trips">
                All trip lists <ArrowRight className="h-4 w-4 ml-1" />
              </Link>
            </Button>
          }
        >
          {day.loading ? (
            <Loading />
          ) : day.buses.length === 0 ? (
            <EmptyState
              Icon={BusIcon}
              title="No buses yet"
              action={
                <Button asChild>
                  <Link to="/admin/buses">Add a vehicle</Link>
                </Button>
              }
            />
          ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              {day.buses.map((b) => {
                const trip = day.tripFor(b.id, run);
                const c = trip ? day.countsFor(trip.id) : null;
                const live = LIVE[busLiveState(b, day.positions)];
                const planned = c ? c.total - c.notRiding : 0;
                return (
                  <Link
                    key={b.id}
                    to="/admin/trips"
                    search={{ bus: b.id, run }}
                    className="rounded-xl border border-border p-4 hover:border-primary/50 hover:bg-accent/30 transition-colors block"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2.5">
                          <SchoolBusArt
                            size={46}
                            className="shrink-0"
                            moving={busLiveState(b, day.positions) === "moving"}
                          />
                          <div className="font-semibold truncate">{busName(b)}</div>
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {day.attendantByBus.get(b.id)
                            ? `Attendant: ${day.attendantByBus.get(b.id)}`
                            : "No attendant"}
                        </div>
                      </div>
                      <Pill tone={live.tone}>
                        <live.Icon className="h-3 w-3" /> {live.label}
                      </Pill>
                    </div>
                    {trip && c ? (
                      <>
                        <div className="mt-3 flex h-2 rounded-full overflow-hidden bg-muted">
                          <div
                            className="bg-success"
                            style={{ width: `${planned ? (c.onBoard / planned) * 100 : 0}%` }}
                          />
                          <div
                            className="bg-primary"
                            style={{ width: `${planned ? (c.droppedOff / planned) * 100 : 0}%` }}
                          />
                          <div
                            className="bg-warning"
                            style={{ width: `${planned ? (c.noShow / planned) * 100 : 0}%` }}
                          />
                        </div>
                        <div className="mt-2 grid grid-cols-4 text-center text-[11px] text-muted-foreground">
                          <div>
                            <b className="block text-base text-foreground tabular-nums">
                              {c.onBoard}
                            </b>
                            on board
                          </div>
                          <div>
                            <b className="block text-base text-foreground tabular-nums">
                              {c.expected}
                            </b>
                            expected
                          </div>
                          <div>
                            <b className="block text-base text-foreground tabular-nums">
                              {c.droppedOff}
                            </b>
                            off
                          </div>
                          <div>
                            <b className="block text-base text-foreground tabular-nums">
                              {c.noShow + c.notRiding}
                            </b>
                            absent
                          </div>
                        </div>
                        {trip.status === "closed" && (
                          <div className="mt-2 text-xs text-success">
                            ✓ Trip closed, bus checked empty
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="mt-3 text-xs text-muted-foreground">
                        The {run} trip list hasn't been opened yet.
                      </div>
                    )}
                  </Link>
                );
              })}
            </div>
          )}
        </Panel>

        <div className="space-y-5">
          <Panel
            title="Safety alerts"
            actions={
              <Button variant="ghost" size="sm" asChild>
                <Link to="/admin/incidents">View all</Link>
              </Button>
            }
          >
            {day.alerts.length === 0 ? (
              <div className="text-sm text-muted-foreground flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-success" /> Nothing needs your attention.
              </div>
            ) : (
              <ul className="space-y-2.5">
                {day.alerts.slice(0, 5).map((a) => (
                  <li key={a.id} className="text-sm flex gap-2.5">
                    <span
                      className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${a.severity === "urgent" ? "bg-destructive" : "bg-warning"}`}
                    />
                    <div className="min-w-0">
                      <div className="text-xs text-muted-foreground">
                        {ALERT_KIND_LABEL[a.kind] ?? a.kind} · {fmtTime(a.created_at)}
                      </div>
                      <div className="leading-snug">{a.message}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Latest check-ins">
            {day.events.length === 0 ? (
              <div className="text-sm text-muted-foreground">No check-ins yet today.</div>
            ) : (
              <ul className="space-y-2.5">
                {day.events.slice(0, 8).map((e) => {
                  const s = day.students.get(e.student_id);
                  const b = day.buses.find((x) => x.id === e.bus_id);
                  return (
                    <li key={e.id} className="flex items-center gap-2.5 text-sm">
                      <StudentAvatar name={s?.name ?? "?"} photo={s?.photo_url} size={28} />
                      <div className="min-w-0 flex-1 truncate">
                        <b className="font-medium">{s?.name ?? "A student"}</b>{" "}
                        {ACTION_LABEL[e.action] ?? e.action}
                        <span className="text-muted-foreground"> · {busName(b)}</span>
                      </div>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {fmtTime(e.occurred_at)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          {day.notices.length > 0 && (
            <Panel title="Parent notices today" description="Children who won't ride a trip">
              <ul className="space-y-1.5 text-sm">
                {day.notices.slice(0, 8).map((n) => (
                  <li key={n.id} className="flex justify-between gap-2">
                    <span className="truncate">
                      {day.students.get(n.student_id)?.name ?? "Student"}
                    </span>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {n.kind === "absent"
                        ? "Absent"
                        : n.kind === "pickup"
                          ? "Picked up"
                          : `Not riding (${n.run})`}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}
