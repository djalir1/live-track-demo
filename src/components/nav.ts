import type { ComponentType } from "react";
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
  Settings,
} from "lucide-react";

// Admin navigation, ordered by how often a school uses each page.

export interface NavItem {
  to: string;
  label: string;
  Icon: ComponentType<{ className?: string }>;
  badge?: "alerts";
  soon?: boolean;
  /** Extra words the search finds this page by. */
  keywords?: string;
}
export interface NavGroup {
  id: string;
  label: string;
  Icon: ComponentType<{ className?: string }>;
  items: NavItem[];
}
export type NavEntry = NavItem | NavGroup;
export const isGroup = (e: NavEntry): e is NavGroup => "items" in e;

// Four everyday pages on top, then everything else in plain sections
// (always visible — no menus to open).
export const NAV: NavEntry[] = [
  { to: "/admin", label: "Overview", Icon: LayoutDashboard, keywords: "home dashboard today" },
  { to: "/dashboard", label: "Live map", Icon: MapIcon, keywords: "gps where bus position" },
  {
    to: "/admin/trips",
    label: "Today's trips",
    Icon: ClipboardCheck,
    keywords: "attendance boarding on board list check-in",
  },
  {
    to: "/admin/incidents",
    label: "Safety alerts",
    Icon: ShieldAlert,
    badge: "alerts",
    keywords: "incident no-show wrong bus",
  },
  {
    id: "people",
    label: "People",
    Icon: GraduationCap,
    items: [
      {
        to: "/admin/students",
        label: "Students",
        Icon: GraduationCap,
        keywords: "children pupils kids register import",
      },
      {
        to: "/admin/parents",
        label: "Parents",
        Icon: Users,
        keywords: "guardians activation codes password",
      },
      { to: "/admin/attendants", label: "Bus attendants", Icon: UserCheck, keywords: "staff" },
      { to: "/admin/drivers", label: "Drivers", Icon: IdCard },
    ],
  },
  {
    id: "fleet",
    label: "Buses & routes",
    Icon: Bus,
    items: [
      { to: "/admin/buses", label: "Buses", Icon: Bus, keywords: "vehicle tracker gps imei" },
      {
        to: "/admin/routes",
        label: "Routes & stops",
        Icon: RouteIcon,
        keywords: "stop pickup map",
      },
    ],
  },
  {
    id: "reports",
    label: "Messages & reports",
    Icon: BarChart3,
    items: [
      {
        to: "/admin/announcements",
        label: "Messages to parents",
        Icon: Megaphone,
        keywords: "announcement sms notify",
      },
      {
        to: "/admin/reports",
        label: "Attendance reports",
        Icon: BarChart3,
        keywords: "excel pdf monthly export boarded not boarded",
      },
      {
        to: "/admin/register",
        label: "Class register",
        Icon: ListChecks,
        keywords: "present absent roll call",
      },
      {
        to: "/history",
        label: "Bus trip history",
        Icon: History,
        keywords: "km distance route day week",
      },
    ],
  },
  {
    id: "settings",
    label: "Settings",
    Icon: Settings,
    items: [
      { to: "/admin/alerts", label: "My notifications", Icon: Bell, keywords: "push phone alerts" },
      { to: "/admin/biometrics", label: "Fingerprint check-in", Icon: Fingerprint, soon: true },
    ],
  },
];

/** Every page, flat (for search and titles). */
export const NAV_PAGES: (NavItem & { group?: string })[] = NAV.flatMap((e) =>
  isGroup(e) ? e.items.map((i) => ({ ...i, group: e.label })) : [e],
);
