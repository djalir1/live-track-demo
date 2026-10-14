import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Plus,
  Loader2,
  Pencil,
  X,
  Check,
  Phone,
  IdCard,
  Smartphone,
  Bus as BusIcon,
  History,
  Archive,
  ArchiveRestore,
  Trash2,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AdminShell } from "@/components/AdminShell";
import { AssignmentHistory } from "@/components/AssignmentHistory";
import { IconBtn } from "@/components/IconButton";
import { friendlyError } from "@/lib/friendly-errors";
import { fmtDate } from "@/lib/time";
import { assignDriver, busName, db, loadFleet, type Driver, type Fleet } from "@/lib/fleet";

export const Route = createFileRoute("/admin/drivers")({
  head: () => ({ meta: [{ title: "Drivers — Live Track" }] }),
  component: DriversPage,
});

interface DriverForm {
  fullName: string;
  phone: string;
  license: string;
  userId: string;
  notes: string;
  busId: string;
}
const EMPTY: DriverForm = {
  fullName: "",
  phone: "",
  license: "",
  userId: "",
  notes: "",
  busId: "",
};

const EMPTY_FLEET: Fleet = {
  schoolId: null,
  buses: [],
  drivers: [],
  open: [],
  routes: [],
  appAccounts: [],
};

function DriversPage() {
  const [fleet, setFleet] = useState<Fleet>(EMPTY_FLEET);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<DriverForm>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<DriverForm>(EMPTY);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    setBusy(true);
    try {
      setFleet(await loadFleet());
    } catch (e) {
      toast.error(friendlyError(e, "Couldn't load drivers right now."));
    } finally {
      setBusy(false);
    }
  }

  const currentBus = (driverId: string) => {
    const a = fleet.open.find((x) => x.driver_id === driverId);
    return a ? { bus: fleet.buses.find((b) => b.id === a.bus_id), since: a.started_at } : null;
  };
  const linkedUserIds = new Set(fleet.drivers.map((d) => d.user_id).filter(Boolean));

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return fleet.drivers
      .filter((d) => d.active !== showArchived)
      .filter(
        (d) =>
          !q ||
          `${d.full_name} ${d.phone ?? ""} ${d.license_number ?? ""}`.toLowerCase().includes(q),
      );
  }, [fleet.drivers, query, showArchived]);
  const archivedCount = fleet.drivers.filter((d) => !d.active).length;

  function row(f: DriverForm) {
    return {
      full_name: f.fullName.trim(),
      phone: f.phone.trim() || null,
      license_number: f.license.trim() || null,
      notes: f.notes.trim() || null,
      user_id: f.userId || null,
    };
  }

  async function createDriver() {
    if (!fleet.schoolId) return;
    if (!form.fullName.trim()) {
      toast.error("Enter the driver's name");
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await db
        .from("drivers")
        .insert({ school_id: fleet.schoolId, ...row(form) })
        .select("id")
        .single();
      if (error) throw error;
      if (form.busId) await assignDriver(form.busId, data.id);
      toast.success(form.busId ? "Driver added and assigned" : "Driver added");
      setForm(EMPTY);
      await refresh();
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setSaving(false);
    }
  }

  function startEdit(d: Driver) {
    setEditingId(d.id);
    setEditForm({
      fullName: d.full_name,
      phone: d.phone ?? "",
      license: d.license_number ?? "",
      userId: d.user_id ?? "",
      notes: d.notes ?? "",
      busId: currentBus(d.id)?.bus?.id ?? "",
    });
  }

  async function saveEdit(d: Driver) {
    if (!editForm.fullName.trim()) {
      toast.error("Enter the driver's name");
      return;
    }
    setSaving(true);
    try {
      const { error } = await db.from("drivers").update(row(editForm)).eq("id", d.id);
      if (error) throw error;
      const was = currentBus(d.id)?.bus?.id ?? "";
      if (editForm.busId !== was) {
        if (editForm.busId) await assignDriver(editForm.busId, d.id);
        else if (was) await assignDriver(was, null);
      }
      toast.success("Driver saved");
      setEditingId(null);
      await refresh();
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setSaving(false);
    }
  }

  async function setActive(d: Driver, active: boolean) {
    try {
      const cur = currentBus(d.id);
      if (!active && cur?.bus) await assignDriver(cur.bus.id, null);
      const { error } = await db.from("drivers").update({ active }).eq("id", d.id);
      if (error) throw error;
      toast.success(active ? "Driver restored" : "Driver archived — their history is kept");
      await refresh();
    } catch (e) {
      toast.error(friendlyError(e));
    }
  }

  async function remove(d: Driver) {
    if (
      !window.confirm(
        `Delete ${d.full_name}? Only possible if they never drove a vehicle; otherwise archive them.`,
      )
    )
      return;
    const { error } = await db.from("drivers").delete().eq("id", d.id);
    if (error) {
      toast.error(
        error.code === "23503"
          ? "This driver has driving history — archive them instead."
          : friendlyError(error),
      );
      return;
    }
    await refresh();
  }

  return (
    <AdminShell>
      <div className="grid lg:grid-cols-[380px_1fr] gap-4">
        <aside className="rounded-2xl bg-gradient-card border border-border/60 shadow-soft p-4 space-y-3 h-fit">
          <div className="text-sm font-semibold">Add a driver</div>
          <DriverFields
            idPrefix="new"
            form={form}
            setForm={setForm}
            fleet={fleet}
            linkedUserIds={linkedUserIds}
          />
          <Button
            onClick={createDriver}
            disabled={saving}
            className="w-full bg-gradient-primary shadow-glow"
          >
            {saving && !editingId ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <Plus className="h-4 w-4 mr-1.5" />
            )}
            Add driver
          </Button>
        </aside>

        <section className="rounded-2xl bg-gradient-card border border-border/60 shadow-soft p-4 min-w-0">
          <div className="flex flex-wrap items-center gap-2 justify-between">
            <div className="text-sm font-semibold">
              {showArchived ? "Archived drivers" : "Drivers"}{" "}
              <span className="text-xs text-muted-foreground ml-1">{visible.length}</span>
            </div>
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <div className="relative flex-1 sm:w-56">
                <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search name, phone, licence"
                  className="h-8 pl-8 text-xs"
                />
              </div>
              {(archivedCount > 0 || showArchived) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => setShowArchived((v) => !v)}
                >
                  {showArchived ? "Active" : `Archived (${archivedCount})`}
                </Button>
              )}
            </div>
          </div>
          {busy && (
            <div className="text-xs text-muted-foreground flex items-center gap-2 py-4">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
            </div>
          )}
          <div className="mt-2 divide-y divide-border/50">
            {visible.length === 0 && !busy && (
              <div className="text-xs text-muted-foreground py-8 text-center">
                {query
                  ? "No driver matches your search."
                  : showArchived
                    ? "No archived drivers."
                    : "No drivers yet — add one on the left."}
              </div>
            )}
            {visible.map((d) => {
              if (editingId === d.id) {
                return (
                  <div key={d.id} className="py-3 space-y-3">
                    <div className="text-sm font-semibold flex items-center gap-2">
                      <Pencil className="h-4 w-4 text-primary" /> Edit {d.full_name}
                    </div>
                    <DriverFields
                      idPrefix={`edit-${d.id}`}
                      form={editForm}
                      setForm={setEditForm}
                      fleet={fleet}
                      linkedUserIds={linkedUserIds}
                      self={d}
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => saveEdit(d)}
                        disabled={saving}
                        className="bg-gradient-primary"
                      >
                        {saving ? (
                          <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                        ) : (
                          <Check className="h-4 w-4 mr-1.5" />
                        )}{" "}
                        Save
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditingId(null)}
                        disabled={saving}
                      >
                        <X className="h-4 w-4 mr-1.5" /> Cancel
                      </Button>
                    </div>
                  </div>
                );
              }
              const cur = currentBus(d.id);
              return (
                <div key={d.id} className="py-3">
                  <div className="flex items-start gap-3">
                    <span className="h-10 w-10 rounded-full bg-primary/15 text-primary grid place-items-center shrink-0 font-semibold">
                      {d.full_name.trim().charAt(0).toUpperCase()}
                    </span>
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="text-sm font-semibold flex items-center gap-2 flex-wrap">
                        <span className="truncate">{d.full_name}</span>
                        {d.user_id && (
                          <span className="text-[10px] font-normal inline-flex items-center gap-1 bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                            <Smartphone className="h-3 w-3" /> app
                          </span>
                        )}
                      </div>
                      <div className="text-xs flex items-center gap-1.5">
                        <BusIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        {cur?.bus ? (
                          <span className="truncate">
                            <span className="font-medium">{busName(cur.bus)}</span>
                            <span className="text-muted-foreground">
                              {" "}
                              since {fmtDate(cur.since)}
                            </span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground italic">
                            Not assigned to a vehicle
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
                        {d.phone && (
                          <a
                            href={`tel:${d.phone}`}
                            className="inline-flex items-center gap-1 hover:text-foreground"
                          >
                            <Phone className="h-3 w-3" />
                            {d.phone}
                          </a>
                        )}
                        {d.license_number && (
                          <span className="inline-flex items-center gap-1">
                            <IdCard className="h-3 w-3" />
                            {d.license_number}
                          </span>
                        )}
                      </div>
                      {d.notes && (
                        <p className="text-xs text-muted-foreground line-clamp-2">{d.notes}</p>
                      )}
                    </div>
                    <div className="flex shrink-0">
                      <IconBtn
                        label="History"
                        onClick={() => setHistoryId(historyId === d.id ? null : d.id)}
                        active={historyId === d.id}
                      >
                        <History className="h-4 w-4" />
                      </IconBtn>
                      {d.active ? (
                        <>
                          <IconBtn label="Edit" onClick={() => startEdit(d)}>
                            <Pencil className="h-4 w-4" />
                          </IconBtn>
                          <IconBtn label="Archive" onClick={() => setActive(d, false)}>
                            <Archive className="h-4 w-4" />
                          </IconBtn>
                        </>
                      ) : (
                        <>
                          <IconBtn label="Restore" onClick={() => setActive(d, true)}>
                            <ArchiveRestore className="h-4 w-4" />
                          </IconBtn>
                          <IconBtn label="Delete" danger onClick={() => remove(d)}>
                            <Trash2 className="h-4 w-4" />
                          </IconBtn>
                        </>
                      )}
                    </div>
                  </div>
                  {historyId === d.id && (
                    <div className="mt-2 ml-0 sm:ml-13 rounded-lg bg-background/40 border border-border/50 p-2.5">
                      <div className="text-[11px] font-semibold text-muted-foreground mb-1.5">
                        Vehicles driven
                      </div>
                      <AssignmentHistory
                        driverId={d.id}
                        buses={fleet.buses}
                        drivers={fleet.drivers}
                      />
                    </div>
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

function DriverFields({
  idPrefix,
  form,
  setForm,
  fleet,
  linkedUserIds,
  self,
}: {
  idPrefix: string;
  form: DriverForm;
  setForm: (f: DriverForm) => void;
  fleet: Fleet;
  linkedUserIds: Set<string | null>;
  self?: Driver;
}) {
  const set = <K extends keyof DriverForm>(k: K, v: DriverForm[K]) => setForm({ ...form, [k]: v });
  const id = (s: string) => `${idPrefix}-${s}`;
  const accounts = fleet.appAccounts.filter(
    (a) => !linkedUserIds.has(a.id) || a.id === self?.user_id,
  );
  const driverOn = (busId: string) => {
    const a = fleet.open.find((x) => x.bus_id === busId);
    return a && a.driver_id !== self?.id
      ? fleet.drivers.find((d) => d.id === a.driver_id)?.full_name
      : null;
  };
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-1.5 col-span-2">
        <Label htmlFor={id("name")}>Full name</Label>
        <Input
          id={id("name")}
          value={form.fullName}
          onChange={(e) => set("fullName", e.target.value)}
          placeholder='e.g. "Eloge Mugisha"'
          className="h-9"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={id("phone")}>Phone</Label>
        <Input
          id={id("phone")}
          type="tel"
          inputMode="tel"
          value={form.phone}
          onChange={(e) => set("phone", e.target.value)}
          placeholder="07…"
          className="h-9"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={id("license")}>Licence no.</Label>
        <Input
          id={id("license")}
          value={form.license}
          onChange={(e) => set("license", e.target.value)}
          className="h-9"
        />
      </div>
      <div className="space-y-1.5 col-span-2">
        <Label htmlFor={id("bus")}>Vehicle</Label>
        <select
          id={id("bus")}
          value={form.busId}
          onChange={(e) => set("busId", e.target.value)}
          className="w-full h-9 rounded-md bg-background/50 border border-input px-3 text-sm"
        >
          <option value="">— not assigned —</option>
          {fleet.buses.map((b) => {
            const other = driverOn(b.id);
            return (
              <option key={b.id} value={b.id}>
                {busName(b)}
                {b.plate && b.label ? ` (${b.plate})` : ""}
                {other ? ` — replaces ${other}` : ""}
              </option>
            );
          })}
        </select>
      </div>
      <div className="space-y-1.5 col-span-2">
        <Label htmlFor={id("app")}>Driver app account (optional)</Label>
        <select
          id={id("app")}
          value={form.userId}
          onChange={(e) => set("userId", e.target.value)}
          className="w-full h-9 rounded-md bg-background/50 border border-input px-3 text-sm"
        >
          <option value="">No app — the vehicle's GPS tracker reports</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.display_name}
              {a.plate_number ? ` (${a.plate_number})` : ""}
            </option>
          ))}
        </select>
        <p className="text-[11px] text-muted-foreground">
          Link an account only if this driver shares their location from the Live Track phone app.
        </p>
      </div>
      <div className="space-y-1.5 col-span-2">
        <Label htmlFor={id("notes")}>Notes</Label>
        <Input
          id={id("notes")}
          value={form.notes}
          onChange={(e) => set("notes", e.target.value)}
          placeholder="Optional"
          className="h-9"
        />
      </div>
    </div>
  );
}
