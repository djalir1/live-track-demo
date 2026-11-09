import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import * as HoverCard from "@radix-ui/react-hover-card";
import * as Menu from "@radix-ui/react-dropdown-menu";
import {
  Bus,
  Bell,
  LogOut,
  Menu as MenuIcon,
  Moon,
  Sun,
  Loader2,
  MapPin,
  ChevronDown,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Smartphone,
  Navigation,
  Check,
  School,
} from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { CommandPalette } from "@/components/CommandPalette";
import { NAV, NAV_PAGES, isGroup, type NavGroup, type NavItem } from "@/components/nav";
import { useAuth, canManageSchoolSetup, homeFor } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme";
import { useSchool } from "@/lib/school";
import { db } from "@/lib/fleet";
import { cn } from "@/lib/utils";

// The school / fleet admin layout.
//   Desktop: sidebar (full, or a slim icon rail — toggle next to the logo,
//            remembered on this device; groups open as flyouts on hover).
//   Phone:   top bar + slide-in menu.
//   Always:  top bar with page title, search (Ctrl K), alerts, user menu.

export function isActivePath(path: string, to: string) {
  if (to === "/admin") return path === "/admin" || path === "/admin/";
  return path === to || path.startsWith(`${to}/`);
}

// ── Shared state ────────────────────────────────────────────────────────────
type SchoolState = ReturnType<typeof useSchool>;
const SchoolCtx = createContext<SchoolState | null>(null);

/** The school the admin is working on (inside AppShell). */
export function useCurrentSchool(): SchoolState {
  const c = useContext(SchoolCtx);
  if (!c) throw new Error("useCurrentSchool must be used inside AppShell");
  return c;
}

/** Kept for pages that used to draw their own menu button (now in the top bar). */
export function ShellMenuButton() {
  return null;
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

const COLLAPSE_KEY = "lt-sidebar-collapsed";
function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

// ── Sidebar pieces ──────────────────────────────────────────────────────────
function Badge({ n }: { n: number }) {
  if (!n) return null;
  return (
    <span className="ml-auto min-w-5 h-5 px-1.5 rounded-full bg-destructive text-[11px] font-semibold text-white grid place-items-center">
      {n > 99 ? "99+" : n}
    </span>
  );
}

function Soon() {
  return (
    <span className="ml-auto text-[9px] font-semibold uppercase tracking-wide rounded px-1.5 py-0.5 bg-warning/15 text-warning">
      Soon
    </span>
  );
}

const rowBase =
  "group relative flex items-center gap-3 h-9 px-3 rounded-lg text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60";
const rowIdle = "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/70";
const rowActive = "bg-sidebar-accent text-foreground font-medium";

function NavLink({
  item,
  active,
  alerts,
  onNavigate,
  nested,
}: {
  item: NavItem;
  active: boolean;
  alerts: number;
  onNavigate?: () => void;
  nested?: boolean;
}) {
  return (
    <Link
      to={item.to}
      onClick={onNavigate}
      className={cn(rowBase, active ? rowActive : rowIdle, nested && "pl-10 h-8")}
    >
      {active && !nested && (
        <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r bg-primary" />
      )}
      {nested ? (
        <span
          className={cn(
            "absolute left-[22px] h-1.5 w-1.5 rounded-full",
            active ? "bg-primary" : "bg-border",
          )}
        />
      ) : (
        <item.Icon className={cn("h-[18px] w-[18px] shrink-0", active && "text-primary")} />
      )}
      <span className="truncate">{item.label}</span>
      {item.badge === "alerts" && <Badge n={alerts} />}
      {item.soon && <Soon />}
    </Link>
  );
}

/** Full sidebar navigation: single links + collapsible groups. */
function ExpandedNav({ alerts, onNavigate }: { alerts: number; onNavigate?: () => void }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const activeGroup = NAV.find(
    (e) => isGroup(e) && e.items.some((i) => isActivePath(path, i.to)),
  ) as NavGroup | undefined;
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    activeGroup ? { [activeGroup.id]: true } : { families: true },
  );
  useEffect(() => {
    if (activeGroup) setOpen((o) => (o[activeGroup.id] ? o : { ...o, [activeGroup.id]: true }));
  }, [activeGroup]);

  return (
    <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-0.5 [scrollbar-width:thin]">
      {NAV.map((e) => {
        if (!isGroup(e))
          return (
            <NavLink
              key={e.to}
              item={e}
              active={isActivePath(path, e.to)}
              alerts={alerts}
              onNavigate={onNavigate}
            />
          );
        const isOpen = !!open[e.id];
        const childActive = e.items.some((i) => isActivePath(path, i.to));
        return (
          <div key={e.id} className="pt-0.5">
            <button
              onClick={() => setOpen((o) => ({ ...o, [e.id]: !o[e.id] }))}
              aria-expanded={isOpen}
              className={cn(rowBase, "w-full", childActive && !isOpen ? rowActive : rowIdle)}
            >
              <e.Icon className={cn("h-[18px] w-[18px] shrink-0", childActive && "text-primary")} />
              <span className="truncate">{e.label}</span>
              <ChevronDown
                className={cn(
                  "ml-auto h-4 w-4 text-muted-foreground transition-transform",
                  isOpen && "rotate-180",
                )}
              />
            </button>
            <div
              className={cn(
                "grid transition-[grid-template-rows] duration-200",
                isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
              )}
            >
              <div className="overflow-hidden">
                <div className="relative py-0.5">
                  <span
                    className="absolute left-[25px] top-1 bottom-1 w-px bg-border"
                    aria-hidden
                  />
                  {e.items.map((i) => (
                    <NavLink
                      key={i.to}
                      item={i}
                      nested
                      active={isActivePath(path, i.to)}
                      alerts={alerts}
                      onNavigate={onNavigate}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </nav>
  );
}

/** Slim icon rail: hover (or keyboard focus) an icon to see its name or menu. */
function RailNav({ alerts }: { alerts: number }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  return (
    <nav className="flex-1 overflow-y-auto overflow-x-hidden py-3 flex flex-col items-center gap-1 [scrollbar-width:none]">
      {NAV.map((e) => {
        const items = isGroup(e) ? e.items : [e];
        const active = items.some((i) => isActivePath(path, i.to));
        const hasAlert = items.some((i) => i.badge === "alerts") && alerts > 0;
        const first = items[0];
        return (
          <HoverCard.Root key={isGroup(e) ? e.id : e.to} openDelay={40} closeDelay={120}>
            <HoverCard.Trigger asChild>
              <Link
                to={first.to}
                aria-label={e.label}
                className={cn(
                  "relative h-10 w-10 grid place-items-center rounded-xl transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
                  active
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent",
                )}
              >
                <e.Icon className="h-5 w-5" />
                {hasAlert && (
                  <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-destructive" />
                )}
                {isGroup(e) && (
                  <ChevronRight className="absolute -right-0.5 bottom-0.5 h-3 w-3 opacity-50" />
                )}
              </Link>
            </HoverCard.Trigger>
            <HoverCard.Portal>
              <HoverCard.Content
                side="right"
                align="start"
                sideOffset={10}
                className="z-[60] min-w-[200px] rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-2xl data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-left-1"
              >
                {isGroup(e) ? (
                  <>
                    <div className="px-2.5 pt-1 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      {e.label}
                    </div>
                    {e.items.map((i) => {
                      const on = isActivePath(path, i.to);
                      return (
                        <Link
                          key={i.to}
                          to={i.to}
                          className={cn(
                            "flex items-center gap-2.5 h-9 px-2.5 rounded-lg text-sm",
                            on ? "bg-muted text-primary font-medium" : "hover:bg-muted",
                          )}
                        >
                          <i.Icon className="h-4 w-4" />
                          <span className="flex-1">{i.label}</span>
                          {i.badge === "alerts" && <Badge n={alerts} />}
                          {i.soon && <Soon />}
                        </Link>
                      );
                    })}
                  </>
                ) : (
                  <div className="flex items-center gap-2 px-2.5 py-1.5 text-sm font-medium">
                    {e.label}
                    {e.badge === "alerts" && <Badge n={alerts} />}
                  </div>
                )}
              </HoverCard.Content>
            </HoverCard.Portal>
          </HoverCard.Root>
        );
      })}
    </nav>
  );
}

function SchoolSwitcher({ compact }: { compact?: boolean }) {
  const { role } = useAuth();
  const { school, schools, setSchoolId } = useCurrentSchool();
  const canSwitch = role === "admin" && schools.length > 1;
  const body = (
    <span className="flex items-center gap-2.5 min-w-0 w-full">
      <span className="h-7 w-7 rounded-lg bg-primary/12 text-primary grid place-items-center shrink-0">
        <School className="h-4 w-4" />
      </span>
      {!compact && (
        <>
          <span className="min-w-0 flex-1 text-left">
            <span className="block text-sm font-medium truncate">
              {school?.name ?? "No school yet"}
            </span>
            <span className="block text-[11px] text-muted-foreground">School</span>
          </span>
          {canSwitch && <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </>
      )}
    </span>
  );
  if (!canSwitch)
    return (
      <div
        className={cn(
          "rounded-xl border border-sidebar-border bg-background/40",
          compact ? "p-1.5" : "px-2.5 py-2",
        )}
        title={school?.name}
      >
        {body}
      </div>
    );
  return (
    <Menu.Root>
      <Menu.Trigger
        className={cn(
          "w-full rounded-xl border border-sidebar-border bg-background/40 hover:border-primary/40 outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
          compact ? "p-1.5" : "px-2.5 py-2",
        )}
        title={school?.name}
      >
        {body}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          side={compact ? "right" : "bottom"}
          align="start"
          sideOffset={8}
          className="z-[60] min-w-[220px] rounded-xl border border-border bg-popover p-1.5 shadow-2xl"
        >
          <Menu.Label className="px-2.5 pt-1 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Switch school
          </Menu.Label>
          {schools.map((s) => (
            <Menu.Item
              key={s.id}
              onSelect={() => setSchoolId(s.id)}
              className="flex items-center gap-2 h-9 px-2.5 rounded-lg text-sm outline-none cursor-pointer data-[highlighted]:bg-muted"
            >
              <span className="flex-1 truncate">{s.name}</span>
              {s.id === school?.id && <Check className="h-4 w-4 text-primary" />}
            </Menu.Item>
          ))}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

function Brand({ compact }: { compact?: boolean }) {
  return (
    <Link to="/admin" className="flex items-center gap-2.5 min-w-0" aria-label="Live Track home">
      <span className="h-9 w-9 grid place-items-center rounded-xl bg-gradient-primary shadow-glow shrink-0">
        <MapPin className="h-4 w-4 text-primary-foreground" />
      </span>
      {!compact && (
        <span className="min-w-0">
          <span className="block font-display font-bold leading-tight">Live Track</span>
          <span className="block text-[11px] text-muted-foreground leading-tight">
            School transport
          </span>
        </span>
      )}
    </Link>
  );
}

// ── Top bar ─────────────────────────────────────────────────────────────────
function UserMenu() {
  const { user, role, signOut } = useAuth();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  const name =
    (user?.user_metadata?.display_name as string | undefined) ||
    user?.email?.split("@")[0] ||
    "Admin";
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
  const item =
    "flex items-center gap-2.5 h-9 px-2.5 rounded-lg text-sm outline-none cursor-pointer data-[highlighted]:bg-muted";
  return (
    <Menu.Root>
      <Menu.Trigger
        className="flex items-center gap-2 rounded-full pl-1 pr-1 sm:pr-2.5 h-10 hover:bg-accent outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        aria-label="Account menu"
      >
        <span className="h-8 w-8 rounded-full bg-gradient-primary text-primary-foreground grid place-items-center text-xs font-bold">
          {initials}
        </span>
        <span className="hidden sm:block text-left leading-tight">
          <span className="block text-sm font-medium max-w-[140px] truncate">{name}</span>
          <span className="block text-[11px] text-muted-foreground">
            {role === "admin" ? "Platform admin" : "School admin"}
          </span>
        </span>
        <ChevronDown className="hidden sm:block h-4 w-4 text-muted-foreground" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          align="end"
          sideOffset={8}
          className="z-[60] w-64 rounded-xl border border-border bg-popover p-1.5 shadow-2xl data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <div className="px-2.5 py-2">
            <div className="text-sm font-semibold truncate">{name}</div>
            <div className="text-xs text-muted-foreground truncate">{user?.email}</div>
          </div>
          <Menu.Separator className="my-1 h-px bg-border" />
          <Menu.Item className={item} onSelect={() => navigate({ to: "/admin/alerts" })}>
            <Bell className="h-4 w-4 text-muted-foreground" /> My notifications
          </Menu.Item>
          <Menu.Item className={item} onSelect={() => navigate({ to: "/bus" })}>
            <Smartphone className="h-4 w-4 text-muted-foreground" /> Attendant check-in screen
          </Menu.Item>
          <Menu.Item className={item} onSelect={() => navigate({ to: "/track" })}>
            <Navigation className="h-4 w-4 text-muted-foreground" /> Use this phone as a tracker
          </Menu.Item>
          <Menu.Item
            className={item}
            onSelect={(e) => {
              e.preventDefault();
              toggle();
            }}
          >
            {theme === "dark" ? (
              <Sun className="h-4 w-4 text-muted-foreground" />
            ) : (
              <Moon className="h-4 w-4 text-muted-foreground" />
            )}
            {theme === "dark" ? "Light mode" : "Dark mode"}
          </Menu.Item>
          <Menu.Separator className="my-1 h-px bg-border" />
          <Menu.Item
            className={cn(item, "text-destructive data-[highlighted]:bg-destructive/10")}
            onSelect={() => void signOut()}
          >
            <LogOut className="h-4 w-4" /> Sign out
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

function TopBar({
  onMenu,
  onSearch,
  alerts,
}: {
  onMenu: () => void;
  onSearch: () => void;
  alerts: number;
}) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const page = NAV_PAGES.find((p) => isActivePath(path, p.to));
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  return (
    <header className="shrink-0 z-30 pt-safe border-b border-border/60 bg-background/80 backdrop-blur-xl">
      <div className="h-14 px-2 sm:px-4 lg:px-6 flex items-center gap-2">
        <button
          onClick={onMenu}
          className="lg:hidden relative h-10 w-10 grid place-items-center rounded-lg hover:bg-accent"
          aria-label="Open menu"
        >
          <MenuIcon className="h-5 w-5" />
          {alerts > 0 && (
            <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-destructive" />
          )}
        </button>
        <div className="min-w-0 flex items-center gap-1.5 text-sm">
          {page?.group && (
            <>
              <span className="hidden md:inline text-muted-foreground">{page.group}</span>
              <ChevronRight className="hidden md:inline h-3.5 w-3.5 text-muted-foreground" />
            </>
          )}
          <span className="font-semibold truncate">{page?.label ?? "Live Track"}</span>
        </div>

        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          <button
            onClick={onSearch}
            className="hidden sm:flex items-center gap-2 h-9 w-56 lg:w-72 rounded-lg border border-border bg-muted/40 px-3 text-sm text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors"
          >
            <Search className="h-4 w-4" />
            <span className="flex-1 text-left">Search pages, students…</span>
            <kbd className="text-[10px] font-medium rounded border border-border bg-background px-1.5 py-0.5">
              {isMac ? "⌘K" : "Ctrl K"}
            </kbd>
          </button>
          <button
            onClick={onSearch}
            className="sm:hidden h-10 w-10 grid place-items-center rounded-lg hover:bg-accent"
            aria-label="Search"
          >
            <Search className="h-5 w-5" />
          </button>
          <Link
            to="/admin/incidents"
            className="relative h-10 w-10 grid place-items-center rounded-lg hover:bg-accent"
            aria-label={alerts ? `${alerts} safety alerts` : "Safety alerts"}
            title="Safety alerts"
          >
            <Bell className="h-5 w-5" />
            {alerts > 0 && (
              <span className="absolute top-1.5 right-1.5 min-w-4 h-4 px-1 rounded-full bg-destructive text-[10px] font-bold text-white grid place-items-center">
                {alerts > 9 ? "9+" : alerts}
              </span>
            )}
          </Link>
          <span className="hidden sm:block h-6 w-px bg-border mx-1" />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}

// ── Shell ───────────────────────────────────────────────────────────────────
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
  const [searchOpen, setSearchOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const schoolState = useSchool();
  const alerts = useOpenAlerts(schoolState.schoolId);

  useEffect(() => setCollapsed(readCollapsed()), []);
  useEffect(() => setMenuOpen(false), [path]);

  // Ctrl/⌘ K or "/" opens search anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = /input|textarea|select/i.test((e.target as HTMLElement)?.tagName ?? "");
      if ((e.key.toLowerCase() === "k" && (e.ctrlKey || e.metaKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        setSearchOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggleCollapsed = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1");
      } catch {
        /* ignore */
      }
      return !c;
    });

  useEffect(() => {
    if (loading) return;
    if (!user) {
      navigate({ to: "/auth" });
      return;
    }
    if (role == null) return;
    if (!canManageSchoolSetup(role)) navigate({ to: homeFor(role) });
  }, [loading, user, role, navigate]);

  const shellValue = useMemo(() => schoolState, [schoolState]);

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
    <SchoolCtx.Provider value={shellValue}>
      <div className="h-[100dvh] bg-background flex overflow-hidden">
        {/* Desktop sidebar */}
        <aside
          className={cn(
            "hidden lg:flex flex-col shrink-0 border-r border-sidebar-border bg-sidebar transition-[width] duration-200 ease-out",
            collapsed ? "w-[72px]" : "w-64",
          )}
        >
          <div
            className={cn(
              "h-14 shrink-0 flex items-center border-b border-sidebar-border",
              collapsed ? "justify-center" : "justify-between pl-4 pr-2",
            )}
          >
            {!collapsed && <Brand />}
            <button
              onClick={toggleCollapsed}
              className="h-9 w-9 grid place-items-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-sidebar-accent"
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {collapsed ? (
                <PanelLeftOpen className="h-[18px] w-[18px]" />
              ) : (
                <PanelLeftClose className="h-[18px] w-[18px]" />
              )}
            </button>
          </div>
          <div className={cn("pt-3", collapsed ? "px-3.5" : "px-3")}>
            <SchoolSwitcher compact={collapsed} />
          </div>
          {collapsed ? <RailNav alerts={alerts} /> : <ExpandedNav alerts={alerts} />}
          {collapsed && (
            <div className="shrink-0 pb-3 flex justify-center">
              <Brand compact />
            </div>
          )}
        </aside>

        {/* Phone menu */}
        <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
          <SheetContent
            side="left"
            className="p-0 w-72 max-w-[85vw] border-sidebar-border bg-sidebar flex flex-col"
          >
            <SheetTitle className="sr-only">Menu</SheetTitle>
            <div className="h-14 shrink-0 flex items-center px-4 border-b border-sidebar-border pt-safe">
              <Brand />
            </div>
            <div className="px-3 pt-3">
              <SchoolSwitcher />
            </div>
            <ExpandedNav alerts={alerts} onNavigate={() => setMenuOpen(false)} />
          </SheetContent>
        </Sheet>

        <div className="flex-1 min-w-0 flex flex-col">
          <TopBar
            onMenu={() => setMenuOpen(true)}
            onSearch={() => setSearchOpen(true)}
            alerts={alerts}
          />
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
      <CommandPalette
        open={searchOpen}
        onOpenChange={setSearchOpen}
        schoolId={schoolState.schoolId}
      />
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
