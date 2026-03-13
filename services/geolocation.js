/**
 * Location: ip-api.com (city, country) — fast and reliable.
 * Optional: OpenStreetMap Nominatim for lat/lon (e.g. from browser GPS).
 */

const fetch = require("node-fetch");

const CACHE = new Map();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const NOMINATIM_UA = "FL-AHPS-FLAHPS/1.0 (Account Security)";
let lastNominatimCall = 0;
const NOMINATIM_MIN_GAP_MS = 1100;

function isLocalIp(ip) {
  if (!ip) return true;
  const s = String(ip).trim().toLowerCase();
  if (s === "::1" || s === "127.0.0.1" || s === "::ffff:127.0.0.1") return true;
  return false;
}

function getCached(key) {
  const entry = CACHE.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    CACHE.delete(key);
    return null;
  }
  return { city: entry.city, country: entry.country };
}

function setCache(key, city, country) {
  if (!key) return;
  CACHE.set(key, { city: city || null, country: country || null, at: Date.now() });
}

async function fetchWithTimeout(url, ms = 8000, headers = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers });
    clearTimeout(t);
    return res;
  } catch (e) {
    clearTimeout(t);
    throw e;
  }
}

/**
 * Get city/country from IP using ip-api.com (no key, reliable).
 * Returns immediately with ip-api data so backfill and login both get location.
 */
async function getGeoFromIp(ip) {
  if (isLocalIp(ip)) return { city: null, country: null };

  const norm = String(ip).trim();
  const cached = getCached("ip:" + norm);
  if (cached) return cached;

  try {
    const res = await fetchWithTimeout(
      `http://ip-api.com/json/${encodeURIComponent(norm)}?fields=status,city,country,lat,lon`
    );
    if (!res.ok) {
      setCache("ip:" + norm, null, null);
      return { city: null, country: null };
    }
    const data = await res.json();
    if (data.status !== "success") {
      setCache("ip:" + norm, null, null);
      return { city: null, country: null };
    }
    const city = data.city || null;
    const country = data.country || null;
    setCache("ip:" + norm, city, country);
    return { city, country };
  } catch (_) {
    setCache("ip:" + norm, null, null);
    return { city: null, country: null };
  }
}

/** OpenStreetMap Nominatim: reverse geocode lat,lon → city, country (e.g. for browser GPS). */
async function reverseGeocode(lat, lon) {
  const key = `nominatim:${Number(lat).toFixed(4)}:${Number(lon).toFixed(4)}`;
  const cached = getCached(key);
  if (cached) return cached;

  const now = Date.now();
  const wait = lastNominatimCall + NOMINATIM_MIN_GAP_MS - now;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastNominatimCall = Date.now();

  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&format=json`;
    const res = await fetchWithTimeout(url, 8000, {
      "User-Agent": NOMINATIM_UA,
      Accept: "application/json",
    });
    if (!res.ok) return { city: null, country: null };
    const data = await res.json();
    const addr = data.address || {};
    const city = addr.city || addr.town || addr.village || addr.municipality || addr.county || null;
    const country = addr.country || null;
    setCache(key, city, country);
    return { city, country };
  } catch (_) {
    return { city: null, country: null };
  }
}

/** Get city/country from GPS coordinates (browser navigator.geolocation). Uses OpenStreetMap. */
async function getGeoFromCoords(lat, lon) {
  if (lat == null || lon == null) return { city: null, country: null };
  return reverseGeocode(Number(lat), Number(lon));
}

module.exports = { getGeoFromIp, getGeoFromCoords, reverseGeocode, isLocalIp, setCache, getCached };

