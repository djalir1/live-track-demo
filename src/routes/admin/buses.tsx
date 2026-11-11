import { createFileRoute, Link } from "@tanstack/react-router";
import { PrettySelect } from "@/components/ui/pretty-select";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Plus,
  Loader2,
  Trash2,
  Bus as BusIcon,
  Satellite,
  MessageSquare,
  Pencil,
  X,
  Check,
  User,
  Smartphone,
  History,
  UserPlus,
  CheckCircle2,
  AlertTriangle,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AdminShell } from "@/components/AdminShell";
import { AssignmentHistory } from "@/components/AssignmentHistory";
import { IconBtn } from "@/components/IconButton";
import { friendlyError } from "@/lib/friendly-errors";
import { ago, fmtDate, fmtTime, serverNow, syncServerClock } from "@/lib/time";
import { TRACKER_SETUP_SMS, isValidImei } from "@/lib/gps";
import { DEMO_MODE } from "@/lib/demo";
import { assignDriver, busName, db, loadFleet, type Bus, type Fleet } from "@/lib/fleet";

export const Route = createFileRoute("/admin/buses")({
  head: () => ({ meta: [{ title: "Vehicles — Live Track" }] }),
  component: BusesPage,
});

interface VehicleForm {
  label: string;
  plate: string;
  capacity: number | "";
  routeId: string;
  driverId: string;
  imei: string;
}
const EMPTY_FORM: VehicleForm = {
  label: "",
  plate: "",
  capacity: 32,
  routeId: "",
  driverId: "",
  imei: "",
};
const EMPTY_FLEET: Fleet = {
  schoolId: null,
  buses: [],
  drivers: [],
  open: [],
  routes: [],
  appAccounts: [],
};

function validate(f: VehicleForm): string | null {
  if (!f.label.trim() && !f.plate.trim()) return "Give the vehicle a name or plate";
  const imei = f.imei.trim();
  if (imei && imei.length !== 15) return "The tracker IMEI is 15 digits (on its label)";
  if (imei && !isValidImei(imei))
    return "That IMEI isn't valid: check the 15 digits on the tracker label again";
  return null;
}

/** Save errors in words an admin can act on. */
function saveError(e: unknown): string {
  const raw = `${(e as { message?: string })?.message ?? e}`;
  if (/buses_gps_imei_key/.test(raw))
    return "This GPS tracker (IMEI) is already on another vehicle. Remove it there first.";
  if (/buses_gps_imei_format/.test(raw)) return "The tracker IMEI is 15 digits (on its label)";
  return friendlyError(e);
}

/** Live state of a vehicle's tracker, from device_status. */
interface TrackerStatus {
  user_id: string;
  last_seen: string;
  is_tracking: boolean;
  power_cut_at?: string | null;
  silent_since?: string | null;
}

function TrackerState({ bus, st }: { bus: Bus; st: TrackerStatus | undefined }) {
  if (!bus.gps_imei)
    return (
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <Satellite className="h-3.5 w-3.5 shrink-0" />
        <span className="italic">No GPS tracker</span>
      </span>
    );
  const imei = <span className="font-mono text-muted-foreground">{bus.gps_imei}</span>;
  // No report yet: gps-server links the tracker on its first message.
  if (!st)
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400 px-2 py-0.5 font-medium">
          <Clock className="h-3 w-3" /> Waiting for the tracker
        </span>
        {imei}
        <span className="text-muted-foreground w-full">
          Not heard from it yet: send it the setup SMS (left), then turn the ignition on.
        </span>
      </span>
    );
  const age = serverNow() - new Date(st.last_seen).getTime();
  const fresh = age < (st.is_tracking ? 120_000 : 7 * 60_000);
  let chip: { tone: "ok" | "warn" | "err"; text: string };
  if (!fresh) chip = { tone: "err", text: `No signal since ${fmtTime(st.last_seen)}` };
  else if (st.power_cut_at && !st.is_tracking)
    chip = { tone: "err", text: `Unplugged since ${fmtTime(st.power_cut_at)}` };
  else if (st.power_cut_at) chip = { tone: "warn", text: "Connected · on its backup battery" };
  else chip = { tone: "ok", text: st.is_tracking ? "Connected · engine on" : "Connected · parked" };
  const cls = {
    ok: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    warn: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    err: "bg-red-500/15 text-red-600 dark:text-red-400",
  }[chip.tone];
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span
        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${cls}`}
      >
        {chip.tone === "ok" ? (
          <CheckCircle2 className="h-3 w-3" />
        ) : (
          <AlertTriangle className="h-3 w-3" />
        )}
        {chip.text}
      </span>
      {imei}
      <span className="text-muted-foreground">· last report {ago(st.last_seen)}</span>
    </span>
  );
}

const columns = (f: VehicleForm) => ({
  route_id: f.routeId || null,
  plate: f.plate.trim() || null,
  label: f.label.trim() || null,
  capacity: f.capacity === "" ? null : Number(f.capacity),
  gps_imei: f.imei.trim() || null,
});

function BusesPage() {
  const [fleet, setFleet] = useState<Fleet>(EMPTY_FLEET);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<VehicleForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<VehicleForm>(EMPTY_FORM);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [trackers, setTrackers] = useState<Map<string, TrackerStatus>>(new Map());
  const [, setTick] = useState(0);

  useEffect(() => {
    void refresh();
    void syncServerClock();
  }, []);

  // Tracker connection state, refreshed every 10 s so "Waiting for the
  // tracker" turns into "Connected" on its own once the SMS are sent.
  const trackerUserIds = fleet.buses
    .filter((b) => b.gps_imei && b.driver_user_id)
    .map((b) => b.driver_user_id!)
    .join(",");
  const waitingForLink = fleet.buses.some((b) => b.gps_imei && !b.driver_user_id);
  useEffect(() => {
    let cancelled = false;
    async function poll() {
      // A new tracker's first message links it to its vehicle: reload to see it.
      if (waitingForLink) {
        const next = await loadFleet().catch(() => null);
        if (!cancelled && next) setFleet(next);
      }
      if (trackerUserIds) {
        const { data } = await db
          .from("device_status")
          .select("*")
          .in("user_id", trackerUserIds.split(","));
        if (!cancelled && data)
          setTrackers(new Map((data as TrackerStatus[]).map((r) => [r.user_id, r])));
      } else if (!cancelled) setTrackers(new Map());
      if (!cancelled) setTick((n) => n + 1);
    }
    void poll();
    const t = window.setInterval(poll, 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [trackerUserIds, waitingForLink]);

  async function refresh() {
    setBusy(true);
    try {
      setFleet(await loadFleet());
    } catch (e) {
      toast.error(friendlyError(e, "Couldn't load vehicles right now."));
    } finally {
      setBusy(false);
    }
  }

  const currentAssignment = (busId: string) => fleet.open.find((a) => a.bus_id === busId);
  const driverOf = (busId: string) => {
    const a = currentAssignment(busId);
    return a
      ? { driver: fleet.drivers.find((d) => d.id === a.driver_id), since: a.started_at }
      : null;
  };
  const routeName = (id: string | null) => fleet.routes.find((r) => r.id === id)?.name ?? "—";

  async function createBus() {
    if (!fleet.schoolId) return;
    const err = validate(form);
    if (err) {
      toast.error(err);
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await db
        .from("buses")
        .insert({ school_id: fleet.schoolId, ...columns(form) })
        .select("id")
        .single();
      if (error) throw error;
      // Also run with no driver: a tracker bus then shows "No driver".
      await assignDriver(data.id, form.driverId || null);
      toast.success(
        form.imei.trim()
          ? "Vehicle added. Now send the tracker the setup SMS: it shows Connected once it reports."
          : "Vehicle added",
      );
      setForm(EMPTY_FORM);
      await refresh();
    } catch (e) {
      toast.error(saveError(e));
    } finally {
      setSaving(false);
    }
  }

  function startEdit(b: Bus) {
    setEditingId(b.id);
    setEditForm({
      label: b.label ?? "",
      plate: b.plate ?? "",
      capacity: b.capacity ?? "",
      routeId: b.route_id ?? "",
      driverId: currentAssignment(b.id)?.driver_id ?? "",
      imei: b.gps_imei ?? "",
    });
  }

  async function saveEdit(b: Bus) {
    const err = validate(editForm);
    if (err) {
      toast.error(err);
      return;
    }
    setSaving(true);
    try {
      const { error } = await db.from("buses").update(columns(editForm)).eq("id", b.id);
      if (error) throw error;
      if (editForm.driverId !== (currentAssignment(b.id)?.driver_id ?? ""))
        await assignDriver(b.id, editForm.driverId || null);
      const newTracker = editForm.imei.trim() && editForm.imei.trim() !== (b.gps_imei ?? "");
      toast.success(
        newTracker
          ? "Saved. Send the new tracker the setup SMS: it shows Connected once it reports."
          : "Vehicle saved",
      );
      setEditingId(null);
      await refresh();
    } catch (e) {
      toast.error(saveError(e));
    } finally {
      setSaving(false);
    }
  }

  async function deleteBus(b: Bus) {
    if (
      !window.confirm(
        `Delete ${busName(b)}? It disappears from the live map and its driver history is removed. Past trips stay in History.`,
      )
    )
      return;
    const { error } = await db.from("buses").delete().eq("id", b.id);
    if (error) return toast.error(friendlyError(error));
    if (editingId === b.id) setEditingId(null);
    await refresh();
  }

  return (
    <AdminShell>
      <div className="grid lg:grid-cols-[380px_1fr] gap-4">
        <aside className="rounded-2xl bg-gradient-card border border-border/60 shadow-soft p-4 space-y-3 h-fit">
          {DEMO_MODE ? (
            <p className="rounded-xl border border-amber-400/50 bg-amber-50 dark:bg-amber-950/30 p-3 text-[11px] text-amber-900 dark:text-amber-200">
              <b>Demo:</b> these buses have no real GPS tracker. Move them with the{" "}
              <Link to="/admin" className="font-semibold underline">
                Demo: drive the bus
              </Link>{" "}
              buttons on the Overview.
            </p>
          ) : (
            <ol className="rounded-xl border border-primary/30 bg-primary/5 p-3 space-y-1 text-[11px] text-muted-foreground list-decimal list-inside">
              <li>
                <Link to="/admin/drivers" className="text-primary font-medium hover:underline">
                  Add the driver
                </Link>{" "}
                first (Drivers tab).
              </li>
              <li>Add the vehicle below: name, plate, its driver and the tracker's IMEI.</li>
              <li>Send the tracker's SIM number the SMS below, one at a time.</li>
              <li>
                Turn the ignition on. The vehicle shows <b>Connected</b> in the list within 1–2 min
                and appears on the dashboard.
              </li>
              <li>Optional: put it on a route (Routes tab).</li>
            </ol>
          )}
          <div className="text-sm font-semibold">Add a vehicle</div>
          <VehicleFields idPrefix="new" form={form} setForm={setForm} fleet={fleet} />
          <Button
            onClick={createBus}
            disabled={saving}
            className="w-full bg-gradient-primary shadow-glow"
          >
            {saving && !editingId ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <Plus className="h-4 w-4 mr-1.5" />
            )}
            Add vehicle
          </Button>
          {!DEMO_MODE && (
            <div className="rounded-xl border border-border/60 bg-background/40 p-3 space-y-2">
              <div className="text-xs font-semibold flex items-center gap-1.5">
                <MessageSquare className="h-3.5 w-3.5 text-primary shrink-0" /> GPS tracker setup:
                send these SMS to its SIM number
              </div>
              <ol className="space-y-1.5">
                {TRACKER_SETUP_SMS.map((c, i) => (
                  <li key={c.sms} className="text-[11px] text-muted-foreground">
                    <span className="mr-1">{i + 1}.</span>
                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard?.writeText(c.sms);
                        toast.success("SMS copied");
                      }}
                      className="font-mono text-foreground bg-muted px-1.5 py-0.5 rounded hover:bg-primary/15 break-all text-left"
                      title="Copy"
                    >
                      {c.sms}
                    </button>
                    <span className="ml-1.5">{c.why}</span>
                  </li>
                ))}
              </ol>
              <p className="text-[11px] text-muted-foreground">
                Tap an SMS to copy it. The tracker answers each one by SMS. Then turn the ignition
                on: the vehicle switches from <b>Waiting for the tracker</b> to <b>Connected</b> by
                itself. Still waiting after 5 min? Send <span className="font-mono">SERVER#</span>:
                the reply must show <span className="font-mono">102.202.208.186,5023</span>.
              </p>
            </div>
          )}
        </aside>

        <section className="rounded-2xl bg-gradient-card border border-border/60 shadow-soft p-4 min-w-0">
          <div className="text-sm font-semibold flex items-center justify-between">
            Vehicles <span className="text-xs text-muted-foreground">{fleet.buses.length}</span>
          </div>
          {busy && (
            <div className="text-xs text-muted-foreground flex items-center gap-2 py-4">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
            </div>
          )}
          <div className="mt-2 divide-y divide-border/50">
            {fleet.buses.length === 0 && !busy && (
              <div className="text-xs text-muted-foreground py-8 text-center">
                No vehicles yet — add one on the left.
              </div>
            )}
            {fleet.buses.map((b) => {
              if (editingId === b.id) {
                return (
                  <div key={b.id} className="py-3 space-y-3">
                    <div className="text-sm font-semibold flex items-center gap-2">
                      <Pencil className="h-4 w-4 text-primary" /> Edit {busName(b)}
                    </div>
                    <VehicleFields
                      idPrefix={`edit-${b.id}`}
                      form={editForm}
                      setForm={setEditForm}
                      fleet={fleet}
                      busId={b.id}
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => saveEdit(b)}
                        disabled={saving}
                        className="bg-gradient-primary"
                      >
                        {saving ? (
                          <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                        ) : (
                          <Check className="h-4 w-4 mr-1.5" />
                        )}{" "}
                        Save
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditingId(null)}
                        disabled={saving}
                      >
                        <X className="h-4 w-4 mr-1.5" /> Cancel
                      </Button>
                    </div>
                  </div>
                );
              }
              const cur = driverOf(b.id);
              return (
                <div key={b.id} className="py-3">
                  <div className="flex items-start gap-3">
                    <span className="h-10 w-10 rounded-xl bg-primary/15 text-primary grid place-items-center shrink-0">
                      <BusIcon className="h-5 w-5" />
                    </span>
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="text-sm font-semibold flex items-center gap-2 flex-wrap">
                        <span className="truncate">{busName(b)}</span>
                        {b.plate && b.label && (
                          <span className="font-mono text-[10px] bg-muted px-1.5 py-0.5 rounded">
                            {b.plate}
                          </span>
                        )}
                      </div>
                      <div className="text-xs flex items-center gap-1.5 min-w-0">
                        {cur?.driver?.user_id ? (
                          <Smartphone className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        ) : (
                          <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        )}
                        {cur?.driver ? (
                          <span className="truncate">
                            <span className="font-medium">{cur.driver.full_name}</span>
                            <span className="text-muted-foreground">
                              {" "}
                              since {fmtDate(cur.since)}
                            </span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground italic">No driver assigned</span>
                        )}
                      </div>
                      <div className="text-xs">
                        <TrackerState
                          bus={b}
                          st={b.driver_user_id ? trackers.get(b.driver_user_id) : undefined}
                        />
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        Route: {routeName(b.route_id)} · Capacity: {b.capacity ?? "—"}
                      </div>
                    </div>
                    <div className="flex shrink-0">
                      <IconBtn
                        label="Driver history"
                        onClick={() => setHistoryId(historyId === b.id ? null : b.id)}
                        active={historyId === b.id}
                      >
                        <History className="h-4 w-4" />
                      </IconBtn>
                      <IconBtn label="Edit" onClick={() => startEdit(b)}>
                        <Pencil className="h-4 w-4" />
                      </IconBtn>
                      <IconBtn label="Delete" danger onClick={() => deleteBus(b)}>
                        <Trash2 className="h-4 w-4" />
                      </IconBtn>
                    </div>
                  </div>
                  {historyId === b.id && (
                    <div className="mt-2 rounded-lg bg-background/40 border border-border/50 p-2.5">
                      <div className="text-[11px] font-semibold text-muted-foreground mb-1.5">
                        Who drove {busName(b)}
                      </div>
                      <AssignmentHistory busId={b.id} buses={fleet.buses} drivers={fleet.drivers} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </AdminShell>
  );
}

function VehicleFields({
  idPrefix,
  form,
  setForm,
  fleet,
  busId,
}: {
  idPrefix: string;
  form: VehicleForm;
  setForm: (f: VehicleForm) => void;
  fleet: Fleet;
  busId?: string;
}) {
  const set = <K extends keyof VehicleForm>(k: K, v: VehicleForm[K]) =>
    setForm({ ...form, [k]: v });
  const id = (s: string) => `${idPrefix}-${s}`;
  const drivers = fleet.drivers.filter((d) => d.active);
  const drivingElsewhere = (driverId: string) => {
    const a = fleet.open.find((x) => x.driver_id === driverId && x.bus_id !== busId);
    return a ? busName(fleet.buses.find((b) => b.id === a.bus_id)) : null;
  };
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-1.5">
        <Label htmlFor={id("label")}>Vehicle name</Label>
        <Input
          id={id("label")}
          value={form.label}
          onChange={(e) => set("label", e.target.value)}
          placeholder='e.g. "Bus 1"'
          className="h-9"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={id("plate")}>Plate</Label>
        <Input
          id={id("plate")}
          value={form.plate}
          onChange={(e) => set("plate", e.target.value)}
          placeholder="e.g. RAB123X"
          className="h-9"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={id("capacity")}>Capacity</Label>
        <Input
          id={id("capacity")}
          type="number"
          min={1}
          inputMode="numeric"
          value={form.capacity}
          onChange={(e) => set("capacity", e.target.value === "" ? "" : Number(e.target.value))}
          className="h-9"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={id("route")}>Route</Label>
        <PrettySelect
          id={id("route")}
          value={form.routeId}
          onChange={(v) => set("routeId", v)}
          className="w-full h-9 rounded-md bg-background/50 border border-input px-3 text-sm"
        >
          <option value="">— none —</option>
          {fleet.routes.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </PrettySelect>
      </div>
      <div className="space-y-1.5 col-span-2">
        <div className="flex items-center justify-between">
          <Label htmlFor={id("driver")}>Driver</Label>
          <Link
            to="/admin/drivers"
            className="text-[11px] text-primary inline-flex items-center gap-1 hover:underline"
          >
            <UserPlus className="h-3 w-3" /> Add a driver
          </Link>
        </div>
        <PrettySelect
          id={id("driver")}
          value={form.driverId}
          onChange={(v) => set("driverId", v)}
          className="w-full h-9 rounded-md bg-background/50 border border-input px-3 text-sm"
        >
          <option value="">— no driver —</option>
          {drivers.map((d) => {
            const other = drivingElsewhere(d.id);
            return (
              <option key={d.id} value={d.id}>
                {d.full_name}
                {d.user_id ? " · app" : ""}
                {other ? ` — moves from ${other}` : ""}
              </option>
            );
          })}
        </PrettySelect>
        {drivers.length === 0 && (
          <p className="text-[11px] text-muted-foreground">
            No drivers yet — add them on the Drivers tab, then pick one here.
          </p>
        )}
      </div>
      <div className="space-y-1.5 col-span-2">
        <Label htmlFor={id("imei")}>GPS tracker IMEI (optional)</Label>
        <Input
          id={id("imei")}
          inputMode="numeric"
          value={form.imei}
          onChange={(e) => set("imei", e.target.value.replace(/\D/g, ""))}
          placeholder="15 digits, on the tracker label"
          className="h-9 font-mono"
        />
      </div>
    </div>
  );
}
