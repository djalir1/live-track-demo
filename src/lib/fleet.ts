// Shared data for the Vehicles and Drivers admin pages.
//
//   buses ─┬─ vehicle_assignments (driver ↔ bus over time; ended_at null = current)
//   drivers┘
//
// Changing a vehicle's driver always goes through the assign_driver() RPC, which
// closes the old assignment and lets DB triggers update buses.driver_user_id /
// gps_driver_name for the gps-server and dashboard.
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

// The generated types predate the fleet tables; use an untyped client here.
export const db = supabase as unknown as SupabaseClient;

export interface Bus {
  id: string;
  school_id: string;
  route_id: string | null;
  plate: string | null;
  label: string | null;
  capacity: number | null;
  driver_user_id: string | null;
  gps_imei: string | null;
  gps_driver_name: string | null;
  created_at: string;
}
export interface Driver {
  id: string;
  school_id: string;
  full_name: string;
  phone: string | null;
  license_number: string | null;
  notes: string | null;
  user_id: string | null;
  active: boolean;
  created_at: string;
}
export interface Assignment {
  id: string;
  bus_id: string;
  driver_id: string;
  started_at: string;
  ended_at: string | null;
}
export interface RouteRow {
  id: string;
  name: string;
}
export interface AppAccount {
  id: string;
  display_name: string;
  plate_number: string | null;
}

export interface Fleet {
  schoolId: string | null;
  buses: Bus[];
  drivers: Driver[];
  open: Assignment[]; // current assignments only; history is loaded on demand
  routes: RouteRow[];
  /** Driver-app accounts (role 'user') that aren't gps-server tracker accounts. */
  appAccounts: AppAccount[];
}

export const busName = (b: Pick<Bus, "label" | "plate"> | undefined | null) =>
  b?.label ?? b?.plate ?? "Vehicle";

export async function loadFleet(): Promise<Fleet> {
  const { data: schools, error: sErr } = await db.from("schools").select("id").limit(1);
  if (sErr) throw sErr;
  const schoolId: string | null = schools?.[0]?.id ?? null;
  if (!schoolId) return { schoolId, buses: [], drivers: [], open: [], routes: [], appAccounts: [] };

  const [busesRes, driversRes, openRes, routesRes, profilesRes, rolesRes] = await Promise.all([
    db.from("buses").select("*").eq("school_id", schoolId).order("created_at", { ascending: true }),
    db.from("drivers").select("*").eq("school_id", schoolId).order("full_name"),
    db
      .from("vehicle_assignments")
      .select("id, bus_id, driver_id, started_at, ended_at")
      .eq("school_id", schoolId)
      .is("ended_at", null),
    db.from("routes").select("id, name").eq("school_id", schoolId).order("name"),
    db
      .from("profiles")
      .select("id, display_name, plate_number")
      .eq("school_id", schoolId)
      .order("display_name"),
    db.from("user_roles").select("user_id").eq("role", "user"),
  ]);
  for (const r of [busesRes, driversRes, openRes, routesRes, profilesRes, rolesRes])
    if (r.error) throw r.error;

  const buses = busesRes.data as Bus[];
  const driverRole = new Set((rolesRes.data as { user_id: string }[]).map((r) => r.user_id));
  // A bus in tracker mode (gps_driver_name set) owns its driver_user_id account.
  const trackerAccounts = new Set(
    buses
      .filter((b) => b.gps_driver_name != null && b.driver_user_id)
      .map((b) => b.driver_user_id!),
  );
  return {
    schoolId,
    buses,
    drivers: driversRes.data as Driver[],
    open: openRes.data as Assignment[],
    routes: routesRes.data as RouteRow[],
    appAccounts: (profilesRes.data as AppAccount[]).filter(
      (p) => driverRole.has(p.id) && !trackerAccounts.has(p.id),
    ),
  };
}

export async function loadHistory(
  filter: { busId?: string; driverId?: string },
  limit = 50,
): Promise<Assignment[]> {
  let q = db.from("vehicle_assignments").select("id, bus_id, driver_id, started_at, ended_at");
  if (filter.busId) q = q.eq("bus_id", filter.busId);
  if (filter.driverId) q = q.eq("driver_id", filter.driverId);
  const { data, error } = await q.order("started_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return data as Assignment[];
}

export async function assignDriver(busId: string, driverId: string | null) {
  const { error } = await db.rpc("assign_driver", { p_bus: busId, p_driver: driverId });
  if (error) throw error;
}

const DAY = 86_400_000;
export function formatPeriod(a: Assignment): string {
  const fmt = (iso: string) =>
    new Date(iso).toLocaleString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  const end = a.ended_at ? new Date(a.ended_at).getTime() : Date.now();
  const ms = end - new Date(a.started_at).getTime();
  const span =
    ms >= DAY
      ? `${Math.floor(ms / DAY)} d`
      : ms >= 3_600_000
        ? `${Math.floor(ms / 3_600_000)} h`
        : `${Math.max(1, Math.round(ms / 60_000))} min`;
  return `${fmt(a.started_at)} → ${a.ended_at ? fmt(a.ended_at) : "now"} · ${span}`;
}
