import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Loader2, Trash2, GraduationCap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AdminShell } from "@/components/AdminShell";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/admin/students")({
  head: () => ({ meta: [{ title: "Students — School setup — Pulse" }] }),
  component: StudentsPage,
});

interface StudentRow {
  id: string; school_id: string; bus_id: string | null;
  name: string; class: string | null; home_stop_id: string | null;
}
interface BusRow { id: string; label: string | null; plate: string | null; route_id: string | null; }
interface StopRow { id: string; route_id: string; name: string; sequence: number | null; }

function StudentsPage() {
  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [buses, setBuses] = useState<BusRow[]>([]);
  const [stops, setStops] = useState<StopRow[]>([]);
  const [busy, setBusy] = useState(false);

  // form
  const [name, setName] = useState("");
  const [cls, setCls] = useState("");
  const [busId, setBusId] = useState<string>("");
  const [stopId, setStopId] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { void bootstrap(); }, []);

  async function bootstrap() {
    setBusy(true);
    try {
      const { data: schools, error: sErr } = await supabase.from("schools").select("id").limit(1);
      if (sErr) throw sErr;
      const sid = schools?.[0]?.id ?? null;
      setSchoolId(sid);
      if (!sid) return;
      const [studentsRes, busesRes, stopsRes] = await Promise.all([
        supabase.from("students").select("*").eq("school_id", sid).order("name"),
        supabase.from("buses").select("id, label, plate, route_id").eq("school_id", sid).order("created_at"),
        supabase.from("stops").select("id, route_id, name, sequence").eq("school_id", sid).order("sequence", { ascending: true, nullsFirst: false }),
      ]);
      if (studentsRes.error) throw studentsRes.error;
      if (busesRes.error) throw busesRes.error;
      if (stopsRes.error) throw stopsRes.error;
      setStudents((studentsRes.data ?? []) as StudentRow[]);
      setBuses((busesRes.data ?? []) as BusRow[]);
      setStops((stopsRes.data ?? []) as StopRow[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load");
    } finally { setBusy(false); }
  }

  // Only offer stops from the currently-selected bus's route.
  const bus = useMemo(() => buses.find((b) => b.id === busId) ?? null, [buses, busId]);
  const availableStops = useMemo(() => stops.filter((s) => bus?.route_id != null && s.route_id === bus.route_id), [stops, bus]);
  useEffect(() => {
    // Clear the stop pick when the bus (and thus its route) changes to something incompatible.
    if (stopId && !availableStops.some((s) => s.id === stopId)) setStopId("");
  }, [availableStops, stopId]);

  async function createStudent() {
    if (!schoolId || !name.trim()) { toast.error("Name is required"); return; }
    setSaving(true);
    const { error } = await supabase.from("students").insert({
      school_id: schoolId,
      name: name.trim(),
      class: cls.trim() || null,
      bus_id: busId || null,
      home_stop_id: stopId || null,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    setName(""); setCls(""); setBusId(""); setStopId("");
    await bootstrap();
  }

  async function deleteStudent(id: string) {
    const { error } = await supabase.from("students").delete().eq("id", id);
    if (error) return toast.error(error.message);
    await bootstrap();
  }

  const busName = (id: string | null) => {
    const b = buses.find((x) => x.id === id);
    if (!b) return "—";
    return b.label ?? b.plate ?? "Bus";
  };
  const stopName = (id: string | null) => stops.find((s) => s.id === id)?.name ?? "—";

  return (
    <AdminShell>
      <div className="grid lg:grid-cols-[380px_1fr] gap-4">
        <aside className="rounded-2xl bg-gradient-card border border-border/60 shadow-soft p-4 space-y-3 h-fit">
          <div className="text-sm font-semibold">Add a student</div>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="stu-name">Name</Label>
              <Input id="stu-name" value={name} onChange={(e) => setName(e.target.value)} placeholder='e.g. "Alice Uwase"' className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="stu-class">Class</Label>
              <Input id="stu-class" value={cls} onChange={(e) => setCls(e.target.value)} placeholder='e.g. "P4"' className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="stu-bus">Bus</Label>
              <select id="stu-bus" value={busId} onChange={(e) => setBusId(e.target.value)}
                className="w-full h-9 rounded-md bg-background/50 border border-input px-3 text-sm">
                <option value="">— none —</option>
                {buses.map((b) => <option key={b.id} value={b.id}>{b.label ?? b.plate ?? "Bus"}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="stu-stop">Home stop {bus?.route_id ? "" : "(pick a bus first)"}</Label>
              <select id="stu-stop" value={stopId} disabled={!bus?.route_id} onChange={(e) => setStopId(e.target.value)}
                className="w-full h-9 rounded-md bg-background/50 border border-input px-3 text-sm disabled:opacity-60">
                <option value="">— none —</option>
                {availableStops.map((s) => <option key={s.id} value={s.id}>{s.sequence != null ? `${s.sequence}. ` : ""}{s.name}</option>)}
              </select>
              {busId && !bus?.route_id && (
                <div className="text-[11px] text-muted-foreground">This bus has no route — assign a route to the bus first (Buses tab).</div>
              )}
            </div>
          </div>
          <Button onClick={createStudent} disabled={saving} className="w-full bg-gradient-primary shadow-glow">
            {saving ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Plus className="h-4 w-4 mr-1.5" />}
            Add student
          </Button>
        </aside>

        <section className="rounded-2xl bg-gradient-card border border-border/60 shadow-soft p-4">
          <div className="text-sm font-semibold flex items-center justify-between">
            Students <span className="text-xs text-muted-foreground">{students.length}</span>
          </div>
          {busy && <div className="text-xs text-muted-foreground flex items-center gap-2 py-4"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…</div>}
          <div className="mt-2 divide-y divide-border/50">
            {students.length === 0 && !busy && <div className="text-xs text-muted-foreground py-8 text-center">No students yet — add one on the left.</div>}
            {students.map((s) => (
              <div key={s.id} className="py-3 flex items-center gap-3">
                <span className="h-10 w-10 rounded-xl bg-primary/15 text-primary grid place-items-center"><GraduationCap className="h-5 w-5" /></span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate">{s.name}{s.class ? <span className="text-xs text-muted-foreground font-normal"> · {s.class}</span> : null}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    Bus: {busName(s.bus_id)} · Home stop: {stopName(s.home_stop_id)}
                  </div>
                </div>
                <button onClick={() => deleteStudent(s.id)} className="p-2 rounded hover:bg-destructive/15 text-destructive" aria-label="Delete">
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
