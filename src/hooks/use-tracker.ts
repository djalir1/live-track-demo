import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import type { Database } from "@/integrations/supabase/types";

type TrackingStatus = Database["public"]["Enums"]["tracking_status"];

export type PermissionState = "unknown" | "prompt" | "granted" | "denied" | "unsupported";

export interface LiveStats {
  isTracking: boolean;
  status: TrackingStatus;
  latitude: number | null;
  longitude: number | null;
  speedKmh: number;
  accuracy: number | null;
  heading: number | null;
  totalDistanceM: number;
  batteryLevel: number | null;
  online: boolean;
  gpsActive: boolean;
  lastUpdate: number | null;
  error: string | null;
  permission: PermissionState;
}

const initial: LiveStats = {
  isTracking: false,
  status: "offline",
  latitude: null,
  longitude: null,
  speedKmh: 0,
  accuracy: null,
  heading: null,
  totalDistanceM: 0,
  batteryLevel: null,
  online: typeof navigator !== "undefined" ? navigator.onLine : true,
  gpsActive: false,
  lastUpdate: null,
  error: null,
  permission: "unknown",
};

// Haversine in meters
function distance(a: [number, number], b: [number, number]) {
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]);
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function useTracker() {
  const { user } = useAuth();
  const userIdRef = useRef<string | null>(user?.id ?? null);
  useEffect(() => {
    userIdRef.current = user?.id ?? null;
  }, [user]);
  const [stats, setStats] = useState<LiveStats>(initial);
  const watchId = useRef<number | null>(null);
  const lastPos = useRef<[number, number] | null>(null);
  const lastPosTime = useRef<number | null>(null);
  const lastSent = useRef(0);
  const idleTimer = useRef<number | null>(null);
  const batteryRef = useRef<{ level: number | null }>({ level: null });
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);

  // Keep the screen on while tracking so the tab isn't backgrounded/throttled.
  // Re-acquire the lock if the tab becomes visible again (browsers drop it on hide).
  const acquireWakeLock = useCallback(async () => {
    try {
      const nav = navigator as Navigator & {
        wakeLock?: {
          request: (type: "screen") => Promise<{
            release: () => Promise<void>;
            addEventListener: (e: string, cb: () => void) => void;
          }>;
        };
      };
      if (!nav.wakeLock) return;
      const lock = await nav.wakeLock.request("screen");
      wakeLockRef.current = lock;
      lock.addEventListener("release", () => {
        wakeLockRef.current = null;
      });
    } catch {
      // Some browsers throw if the tab isn't focused. That's fine — no-op.
    }
  }, []);
  const releaseWakeLock = useCallback(async () => {
    try {
      await wakeLockRef.current?.release();
    } catch {
      /* noop */
    }
    wakeLockRef.current = null;
  }, []);

  useEffect(() => {
    const onVis = () => {
      if (
        document.visibilityState === "visible" &&
        watchId.current != null &&
        !wakeLockRef.current
      ) {
        void acquireWakeLock();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [acquireWakeLock]);

  // online/offline
  useEffect(() => {
    const on = () => setStats((s) => ({ ...s, online: true }));
    const off = () => setStats((s) => ({ ...s, online: false }));
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  // battery
  useEffect(() => {
    type Battery = { level: number; addEventListener: (e: string, cb: () => void) => void };
    type NavWithBattery = Navigator & { getBattery?: () => Promise<Battery> };
    const nav = navigator as NavWithBattery;
    if (!nav.getBattery) return;
    let bat: Battery | null = null;
    const update = () => {
      if (!bat) return;
      const lvl = Math.round(bat.level * 100);
      batteryRef.current.level = lvl;
      setStats((s) => ({ ...s, batteryLevel: lvl }));
    };
    nav
      .getBattery()
      .then((b) => {
        bat = b;
        b.addEventListener("levelchange", update);
        update();
      })
      .catch(() => {});
  }, []);

  // permission state
  useEffect(() => {
    if (typeof navigator === "undefined") return;
    if (!("geolocation" in navigator)) {
      setStats((s) => ({ ...s, permission: "unsupported" }));
      return;
    }
    const nav = navigator as Navigator & {
      permissions?: {
        query: (d: {
          name: string;
        }) => Promise<{ state: string; onchange: ((e: Event) => void) | null }>;
      };
    };
    if (!nav.permissions?.query) return;
    let res: { state: string; onchange: ((e: Event) => void) | null } | null = null;
    nav.permissions
      .query({ name: "geolocation" })
      .then((r) => {
        res = r;
        setStats((s) => ({ ...s, permission: r.state as PermissionState }));
        r.onchange = () => setStats((s) => ({ ...s, permission: r.state as PermissionState }));
      })
      .catch(() => {});
    return () => {
      if (res) res.onchange = null;
    };
  }, []);

  const persist = useCallback(
    async (next: Partial<LiveStats>, status: TrackingStatus, isTracking: boolean) => {
      const uid = userIdRef.current;
      if (!uid) return;
      try {
        const lat = next.latitude ?? null;
        const lon = next.longitude ?? null;

        const row = {
          user_id: uid,
          status,
          latitude: lat,
          longitude: lon,
          speed_kmh: next.speedKmh ?? 0,
          heading: next.heading ?? null,
          accuracy: next.accuracy ?? null,
          battery_level: batteryRef.current.level,
          is_tracking: isTracking,
          total_distance_m: next.totalDistanceM ?? 0,
          last_seen: new Date().toISOString(),
        };
        let { error: statusErr } = await supabase.from("device_status").upsert(row);
        // RLS/JWT can transiently fail right after signup while the auth token
        // is still being attached to the client. Retry with backoff before
        // ever surfacing anything to the user — never toast these.
        let attempt = 0;
        while (
          statusErr &&
          attempt < 3 &&
          /row-level|JWT|token|permission|auth/i.test(statusErr.message)
        ) {
          attempt++;
          await new Promise((r) => setTimeout(r, 400 * attempt));
          ({ error: statusErr } = await supabase.from("device_status").upsert(row));
        }
        if (statusErr) {
          // Only surface non-transient errors (e.g. network down, DB constraint).
          const transient = /row-level|JWT|token|permission|auth/i.test(statusErr.message);
          console.error("[tracker] device_status upsert error", statusErr);
          if (!transient) setStats((s) => ({ ...s, error: statusErr.message }));
        } else {
          setStats((s) => (s.error ? { ...s, error: null } : s));
        }

        if (lat != null && lon != null && isTracking) {
          const { error: histErr } = await supabase.from("location_history").insert({
            user_id: uid,
            latitude: lat,
            longitude: lon,
            speed_kmh: next.speedKmh ?? 0,
            battery_level: batteryRef.current.level,
          });
          if (histErr) console.error("[tracker] location_history insert error", histErr);
        }
      } catch (e) {
        console.error("[tracker] persist exception", e);
      }
    },
    [],
  );

  const start = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setStats((s) => ({ ...s, error: "Geolocation not supported" }));
      return;
    }
    setStats((s) => ({ ...s, isTracking: true, status: "idle", error: null }));
    void acquireWakeLock();

    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        const now = Date.now();

        let added = 0;
        let computedSpeedKmh = 0;
        const accuracy = pos.coords.accuracy ?? 50;
        if (lastPos.current && lastPosTime.current) {
          added = distance(lastPos.current, [lat, lon]);
          const dt = (now - lastPosTime.current) / 1000;
          // Only count movement if larger than GPS noise floor
          if (dt > 0 && added > Math.min(accuracy * 0.5, 5)) {
            computedSpeedKmh = (added / dt) * 3.6;
          }
        }
        // Prefer device speed if available and non-zero, otherwise use computed
        const deviceSpeed = pos.coords.speed;
        const deviceSpeedKmh =
          deviceSpeed != null && !Number.isNaN(deviceSpeed) && deviceSpeed > 0
            ? deviceSpeed * 3.6
            : 0;
        const speedKmh = Math.max(deviceSpeedKmh, computedSpeedKmh);

        lastPos.current = [lat, lon];
        lastPosTime.current = now;

        setStats((prev) => {
          const totalDistanceM = prev.totalDistanceM + (computedSpeedKmh > 0 ? added : 0);
          // Lower threshold so walking pace registers as moving
          const status: TrackingStatus = speedKmh > 0.8 ? "moving" : "stopped";

          const next = {
            ...prev,
            latitude: lat,
            longitude: lon,
            speedKmh,
            heading: pos.coords.heading,
            accuracy: pos.coords.accuracy,
            totalDistanceM,
            status,
            gpsActive: true,
            lastUpdate: now,
          };
          if (now - lastSent.current > 8000) {
            lastSent.current = now;
            void persist(next, status, true);
          }
          if (idleTimer.current) window.clearTimeout(idleTimer.current);
          idleTimer.current = window.setTimeout(() => {
            setStats((s) => ({ ...s, status: "idle" }));
          }, 60_000);
          return next;
        });
      },
      (err) => {
        const denied = err.code === 1; // PERMISSION_DENIED
        setStats((s) => ({
          ...s,
          error: err.message,
          gpsActive: false,
          isTracking: denied ? false : s.isTracking,
          permission: denied ? "denied" : s.permission,
          status: denied ? "offline" : s.status,
        }));
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
  }, [persist, acquireWakeLock]);

  const stop = useCallback(async () => {
    if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = null;
    if (idleTimer.current) window.clearTimeout(idleTimer.current);
    void releaseWakeLock();
    setStats((s) => ({ ...s, isTracking: false, status: "offline", gpsActive: false }));
    await persist(
      {
        latitude: stats.latitude,
        longitude: stats.longitude,
        totalDistanceM: stats.totalDistanceM,
        speedKmh: 0,
      },
      "offline",
      false,
    );
  }, [persist, releaseWakeLock, stats.latitude, stats.longitude, stats.totalDistanceM]);

  useEffect(
    () => () => {
      if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current);
    },
    [],
  );

  return { stats, start, stop };
}
