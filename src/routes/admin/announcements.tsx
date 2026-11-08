import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Megaphone, Send } from "lucide-react";
import { AppShell, PageHeader, useCurrentSchool } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  EmptyState,
  Field,
  Loading,
  MigrationNotice,
  NativeSelect,
  Panel,
  Pill,
} from "@/components/school/ui";
import { db } from "@/lib/fleet";
import { friendlyError } from "@/lib/friendly-errors";
import { busName, isMissingTable, type Announcement, type BusLite } from "@/lib/school";
import { fmtDateTime } from "@/lib/time";

export const Route = createFileRoute("/admin/announcements")({
  head: () => ({ meta: [{ title: "Announcements — Live Track" }] }),
  component: () => (
    <AppShell>
      <AnnouncementsPage />
    </AppShell>
  ),
});

const KIND_LABEL: Record<string, string> = {
  traffic: "Traffic",
  late: "Late",
  accident: "Accident",
  breakdown: "Breakdown",
  custom: "From the bus",
  school: "From the school",
};

function AnnouncementsPage() {
  const { schoolId } = useCurrentSchool();
  const [list, setList] = useState<Announcement[] | null>(null);
  const [buses, setBuses] = useState<BusLite[]>([]);
  const [to, setTo] = useState("all");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [missing, setMissing] = useState(false);

  async function load() {
    if (!schoolId) return;
    const [a, b] = await Promise.all([
      db
        .from("announcements")
        .select("*")
        .eq("school_id", schoolId)
        .order("created_at", { ascending: false })
        .limit(100),
      db.from("buses").select("*").eq("school_id", schoolId).order("label"),
    ]);
    if (isMissingTable(a.error)) return setMissing(true);
    setList((a.data ?? []) as Announcement[]);
    setBuses((b.data ?? []) as BusLite[]);
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId]);

  async function send() {
    if (!msg.trim()) return toast.error("Write a message");
    setBusy(true);
    const { error } = await db.rpc("post_announcement", {
      p_school: schoolId,
      p_bus: to === "all" ? null : to,
      p_kind: to === "all" ? "school" : "custom",
      p_delay_min: null,
      p_message: msg.trim(),
    });
    setBusy(false);
    if (error) return toast.error(friendlyError(error, "Couldn't send"));
    toast.success("Sent");
    setMsg("");
    void load();
  }

  if (missing)
    return (
      <>
        <PageHeader title="Announcements" />
        <MigrationNotice />
      </>
    );

  return (
    <>
      <PageHeader
        title="Announcements"
        description="Message the parents of one bus or of the whole school. They get it as a phone notification and in the app."
      />
      <div className="grid gap-5 lg:grid-cols-[400px_1fr]">
        <Panel title="New message" className="h-fit">
          <div className="space-y-3">
            <Field label="To">
              <NativeSelect value={to} onChange={setTo}>
                <option value="all">All parents of the school</option>
                {buses.map((b) => (
                  <option key={b.id} value={b.id}>
                    Parents on {busName(b)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Message" hint={`${msg.length}/300`}>
              <Textarea
                value={msg}
                onChange={(e) => setMsg(e.target.value.slice(0, 300))}
                rows={5}
                placeholder="e.g. School closes at 12:00 on Friday. Buses leave at 12:15."
              />
            </Field>
            <Button
              className="w-full bg-gradient-primary"
              onClick={send}
              disabled={busy || !msg.trim()}
            >
              <Send className="h-4 w-4 mr-1.5" /> {busy ? "Sending…" : "Send"}
            </Button>
          </div>
        </Panel>
        <Panel title="Sent" description="From the school and from the buses">
          {list == null ? (
            <Loading />
          ) : list.length === 0 ? (
            <EmptyState Icon={Megaphone} title="No messages yet" />
          ) : (
            <ul className="divide-y divide-border -my-2">
              {list.map((a) => (
                <li key={a.id} className="py-3">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Pill
                      tone={
                        a.kind === "accident" || a.kind === "breakdown"
                          ? "danger"
                          : a.kind === "school"
                            ? "info"
                            : "neutral"
                      }
                    >
                      {KIND_LABEL[a.kind] ?? a.kind}
                    </Pill>
                    {a.bus_id ? busName(buses.find((b) => b.id === a.bus_id)) : "Whole school"} ·{" "}
                    {fmtDateTime(a.created_at)} · {a.recipients} parent
                    {a.recipients === 1 ? "" : "s"}
                  </div>
                  <p className="mt-1 text-sm">{a.message}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
