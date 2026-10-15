import { createFileRoute, Link } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Plus,
  Loader2,
  MapPin,
  Trash2,
  ArrowUp,
  ArrowDown,
  Pencil,
  Check,
  X,
  School,
  Sunrise,
  Sunset,
  Bus as BusIcon,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AdminShell } from "@/components/AdminShell";
import { IconBtn } from "@/components/IconButton";
import { friendlyError } from "@/lib/friendly-errors";
import { busName, db, loadFleet, type Fleet } from "@/lib/fleet";

const MapPicker = lazy(() =>
  import("@/components/MapPicker").then((m) => ({ default: m.MapPicker })),
);

export const Route = createFileRoute("/admin/routes")({
  head: () => ({ meta: [{ title: "Routes — Live Track" }] }),
  component: RoutesPage,
});

// How schools run buses: a route is an area ("Kimironko – Remera") with
// pickup stops in order and the school at the end. The morning run collects
// children stop by stop and ends at school; the afternoon run leaves school
// and drops them off in reverse. Each vehicle is on one route (buses.route_id);
// a big route can have several vehicles. Arrive/depart at every stop is
// detected server-side (geofence trigger) from the stop's location + radius.

interface StopRow {
  id: string;
  route_id: string;
  school_id: string;
  name: string;
  lat: number | null;
  lng: number | null;
  radius_m: number;
  sequence: number | null;
  type: "school" | "pickup";
  morning_time?: string | null;
  afternoon_time?: string | null;
  created_at: string;
}
interface RouteInfo {
  id: string;
  name: string;
  stops: number;
}

const hhmm = (t: string | null | undefined) => (t ? t.slice(0, 5) : "");

/** Pickups in run order, school last. */
function ordered(stops: StopRow[]) {
  const pickups = stops
    .filter((s) => s.type !== "school")
    .sort(
      (a, b) =>
        (a.sequence ?? 1e9) - (b.sequence ?? 1e9) || a.created_at.localeCompare(b.created_at),
    );
  return { pickups, school: stops.find((s) => s.type === "school") ?? null };
}

function RoutesPage() {
  const [fleet, setFleet] = useState<Fleet | null>(null);
  const [routes, setRoutes] = useState<RouteInfo[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [stops, setStops] = useState<StopRow[]>([]);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [editingStop, setEditingStop] = useState<StopRow | null>(null);
  const [schoolSpot, setSchoolSpot] = useState<{ lat: number; lng: number; from: string } | null>(
    null,
  );

  const schoolId = fleet?.schoolId ?? null;
  const selected = routes.find((r) => r.id === selectedId) ?? null;
  const { pickups, school } = useMemo(() => ordered(stops), [stops]);
  const busesOn = (routeId: string) => fleet?.buses.filter((b) => b.route_id === routeId) ?? [];

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refresh(keep = selectedId) {
    setBusy(true);
    try {
      const f = await loadFleet();
      setFleet(f);
      if (!f.schoolId) return;
      const [routesRes, schoolStopRes] = await Promise.all([
        db
          .from("routes")
          .select("id, name, stops(count)")
          .eq("school_id", f.schoolId)
          .order("name"),
        db
          .from("stops")
          .select("lat, lng, route_id")
          .eq("school_id", f.schoolId)
          .eq("type", "school")
          .not("lat", "is", null)
          .limit(1),
      ]);
      if (routesRes.error) throw routesRes.error;
      const list = (
        routesRes.data as { id: string; name: string; stops: { count: number }[] }[]
      ).map((r) => ({
        id: r.id,
        name: r.name,
        stops: r.stops?.[0]?.count ?? 0,
      }));
      setRoutes(list);
      const ss = schoolStopRes.data?.[0] as
        { lat: number; lng: number; route_id: string } | undefined;
      setSchoolSpot(
        ss
          ? {
              lat: ss.lat,
              lng: ss.lng,
              from: list.find((r) => r.id === ss.route_id)?.name ?? "another route",
            }
          : null,
      );
      const next = list.find((r) => r.id === keep)?.id ?? list[0]?.id ?? null;
      setSelectedId(next);
      if (next) await loadStops(next);
      else setStops([]);
    } catch (e) {
      toast.error(friendlyError(e, "Couldn't load routes right now."));
    } finally {
      setBusy(false);
    }
  }

  async function loadStops(routeId: string) {
    const { data, error } = await db.from("stops").select("*").eq("route_id", routeId);
    if (error) return toast.error(friendlyError(error));
    setStops(data as StopRow[]);
  }

  function select(id: string) {
    setSelectedId(id);
    setEditingStop(null);
    void loadStops(id);
  }

  async function createRoute() {
    const name = newName.trim();
    if (!schoolId || !name) return;
    if (routes.some((r) => r.name.toLowerCase() === name.toLowerCase()))
      return toast.error("A route with that name already exists");
    const { data, error } = await db
      .from("routes")
      .insert({ school_id: schoolId, name })
      .select("id")
      .single();
    if (error) return toast.error(friendlyError(error));
    setNewName("");
    toast.success("Route added — now add its stops and the school");
    await refresh(data.id);
  }

  async function renameRoute(id: string, name: string) {
    const n = name.trim();
    setRenaming(null);
    if (!n || n === routes.find((r) => r.id === id)?.name) return;
    const { error } = await db.from("routes").update({ name: n }).eq("id", id);
    if (error) return toast.error(friendlyError(error));
    await refresh(id);
  }

  async function deleteRoute(r: RouteInfo) {
    const n = busesOn(r.id).length;
    if (
      !window.confirm(
        `Delete route "${r.name}" and its ${r.stops} stop(s)?` +
          (n ? `\n\n${n} vehicle(s) on it will have no route until you assign another one.` : ""),
      )
    )
      return;
    const { error } = await db.from("routes").delete().eq("id", r.id);
    if (error) return toast.error(friendlyError(error));
    toast.success("Route deleted");
    await refresh(null);
  }

  async function setBusRoute(busId: string, routeId: string | null) {
    const { error } = await db.from("buses").update({ route_id: routeId }).eq("id", busId);
    if (error) return toast.error(friendlyError(error));
    await refresh();
  }

  /** Write sequence 1..N for pickups in the given order, school after them. */
  async function renumber(list: StopRow[], schoolStop: StopRow | null) {
    const want = new Map(list.map((s, i) => [s.id, i + 1]));
    if (schoolStop) want.set(schoolStop.id, list.length + 1);
    const changed = stops.filter((s) => want.has(s.id) && s.sequence !== want.get(s.id));
    const results = await Promise.all(
      changed.map((s) =>
        db
          .from("stops")
          .update({ sequence: want.get(s.id) })
          .eq("id", s.id),
      ),
    );
    const failed = results.find((r) => r.error);
    if (failed) toast.error(friendlyError(failed.error));
    if (selectedId) await loadStops(selectedId);
  }

  async function move(stopId: string, delta: -1 | 1) {
    const i = pickups.findIndex((s) => s.id === stopId);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= pickups.length) return;
    const list = [...pickups];
    [list[i], list[j]] = [list[j], list[i]];
    await renumber(list, school);
  }

  async function deleteStop(s: StopRow) {
    if (!window.confirm(`Delete stop "${s.name}"?`)) return;
    const { error } = await db.from("stops").delete().eq("id", s.id);
    if (error) return toast.error(friendlyError(error));
    if (editingStop?.id === s.id) setEditingStop(null);
    await renumber(
      pickups.filter((p) => p.id !== s.id),
      school?.id === s.id ? null : school,
    );
    await refresh();
  }

  const unassigned = fleet?.buses.filter((b) => b.route_id !== selectedId) ?? [];
  const driverOf = (busId: string) => {
    const a = fleet?.open.find((x) => x.bus_id === busId);
    return a ? fleet?.drivers.find((d) => d.id === a.driver_id)?.full_name : null;
  };

  return (
    <AdminShell>
      <div className="grid lg:grid-cols-[320px_1fr] gap-4">
        {/* Routes */}
        <aside className="rounded-2xl bg-gradient-card border border-border/60 shadow-soft p-4 space-y-3 h-fit">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold">Routes</div>
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void createRoute();
            }}
          >
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Kimironko – Remera"
              className="h-9"
            />
            <Button
              type="submit"
              size="sm"
              className="bg-gradient-primary shadow-glow"
              disabled={!newName.trim() || !schoolId}
              aria-label="Add route"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </form>
          <p className="text-[11px] text-muted-foreground">
            One route per area. The same route is used for the morning pickup and the afternoon
            drop-off.
          </p>
          <ul className="space-y-1">
            {routes.length === 0 && !busy && (
              <li className="text-xs text-muted-foreground py-6 text-center">No routes yet</li>
            )}
            {routes.map((r) => {
              const n = busesOn(r.id).length;
              return (
                <li key={r.id}>
                  {renaming === r.id ? (
                    <RenameRow
                      name={r.name}
                      onSave={(v) => renameRoute(r.id, v)}
                      onCancel={() => setRenaming(null)}
                    />
                  ) : (
                    <div
                      className={`group flex items-center gap-1 rounded-lg border transition-colors ${
                        r.id === selectedId
                          ? "bg-primary/15 border-primary/40"
                          : "hover:bg-accent/40 border-transparent"
                      }`}
                    >
                      <button
                        onClick={() => select(r.id)}
                        className="flex-1 min-w-0 text-left px-3 py-2"
                      >
                        <div className="text-sm font-medium truncate">{r.name}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {r.stops} stop{r.stops === 1 ? "" : "s"} ·{" "}
                          {n ? `${n} vehicle${n === 1 ? "" : "s"}` : "no vehicle"}
                        </div>
                      </button>
                      <IconBtn label="Rename" onClick={() => setRenaming(r.id)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </IconBtn>
                      <IconBtn label="Delete route" onClick={() => deleteRoute(r)} danger>
                        <Trash2 className="h-3.5 w-3.5" />
                      </IconBtn>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </aside>

        <section className="space-y-3 min-w-0">
          {!selected ? (
            <div className="rounded-2xl border border-border/50 p-8 text-sm text-muted-foreground text-center">
              {busy ? "Loading…" : "Create a route on the left to start."}
            </div>
          ) : (
            <>
              {/* Vehicles on this route */}
              <div className="rounded-2xl bg-gradient-card border border-border/60 shadow-soft p-4 space-y-3">
                <div className="text-sm font-semibold">Vehicles on {selected.name}</div>
                {busesOn(selected.id).length === 0 ? (
                  <div className="text-xs text-muted-foreground">
                    No vehicle runs this route yet — assign one below.
                  </div>
                ) : (
                  <ul className="flex flex-wrap gap-2">
                    {busesOn(selected.id).map((b) => (
                      <li
                        key={b.id}
                        className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/50 pl-3 pr-1 h-9 text-sm"
                      >
                        <BusIcon className="h-4 w-4 text-primary" />
                        <span className="font-medium">{busName(b)}</span>
                        {b.plate && b.label && (
                          <span className="text-xs text-muted-foreground font-mono">{b.plate}</span>
                        )}
                        <span className="text-xs text-muted-foreground">
                          · {driverOf(b.id) ?? "no driver"}
                        </span>
                        <IconBtn label="Remove from route" onClick={() => setBusRoute(b.id, null)}>
                          <X className="h-3.5 w-3.5" />
                        </IconBtn>
                      </li>
                    ))}
                  </ul>
                )}
                {unassigned.length > 0 ? (
                  <select
                    value=""
                    onChange={(e) => e.target.value && setBusRoute(e.target.value, selected.id)}
                    className="w-full sm:w-80 h-9 rounded-md bg-background/50 border border-input px-3 text-sm"
                  >
                    <option value="">+ Assign a vehicle to this route…</option>
                    {unassigned.map((b) => {
                      const on = routes.find((r) => r.id === b.route_id)?.name;
                      return (
                        <option key={b.id} value={b.id}>
                          {busName(b)}
                          {b.plate && b.label ? ` (${b.plate})` : ""}
                          {on ? ` — now on ${on}` : ""}
                        </option>
                      );
                    })}
                  </select>
                ) : (
                  fleet?.buses.length === 0 && (
                    <div className="text-xs text-muted-foreground">
                      No vehicles yet.{" "}
                      <Link to="/admin/buses" className="underline underline-offset-2">
                        Add a vehicle
                      </Link>
                    </div>
                  )
                )}
              </div>

              {/* The two daily runs */}
              <RunsPreview pickups={pickups} school={school} />

              {/* Stops */}
              <div className="rounded-2xl bg-gradient-card border border-border/60 shadow-soft p-4 space-y-2">
                <div className="text-sm font-semibold flex items-center justify-between">
                  Stops <span className="text-xs text-muted-foreground">{stops.length}</span>
                </div>
                {!school && (
                  <div className="flex items-start gap-2 text-xs rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 p-2">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    Add the school as a stop (type “School”) so the route knows where the morning
                    run ends and the afternoon run starts.
                  </div>
                )}
                {stops.length === 0 && (
                  <div className="text-xs text-muted-foreground py-4 text-center">
                    No stops yet — add them in the order the bus reaches them in the morning.
                  </div>
                )}
                <ol className="space-y-1.5">
                  {[...pickups, ...(school ? [school] : [])].map((s, i) => (
                    <li
                      key={s.id}
                      className={`flex items-center gap-2 rounded-lg border p-2 ${editingStop?.id === s.id ? "border-primary/60 bg-primary/5" : "border-border/50 bg-background/40"}`}
                    >
                      <span className="h-7 w-7 shrink-0 grid place-items-center rounded-md bg-primary/15 text-primary font-mono text-xs font-bold">
                        {s.type === "school" ? <School className="h-3.5 w-3.5" /> : i + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate flex items-center gap-2">
                          {s.name}
                          {s.type === "school" && (
                            <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/15 text-primary">
                              School
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-muted-foreground flex flex-wrap items-center gap-x-2">
                          {s.lat == null ? (
                            <span className="text-destructive">no location — edit to place it</span>
                          ) : (
                            <span className="inline-flex items-center gap-1">
                              <MapPin className="h-3 w-3" />
                              radius {s.radius_m} m
                            </span>
                          )}
                          {hhmm(s.morning_time) && (
                            <span className="inline-flex items-center gap-1">
                              <Sunrise className="h-3 w-3" />
                              {hhmm(s.morning_time)}
                            </span>
                          )}
                          {hhmm(s.afternoon_time) && (
                            <span className="inline-flex items-center gap-1">
                              <Sunset className="h-3 w-3" />
                              {hhmm(s.afternoon_time)}
                            </span>
                          )}
                        </div>
                      </div>
                      {s.type !== "school" && (
                        <>
                          <IconBtn
                            label="Move up"
                            onClick={() => move(s.id, -1)}
                            disabled={i === 0}
                          >
                            <ArrowUp className="h-3.5 w-3.5" />
                          </IconBtn>
                          <IconBtn
                            label="Move down"
                            onClick={() => move(s.id, 1)}
                            disabled={i === pickups.length - 1}
                          >
                            <ArrowDown className="h-3.5 w-3.5" />
                          </IconBtn>
                        </>
                      )}
                      <IconBtn label="Edit stop" onClick={() => setEditingStop(s)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </IconBtn>
                      <IconBtn label="Delete stop" onClick={() => deleteStop(s)} danger>
                        <Trash2 className="h-3.5 w-3.5" />
                      </IconBtn>
                    </li>
                  ))}
                </ol>
              </div>

              {schoolId && (
                <StopEditor
                  key={editingStop?.id ?? `new-${selected.id}`}
                  schoolId={schoolId}
                  routeId={selected.id}
                  editing={editingStop}
                  hasSchool={!!school}
                  schoolSpot={schoolSpot}
                  nextSequence={pickups.length + 1}
                  onDone={async () => {
                    setEditingStop(null);
                    await refresh();
                  }}
                  onCancel={() => setEditingStop(null)}
                />
              )}
            </>
          )}
        </section>
      </div>
    </AdminShell>
  );
}

function RenameRow({
  name,
  onSave,
  onCancel,
}: {
  name: string;
  onSave: (v: string) => void;
  onCancel: () => void;
}) {
  const [v, setV] = useState(name);
  return (
    <form
      className="flex items-center gap-1 p-1"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(v);
      }}
    >
      <Input
        autoFocus
        value={v}
        onChange={(e) => setV(e.target.value)}
        className="h-8"
        onKeyDown={(e) => e.key === "Escape" && onCancel()}
      />
      <IconBtn label="Save" onClick={() => onSave(v)}>
        <Check className="h-3.5 w-3.5" />
      </IconBtn>
      <IconBtn label="Cancel" onClick={onCancel}>
        <X className="h-3.5 w-3.5" />
      </IconBtn>
    </form>
  );
}

function RunsPreview({ pickups, school }: { pickups: StopRow[]; school: StopRow | null }) {
  if (pickups.length === 0 && !school) return null;
  const label = (s: StopRow, t: "morning_time" | "afternoon_time") =>
    hhmm(s[t]) ? `${s.name} ${hhmm(s[t])}` : s.name;
  const morning = [
    ...pickups.map((s) => label(s, "morning_time")),
    school ? label(school, "morning_time") : "School ?",
  ];
  const afternoon = [
    school ? label(school, "afternoon_time") : "School ?",
    ...[...pickups].reverse().map((s) => label(s, "afternoon_time")),
  ];
  return (
    <div className="rounded-2xl bg-gradient-card border border-border/60 shadow-soft p-4 grid sm:grid-cols-2 gap-3 text-xs">
      <div>
        <div className="font-semibold text-sm flex items-center gap-1.5 mb-1">
          <Sunrise className="h-4 w-4 text-primary" /> Morning pickup
        </div>
        <div className="text-muted-foreground leading-relaxed">{morning.join(" → ")}</div>
      </div>
      <div>
        <div className="font-semibold text-sm flex items-center gap-1.5 mb-1">
          <Sunset className="h-4 w-4 text-primary" /> Afternoon drop-off
        </div>
        <div className="text-muted-foreground leading-relaxed">{afternoon.join(" → ")}</div>
      </div>
    </div>
  );
}

function StopEditor({
  schoolId,
  routeId,
  editing,
  hasSchool,
  schoolSpot,
  nextSequence,
  onDone,
  onCancel,
}: {
  schoolId: string;
  routeId: string;
  editing: StopRow | null;
  hasSchool: boolean;
  schoolSpot: { lat: number; lng: number; from: string } | null;
  nextSequence: number;
  onDone: () => void | Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(editing?.name ?? "");
  const [type, setType] = useState<"pickup" | "school">(editing?.type ?? "pickup");
  const [lat, setLat] = useState<number | null>(editing?.lat ?? null);
  const [lng, setLng] = useState<number | null>(editing?.lng ?? null);
  const [radius, setRadius] = useState(editing?.radius_m ?? 120);
  const [morning, setMorning] = useState(hhmm(editing?.morning_time));
  const [afternoon, setAfternoon] = useState(hhmm(editing?.afternoon_time));
  const [saving, setSaving] = useState(false);
  const schoolTaken = hasSchool && editing?.type !== "school";

  async function save() {
    if (!name.trim()) return toast.error("Give the stop a name");
    if (lat == null || lng == null) return toast.error("Tap the map to place the stop");
    setSaving(true);
    const row = {
      name: name.trim(),
      type,
      lat,
      lng,
      radius_m: radius,
      // Only send the time columns when used, so stops still save on a
      // database that hasn't had the 20261015120000 migration yet.
      ...(morning || editing?.morning_time ? { morning_time: morning || null } : {}),
      ...(afternoon || editing?.afternoon_time ? { afternoon_time: afternoon || null } : {}),
    };
    const { error } = editing
      ? await db.from("stops").update(row).eq("id", editing.id)
      : await db
          .from("stops")
          .insert({
            ...row,
            route_id: routeId,
            school_id: schoolId,
            sequence: type === "school" ? null : nextSequence,
          });
    setSaving(false);
    if (error) return toast.error(friendlyError(error));
    toast.success(editing ? "Stop updated" : "Stop added");
    if (!editing) {
      setName("");
      setLat(null);
      setLng(null);
      setRadius(120);
      setMorning("");
      setAfternoon("");
      setType("pickup");
    }
    await onDone();
  }

  return (
    <div className="rounded-2xl bg-gradient-card border border-border/60 shadow-soft p-4 space-y-3">
      <div className="text-sm font-semibold flex items-center justify-between">
        {editing ? `Edit “${editing.name}”` : "Add a stop"}
        {editing && (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="stop-name">Name</Label>
          <Input
            id="stop-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={type === "school" ? "e.g. Kigali Model Academy" : "e.g. Kimironko market"}
            className="h-9"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="stop-type">Type</Label>
          <select
            id="stop-type"
            value={type}
            onChange={(e) => setType(e.target.value as "school" | "pickup")}
            className="w-full h-9 rounded-md bg-background/50 border border-input px-3 text-sm"
          >
            <option value="pickup">Pickup / drop-off point</option>
            <option value="school" disabled={schoolTaken}>
              School{schoolTaken ? " (already on this route)" : ""}
            </option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="stop-am">Morning time (optional)</Label>
          <Input
            id="stop-am"
            type="time"
            value={morning}
            onChange={(e) => setMorning(e.target.value)}
            className="h-9"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="stop-pm">Afternoon time (optional)</Label>
          <Input
            id="stop-pm"
            type="time"
            value={afternoon}
            onChange={(e) => setAfternoon(e.target.value)}
            className="h-9"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="stop-radius">Arrival radius (m)</Label>
          <Input
            id="stop-radius"
            type="number"
            min={30}
            max={1000}
            value={radius}
            onChange={(e) => setRadius(Math.min(1000, Math.max(30, Number(e.target.value) || 120)))}
            className="h-9"
          />
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Label>Location</Label>
          {type === "school" &&
            schoolSpot &&
            (lat !== schoolSpot.lat || lng !== schoolSpot.lng) && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => {
                  setLat(schoolSpot.lat);
                  setLng(schoolSpot.lng);
                }}
              >
                <School className="h-3.5 w-3.5 mr-1" /> Same place as on {schoolSpot.from}
              </Button>
            )}
        </div>
        <Suspense
          fallback={
            <div className="h-64 rounded-xl border border-border/50 grid place-items-center text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading map…
            </div>
          }
        >
          <MapPicker
            lat={lat}
            lng={lng}
            radius_m={radius}
            onPick={(la, lo) => {
              setLat(la);
              setLng(lo);
            }}
            className="h-72"
          />
        </Suspense>
        <div className="text-[11px] text-muted-foreground">
          {lat != null && lng != null
            ? "Placed. Tap elsewhere on the map to move it."
            : "Tap the map where the bus stops."}
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving} className="bg-gradient-primary shadow-glow">
          {saving ? (
            <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
          ) : editing ? (
            <Check className="h-4 w-4 mr-1.5" />
          ) : (
            <Plus className="h-4 w-4 mr-1.5" />
          )}
          {editing ? "Save changes" : "Save stop"}
        </Button>
      </div>
    </div>
  );
}
