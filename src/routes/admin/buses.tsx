import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Loader2, Trash2, Bus as BusIcon, Satellite, MessageSquare } from "lucide-react";
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
  id: string; school_id: string; route_id: string | null;
  plate: string | null; label: string | null; capacity: number | null;
  driver_user_id: string | null;
  gps_imei: string | null;
  gps_driver_name: string | null;
}
const IMEI_RE = /^[0-9]{15}$/;

interface RouteRow { id: string; name: string; }
interface DriverRow { id: string; display_name: string; plate_number: string | null; }

function BusesPage() {
  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [buses, setBuses] = useState<BusRow[]>([]);
  const [routes, setRoutes] = useState<RouteRow[]>([]);
  const [drivers, setDrivers] = useState<DriverRow[]>([]);
  const [busy, setBusy] = useState(false);

  // form
  const [label, setLabel] = useState("");
  const [plate, setPlate] = useState("");
  const [capacity, setCapacity] = useState<number | "">(32);
  const [routeId, setRouteId] = useState<string>("");
  const [driverId, setDriverId] = useState<string>("");
  const [imei, setImei] = useState("");
  const [gpsDriverName, setGpsDriverName] = useState("");
  const [saving, setSaving] = useState(false);
  // per-row IMEI edits, keyed by bus id
  const [imeiEdits, setImeiEdits] = useState<Record<string, string>>({});

  useEffect(() => { void bootstrap(); }, []);

  async function bootstrap() {
    setBusy(true);
    try {
      const { data: schools, error: sErr } = await supabase.from("schools").select("id").limit(1);
      if (sErr) throw sErr;
      const sid = schools?.[0]?.id ?? null;
      setSchoolId(sid);
      if (!sid) return;

      const [busesRes, routesRes, driversRes, driverRolesRes] = await Promise.all([
        supabase.from("buses").select("*").eq("school_id", sid).order("created_at", { ascending: true }),
        supabase.from("routes").select("id, name").eq("school_id", sid).order("name"),
        supabase.from("profiles").select("id, display_name, plate_number, school_id").eq("school_id", sid).order("display_name"),
        supabase.from("user_roles").select("user_id").eq("role", "user"),
      ]);
      if (busesRes.error) throw busesRes.error;
      if (routesRes.error) throw routesRes.error;
      if (driversRes.error) throw driversRes.error;
      if (driverRolesRes.error) throw driverRolesRes.error;
      const driverIds = new Set((driverRolesRes.data ?? []).map((r) => r.user_id));
      setBuses((busesRes.data ?? []) as BusRow[]);
      setRoutes((routesRes.data ?? []) as RouteRow[]);
      setDrivers(((driversRes.data ?? []) as DriverRow[]).filter((p) => driverIds.has(p.id)));
    } catch (e) {
      toast.error(friendlyError(e, "Couldn't load buses right now."));
    } finally { setBusy(false); }
  }

  async function createBus() {
    if (!schoolId) return;
    if (!label.trim() && !plate.trim()) { toast.error("Give the vehicle a name or plate"); return; }
    if (imei.trim() && !IMEI_RE.test(imei.trim())) { toast.error("Tracker IMEI must be 15 digits"); return; }
    setSaving(true);
    const { error } = await supabase.from("buses").insert({
      school_id: schoolId,
      route_id: routeId || null,
      driver_user_id: driverId || null,
      plate: plate.trim() || null,
      label: label.trim() || null,
      capacity: capacity === "" ? null : Number(capacity),
      gps_imei: imei.trim() || null,
      gps_driver_name: imei.trim() && !driverId ? gpsDriverName.trim() || null : null,
    });
    setSaving(false);
    if (error) return toast.error(friendlyError(error));
    toast.success(imei.trim() ? "Vehicle added — now send the tracker its 3 SMS" : "Vehicle added");
    setLabel(""); setPlate(""); setCapacity(32); setRouteId(""); setDriverId(""); setImei(""); setGpsDriverName("");
    await bootstrap();
  }

  async function saveImei(bus: BusRow) {
    const edited = imeiEdits[bus.id];
    if (edited === undefined) return; // focused and left without typing
    const next = edited.trim();
    if (next === (bus.gps_imei ?? "")) return;
    if (next && !IMEI_RE.test(next)) { toast.error("Tracker IMEI must be 15 digits"); return; }
    const { error } = await supabase.from("buses").update({ gps_imei: next || null }).eq("id", bus.id);
    if (error) return toast.error(friendlyError(error));
    toast.success(next ? "GPS tracker linked — send it the 3 SMS if it's new" : "GPS tracker removed");
    await bootstrap();
  }

  async function changeDriver(bus: BusRow, nextDriverId: string) {
    const { error } = await supabase.from("buses").update({ driver_user_id: nextDriverId || null }).eq("id", bus.id);
    if (error) return toast.error(friendlyError(error));
    toast.success("Driver updated");
    await bootstrap();
  }

  async function deleteBus(id: string) {
    const { error } = await supabase.from("buses").delete().eq("id", id);
    if (error) return toast.error(friendlyError(error));
    await bootstrap();
  }

  const routeName = (id: string | null) => routes.find((r) => r.id === id)?.name ?? "—";
  const driverName = (id: string | null) => drivers.find((d) => d.id === id)?.display_name ?? "—";

  return (
    <AdminShell>
      <div className="grid lg:grid-cols-[380px_1fr] gap-4">
        <aside className="rounded-2xl bg-gradient-card border border-border/60 shadow-soft p-4 space-y-3 h-fit">
          <div className="text-sm font-semibold">Add a vehicle</div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="bus-label">Name</Label>
              <Input id="bus-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder='e.g. "Bus 1"' className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bus-plate">Plate</Label>
              <Input id="bus-plate" value={plate} onChange={(e) => setPlate(e.target.value)} placeholder="e.g. RAB123X" className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bus-capacity">Capacity</Label>
              <Input id="bus-capacity" type="number" min={1} value={capacity} onChange={(e) => setCapacity(e.target.value === "" ? "" : Number(e.target.value))} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bus-route">Route</Label>
              <select id="bus-route" value={routeId} onChange={(e) => setRouteId(e.target.value)}
                className="w-full h-9 rounded-md bg-background/50 border border-input px-3 text-sm">
                <option value="">— none —</option>
                {routes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label htmlFor="bus-driver">Driver</Label>
              <select id="bus-driver" value={driverId} onChange={(e) => setDriverId(e.target.value)}
                className="w-full h-9 rounded-md bg-background/50 border border-input px-3 text-sm">
                <option value="">— unassigned —</option>
                {drivers.map((d) => <option key={d.id} value={d.id}>{d.display_name}{d.plate_number ? ` (${d.plate_number})` : ""}</option>)}
              </select>
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label htmlFor="bus-imei">GPS tracker IMEI (optional)</Label>
              <Input id="bus-imei" inputMode="numeric" value={imei} onChange={(e) => setImei(e.target.value.replace(/\D/g, ""))} placeholder="15 digits, on the tracker label" className="h-9 font-mono" />
            </div>
            {imei && !driverId && (
              <div className="space-y-1.5 col-span-2">
                <Label htmlFor="bus-gps-driver">Driver name (shown for the tracker)</Label>
                <Input id="bus-gps-driver" value={gpsDriverName} onChange={(e) => setGpsDriverName(e.target.value)} placeholder='e.g. "Eloge"' className="h-9" />
                <p className="text-[11px] text-muted-foreground">
                  No driver app needed: the tracker acts as this driver's phone. The account is created automatically the first time the tracker connects.
                </p>
              </div>
            )}
          </div>
          <Button onClick={createBus} disabled={saving} className="w-full bg-gradient-primary shadow-glow">
            {saving ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Plus className="h-4 w-4 mr-1.5" />}
            Add vehicle
          </Button>
          <div className="rounded-xl border border-border/60 bg-background/40 p-3 space-y-2">
            <div className="text-xs font-semibold flex items-center gap-1.5">
              <MessageSquare className="h-3.5 w-3.5 text-primary" /> New GPS tracker? Send these 3 SMS to its SIM number
            </div>
            <ol className="space-y-1.5">
              {TRACKER_SETUP_SMS.map((c, i) => (
                <li key={c.sms} className="text-[11px] text-muted-foreground">
                  <span className="mr-1">{i + 1}.</span>
                  <button
                    type="button"
                    onClick={() => { void navigator.clipboard?.writeText(c.sms); toast.success("SMS copied"); }}
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
          {busy && <div className="text-xs text-muted-foreground flex items-center gap-2 py-4"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…</div>}
          <div className="mt-2 divide-y divide-border/50">
            {buses.length === 0 && !busy && <div className="text-xs text-muted-foreground py-8 text-center">No vehicles yet — add one on the left.</div>}
            {buses.map((b) => (
              <div key={b.id} className="py-3 flex items-center gap-3">
                <span className="h-10 w-10 rounded-xl bg-primary/15 text-primary grid place-items-center"><BusIcon className="h-5 w-5" /></span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate flex items-center gap-2">
                    {b.label ?? b.plate ?? "Bus"}
                    {b.plate && b.label && <span className="font-mono text-[10px] bg-muted px-1.5 py-0.5 rounded">{b.plate}</span>}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    Route: {routeName(b.route_id)} · Capacity: {b.capacity ?? "—"}
                  </div>
                  <div className="mt-1.5 flex items-center gap-1.5 text-xs">
                    <span className="text-muted-foreground">Driver:</span>
                    <select aria-label="Driver" value={b.driver_user_id ?? ""} onChange={(e) => changeDriver(b, e.target.value)}
                      className="h-7 max-w-[220px] rounded-md bg-background/50 border border-input px-2 text-xs">
                      <option value="">— unassigned —</option>
                      {b.driver_user_id && !drivers.some((d) => d.id === b.driver_user_id) && (
                        <option value={b.driver_user_id}>{driverName(b.driver_user_id)}</option>
                      )}
                      {drivers.map((d) => <option key={d.id} value={d.id}>{d.display_name}{d.plate_number ? ` (${d.plate_number})` : ""}</option>)}
                    </select>
                  </div>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <Satellite className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <Input
                      aria-label="GPS tracker IMEI"
                      inputMode="numeric"
                      value={imeiEdits[b.id] ?? b.gps_imei ?? ""}
                      onChange={(e) => setImeiEdits((m) => ({ ...m, [b.id]: e.target.value.replace(/\D/g, "") }))}
                      onBlur={() => saveImei(b)}
                      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                      placeholder="GPS tracker IMEI"
                      className="h-7 max-w-[220px] text-xs font-mono"
                    />
                    {b.gps_imei && !b.driver_user_id && (
                      <span className="text-[10px] text-muted-foreground">
                        Driver "{b.gps_driver_name || `${b.label ?? "Bus"} (GPS)`}" is created when the tracker connects
                      </span>
                    )}
                  </div>
                </div>
                <button onClick={() => deleteBus(b.id)} className="p-2 rounded hover:bg-destructive/15 text-destructive" aria-label="Delete">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </section>
      </div>
    </AdminShell>
  );
}
