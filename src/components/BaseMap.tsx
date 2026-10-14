import { useEffect, useState } from "react";
import L from "leaflet";
import { TileLayer, useMap } from "react-leaflet";
import "maplibre-gl/dist/maplibre-gl.css";
import { maplibreGL } from "@maplibre/maplibre-gl-leaflet";
import { useTheme } from "@/lib/theme";
import { loadMapStyle, supportsWebGL } from "@/lib/mapStyle";
import {
  OSM_MAX_ZOOM,
  OSM_TILE_ATTRIBUTION,
  OSM_TILE_SUBDOMAINS,
  OSM_TILE_URL,
} from "@/lib/mapTiles";

/**
 * The map background for every Leaflet map: a vector basemap with streets and
 * place icons, rendered by MapLibre underneath Leaflet's markers and lines.
 * Falls back to plain OSM tiles without WebGL or if the style can't load.
 */
export function BaseMap() {
  const map = useMap();
  const { theme } = useTheme();
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    // Without a tile layer Leaflet has no zoom ceiling; match the basemap's.
    map.setMaxZoom(fallback ? OSM_MAX_ZOOM : 20);
    if (fallback) return;
    if (!supportsWebGL()) {
      setFallback(true);
      return;
    }
    let cancelled = false;
    let layer: L.MaplibreGL | null = null;
    loadMapStyle(theme)
      .then((style) => {
        if (cancelled) return;
        layer = maplibreGL({ style, maxZoom: 20 });
        layer.addTo(map);
      })
      .catch(() => {
        if (!cancelled) setFallback(true);
      });
    return () => {
      cancelled = true;
      if (layer) map.removeLayer(layer);
    };
  }, [map, theme, fallback]);

  if (!fallback) return null;
  return (
    <TileLayer
      url={OSM_TILE_URL}
      attribution={OSM_TILE_ATTRIBUTION}
      subdomains={OSM_TILE_SUBDOMAINS}
      maxZoom={OSM_MAX_ZOOM}
    />
  );
}
