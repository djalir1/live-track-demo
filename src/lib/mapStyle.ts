// Vector basemap styles (OpenFreeMap, free, no API key) tuned to read like
// Google Maps: coloured place icons and labels by category, street names from
// zoom 14. Light = OpenFreeMap "liberty"; dark = OpenFreeMap "dark" plus
// liberty's place layers recoloured for a dark background (the stock dark
// style has no places at all).
import type { StyleSpecification, LayerSpecification } from "maplibre-gl";

const STYLE_URL = "https://tiles.openfreemap.org/styles";

type Theme = "light" | "dark";

// Category → colour, Google-style. [light, dark]
const CATEGORIES: Array<[string[], string, string]> = [
  [
    ["restaurant", "fast_food", "cafe", "bar", "pub", "ice_cream", "bakery", "beer", "food_court"],
    "#e8710a",
    "#fba65d",
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
    "#1a73e8",
    "#8ab4f8",
  ],
  [["lodging", "hotel", "hostel", "guest_house", "motel"], "#e8437f", "#f48fb1"],
  [["hospital", "doctors", "pharmacy", "dentist", "clinic", "veterinary"], "#d93025", "#f28b82"],
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
    "#188038",
    "#81c995",
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
    "#9334e6",
    "#c58af9",
  ],
  [["bus", "rail", "airport", "fuel", "parking", "car_rental"], "#3367d6", "#8ab4f8"],
];
const DEFAULT_TEXT: Record<Theme, string> = { light: "#5f6368", dark: "#bdc1c6" };

function categoryColor(theme: Theme): unknown {
  const expr: unknown[] = ["match", ["get", "class"]];
  for (const [classes, light, dark] of CATEGORIES)
    expr.push(classes, theme === "light" ? light : dark);
  expr.push(DEFAULT_TEXT[theme]);
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
  l.paint["text-color"] = categoryColor(theme);
  l.paint["text-halo-color"] = theme === "light" ? "#ffffff" : "#1f2228";
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

const isPoi = (l: LayerSpecification) => l.id.startsWith("poi_");

export async function loadMapStyle(theme: Theme): Promise<StyleSpecification> {
  const liberty = structuredClone(await fetchStyle("liberty"));
  if (theme === "light") {
    liberty.layers = liberty.layers.map((l) => (isPoi(l) ? tunePoi(l, "light") : l));
    return liberty;
  }

  const dark = structuredClone(await fetchStyle("dark"));
  const pois = liberty.layers.filter(isPoi).map((l) => tunePoi(l, "dark"));
  dark.layers = dark.layers.map((l) => {
    // Stock street names are near-black on black; make them readable.
    if (l.id === "highway_name_other" || l.id === "highway_name_motorway") {
      const c = structuredClone(l) as LayerSpecification & { paint: Record<string, unknown> };
      c.paint["text-color"] = "#9aa0a6";
      c.paint["text-halo-color"] = "#16181d";
      return c;
    }
    return l;
  });
  // Places sit above roads and street names, below boundaries and towns.
  const at = dark.layers.findIndex((l) => l.id === "boundary_state");
  dark.layers.splice(at < 0 ? dark.layers.length : at, 0, ...pois);
  return dark;
}

export function supportsWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}
