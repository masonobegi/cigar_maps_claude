/**
 * Collapse one shop listed twice.
 *
 * The directory build de-duplicates within 120 m, but the same shop sometimes
 * survives twice when the two sources place it slightly further apart or spell
 * the street differently. This is the safety net.
 *
 * A chain with several branches in one city is NOT a duplicate: Tobacco Depot
 * really does have two shops on North Dale Mabry. Two rows only merge when they
 * share a name AND a city AND either sit within 200 m of each other or give the
 * same street address once suite numbers and punctuation are stripped.
 *
 * The survivor is whichever row carries the most detail. The rest are hidden
 * with storefront='duplicate' and pointed at the survivor, never deleted, so
 * the decision can be read and reversed.
 *
 * Usage:
 *   node src/jobs/dedupeListings.js            # dry run
 *   node src/jobs/dedupeListings.js --confirm
 */
'use strict';

const db = require('../database/db');
const { haversineMeters } = require('./osm');

const SAME_PLACE_M = 200;

/** "590 Vance Rd Ste 103" and "590 Vance Rd" are the same doorway. */
function normalizeAddress(a) {
  return String(a || '')
    .toLowerCase()
    .replace(/\b(?:ste|suite|unit|apt|#)\s*[\w-]+/g, ' ')
    .replace(/\b(street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|highway|hwy|lane|ln|place|pl|court|ct|parkway|pkwy|trail|trl|circle|cir|way|north|n|south|s|east|e|west|w)\b/g, m => ({
      street: 'st', avenue: 'ave', road: 'rd', boulevard: 'blvd', drive: 'dr', highway: 'hwy',
      lane: 'ln', place: 'pl', court: 'ct', parkway: 'pkwy', trail: 'trl', circle: 'cir',
      north: 'n', south: 's', east: 'e', west: 'w',
    }[m] || m))
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** How much a row is worth keeping: more contact detail wins. */
function richness(r) {
  return (r.phone ? 4 : 0) + (r.website ? 3 : 0) + (r.address ? 2 : 0)
    + (r.hours && r.hours !== '{}' ? 2 : 0) + (r.description ? 1 : 0)
    + (r.source === 'overture' ? 1 : 0) + Number(r.confidence || 0);
}

function sameSpot(a, b) {
  const addrA = normalizeAddress(a.address), addrB = normalizeAddress(b.address);
  if (addrA && addrA === addrB) return true;
  if (a.lat && b.lat && haversineMeters(a.lat, a.lng, b.lat, b.lng) <= SAME_PLACE_M) return true;
  return false;
}

async function dedupe({ confirm = false, log = console.log } = {}) {
  // Claimed shops are never touched: their owner decides what exists.
  const rows = await db.all(`
    SELECT id, name, address, city, state, lat, lng, phone, website, hours, description,
           source, confidence, claimed, staff_edited
    FROM stores
    WHERE visible = 1 AND claimed = 0 AND COALESCE(staff_edited, 0) = 0
      AND city IS NOT NULL AND city <> ''
    ORDER BY id
  `);

  const groups = new Map();
  for (const r of rows) {
    const k = `${r.name.trim().toLowerCase()}|${r.city.trim().toLowerCase()}|${r.state}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }

  const merges = [];
  for (const [, g] of groups) {
    if (g.length < 2) continue;
    const clusters = [];
    for (const r of g) {
      const c = clusters.find(cl => cl.some(m => sameSpot(m, r)));
      if (c) c.push(r); else clusters.push([r]);
    }
    for (const cl of clusters) {
      if (cl.length < 2) continue;
      const sorted = [...cl].sort((a, b) => richness(b) - richness(a) || a.id - b.id);
      merges.push({ keep: sorted[0], drop: sorted.slice(1) });
    }
  }

  const dropped = merges.reduce((n, m) => n + m.drop.length, 0);
  log(`examined ${rows.length} public listings`);
  log(`one shop listed more than once: ${merges.length} shops, ${dropped} extra rows`);
  for (const m of merges.slice(0, 20)) {
    log(`  keep #${m.keep.id} ${m.keep.name} (${m.keep.city}, ${m.keep.state}) ${m.keep.address || ''}`);
    for (const d of m.drop) log(`    drop #${d.id} ${d.address || `${d.lat},${d.lng}`}`);
  }
  if (merges.length > 20) log(`  ...and ${merges.length - 20} more`);

  if (!confirm) { log('\nDry run. Nothing changed. Re-run with --confirm to apply.'); return { dryRun: true, merges: merges.length, dropped }; }

  let hidden = 0;
  for (const m of merges) {
    for (const d of m.drop) {
      await db.run(`
        UPDATE stores
        SET visible = 0, storefront = 'duplicate',
            storefront_reason = ?
        WHERE id = ?
      `, [`Same shop as listing #${m.keep.id}`, d.id]);
      hidden++;
    }
  }
  const left = await db.get('SELECT COUNT(*)::int AS n FROM stores WHERE visible = 1');
  log(`\nhid ${hidden} duplicate rows. ${left.n} listings remain on the public map.`);
  return { merges: merges.length, hidden, remaining: left.n };
}

if (require.main === module) {
  dedupe({ confirm: process.argv.includes('--confirm') })
    .then(() => process.exit(0))
    .catch(err => { console.error(err); process.exit(1); });
}

module.exports = { dedupe, normalizeAddress, sameSpot };
