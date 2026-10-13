import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Loader2, Trash2, Copy, Ticket, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AdminShell } from "@/components/AdminShell";
import { supabase } from "@/integrations/supabase/client";
import { friendlyError } from "@/lib/friendly-errors";
import { PARENTS_ENABLED } from "@/lib/features";
import { ComingSoon } from "@/components/ComingSoon";

export const Route = createFileRoute("/admin/invites")({
  head: () => ({ meta: [{ title: "Invites — School setup — Live Track" }] }),
  component: () => (PARENTS_ENABLED ? <InvitesPage /> : <ComingSoon title="Parent invites are coming soon" description="Student rosters and parent invite codes will return when parent access opens." />),
});

// Unambiguous alphabet: no 0/O, no 1/I/L (spec).
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CODE_LENGTH = 8;

function makeCode(): string {
  const buf = new Uint32Array(CODE_LENGTH);
  crypto.getRandomValues(buf);
  let out = "";
  for (const n of buf) out += CODE_ALPHABET[n % CODE_ALPHABET.length];
  return out;
}

interface StudentRow { id: string; name: string; class: string | null; bus_id: string | null; }
interface BusRow { id: string; label: string | null; plate: string | null; }
interface InviteRow {
  id: string; school_id: string; code: string; phone: string | null;
  student_ids: string[]; expires_at: string | null; used_at: string | null; created_at: string;
}

function InvitesPage() {
  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [buses, setBuses] = useState<BusRow[]>([]);
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [busy, setBusy] = useState(false);

  // form
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [phone, setPhone] = useState("");
  const [expires, setExpires] = useState<string>(""); // yyyy-MM-ddTHH:mm
  const [saving, setSaving] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  useEffect(() => { void bootstrap(); }, []);

  async function bootstrap() {
    setBusy(true);
    try {
      const { data: schools, error: sErr } = await supabase.from("schools").select("id").limit(1);
      if (sErr) throw sErr;
      const sid = schools?.[0]?.id ?? null;
      setSchoolId(sid);
      if (!sid) return;
      const [studentsRes, busesRes, invitesRes] = await Promise.all([
        supabase.from("students").select("id, name, class, bus_id").eq("school_id", sid).order("name"),
        supabase.from("buses").select("id, label, plate").eq("school_id", sid),
        supabase.from("invites").select("*").eq("school_id", sid).order("created_at", { ascending: false }),
      ]);
      if (studentsRes.error) throw studentsRes.error;
      if (busesRes.error) throw busesRes.error;
      if (invitesRes.error) throw invitesRes.error;
      setStudents((studentsRes.data ?? []) as StudentRow[]);
      setBuses((busesRes.data ?? []) as BusRow[]);
      setInvites((invitesRes.data ?? []) as InviteRow[]);
    } catch (e) {
      toast.error(friendlyError(e, "Couldn't load invites right now."));
    } finally { setBusy(false); }
  }

  const busName = (id: string | null) => {
    const b = buses.find((x) => x.id === id);
    if (!b) return "—";
    return b.label ?? b.plate ?? "Bus";
  };
  const studentName = (id: string) => students.find((s) => s.id === id)?.name ?? id.slice(0, 8);

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // Form validation kept in one place so the button-disabled state and the
  // pre-submit checks stay in sync. Returns null if OK, otherwise a message.
  function validate(): string | null {
    if (picked.size === 0) return "Pick at least one student";
    if (phone.trim()) {
      const digits = phone.trim().replace(/\D+/g, "");
      if (digits.length < 7 || digits.length > 15) {
        return "Phone should be 7-15 digits (e.g. +2507…)";
      }
    }
    if (expires) {
      const d = new Date(expires).getTime();
      if (!Number.isFinite(d)) return "Expiry date is invalid";
      if (d <= Date.now()) return "Expiry must be in the future";
    }
    return null;
  }

  async function generate() {
    if (!schoolId) return;
    const err = validate();
    if (err) { toast.error(err); return; }
    setSaving(true);
    try {
      // Retry a few times on collision. CODE_ALPHABET^8 keeps collision very rare.
      let attempt = 0;
      let lastErr: unknown = null;
      while (attempt < 4) {
        const code = makeCode();
        const { error } = await supabase.from("invites").insert({
          school_id: schoolId,
          code,
          phone: phone.trim() || null,
          student_ids: Array.from(picked),
          expires_at: expires ? new Date(expires).toISOString() : null,
        });
        if (!error) { lastErr = null; break; }
        if (error.code === "23505") { attempt++; lastErr = error; continue; }
        throw error;
      }
      if (lastErr) throw lastErr;
      setPicked(new Set()); setPhone(""); setExpires("");
      await bootstrap();
      toast.success("Invite created");
    } catch (e) {
      toast.error(friendlyError(e, "Couldn't create this invite. Please try again."));
    } finally { setSaving(false); }
  }

  async function revoke(inv: InviteRow) {
    if (inv.used_at) { toast.error("Cannot revoke a used invite"); return; }
    if (!confirm(`Revoke code ${inv.code}?`)) return;
    const { error } = await supabase.from("invites").delete().eq("id", inv.id);
    if (error) return toast.error(friendlyError(error, "Couldn't revoke that code."));
    await bootstrap();
  }

  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(null), 1500);
    } catch { toast.error("Copy failed"); }
  }

  return (
    <AdminShell>
      <div className="grid lg:grid-cols-[420px_1fr] gap-4">
        <aside className="rounded-2xl bg-gradient-card border border-border/60 shadow-soft p-4 space-y-3 h-fit">
          <div className="text-sm font-semibold">Generate an invite</div>
          <div className="space-y-2">
            <Label>Students ({picked.size} selected)</Label>
            <div className="max-h-64 overflow-y-auto rounded-lg border border-border/50 bg-background/40 divide-y divide-border/40">
              {students.length === 0 && <div className="text-xs text-muted-foreground p-3 text-center">No students in this school yet.</div>}
              {students.map((s) => {
                const checked = picked.has(s.id);
                return (
                  <label key={s.id} className="flex items-center gap-2 p-2 text-sm cursor-pointer hover:bg-accent/40">
                    <input type="checkbox" checked={checked} onChange={() => toggle(s.id)} className="h-4 w-4" />
                    <span className="flex-1 truncate">
                      {s.name}
                      {s.class && <span className="text-xs text-muted-foreground"> · {s.class}</span>}
                    </span>
                    <span className="text-[11px] text-muted-foreground">{busName(s.bus_id)}</span>
                  </label>
                );
              })}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="inv-phone">Parent phone (optional)</Label>
              <Input id="inv-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+2507…" className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inv-expires">Expires (optional)</Label>
              <Input
                id="inv-expires"
                type="datetime-local"
                value={expires}
                min={new Date(Date.now() + 60_000).toISOString().slice(0, 16)}
                onChange={(e) => setExpires(e.target.value)}
                className="h-9"
              />
              <div className="text-[11px] text-muted-foreground">
                Leave blank for no expiry. After this time the code stops working, even if unused.
              </div>
            </div>
          </div>
          {validate() && picked.size > 0 && (
            <div className="text-[11px] text-destructive">{validate()}</div>
          )}
          <Button onClick={generate} disabled={saving || validate() !== null} className="w-full bg-gradient-primary shadow-glow">
            {saving ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Plus className="h-4 w-4 mr-1.5" />}
            Generate invite
          </Button>
        </aside>

        <section className="rounded-2xl bg-gradient-card border border-border/60 shadow-soft p-4">
          <div className="text-sm font-semibold flex items-center justify-between">
            Invites <span className="text-xs text-muted-foreground">{invites.length}</span>
          </div>
          {busy && <div className="text-xs text-muted-foreground flex items-center gap-2 py-4"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…</div>}
          <div className="mt-2 divide-y divide-border/50">
            {invites.length === 0 && !busy && <div className="text-xs text-muted-foreground py-8 text-center">No invites yet — generate one on the left.</div>}
            {invites.map((inv) => {
              const status = inv.used_at ? "used" : (inv.expires_at && new Date(inv.expires_at) < new Date() ? "expired" : "unused");
              const badge = status === "used" ? "bg-muted text-muted-foreground" :
                           status === "expired" ? "bg-destructive/15 text-destructive" :
                           "bg-[var(--moving)]/15 text-[var(--moving)]";
              return (
                <div key={inv.id} className="py-3 flex items-center gap-3">
                  <span className="h-10 w-10 rounded-xl bg-primary/15 text-primary grid place-items-center"><Ticket className="h-5 w-5" /></span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate flex items-center gap-2">
                      <button onClick={() => copyCode(inv.code)} className="font-mono text-base tracking-widest hover:underline" title="Copy code">
                        {inv.code}
                      </button>
                      {copiedCode === inv.code
                        ? <Check className="h-3.5 w-3.5 text-[var(--moving)]" />
                        : <Copy className="h-3.5 w-3.5 text-muted-foreground" />}
                      <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${badge}`}>{status}</span>
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      Students: {inv.student_ids.map(studentName).join(", ")}
                      {inv.phone && ` · Phone: ${inv.phone}`}
                      {inv.expires_at && ` · Expires ${new Date(inv.expires_at).toLocaleString()}`}
                    </div>
                  </div>
                  {status === "unused" && (
                    <button onClick={() => revoke(inv)} className="p-2 rounded hover:bg-destructive/15 text-destructive" aria-label="Revoke">
                      <Trash2 className="h-4 w-4" />
                    </button>
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
