import { Fragment, useEffect, useMemo } from "react";
import L from "leaflet";
import { MapContainer, Polyline, Marker, Popup, useMap } from "react-leaflet";
import { useMapAutoResize } from "@/components/MapAutoResize";
import { BaseMap } from "@/components/BaseMap";
import { distM, tripColor, type LatLon, type Trip } from "@/lib/day-report";
import { fmtDuration, fmtTime } from "@/lib/time";

// History map: each trip in its own colour with direction arrows, so a drive
// A → B and the drive back B → A are two clearly different lines. Green "A" =
// where a trip started, red "B" = where it ended, numbered pins = stops.

export interface TripMapProps {
  trips: Trip[];
  /** Highlight one trip (others fade) and zoom to it. */
  selected?: number | null;
  onSelect?: (index: number | null) => void;
  placeOf: (p: LatLon) => string | null;
}

const pin = (bg: string, text: string, size = 24, shift = 0) =>
  L.divIcon({
    className: "",
    html: `<div class="trip-pin" style="width:${size}px;height:${size}px;background:${bg}">${text}</div>`,
    iconSize: [size, size],
    // shift: nudge B beside A when a trip ends where it started.
    iconAnchor: [size / 2 - shift, size / 2],
    popupAnchor: [0, -size / 2],
  });

function bearing(a: LatLon, b: LatLon) {
  const r = (x: number) => (x * Math.PI) / 180;
  const y = Math.sin(r(b.lon - a.lon)) * Math.cos(r(b.lat));
  const x =
    Math.cos(r(a.lat)) * Math.sin(r(b.lat)) -
    Math.sin(r(a.lat)) * Math.cos(r(b.lat)) * Math.cos(r(b.lon - a.lon));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Arrow positions roughly every `spacingM` metres along the line. */
function arrowsAlong(points: LatLon[], spacingM: number) {
  const out: Array<LatLon & { deg: number }> = [];
  let acc = spacingM / 2;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const d = distM(a, b);
    if (d < 1) continue;
    acc += d;
    if (acc >= spacingM) {
      acc = 0;
      out.push({ lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2, deg: bearing(a, b) });
    }
  }
  return out;
}

function FitTo({ trips, selected }: { trips: Trip[]; selected?: number | null }) {
  const map = useMap();
  const resized = useMapAutoResize();
  useEffect(() => {
    if (map.getSize().x === 0) return;
    const pick = selected != null ? trips.filter((t) => t.index === selected) : trips;
    const pts = pick.flatMap((t) =>
      t.points.map((p) => [p.latitude, p.longitude] as [number, number]),
    );
    if (!pts.length) return;
    map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 17, animate: true });
  }, [trips, selected, map, resized]);
  return null;
}

export function TripMap({ trips, selected, onSelect, placeOf }: TripMapProps) {
  const lines = useMemo(
    () =>
      trips.map((t) => {
        const pts = t.points.map((p) => ({ lat: p.latitude, lon: p.longitude }));
        return { trip: t, pts, arrows: arrowsAlong(pts, 350) };
      }),
    [trips],
  );
  const first = trips.find((t) => t.points.length)?.points[0];
  const center: [number, number] = first ? [first.latitude, first.longitude] : [-1.9441, 30.0619];

  return (
    <MapContainer
      center={center}
      zoom={14}
      className="h-full w-full rounded-2xl overflow-hidden"
      scrollWheelZoom
    >
      <BaseMap />
      <FitTo trips={trips} selected={selected} />
      {lines.map(({ trip, pts, arrows }) => {
        const color = tripColor(trip.index);
        const dim = selected != null && selected !== trip.index;
        const positions = pts.map((p) => [p.lat, p.lon] as [number, number]);
        const click = { click: () => onSelect?.(selected === trip.index ? null : trip.index) };
        return (
          <Fragment key={trip.index}>
            {/* White casing under the coloured line keeps it readable on any map. */}
            <Polyline
              positions={positions}
              pathOptions={{ color: "#fff", weight: 8, opacity: dim ? 0.15 : 0.9 }}
            />
            <Polyline
              positions={positions}
              pathOptions={{
                color,
                weight: 5,
                opacity: dim ? 0.25 : 1,
                lineCap: "round",
                lineJoin: "round",
              }}
              eventHandlers={click}
            />
            {!dim &&
              arrows.map((a, i) => (
                <Marker
                  key={i}
                  position={[a.lat, a.lon]}
                  interactive={false}
                  icon={L.divIcon({
                    className: "",
                    html: `<div class="trip-arrow" style="transform:rotate(${a.deg}deg)"></div>`,
                    iconSize: [10, 9],
                    iconAnchor: [5, 4.5],
                  })}
                />
              ))}
            {!dim &&
              trip.stops.map((s, i) => (
                <Marker
                  key={`s${i}`}
                  position={[s.lat, s.lon]}
                  icon={pin("#f59e0b", String(i + 1), 22)}
                >
                  <Popup>
                    <div className="text-xs space-y-0.5">
                      <div className="font-semibold">
                        Trip {trip.index} · stop {i + 1}
                      </div>
                      <div>{placeOf(s) ?? "Locating…"}</div>
                      <div className="text-muted-foreground">
                        {fmtTime(s.startedAt)}–{fmtTime(s.endedAt)} · {fmtDuration(s.ms)}
                      </div>
                    </div>
                  </Popup>
                </Marker>
              ))}
            {trip.start && (
              <Marker
                position={[trip.start.lat, trip.start.lon]}
                icon={pin("#16a34a", "A", 26)}
                opacity={dim ? 0.4 : 1}
              >
                <Popup>
                  <div className="text-xs space-y-0.5">
                    <div className="font-semibold">
                      Trip {trip.index} started {fmtTime(trip.startedAt)}
                    </div>
                    <div>{placeOf(trip.start) ?? "Locating…"}</div>
                  </div>
                </Popup>
              </Marker>
            )}
            {trip.end && !trip.ongoing && (
              <Marker
                position={[trip.end.lat, trip.end.lon]}
                icon={pin(
                  "#dc2626",
                  "B",
                  26,
                  trip.start && distM(trip.start, trip.end) < 30 ? 16 : 0,
                )}
                opacity={dim ? 0.4 : 1}
              >
                <Popup>
                  <div className="text-xs space-y-0.5">
                    <div className="font-semibold">
                      Trip {trip.index} ended {fmtTime(trip.endedAt)}
                    </div>
                    <div>{placeOf(trip.end) ?? "Locating…"}</div>
                  </div>
                </Popup>
              </Marker>
            )}
          </Fragment>
        );
      })}
    </MapContainer>
  );
}
