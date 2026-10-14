import { useEffect, useRef, useState } from "react";
import type L from "leaflet";
import { TileLayer, useMap } from "react-leaflet";
import "maplibre-gl/dist/maplibre-gl.css";
import { maplibreGL } from "@maplibre/maplibre-gl-leaflet";
import { useTheme } from "@/lib/theme";
import { loadMapStyle, prefetchMapStyles, supportsWebGL } from "@/lib/mapStyle";
import {
  OSM_MAX_ZOOM,
  OSM_TILE_ATTRIBUTION,
  OSM_TILE_SUBDOMAINS,
  OSM_TILE_URL,
} from "@/lib/mapTiles";

// Start downloading both styles as soon as a map is on its way.
prefetchMapStyles();

type Theme = "light" | "dark";

/**
 * The map background for every Leaflet map: a vector basemap with streets and
 * place icons, rendered by MapLibre underneath Leaflet's markers and lines.
 * Falls back to plain OSM tiles without WebGL or if the style can't load.
 *
 * One MapLibre map lives as long as the Leaflet map. A theme change swaps its
 * style in place (same tiles, already cached) instead of tearing down the
 * WebGL context and downloading everything again.
 */
export function BaseMap() {
  const map = useMap();
  const { theme } = useTheme();
  const [fallback, setFallback] = useState(false);
  const layerRef = useRef<L.MaplibreGL | null>(null);
  const shownRef = useRef<Theme | null>(null);
  const themeRef = useRef<Theme>(theme);
  themeRef.current = theme;

  const applyTheme = (next: Theme) => {
    const layer = layerRef.current;
    if (!layer || shownRef.current === next) return;
    shownRef.current = next;
    loadMapStyle(next)
      .then((style) => {
        // Ignore if the map is gone or another toggle superseded this one.
        if (layerRef.current !== layer || shownRef.current !== next) return;
        // diff: only changed layers/paint are updated; sources and tiles stay.
        layer.getMaplibreMap().setStyle(style, { diff: true });
      })
      .catch(() => {
        /* keep the current style */
      });
  };

  // Create the basemap once.
  useEffect(() => {
    // Without a tile layer Leaflet has no zoom ceiling; match the basemap's.
    map.setMaxZoom(fallback ? OSM_MAX_ZOOM : 20);
    if (fallback) return;
    if (!supportsWebGL()) {
      setFallback(true);
      return;
    }
    let cancelled = false;
    const initial = themeRef.current;
    loadMapStyle(initial)
      .then((style) => {
        if (cancelled) return;
        const layer = maplibreGL({ style, maxZoom: 20, fadeDuration: 0 });
        layer.addTo(map);
        layerRef.current = layer;
        shownRef.current = initial;
        // The theme flipped while the first style was loading.
        if (themeRef.current !== initial) applyTheme(themeRef.current);
      })
      .catch(() => {
        if (!cancelled) setFallback(true);
      });
    return () => {
      cancelled = true;
      if (layerRef.current) map.removeLayer(layerRef.current);
      layerRef.current = null;
      shownRef.current = null;
    };
  }, [map, fallback]);

  // Theme change: restyle the existing map.
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

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
