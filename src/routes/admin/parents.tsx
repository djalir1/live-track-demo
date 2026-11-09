import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Search, Users, KeyRound, RefreshCw, Phone, CheckCircle2, Clock, Copy } from "lucide-react";
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
import { formatPhone, telLink } from "@/lib/phone";
import { isMissingTable, type Guardian, type StudentGuardian, type StudentRow } from "@/lib/school";

export const Route = createFileRoute("/admin/parents")({
  validateSearch: (s: Record<string, unknown>): { q?: string } => ({
    q: typeof s.q === "string" ? s.q : undefined,
  }),
  head: () => ({ meta: [{ title: "Parents — Live Track" }] }),
  component: () => (
    <AppShell>
      <ParentsPage />
    </AppShell>
  ),
});

function ParentsPage() {
  const { schoolId } = useCurrentSchool();
  const [guardians, setGuardians] = useState<Guardian[] | null>(null);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [links, setLinks] = useState<StudentGuardian[]>([]);
  const [missing, setMissing] = useState(false);
  const search = Route.useSearch();
  const [q, setQ] = useState(search.q ?? "");
  useEffect(() => {
    if (search.q != null) setQ(search.q);
  }, [search.q]);
  const [state, setState] = useState("all");

  async function load() {
    if (!schoolId) return;
    const [g, s, l] = await Promise.all([
      db.from("guardians").select("*").eq("school_id", schoolId).order("full_name"),
      db.from("students").select("id, name, class, photo_url, active").eq("school_id", schoolId),
      db.from("student_guardians").select("student_id, guardian_id, is_primary"),
    ]);
    if (isMissingTable(g.error)) return setMissing(true);
    if (g.error) toast.error(friendlyError(g.error, "Couldn't load parents"));
    setGuardians((g.data ?? []) as Guardian[]);
    setStudents((s.data ?? []) as StudentRow[]);
    setLinks((l.data ?? []) as StudentGuardian[]);
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId]);

  const studentById = useMemo(() => new Map(students.map((s) => [s.id, s])), [students]);
  const kidsOf = useMemo(() => {
    const m = new Map<string, StudentRow[]>();
    for (const l of links) {
      const s = studentById.get(l.student_id);
      if (s) m.set(l.guardian_id, [...(m.get(l.guardian_id) ?? []), s]);
    }
    return m;
  }, [links, studentById]);

  const list = (guardians ?? []).filter((g) => {
    if (state === "active" && !g.user_id) return false;
    if (state === "pending" && g.user_id) return false;
    const n = q.trim().toLowerCase();
    if (!n) return true;
    return (
      g.full_name.toLowerCase().includes(n) ||
      g.phone.includes(n.replace(/\D/g, "") || "~") ||
      (kidsOf.get(g.id) ?? []).some((k) => k.name.toLowerCase().includes(n))
    );
  });
  const total = guardians?.length ?? 0;
  const active = (guardians ?? []).filter((g) => g.user_id).length;

  async function newCode(g: Guardian) {
    const msg = g.user_id
      ? `Give ${g.full_name} a new code? They use it to choose a new password (if they forgot it).`
      : `Give ${g.full_name} a new activation code? The old one stops working.`;
    if (!window.confirm(msg)) return;
    const { data, error } = await db.rpc("issue_activation_code", { p_kind: "parent", p_id: g.id });
    if (error) return toast.error(friendlyError(error, "Couldn't create a code"));
    toast.success(`New code for ${g.full_name}: ${data}`);
    void load();
  }

  function shareText(g: Guardian) {
    return `Hello ${g.full_name}, follow your child's school bus on Live Track: open ${window.location.origin}/parent, tap "First time here?", enter ${formatPhone(g.phone)} and the code ${g.activation_code}, then choose your password.`;
  }

  if (missing)
    return (
      <>
        <PageHeader title="Parents" />
        <MigrationNotice />
      </>
    );

  return (
    <>
      <PageHeader
        title="Parents"
        description="Parents are added with their child on the Students page. Here you hand out activation codes and reset forgotten passwords."
      />
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 mb-6">
        <StatCard label="Parents registered" value={total} Icon={Users} tone="info" />
        <StatCard
          label="Using the app"
          value={active}
          hint={`${total ? Math.round((active / total) * 100) : 0}% activated`}
          Icon={CheckCircle2}
          tone="success"
        />
        <StatCard
          label="Waiting to activate"
          value={total - active}
          hint="Share their code"
          Icon={Clock}
          tone="warning"
        />
      </div>

      <Panel bodyClassName="p-0">
        <div className="p-4 sm:p-5 flex flex-col sm:flex-row gap-3 border-b border-border">
          <div className="relative flex-1">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by parent, phone or child"
              className="pl-9"
            />
          </div>
          <NativeSelect value={state} onChange={setState} className="sm:w-48">
            <option value="all">Everyone</option>
            <option value="pending">Waiting to activate</option>
            <option value="active">Using the app</option>
          </NativeSelect>
        </div>
        {guardians == null ? (
          <Loading />
        ) : list.length === 0 ? (
          <EmptyState Icon={Users} title={total ? "No parent matches" : "No parents yet"}>
            {total
              ? "Try another search."
              : "Add parents together with their children on the Students page."}
          </EmptyState>
        ) : (
          <ul className="divide-y divide-border">
            {list.map((g) => {
              const kids = kidsOf.get(g.id) ?? [];
              const expired =
                g.activation_expires_at && new Date(g.activation_expires_at) < new Date();
              return (
                <li
                  key={g.id}
                  className="px-4 sm:px-5 py-3.5 flex flex-col sm:flex-row sm:items-center gap-3"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="h-10 w-10 rounded-full bg-primary/12 text-primary grid place-items-center font-semibold text-sm shrink-0">
                      {g.full_name.slice(0, 1).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium flex items-center gap-2 flex-wrap">
                        {g.full_name}
                        {g.relationship && (
                          <span className="text-xs text-muted-foreground">{g.relationship}</span>
                        )}
                        {g.user_id ? (
                          <Pill tone="success">App active</Pill>
                        ) : (
                          <Pill tone="warning">Not activated</Pill>
                        )}
                      </div>
                      <a
                        href={telLink(g.phone)}
                        className="text-xs text-muted-foreground hover:text-primary inline-flex items-center gap-1"
                      >
                        <Phone className="h-3 w-3" /> {formatPhone(g.phone)}
                      </a>
                    </div>
                  </div>
                  <div className="flex items-center -space-x-2 sm:w-40">
                    {kids.map((k) => (
                      <span key={k.id} title={`${k.name}${k.class ? ` · ${k.class}` : ""}`}>
                        <StudentAvatar
                          name={k.name}
                          photo={k.photo_url}
                          size={30}
                          className="ring-2 ring-card"
                        />
                      </span>
                    ))}
                    <span className="pl-3 text-xs text-muted-foreground truncate">
                      {kids.length === 1 ? kids[0].name : `${kids.length} children`}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 sm:justify-end sm:w-72">
                    {g.activation_code && (
                      <span
                        className={`font-mono text-base font-bold tracking-[0.18em] ${expired ? "text-muted-foreground line-through" : "text-primary"}`}
                        title={expired ? "Expired" : "Activation code"}
                      >
                        {g.activation_code}
                      </span>
                    )}
                    {g.activation_code && !expired && (
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Copy invitation message"
                        onClick={() => {
                          void navigator.clipboard.writeText(shareText(g));
                          toast.success("Invitation copied — paste it into WhatsApp or SMS");
                        }}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    )}
                    <Button variant="outline" size="sm" onClick={() => newCode(g)}>
                      {g.user_id ? (
                        <KeyRound className="h-4 w-4 mr-1.5" />
                      ) : (
                        <RefreshCw className="h-4 w-4 mr-1.5" />
                      )}
                      {g.user_id ? "Reset password" : "New code"}
                    </Button>
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
