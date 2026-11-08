import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ShieldAlert, CheckCircle2, Phone } from "lucide-react";
import { AppShell, PageHeader, useCurrentSchool } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import {
  EmptyState,
  Loading,
  MigrationNotice,
  Panel,
  Pill,
  StudentAvatar,
} from "@/components/school/ui";
import { db } from "@/lib/fleet";
import { friendlyError } from "@/lib/friendly-errors";
import { formatPhone, telLink } from "@/lib/phone";
import {
  ALERT_KIND_LABEL,
  busName,
  isMissingTable,
  type BusLite,
  type SchoolAlert,
  type StudentRow,
} from "@/lib/school";
import { fmtDateTime } from "@/lib/time";

export const Route = createFileRoute("/admin/incidents")({
  head: () => ({ meta: [{ title: "Safety alerts — Live Track" }] }),
  component: () => (
    <AppShell>
      <IncidentsPage />
    </AppShell>
  ),
});

function IncidentsPage() {
  const { schoolId } = useCurrentSchool();
  const [tab, setTab] = useState<"open" | "resolved">("open");
  const [list, setList] = useState<SchoolAlert[] | null>(null);
  const [students, setStudents] = useState<Map<string, StudentRow>>(new Map());
  const [buses, setBuses] = useState<Map<string, BusLite>>(new Map());
  const [phones, setPhones] = useState<Map<string, { name: string; phone: string }[]>>(new Map());
  const [missing, setMissing] = useState(false);

  async function load() {
    if (!schoolId) return;
    let q = db
      .from("school_alerts")
      .select("*")
      .eq("school_id", schoolId)
      .order("created_at", { ascending: false })
      .limit(200);
    q = tab === "open" ? q.is("resolved_at", null) : q.not("resolved_at", "is", null);
    const [a, s, b] = await Promise.all([
      q,
      db.from("students").select("id, name, class, photo_url").eq("school_id", schoolId),
      db.from("buses").select("*").eq("school_id", schoolId),
    ]);
    if (isMissingTable(a.error)) return setMissing(true);
    const alerts = (a.data ?? []) as SchoolAlert[];
    setList(alerts);
    setStudents(new Map(((s.data ?? []) as StudentRow[]).map((x) => [x.id, x])));
    setBuses(new Map(((b.data ?? []) as BusLite[]).map((x) => [x.id, x])));
    const ids = [...new Set(alerts.map((x) => x.student_id).filter(Boolean) as string[])];
    if (ids.length) {
      const { data } = await db
        .from("student_guardians")
        .select("student_id, guardians(full_name, phone)")
        .in("student_id", ids);
      const m = new Map<string, { name: string; phone: string }[]>();
      for (const r of (data ?? []) as unknown as {
        student_id: string;
        guardians: { full_name: string; phone: string } | null;
      }[]) {
        if (r.guardians)
          m.set(r.student_id, [
            ...(m.get(r.student_id) ?? []),
            { name: r.guardians.full_name, phone: r.guardians.phone },
          ]);
      }
      setPhones(m);
    }
  }
  useEffect(() => {
    if (schoolId) void db.rpc("check_open_trips");
    void load();
    const ch = db
      .channel(`incidents:${schoolId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "school_alerts",
          filter: `school_id=eq.${schoolId}`,
        },
        () => void load(),
      )
      .subscribe();
    return () => void db.removeChannel(ch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId, tab]);

  if (missing)
    return (
      <>
        <PageHeader title="Safety alerts" />
        <MigrationNotice />
      </>
    );

  return (
    <>
      <PageHeader
        title="Safety alerts"
        description="Wrong bus, a child left at school or on the bus, a drop-off far from home, accidents and breakdowns. Call the parent, then mark it handled."
      />
      <div className="flex gap-2 mb-4">
        {(["open", "resolved"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`h-9 px-4 rounded-full text-sm font-medium border ${tab === t ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground"}`}
          >
            {t === "open" ? "Needs attention" : "Handled"}
          </button>
        ))}
      </div>
      <Panel bodyClassName="p-0">
        {list == null ? (
          <Loading />
        ) : list.length === 0 ? (
          <EmptyState
            Icon={tab === "open" ? CheckCircle2 : ShieldAlert}
            title={tab === "open" ? "All clear" : "Nothing handled yet"}
          >
            {tab === "open" ? "No child needs attention right now." : undefined}
          </EmptyState>
        ) : (
          <ul className="divide-y divide-border">
            {list.map((a) => {
              const s = a.student_id ? students.get(a.student_id) : null;
              const parents = a.student_id ? (phones.get(a.student_id) ?? []) : [];
              return (
                <li
                  key={a.id}
                  className="px-4 sm:px-5 py-4 flex flex-col sm:flex-row gap-3 sm:items-center"
                >
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    {s ? (
                      <StudentAvatar name={s.name} photo={s.photo_url} size={40} />
                    ) : (
                      <div className="h-10 w-10 rounded-full bg-destructive/12 text-destructive grid place-items-center">
                        <ShieldAlert className="h-5 w-5" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Pill tone={a.severity === "urgent" ? "danger" : "warning"}>
                          {ALERT_KIND_LABEL[a.kind] ?? a.kind}
                        </Pill>
                        <span className="text-xs text-muted-foreground">
                          {fmtDateTime(a.created_at)}
                          {a.bus_id ? ` · ${busName(buses.get(a.bus_id))}` : ""}
                        </span>
                      </div>
                      <p className="text-sm mt-1">{a.message}</p>
                      {parents.length > 0 && (
                        <div className="flex flex-wrap gap-3 mt-1.5">
                          {parents.map((p) => (
                            <a
                              key={p.phone}
                              href={telLink(p.phone)}
                              className="text-xs text-primary inline-flex items-center gap-1 hover:underline"
                            >
                              <Phone className="h-3 w-3" /> {p.name} {formatPhone(p.phone)}
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  {tab === "open" && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        const { error } = await db.rpc("resolve_school_alert", { p_id: a.id });
                        if (error) return toast.error(friendlyError(error, "Couldn't update"));
                        toast.success("Marked as handled");
                        void load();
                      }}
                    >
                      <CheckCircle2 className="h-4 w-4 mr-1.5" /> Handled
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </>
  );
}
