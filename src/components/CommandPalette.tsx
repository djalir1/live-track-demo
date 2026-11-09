import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Command } from "cmdk";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Search,
  X,
  GraduationCap,
  Users,
  Bus,
  IdCard,
  MapPin,
  CornerDownLeft,
  ArrowRight,
} from "lucide-react";
import { NAV_PAGES } from "@/components/nav";
import { db } from "@/lib/fleet";
import { formatPhone } from "@/lib/phone";

// Ctrl/⌘ K: jump to any page, or straight to a student, parent, vehicle,
// driver or stop of this school.

interface Hit {
  id: string;
  kind: "student" | "parent" | "bus" | "driver" | "stop";
  title: string;
  sub: string;
  go: () => void;
}

/** Real matches only: whole phrase > word start > every word somewhere. */
function score(value: string, search: string): number {
  const v = value.toLowerCase();
  const q = search.trim().toLowerCase();
  if (!q) return 1;
  if (v.startsWith(q)) return 1;
  if (v.includes(` ${q}`)) return 0.9;
  if (v.includes(q)) return 0.7;
  const words = q.split(/\s+/).filter(Boolean);
  return words.every((w) => v.includes(w)) ? 0.5 : 0;
}

const KIND = {
  student: { label: "Students", Icon: GraduationCap },
  parent: { label: "Parents", Icon: Users },
  bus: { label: "Vehicles", Icon: Bus },
  driver: { label: "Drivers", Icon: IdCard },
  stop: { label: "Stops", Icon: MapPin },
} as const;

export function CommandPalette({
  open,
  onOpenChange,
  schoolId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  schoolId: string | null;
}) {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  const go = (fn: () => void) => {
    onOpenChange(false);
    setQ("");
    fn();
  };

  // Load this school's records the first time search opens.
  useEffect(() => {
    if (!open || !schoolId || loadedFor === schoolId) return;
    let alive = true;
    (async () => {
      const [s, g, b, d, st] = await Promise.all([
        db
          .from("students")
          .select("id, name, class, student_code")
          .eq("school_id", schoolId)
          .limit(2000),
        db.from("guardians").select("id, full_name, phone").eq("school_id", schoolId).limit(2000),
        db.from("buses").select("id, label, plate").eq("school_id", schoolId),
        db.from("drivers").select("id, full_name, phone").eq("school_id", schoolId),
        db.from("stops").select("id, name, route_id").eq("school_id", schoolId),
      ]);
      if (!alive) return;
      const out: Hit[] = [];
      for (const x of (s.data ?? []) as {
        id: string;
        name: string;
        class: string | null;
        student_code: string | null;
      }[])
        out.push({
          id: x.id,
          kind: "student",
          title: x.name,
          sub: [x.class && `Class ${x.class}`, x.student_code].filter(Boolean).join(" · "),
          go: () => navigate({ to: "/admin/students", search: { q: x.name } }),
        });
      for (const x of (g.data ?? []) as { id: string; full_name: string; phone: string }[])
        out.push({
          id: x.id,
          kind: "parent",
          title: x.full_name,
          sub: formatPhone(x.phone),
          go: () => navigate({ to: "/admin/parents", search: { q: x.full_name } }),
        });
      for (const x of (b.data ?? []) as {
        id: string;
        label: string | null;
        plate: string | null;
      }[])
        out.push({
          id: x.id,
          kind: "bus",
          title: x.label || x.plate || "Vehicle",
          sub: x.plate ?? "",
          go: () => navigate({ to: "/admin/trips", search: { bus: x.id } }),
        });
      for (const x of (d.data ?? []) as { id: string; full_name: string; phone: string | null }[])
        out.push({
          id: x.id,
          kind: "driver",
          title: x.full_name,
          sub: formatPhone(x.phone),
          go: () => navigate({ to: "/admin/drivers" }),
        });
      for (const x of (st.data ?? []) as { id: string; name: string }[])
        out.push({
          id: x.id,
          kind: "stop",
          title: x.name,
          sub: "Stop",
          go: () => navigate({ to: "/admin/routes" }),
        });
      setHits(out);
      setLoadedFor(schoolId);
    })();
    return () => {
      alive = false;
    };
  }, [open, schoolId, loadedFor, navigate]);

  const needle = q.trim().toLowerCase();
  const recordHits = needle.length >= 2 ? hits : [];

  const itemCls =
    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm cursor-pointer outline-none data-[selected=true]:bg-muted aria-selected:bg-muted";
  const groupCls =
    "[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground";

  const pageGroups = [...new Set(NAV_PAGES.map((p) => p.group ?? "Pages"))];

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-black/50 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed z-[71] left-1/2 top-[8vh] sm:top-[12vh] -translate-x-1/2 w-[calc(100vw-24px)] max-w-xl rounded-2xl border border-border bg-popover text-popover-foreground shadow-2xl overflow-hidden data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
          aria-describedby={undefined}
        >
          <Dialog.Title className="sr-only">Search</Dialog.Title>
          <Command label="Search" loop filter={score} className={groupCls}>
            <div className="flex items-center gap-2 border-b border-border px-4">
              <Search className="h-5 w-5 text-muted-foreground shrink-0" />
              <Command.Input
                value={q}
                onValueChange={setQ}
                autoFocus
                placeholder="Type a page, student, parent, bus…"
                className="h-14 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
              />
              <Dialog.Close
                className="h-8 w-8 grid place-items-center rounded-lg text-muted-foreground hover:bg-muted"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </Dialog.Close>
            </div>
            <Command.List className="max-h-[min(60vh,440px)] overflow-y-auto p-1.5">
              <Command.Empty className="py-10 text-center text-sm text-muted-foreground">
                Nothing found for “{q}”.
              </Command.Empty>
              {pageGroups.map((g) => (
                <Command.Group key={g} heading={g}>
                  {NAV_PAGES.filter((p) => (p.group ?? "Pages") === g).map((p) => (
                    <Command.Item
                      key={p.to}
                      value={`${p.label} ${p.group ?? ""} ${p.keywords ?? ""}`}
                      onSelect={() => go(() => navigate({ to: p.to }))}
                      className={itemCls}
                    >
                      <p.Icon className="h-4 w-4 text-muted-foreground" />
                      <span className="flex-1">{p.label}</span>
                      {p.soon && (
                        <span className="text-[10px] uppercase text-warning font-semibold">
                          Soon
                        </span>
                      )}
                      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 [[data-selected=true]_&]:opacity-100" />
                    </Command.Item>
                  ))}
                </Command.Group>
              ))}
              {(Object.keys(KIND) as Hit["kind"][]).map((k) => {
                const list = recordHits.filter((h) => h.kind === k);
                if (!list.length) return null;
                const K = KIND[k];
                return (
                  <Command.Group key={k} heading={K.label}>
                    {list.map((h) => (
                      <Command.Item
                        key={`${k}:${h.id}`}
                        value={`${h.title} ${h.sub} ${k}:${h.id}`}
                        onSelect={() => go(h.go)}
                        className={itemCls}
                      >
                        <K.Icon className="h-4 w-4 text-muted-foreground" />
                        <span className="flex-1 min-w-0 truncate">{h.title}</span>
                        <span className="text-xs text-muted-foreground truncate max-w-[45%]">
                          {h.sub}
                        </span>
                      </Command.Item>
                    ))}
                  </Command.Group>
                );
              })}
            </Command.List>
            <div className="hidden sm:flex items-center gap-4 border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <kbd className="rounded border border-border px-1">↑</kbd>
                <kbd className="rounded border border-border px-1">↓</kbd> move
              </span>
              <span className="flex items-center gap-1">
                <CornerDownLeft className="h-3 w-3" /> open
              </span>
              <span className="flex items-center gap-1">
                <kbd className="rounded border border-border px-1">Esc</kbd> close
              </span>
              <span className="ml-auto">Type 2+ letters to search students, parents and buses</span>
            </div>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
