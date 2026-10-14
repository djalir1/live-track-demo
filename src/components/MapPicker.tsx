import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import { MapContainer, Marker, Circle, useMap, useMapEvents } from "react-leaflet";
import { MapAutoResize } from "@/components/MapAutoResize";
import { BaseMap } from "@/components/BaseMap";

// Click-to-place map used on /admin/routes when adding a stop.
// Emits (lat, lng) whenever the marker moves; radius circle is display-only
// and driven by the caller's radius_m input.

const pinIcon = L.divIcon({
  className: "",
  html: `
    <div style="position:relative;width:36px;height:36px;filter:drop-shadow(0 4px 8px rgba(0,0,0,.35));">
      <div style="position:absolute;inset:6px;border-radius:9999px;background:oklch(0.55 0.22 256);display:grid;place-items:center;color:white;border:2.5px solid rgba(255,255,255,.95);font-size:14px;font-weight:800;">
        📍
      </div>
    </div>`,
  iconSize: [36, 36],
  iconAnchor: [18, 32],
});

function ClickHandler({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

function Recenter({ lat, lng }: { lat: number | null; lng: number | null }) {
  const map = useMap();
  const first = useRef(true);
  useEffect(() => {
    if (lat == null || lng == null) return;
    if (first.current) {
      map.setView([lat, lng], Math.max(map.getZoom(), 14), { animate: false });
      first.current = false;
    }
  }, [lat, lng, map]);
  return null;
}

export interface MapPickerProps {
  lat: number | null;
  lng: number | null;
  radius_m: number;
  onPick: (lat: number, lng: number) => void;
  // Fallback centre if lat/lng aren't set yet (Kigali by default).
  fallback?: [number, number];
  className?: string;
}

export function MapPicker({
  lat,
  lng,
  radius_m,
  onPick,
  fallback = [-1.9536, 30.0605],
  className,
}: MapPickerProps) {
  const centre = useMemo<[number, number]>(
    () => (lat != null && lng != null ? [lat, lng] : fallback),
    [lat, lng, fallback],
  );

  return (
    <div
      className={`relative rounded-xl overflow-hidden border border-border/60 ${className ?? "h-64"}`}
    >
      <MapContainer
        center={centre}
        zoom={13}
        scrollWheelZoom
        style={{ height: "100%", width: "100%" }}
      >
        <BaseMap />
        <ClickHandler onPick={onPick} />
        <Recenter lat={lat} lng={lng} />
        {lat != null && lng != null && (
          <>
            <Marker position={[lat, lng]} icon={pinIcon} />
            <Circle
              center={[lat, lng]}
              radius={radius_m}
              pathOptions={{ color: "#5850ec", weight: 1.5, fillOpacity: 0.15 }}
            />
          </>
        )}
        <MapAutoResize />
      </MapContainer>
      <div className="absolute bottom-2 left-2 bg-background/85 border border-border/60 rounded-md px-2 py-1 text-[11px] text-muted-foreground">
        Click on the map to place the stop
      </div>
    </div>
  );
}
