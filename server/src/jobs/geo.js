/**
 * State boundary helpers for the OSM fetcher: per-state bounding boxes and
 * point-in-state lookup, from a simplified US states GeoJSON that is
 * downloaded once into server/data (gitignored).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const { US_STATES } = require('./osm');

const GEOJSON_PATH = path.join(__dirname, '..', '..', 'data', 'us-states.geojson');
const GEOJSON_URL = 'https://raw.githubusercontent.com/PublicaMundi/MappingAPI/master/data/geojson/us-states.json';

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const get = (u, redirects = 0) => https.get(u, res => {
      if ([301, 302, 307, 308].includes(res.statusCode) && redirects < 5) return get(res.headers.location, redirects + 1);
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} downloading ${u}`));
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, Buffer.concat(chunks)); resolve(dest); });
      res.on('error', reject);
    }).on('error', reject);
    get(url);
  });
}

let cache = null;

async function loadStates() {
  if (cache) return cache;
  if (!fs.existsSync(GEOJSON_PATH)) await download(GEOJSON_URL, GEOJSON_PATH);
  const gj = JSON.parse(fs.readFileSync(GEOJSON_PATH, 'utf8'));
  const byName = Object.fromEntries(Object.entries(US_STATES).map(([code, name]) => [name.toLowerCase(), code]));
  const states = [];
  for (const f of gj.features) {
    const code = byName[(f.properties.name || '').toLowerCase()];
    if (!code) continue;
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
    for (const poly of polys) for (const [lng, lat] of poly[0]) {
      if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng; if (lng > maxLng) maxLng = lng;
    }
    // Alaska crosses the antimeridian in some datasets; clamp to the western hemisphere box.
    if (code === 'AK') { minLng = Math.max(minLng, -180); maxLng = Math.min(maxLng, -129); }
    states.push({ code, name: f.properties.name, polys, bbox: { minLat, minLng, maxLat, maxLng } });
  }
  cache = states;
  return states;
}

function pointInRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    const intersect = ((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInPolys(lng, lat, polys) {
  for (const poly of polys) {
    if (!pointInRing(lng, lat, poly[0])) continue;
    let inHole = false;
    for (let h = 1; h < poly.length; h++) if (pointInRing(lng, lat, poly[h])) { inHole = true; break; }
    if (!inHole) return true;
  }
  return false;
}

function distToBbox(lat, lng, b) {
  const dLat = Math.max(b.minLat - lat, 0, lat - b.maxLat);
  const dLng = Math.max(b.minLng - lng, 0, lng - b.maxLng);
  return Math.hypot(dLat, dLng * Math.cos(lat * Math.PI / 180));
}

/**
 * Two-letter state code for a point, or null when it is nowhere near the US.
 *
 * The boundary file is simplified, so a shop on a pier, a barrier island, or a
 * riverfront block can fall just outside every polygon. Rather than dropping
 * those (they are exactly the waterfront tourist areas where cigar lounges
 * cluster), fall back to the nearest state within ~12 km. DC is checked last
 * because its simplified polygon spills across the Potomac into Virginia.
 */
async function stateForPoint(lat, lng, preferred = null) {
  const states = await loadStates();
  const rank = s => (s.code === preferred ? 0 : s.code === 'DC' ? 2 : 1);
  const order = [...states].sort((a, b) => rank(a) - rank(b));

  const pref = preferred ? states.find(s => s.code === preferred) : null;
  const inPrefBox = pref && distToBbox(lat, lng, pref.bbox) === 0;

  for (const s of order) {
    const b = s.bbox;
    if (lat < b.minLat || lat > b.maxLat || lng < b.minLng || lng > b.maxLng) continue;
    if (!pointInPolys(lng, lat, s.polys)) continue;
    // DC's simplified outline crosses the Potomac, so points in Arlington and
    // Alexandria land inside it. When the caller asked about Virginia or
    // Maryland and the point sits in that state's box, believe the caller.
    if (s.code === 'DC' && preferred && preferred !== 'DC' && inPrefBox) return preferred;
    return s.code;
  }

  // Outside every polygon. Snap to the closest state box within ~12 km, which
  // recovers piers, barrier islands, and riverfront blocks the simplification
  // cuts off. The caller's state wins ties.
  const MAX_SNAP_DEG = 0.11;
  if (pref && distToBbox(lat, lng, pref.bbox) <= MAX_SNAP_DEG) return preferred;
  let best = null, bestDist = Infinity;
  for (const s of order) {
    const d = distToBbox(lat, lng, s.bbox);
    if (d < bestDist) { bestDist = d; best = s.code; }
  }
  if (bestDist <= MAX_SNAP_DEG) return best;

  // Island chains (the Florida Keys, the Outer Banks) are missing from the
  // simplified outlines entirely. Only the state the caller queried can claim
  // them, and only when nothing else is closer.
  if (pref && distToBbox(lat, lng, pref.bbox) <= 1.5 && bestDist >= distToBbox(lat, lng, pref.bbox)) return preferred;
  return null;
}

module.exports = { loadStates, stateForPoint, GEOJSON_PATH };
