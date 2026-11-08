// Everything the school screens need about one school day, kept live with
// Supabase Realtime: buses (+ live position), trips, every child's status,
// open safety alerts and the latest check-ins.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { db } from "@/lib/fleet";
import { countTrip, type TripCounts } from "@/lib/attendance";
import {
  isMissingTable,
  type BusLite,
  type RideNotice,
  type SchoolAlert,
  type StopRow,
  type StudentRow,
  type Trip,
  type TripRider,
} from "@/lib/school";

export interface LivePos {
  user_id: string;
  latitude: number | null;
  longitude: number | null;
  speed_kmh: number | null;
  is_tracking: boolean;
  last_seen: string;
}

export interface BoardingEvent {
  id: number;
  trip_id: string;
  bus_id: string | null;
  student_id: string;
  action: string;
  occurred_at: string;
  method: string;
}

export interface SchoolDay {
  loading: boolean;
  missing: boolean;
  buses: BusLite[];
  trips: Trip[];
  riders: TripRider[];
  students: Map<string, StudentRow>;
  stops: StopRow[];
  positions: Map<string, LivePos>;
  alerts: SchoolAlert[];
  events: BoardingEvent[];
  notices: RideNotice[];
  attendantByBus: Map<string, string>;
  reload: () => Promise<void>;
  tripFor: (busId: string, run: "morning" | "afternoon") => Trip | undefined;
  countsFor: (tripId: string) => TripCounts;
}

export function useSchoolDay(schoolId: string | null, date: string): SchoolDay {
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [buses, setBuses] = useState<BusLite[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [riders, setRiders] = useState<TripRider[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [stops, setStops] = useState<StopRow[]>([]);
  const [positions, setPositions] = useState<Map<string, LivePos>>(new Map());
  const [alerts, setAlerts] = useState<SchoolAlert[]>([]);
  const [events, setEvents] = useState<BoardingEvent[]>([]);
  const [notices, setNotices] = useState<RideNotice[]>([]);
  const [attendants, setAttendants] = useState<
    { bus_id: string | null; full_name: string; active: boolean }[]
  >([]);
  const tripIds = useRef<string[]>([]);

  const reload = useCallback(async () => {
    if (!schoolId) return;
    const [b, t, s, st, a, n, at] = await Promise.all([
      db.from("buses").select("*").eq("school_id", schoolId).order("label"),
      db.from("bus_trips").select("*").eq("school_id", schoolId).eq("service_date", date),
      db.from("students").select("*").eq("school_id", schoolId),
      db.from("stops").select("*").eq("school_id", schoolId),
      db
        .from("school_alerts")
        .select("*")
        .eq("school_id", schoolId)
        .is("resolved_at", null)
        .order("created_at", { ascending: false })
        .limit(50),
      db
        .from("ride_notices")
        .select("*")
        .eq("school_id", schoolId)
        .eq("service_date", date)
        .is("cancelled_at", null),
      db.from("attendants").select("bus_id, full_name, active").eq("school_id", schoolId),
    ]);
    if (isMissingTable(t.error)) {
      setMissing(true);
      setLoading(false);
      setBuses((b.data ?? []) as BusLite[]);
      return;
    }
    const tr = (t.data ?? []) as Trip[];
    tripIds.current = tr.map((x) => x.id);
    const [r, e] = tr.length
      ? await Promise.all([
          db.from("trip_students").select("*").in("trip_id", tripIds.current),
          db
            .from("boarding_events")
            .select("id, trip_id, bus_id, student_id, action, occurred_at, method")
            .in("trip_id", tripIds.current)
            .order("occurred_at", { ascending: false })
            .limit(30),
        ])
      : [{ data: [] }, { data: [] }];
    const bs = (b.data ?? []) as BusLite[];
    const uids = bs.map((x) => x.driver_user_id).filter(Boolean) as string[];
    const p = uids.length
      ? await db
          .from("device_status")
          .select("user_id, latitude, longitude, speed_kmh, is_tracking, last_seen")
          .in("user_id", uids)
      : { data: [] };
    setBuses(bs);
    setTrips(tr);
    setRiders((r.data ?? []) as TripRider[]);
    setEvents((e.data ?? []) as BoardingEvent[]);
    setStudents((s.data ?? []) as StudentRow[]);
    setStops((st.data ?? []) as StopRow[]);
    setAlerts((a.data ?? []) as SchoolAlert[]);
    setNotices((n.data ?? []) as RideNotice[]);
    setAttendants((at.data ?? []) as typeof attendants);
    setPositions(new Map(((p.data ?? []) as LivePos[]).map((x) => [x.user_id, x])));
    setLoading(false);
  }, [schoolId, date]);

  useEffect(() => {
    setLoading(true);
    void reload();
  }, [reload]);

  // Live updates. Bursts of changes (e.g. "everyone off") are coalesced.
  useEffect(() => {
    if (!schoolId || missing) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const soon = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        void reload();
      }, 600);
    };
    const ch = db
      .channel(`school-day:${schoolId}:${date}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "trip_students",
          filter: `school_id=eq.${schoolId}`,
        },
        soon,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "bus_trips", filter: `school_id=eq.${schoolId}` },
        soon,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "school_alerts",
          filter: `school_id=eq.${schoolId}`,
        },
        soon,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "device_status" },
        (payload) => {
          const row = payload.new as LivePos | undefined;
          if (!row?.user_id) return;
          setPositions((m) => (m.has(row.user_id) ? new Map(m).set(row.user_id, row) : m));
        },
      )
      .subscribe();
    const iv = setInterval(() => void reload(), 60_000);
    return () => {
      if (timer) clearTimeout(timer);
      clearInterval(iv);
      void db.removeChannel(ch);
    };
  }, [schoolId, date, missing, reload]);

  const studentMap = useMemo(() => new Map(students.map((s) => [s.id, s])), [students]);
  const attendantByBus = useMemo(
    () =>
      new Map(attendants.filter((a) => a.active && a.bus_id).map((a) => [a.bus_id!, a.full_name])),
    [attendants],
  );
  const ridersByTrip = useMemo(() => {
    const m = new Map<string, TripRider[]>();
    for (const r of riders) m.set(r.trip_id, [...(m.get(r.trip_id) ?? []), r]);
    return m;
  }, [riders]);

  return {
    loading,
    missing,
    buses,
    trips,
    riders,
    students: studentMap,
    stops,
    positions,
    alerts,
    events,
    notices,
    attendantByBus,
    reload,
    tripFor: (busId, run) => trips.find((t) => t.bus_id === busId && t.run === run),
    countsFor: (tripId) => countTrip(ridersByTrip.get(tripId) ?? []),
  };
}

export type BusLiveState = "moving" | "parked" | "offline" | "no_tracker";

export function busLiveState(
  bus: BusLite,
  positions: Map<string, LivePos>,
  now = Date.now(),
): BusLiveState {
  const p = bus.driver_user_id ? positions.get(bus.driver_user_id) : undefined;
  if (!p) return "no_tracker";
  if (now - new Date(p.last_seen).getTime() > 10 * 60_000) return "offline";
  return p.is_tracking && (p.speed_kmh ?? 0) > 3 ? "moving" : p.is_tracking ? "parked" : "parked";
}
