import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ListChecks, CheckCheck, Search } from "lucide-react";
import { AppShell, PageHeader, useCurrentSchool } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  EmptyState,
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
import {
  compareWithRegister,
  kigaliDate,
  needsAction,
  REGISTER_META,
  type RegisterResult,
  type RiderStatus,
} from "@/lib/attendance";
import { isMissingTable, type StudentRow } from "@/lib/school";

export const Route = createFileRoute("/admin/register")({
  head: () => ({ meta: [{ title: "Class register — Live Track" }] }),
  component: () => (
    <AppShell>
      <RegisterPage />
    </AppShell>
  ),
});

function RegisterPage() {
  const { schoolId } = useCurrentSchool();
  const [date, setDate] = useState(kigaliDate());
  const [students, setStudents] = useState<StudentRow[] | null>(null);
  const [present, setPresent] = useState<Map<string, boolean>>(new Map());
  const [bus, setBus] = useState<Map<string, RiderStatus>>(new Map());
  const [cls, setCls] = useState("all");
  const [filter, setFilter] = useState<"all" | "action">("all");
  const [q, setQ] = useState("");
  const [missing, setMissing] = useState(false);

  async function load() {
    if (!schoolId) return;
    const [s, r, t] = await Promise.all([
      db.from("students").select("*").eq("school_id", schoolId).eq("active", true).order("name"),
      db
        .from("class_register")
        .select("student_id, present")
        .eq("school_id", schoolId)
        .eq("service_date", date),
      db
        .from("trip_students")
        .select("student_id, status, bus_trips!inner(run, service_date, school_id)")
        .eq("bus_trips.school_id", schoolId)
        .eq("bus_trips.service_date", date)
        .eq("bus_trips.run", "morning"),
    ]);
    if (isMissingTable(r.error)) return setMissing(true);
    setStudents((s.data ?? []) as StudentRow[]);
    setPresent(
      new Map(
        ((r.data ?? []) as { student_id: string; present: boolean }[]).map((x) => [
          x.student_id,
          x.present,
        ]),
      ),
    );
    setBus(
      new Map(
        ((t.data ?? []) as { student_id: string; status: RiderStatus }[]).map((x) => [
          x.student_id,
          x.status,
        ]),
      ),
    );
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId, date]);

  async function setMark(ids: string[], value: boolean) {
    if (!schoolId || !ids.length) return;
    const prev = present;
    setPresent((m) => {
      const n = new Map(m);
      ids.forEach((id) => n.set(id, value));
      return n;
    });
    const { error } = await db.from("class_register").upsert(
      ids.map((student_id) => ({
        school_id: schoolId,
        student_id,
        service_date: date,
        present: value,
        marked_at: new Date().toISOString(),
      })),
    );
    if (error) {
      setPresent(prev);
      toast.error(friendlyError(error, "Couldn't save"));
    }
  }

  const classes = useMemo(
    () => [...new Set((students ?? []).map((s) => s.class).filter(Boolean) as string[])].sort(),
    [students],
  );
  const rows = (students ?? [])
    .filter((s) => cls === "all" || s.class === cls)
    .filter((s) => !q.trim() || s.name.toLowerCase().includes(q.trim().toLowerCase()))
    .map((s) => ({
      s,
      result: compareWithRegister(bus.get(s.id) ?? null, present.get(s.id) ?? null),
    }))
    .filter((r) => filter === "all" || needsAction(r.result));

  const all = (students ?? []).map((s) =>
    compareWithRegister(bus.get(s.id) ?? null, present.get(s.id) ?? null),
  );
  const count = (f: (r: RegisterResult) => boolean) => all.filter(f).length;

  if (missing)
    return (
      <>
        <PageHeader title="Class register" />
        <MigrationNotice />
      </>
    );

  return (
    <>
      <PageHeader
        title="Class register"
        description="Tick who is in class. Live Track compares it with the morning bus: a child is only “missing” if they're neither on the bus nor in class."
        actions={
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value || kigaliDate())}
            className="w-auto"
          />
        }
      />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
        <StatCard
          label="In class"
          value={count((r) => ["ok", "came_by_car", "came_another_way", "not_on_bus"].includes(r))}
          tone="success"
        />
        <StatCard
          label="Absent, excused"
          value={count((r) => r === "absent_excused")}
          tone="muted"
        />
        <StatCard
          label="Check now"
          value={count(needsAction)}
          hint="Not on the bus, not in class"
          tone={count(needsAction) ? "danger" : "neutral"}
        />
        <StatCard label="Not ticked yet" value={count((r) => r === "unknown")} tone="info" />
      </div>
      <Panel bodyClassName="p-0">
        <div className="p-4 sm:p-5 flex flex-col lg:flex-row gap-3 border-b border-border">
          <div className="relative flex-1">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Find a student"
              className="pl-9"
            />
          </div>
          <div className="grid grid-cols-2 sm:flex gap-2">
            <NativeSelect value={cls} onChange={setCls} className="sm:w-36">
              <option value="all">All classes</option>
              {classes.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </NativeSelect>
            <NativeSelect
              value={filter}
              onChange={(v) => setFilter(v as typeof filter)}
              className="sm:w-44"
            >
              <option value="all">Everyone</option>
              <option value="action">Needs action</option>
            </NativeSelect>
            <Button
              variant="outline"
              className="col-span-2"
              onClick={() =>
                void setMark(
                  rows.filter((r) => !present.has(r.s.id)).map((r) => r.s.id),
                  true,
                )
              }
            >
              <CheckCheck className="h-4 w-4 mr-1.5" /> Rest are present
            </Button>
          </div>
        </div>
        {students == null ? (
          <Loading />
        ) : rows.length === 0 ? (
          <EmptyState Icon={ListChecks} title="Nobody to show" />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map(({ s, result }) => {
              const meta = REGISTER_META[result];
              const p = present.get(s.id);
              return (
                <li key={s.id} className="flex items-center gap-3 px-4 sm:px-5 py-2.5">
                  <StudentAvatar name={s.name} photo={s.photo_url} size={34} />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">{s.name}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {s.class ?? ""} {meta.hint ? `· ${meta.hint}` : ""}
                    </div>
                  </div>
                  <Pill tone={meta.tone} className="hidden sm:inline-flex">
                    {meta.label}
                  </Pill>
                  <div className="flex rounded-lg border border-border overflow-hidden shrink-0">
                    <button
                      onClick={() => void setMark([s.id], true)}
                      className={`h-9 px-3 text-sm ${p === true ? "bg-success text-white" : "hover:bg-accent"}`}
                    >
                      Present
                    </button>
                    <button
                      onClick={() => void setMark([s.id], false)}
                      className={`h-9 px-3 text-sm border-l border-border ${p === false ? "bg-destructive text-white" : "hover:bg-accent"}`}
                    >
                      Absent
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </>
  );
}
