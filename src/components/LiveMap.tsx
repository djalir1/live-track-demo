import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { MapContainer, Marker, Popup, useMap } from "react-leaflet";
import { useMapAutoResize } from "@/components/MapAutoResize";
import type { LiveUser } from "@/types/tracking";
import { getVehicle } from "@/lib/vehicles";
import { BaseMap } from "@/components/BaseMap";
import { ago } from "@/lib/time";
import { STATUS_COLOR, STATUS_LABEL } from "@/lib/status";

// Live fleet map.
//
// Each vehicle is ONE long-lived Leaflet marker. New GPS fixes never rebuild it
// (that's what made markers tremble every 10 s); instead the marker glides from
// where it is drawn to the new fix over roughly the time between fixes, and the
// top-down vehicle turns smoothly to its heading — so you watch it drive along
// the street and take corners instead of jumping every 10 s.

// ── Geometry ────────────────────────────────────────────────────────────────
const toRad = (x: number) => (x * Math.PI) / 180;
function distM(a: [number, number], b: [number, number]) {
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}
function bearingDeg(a: [number, number], b: [number, number]) {
  const y = Math.sin(toRad(b[1] - a[1])) * Math.cos(toRad(b[0]));
  const x =
    Math.cos(toRad(a[0])) * Math.sin(toRad(b[0])) -
    Math.sin(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.cos(toRad(b[1] - a[1]));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

// ── Marker markup (built once per vehicle; updated in place) ────────────────
// Top-down silhouettes, nose pointing up (north = 0°).
function topDownSvg(type: LiveUser["vehicle_type"]) {
  const long = type === "bus" || type === "truck" || type === "van";
  const two = type === "motorcycle" || type === "bicycle";
  if (two)
    return `<svg viewBox="0 0 24 24" width="20" height="20"><rect x="10" y="3" width="4" height="18" rx="2" fill="#fff"/><rect x="7" y="8" width="10" height="2" rx="1" fill="#fff"/></svg>`;
  const [y, h] = long ? [1.5, 21] : [3, 18];
  return `<svg viewBox="0 0 24 24" width="22" height="22">
    <rect x="6.5" y="${y}" width="11" height="${h}" rx="${long ? 2.5 : 4}" fill="#fff"/>
    <rect x="8" y="${y + 3}" width="8" height="3.6" rx="1.2" fill="var(--veh-c)" opacity=".75"/>
    <rect x="8" y="${y + h - 4.6}" width="8" height="2.4" rx="1" fill="var(--veh-c)" opacity=".45"/>
  </svg>`;
}

function vehicleIcon(type: LiveUser["vehicle_type"]) {
  return L.divIcon({
    className: "veh-marker",
    html: `
      <div class="veh-beam"></div>
      <div class="veh-pulse"></div>
      <div class="veh-disc"><div class="veh-rot">${topDownSvg(type)}</div></div>
      <div class="veh-label"><span class="veh-name"></span><span class="veh-speed"></span></div>`,
    iconSize: [48, 48],
    iconAnchor: [24, 24],
    popupAnchor: [0, -22],
  });
}

// ── One vehicle ─────────────────────────────────────────────────────────────
const MAX_GLIDE_MS = 12_000;
const SNAP_METERS = 3_000; // bigger jumps (signal regained far away) snap

function VehicleMarker({ u, selected }: { u: LiveUser; selected: boolean }) {
  const markerRef = useRef<L.Marker | null>(null);
  const target: [number, number] = [u.latitude!, u.longitude!];
  const [initial] = useState<[number, number]>(target);
  const icon = useMemo(() => vehicleIcon(u.vehicle_type), [u.vehicle_type]);

  const shown = useRef<[number, number]>(initial);
  const lastFix = useRef<{ pos: [number, number]; at: number }>({
    pos: initial,
    at: Date.parse(u.last_seen),
  });
  const raf = useRef<number | null>(null);
  const rotation = useRef<number | null>(null); // unwrapped degrees, for shortest-path turns

  // Glide to each new fix.
  useEffect(() => {
    const m = markerRef.current;
    if (!m) return;
    const to = target;
    const from = shown.current;
    const fixAt = Date.parse(u.last_seen);
    const d = distM(from, to);

    // Heading: GPS course when really moving, else direction of travel, else keep.
    let heading: number | null = null;
    if (u.heading != null && (u.speed_kmh ?? 0) > 3) heading = u.heading;
    else if (distM(lastFix.current.pos, to) > 6) heading = bearingDeg(lastFix.current.pos, to);
    else if (rotation.current == null && u.heading != null) heading = u.heading; // first paint
    if (heading != null) {
      const cur = rotation.current ?? heading;
      const delta = ((heading - (cur % 360) + 540) % 360) - 180;
      rotation.current = cur + delta;
      const rot = m.getElement()?.querySelector<HTMLElement>(".veh-rot");
      const beam = m.getElement()?.querySelector<HTMLElement>(".veh-beam");
      if (rot) rot.style.transform = `rotate(${rotation.current}deg)`;
      if (beam) beam.style.transform = `rotate(${rotation.current}deg)`;
    }

    const interval = fixAt - lastFix.current.at;
    lastFix.current = { pos: to, at: fixAt };
    if (raf.current) cancelAnimationFrame(raf.current);
    if (d < 0.5) return;
    if (d > SNAP_METERS || document.hidden || interval <= 0) {
      shown.current = to;
      m.setLatLng(to);
      return;
    }
    const dur = Math.min(Math.max(interval, 800), MAX_GLIDE_MS);
    const start = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / dur);
      const pos: [number, number] = [
        from[0] + (to[0] - from[0]) * p,
        from[1] + (to[1] - from[1]) * p,
      ];
      shown.current = pos;
      m.setLatLng(pos);
      raf.current = p < 1 ? requestAnimationFrame(step) : null;
    };
    raf.current = requestAnimationFrame(step);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [u.latitude, u.longitude, u.last_seen]);

  useEffect(
    () => () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    },
    [],
  );

  // Colour / state / label, in place.
  const color = STATUS_COLOR[u.status];
  const speed = Math.round(u.speed_kmh ?? 0);
  useEffect(() => {
    const el = markerRef.current?.getElement();
    if (!el) return;
    el.style.setProperty("--veh-c", color);
    el.classList.toggle("is-moving", u.status === "moving");
    el.classList.toggle("is-offline", u.status === "offline");
    el.classList.toggle("is-selected", selected);
    const name = el.querySelector(".veh-name");
    const sp = el.querySelector(".veh-speed");
    if (name) name.textContent = u.plate_number ?? u.vehicle_name ?? u.display_name;
    if (sp)
      sp.textContent = u.health
        ? u.health.short
        : u.status === "moving"
          ? `${speed} km/h`
          : STATUS_LABEL[u.status];
  });

  const v = getVehicle(u.vehicle_type);
  return (
    <Marker
      ref={markerRef}
      position={initial}
      icon={icon}
      zIndexOffset={selected ? 1000 : u.status === "moving" ? 500 : 0}
    >
      <Popup>
        <div className="space-y-1.5 text-xs min-w-52">
          <div className="font-bold text-sm flex items-center gap-1.5">
            {u.display_name}
            <span
              className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
              style={{ background: `${color}25`, color }}
            >
              {STATUS_LABEL[u.status]}
            </span>
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
              Speed: <b>{speed} km/h</b>
            </div>
            <div>
              {u.gps_tracker ? "Engine" : "Phone"}:{" "}
              <b>
                {u.is_tracking
                  ? "on"
                  : u.gps_tracker && u.status === "offline" && u.last_engine_on
                    ? "on (last report)"
                    : "off"}
              </b>
            </div>
            <div>
              {u.gps_tracker ? "GPS battery" : "Battery"}: <b>{u.battery_level ?? "—"}%</b>
            </div>
          </div>
          {u.health && (
            <div
              className={`rounded-md px-2 py-1 text-[11px] leading-snug ${
                u.health.tone === "error"
                  ? "bg-red-500/10 text-red-600 dark:text-red-400"
                  : "bg-amber-500/10 text-amber-700 dark:text-amber-400"
              }`}
            >
              ⚠️ {u.health.detail}
            </div>
          )}
          {u.address && <div className="text-muted-foreground">📍 {u.address}</div>}
          <div className="text-muted-foreground pt-1 border-t border-black/5 dark:border-white/10">
            Last update {ago(u.last_seen)}
          </div>
        </div>
      </Popup>
    </Marker>
  );
}

// ── Camera ──────────────────────────────────────────────────────────────────
function Camera({
  users,
  selectedId,
  follow,
}: {
  users: LiveUser[];
  selectedId?: string | null;
  follow: boolean;
}) {
  const map = useMap();
  const resized = useMapAutoResize();
  const fitted = useRef(false);
  const lastSelected = useRef<string | null>(null);

  useEffect(() => {
    if (map.getSize().x === 0) return; // hidden (mobile list tab): fit once visible
    const sel = selectedId
      ? users.find((x) => x.user_id === selectedId && x.latitude != null)
      : null;
    if (sel) {
      const p: [number, number] = [sel.latitude!, sel.longitude!];
      if (lastSelected.current !== selectedId) {
        lastSelected.current = selectedId ?? null;
        map.flyTo(p, Math.max(map.getZoom(), 16), { duration: 0.8 });
      } else if (follow && !map.getBounds().pad(-0.25).contains(p)) {
        // Follow the selected vehicle gently, only when it nears the edge.
        map.panTo(p, { animate: true, duration: 1 });
      }
      return;
    }
    lastSelected.current = null;
    if (fitted.current) return;
    const pts = users
      .filter((u) => u.latitude != null)
      .map((u) => [u.latitude!, u.longitude!] as [number, number]);
    if (!pts.length) return;
    if (pts.length === 1) map.setView(pts[0], 15);
    else map.fitBounds(L.latLngBounds(pts), { padding: [48, 48], maxZoom: 16 });
    fitted.current = true;
  }, [users, selectedId, follow, map, resized]);
  return null;
}

export interface LiveMapProps {
  users: LiveUser[];
  selectedId?: string | null;
  /** Keep the selected vehicle in view as it drives. */
  follow?: boolean;
}

export function LiveMap({ users, selectedId, follow = true }: LiveMapProps) {
  const located = users.filter((u) => u.latitude != null && u.longitude != null);
  const center = useMemo<[number, number]>(() => {
    const u = located[0];
    return u ? [u.latitude!, u.longitude!] : [-1.9441, 30.0619]; // Kigali
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [located.length > 0]);

  // Re-render every 5 s so "last update" text and staleness stay current.
  const [, tick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 5000);
    return () => window.clearInterval(t);
  }, []);

  return (
    <MapContainer
      center={center}
      zoom={located.length ? 14 : 12}
      className="h-full w-full rounded-2xl overflow-hidden"
      scrollWheelZoom
      zoomControl={false}
    >
      <BaseMap />
      <Camera users={located} selectedId={selectedId} follow={follow} />
      <ZoomControlBottomRight />
      {located.map((u) => (
        <VehicleMarker key={u.user_id} u={u} selected={selectedId === u.user_id} />
      ))}
    </MapContainer>
  );
}

// Zoom buttons bottom-right: clear of the header on phones, reachable by thumb.
function ZoomControlBottomRight() {
  const map = useMap();
  useEffect(() => {
    const c = L.control.zoom({ position: "bottomright" });
    c.addTo(map);
    return () => {
      c.remove();
    };
  }, [map]);
  return null;
}
