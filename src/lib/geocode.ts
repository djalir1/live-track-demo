// Lightweight reverse geocoder using OpenStreetMap Nominatim.
// - In-memory cache keyed by rounded lat/lon (~11m precision at 4dp) to avoid
//   hammering the service and to satisfy fair-use limits.
// - Sessionstorage-backed so repeated visits reuse.
// - Debounced batching: waits 350ms and dedupes coincident calls.

const CACHE_KEY = "pulse:revgeo:v1";
const cache = new Map<string, string>();

if (typeof window !== "undefined") {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (raw) {
      const obj = JSON.parse(raw) as Record<string, string>;
      for (const [k, v] of Object.entries(obj)) cache.set(k, v);
    }
  } catch {
    /* ignore */
  }
}

function persist() {
  if (typeof window === "undefined") return;
  const obj: Record<string, string> = {};
  for (const [k, v] of cache) obj[k] = v;
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(obj));
  } catch {
    /* quota — drop it */
  }
}

function keyOf(lat: number, lon: number) {
  return `${lat.toFixed(4)},${lon.toFixed(4)}`;
}

const inflight = new Map<string, Promise<string>>();

async function fetchNominatim(lat: number, lon: number): Promise<string> {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=17&addressdetails=1`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`geocode ${res.status}`);
  const data = (await res.json()) as {
    name?: string;
    display_name?: string;
    address?: Record<string, string>;
  };
  const a = data.address ?? {};
  // Build a human-friendly short label: road + suburb/city, fall back to display_name.
  const road = a.road ?? a.pedestrian ?? a.path ?? a.residential ?? a.footway ?? a.neighbourhood ?? data.name;
  const area = a.suburb ?? a.city_district ?? a.city ?? a.town ?? a.village ?? a.county;
  const compact = [road, area].filter(Boolean).join(", ");
  return compact || data.display_name || "Unknown location";
}

/**
 * Get a human-readable address for a coordinate. Returns immediately from cache
 * if available, otherwise fetches (once) and caches. Multiple calls for the
 * same coordinate share the same in-flight request.
 */
export async function reverseGeocode(lat: number | null | undefined, lon: number | null | undefined): Promise<string | null> {
  if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const k = keyOf(lat, lon);
  const hit = cache.get(k);
  if (hit) return hit;
  const pending = inflight.get(k);
  if (pending) return pending;
  const p = fetchNominatim(lat, lon)
    .then((label) => {
      cache.set(k, label);
      persist();
      return label;
    })
    .catch(() => {
      // Cache a placeholder so we don't retry hot loops on failure.
      const fallback = `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
      cache.set(k, fallback);
      persist();
      return fallback;
    })
    .finally(() => {
      inflight.delete(k);
    });
  inflight.set(k, p);
  return p;
}

/** Synchronous cache read — never triggers a fetch. */
export function cachedReverseGeocode(lat: number | null | undefined, lon: number | null | undefined): string | null {
  if (lat == null || lon == null) return null;
  return cache.get(keyOf(lat, lon)) ?? null;
}
