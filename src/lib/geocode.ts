// Lightweight reverse geocoder using OpenStreetMap Nominatim.
// - Persistent in-memory + sessionStorage cache keyed by rounded lat/lon (~11 m at 4 dp).
// - Global 1 request/second queue: Nominatim's usage policy caps us at 1 rps
//   and threatens bulk callers with blocks. Every network call — from any caller,
//   in any order — passes through the same gate.
// - Stores both a compact label AND the parsed address parts, so callers that
//   need the district (e.g. the PDF header) don't have to re-fetch.

const CACHE_KEY = "pulse:revgeo:v2";

export interface AddressParts {
  road: string | null;
  suburb: string | null;
  neighbourhood: string | null;
  city_district: string | null;
  city: string | null;
  county: string | null;
  country: string | null;
}

export interface GeoRecord {
  label: string;
  parts: AddressParts;
}

const cache = new Map<string, GeoRecord>();

if (typeof window !== "undefined") {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (raw) {
      const obj = JSON.parse(raw) as Record<string, GeoRecord>;
      for (const [k, v] of Object.entries(obj)) cache.set(k, v);
    }
  } catch {
    /* ignore */
  }
}

function persist() {
  if (typeof window === "undefined") return;
  const obj: Record<string, GeoRecord> = {};
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

// ── Global 1 rps queue ───────────────────────────────────────────────────────
const MIN_INTERVAL_MS = 1000;
let lastRequestAt = 0;
let queueTail: Promise<void> = Promise.resolve();

function scheduled<T>(job: () => Promise<T>): Promise<T> {
  const run = queueTail.then(async () => {
    const wait = Math.max(0, MIN_INTERVAL_MS - (Date.now() - lastRequestAt));
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt = Date.now();
  }).then(job);
  // Swallow errors in the tail so one bad request doesn't stall the queue.
  queueTail = run.then(() => undefined, () => undefined);
  return run;
}

const inflight = new Map<string, Promise<GeoRecord>>();

function compose(parts: AddressParts, fallback: string): string {
  const road = parts.road;
  const secondary = parts.suburb ?? parts.neighbourhood;
  const district = parts.city_district ?? parts.county;
  const bits = [road, secondary, district].filter(Boolean);
  return bits.length > 0 ? bits.join(", ") : fallback;
}

async function fetchNominatim(lat: number, lon: number): Promise<GeoRecord> {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=17&addressdetails=1`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`geocode ${res.status}`);
  const data = (await res.json()) as {
    name?: string;
    display_name?: string;
    address?: Record<string, string>;
  };
  const a = data.address ?? {};
  const parts: AddressParts = {
    road: a.road ?? a.pedestrian ?? a.path ?? a.residential ?? a.footway ?? null,
    suburb: a.suburb ?? null,
    neighbourhood: a.neighbourhood ?? null,
    city_district: a.city_district ?? null,
    city: a.city ?? a.town ?? a.village ?? null,
    county: a.county ?? null,
    country: a.country ?? null,
  };
  const label = compose(parts, data.display_name ?? "Unknown location");
  return { label, parts };
}

async function lookup(lat: number, lon: number): Promise<GeoRecord> {
  const k = keyOf(lat, lon);
  const hit = cache.get(k);
  if (hit) return hit;
  const pending = inflight.get(k);
  if (pending) return pending;
  const p = scheduled(() => fetchNominatim(lat, lon))
    .then((rec) => {
      cache.set(k, rec);
      persist();
      return rec;
    })
    .catch(() => {
      // Cache a placeholder so we don't hammer a failing endpoint.
      const fallback: GeoRecord = {
        label: `${lat.toFixed(4)}, ${lon.toFixed(4)}`,
        parts: { road: null, suburb: null, neighbourhood: null, city_district: null, city: null, county: null, country: null },
      };
      cache.set(k, fallback);
      persist();
      return fallback;
    })
    .finally(() => { inflight.delete(k); });
  inflight.set(k, p);
  return p;
}

/**
 * Get a human-readable address label for a coordinate. Returns immediately from
 * cache if available; otherwise queues a rate-limited Nominatim lookup.
 */
export async function reverseGeocode(lat: number | null | undefined, lon: number | null | undefined): Promise<string | null> {
  if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const rec = await lookup(lat, lon);
  return rec.label;
}

/**
 * Full address record for a coordinate — label + parsed parts. Same rate-limited
 * cache as reverseGeocode(); callers that need the district or city can use this.
 */
export async function reverseGeocodeAddress(lat: number | null | undefined, lon: number | null | undefined): Promise<GeoRecord | null> {
  if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return lookup(lat, lon);
}

/** Synchronous cache read — never triggers a fetch. */
export function cachedReverseGeocode(lat: number | null | undefined, lon: number | null | undefined): string | null {
  if (lat == null || lon == null) return null;
  return cache.get(keyOf(lat, lon))?.label ?? null;
}
