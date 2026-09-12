/**
 * The guardrail on the map fix: for each viewport, the pins plus every cluster
 * bubble's count must equal the number of listings actually inside that
 * viewport. That is the property the old map broke — it drew 1,000 rows and
 * labelled the bubbles with counts taken from those 1,000, so a bubble marked
 * "84" could open onto nine shops.
 *
 * It also checks the two code paths against each other: the plain view groups
 * in SQL, the "open now" view groups in JavaScript, and a map whose counts
 * depend on which filter is on would be worse than one that is merely capped.
 *
 * Read-only.
 *   PGLITE_DIR=<db> node sweeps/scripts/map_viewports.js
 */
'use strict';

const path = require('path');
const SRV = path.join(__dirname, '..', '..', 'server', 'src');
const db = require(path.join(SRV, 'database', 'db'));
const { mapStores, clusterRows } = require(path.join(SRV, 'utils', 'storeMap'));
const { buildFilters } = require(path.join(SRV, 'utils', 'storeSearch'));

// The national view, the four corners, and a spread of metros at the zooms a
// customer actually lands on. bbox is minLng,minLat,maxLng,maxLat, the order
// Leaflet's getBounds gives.
const VIEWPORTS = [
  ['national',        '-125,24,-66,50',              4],
  ['national wide',   '-180,-10,-50,72',             3],
  ['northeast',       '-80,38,-69,45',               6],
  ['new york metro',  '-74.4,40.5,-73.6,41.0',       9],
  ['manhattan',       '-74.03,40.70,-73.92,40.82',  12],
  ['one block',       '-73.990,40.754,-73.984,40.758', 16],
  ['chicago',         '-88.2,41.6,-87.4,42.2',       9],
  ['los angeles',     '-118.7,33.7,-117.6,34.3',     9],
  ['south florida',   '-80.5,25.6,-79.9,26.5',       9],
  ['texas',           '-107,26,-93,37',              5],
  ['pacific nw',      '-125,44,-116,49',             6],
  ['hawaii',          '-161,18,-154,23',             7],
  ['alaska',          '-170,52,-130,72',             4],
  ['empty ocean',     '-40,20,-30,30',               5],
  ['whole world',     '-180,-85,180,85',             2],
];

(async () => {
  let pass = 0, fail = 0;
  const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.log('  FAIL ' + msg); } };

  for (const [label, bbox, zoom] of VIEWPORTS) {
    const [minLng, minLat, maxLng, maxLat] = bbox.split(',').map(Number);
    const { where, params } = buildFilters({});
    where.push('s.lat IS NOT NULL AND s.lng IS NOT NULL');
    where.push('s.lat BETWEEN ? AND ? AND s.lng BETWEEN ? AND ?');
    const truth = await db.get(
      `SELECT COUNT(*)::int AS n FROM stores s WHERE ${where.join(' AND ')}`,
      [...params, minLat, maxLat, minLng, maxLng]);

    const res = await mapStores({ bbox, zoom: String(zoom) });
    if (res.too_many) {
      console.log(`  ${label.padEnd(16)} zoom ${String(zoom).padStart(2)}: refused (${truth.n} in view)`);
      ok(truth.n > 0, `${label}: a refusal over an empty viewport would be a bug`);
      continue;
    }

    const drawn = res.pins.length + res.clusters.reduce((a, c) => a + c.count, 0);
    ok(drawn === truth.n, `${label}: drew ${drawn} of ${truth.n} in the viewport`);
    ok(res.total === truth.n, `${label}: header says ${res.total}, truth is ${truth.n}`);
    ok(res.shown === drawn, `${label}: shown (${res.shown}) disagrees with what it sent (${drawn})`);
    ok(res.clusters.every(c => c.count > 1), `${label}: a bubble stands for a single shop`);
    ok(new Set(res.pins.map(p => p.id)).size === res.pins.length, `${label}: a pin is drawn twice`);
    ok(res.pins.every(p => p.lat >= minLat - 1e-9 && p.lat <= maxLat + 1e-9
      && p.lng >= minLng - 1e-9 && p.lng <= maxLng + 1e-9), `${label}: a pin sits outside the viewport`);
    // Nothing operational leaks onto the map.
    ok(res.pins.every(p => Object.keys(p).length === 9), `${label}: a pin carries more than the nine columns`);

    console.log(`  ${label.padEnd(16)} zoom ${String(zoom).padStart(2)}: `
      + `${String(truth.n).padStart(5)} in view, ${String(res.pins.length).padStart(4)} pins + `
      + `${String(res.clusters.length).padStart(3)} bubbles = ${String(drawn).padStart(5)}`);
  }

  // The two paths must group the same rows the same way. "Open now" filters
  // first, so compare on the rows it keeps rather than on the whole viewport.
  const bbox = '-125,24,-66,50';
  for (const zoom of [3, 5, 9]) {
    const sqlPath = await mapStores({ bbox, zoom: String(zoom) });
    const rows = await db.all(`
      SELECT s.id, s.lat, s.lng, s.claimed, s.verified FROM stores s
      WHERE s.visible = 1 AND s.lat IS NOT NULL AND s.lng IS NOT NULL
        AND s.lat BETWEEN 24 AND 50 AND s.lng BETWEEN -125 AND -66`);
    const jsPath = clusterRows(rows, zoom);
    const jsDrawn = jsPath.singles.length + jsPath.clusters.reduce((a, c) => a + c.count, 0);
    ok(jsDrawn === sqlPath.total, `zoom ${zoom}: the JavaScript grouping accounts for ${jsDrawn}, SQL for ${sqlPath.total}`);
    ok(jsPath.clusters.length === sqlPath.clusters.length,
      `zoom ${zoom}: SQL made ${sqlPath.clusters.length} bubbles, JavaScript ${jsPath.clusters.length}`);
    ok(jsPath.singles.length === sqlPath.pins.length,
      `zoom ${zoom}: SQL drew ${sqlPath.pins.length} pins, JavaScript ${jsPath.singles.length}`);
    // Cell for cell, the counts must be identical.
    const sqlByKey = new Map(sqlPath.clusters.map(c => [c.key, c.count]));
    const disagree = jsPath.clusters.filter(c => sqlByKey.get(c.key) !== c.count);
    ok(disagree.length === 0, `zoom ${zoom}: ${disagree.length} cells counted differently by the two paths`);
    console.log(`  two paths at zoom ${zoom}: ${sqlPath.clusters.length} bubbles, ${sqlPath.pins.length} pins, agreed`);
  }

  console.log(`\nmap viewports: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
