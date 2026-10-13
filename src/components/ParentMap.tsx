import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import { MapContainer, TileLayer, Marker, Polyline, useMap } from "react-leaflet";
import { MapAutoResize } from "@/components/MapAutoResize";
import type { VehicleType } from "@/lib/vehicles";
import {
  OSM_TILE_ATTRIBUTION,
  OSM_TILE_SUBDOMAINS,
  OSM_TILE_URL,
  OSM_MAX_ZOOM,
} from "@/lib/mapTiles";
import { vehicleSvgString } from "@/lib/vehicles";

// A calm, single-bus map for the parent /me screen. One route line, all
// named stops labelled, home stop emphasized, school marker, and the bus
// itself as a live vehicle marker that we pan to keep in view.
//
// Colour cues:
//   moving  → green      stopped → blue      idle → amber      offline → grey
export type ParentBusStatus = "moving" | "stopped" | "offline";

const BUS_COLOR: Record<ParentBusStatus, string> = {
  moving: "#22c55e",
  stopped: "#3b82f6",
  offline: "#71717a",
};

const STOP_COLOR = "#f59e0b";
const HOME_COLOR = "#8b5cf6";
const SCHOOL_COLOR = "#10b981";

export interface StopPin {
  id: string;
  name: string;
  lat: number;
  lng: number;
  type: "pickup" | "school";
  sequence: number | null;
}

export interface ParentMapProps {
  bus: {
    lat: number | null;
    lng: number | null;
    vehicleType: VehicleType | null;
    status: ParentBusStatus;
    // If false, the bus is offline / not currently reporting; the marker is
    // still shown at last-known position but without the "live" pulse.
    live: boolean;
  } | null;
  stops: StopPin[];
  homeStopId: string | null;
  /** Stop ids the bus has already passed this trip (arrive+depart seen). */
  doneStopIds?: string[];
  className?: string;
}

function makeBusMarker(color: string, vehicleType: VehicleType | null, live: boolean) {
  const svg = vehicleSvgString((vehicleType ?? "bus") as VehicleType, "white");
  return L.divIcon({
    className: "",
    html: `
      <div style="position:relative;width:56px;height:56px;filter:drop-shadow(0 6px 12px rgba(0,0,0,.4));">
        ${live ? `<div style="position:absolute;inset:0;border-radius:9999px;background:${color};opacity:.22;animation:pulse-ring 1.8s infinite;"></div>` : ""}
        <div style="position:absolute;inset:8px;border-radius:9999px;background:${color};display:grid;place-items:center;border:2.5px solid rgba(255,255,255,.95);">
          ${svg}
        </div>
      </div>`,
    iconSize: [56, 56],
    iconAnchor: [28, 28],
  });
}

function labelledMarker(color: string, label: string, sequence: number | null, emphasized = false) {
  const size = emphasized ? 44 : 32;
  const inner = emphasized ? 12 : 10;
  return L.divIcon({
    className: "",
    html: `
      <div style="display:flex;flex-direction:column;align-items:center;filter:drop-shadow(0 3px 6px rgba(0,0,0,.4));">
        <div style="width:${size}px;height:${size}px;border-radius:9999px;background:${color};display:grid;place-items:center;color:white;border:${emphasized ? 3 : 2}px solid rgba(255,255,255,.95);font-size:${inner}px;font-weight:800;">
          ${sequence ?? "•"}
        </div>
        <div style="margin-top:2px;background:rgba(255,255,255,.9);color:#111;padding:1px 6px;border-radius:6px;font-size:10px;font-weight:600;white-space:nowrap;border:1px solid rgba(0,0,0,.08);max-width:120px;overflow:hidden;text-overflow:ellipsis;">
          ${label}
        </div>
      </div>`,
    iconSize: [size, size + 18],
    iconAnchor: [size / 2, size / 2],
  });
}

// Keep the bus visible. First mount: fit-bounds around the route + bus.
// After that: pan (don't zoom) when the bus moves off-screen.
function CameraGovernor({
  busLatLng,
  stops,
}: {
  busLatLng: [number, number] | null;
  stops: StopPin[];
}) {
  const map = useMap();
  const first = useRef(true);
  useEffect(() => {
    // Initial fit
    if (first.current) {
      first.current = false;
      const pts: [number, number][] = [];
      if (busLatLng) pts.push(busLatLng);
      for (const s of stops) pts.push([s.lat, s.lng]);
      if (pts.length === 0) return;
      if (pts.length === 1) map.setView(pts[0], 14);
      else map.fitBounds(L.latLngBounds(pts), { padding: [40, 40] });
      return;
    }
    // Subsequent updates: gently pan to keep the bus in the viewport.
    if (!busLatLng) return;
    const b = map.getBounds();
    const ll = L.latLng(busLatLng[0], busLatLng[1]);
    if (!b.pad(-0.1).contains(ll)) map.panTo(ll, { animate: true, duration: 0.6 });
  }, [busLatLng, stops, map]);
  return null;
}

// The route polyline connects stops in sequence order. Missing sequences
// fall to the end so a partially-numbered route still draws sensibly.
function routeLine(stops: StopPin[]): [number, number][] {
  const ordered = [...stops].sort((a, b) => (a.sequence ?? 1e9) - (b.sequence ?? 1e9));
  return ordered.map((s) => [s.lat, s.lng]);
}

export function ParentMap({ bus, stops, homeStopId, doneStopIds, className }: ParentMapProps) {
  const done = new Set(doneStopIds ?? []);

  const line = useMemo(() => routeLine(stops), [stops]);
  const busLatLng =
    bus?.lat != null && bus?.lng != null ? ([bus.lat, bus.lng] as [number, number]) : null;

  // Sensible fallback centre when offline with no data: first stop, else Kigali.
  const initialCentre: [number, number] =
    busLatLng ?? (stops[0] ? [stops[0].lat, stops[0].lng] : [-1.9536, 30.0605]);

  return (
    <div className={`relative overflow-hidden ${className ?? "h-full w-full"}`}>
      <MapContainer center={initialCentre} zoom={13} className="h-full w-full" scrollWheelZoom>
        <TileLayer
          url={OSM_TILE_URL}
          attribution={OSM_TILE_ATTRIBUTION}
          subdomains={OSM_TILE_SUBDOMAINS}
          maxZoom={OSM_MAX_ZOOM}
        />
        <CameraGovernor busLatLng={busLatLng} stops={stops} />

        {line.length > 1 && (
          <Polyline positions={line} pathOptions={{ color: "#8b5cf6", weight: 4, opacity: 0.85 }} />
        )}

        {stops.map((s) => {
          const isHome = s.id === homeStopId;
          const isSchool = s.type === "school";
          const isDone = done.has(s.id);
          // Passed stops fade to a muted grey so the parent's eye tracks the
          // upcoming ones. Home and school remain emphasised even after pass.
          const base = isSchool ? SCHOOL_COLOR : isHome ? HOME_COLOR : STOP_COLOR;
          const color = isDone && !isHome && !isSchool ? "#94a3b8" : base;
          const label = isHome ? `${s.name} · Home` : isSchool ? `${s.name} · School` : s.name;
          return (
            <Marker
              key={s.id}
              position={[s.lat, s.lng]}
              icon={labelledMarker(color, label, s.sequence, isHome || isSchool)}
              opacity={isDone && !isHome && !isSchool ? 0.6 : 1}
            />
          );
        })}

        {busLatLng && bus && (
          <Marker
            position={busLatLng}
            icon={makeBusMarker(BUS_COLOR[bus.status], bus.vehicleType, bus.live)}
            zIndexOffset={1000}
          />
        )}
        <MapAutoResize />
      </MapContainer>
    </div>
  );
}
