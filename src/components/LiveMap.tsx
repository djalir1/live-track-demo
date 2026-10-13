import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from "react-leaflet";
import { useMapAutoResize } from "@/components/MapAutoResize";
import type { LiveUser } from "@/types/tracking";
import { getVehicle, vehicleSvgString } from "@/lib/vehicles";
import {
  OSM_TILE_ATTRIBUTION,
  OSM_TILE_SUBDOMAINS,
  OSM_TILE_URL,
  OSM_MAX_ZOOM,
} from "@/lib/mapTiles";
import { formatDistanceToNow } from "date-fns";

const COLOR: Record<LiveUser["status"], string> = {
  moving: "#22c55e", // green
  stopped: "#3b82f6", // blue — parked
  idle: "#f59e0b", // amber — no updates recently
  offline: "#71717a", // gray — device off
};

function makeVehicleMarker(
  color: string,
  vehicleType: LiveUser["vehicle_type"],
  live: boolean,
  heading: number | null,
) {
  const svg = vehicleSvgString(vehicleType, "white");
  // Our vehicle SVGs are drawn facing right (east = 0°). Compass bearings are
  // 0° = north, so subtract 90° to align the icon with the direction of travel.
  const rotDeg = heading != null && Number.isFinite(heading) ? heading - 90 : null;
  const inner =
    rotDeg != null
      ? `<div style="width:100%;height:100%;display:grid;place-items:center;transform:rotate(${rotDeg}deg);transition:transform 0.6s ease-out;">${svg}</div>`
      : svg;
  return L.divIcon({
    // bus-marker-live enables CSS position transition (see styles.css) so the
    // marker glides between GPS updates instead of teleporting.
    className: live ? "bus-marker-live" : "",
    html: `
      <div style="position:relative;width:52px;height:52px;filter:drop-shadow(0 6px 12px rgba(0,0,0,.4));">
        ${live ? `<div style="position:absolute;inset:0;border-radius:9999px;background:${color};opacity:.22;animation:pulse-ring 1.8s infinite;"></div>` : ""}
        <div style="position:absolute;inset:8px;border-radius:9999px;background:${color};display:grid;place-items:center;border:2.5px solid rgba(255,255,255,.95);">
          ${inner}
        </div>
      </div>`,
    iconSize: [52, 52],
    iconAnchor: [26, 26],
    popupAnchor: [0, -26],
  });
}

// Bearing in degrees (0 = north) from A to B.
function bearingDeg(a: [number, number], b: [number, number]): number {
  const toRad = (x: number) => (x * Math.PI) / 180;
  const [lat1, lon1] = [toRad(a[0]), toRad(a[1])];
  const [lat2, lon2] = [toRad(b[0]), toRad(b[1])];
  const dLon = lon2 - lon1;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  const brng = (Math.atan2(y, x) * 180) / Math.PI;
  return (brng + 360) % 360;
}

function makeStopMarker(color: string) {
  return L.divIcon({
    className: "",
    html: `
      <div style="position:relative;width:36px;height:36px;filter:drop-shadow(0 4px 8px rgba(0,0,0,.35));">
        <div style="position:absolute;inset:4px;border-radius:9999px;background:${color};display:grid;place-items:center;color:white;border:2px solid rgba(255,255,255,.9);font-size:12px;font-weight:800;">
          ⏸
        </div>
      </div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    popupAnchor: [0, -18],
  });
}

function FitBounds({ users, selectedId }: { users: LiveUser[]; selectedId?: string | null }) {
  const map = useMap();
  const resized = useMapAutoResize();
  const fittedRef = useRef(false);
  useEffect(() => {
    // Hidden (0×0) map, e.g. the mobile list tab: fit once it's visible.
    if (map.getSize().x === 0) return;
    if (selectedId) {
      const u = users.find((x) => x.user_id === selectedId && x.latitude != null);
      if (u) {
        map.flyTo([u.latitude!, u.longitude!], 16, { duration: 0.6 });
        return;
      }
    }
    const pts = users
      .filter((u) => u.latitude != null)
      .map((u) => [u.latitude!, u.longitude!] as [number, number]);
    if (pts.length === 0 || fittedRef.current) return;
    if (pts.length === 1) map.setView(pts[0], 14);
    else map.fitBounds(L.latLngBounds(pts), { padding: [40, 40] });
    fittedRef.current = true;
  }, [users, selectedId, map, resized]);
  return null;
}

export interface LiveMapProps {
  users: LiveUser[];
  selectedId?: string | null;
  routePoints?: [number, number][];
  stops?: Array<{ lat: number; lon: number; label: string; when: string }>;
}

export function LiveMap({ users, selectedId, routePoints, stops }: LiveMapProps) {
  const center = useMemo<[number, number]>(() => {
    const u = users.find((x) => x.latitude != null);
    return u ? [u.latitude!, u.longitude!] : [0, 0];
  }, [users]);

  // Per-user previous position, so we can derive a heading for devices whose
  // GPS didn't report one (very common on Android when speed is low). Kept in
  // a ref so React re-renders don't wipe the memory between updates.
  const prevPosRef = useRef<Map<string, { lat: number; lng: number; heading: number | null }>>(
    new Map(),
  );
  const effectiveHeadings = useMemo(() => {
    const out = new Map<string, number | null>();
    for (const u of users) {
      if (u.latitude == null || u.longitude == null) {
        out.set(u.user_id, null);
        continue;
      }
      const prev = prevPosRef.current.get(u.user_id);
      let h = u.heading;
      if (h == null && prev && (prev.lat !== u.latitude || prev.lng !== u.longitude)) {
        h = bearingDeg([prev.lat, prev.lng], [u.latitude, u.longitude]);
      }
      // If the bus is standing still, keep the last known heading so the icon
      // doesn't snap back to a default direction between updates.
      if (h == null && prev) h = prev.heading;
      out.set(u.user_id, h);
      prevPosRef.current.set(u.user_id, { lat: u.latitude, lng: u.longitude, heading: h });
    }
    return out;
  }, [users]);

  return (
    <MapContainer
      center={center}
      zoom={users.some((u) => u.latitude != null) ? 13 : 2}
      className="h-full w-full rounded-2xl overflow-hidden"
      scrollWheelZoom
    >
      <TileLayer
        url={OSM_TILE_URL}
        attribution={OSM_TILE_ATTRIBUTION}
        subdomains={OSM_TILE_SUBDOMAINS}
        maxZoom={OSM_MAX_ZOOM}
      />
      <FitBounds users={users} selectedId={selectedId} />

      {routePoints && routePoints.length > 1 && (
        <Polyline
          positions={routePoints}
          pathOptions={{ color: "#8b5cf6", weight: 4, opacity: 0.85 }}
        />
      )}

      {stops?.map((s, i) => (
        <Marker key={`stop-${i}`} position={[s.lat, s.lon]} icon={makeStopMarker("#f59e0b")}>
          <Popup>
            <div className="space-y-1 text-xs">
              <div className="font-semibold">Stop</div>
              <div>{s.label}</div>
              <div className="text-muted-foreground">{s.when}</div>
            </div>
          </Popup>
        </Marker>
      ))}

      {users
        .filter((u) => u.latitude != null)
        .map((u) => {
          const v = getVehicle(u.vehicle_type);
          const color = COLOR[u.status];
          const live = u.status === "moving" || (u.is_tracking && u.status !== "offline");
          const phoneOff = !u.is_tracking;
          const staleMs = Date.now() - new Date(u.last_seen).getTime();
          // Only rotate the icon for buses that are actually moving — a parked
          // bus pointing "east" because that was the last computed bearing looks
          // more distracting than helpful.
          const iconHeading =
            u.status === "moving" ? (effectiveHeadings.get(u.user_id) ?? null) : null;
          return (
            <Marker
              key={u.user_id}
              position={[u.latitude!, u.longitude!]}
              icon={makeVehicleMarker(color, u.vehicle_type, live, iconHeading)}
              zIndexOffset={selectedId === u.user_id ? 1000 : 0}
            >
              <Popup>
                <div className="space-y-1.5 text-xs min-w-52">
                  <div className="font-bold text-sm flex items-center gap-1.5">
                    {u.display_name}
                    {u.status === "moving" && (
                      <span
                        className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                        style={{ background: `${color}25`, color }}
                      >
                        Live
                      </span>
                    )}
                  </div>
                  <div className="text-muted-foreground">
                    {v.label}
                    {u.vehicle_name ? ` · ${u.vehicle_name}` : ""}
                  </div>
                  {u.plate_number && (
                    <div className="font-mono text-[11px] font-bold bg-black/5 dark:bg-white/10 inline-block px-1.5 py-0.5 rounded">
                      {u.plate_number}
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 pt-1 border-t border-black/5 dark:border-white/10">
                    <div>
                      Status: <b style={{ color }}>{u.status}</b>
                    </div>
                    <div>
                      Speed: <b>{u.speed_kmh?.toFixed(1) ?? 0} km/h</b>
                    </div>
                    <div>
                      Battery: <b>{u.battery_level ?? "—"}%</b>
                    </div>
                    <div>
                      {u.gps_tracker ? "Ignition" : "Phone"}: <b>{phoneOff ? "off" : "on"}</b>
                    </div>
                  </div>
                  {u.address && <div className="text-muted-foreground">📍 {u.address}</div>}
                  <div className="text-muted-foreground pt-1 border-t border-black/5 dark:border-white/10">
                    {phoneOff ? "Last seen " : "Updated "}
                    {formatDistanceToNow(new Date(u.last_seen))} ago
                    {phoneOff && staleMs > 10 * 60_000 && (
                      <span className="text-[var(--stopped)]">
                        {" "}
                        · {u.gps_tracker ? "engine off" : "driver stopped tracking"}
                      </span>
                    )}
                  </div>
                </div>
              </Popup>
            </Marker>
          );
        })}
    </MapContainer>
  );
}
