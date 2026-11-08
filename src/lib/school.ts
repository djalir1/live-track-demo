// Shared data for the school attendance screens (school admin, attendant,
// parent). Tables come from supabase/migrations/20261108120000_school_attendance.sql.
import { useEffect, useState } from "react";
import { db } from "@/lib/fleet";
import { useAuth } from "@/lib/auth-context";
import type { NoticeKind, RiderStatus, Run } from "@/lib/attendance";

export interface School {
  id: string;
  name: string;
}

export interface StudentRow {
  id: string;
  school_id: string;
  bus_id: string | null;
  name: string;
  class: string | null;
  student_code: string | null;
  photo_url: string | null;
  home_stop_id: string | null;
  morning_stop_id: string | null;
  afternoon_stop_id: string | null;
  active: boolean;
  notes: string | null;
  photo_consent: boolean;
  biometric_consent: boolean;
  consent_recorded_at: string | null;
  created_at: string;
}

export interface Guardian {
  id: string;
  school_id: string;
  full_name: string;
  phone: string;
  relationship: string | null;
  email: string | null;
  user_id: string | null;
  activation_code: string | null;
  activation_expires_at: string | null;
  activated_at: string | null;
  created_at: string;
}

export interface StudentGuardian {
  student_id: string;
  guardian_id: string;
  is_primary: boolean;
}

export interface Attendant {
  id: string;
  school_id: string;
  full_name: string;
  phone: string;
  bus_id: string | null;
  user_id: string | null;
  active: boolean;
  activation_code: string | null;
  activation_expires_at: string | null;
  activated_at: string | null;
  created_at: string;
}

export interface StopRow {
  id: string;
  route_id: string;
  school_id: string;
  name: string;
  lat: number | null;
  lng: number | null;
  radius_m: number;
  sequence: number | null;
  type: "pickup" | "school";
  morning_time: string | null;
  afternoon_time: string | null;
}

export interface RouteRow {
  id: string;
  school_id: string;
  name: string;
}

export interface BusLite {
  id: string;
  school_id: string;
  route_id: string | null;
  label: string | null;
  plate: string | null;
  capacity: number | null;
  driver_user_id: string | null;
  gps_imei: string | null;
  gps_driver_name: string | null;
}

export interface Trip {
  id: string;
  school_id: string;
  bus_id: string;
  route_id: string | null;
  service_date: string;
  run: Run;
  status: "open" | "closed";
  opened_at: string;
  closed_at: string | null;
  empty_checked_at: string | null;
  note: string | null;
}

export interface TripRider {
  trip_id: string;
  student_id: string;
  school_id: string;
  stop_id: string | null;
  status: RiderStatus;
  notice_kind: NoticeKind | null;
  wrong_bus: boolean;
  boarded_at: string | null;
  dropped_at: string | null;
  method: string | null;
  updated_at: string;
}

export interface RideNotice {
  id: string;
  student_id: string;
  service_date: string;
  run: Run | "both";
  kind: NoticeKind;
  note: string | null;
  created_at: string;
  cancelled_at: string | null;
}

export interface Announcement {
  id: number;
  school_id: string;
  bus_id: string | null;
  kind: string;
  delay_min: number | null;
  message: string;
  recipients: number;
  created_at: string;
}

export interface SchoolAlert {
  id: number;
  school_id: string;
  bus_id: string | null;
  trip_id: string | null;
  student_id: string | null;
  kind: string;
  severity: "info" | "warning" | "urgent";
  message: string;
  created_at: string;
  resolved_at: string | null;
}

export interface ParentNotification {
  id: number;
  student_id: string | null;
  kind: string;
  title: string;
  body: string;
  url: string;
  created_at: string;
  read_at: string | null;
}

export const busName = (b: Pick<BusLite, "label" | "plate"> | null | undefined) =>
  b?.label?.trim() || b?.plate?.trim() || "Bus";

export const ALERT_KIND_LABEL: Record<string, string> = {
  no_show: "No-show",
  wrong_bus: "Wrong bus",
  not_dropped: "Child left on bus",
  far_dropoff: "Off at the wrong place",
  left_at_school: "Left at school",
  missing: "Missing",
  incident: "Incident",
};

/** First letters of a name, for avatars without a photo. */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

/**
 * The school the signed-in admin manages. School admins have one (profile);
 * super admins pick one (remembered on this device), defaulting to the first.
 */
export function useSchool() {
  const { user, role } = useAuth();
  const [schools, setSchools] = useState<School[]>([]);
  const [schoolId, setSchoolIdState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user || !role) return;
    let alive = true;
    (async () => {
      setLoading(true);
      const [{ data: prof }, { data: list, error: e }] = await Promise.all([
        db.from("profiles").select("school_id").eq("id", user.id).maybeSingle(),
        db.from("schools").select("id, name").order("name"),
      ]);
      if (!alive) return;
      if (e) setError(e.message);
      const all = (list ?? []) as School[];
      setSchools(all);
      let stored: string | null = null;
      try {
        stored = localStorage.getItem("lt-school");
      } catch {
        /* private mode */
      }
      const pick =
        (role === "admin" && stored && all.find((s) => s.id === stored)?.id) ||
        (prof?.school_id as string | null) ||
        all[0]?.id ||
        null;
      setSchoolIdState(pick);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [user, role]);

  const setSchoolId = (id: string) => {
    setSchoolIdState(id);
    try {
      localStorage.setItem("lt-school", id);
    } catch {
      /* ignore */
    }
  };

  const school = schools.find((s) => s.id === schoolId) ?? null;
  return { school, schoolId, schools, setSchoolId, loading, error };
}

/** Is the database ready for attendance (migration applied)? */
export function isMissingTable(err: { message?: string; code?: string } | null | undefined) {
  return (
    !!err &&
    (err.code === "PGRST205" ||
      err.code === "42P01" ||
      /does not exist|schema cache/i.test(err.message ?? ""))
  );
}

export const MIGRATION_HINT =
  "The attendance tables aren't in this database yet. Apply supabase/migrations/20261108110000_attendant_role.sql and 20261108120000_school_attendance.sql (staging first).";
