// Vector basemap styles (OpenFreeMap, free, no API key) tuned to read like
// Google Maps: coloured place icons and labels by category, street names from
// zoom 14. Both themes are OpenFreeMap "liberty"; dark mode only recolours it.
import type { StyleSpecification, LayerSpecification } from "maplibre-gl";

const STYLE_URL = "https://tiles.openfreemap.org/styles";

type Theme = "light" | "dark";

// Category → colour, Google-style. One mid-tone set that reads on both themes:
// the colour is per place type (data-driven), and changing a data-driven
// colour on a theme switch makes MapLibre re-process every tile.
const CATEGORIES: Array<[string[], string]> = [
  [
    ["restaurant", "fast_food", "cafe", "bar", "pub", "ice_cream", "bakery", "beer", "food_court"],
    "#ef7d16",
  ],
  [
    [
      "shop",
      "grocery",
      "clothing_store",
      "alcohol_shop",
      "convenience",
      "supermarket",
      "mall",
      "hardware",
      "furniture",
      "florist",
      "jewelry",
      "mobile_phone",
      "butcher",
      "car",
      "books",
      "electronics",
    ],
    "#3b82f6",
  ],
  [["lodging", "hotel", "hostel", "guest_house", "motel"], "#ec4f8c"],
  [["hospital", "doctors", "pharmacy", "dentist", "clinic", "veterinary"], "#e5483d"],
  [
    [
      "park",
      "garden",
      "sports",
      "stadium",
      "playground",
      "pitch",
      "golf",
      "swimming",
      "zoo",
      "campsite",
    ],
    "#2f9e57",
  ],
  [
    [
      "attraction",
      "museum",
      "theatre",
      "cinema",
      "art_gallery",
      "music",
      "entertainment",
      "castle",
      "monument",
    ],
    "#a855f7",
  ],
  [["bus", "rail", "airport", "fuel", "parking", "car_rental"], "#3b82f6"],
];
const DEFAULT_TEXT = "#8a8f98";

function categoryColor(): unknown {
  const expr: unknown[] = ["match", ["get", "class"]];
  for (const [classes, color] of CATEGORIES) expr.push(classes, color);
  expr.push(DEFAULT_TEXT);
  return expr;
}

const POI_MINZOOM: Record<string, number> = { poi_r1: 14, poi_r7: 15, poi_r20: 16 };

function tunePoi(layer: LayerSpecification, theme: Theme): LayerSpecification {
  const l = structuredClone(layer) as LayerSpecification & {
    layout: Record<string, unknown>;
    paint: Record<string, unknown>;
  };
  if (POI_MINZOOM[l.id] !== undefined) l.minzoom = POI_MINZOOM[l.id];
  l.layout["text-font"] = ["Noto Sans Regular"];
  l.layout["text-size"] = 11.5;
  l.paint["text-color"] = categoryColor();
  l.paint["text-halo-color"] = theme === "light" ? "#ffffff" : DARK_BG;
  l.paint["text-halo-width"] = 1.2;
  l.paint["text-halo-blur"] = 0;
  return l;
}

const cache = new Map<string, Promise<StyleSpecification>>();
function fetchStyle(name: string): Promise<StyleSpecification> {
  let p = cache.get(name);
  if (!p) {
    p = fetch(`${STYLE_URL}/${name}`).then((r) => {
      if (!r.ok) throw new Error(`style ${name}: ${r.status}`);
      return r.json() as Promise<StyleSpecification>;
    });
    p.catch(() => cache.delete(name));
    cache.set(name, p);
  }
  return p;
}

// Dark = the same liberty layers repainted in a navy palette (matching the
// app). Only colours differ between the themes, never layers, filters or
// layout, so switching theme is a repaint: no tile is re-parsed and nothing
// disappears mid-switch.
const DARK_BG = "#111827";
const D = {
  land: "#151e2e",
  green: "#13281f",
  greenEdge: "#173126",
  water: "#0c2236",
  waterText: "#5b88b5",
  pale: "#182131",
  hospital: "#2a1a24",
  school: "#1d2236",
  casing: "#0d1320",
  motorway: "#5b6577",
  major: "#4a5568",
  minor: "#2f3b4f",
  rail: "#3a4458",
  building: "#1c2535",
  buildingEdge: "#232e40",
  boundary: "#4b5563",
  roadText: "#9aa4b2",
  placeText: "#cbd5e1",
};

function darkPaint(l: LayerSpecification): Record<string, unknown> | null {
  const id = l.id;
  if (id === "background") return { "background-color": DARK_BG };
  if (id === "natural_earth") return { "raster-opacity": 0.15 };
  if (id === "park") return { "fill-color": D.green, "fill-outline-color": D.green };
  if (id === "park_outline") return { "line-color": D.greenEdge };
  if (/^(landcover_(wood|grass)|landuse_(pitch|track|cemetery))$/.test(id))
    return { "fill-color": D.green };
  if (id === "landuse_residential") return { "fill-color": D.land };
  if (id === "landuse_hospital") return { "fill-color": D.hospital };
  if (id === "landuse_school") return { "fill-color": D.school };
  if (/^(landcover_(ice|sand)|aeroway_fill)$/.test(id)) return { "fill-color": D.pale };
  if (id === "water") return { "fill-color": D.water };
  if (id.startsWith("waterway_") && l.type === "line") return { "line-color": D.water };
  if (/^aeroway_(runway|taxiway)$/.test(id)) return { "line-color": D.minor };
  if (id === "building") return { "fill-color": D.building, "fill-outline-color": D.buildingEdge };
  if (id === "building-3d") return { "fill-extrusion-color": D.building };
  if (id.startsWith("boundary_")) return { "line-color": D.boundary };
  if (/^(road|tunnel|bridge)_/.test(id) && l.type === "line") {
    if (id.includes("rail")) return { "line-color": D.rail };
    if (id.endsWith("_casing")) return { "line-color": D.casing };
    if (id.includes("motorway")) return { "line-color": D.motorway };
    if (/trunk|primary|secondary|tertiary|_link$/.test(id)) return { "line-color": D.major };
    return { "line-color": D.minor };
  }
  if (l.type === "symbol") {
    if (/^(waterway_line_label|water_name_)/.test(id))
      return { "text-color": D.waterText, "text-halo-color": DARK_BG };
    if (id.startsWith("highway-name"))
      return { "text-color": D.roadText, "text-halo-color": DARK_BG, "text-halo-width": 1 };
    if (id === "airport" || id.startsWith("label_"))
      return { "text-color": D.placeText, "text-halo-color": DARK_BG };
  }
  return null;
}

const isPoi = (l: LayerSpecification) => l.id.startsWith("poi_");

const built = new Map<Theme, Promise<StyleSpecification>>();

/** The finished style for a theme; built once, then served from memory. */
export function loadMapStyle(theme: Theme): Promise<StyleSpecification> {
  let p = built.get(theme);
  if (!p) {
    p = buildMapStyle(theme);
    p.catch(() => built.delete(theme));
    built.set(theme, p);
  }
  // A fresh copy each time: MapLibre may hold on to (or touch) what it is given.
  return p.then((st) => structuredClone(st));
}

/** Warm both themes so the first paint and every toggle are instant. */
export function prefetchMapStyles() {
  if (typeof window === "undefined") return;
  loadMapStyle("light").catch(() => {});
  loadMapStyle("dark").catch(() => {});
}

async function buildMapStyle(theme: Theme): Promise<StyleSpecification> {
  const style = structuredClone(await fetchStyle("liberty"));
  style.layers = style.layers.map((l) => {
    if (isPoi(l)) return tunePoi(l, theme);
    // Road names get a halo in both themes so the property set is identical.
    if (theme === "light" && l.id.startsWith("highway-name")) {
      const c = structuredClone(l) as LayerSpecification & { paint?: Record<string, unknown> };
      c.paint = { ...c.paint, "text-halo-color": "#f8f4f0", "text-halo-width": 1 };
      return c as LayerSpecification;
    }
    const paint = theme === "dark" ? darkPaint(l) : null;
    if (!paint) return l;
    const c = structuredClone(l) as LayerSpecification & { paint?: Record<string, unknown> };
    c.paint = { ...c.paint, ...paint };
    return c as LayerSpecification;
  });
  return style;
}

export function supportsWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}
