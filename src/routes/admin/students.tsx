import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Plus,
  Search,
  Upload,
  GraduationCap,
  Pencil,
  CalendarClock,
  Users,
  Camera,
  Trash2,
  Bus as BusIcon,
  KeyRound,
} from "lucide-react";
import { AppShell, PageHeader, useCurrentSchool } from "@/components/AppShell";
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
  EmptyState,
  Field,
  Loading,
  MigrationNotice,
  NativeSelect,
  Panel,
  Pill,
  StatCard,
  StudentAvatar,
} from "@/components/school/ui";
import { db } from "@/lib/fleet";
import { friendlyError } from "@/lib/friendly-errors";
import { formatPhone, normalizePhone } from "@/lib/phone";
import { parseCsv } from "@/lib/attendance";
import { CodesDialog } from "@/components/school/CodesDialog";
import {
  busName,
  isMissingTable,
  type BusLite,
  type Guardian,
  type StopRow,
  type StudentGuardian,
  type StudentRow,
} from "@/lib/school";

export const Route = createFileRoute("/admin/students")({
  validateSearch: (s: Record<string, unknown>): { q?: string } => ({
    q: typeof s.q === "string" ? s.q : undefined,
  }),
  head: () => ({ meta: [{ title: "Students — Live Track" }] }),
  component: () => (
    <AppShell>
      <StudentsPage />
    </AppShell>
  ),
});

interface GuardianDraft {
  id?: string;
  full_name: string;
  phone: string;
  relationship: string;
}
interface StudentDraft {
  id?: string;
  name: string;
  student_code: string;
  class: string;
  photo_url: string | null;
  bus_id: string;
  morning_stop_id: string;
  afternoon_stop_id: string;
  active: boolean;
  notes: string;
  photo_consent: boolean;
  biometric_consent: boolean;
  guardians: GuardianDraft[];
}

const EMPTY: StudentDraft = {
  name: "",
  student_code: "",
  class: "",
  photo_url: null,
  bus_id: "",
  morning_stop_id: "",
  afternoon_stop_id: "",
  active: true,
  notes: "",
  photo_consent: false,
  biometric_consent: false,
  guardians: [{ full_name: "", phone: "", relationship: "Mother" }],
};

/** Resize a photo to a small JPEG data URL (~10 KB) so no file storage is needed. */
async function shrinkPhoto(file: File, size = 192): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const s = Math.min(img.width, img.height);
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    c.getContext("2d")!.drawImage(
      img,
      (img.width - s) / 2,
      (img.height - s) / 2,
      s,
      s,
      0,
      0,
      size,
      size,
    );
    return c.toDataURL("image/jpeg", 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function StudentsPage() {
  const { schoolId } = useCurrentSchool();
  const [students, setStudents] = useState<StudentRow[] | null>(null);
  const [buses, setBuses] = useState<BusLite[]>([]);
  const [stops, setStops] = useState<StopRow[]>([]);
  const [guardians, setGuardians] = useState<Guardian[]>([]);
  const [links, setLinks] = useState<StudentGuardian[]>([]);
  const [missing, setMissing] = useState(false);

  const search = Route.useSearch();
  const [q, setQ] = useState(search.q ?? "");
  useEffect(() => {
    if (search.q != null) setQ(search.q);
  }, [search.q]);
  const [busFilter, setBusFilter] = useState("all");
  const [classFilter, setClassFilter] = useState("all");
  const [showInactive, setShowInactive] = useState(false);

  const [editing, setEditing] = useState<StudentDraft | null>(null);
  const [override, setOverride] = useState<StudentRow | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [codes, setCodes] = useState<Guardian[] | null>(null);

  async function load() {
    if (!schoolId) return;
    const [s, b, st, g, l] = await Promise.all([
      db.from("students").select("*").eq("school_id", schoolId).order("name"),
      db.from("buses").select("*").eq("school_id", schoolId).order("label"),
      db.from("stops").select("*").eq("school_id", schoolId).order("sequence"),
      db.from("guardians").select("*").eq("school_id", schoolId).order("full_name"),
      db.from("student_guardians").select("student_id, guardian_id, is_primary"),
    ]);
    if (isMissingTable(g.error) || isMissingTable(s.error)) {
      setMissing(true);
      setStudents([]);
      return;
    }
    if (s.error) toast.error(friendlyError(s.error, "Couldn't load students"));
    setStudents((s.data ?? []) as StudentRow[]);
    setBuses((b.data ?? []) as BusLite[]);
    setStops((st.data ?? []) as StopRow[]);
    setGuardians((g.data ?? []) as Guardian[]);
    setLinks((l.data ?? []) as StudentGuardian[]);
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId]);

  const busById = useMemo(() => new Map(buses.map((b) => [b.id, b])), [buses]);
  const stopById = useMemo(() => new Map(stops.map((s) => [s.id, s])), [stops]);
  const guardianById = useMemo(() => new Map(guardians.map((g) => [g.id, g])), [guardians]);
  const parentsOf = useMemo(() => {
    const m = new Map<string, Guardian[]>();
    for (const l of links) {
      const g = guardianById.get(l.guardian_id);
      if (!g) continue;
      m.set(l.student_id, [...(m.get(l.student_id) ?? []), g]);
    }
    return m;
  }, [links, guardianById]);
  const classes = useMemo(
    () => [...new Set((students ?? []).map((s) => s.class).filter(Boolean) as string[])].sort(),
    [students],
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (students ?? []).filter((s) => {
      if (!showInactive && !s.active) return false;
      if (busFilter === "none" ? s.bus_id : busFilter !== "all" && s.bus_id !== busFilter)
        return false;
      if (classFilter !== "all" && s.class !== classFilter) return false;
      if (!needle) return true;
      const parents = parentsOf.get(s.id) ?? [];
      return (
        s.name.toLowerCase().includes(needle) ||
        (s.student_code ?? "").toLowerCase().includes(needle) ||
        parents.some(
          (p) =>
            p.full_name.toLowerCase().includes(needle) ||
            p.phone.includes(needle.replace(/\D/g, "") || "~"),
        )
      );
    });
  }, [students, q, busFilter, classFilter, showInactive, parentsOf]);

  const active = (students ?? []).filter((s) => s.active);
  const stats = {
    total: active.length,
    onBus: active.filter((s) => s.bus_id).length,
    withParent: active.filter((s) => (parentsOf.get(s.id) ?? []).length > 0).length,
    activated: active.filter((s) => (parentsOf.get(s.id) ?? []).some((p) => p.user_id)).length,
  };

  function openEdit(s?: StudentRow) {
    if (!s) return setEditing({ ...EMPTY, guardians: [{ ...EMPTY.guardians[0] }] });
    const ps = (parentsOf.get(s.id) ?? []).map((g) => ({
      id: g.id,
      full_name: g.full_name,
      phone: formatPhone(g.phone),
      relationship: g.relationship ?? "",
    }));
    setEditing({
      id: s.id,
      name: s.name,
      student_code: s.student_code ?? "",
      class: s.class ?? "",
      photo_url: s.photo_url,
      bus_id: s.bus_id ?? "",
      morning_stop_id: s.morning_stop_id ?? s.home_stop_id ?? "",
      afternoon_stop_id: s.afternoon_stop_id ?? "",
      active: s.active,
      notes: s.notes ?? "",
      photo_consent: s.photo_consent,
      biometric_consent: s.biometric_consent,
      guardians: ps.length ? ps : [{ full_name: "", phone: "", relationship: "Mother" }],
    });
  }

  if (missing) {
    return (
      <>
        <PageHeader title="Students" />
        <MigrationNotice />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Students"
        description="Register each child once: class, photo, bus, morning and afternoon stop, and up to two parents. Parents get a code to activate their account."
        actions={
          <>
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <Upload className="h-4 w-4 mr-1.5" /> Import CSV
            </Button>
            <Button onClick={() => openEdit()} className="bg-gradient-primary shadow-glow">
              <Plus className="h-4 w-4 mr-1.5" /> Add student
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
        <StatCard label="Students" value={stats.total} Icon={GraduationCap} tone="info" />
        <StatCard
          label="Ride a bus"
          value={stats.onBus}
          hint={`${stats.total - stats.onBus} without a bus`}
          Icon={BusIcon}
        />
        <StatCard
          label="Parent registered"
          value={`${stats.total ? Math.round((stats.withParent / stats.total) * 100) : 0}%`}
          hint={`${stats.withParent} of ${stats.total}`}
          Icon={Users}
          tone="success"
        />
        <StatCard
          label="Parent app active"
          value={stats.activated}
          hint="children with a parent signed in"
          Icon={KeyRound}
          tone="warning"
        />
      </div>

      <Panel bodyClassName="p-0">
        <div className="p-4 sm:p-5 flex flex-col lg:flex-row gap-3 border-b border-border">
          <div className="relative flex-1">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by name, code, parent or phone"
              className="pl-9"
            />
          </div>
          <div className="grid grid-cols-2 sm:flex gap-2">
            <NativeSelect value={busFilter} onChange={setBusFilter} className="sm:w-44">
              <option value="all">All buses</option>
              <option value="none">No bus</option>
              {buses.map((b) => (
                <option key={b.id} value={b.id}>
                  {busName(b)}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect value={classFilter} onChange={setClassFilter} className="sm:w-36">
              <option value="all">All classes</option>
              {classes.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </NativeSelect>
            <label className="col-span-2 flex items-center gap-2 text-sm text-muted-foreground px-1 whitespace-nowrap">
              <Checkbox checked={showInactive} onCheckedChange={(v) => setShowInactive(!!v)} /> Show
              left school
            </label>
          </div>
        </div>

        {students == null ? (
          <Loading />
        ) : filtered.length === 0 ? (
          <EmptyState
            Icon={GraduationCap}
            title={students.length ? "No student matches" : "No students yet"}
            action={
              !students.length && (
                <Button onClick={() => openEdit()}>
                  <Plus className="h-4 w-4 mr-1.5" /> Add the first student
                </Button>
              )
            }
          >
            {students.length
              ? "Try another search or filter."
              : "Add students one by one, or import a CSV from your school system."}
          </EmptyState>
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((s) => {
              const bus = s.bus_id ? busById.get(s.bus_id) : null;
              const am = stopById.get(s.morning_stop_id ?? s.home_stop_id ?? "");
              const pm = stopById.get(
                s.afternoon_stop_id ?? s.morning_stop_id ?? s.home_stop_id ?? "",
              );
              const parents = parentsOf.get(s.id) ?? [];
              return (
                <li
                  key={s.id}
                  className="px-4 sm:px-5 py-3 flex items-center gap-3 sm:gap-4 hover:bg-accent/30"
                >
                  <StudentAvatar name={s.name} photo={s.photo_url} size={44} />
                  <div className="min-w-0 flex-1 grid sm:grid-cols-[1.3fr_1fr_1.2fr] gap-x-4 gap-y-1">
                    <div className="min-w-0">
                      <div className="font-medium truncate flex items-center gap-2">
                        {s.name}
                        {!s.active && <Pill tone="muted">Left</Pill>}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {[s.class && `Class ${s.class}`, s.student_code]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </div>
                    </div>
                    <div className="text-xs min-w-0">
                      {bus ? (
                        <>
                          <div className="font-medium truncate flex items-center gap-1.5">
                            <BusIcon className="h-3.5 w-3.5 text-primary" /> {busName(bus)}
                          </div>
                          <div className="text-muted-foreground truncate">
                            {am?.name ?? "No stop"}
                            {pm && am && pm.id !== am.id ? ` → ${pm.name} (pm)` : ""}
                          </div>
                        </>
                      ) : (
                        <span className="text-muted-foreground">No bus</span>
                      )}
                    </div>
                    <div className="text-xs min-w-0 hidden sm:block">
                      {parents.length ? (
                        parents.map((p) => (
                          <div key={p.id} className="truncate flex items-center gap-1.5">
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${p.user_id ? "bg-success" : "bg-warning"}`}
                              title={p.user_id ? "App active" : "Not activated yet"}
                            />
                            {p.full_name}{" "}
                            <span className="text-muted-foreground">{formatPhone(p.phone)}</span>
                          </div>
                        ))
                      ) : (
                        <span className="text-warning">No parent yet</span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Temporary change"
                      onClick={() => setOverride(s)}
                    >
                      <CalendarClock className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" title="Edit" onClick={() => openEdit(s)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      {editing && schoolId && (
        <StudentDialog
          draft={editing}
          schoolId={schoolId}
          buses={buses}
          stops={stops}
          guardians={guardians}
          onClose={() => setEditing(null)}
          onSaved={async (newCodes) => {
            setEditing(null);
            await load();
            if (newCodes.length) setCodes(newCodes);
          }}
        />
      )}
      {override && schoolId && (
        <OverrideDialog
          student={override}
          schoolId={schoolId}
          buses={buses}
          stops={stops}
          onClose={() => setOverride(null)}
        />
      )}
      {importOpen && schoolId && (
        <ImportDialog
          schoolId={schoolId}
          buses={buses}
          stops={stops}
          onClose={() => setImportOpen(false)}
          onDone={async (newCodes) => {
            setImportOpen(false);
            await load();
            if (newCodes.length) setCodes(newCodes);
          }}
        />
      )}
      {codes && <CodesDialog guardians={codes} onClose={() => setCodes(null)} />}
    </>
  );
}

// ── Save helpers ─────────────────────────────────────────────────────────────

/** Finds or creates each parent by phone, then sets the student's links. */
async function saveGuardians(
  schoolId: string,
  studentId: string,
  drafts: GuardianDraft[],
): Promise<Guardian[]> {
  const created: Guardian[] = [];
  const ids: string[] = [];
  for (const [i, d] of drafts.entries()) {
    const phone = normalizePhone(d.phone);
    if (!d.full_name.trim() || !phone) continue;
    const { data: existing } = await db
      .from("guardians")
      .select("*")
      .eq("school_id", schoolId)
      .eq("phone", phone)
      .maybeSingle();
    let g = existing as Guardian | null;
    if (g) {
      const { error } = await db
        .from("guardians")
        .update({ full_name: d.full_name.trim(), relationship: d.relationship || null })
        .eq("id", g.id);
      if (error) throw error;
    } else {
      const { data, error } = await db
        .from("guardians")
        .insert({
          school_id: schoolId,
          full_name: d.full_name.trim(),
          phone,
          relationship: d.relationship || null,
        })
        .select("*")
        .single();
      if (error) throw error;
      g = data as Guardian;
      created.push(g);
    }
    ids.push(g.id);
    const { error: lErr } = await db
      .from("student_guardians")
      .upsert({ student_id: studentId, guardian_id: g.id, is_primary: i === 0 });
    if (lErr) throw lErr;
  }
  const { data: cur } = await db
    .from("student_guardians")
    .select("guardian_id")
    .eq("student_id", studentId);
  const stale = ((cur ?? []) as { guardian_id: string }[])
    .map((x) => x.guardian_id)
    .filter((id) => !ids.includes(id));
  if (stale.length)
    await db
      .from("student_guardians")
      .delete()
      .eq("student_id", studentId)
      .in("guardian_id", stale);
  return created;
}

// ── Add / edit dialog ────────────────────────────────────────────────────────

function StudentDialog({
  draft,
  schoolId,
  buses,
  stops,
  guardians,
  onClose,
  onSaved,
}: {
  draft: StudentDraft;
  schoolId: string;
  buses: BusLite[];
  stops: StopRow[];
  guardians: Guardian[];
  onClose: () => void;
  onSaved: (newCodes: Guardian[]) => void;
}) {
  const [d, setD] = useState<StudentDraft>(draft);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = <K extends keyof StudentDraft>(k: K, v: StudentDraft[K]) =>
    setD((x) => ({ ...x, [k]: v }));
  const bus = buses.find((b) => b.id === d.bus_id);
  const routeStops = stops
    .filter((s) => s.type !== "school" && (!bus?.route_id || s.route_id === bus.route_id))
    .sort((a, b) => (a.sequence ?? 999) - (b.sequence ?? 999));

  const setGuardian = (i: number, patch: Partial<GuardianDraft>) =>
    setD((x) => ({
      ...x,
      guardians: x.guardians.map((g, j) => (j === i ? { ...g, ...patch } : g)),
    }));

  async function save() {
    if (!d.name.trim()) return toast.error("Enter the student's name");
    for (const g of d.guardians) {
      if ((g.full_name.trim() || g.phone.trim()) && !normalizePhone(g.phone))
        return toast.error(`Check the phone number for ${g.full_name || "the parent"}`);
      if (g.phone.trim() && !g.full_name.trim()) return toast.error("Enter the parent's name");
    }
    setSaving(true);
    try {
      const row = {
        school_id: schoolId,
        name: d.name.trim(),
        student_code: d.student_code.trim() || null,
        class: d.class.trim() || null,
        photo_url: d.photo_consent ? d.photo_url : null,
        bus_id: d.bus_id || null,
        morning_stop_id: d.morning_stop_id || null,
        home_stop_id: d.morning_stop_id || null,
        afternoon_stop_id: d.afternoon_stop_id || null,
        active: d.active,
        notes: d.notes.trim() || null,
        photo_consent: d.photo_consent,
        biometric_consent: d.biometric_consent,
        consent_recorded_at:
          d.photo_consent || d.biometric_consent ? new Date().toISOString() : null,
      };
      let id = d.id;
      if (id) {
        const { error } = await db.from("students").update(row).eq("id", id);
        if (error) throw error;
      } else {
        const { data, error } = await db.from("students").insert(row).select("id").single();
        if (error) throw error;
        id = (data as { id: string }).id;
      }
      const created = await saveGuardians(schoolId, id!, d.guardians);
      toast.success(d.id ? "Student updated" : "Student added");
      onSaved(created);
    } catch (e) {
      toast.error(friendlyError(e, "Couldn't save the student"));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!d.id) return;
    if (
      !window.confirm(
        `Delete ${d.name}? Their trip history is deleted too. To keep it, untick "Still at this school" instead.`,
      )
    )
      return;
    const { error } = await db.from("students").delete().eq("id", d.id);
    if (error) return toast.error(friendlyError(error, "Couldn't delete"));
    toast.success("Student deleted");
    onSaved([]);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[92dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{d.id ? `Edit ${draft.name}` : "Add a student"}</DialogTitle>
          <DialogDescription>
            Saved once; trip lists are built from this every school day.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <section className="flex gap-4 items-start">
            <button
              type="button"
              onClick={() =>
                d.photo_consent ? fileRef.current?.click() : toast.info("Tick photo consent first")
              }
              className="relative shrink-0 group"
              title="Add photo"
            >
              <StudentAvatar name={d.name || "?"} photo={d.photo_url} size={76} />
              <span className="absolute -bottom-1 -right-1 h-7 w-7 rounded-full bg-primary text-primary-foreground grid place-items-center border-2 border-background">
                <Camera className="h-3.5 w-3.5" />
              </span>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="user"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) set("photo_url", await shrinkPhoto(f));
                e.target.value = "";
              }}
            />
            <div className="grid sm:grid-cols-2 gap-3 flex-1">
              <Field label="Full name">
                <Input
                  value={d.name}
                  onChange={(e) => set("name", e.target.value)}
                  placeholder="Amina Uwase"
                  autoFocus
                />
              </Field>
              <Field label="Class">
                <Input
                  value={d.class}
                  onChange={(e) => set("class", e.target.value)}
                  placeholder="P3 A"
                />
              </Field>
              <Field label="Student number (optional)">
                <Input
                  value={d.student_code}
                  onChange={(e) => set("student_code", e.target.value)}
                  placeholder="KMA-0231"
                />
              </Field>
              <label className="flex items-center gap-2 text-sm self-end h-10">
                <Checkbox checked={d.active} onCheckedChange={(v) => set("active", !!v)} /> Still at
                this school
              </label>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <BusIcon className="h-4 w-4 text-primary" /> Bus and stops
            </h3>
            <div className="grid sm:grid-cols-3 gap-3">
              <Field label="Bus">
                <NativeSelect
                  value={d.bus_id}
                  onChange={(v) =>
                    setD((x) => ({ ...x, bus_id: v, morning_stop_id: "", afternoon_stop_id: "" }))
                  }
                >
                  <option value="">Doesn't ride a bus</option>
                  {buses.map((b) => (
                    <option key={b.id} value={b.id}>
                      {busName(b)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Morning pick-up stop">
                <NativeSelect
                  value={d.morning_stop_id}
                  onChange={(v) => set("morning_stop_id", v)}
                  disabled={!d.bus_id}
                >
                  <option value="">Choose a stop</option>
                  {routeStops.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.sequence ? `${s.sequence}. ` : ""}
                      {s.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Afternoon drop-off stop">
                <NativeSelect
                  value={d.afternoon_stop_id}
                  onChange={(v) => set("afternoon_stop_id", v)}
                  disabled={!d.bus_id}
                >
                  <option value="">Same as morning</option>
                  {routeStops.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.sequence ? `${s.sequence}. ` : ""}
                      {s.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </div>
            {d.bus_id && !bus?.route_id && (
              <p className="text-xs text-warning">
                This bus has no route yet.{" "}
                <Link to="/admin/routes" className="underline">
                  Add its stops
                </Link>{" "}
                first.
              </p>
            )}
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" /> Parents ({d.guardians.length}/2)
            </h3>
            {d.guardians.map((g, i) => {
              const known = guardians.find((x) => x.phone === normalizePhone(g.phone));
              return (
                <div key={i} className="rounded-xl border border-border p-3 space-y-3">
                  <div className="grid sm:grid-cols-[1.4fr_1.2fr_1fr_auto] gap-3 items-end">
                    <Field label={i === 0 ? "Main parent" : "Second parent"}>
                      <Input
                        value={g.full_name}
                        onChange={(e) => setGuardian(i, { full_name: e.target.value })}
                        placeholder="Full name"
                      />
                    </Field>
                    <Field label="Phone">
                      <Input
                        value={g.phone}
                        onChange={(e) => setGuardian(i, { phone: e.target.value })}
                        onBlur={() => {
                          const k = guardians.find((x) => x.phone === normalizePhone(g.phone));
                          if (k && !g.full_name)
                            setGuardian(i, {
                              full_name: k.full_name,
                              relationship: k.relationship ?? "",
                            });
                        }}
                        inputMode="tel"
                        placeholder="0788 123 456"
                      />
                    </Field>
                    <Field label="Relationship">
                      <NativeSelect
                        value={g.relationship}
                        onChange={(v) => setGuardian(i, { relationship: v })}
                      >
                        {["Mother", "Father", "Guardian", "Grandparent", "Other"].map((r) => (
                          <option key={r}>{r}</option>
                        ))}
                      </NativeSelect>
                    </Field>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Remove"
                      onClick={() =>
                        setD((x) => ({ ...x, guardians: x.guardians.filter((_, j) => j !== i) }))
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  {known && (
                    <p className="text-[11px] text-muted-foreground">
                      Already registered{known.user_id ? " and using the app" : ""} — this child
                      will be added to the same account.
                    </p>
                  )}
                </div>
              );
            })}
            {d.guardians.length < 2 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setD((x) => ({
                    ...x,
                    guardians: [
                      ...x.guardians,
                      { full_name: "", phone: "", relationship: "Father" },
                    ],
                  }))
                }
              >
                <Plus className="h-4 w-4 mr-1" /> Add a parent
              </Button>
            )}
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Consent (signed by the parent)</h3>
            <label className="flex items-start gap-2 text-sm">
              <Checkbox
                className="mt-0.5"
                checked={d.photo_consent}
                onCheckedChange={(v) => set("photo_consent", !!v)}
              />
              <span>
                Photo — shown to the bus attendant at check-in.
                <span className="block text-xs text-muted-foreground">
                  Without consent, no photo is stored.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <Checkbox
                className="mt-0.5"
                checked={d.biometric_consent}
                onCheckedChange={(v) => set("biometric_consent", !!v)}
              />
              <span>
                Fingerprint check-in{" "}
                <Pill tone="warning" className="ml-1">
                  Under construction
                </Pill>
                <span className="block text-xs text-muted-foreground">
                  Recorded now, used when the readers are installed. The child is never refused the
                  bus without it.
                </span>
              </span>
            </label>
            <Field label="Notes for the attendant (optional)">
              <Input
                value={d.notes}
                onChange={(e) => set("notes", e.target.value)}
                placeholder="e.g. asthma inhaler in bag"
              />
            </Field>
          </section>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {d.id ? (
            <Button variant="ghost" className="text-destructive" onClick={remove}>
              <Trash2 className="h-4 w-4 mr-1.5" /> Delete
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving} className="bg-gradient-primary">
              {saving ? "Saving…" : "Save student"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Temporary change ─────────────────────────────────────────────────────────

interface OverrideRow {
  id: string;
  from_date: string;
  to_date: string;
  bus_id: string | null;
  morning_stop_id: string | null;
  afternoon_stop_id: string | null;
  note: string | null;
}

function OverrideDialog({
  student,
  schoolId,
  buses,
  stops,
  onClose,
}: {
  student: StudentRow;
  schoolId: string;
  buses: BusLite[];
  stops: StopRow[];
  onClose: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [rows, setRows] = useState<OverrideRow[]>([]);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [busId, setBusId] = useState(student.bus_id ?? "");
  const [am, setAm] = useState("");
  const [pm, setPm] = useState("");
  const [note, setNote] = useState("");
  const load = () =>
    db
      .from("student_transport_overrides")
      .select("*")
      .eq("student_id", student.id)
      .gte("to_date", today)
      .order("from_date")
      .then(({ data }) => setRows((data ?? []) as OverrideRow[]));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const bus = buses.find((b) => b.id === busId);
  const routeStops = stops.filter(
    (s) => s.type !== "school" && (!bus?.route_id || s.route_id === bus.route_id),
  );

  async function add() {
    if (to < from) return toast.error("The end date is before the start date");
    const { error } = await db.from("student_transport_overrides").insert({
      school_id: schoolId,
      student_id: student.id,
      from_date: from,
      to_date: to,
      bus_id: busId || null,
      morning_stop_id: am || null,
      afternoon_stop_id: pm || null,
      note: note.trim() || null,
    });
    if (error) return toast.error(friendlyError(error, "Couldn't save"));
    toast.success("Temporary change saved");
    setNote("");
    void load();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Temporary change for {student.name}</DialogTitle>
          <DialogDescription>
            e.g. staying with grandparents for a week. Trip lists follow it on those days, then go
            back to normal.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {rows.map((r) => (
            <div
              key={r.id}
              className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm"
            >
              <div>
                <div className="font-medium">
                  {r.from_date} → {r.to_date}
                </div>
                <div className="text-xs text-muted-foreground">
                  {busName(buses.find((b) => b.id === r.bus_id))} ·{" "}
                  {stops.find((s) => s.id === r.morning_stop_id)?.name ?? "usual stop"}
                  {r.note ? ` · ${r.note}` : ""}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={async () => {
                  await db.from("student_transport_overrides").delete().eq("id", r.id);
                  void load();
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <div className="grid grid-cols-2 gap-3">
            <Field label="From">
              <Input
                type="date"
                value={from}
                min={today}
                onChange={(e) => setFrom(e.target.value)}
              />
            </Field>
            <Field label="To">
              <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
            </Field>
            <Field label="Bus">
              <NativeSelect value={busId} onChange={setBusId}>
                {buses.map((b) => (
                  <option key={b.id} value={b.id}>
                    {busName(b)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Note">
              <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="At grandma's"
              />
            </Field>
            <Field label="Morning stop">
              <NativeSelect value={am} onChange={setAm}>
                <option value="">Usual</option>
                {routeStops.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Afternoon stop">
              <NativeSelect value={pm} onChange={setPm}>
                <option value="">Usual</option>
                {routeStops.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button onClick={add}>Save change</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── CSV import ───────────────────────────────────────────────────────────────

const CSV_HEADER =
  "name,class,student_code,bus,morning_stop,afternoon_stop,parent1_name,parent1_phone,parent2_name,parent2_phone";

function ImportDialog({
  schoolId,
  buses,
  stops,
  onClose,
  onDone,
}: {
  schoolId: string;
  buses: BusLite[];
  stops: StopRow[];
  onClose: () => void;
  onDone: (newCodes: Guardian[]) => void;
}) {
  const [rows, setRows] = useState<string[][] | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const header = rows?.[0]?.map((h) => h.toLowerCase().replace(/\s+/g, "_")) ?? [];
  const col = (r: string[], k: string) => r[header.indexOf(k)]?.trim() ?? "";
  const findBus = (v: string) =>
    buses.find((b) => [b.label, b.plate].some((x) => x && x.toLowerCase() === v.toLowerCase()));
  const findStop = (v: string, routeId: string | null | undefined) =>
    stops.find(
      (s) => s.name.toLowerCase() === v.toLowerCase() && (!routeId || s.route_id === routeId),
    );
  const body = rows?.slice(1) ?? [];
  const problems = body
    .map((r, i) => {
      const p: string[] = [];
      if (!col(r, "name")) p.push("no name");
      const b = col(r, "bus");
      if (b && !findBus(b)) p.push(`bus "${b}" not found`);
      const ph = col(r, "parent1_phone");
      if (ph && !normalizePhone(ph)) p.push(`phone "${ph}"`);
      return p.length ? `Row ${i + 2}: ${p.join(", ")}` : null;
    })
    .filter(Boolean) as string[];

  async function run() {
    setBusy(true);
    const created: Guardian[] = [];
    let n = 0;
    try {
      for (const r of body) {
        if (!col(r, "name")) continue;
        const bus = col(r, "bus") ? findBus(col(r, "bus")) : undefined;
        const am = col(r, "morning_stop")
          ? findStop(col(r, "morning_stop"), bus?.route_id)
          : undefined;
        const pm = col(r, "afternoon_stop")
          ? findStop(col(r, "afternoon_stop"), bus?.route_id)
          : undefined;
        const { data, error } = await db
          .from("students")
          .insert({
            school_id: schoolId,
            name: col(r, "name"),
            class: col(r, "class") || null,
            student_code: col(r, "student_code") || null,
            bus_id: bus?.id ?? null,
            morning_stop_id: am?.id ?? null,
            home_stop_id: am?.id ?? null,
            afternoon_stop_id: pm?.id ?? null,
          })
          .select("id")
          .single();
        if (error) throw error;
        created.push(
          ...(await saveGuardians(schoolId, (data as { id: string }).id, [
            { full_name: col(r, "parent1_name"), phone: col(r, "parent1_phone"), relationship: "" },
            { full_name: col(r, "parent2_name"), phone: col(r, "parent2_phone"), relationship: "" },
          ])),
        );
        n++;
        setProgress(n);
      }
      toast.success(`${n} students imported`);
      onDone(created);
    } catch (e) {
      toast.error(friendlyError(e, `Stopped after ${n} students`));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Import students from a CSV file</DialogTitle>
          <DialogDescription>
            Export from Excel or your school system as CSV with these columns (first row = headers).
            Bus and stop names must match the ones in Live Track.
          </DialogDescription>
        </DialogHeader>
        <code className="block text-[11px] bg-muted rounded-lg p-3 break-all">{CSV_HEADER}</code>
        <Button
          variant="outline"
          size="sm"
          className="w-fit"
          onClick={() => {
            const blob = new Blob(
              [
                `${CSV_HEADER}\nAmina Uwase,P3 A,KMA-0231,Bus A,Kimironko,,Grace Uwase,0788123456,,\n`,
              ],
              {
                type: "text/csv",
              },
            );
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = "students-template.csv";
            a.click();
          }}
        >
          Download a template
        </Button>
        <Input
          type="file"
          accept=".csv,text/csv"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) setRows(parseCsv(await f.text()));
          }}
        />
        {rows && (
          <div className="text-sm space-y-1">
            <div>
              <b>{body.length}</b> students found.
            </div>
            {!header.includes("name") && (
              <div className="text-destructive">The first row must contain a "name" column.</div>
            )}
            {problems.slice(0, 6).map((p) => (
              <div key={p} className="text-warning text-xs">
                {p}
              </div>
            ))}
            {problems.length > 6 && (
              <div className="text-xs text-warning">…and {problems.length - 6} more</div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={run} disabled={busy || !body.length || !header.includes("name")}>
            {busy ? `Importing ${progress}/${body.length}…` : `Import ${body.length} students`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
