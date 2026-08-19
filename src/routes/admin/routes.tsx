import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Loader2, MapPin, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AdminShell } from "@/components/AdminShell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";

const MapPicker = lazy(() => import("@/components/MapPicker").then((m) => ({ default: m.MapPicker })));

export const Route = createFileRoute("/admin/routes")({
  head: () => ({ meta: [{ title: "Routes — School setup — Pulse" }] }),
  component: RoutesPage,
});

interface RouteRow { id: string; school_id: string; name: string; created_at: string; }
interface StopRow {
  id: string; route_id: string; school_id: string;
  name: string; lat: number | null; lng: number | null;
  radius_m: number; sequence: number | null;
  type: "school" | "pickup"; created_at: string;
}

function RoutesPage() {
  const { role } = useAuth();
  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [routes, setRoutes] = useState<RouteRow[]>([]);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [newRouteName, setNewRouteName] = useState("");
  const [stops, setStops] = useState<StopRow[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (role == null) return;
    void bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  async function bootstrap() {
    setBusy(true);
    try {
      // Super admin can see all schools; pick the first for now.
      // School admin: only their own school.
      const { data: schools, error } = await supabase.from("schools").select("id").limit(50);
      if (error) throw error;
      const first = schools?.[0]?.id ?? null;
      setSchoolId(first);
      if (first) await loadRoutes(first);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load school context");
    } finally {
      setBusy(false);
    }
  }

  async function loadRoutes(sid: string) {
    const { data, error } = await supabase
      .from("routes").select("*")
      .eq("school_id", sid).order("created_at", { ascending: true });
    if (error) return toast.error(error.message);
    setRoutes((data ?? []) as RouteRow[]);
    if ((data?.length ?? 0) > 0 && !selectedRouteId) {
      setSelectedRouteId(data![0].id);
      await loadStops(data![0].id);
    }
  }

  async function loadStops(routeId: string) {
    const { data, error } = await supabase
      .from("stops").select("*")
      .eq("route_id", routeId)
      .order("sequence", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true });
    if (error) return toast.error(error.message);
    setStops((data ?? []) as StopRow[]);
  }

  async function createRoute() {
    if (!schoolId || !newRouteName.trim()) return;
    const { data, error } = await supabase
      .from("routes").insert({ school_id: schoolId, name: newRouteName.trim() }).select().single();
    if (error) return toast.error(error.message);
    setNewRouteName("");
    await loadRoutes(schoolId);
    setSelectedRouteId(data.id);
    await loadStops(data.id);
  }

  async function reorderStop(stopId: string, delta: -1 | 1) {
    const current = stops.find((s) => s.id === stopId);
    if (!current) return;
    const list = [...stops].sort((a, b) => (a.sequence ?? 1e9) - (b.sequence ?? 1e9));
    const idx = list.findIndex((s) => s.id === stopId);
    const j = idx + delta;
    if (j < 0 || j >= list.length) return;
    const other = list[j];
    const currentSeq = current.sequence ?? idx + 1;
    const otherSeq = other.sequence ?? j + 1;
    await Promise.all([
      supabase.from("stops").update({ sequence: otherSeq }).eq("id", current.id),
      supabase.from("stops").update({ sequence: currentSeq }).eq("id", other.id),
    ]);
    if (selectedRouteId) await loadStops(selectedRouteId);
  }

  async function deleteStop(stopId: string) {
    const { error } = await supabase.from("stops").delete().eq("id", stopId);
    if (error) return toast.error(error.message);
    if (selectedRouteId) await loadStops(selectedRouteId);
  }

  return (
    <AdminShell>
      <div className="grid lg:grid-cols-[300px_1fr] gap-4">
        {/* Routes column */}
        <aside className="rounded-2xl bg-gradient-card border border-border/60 shadow-soft p-4 space-y-3 h-fit">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold">Routes</div>
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          </div>
          <div className="flex gap-2">
            <Input value={newRouteName} onChange={(e) => setNewRouteName(e.target.value)} placeholder="e.g. Morning – Zone 1" className="h-9" />
            <Button onClick={createRoute} size="sm" className="bg-gradient-primary shadow-glow"><Plus className="h-4 w-4" /></Button>
          </div>
          <ul className="space-y-1">
            {routes.length === 0 && <li className="text-xs text-muted-foreground py-6 text-center">No routes yet</li>}
            {routes.map((r) => (
              <li key={r.id}>
                <button
                  onClick={() => { setSelectedRouteId(r.id); void loadStops(r.id); }}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                    r.id === selectedRouteId ? "bg-primary/15 border border-primary/40" : "hover:bg-accent/40 border border-transparent"
                  }`}
                >
                  {r.name}
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="space-y-3">
          {!selectedRouteId ? (
            <div className="rounded-2xl border border-border/50 p-8 text-sm text-muted-foreground text-center">
              Pick or create a route on the left.
            </div>
          ) : (
            <>
              <StopEditor
                schoolId={schoolId!}
                routeId={selectedRouteId}
                onCreated={() => selectedRouteId && loadStops(selectedRouteId)}
                nextSequence={stops.reduce((mx, s) => Math.max(mx, s.sequence ?? 0), 0) + 1}
              />
              <div className="rounded-2xl bg-gradient-card border border-border/60 shadow-soft p-4 space-y-2">
                <div className="text-sm font-semibold flex items-center justify-between">
                  Stops on this route <span className="text-xs text-muted-foreground">{stops.length}</span>
                </div>
                {stops.length === 0 && <div className="text-xs text-muted-foreground py-6 text-center">No stops on this route yet — add one below.</div>}
                <ol className="space-y-1.5">
                  {stops.map((s, i) => (
                    <li key={s.id} className="flex items-center gap-2 rounded-lg border border-border/50 bg-background/40 p-2">
                      <span className="h-7 w-7 grid place-items-center rounded-md bg-primary/15 text-primary font-mono text-xs font-bold">
                        {s.sequence ?? i + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate flex items-center gap-2">
                          {s.name}
                          {s.type === "school" && <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/15 text-primary">School</span>}
                        </div>
                        <div className="text-[11px] text-muted-foreground flex items-center gap-1.5"><MapPin className="h-3 w-3" />{s.lat?.toFixed(5)}, {s.lng?.toFixed(5)} · radius {s.radius_m} m</div>
                      </div>
                      <button onClick={() => reorderStop(s.id, -1)} className="p-1.5 rounded hover:bg-accent/50" aria-label="Move up"><ArrowUp className="h-3.5 w-3.5" /></button>
                      <button onClick={() => reorderStop(s.id, 1)}  className="p-1.5 rounded hover:bg-accent/50" aria-label="Move down"><ArrowDown className="h-3.5 w-3.5" /></button>
                      <button onClick={() => deleteStop(s.id)}      className="p-1.5 rounded hover:bg-destructive/15 text-destructive" aria-label="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
                    </li>
                  ))}
                </ol>
              </div>
            </>
          )}
        </section>
      </div>
    </AdminShell>
  );
}

function StopEditor({ schoolId, routeId, onCreated, nextSequence }: {
  schoolId: string; routeId: string; onCreated: () => void; nextSequence: number;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<"pickup" | "school">("pickup");
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [radius, setRadius] = useState(120);
  const [sequence, setSequence] = useState<number>(nextSequence);
  const [saving, setSaving] = useState(false);

  useEffect(() => setSequence(nextSequence), [nextSequence]);

  async function save() {
    if (!name.trim() || lat == null || lng == null) {
      toast.error("Name and a picked location are required");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("stops").insert({
      route_id: routeId, school_id: schoolId,
      name: name.trim(), lat, lng, radius_m: radius, sequence, type,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    setName(""); setLat(null); setLng(null); setRadius(120);
    onCreated();
  }

  return (
    <div className="rounded-2xl bg-gradient-card border border-border/60 shadow-soft p-4 space-y-3">
      <div className="text-sm font-semibold">Add a stop</div>
      <div className="grid md:grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="stop-name">Name</Label>
          <Input id="stop-name" value={name} onChange={(e) => setName(e.target.value)} placeholder='e.g. "Kimironko"' className="h-9" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="stop-type">Type</Label>
          <select id="stop-type" value={type} onChange={(e) => setType(e.target.value as "school" | "pickup")}
            className="w-full h-9 rounded-md bg-background/50 border border-input px-3 text-sm">
            <option value="pickup">pickup</option>
            <option value="school">school</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="stop-radius">Radius (m)</Label>
          <Input id="stop-radius" type="number" min={20} max={2000} value={radius} onChange={(e) => setRadius(Math.max(20, Number(e.target.value) || 120))} className="h-9" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="stop-seq">Sequence</Label>
          <Input id="stop-seq" type="number" value={sequence} onChange={(e) => setSequence(Number(e.target.value) || 1)} className="h-9" />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Location</Label>
        <Suspense fallback={<div className="h-64 rounded-xl border border-border/50 grid place-items-center text-muted-foreground text-sm"><Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading map…</div>}>
          <MapPicker lat={lat} lng={lng} radius_m={radius} onPick={(la, lo) => { setLat(la); setLng(lo); }} className="h-72" />
        </Suspense>
        <div className="text-[11px] text-muted-foreground">
          {lat != null && lng != null ? <>Picked <span className="font-mono">{lat.toFixed(5)}, {lng.toFixed(5)}</span></> : "Click on the map to place the stop."}
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving} className="bg-gradient-primary shadow-glow">
          {saving ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Plus className="h-4 w-4 mr-1.5" />}
          Save stop
        </Button>
      </div>
    </div>
  );
}
