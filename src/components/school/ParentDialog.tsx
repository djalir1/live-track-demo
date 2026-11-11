import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, NativeSelect, StudentAvatar } from "@/components/school/ui";
import { db } from "@/lib/fleet";
import { friendlyError } from "@/lib/friendly-errors";
import { formatPhone, normalizePhone } from "@/lib/phone";
import type { Guardian, StudentRow } from "@/lib/school";

// Add a parent (or edit one) straight from the Parents page: name, phone and
// which children are theirs. A new parent gets a 6-digit code to start using
// the app; the school passes it on.

export function ParentDialog({
  schoolId,
  guardian,
  students,
  childIds,
  onClose,
  onSaved,
}: {
  schoolId: string;
  /** null = add a new parent. */
  guardian: Guardian | null;
  students: StudentRow[];
  /** Children already linked to this parent. */
  childIds: string[];
  onClose: () => void;
  onSaved: (created: Guardian | null) => void;
}) {
  const [name, setName] = useState(guardian?.full_name ?? "");
  const [phone, setPhone] = useState(guardian ? formatPhone(guardian.phone) : "");
  const [relationship, setRelationship] = useState(guardian?.relationship ?? "Mother");
  const [picked, setPicked] = useState<Set<string>>(new Set(childIds));
  const [q, setQ] = useState("");
  const [saving, setSaving] = useState(false);

  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return students
      .filter((s) => s.active !== false || picked.has(s.id))
      .filter((s) => !n || s.name.toLowerCase().includes(n) || (s.class ?? "").toLowerCase() === n)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [students, q, picked]);

  function toggle(id: string) {
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    const digits = normalizePhone(phone);
    if (!name.trim()) return toast.error("Enter the parent's name");
    if (!digits) return toast.error("Enter a phone number like 0788 123 456");
    setSaving(true);
    try {
      let g = guardian;
      let created: Guardian | null = null;
      if (g) {
        const { error } = await db
          .from("guardians")
          .update({ full_name: name.trim(), phone: digits, relationship: relationship || null })
          .eq("id", g.id);
        if (error) throw error;
      } else {
        const { data: same } = await db
          .from("guardians")
          .select("id, full_name")
          .eq("school_id", schoolId)
          .eq("phone", digits)
          .maybeSingle();
        if (same) {
          toast.error(
            `${formatPhone(digits)} already belongs to ${(same as { full_name: string }).full_name}. Edit that parent instead.`,
          );
          return;
        }
        const { data, error } = await db
          .from("guardians")
          .insert({
            school_id: schoolId,
            full_name: name.trim(),
            phone: digits,
            relationship: relationship || null,
          })
          .select("*")
          .single();
        if (error) throw error;
        g = data as Guardian;
        created = g;
      }
      const guardianId = g.id;
      const before = new Set(childIds);
      const add = [...picked].filter((id) => !before.has(id));
      const remove = [...before].filter((id) => !picked.has(id));
      if (add.length) {
        const { error } = await db
          .from("student_guardians")
          .upsert(
            add.map((student_id) => ({ student_id, guardian_id: guardianId, is_primary: false })),
          );
        if (error) throw error;
      }
      if (remove.length) {
        const { error } = await db
          .from("student_guardians")
          .delete()
          .eq("guardian_id", guardianId)
          .in("student_id", remove);
        if (error) throw error;
      }
      toast.success(
        created
          ? `${created.full_name} added. Their code: ${created.activation_code ?? "—"}`
          : "Parent saved",
      );
      onSaved(created);
    } catch (e) {
      const dup = /duplicate|unique/i.test(String((e as { message?: string }).message));
      toast.error(
        dup
          ? "Another parent already uses this phone number."
          : friendlyError(e, "Couldn't save the parent"),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{guardian ? "Edit parent" : "Add a parent"}</DialogTitle>
          <DialogDescription>
            {guardian
              ? "Change the name, phone number or children."
              : "They get a 6-digit code. With it they choose a password, then sign in with their phone number."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Full name">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Grace Uwase"
            />
          </Field>
          <Field label="Phone number" hint="Like 0788 123 456">
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onBlur={() => {
                const d = normalizePhone(phone);
                if (d) setPhone(formatPhone(d));
              }}
              inputMode="tel"
              placeholder="0788 123 456"
            />
          </Field>
          <Field label="Relationship">
            <NativeSelect value={relationship} onChange={setRelationship}>
              <option value="Mother">Mother</option>
              <option value="Father">Father</option>
              <option value="Guardian">Guardian</option>
              <option value="">Other</option>
            </NativeSelect>
          </Field>
        </div>

        <div>
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-medium">
              Their children{" "}
              <span className="text-muted-foreground font-normal">({picked.size} chosen)</span>
            </div>
            <div className="relative w-44">
              <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Find a student"
                className="h-8 pl-8 text-sm"
              />
            </div>
          </div>
          <ul className="mt-2 max-h-56 overflow-y-auto rounded-xl border border-border divide-y divide-border">
            {shown.length === 0 && (
              <li className="px-3 py-6 text-center text-sm text-muted-foreground">
                No student matches.
              </li>
            )}
            {shown.map((s) => (
              <li key={s.id}>
                <label className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/50">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={picked.has(s.id)}
                    onChange={() => toggle(s.id)}
                  />
                  <StudentAvatar name={s.name} photo={s.photo_url} size={28} />
                  <span className="text-sm flex-1 truncate">{s.name}</span>
                  {s.class && <span className="text-xs text-muted-foreground">{s.class}</span>}
                </label>
              </li>
            ))}
          </ul>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : guardian ? (
              "Save"
            ) : (
              "Add parent"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
