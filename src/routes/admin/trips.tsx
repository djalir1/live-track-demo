import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ClipboardCheck,
  Play,
  ArrowLeftRight,
  Bus as BusIcon,
  MapPin,
  AlertTriangle,
  ExternalLink,
} from "lucide-react";
import { AppShell, PageHeader, useCurrentSchool } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  EmptyState,
  Loading,
  MigrationNotice,
  NativeSelect,
  Panel,
  Pill,
  StatusPill,
  StudentAvatar,
} from "@/components/school/ui";
import { db } from "@/lib/fleet";
import { friendlyError } from "@/lib/friendly-errors";
import { NOTICE_LABEL, defaultRun, groupByStop, kigaliDate, type Run } from "@/lib/attendance";
import { busName, type Trip } from "@/lib/school";
import { useSchoolDay } from "@/lib/use-school-day";
import { fmtTime } from "@/lib/time";

export const Route = createFileRoute("/admin/trips")({
  head: () => ({ meta: [{ title: "Trips & check-in — Live Track" }] }),
  validateSearch: (s: Record<string, unknown>): { bus?: string; run?: Run } => ({
    bus: typeof s.bus === "string" ? s.bus : undefined,
    run: s.run === "morning" || s.run === "afternoon" ? s.run : undefined,
  }),
  component: () => (
    <AppShell>
      <TripsPage />
    </AppShell>
  ),
});

function TripsPage() {
  const search = Route.useSearch();
  const { schoolId } = useCurrentSchool();
  const [date, setDate] = useState(kigaliDate());
  const [run, setRun] = useState<Run>(search.run ?? defaultRun());
  const [busId, setBusId] = useState<string | null>(search.bus ?? null);
  const [moving, setMoving] = useState<Trip | null>(null);
  const day = useSchoolDay(schoolId, date);
  const today = date === kigaliDate();

  const bus = day.buses.find((b) => b.id === busId) ?? day.buses[0];
  const trip = bus ? day.tripFor(bus.id, run) : undefined;
  const riders = useMemo(
    () => (trip ? day.riders.filter((r) => r.trip_id === trip.id) : []),
    [day.riders, trip],
  );
  const routeStops = day.stops.filter((s) => s.route_id === (trip?.route_id ?? bus?.route_id));
  const groups = groupByStop(riders, routeStops, run, null);

  async function openTrip() {
    if (!bus) return;
    const { error } = await db.rpc("open_bus_trip", { p_bus: bus.id, p_run: run, p_date: date });
    if (error) return toast.error(friendlyError(error, "Couldn't open the trip list"));
    toast.success(`${run === "morning" ? "Morning" : "Afternoon"} list opened for ${busName(bus)}`);
    void day.reload();
  }

  if (day.missing)
    return (
      <>
        <PageHeader title="Trips & check-in" />
        <MigrationNotice />
      </>
    );

  return (
    <>
      <PageHeader
        title="Trips & check-in"
        description="Two trip lists per bus each day. The attendant marks each child; you see it here as it happens."
        actions={
          <Button asChild className="bg-gradient-primary shadow-glow">
            <Link to="/bus">
              <ClipboardCheck className="h-4 w-4 mr-1.5" /> Attendant screen
            </Link>
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2 mb-5">
        <Input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value || kigaliDate())}
          className="w-auto"
        />
        {(["morning", "afternoon"] as const).map((r) => (
          <button
            key={r}
            onClick={() => setRun(r)}
            className={`h-10 px-4 rounded-full text-sm font-medium border ${run === r ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground"}`}
          >
            {r === "morning" ? "Morning" : "Afternoon"}
          </button>
        ))}
      </div>

      {day.loading ? (
        <Loading />
      ) : day.buses.length === 0 ? (
        <Panel>
          <EmptyState Icon={BusIcon} title="No buses yet" />
        </Panel>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
          <Panel bodyClassName="p-2" className="h-fit">
            <ul className="space-y-1">
              {day.buses.map((b) => {
                const t = day.tripFor(b.id, run);
                const c = t ? day.countsFor(t.id) : null;
                const active = b.id === bus?.id;
                return (
                  <li key={b.id}>
                    <button
                      onClick={() => setBusId(b.id)}
                      className={`w-full text-left rounded-lg px-3 py-2.5 transition-colors ${active ? "bg-accent" : "hover:bg-accent/50"}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium truncate">{busName(b)}</span>
                        {t ? (
                          t.status === "closed" ? (
                            <Pill tone="success">Closed</Pill>
                          ) : (
                            <Pill tone="info">Open</Pill>
                          )
                        ) : (
                          <Pill tone="neutral">Not started</Pill>
                        )}
                      </div>
                      {c && (
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {c.onBoard} on board · {c.expected} expected · {c.droppedOff} off
                          {c.noShow ? ` · ${c.noShow} no-show` : ""}
                        </div>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </Panel>

          <Panel
            title={
              bus ? `${busName(bus)} · ${run === "morning" ? "Morning" : "Afternoon"} trip` : ""
            }
            description={
              trip
                ? `Opened ${fmtTime(trip.opened_at)}${trip.closed_at ? ` · closed ${fmtTime(trip.closed_at)} after the empty-bus check` : ""}${trip.note ? ` · ${trip.note}` : ""}`
                : "Not started yet"
            }
            actions={
              trip ? (
                <>
                  {trip.status === "open" && (
                    <Button variant="outline" size="sm" onClick={() => setMoving(trip)}>
                      <ArrowLeftRight className="h-4 w-4 mr-1.5" /> Move to another bus
                    </Button>
                  )}
                  {today && trip.status === "open" && (
                    <Button size="sm" asChild>
                      <Link to="/bus" search={{ bus: bus!.id, run }}>
                        Mark <ExternalLink className="h-3.5 w-3.5 ml-1" />
                      </Link>
                    </Button>
                  )}
                </>
              ) : (
                date >= kigaliDate() && (
                  <Button size="sm" onClick={openTrip}>
                    <Play className="h-4 w-4 mr-1.5" /> Open trip list
                  </Button>
                )
              )
            }
          >
            {!trip ? (
              <EmptyState Icon={ClipboardCheck} title="No trip list yet">
                The list opens when the attendant starts the trip on their phone. You can also open
                it now.
              </EmptyState>
            ) : riders.length === 0 ? (
              <EmptyState Icon={ClipboardCheck} title="Nobody on this list">
                Assign students to this bus on the Students page.
              </EmptyState>
            ) : (
              <div className="space-y-5">
                {groups.map((g) => (
                  <div key={g.stop?.id ?? "none"}>
                    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                      <MapPin className="h-3.5 w-3.5" /> {g.stop ? g.stop.name : "No stop set"}
                      <span className="font-normal normal-case">· {g.riders.length}</span>
                    </div>
                    <ul className="divide-y divide-border rounded-xl border border-border">
                      {g.riders.map((r) => {
                        const s = day.students.get(r.student_id);
                        return (
                          <li key={r.student_id} className="flex items-center gap-3 px-3 py-2.5">
                            <StudentAvatar name={s?.name ?? "?"} photo={s?.photo_url} size={34} />
                            <div className="min-w-0 flex-1">
                              <div className="font-medium truncate flex items-center gap-2">
                                {s?.name ?? "Student"}
                                {r.wrong_bus && (
                                  <Pill tone="danger">
                                    <AlertTriangle className="h-3 w-3" /> Not their bus
                                  </Pill>
                                )}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {s?.class ?? ""}
                                {r.notice_kind ? ` · ${NOTICE_LABEL[r.notice_kind]}` : ""}
                                {r.boarded_at ? ` · on ${fmtTime(r.boarded_at)}` : ""}
                                {r.dropped_at ? ` · off ${fmtTime(r.dropped_at)}` : ""}
                                {r.method && r.method !== "manual" ? ` · ${r.method}` : ""}
                              </div>
                            </div>
                            <StatusPill status={r.status} />
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
      )}

      {moving && (
        <MoveDialog
          trip={moving}
          buses={day.buses.filter((b) => b.id !== moving.bus_id)}
          onClose={() => setMoving(null)}
          onMoved={() => {
            setMoving(null);
            void day.reload();
          }}
        />
      )}
    </>
  );
}

function MoveDialog({
  trip,
  buses,
  onClose,
  onMoved,
}: {
  trip: Trip;
  buses: { id: string; label: string | null; plate: string | null }[];
  onClose: () => void;
  onMoved: () => void;
}) {
  const [to, setTo] = useState(buses[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Move this trip to another bus</DialogTitle>
          <DialogDescription>
            For a breakdown: every child on this list moves to the other bus with their status, and
            their parents are told which bus to follow.
          </DialogDescription>
        </DialogHeader>
        <NativeSelect value={to} onChange={setTo}>
          {buses.map((b) => (
            <option key={b.id} value={b.id}>
              {busName(b)}
            </option>
          ))}
        </NativeSelect>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!to || busy}
            onClick={async () => {
              setBusy(true);
              const { error } = await db.rpc("move_trip", { p_trip: trip.id, p_to_bus: to });
              setBusy(false);
              if (error) return toast.error(friendlyError(error, "Couldn't move the trip"));
              toast.success("Trip moved and parents told");
              onMoved();
            }}
          >
            Move trip
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
