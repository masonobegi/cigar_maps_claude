/**
 * Import the national store directory (server/src/data/store_directory.json.gz,
 * built by buildDirectory.js from Overture Maps + OpenStreetMap) into the
 * stores table as unclaimed listings.
 *
 * - Idempotent: keyed on (source, source_id). Re-running updates unclaimed
 *   rows and never touches a store an owner has claimed.
 * - Runs automatically on server boot when the file's version differs from the
 *   last import (tracked in seed_meta), so a deploy is all it takes.
 * - Owner-created stores at the same spot with a matching name are linked
 *   (osm_id) instead of duplicated, and a listing first imported from OSM is
 *   upgraded in place when a later build folds it into an Overture record.
 * - Falls back to the OSM-only file when no built directory is present.
 *
 * CLI:  node src/jobs/importStores.js [--force] [--fill-cities]
 */
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const db = require('../database/db');
const { classify, haversineMeters, namesMatch, sleep } = require('./osm');
const { loadDirectory, OUT_PATH: DIRECTORY_FILE } = require('./buildDirectory');

const { fieldSource } = require('../utils/storeEdits');
const { timeZoneFor } = require('../utils/storeHours');

const OSM_ONLY_FILE = path.join(__dirname, '..', 'data', 'osm_stores.json');
const VISIBLE_THRESHOLD = 0.5;

/** A field nobody has corrected still belongs to the directory. */
function ownedByDirectory(row, field) {
  return fieldSource(row, field) === 'directory';
}

/**
 * The zone to store when the import moves a pin or a state. Only then: a shop
 * whose pin a sweep fixed keeps the zone that pin stands in.
 */
function newZone(found, incoming, keep) {
  const movedPin = !keep('lat') && !keep('lng')
    && (Number(incoming.lat) !== Number(found.lat) || Number(incoming.lng) !== Number(found.lng));
  const movedState = !keep('state') && incoming.state && incoming.state !== found.state;
  if (!movedPin && !movedState) return null;
  const lat = keep('lat') ? found.lat : incoming.lat;
  const lng = keep('lng') ? found.lng : incoming.lng;
  const state = keep('state') ? found.state : incoming.state;
  return timeZoneFor(state, lat, lng);
}

/**
 * The merged Overture + OpenStreetMap directory is the source of truth. The
 * OSM-only file stays as a fallback so a checkout without the built directory
 * still comes up with a populated map.
 */
function readDirectory(filePath) {
  if (filePath) {
    if (!fs.existsSync(filePath)) return null;
    return filePath.endsWith('.gz') ? loadDirectory(filePath) : JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }
  const merged = loadDirectory(DIRECTORY_FILE);
  if (merged) return merged;
  if (fs.existsSync(OSM_ONLY_FILE)) return JSON.parse(fs.readFileSync(OSM_ONLY_FILE, 'utf8'));
  return null;
}

async function importStoresFromFile(filePath = null, { force = false, log = console.log } = {}) {
  const data = readDirectory(filePath);
  if (!data) { log('[import] no store directory file found, skipping'); return { skipped: true }; }
  const version = data.generated_at || 'unknown';

  const meta = await db.get("SELECT value FROM seed_meta WHERE key = 'osm_import_version'");
  if (!force && meta && meta.value === version) return { skipped: true, reason: `already imported ${version}` };

  const existing = await db.all('SELECT id, name, state, lat, lng, source, source_id, osm_id, claimed, staff_edited, visible, store_type, storefront, operating_status, field_sources FROM stores');
  // Directory rows are addressed by source + id. An OSM id is also indexed on
  // its own so a listing first imported from OSM is upgraded in place when a
  // later build folds it into an Overture record.
  const DIRECTORY_SOURCES = new Set(['osm', 'overture']);
  const byKey = new Map();
  for (const e of existing) {
    if (DIRECTORY_SOURCES.has(e.source) && e.source_id) byKey.set(`${e.source}:${e.source_id}`, e);
    if (e.source === 'osm' && e.source_id) byKey.set(`osm:${e.source_id}`, e);
    if (e.osm_id) byKey.set(`osm:${e.osm_id}`, e);
  }
  const owned = existing.filter(e => !DIRECTORY_SOURCES.has(e.source) && e.lat && e.lng);

  let inserted = 0, updated = 0, merged = 0, upgraded = 0, skipped = 0, closed = 0;
  const t0 = Date.now();

  for (const s of data.stores) {
    if (!s.name || !s.source_id || typeof s.lat !== 'number') { skipped++; continue; }
    const source = s.source === 'overture' ? 'overture' : 'osm';
    // Recompute classification so classifier improvements apply without
    // refetching. ctags carries the tag shape classify() expects; a record
    // without it (an old OSM-only file) still has its raw OSM tags.
    const { confidence, store_type } = classify(s.name, s.ctags || s.osm_tags || {}, s.website);
    const hours = s.hours ? JSON.stringify(s.hours) : null;
    const tags = JSON.stringify(s.tags || []);
    // The source says the doors are shut. It lags reality by months and is not
    // the only closure signal, but when it does say so it is worth believing.
    const closedAtSource = s.operating_status === 'permanently_closed';
    if (closedAtSource) closed++;
    const opStatus = s.operating_status || null;

    // An Overture record that absorbed an OSM twin can adopt the row that OSM
    // id already created, instead of adding a second pin on the same shop.
    let found = byKey.get(`${source}:${s.source_id}`);
    if (!found && s.osm_id) {
      const prior = byKey.get(`osm:${s.osm_id}`);
      if (prior && !prior.claimed) {
        await db.run('UPDATE stores SET source = ?, source_id = ?, osm_id = ? WHERE id = ?', [source, s.source_id, s.osm_id, prior.id]);
        prior.source = source; prior.source_id = s.source_id;
        byKey.set(`${source}:${s.source_id}`, prior);
        found = prior;
        upgraded++;
      }
    }
    if (found) {
      if (!found.claimed && DIRECTORY_SOURCES.has(found.source)) {
        // Staff decisions outrank the classifier: once someone has corrected a
        // listing's type or visibility by hand, a refreshed source file must
        // not silently undo it.
        const keepStaff = !!found.staff_edited;
        // A sweep has already ruled this listing out: it is a wholesaler, an
        // online-only seller, or a shop that has shut. Re-importing must not
        // put it back on the map just because the classifier still likes its
        // name — that regression put Cigar City Brewing back among the cigar
        // shops once already.
        const ruledOut = ['not_retail', 'online_only', 'closed', 'duplicate', 'moved'].includes(found.storefront)
          || found.operating_status === 'permanently_closed';
        // Only the fields the directory still owns are refreshed. A sweep that
        // renamed a shop, moved its pin to the right door or fixed its phone
        // recorded itself in field_sources, and the import leaves those alone;
        // otherwise every correction would be undone at the next refresh.
        const keep = field => !ownedByDirectory(found, field);
        await db.run(`
          UPDATE stores SET
            name = COALESCE(?, name), address = COALESCE(?, address), city = COALESCE(?, city), state = COALESCE(?, state),
            zip = COALESCE(?, zip), phone = COALESCE(?, phone),
            -- A website staff deliberately cleared must not come back on re-import.
            website = CASE WHEN ? THEN website ELSE COALESCE(?, website) END,
            instagram = COALESCE(?, instagram), lat = COALESCE(?, lat), lng = COALESCE(?, lng),
            timezone = COALESCE(?, timezone),
            -- Hours read off the shop's own website, or set by its owner or by
            -- staff, are fresher than map data and must survive a re-import.
            hours = CASE WHEN ? OR hours_source IN ('website', 'owner') THEN hours ELSE COALESCE(?, hours) END,
            hours_raw = ?,
            store_type = ?, confidence = ?, visible = ?,
            -- A shop we found shut, from its own website or its chain's, stays
            -- shut. The source lags reality by months and still calls it open,
            -- and believing it would put a closed shop back on the map.
            operating_status = CASE WHEN operating_status = 'permanently_closed' THEN operating_status
                                    ELSE COALESCE(?, operating_status) END,
            closed_reason = CASE WHEN ? THEN COALESCE(closed_reason, 'Marked permanently closed in the source data') ELSE closed_reason END,
            -- A badge a sweep took off after reading the shop's own site does not
            -- come back because the map data still carries the old tag.
            has_lounge = CASE WHEN ? THEN has_lounge ELSE GREATEST(COALESCE(has_lounge, 0), ?) END,
            has_walk_in_humidor = CASE WHEN ? THEN has_walk_in_humidor ELSE GREATEST(COALESCE(has_walk_in_humidor, 0), ?) END
          WHERE id = ?
        `, [keep('name') ? null : s.name, keep('address') ? null : s.address, keep('city') ? null : s.city,
            keep('state') ? null : s.state, keep('zip') ? null : s.zip, keep('phone') ? null : s.phone,
            keepStaff || keep('website'), s.website, s.instagram,
            keep('lat') ? null : s.lat, keep('lng') ? null : s.lng, newZone(found, s, keep),
            keepStaff, hours, s.hours_raw,
            keepStaff ? found.store_type : store_type,
            confidence,
            keepStaff ? found.visible : ((closedAtSource || ruledOut) ? 0 : (confidence >= VISIBLE_THRESHOLD ? 1 : 0)),
            opStatus, closedAtSource,
            keep('has_lounge'), s.has_lounge || 0,
            keep('has_walk_in_humidor'), s.has_walk_in_humidor || 0, found.id]);
        updated++;
      }
      continue;
    }

    // A shop an owner already set up by hand keeps its own row; the directory
    // id is attached so later refreshes recognise it.
    const twin = owned.find(o =>
      Math.abs(o.lat - s.lat) < 0.005 && Math.abs(o.lng - s.lng) < 0.005 &&
      haversineMeters(o.lat, o.lng, s.lat, s.lng) < 150 && namesMatch(o.name, s.name));
    if (twin) {
      await db.run('UPDATE stores SET osm_id = ? WHERE id = ?', [s.source_id, twin.id]);
      byKey.set(`${source}:${s.source_id}`, twin);
      merged++;
      continue;
    }

    await db.run(`
      INSERT INTO stores (user_id, name, address, city, state, zip, phone, website, instagram, lat, lng, hours, hours_raw, tags,
        has_lounge, has_walk_in_humidor, verified, setup_complete, claimed, source, source_id, osm_id, store_type, confidence, visible,
        operating_status, closed_reason)
      VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [s.name, s.address, s.city, s.state, s.zip, s.phone, s.website, s.instagram, s.lat, s.lng, hours, s.hours_raw, tags,
        s.has_lounge || 0, s.has_walk_in_humidor || 0, source, s.source_id, s.osm_id || null,
        store_type, confidence,
        closedAtSource ? 0 : (confidence >= VISIBLE_THRESHOLD ? 1 : 0),
        opStatus, closedAtSource ? 'Marked permanently closed in the source data' : null]);
    inserted++;
  }

  await db.run(`
    INSERT INTO seed_meta (key, value) VALUES ('osm_import_version', ?)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
  `, [version]);

  const result = { inserted, updated, merged, upgraded, skipped, closed, total: data.stores.length, version, seconds: Math.round((Date.now() - t0) / 1000) };
  log(`[import] ${JSON.stringify(result)}`);
  return result;
}

// ── Fill in missing cities for visible listings (Nominatim, 1 req/s) ─────────

function reverseGeocode(lat, lng) {
  return new Promise(resolve => {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=10&addressdetails=1`;
    https.get(url, { headers: { 'User-Agent': 'CigarBuddy/1.0 (mason.obegi@gmail.com)' } }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const a = JSON.parse(d).address || {};
          resolve({ city: a.city || a.town || a.village || a.municipality || a.county || null, zip: a.postcode || null });
        } catch { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

let fillRunning = false;
async function fillMissingCities({ max = 100, log = console.log } = {}) {
  if (fillRunning) return { skipped: true };
  fillRunning = true;
  try {
    const rows = await db.all(`
      SELECT id, lat, lng FROM stores
      WHERE city IS NULL AND lat IS NOT NULL AND visible = 1
      ORDER BY confidence DESC, id LIMIT ?
    `, [max]);
    let filled = 0;
    for (const r of rows) {
      const g = await reverseGeocode(r.lat, r.lng);
      if (g?.city) {
        await db.run('UPDATE stores SET city = ?, zip = COALESCE(zip, ?) WHERE id = ?', [g.city.replace(/^City of /i, ''), g.zip ? g.zip.split('-')[0] : null, r.id]);
        filled++;
      } else {
        // Mark so we do not retry every hour; a blank string is treated as "unknown".
        await db.run("UPDATE stores SET city = '' WHERE id = ? AND city IS NULL", [r.id]);
      }
      await sleep(1100);
    }
    if (rows.length) log(`[import] filled ${filled}/${rows.length} missing cities`);
    return { filled, attempted: rows.length };
  } finally {
    fillRunning = false;
  }
}

// ── Boot hook ───────────────────────────────────────────────────────────────

/**
 * Give every shop the time zone its door is in, so "open now" is judged on
 * the shop's clock. Only rows without one are touched, in batches written as
 * one statement each.
 */
async function fillTimezones({ log = console.log } = {}) {
  const { timeZoneFor } = require('../utils/storeHours');
  const rows = await db.all('SELECT id, state, lat, lng FROM stores WHERE timezone IS NULL');
  if (!rows.length) return 0;
  for (let i = 0; i < rows.length; i += 5000) {
    const batch = rows.slice(i, i + 5000).map(r => ({ id: r.id, tz: timeZoneFor(r.state, r.lat, r.lng) }));
    await db.run(`
      UPDATE stores s SET timezone = x.tz
      FROM json_to_recordset(?::json) AS x(id int, tz text)
      WHERE s.id = x.id
    `, [JSON.stringify(batch)]);
  }
  log(`[import] time zone set on ${rows.length} listings`);
  return rows.length;
}

async function runStartupImport({ log = console.log } = {}) {
  // Any store with an owner is claimed by definition (covers demo seeds and old rows).
  await db.run('UPDATE stores SET claimed = 1 WHERE user_id IS NOT NULL AND (claimed IS NULL OR claimed = 0)');
  await db.run("UPDATE stores SET source = 'owner' WHERE source IS NULL");

  const result = await importStoresFromFile(null, { log });
  await fillTimezones({ log }).catch(err => log('[import] time zone fill error: ' + err.message));

  if (process.env.DISABLE_CITY_FILL !== '1') {
    fillMissingCities({ max: 150, log }).catch(err => log('[import] city fill error: ' + err.message));
    setInterval(() => fillMissingCities({ max: 100, log }).catch(() => {}), 60 * 60 * 1000);
  }
  return result;
}

if (require.main === module) {
  const force = process.argv.includes('--force');
  const { initSchema, runMigrations } = require('../database/schema');
  (async () => {
    await initSchema();
    await runMigrations();
    await db.run('UPDATE stores SET claimed = 1 WHERE user_id IS NOT NULL AND (claimed IS NULL OR claimed = 0)');
    const r = await importStoresFromFile(null, { force });
    console.log(r);
    if (process.argv.includes('--fill-cities')) console.log(await fillMissingCities({ max: 5000 }));
    process.exit(0);
  })().catch(err => { console.error(err); process.exit(1); });
}

module.exports = { importStoresFromFile, fillMissingCities, fillTimezones, runStartupImport, DIRECTORY_FILE, OSM_ONLY_FILE };
