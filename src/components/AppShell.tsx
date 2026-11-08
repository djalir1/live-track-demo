import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import {
  LayoutDashboard,
  Map as MapIcon,
  ClipboardCheck,
  GraduationCap,
  Users,
  UserCheck,
  IdCard,
  Bus,
  Route as RouteIcon,
  Megaphone,
  ShieldAlert,
  BarChart3,
  ListChecks,
  History,
  Bell,
  Fingerprint,
  LogOut,
  Menu,
  Moon,
  Sun,
  Loader2,
  MapPin,
  ChevronsUpDown,
} from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useAuth, canManageSchoolSetup, homeFor } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme";
import { useSchool } from "@/lib/school";
import { db } from "@/lib/fleet";
import { cn } from "@/lib/utils";

// The school / fleet admin layout: a sidebar on desktop, a slide-in menu on
// phones. Every /admin/* page, the live map and trip history use it.

interface NavItem {
  to: string;
  label: string;
  Icon: ComponentType<{ className?: string }>;
  badge?: "alerts";
  soon?: boolean;
}
interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    label: "Today",
    items: [
      { to: "/admin", label: "Overview", Icon: LayoutDashboard },
      { to: "/dashboard", label: "Live map", Icon: MapIcon },
      { to: "/admin/trips", label: "Trips & check-in", Icon: ClipboardCheck },
      { to: "/admin/incidents", label: "Safety alerts", Icon: ShieldAlert, badge: "alerts" },
    ],
  },
  {
    label: "People",
    items: [
      { to: "/admin/students", label: "Students", Icon: GraduationCap },
      { to: "/admin/parents", label: "Parents", Icon: Users },
      { to: "/admin/attendants", label: "Bus attendants", Icon: UserCheck },
      { to: "/admin/drivers", label: "Drivers", Icon: IdCard },
    ],
  },
  {
    label: "Transport",
    items: [
      { to: "/admin/buses", label: "Vehicles", Icon: Bus },
      { to: "/admin/routes", label: "Routes & stops", Icon: RouteIcon },
    ],
  },
  {
    label: "Communication",
    items: [{ to: "/admin/announcements", label: "Announcements", Icon: Megaphone }],
  },
  {
    label: "Reports",
    items: [
      { to: "/admin/reports", label: "Attendance reports", Icon: BarChart3 },
      { to: "/admin/register", label: "Class register", Icon: ListChecks },
      { to: "/history", label: "Trip history", Icon: History },
    ],
  },
  {
    label: "Settings",
    items: [
      { to: "/admin/alerts", label: "My notifications", Icon: Bell },
      { to: "/admin/biometrics", label: "Fingerprint check-in", Icon: Fingerprint, soon: true },
    ],
  },
];

type SchoolState = ReturnType<typeof useSchool>;
const SchoolCtx = createContext<SchoolState | null>(null);
const MenuCtx = createContext<{ open: () => void; alerts: number } | null>(null);

/** Hamburger for full-height pages that draw their own header (phones only). */
export function ShellMenuButton() {
  const m = useContext(MenuCtx);
  if (!m) return null;
  return (
    <button
      onClick={m.open}
      className="lg:hidden relative h-10 w-10 -ml-1 grid place-items-center rounded-lg hover:bg-accent shrink-0"
      aria-label="Open menu"
    >
      <Menu className="h-5 w-5" />
      {m.alerts > 0 && (
        <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-destructive" />
      )}
    </button>
  );
}

/** The school the admin is working on (inside AppShell). */
export function useCurrentSchool(): SchoolState {
  const c = useContext(SchoolCtx);
  if (!c) throw new Error("useCurrentSchool must be used inside AppShell");
  return c;
}

function useOpenAlerts(schoolId: string | null) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!schoolId) return;
    let alive = true;
    const load = () =>
      db
        .from("school_alerts")
        .select("id", { count: "exact", head: true })
        .eq("school_id", schoolId)
        .is("resolved_at", null)
        .then(({ count }) => alive && setN(count ?? 0));
    void load();
    const ch = db
      .channel(`alerts-badge:${schoolId}`)
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
    return () => {
      alive = false;
      void db.removeChannel(ch);
    };
  }, [schoolId]);
  return n;
}

function NavList({ onNavigate, alerts }: { onNavigate?: () => void; alerts: number }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const isActive = (to: string) =>
    to === "/admin"
      ? path === "/admin" || path === "/admin/"
      : path === to || path.startsWith(`${to}/`);
  return (
    <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-5 [scrollbar-width:thin]">
      {NAV.map((g) => (
        <div key={g.label}>
          <div className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80">
            {g.label}
          </div>
          <ul className="space-y-0.5">
            {g.items.map((it) => {
              const active = isActive(it.to);
              return (
                <li key={it.to}>
                  <Link
                    to={it.to}
                    onClick={onNavigate}
                    className={cn(
                      "group relative flex items-center gap-3 h-9 px-3 rounded-lg text-sm transition-colors",
                      active
                        ? "bg-sidebar-accent text-foreground font-medium"
                        : "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/60",
                    )}
                  >
                    {active && (
                      <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r bg-primary" />
                    )}
                    <it.Icon className={cn("h-4 w-4 shrink-0", active && "text-primary")} />
                    <span className="truncate">{it.label}</span>
                    {it.badge === "alerts" && alerts > 0 && (
                      <span className="ml-auto min-w-5 h-5 px-1.5 rounded-full bg-destructive text-[11px] font-semibold text-white grid place-items-center">
                        {alerts > 99 ? "99+" : alerts}
                      </span>
                    )}
                    {it.soon && (
                      <span className="ml-auto text-[9px] font-semibold uppercase tracking-wide rounded px-1.5 py-0.5 bg-warning/15 text-warning">
                        Soon
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function SidebarBody({ onNavigate, alerts }: { onNavigate?: () => void; alerts: number }) {
  const { user, role, signOut } = useAuth();
  const { theme, toggle } = useTheme();
  const { school, schools, setSchoolId } = useCurrentSchool();
  const name =
    (user?.user_metadata?.display_name as string | undefined) ||
    user?.email?.split("@")[0] ||
    "Admin";
  return (
    <div className="h-full flex flex-col bg-sidebar text-sidebar-foreground">
      <div className="h-16 shrink-0 flex items-center gap-2.5 px-5 border-b border-sidebar-border">
        <span className="h-8 w-8 grid place-items-center rounded-lg bg-gradient-primary shadow-glow">
          <MapPin className="h-4 w-4 text-primary-foreground" />
        </span>
        <div className="min-w-0">
          <div className="font-display font-bold leading-tight">Live Track</div>
          <div className="text-[11px] text-muted-foreground leading-tight">School transport</div>
        </div>
      </div>

      <div className="px-3 pt-3">
        <label className="relative flex items-center gap-2 rounded-lg border border-sidebar-border bg-background/40 px-3 h-10 text-sm">
          <GraduationCap className="h-4 w-4 text-primary shrink-0" />
          {role === "admin" && schools.length > 1 ? (
            <>
              <select
                aria-label="School"
                value={school?.id ?? ""}
                onChange={(e) => setSchoolId(e.target.value)}
                className="flex-1 min-w-0 appearance-none bg-transparent outline-none truncate pr-5"
              >
                {schools.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <ChevronsUpDown className="h-3.5 w-3.5 absolute right-3 text-muted-foreground pointer-events-none" />
            </>
          ) : (
            <span className="truncate">{school?.name ?? "No school yet"}</span>
          )}
        </label>
      </div>

      <NavList onNavigate={onNavigate} alerts={alerts} />

      <div className="shrink-0 border-t border-sidebar-border p-3 space-y-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="flex items-center gap-3 px-2">
          <div className="h-8 w-8 rounded-full bg-primary/15 text-primary grid place-items-center text-xs font-bold">
            {name.slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium truncate">{name}</div>
            <div className="text-[11px] text-muted-foreground">
              {role === "admin" ? "Platform admin" : "School admin"}
            </div>
          </div>
          <button
            onClick={toggle}
            className="h-8 w-8 grid place-items-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-sidebar-accent"
            aria-label={theme === "dark" ? "Light mode" : "Dark mode"}
            title={theme === "dark" ? "Light mode" : "Dark mode"}
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          <button
            onClick={() => void signOut()}
            className="h-8 w-8 grid place-items-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10"
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

/** Title of the current page from the nav, for the phone top bar. */
function currentTitle(path: string): string {
  for (const g of NAV)
    for (const it of g.items)
      if (it.to === "/admin" ? path === "/admin" || path === "/admin/" : path.startsWith(it.to))
        return it.label;
  return "Live Track";
}

export function AppShell({
  children,
  bare = false,
}: {
  children: ReactNode;
  /** Full-height pages (map, history) that lay out their own content. */
  bare?: boolean;
}) {
  const { user, role, loading } = useAuth();
  const navigate = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [menuOpen, setMenuOpen] = useState(false);
  const schoolState = useSchool();
  const alerts = useOpenAlerts(schoolState.schoolId);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      navigate({ to: "/auth" });
      return;
    }
    if (role == null) return;
    if (!canManageSchoolSetup(role)) navigate({ to: homeFor(role) });
  }, [loading, user, role, navigate]);

  if (loading || !user || role == null || !canManageSchoolSetup(role)) {
    return (
      <div className="min-h-[100dvh] bg-background grid place-items-center">
        <div className="flex items-center gap-3 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <span>Loading…</span>
        </div>
      </div>
    );
  }

  return (
    <SchoolCtx.Provider value={schoolState}>
      <MenuCtx.Provider value={{ open: () => setMenuOpen(true), alerts }}>
        <div className="h-[100dvh] bg-background flex overflow-hidden">
          <aside className="hidden lg:block w-64 shrink-0 border-r border-sidebar-border">
            <SidebarBody alerts={alerts} />
          </aside>

          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetContent side="left" className="p-0 w-72 max-w-[85vw] border-sidebar-border">
              <SheetTitle className="sr-only">Menu</SheetTitle>
              <SidebarBody onNavigate={() => setMenuOpen(false)} alerts={alerts} />
            </SheetContent>
          </Sheet>

          <div className="flex-1 min-w-0 flex flex-col">
            <div
              className={cn(
                "lg:hidden shrink-0 pt-safe border-b border-border/60 bg-background/80 backdrop-blur-xl",
                bare && "hidden",
              )}
            >
              <div className="h-12 px-2 flex items-center gap-1">
                <button
                  onClick={() => setMenuOpen(true)}
                  className="relative h-10 w-10 grid place-items-center rounded-lg hover:bg-accent"
                  aria-label="Open menu"
                >
                  <Menu className="h-5 w-5" />
                  {alerts > 0 && (
                    <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-destructive" />
                  )}
                </button>
                <span className="font-display font-semibold truncate">{currentTitle(path)}</span>
              </div>
            </div>
            {bare ? (
              <div className="flex-1 min-h-0">{children}</div>
            ) : (
              <main className="flex-1 min-h-0 overflow-y-auto">
                <div className="mx-auto max-w-[1400px] w-full px-4 sm:px-6 lg:px-8 py-5 sm:py-7 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
                  {children}
                </div>
              </main>
            )}
          </div>
        </div>
      </MenuCtx.Provider>
    </SchoolCtx.Provider>
  );
}

/** Page heading used by the school pages. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between mb-6">
      <div className="min-w-0">
        <h1 className="font-display text-2xl sm:text-[28px] font-bold tracking-tight">{title}</h1>
        {description && (
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">{description}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
