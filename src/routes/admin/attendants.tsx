import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, UserCheck, KeyRound, Pencil, Phone, Smartphone } from "lucide-react";
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
import { CodesDialog } from "@/components/school/CodesDialog";
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
import { formatPhone, normalizePhone, telLink } from "@/lib/phone";
import { busName, isMissingTable, type Attendant, type BusLite } from "@/lib/school";

export const Route = createFileRoute("/admin/attendants")({
  head: () => ({ meta: [{ title: "Bus attendants — Live Track" }] }),
  component: () => (
    <AppShell>
      <AttendantsPage />
    </AppShell>
  ),
});

interface Draft {
  id?: string;
  full_name: string;
  phone: string;
  bus_id: string;
  active: boolean;
}

function AttendantsPage() {
  const { schoolId } = useCurrentSchool();
  const [list, setList] = useState<Attendant[] | null>(null);
  const [buses, setBuses] = useState<BusLite[]>([]);
  const [missing, setMissing] = useState(false);
  const [edit, setEdit] = useState<Draft | null>(null);
  const [codes, setCodes] = useState<Attendant[] | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    if (!schoolId) return;
    const [a, b] = await Promise.all([
      db.from("attendants").select("*").eq("school_id", schoolId).order("full_name"),
      db.from("buses").select("*").eq("school_id", schoolId).order("label"),
    ]);
    if (isMissingTable(a.error)) return setMissing(true);
    setList((a.data ?? []) as Attendant[]);
    setBuses((b.data ?? []) as BusLite[]);
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId]);

  async function save() {
    if (!edit || !schoolId) return;
    const phone = normalizePhone(edit.phone);
    if (!edit.full_name.trim()) return toast.error("Enter the attendant's name");
    if (!phone) return toast.error("Enter a valid phone number");
    setSaving(true);
    const row = {
      school_id: schoolId,
      full_name: edit.full_name.trim(),
      phone,
      bus_id: edit.bus_id || null,
      active: edit.active,
    };
    const res = edit.id
      ? await db.from("attendants").update(row).eq("id", edit.id).select("*").single()
      : await db.from("attendants").insert(row).select("*").single();
    setSaving(false);
    if (res.error) return toast.error(friendlyError(res.error, "Couldn't save"));
    setEdit(null);
    if (!edit.id) setCodes([res.data as Attendant]);
    toast.success(edit.id ? "Saved" : "Attendant added");
    void load();
  }

  async function newCode(a: Attendant) {
    if (!window.confirm(`Give ${a.full_name} a new code? They use it to choose a new password.`))
      return;
    const { data, error } = await db.rpc("issue_activation_code", {
      p_kind: "attendant",
      p_id: a.id,
    });
    if (error) return toast.error(friendlyError(error, "Couldn't create a code"));
    setCodes([{ ...a, activation_code: data as string }]);
    void load();
  }

  if (missing)
    return (
      <>
        <PageHeader title="Bus attendants" />
        <MigrationNotice />
      </>
    );

  const busTaken = new Map(
    (list ?? []).filter((a) => a.active && a.bus_id).map((a) => [a.bus_id!, a.full_name]),
  );

  return (
    <>
      <PageHeader
        title="Bus attendants"
        description="The attendant rides the bus and marks each child on and off with their phone. The driver only drives. Each attendant signs in with their phone number."
        actions={
          <Button
            className="bg-gradient-primary shadow-glow"
            onClick={() => setEdit({ full_name: "", phone: "", bus_id: "", active: true })}
          >
            <Plus className="h-4 w-4 mr-1.5" /> Add attendant
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {list == null ? (
          <Loading />
        ) : list.length === 0 ? (
          <Panel className="sm:col-span-2 xl:col-span-3">
            <EmptyState Icon={UserCheck} title="No attendants yet">
              Add one per bus. Until then, school admins can also open the check-in screen.
            </EmptyState>
          </Panel>
        ) : (
          list.map((a) => {
            const bus = buses.find((b) => b.id === a.bus_id);
            return (
              <Panel key={a.id} bodyClassName="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{a.full_name}</div>
                    <a
                      href={telLink(a.phone)}
                      className="text-xs text-muted-foreground hover:text-primary inline-flex items-center gap-1"
                    >
                      <Phone className="h-3 w-3" /> {formatPhone(a.phone)}
                    </a>
                  </div>
                  {!a.active ? (
                    <Pill tone="muted">Inactive</Pill>
                  ) : a.user_id ? (
                    <Pill tone="success">Active</Pill>
                  ) : (
                    <Pill tone="warning">Not activated</Pill>
                  )}
                </div>
                <div className="mt-3 text-sm flex items-center gap-2">
                  <Smartphone className="h-4 w-4 text-primary" />
                  {bus ? busName(bus) : <span className="text-warning">No bus assigned</span>}
                </div>
                {a.activation_code && (
                  <div className="mt-3 rounded-lg bg-muted/60 px-3 py-2 text-xs flex items-center justify-between">
                    <span className="text-muted-foreground">Activation code</span>
                    <span className="font-mono text-base font-bold tracking-[0.18em] text-primary">
                      {a.activation_code}
                    </span>
                  </div>
                )}
                <div className="mt-3 flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setEdit({
                        id: a.id,
                        full_name: a.full_name,
                        phone: formatPhone(a.phone),
                        bus_id: a.bus_id ?? "",
                        active: a.active,
                      })
                    }
                  >
                    <Pencil className="h-4 w-4 mr-1.5" /> Edit
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => newCode(a)}>
                    <KeyRound className="h-4 w-4 mr-1.5" />{" "}
                    {a.user_id ? "Reset password" : "New code"}
                  </Button>
                </div>
              </Panel>
            );
          })
        )}
      </div>

      {edit && (
        <Dialog open onOpenChange={(o) => !o && setEdit(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{edit.id ? "Edit attendant" : "Add a bus attendant"}</DialogTitle>
              <DialogDescription>
                They get a 6-digit code to activate their account on their phone.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <Field label="Full name">
                <Input
                  value={edit.full_name}
                  onChange={(e) => setEdit({ ...edit, full_name: e.target.value })}
                  autoFocus
                />
              </Field>
              <Field label="Phone">
                <Input
                  value={edit.phone}
                  inputMode="tel"
                  placeholder="0788 123 456"
                  onChange={(e) => setEdit({ ...edit, phone: e.target.value })}
                />
              </Field>
              <Field
                label="Bus"
                hint={
                  edit.bus_id &&
                  busTaken.get(edit.bus_id) &&
                  busTaken.get(edit.bus_id) !== edit.full_name
                    ? `${busTaken.get(edit.bus_id)} is also on this bus.`
                    : undefined
                }
              >
                <NativeSelect value={edit.bus_id} onChange={(v) => setEdit({ ...edit, bus_id: v })}>
                  <option value="">No bus yet</option>
                  {buses.map((b) => (
                    <option key={b.id} value={b.id}>
                      {busName(b)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              {edit.id && (
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={edit.active}
                    onCheckedChange={(v) => setEdit({ ...edit, active: !!v })}
                  />{" "}
                  Active (can sign in and mark children)
                </label>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEdit(null)}>
                Cancel
              </Button>
              <Button onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {codes && <CodesDialog kind="attendant" guardians={codes} onClose={() => setCodes(null)} />}
    </>
  );
}
