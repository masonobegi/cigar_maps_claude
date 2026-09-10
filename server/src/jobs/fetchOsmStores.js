/**
 * Fetch every cigar / tobacco shop in the US from OpenStreetMap and write
 * them to server/src/data/osm_stores.json. No database needed.
 *
 * Strategy (tuned against the public Overpass servers):
 *   - one bounding-box query per state (bboxes overlap, so each result is
 *     assigned to a state by point-in-polygon and deduped by OSM id)
 *   - sequential requests with a pause between states, 429 backoff, mirror
 *     rotation on timeouts
 *   - resumable: states already in the file are skipped unless --force
 *
 * Usage:
 *   node src/jobs/fetchOsmStores.js                 # all states
 *   node src/jobs/fetchOsmStores.js --states WA,OR  # a few states
 *   node src/jobs/fetchOsmStores.js --force         # refetch states already in the file
 *   node src/jobs/fetchOsmStores.js --fill-cities   # reverse-geocode records that lack a city (1 req/s)
 *
 * The output file is committed to the repo; the server imports it on boot
 * (see importStores.js), so a fresh deploy gets the full map with no manual step.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const { US_STATES, fetchBbox, normalizeElement, dedupe, sleep } = require('./osm');
const { loadStates, stateForPoint } = require('./geo');

const OUT_PATH = path.join(__dirname, '..', 'data', 'osm_stores.json');
const PAUSE_BETWEEN_STATES_MS = 12000;

function loadFile() {
  try { return JSON.parse(fs.readFileSync(OUT_PATH, 'utf8')); }
  catch { return { generated_at: null, states: {}, stores: [] }; }
}

function saveFile(data) {
  data.generated_at = new Date().toISOString();
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(data, null, 1));
}

function parseArgs() {
  const args = process.argv.slice(2);
  const get = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
  return {
    states: (get('--states') || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean),
    force: args.includes('--force'),
    fillCities: args.includes('--fill-cities'),
  };
}

async function fetchAll({ states, force }) {
  const data = loadFile();
  const geo = await loadStates();
  const byCode = Object.fromEntries(geo.map(s => [s.code, s]));
  const codes = states.length ? states : Object.keys(US_STATES).filter(c => byCode[c]);

  for (const code of codes) {
    const st = byCode[code];
    if (!st) { console.log(`${code}: no boundary polygon, skipping`); continue; }
    if (!force && data.states[code]?.count > 0) { console.log(`${code}: already fetched (${data.states[code].count}), skipping`); continue; }

    process.stdout.write(`${code} (${st.name})... `);
    try {
      const elements = await fetchBbox(st.bbox);
      let inState = 0, outside = 0;
      const records = [];
      for (const el of elements) {
        const rec = normalizeElement(el, code);
        if (!rec) continue;
        const actual = await stateForPoint(rec.lat, rec.lng, code);
        if (actual !== code) { outside++; continue; } // belongs to a neighbour's bbox run
        rec.state = code;
        records.push(rec);
        inState++;
      }
      const cleaned = dedupe(records);
      const keepIds = new Set(cleaned.map(r => r.source_id));
      data.stores = data.stores.filter(s => s.state !== code && !keepIds.has(s.source_id));
      data.stores.push(...cleaned);
      data.states[code] = { fetched_at: new Date().toISOString(), raw: elements.length, count: cleaned.length };
      const visible = cleaned.filter(s => s.confidence >= 0.5).length;
      console.log(`${elements.length} raw (${outside} outside state), ${cleaned.length} unique, ${visible} public`);
      saveFile(data);
    } catch (err) {
      console.log(`FAILED: ${err.message}`);
    }
    await sleep(PAUSE_BETWEEN_STATES_MS);
  }

  const all = data.stores.length;
  const pub = data.stores.filter(s => s.confidence >= 0.5).length;
  const noCity = data.stores.filter(s => !s.city).length;
  const done = Object.keys(data.states).length;
  console.log(`\nDone. ${done}/${codes.length} states in file, ${all} stores (${pub} public, ${noCity} missing city).`);
}

// ── Reverse geocode missing cities (Nominatim, max 1 request / second) ──────

function reverseGeocode(lat, lng) {
  return new Promise(resolve => {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=10&addressdetails=1`;
    https.get(url, { headers: { 'User-Agent': 'CigarBuddy/1.0 (mason.obegi@gmail.com)' } }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const a = JSON.parse(d).address || {};
          resolve({
            city: a.city || a.town || a.village || a.municipality || a.county || null,
            zip: a.postcode || null,
          });
        } catch { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

async function fillCities() {
  const data = loadFile();
  // Public listings first; hidden ones only matter if an admin unhides them.
  const missing = data.stores.filter(s => !s.city).sort((a, b) => b.confidence - a.confidence);
  console.log(`${missing.length} stores missing a city. Estimated ${Math.ceil(missing.length / 55)} minutes.`);
  let done = 0;
  for (const s of missing) {
    const r = await reverseGeocode(s.lat, s.lng);
    if (r?.city) { s.city = r.city.replace(/^City of /i, ''); if (!s.zip && r.zip) s.zip = r.zip.split('-')[0]; }
    done++;
    if (done % 25 === 0) { saveFile(data); console.log(`  ${done}/${missing.length}`); }
    await sleep(1100);
  }
  saveFile(data);
  console.log(`Filled ${data.stores.filter(s => s.city).length}/${data.stores.length} cities.`);
}

if (require.main === module) {
  const opts = parseArgs();
  (opts.fillCities ? fillCities() : fetchAll(opts))
    .catch(err => { console.error(err); process.exit(1); });
}

module.exports = { OUT_PATH, loadFile };
