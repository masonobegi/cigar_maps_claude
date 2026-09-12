/**
 * Build the unified store directory from every raw source and write
 * server/src/data/store_directory.json.gz, which importStores.js loads on boot.
 *
 * Sources (all permissively licensed, attribution kept on the map):
 *   - Overture Maps places (CDLA-Permissive 2.0): server/data/overture_raw.json,
 *     produced by the DuckDB extract (see scratch overture_extract.py; the
 *     query is reproduced at the bottom of this file).
 *   - OpenStreetMap (ODbL): server/src/data/osm_stores.json from fetchOsmStores.js.
 *
 * Steps: normalize each source into one record shape, classify (confidence +
 * store type), dedupe within a source, then merge OSM records into Overture
 * twins (same name within 150 m) so a shop appears once. Merged records keep
 * both ids (source_id for the primary, osm_id for the OSM twin) so the
 * importer can upgrade rows that were imported from OSM earlier in place.
 *
 * Usage: node src/jobs/buildDirectory.js [--overture path/to/overture_raw.json] [--osm path/to/osm_stores.json]
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { US_STATES, classify, normalizePhone, normalizeWebsite, dedupe, haversineMeters, namesMatch } = require('./osm');
const { stateForPoint } = require('./geo');

const OUT_PATH = path.join(__dirname, '..', 'data', 'store_directory.json.gz');
const DEFAULT_OSM = path.join(__dirname, '..', 'data', 'osm_stores.json');
const DEFAULT_OVERTURE = path.join(__dirname, '..', '..', 'data', 'overture_raw.json');

// Overture category -> the tag shape classify() understands
const CATEGORY_TAGS = {
  tobacco_shop: { shop: 'tobacco' },
  tobacconist: { shop: 'tobacco' },
  cigar_shop: { shop: 'cigar' },
  cigar_bar: { amenity: 'bar', club: 'cigar' },
  cigar_lounge: { amenity: 'lounge', club: 'cigar' },
  smoke_shop: { shop: 'tobacco' },
  e_cigarette_store: { shop: 'e-cigarette' },
  vape_shop: { shop: 'e-cigarette' },
  hookah_bar: { amenity: 'bar' },
  lounge: { amenity: 'lounge' },
  bar: { amenity: 'bar' },
  cocktail_bar: { amenity: 'bar' },
  whisky_bar: { amenity: 'bar' },
  convenience_store: { shop: 'convenience' },
  gas_station: { shop: 'convenience' },
  liquor_store: { shop: 'convenience' },
  grocery_store: { shop: 'convenience' },
  cannabis_clinic: { shop: 'cannabis' },
  cannabis_dispensary: { shop: 'cannabis' },
};

function titleCase(s) {
  if (!s) return s;
  return s.replace(/\w\S*/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase());
}

function pickInstagram(socials) {
  for (const s of socials || []) {
    const m = String(s).match(/instagram\.com\/([A-Za-z0-9_.]+)/i);
    if (m) return m[1];
  }
  return null;
}

async function normalizeOverture(row) {
  if (!row.name || row.name.length < 3) return null;
  const lat = Number(row.lat), lng = Number(row.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const country = row.country || 'US';
  if (country !== 'US' && country !== 'PR') return null;

  let state = (row.region || '').toUpperCase().replace(/^US-/, '');
  if (!US_STATES[state]) state = await stateForPoint(lat, lng);
  if (!state) return null;

  const website = normalizeWebsite((row.websites || [])[0]);
  const tags = { ...(CATEGORY_TAGS[row.category] || {}) };
  for (const alt of row.alt_categories || []) {
    const t = CATEGORY_TAGS[alt];
    if (!t) continue;
    if (t.club && !tags.club) tags.club = t.club;
    if (!tags.shop && t.shop && t.shop !== 'convenience') tags.shop = t.shop;
  }
  let { confidence, store_type } = classify(row.name, tags, website);
  // Overture's own confidence is a place-existence score; nudge low-confidence records down.
  if (typeof row.confidence === 'number' && row.confidence < 0.5) confidence = Math.max(0, confidence - 0.15);
  confidence = Math.round(confidence * 100) / 100;
  if (row.category === 'cigar_bar' || row.category === 'cigar_lounge') store_type = 'cigar_lounge';

  const tagsOut = [];
  if (store_type === 'cigar_lounge' || row.category === 'lounge' || /lounge/i.test(row.name)) tagsOut.push('Lounge');
  if (/humidor/i.test(row.name)) tagsOut.push('Walk-in Humidor');

  return {
    source: 'overture',
    source_id: row.id,
    name: row.name.trim(),
    address: row.address || null,
    city: row.city ? titleCase(row.city) : null,
    state,
    zip: (row.zip || '').split(/[-\s]/)[0] || null,
    phone: normalizePhone((row.phones || [])[0]),
    website,
    instagram: pickInstagram(row.socials),
    lat: Math.round(lat * 1e6) / 1e6,
    lng: Math.round(lng * 1e6) / 1e6,
    hours: null,
    hours_raw: null,
    store_type,
    confidence,
    has_lounge: tagsOut.includes('Lounge') ? 1 : 0,
    has_walk_in_humidor: tagsOut.includes('Walk-in Humidor') ? 1 : 0,
    tags: tagsOut,
    // ctags is what classify() understands, kept so the importer can re-score a
    // record when the classifier improves without refetching the source.
    ctags: tags,
    // 'open' | 'permanently_closed' | null, straight from the source. Lags
    // reality by months, so it is one signal among several, never the last word.
    operating_status: row.operating_status || null,
    raw: {
      category: row.category, alt: row.alt_categories || [],
      basic_category: row.basic_category || null, taxonomy: row.taxonomy_primary || null,
      ov_confidence: row.confidence, dataset: row.source_dataset,
    },
  };
}

function spatialIndex(records) {
  const cells = new Map();
  const key = (lat, lng) => `${Math.floor(lat * 100)}:${Math.floor(lng * 100)}`; // ~1.1 km cells
  for (const r of records) {
    const k = key(r.lat, r.lng);
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k).push(r);
  }
  return {
    near(lat, lng) {
      const out = [];
      const la = Math.floor(lat * 100), lo = Math.floor(lng * 100);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        const c = cells.get(`${la + a}:${lo + b}`);
        if (c) out.push(...c);
      }
      return out;
    },
  };
}

function fillMissing(target, from, fields) {
  for (const f of fields) if ((target[f] === null || target[f] === undefined || target[f] === '' || (Array.isArray(target[f]) && !target[f].length)) && from[f]) target[f] = from[f];
}

async function build({ overturePath = DEFAULT_OVERTURE, osmPath = DEFAULT_OSM } = {}) {
  const t0 = Date.now();
  const osmFile = fs.existsSync(osmPath) ? JSON.parse(fs.readFileSync(osmPath, 'utf8')) : { stores: [], states: {} };
  const overtureRaw = fs.existsSync(overturePath) ? JSON.parse(fs.readFileSync(overturePath, 'utf8')) : [];
  console.log(`inputs: ${overtureRaw.length} Overture rows, ${osmFile.stores.length} OSM records`);

  const overture = [];
  for (const row of overtureRaw) {
    const rec = await normalizeOverture(row);
    if (rec) overture.push(rec);
  }
  const overtureClean = dedupe(overture);
  console.log(`overture: ${overture.length} usable, ${overtureClean.length} after dedupe`);

  // Merge OSM into Overture twins; keep the rest as OSM records.
  const index = spatialIndex(overtureClean);
  let merged = 0;
  const osmOnly = [];
  for (const o of osmFile.stores) {
    // Re-run classification so classifier improvements apply
    const { confidence, store_type } = classify(o.name, o.osm_tags || {}, o.website);
    const rec = { ...o, confidence, store_type, ctags: o.osm_tags || {}, raw: o.osm_tags || {} };
    delete rec.osm_tags; delete rec._fetched_state;
    const twin = index.near(rec.lat, rec.lng).find(t =>
      // The town is passed so that a name which is only the town's name
      // cannot stand as the thing the two records have in common: "Bellevue
      // Cigar" and "Tobacco Bellevue" are 42 m apart on Lincoln Ave and are
      // two different businesses.
      !t.osm_id && haversineMeters(t.lat, t.lng, rec.lat, rec.lng) < 150
      && namesMatch(t.name, rec.name, { town: rec.city || t.city }));
    if (twin) {
      twin.osm_id = rec.source_id;
      fillMissing(twin, rec, ['address', 'city', 'zip', 'phone', 'website', 'instagram', 'hours', 'hours_raw']);
      twin.confidence = Math.max(twin.confidence, rec.confidence);
      if (rec.store_type === 'cigar_lounge' || (rec.store_type === 'cigar_shop' && twin.store_type === 'tobacco_shop')) twin.store_type = rec.store_type;
      twin.has_lounge = twin.has_lounge || rec.has_lounge || 0;
      twin.has_walk_in_humidor = twin.has_walk_in_humidor || rec.has_walk_in_humidor || 0;
      twin.tags = [...new Set([...(twin.tags || []), ...(rec.tags || [])])];
      merged++;
    } else {
      osmOnly.push(rec);
    }
  }

  const stores = [...overtureClean, ...osmOnly];
  const visible = stores.filter(s => s.confidence >= 0.5).length;
  const closed = stores.filter(s => s.operating_status === 'permanently_closed').length;
  const byType = {};
  for (const s of stores) if (s.confidence >= 0.5) byType[s.store_type] = (byType[s.store_type] || 0) + 1;
  const out = {
    generated_at: new Date().toISOString(),
    sources: {
      overture: { release: process.env.OVERTURE_RELEASE || '2026-08-19.0', records: overtureClean.length, license: 'CDLA-Permissive-2.0' },
      osm: { records: osmOnly.length, merged_into_overture: merged, states: Object.keys(osmFile.states || {}).length, license: 'ODbL' },
    },
    stores,
  };
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, zlib.gzipSync(Buffer.from(JSON.stringify(out)), { level: 9 }));
  const kb = Math.round(fs.statSync(OUT_PATH).size / 1024);
  console.log(`directory: ${stores.length} stores (${visible} public), ${merged} OSM records merged into Overture twins, ${osmOnly.length} OSM-only`);
  console.log(`public by type: ${JSON.stringify(byType)}`);
  console.log(`marked permanently closed at source: ${closed}`);
  console.log(`wrote ${OUT_PATH} (${kb} KB) in ${Math.round((Date.now() - t0) / 1000)}s`);
  return out;
}

function loadDirectory(filePath = OUT_PATH) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(filePath)).toString('utf8'));
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const get = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
  build({ overturePath: get('--overture'), osmPath: get('--osm') }).catch(err => { console.error(err); process.exit(1); });
}

module.exports = { build, loadDirectory, OUT_PATH, DEFAULT_OVERTURE };

/*
DuckDB query used to produce server/data/overture_raw.json (python: pip install duckdb):

  INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2';
  SELECT id, names.primary AS name, categories.primary AS category, categories.alternate AS alt_categories,
         confidence, websites, phones, socials,
         addresses[1].freeform AS address, addresses[1].locality AS city, addresses[1].region AS region,
         addresses[1].postcode AS zip, addresses[1].country AS country,
         bbox.xmin AS lng, bbox.ymin AS lat, sources[1].dataset AS source_dataset
  FROM read_parquet('s3://overturemaps-us-west-2/release/<RELEASE>/theme=places/type=place/*.parquet', hive_partitioning=1)
  WHERE bbox.xmin BETWEEN -179.9 AND -64.0 AND bbox.ymin BETWEEN 17.5 AND 71.5
    AND (categories.primary IN ('tobacco_shop','cigar_bar','smoke_shop','cigar_shop','cigar_lounge','tobacconist')
         OR list_contains(categories.alternate, 'tobacco_shop') OR list_contains(categories.alternate, 'cigar_bar')
         OR regexp_matches(lower(coalesce(names.primary, '')), 'cigar|tobacconist|humidor|stogie'))
*/
