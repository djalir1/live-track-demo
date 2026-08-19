import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, LogOut, MapPin } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/me")({
  head: () => ({ meta: [{ title: "My children — Pulse" }] }),
  component: MePage,
});

interface Link {
  studentName: string;
  studentClass: string | null;
  busLabel: string | null;
  busPlate: string | null;
  routeName: string | null;
}

function MePage() {
  const { user, role, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<Link[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!user) { navigate({ to: "/join" }); return; }
    if (role == null) return;
    if (role !== "parent") { navigate({ to: "/track" }); return; } // non-parents don't belong here yet
  }, [loading, user, role, navigate]);

  useEffect(() => {
    if (!user || role !== "parent") return;
    (async () => {
      // Under RLS, a parent sees only their own parent_students, only their own
      // students, only their own child's buses/routes. This join is safe.
      const { data, error } = await supabase
        .from("parent_students")
        .select("students!inner(name, class, buses(label, plate, routes(name)))")
        .eq("parent_user_id", user.id);
      if (error) { setErr(error.message); return; }
      type Row = {
        students: {
          name: string;
          class: string | null;
          buses: { label: string | null; plate: string | null; routes: { name: string } | null } | null;
        };
      };
      const flat: Link[] = ((data ?? []) as unknown as Row[]).map((r) => ({
        studentName: r.students?.name ?? "—",
        studentClass: r.students?.class ?? null,
        busLabel: r.students?.buses?.label ?? null,
        busPlate: r.students?.buses?.plate ?? null,
        routeName: r.students?.buses?.routes?.name ?? null,
      }));
      setRows(flat);
    })();
  }, [user, role]);

  async function onSignOut() {
    await signOut();
    toast.success("Signed out");
    navigate({ to: "/join" });
  }

  if (loading || !user || role !== "parent") {
    return (
      <div className="min-h-screen bg-background grid place-items-center">
        <div className="flex items-center gap-3 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <span>Loading…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col">
      <header className="border-b border-border/50 backdrop-blur-xl bg-background/70">
        <div className="mx-auto max-w-2xl px-4 h-14 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 font-display font-bold">
            <span className="h-7 w-7 grid place-items-center rounded-lg bg-gradient-primary shadow-glow">
              <MapPin className="h-3.5 w-3.5 text-primary-foreground" />
            </span>
            Pulse
          </Link>
          <Button variant="ghost" size="sm" onClick={onSignOut}>
            <LogOut className="h-4 w-4 sm:mr-1.5" /><span className="hidden sm:inline">Sign out</span>
          </Button>
        </div>
      </header>

      <main className="flex-1 mx-auto max-w-2xl w-full px-4 py-6">
        <h1 className="font-display text-2xl font-bold tracking-tight">Signed in.</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          You are linked to:
        </p>

        {err && (
          <div className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {err}
          </div>
        )}

        {rows == null && !err && (
          <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        )}

        {rows && rows.length === 0 && (
          <div className="mt-4 rounded-lg border border-border/60 bg-card/40 p-3 text-sm text-muted-foreground">
            No linked children yet. Ask the school to send you a fresh invite code.
          </div>
        )}

        <ul className="mt-4 space-y-3">
          {(rows ?? []).map((r, i) => (
            <li key={i} className="rounded-xl border border-border/60 bg-card/40 p-4">
              <div className="text-base">
                <span className="font-semibold">{r.studentName}</span>
                {r.studentClass && <span className="text-muted-foreground"> · {r.studentClass}</span>}
                {" — Bus "}<span className="font-mono">{r.busPlate ?? r.busLabel ?? "—"}</span>
                {r.routeName && <> {"on route "}<span className="font-semibold">{r.routeName}</span></>}
                {"."}
              </div>
            </li>
          ))}
        </ul>

        <p className="mt-8 text-xs text-muted-foreground">
          The live map and arrival alerts are coming next. This page is intentionally plain — its
          only job right now is to confirm your account is linked to the right child.
        </p>
      </main>
    </div>
  );
}
