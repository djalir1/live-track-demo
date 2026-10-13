import { Link, useMatchRoute, useNavigate } from "@tanstack/react-router";
import { LogOut, MapPin, Route as RouteIcon, Bus, GraduationCap, ArrowLeft, Loader2, Ticket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth, canManageSchoolSetup } from "@/lib/auth-context";
import { PARENTS_ENABLED } from "@/lib/features";
import { useEffect, type ReactNode } from "react";

// Shared header + tab nav for /admin/* screens. Guards access to
// admin OR school_admin; anyone else is redirected to /track. While loading
// or role isn't known yet, shows a neutral loader.
export function AdminShell({ children }: { children: ReactNode }) {
  const { user, role, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const matchRoute = useMatchRoute();

  useEffect(() => {
    if (loading) return;
    if (!user) { navigate({ to: "/auth" }); return; }
    if (role == null) return;
    if (!canManageSchoolSetup(role)) navigate({ to: "/track" });
  }, [loading, user, role, navigate]);

  if (loading || !user || role == null || !canManageSchoolSetup(role)) {
    return (
      <div className="min-h-screen bg-background grid place-items-center">
        <div className="flex items-center gap-3 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <span>Loading…</span>
        </div>
      </div>
    );
  }

  const tabs = [
    { to: "/admin/buses",    label: "Vehicles", Icon: Bus },
    { to: "/admin/routes",   label: "Routes",   Icon: RouteIcon },
    // Parent features (see src/lib/features.ts)
    ...(PARENTS_ENABLED
      ? ([
          { to: "/admin/students", label: "Students", Icon: GraduationCap },
          { to: "/admin/invites",  label: "Invites",  Icon: Ticket },
        ] as const)
      : []),
  ] as const;

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col">
      <header className="sticky top-0 z-30 backdrop-blur-xl bg-background/70 border-b border-border/50">
        <div className="mx-auto max-w-[1600px] px-3 sm:px-4 lg:px-6 h-14 sm:h-16 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            {role === "admin" && (
              <Button asChild variant="ghost" size="sm" className="px-2 sm:px-3">
                <Link to="/dashboard"><ArrowLeft className="h-4 w-4 sm:mr-1.5" /><span className="hidden sm:inline">Dashboard</span></Link>
              </Button>
            )}
            <Link to="/" className="flex items-center gap-2 font-display font-bold shrink-0">
              <span className="h-8 w-8 grid place-items-center rounded-lg bg-gradient-primary shadow-glow">
                <MapPin className="h-4 w-4 text-primary-foreground" />
              </span>
              <span className="hidden sm:inline">Live Track</span>
            </Link>
            <span className="hidden md:inline-block text-xs uppercase tracking-wider text-muted-foreground border-l border-border pl-3">
              Vehicles &amp; routes
            </span>
          </div>
          <div className="flex items-center gap-1 sm:gap-2">
            <Button variant="ghost" size="icon" onClick={() => signOut()} aria-label="Sign out">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <nav className="mx-auto max-w-[1600px] px-3 sm:px-4 lg:px-6 pb-2 flex gap-2">
          {tabs.map((t) => {
            const active = matchRoute({ to: t.to });
            return (
              <Link
                key={t.to}
                to={t.to}
                className={`flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 h-9 px-4 rounded-full text-xs font-medium border transition-all ${
                  active
                    ? "bg-primary text-primary-foreground border-primary shadow-glow"
                    : "bg-background/50 border-border text-muted-foreground hover:border-primary/40"
                }`}
              >
                <t.Icon className="h-4 w-4" />
                {t.label}
              </Link>
            );
          })}
        </nav>
      </header>

      <main className="flex-1 mx-auto max-w-[1600px] w-full px-3 sm:px-4 lg:px-6 py-4">
        {children}
      </main>
    </div>
  );
}
