import { createFileRoute } from "@tanstack/react-router";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AdminShell } from "@/components/AdminShell";
import { supabase } from "@/integrations/supabase/client";
import { friendlyError } from "@/lib/friendly-errors";
import { TRACKER_SETUP_SMS } from "@/lib/gps";

export const Route = createFileRoute("/admin/buses")({
  head: () => ({ meta: [{ title: "Vehicles — Live Track" }] }),
  component: BusesPage,
});

interface BusRow {
  id: string;
  school_id: string;
  route_id: string | null;
  plate: string | null;
  label: string | null;
  capacity: number | null;
  driver_user_id: string | null;
  gps_imei: string | null;
  gps_driver_name: string | null;
}
const IMEI_RE = /^[0-9]{15}$/;

interface RouteRow {
  id: string;
  name: string;
}
interface DriverRow {
  id: string;
  display_name: string;
  plate_number: string | null;
}

// A vehicle's driver is either a typed name (tracker vehicles, or no app) or a
// driver who signs in to the Live Track app. With a typed name, the gps-server
// creates a "tracker driver" account on first contact and keeps its name in
// sync with gps_driver_name, so the bus row is the place to edit it.
const NAMED = "";

interface VehicleForm {
  label: string;
  plate: string;
  capacity: number | "";
  routeId: string;
  driverApp: string; // app driver's user id, or NAMED
  driverName: string;
  imei: string;
}
const EMPTY_FORM: VehicleForm = {
  label: "",
  plate: "",
  capacity: 32,
  routeId: "",
  driverApp: NAMED,
  driverName: "",
  imei: "",
};

/** Driver is a typed name (possibly backed by a tracker account), not an app user. */
const isNamedDriver = (b: BusRow) => !b.driver_user_id || b.gps_driver_name != null;

function formFromBus(b: BusRow): VehicleForm {
  return {
    label: b.label ?? "",
    plate: b.plate ?? "",
    capacity: b.capacity ?? "",
    routeId: b.route_id ?? "",
    driverApp: isNamedDriver(b) ? NAMED : b.driver_user_id!,
    driverName: b.gps_driver_name ?? "",
    imei: b.gps_imei ?? "",
  };
}

function validate(f: VehicleForm): string | null {
  if (!f.label.trim() && !f.plate.trim()) return "Give the vehicle a name or plate";
  if (f.imei.trim() && !IMEI_RE.test(f.imei.trim())) return "Tracker IMEI must be 15 digits";
  return null;
}

function BusesPage() {
  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [buses, setBuses] = useState<BusRow[]>([]);
  const [routes, setRoutes] = useState<RouteRow[]>([]);
  const [profiles, setProfiles] = useState<DriverRow[]>([]);
  const [driverRoleIds, setDriverRoleIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const [form, setForm] = useState<VehicleForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<VehicleForm>(EMPTY_FORM);
  const [editSaving, setEditSaving] = useState(false);

  useEffect(() => {
    void bootstrap();
  }, []);

  async function bootstrap() {
    setBusy(true);
    try {
      const { data: schools, error: sErr } = await supabase.from("schools").select("id").limit(1);
      if (sErr) throw sErr;
      const sid = schools?.[0]?.id ?? null;
      setSchoolId(sid);
      if (!sid) return;

      const [busesRes, routesRes, driversRes, driverRolesRes] = await Promise.all([
        supabase
          .from("buses")
          .select("*")
          .eq("school_id", sid)
          .order("created_at", { ascending: true }),
        supabase.from("routes").select("id, name").eq("school_id", sid).order("name"),
        supabase
          .from("profiles")
          .select("id, display_name, plate_number, school_id")
          .eq("school_id", sid)
          .order("display_name"),
        supabase.from("user_roles").select("user_id").eq("role", "user"),
      ]);
      if (busesRes.error) throw busesRes.error;
      if (routesRes.error) throw routesRes.error;
      if (driversRes.error) throw driversRes.error;
      if (driverRolesRes.error) throw driverRolesRes.error;
      setBuses((busesRes.data ?? []) as BusRow[]);
      setRoutes((routesRes.data ?? []) as RouteRow[]);
      setProfiles((driversRes.data ?? []) as DriverRow[]);
      setDriverRoleIds(new Set((driverRolesRes.data ?? []).map((r) => r.user_id)));
    } catch (e) {
      toast.error(friendlyError(e, "Couldn't load vehicles right now."));
    } finally {
      setBusy(false);
    }
  }

  // Tracker-driver accounts belong to their vehicle; they are not app drivers.
  const trackerAccountIds = new Set(
    buses
      .filter((b) => b.driver_user_id && b.gps_driver_name != null)
      .map((b) => b.driver_user_id!),
  );
  const appDrivers = profiles.filter(
    (p) => driverRoleIds.has(p.id) && !trackerAccountIds.has(p.id),
  );
  const profileName = (id: string | null) =>
    profiles.find((p) => p.id === id)?.display_name ?? null;

  function payload(f: VehicleForm, current?: BusRow) {
    const named = f.driverApp === NAMED;
    return {
      route_id: f.routeId || null,
      plate: f.plate.trim() || null,
      label: f.label.trim() || null,
      capacity: f.capacity === "" ? null : Number(f.capacity),
      gps_imei: f.imei.trim() || null,
      gps_driver_name: named ? f.driverName.trim() || null : null,
      // Keep an existing tracker account when the name is just being renamed.
      driver_user_id: named
        ? current && isNamedDriver(current)
          ? current.driver_user_id
          : null
        : f.driverApp,
    };
  }

  async function createBus() {
    if (!schoolId) return;
    const err = validate(form);
    if (err) {
      toast.error(err);
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("buses")
      .insert({ school_id: schoolId, ...payload(form) });
    setSaving(false);
    if (error) return toast.error(friendlyError(error));
    toast.success(
      form.imei.trim() ? "Vehicle added — now send the tracker its 3 SMS" : "Vehicle added",
    );
    setForm(EMPTY_FORM);
    await bootstrap();
  }

  function startEdit(b: BusRow) {
    setEditingId(b.id);
    setEditForm(formFromBus(b));
  }

  async function saveEdit(b: BusRow) {
    const err = validate(editForm);
    if (err) {
      toast.error(err);
      return;
    }
    setEditSaving(true);
    const { error } = await supabase.from("buses").update(payload(editForm, b)).eq("id", b.id);
    setEditSaving(false);
    if (error) return toast.error(friendlyError(error));
    const newTracker = editForm.imei.trim() && editForm.imei.trim() !== (b.gps_imei ?? "");
    toast.success(newTracker ? "Saved — send the new tracker its 3 SMS" : "Vehicle saved");
    setEditingId(null);
    await bootstrap();
  }

  async function deleteBus(b: BusRow) {
    if (!window.confirm(`Delete ${b.label ?? b.plate ?? "this vehicle"}? Its trip history stays.`))
      return;
    const { error } = await supabase.from("buses").delete().eq("id", b.id);
    if (error) return toast.error(friendlyError(error));
    if (editingId === b.id) setEditingId(null);
    await bootstrap();
  }

  const routeName = (id: string | null) => routes.find((r) => r.id === id)?.name ?? "—";

  function driverLabel(b: BusRow) {
    if (!isNamedDriver(b))
      return { name: profileName(b.driver_user_id) ?? "Driver app user", app: true };
    if (b.gps_driver_name) return { name: b.gps_driver_name, app: false };
    if (b.driver_user_id) return { name: profileName(b.driver_user_id) ?? "—", app: false };
    return { name: null, app: false };
  }

  return (
    <AdminShell>
      <div className="grid lg:grid-cols-[380px_1fr] gap-4">
        <aside className="rounded-2xl bg-gradient-card border border-border/60 shadow-soft p-4 space-y-3 h-fit">
          <div className="text-sm font-semibold">Add a vehicle</div>
          <VehicleFields
            idPrefix="new"
            form={form}
            setForm={setForm}
            routes={routes}
            appDrivers={appDrivers}
          />
          <Button
            onClick={createBus}
            disabled={saving}
            className="w-full bg-gradient-primary shadow-glow"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <Plus className="h-4 w-4 mr-1.5" />
            )}
            Add vehicle
          </Button>
          <div className="rounded-xl border border-border/60 bg-background/40 p-3 space-y-2">
            <div className="text-xs font-semibold flex items-center gap-1.5">
              <MessageSquare className="h-3.5 w-3.5 text-primary" /> New GPS tracker? Send these 3
              SMS to its SIM number
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
                    className="font-mono text-foreground bg-muted px-1.5 py-0.5 rounded hover:bg-primary/15"
                    title="Copy"
                  >
                    {c.sms}
                  </button>
                  <span className="ml-1.5">{c.why}</span>
                </li>
              ))}
            </ol>
            <p className="text-[11px] text-muted-foreground">
              Then turn the ignition on. The vehicle appears on the dashboard within 1–2 minutes.
            </p>
          </div>
        </aside>

        <section className="rounded-2xl bg-gradient-card border border-border/60 shadow-soft p-4">
          <div className="text-sm font-semibold flex items-center justify-between">
            Vehicles <span className="text-xs text-muted-foreground">{buses.length}</span>
          </div>
          {busy && (
            <div className="text-xs text-muted-foreground flex items-center gap-2 py-4">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
            </div>
          )}
          <div className="mt-2 divide-y divide-border/50">
            {buses.length === 0 && !busy && (
              <div className="text-xs text-muted-foreground py-8 text-center">
                No vehicles yet — add one on the left.
              </div>
            )}
            {buses.map((b) => {
              if (editingId === b.id) {
                return (
                  <div key={b.id} className="py-3 space-y-3">
                    <div className="text-sm font-semibold flex items-center gap-2">
                      <Pencil className="h-4 w-4 text-primary" /> Edit{" "}
                      {b.label ?? b.plate ?? "vehicle"}
                    </div>
                    <VehicleFields
                      idPrefix={`edit-${b.id}`}
                      form={editForm}
                      setForm={setEditForm}
                      routes={routes}
                      appDrivers={appDrivers}
                      trackerLinked={isNamedDriver(b) && !!b.driver_user_id}
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => saveEdit(b)}
                        disabled={editSaving}
                        className="bg-gradient-primary"
                      >
                        {editSaving ? (
                          <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                        ) : (
                          <Check className="h-4 w-4 mr-1.5" />
                        )}
                        Save
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditingId(null)}
                        disabled={editSaving}
                      >
                        <X className="h-4 w-4 mr-1.5" /> Cancel
                      </Button>
                    </div>
                  </div>
                );
              }
              const driver = driverLabel(b);
              return (
                <div key={b.id} className="py-3 flex items-start gap-3">
                  <span className="h-10 w-10 rounded-xl bg-primary/15 text-primary grid place-items-center shrink-0">
                    <BusIcon className="h-5 w-5" />
                  </span>
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="text-sm font-semibold truncate flex items-center gap-2">
                      {b.label ?? b.plate ?? "Vehicle"}
                      {b.plate && b.label && (
                        <span className="font-mono text-[10px] bg-muted px-1.5 py-0.5 rounded">
                          {b.plate}
                        </span>
                      )}
                    </div>
                    <div className="text-xs flex items-center gap-1.5">
                      {driver.app ? (
                        <Smartphone className="h-3.5 w-3.5 text-muted-foreground" />
                      ) : (
                        <User className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                      <span className="text-muted-foreground">Driver:</span>
                      {driver.name ? (
                        <span className="font-medium truncate">{driver.name}</span>
                      ) : (
                        <span className="text-muted-foreground italic">not set</span>
                      )}
                      {driver.app && (
                        <span className="text-[10px] text-muted-foreground">(driver app)</span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <Satellite className="h-3.5 w-3.5 shrink-0" />
                      {b.gps_imei ? (
                        <span className="font-mono">{b.gps_imei}</span>
                      ) : (
                        <span className="italic">no GPS tracker</span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      Route: {routeName(b.route_id)} · Capacity: {b.capacity ?? "—"}
                    </div>
                  </div>
                  <div className="flex shrink-0">
                    <button
                      onClick={() => startEdit(b)}
                      className="p-2 rounded hover:bg-primary/15 text-primary"
                      aria-label="Edit"
                      title="Edit"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => deleteBus(b)}
                      className="p-2 rounded hover:bg-destructive/15 text-destructive"
                      aria-label="Delete"
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
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
  routes,
  appDrivers,
  trackerLinked = false,
}: {
  idPrefix: string;
  form: VehicleForm;
  setForm: (f: VehicleForm) => void;
  routes: RouteRow[];
  appDrivers: DriverRow[];
  trackerLinked?: boolean;
}) {
  const set = <K extends keyof VehicleForm>(k: K, v: VehicleForm[K]) =>
    setForm({ ...form, [k]: v });
  const id = (s: string) => `${idPrefix}-${s}`;
  const named = form.driverApp === NAMED;
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
          value={form.capacity}
          onChange={(e) => set("capacity", e.target.value === "" ? "" : Number(e.target.value))}
          className="h-9"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={id("route")}>Route</Label>
        <select
          id={id("route")}
          value={form.routeId}
          onChange={(e) => set("routeId", e.target.value)}
          className="w-full h-9 rounded-md bg-background/50 border border-input px-3 text-sm"
        >
          <option value="">— none —</option>
          {routes.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </div>

      <div className="col-span-2 rounded-xl border border-border/60 bg-background/40 p-3 space-y-3">
        <div className="text-xs font-semibold flex items-center gap-1.5">
          <User className="h-3.5 w-3.5 text-primary" /> Driver
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={id("driver-name")}>Driver name</Label>
          <Input
            id={id("driver-name")}
            value={form.driverName}
            disabled={!named}
            onChange={(e) => set("driverName", e.target.value)}
            placeholder='e.g. "Eloge"'
            className="h-9"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={id("driver-app")}>Uses the driver app?</Label>
          <select
            id={id("driver-app")}
            value={form.driverApp}
            onChange={(e) => set("driverApp", e.target.value)}
            className="w-full h-9 rounded-md bg-background/50 border border-input px-3 text-sm"
          >
            <option value={NAMED}>No — use the name above</option>
            {appDrivers.map((d) => (
              <option key={d.id} value={d.id}>
                Yes — {d.display_name}
                {d.plate_number ? ` (${d.plate_number})` : ""}
              </option>
            ))}
          </select>
          <p className="text-[11px] text-muted-foreground">
            {named
              ? trackerLinked
                ? "The GPS tracker reports as this driver. A new name shows on the dashboard within a minute."
                : "With a GPS tracker, no phone is needed: the tracker reports as this driver once it connects."
              : "This driver's phone app reports the location; the name comes from their account."}
          </p>
        </div>
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
