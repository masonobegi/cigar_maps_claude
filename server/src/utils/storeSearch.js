/**
 * The pieces GET /stores and the recall monitor both need.
 *
 * They used to live inside the route, which meant the monitor could only check
 * the route by calling it over HTTP, and any drift between "what the route
 * filters on" and "what the monitor thinks it filters on" went unnoticed. The
 * filter builder is now one function that both import, so a new filter is
 * covered by the monitor the day it is added.
 *
 * Run `node src/utils/storeSearch.js` for the self-test.
 */
'use strict';

/** Miles. The radius chips stop here, and the server refuses to go further. */
const RADIUS_MAX_MI = 100;

/** A page of results. The client asks for more by offset. */
const PAGE_SIZE = 60;

/**
 * How many listings we are willing to measure in one request. Past this the
 * answer is "narrow your search" rather than a quietly shortened list — the
 * whole point of this sweep is that a truncated list is worse than an honest
 * refusal. At 100 miles from Philadelphia the candidate set is 743, so the
 * ceiling is nearly an order of magnitude clear of today's worst case.
 */
const CANDIDATE_CEILING = 5000;

/**
 * Hours somebody stands behind. Map hours are not in this set: about half the
 * ones we could check against a shop's own site were wrong on some day, so an
 * "Open now" filter built on them sends customers to locked doors. This is the
 * server-side twin of CONFIRMED_HOURS in client/src/components/StoreCard.jsx.
 */
const CONFIRMED_HOURS_SOURCES = ['website', 'owner', 'staff', 'chain'];

/** Earth's radius in miles, as used everywhere else in this codebase. */
const EARTH_MI = 3958.8;

function haversine(lat1, lng1, lat2, lng2) {
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_MI * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * The same formula in SQL, so the radius cut happens in the database over the
 * whole filtered set instead of over whichever 300 rows survived a LIMIT.
 * `least(1, ...)` keeps asin inside its domain when rounding pushes the term a
 * hair over 1 for two points at the same spot.
 */
function distanceSql(latExpr, lngExpr, latParam = '?', lngParam = '?') {
  return `(${EARTH_MI} * 2 * asin(least(1, sqrt(
      power(sin(radians(${latExpr} - ${latParam}) / 2), 2) +
      cos(radians(${latParam})) * cos(radians(${latExpr})) *
      power(sin(radians(${lngExpr} - ${lngParam}) / 2), 2)
    ))))`;
}

/**
 * SQL and JS agree to about 1e-13 miles, but they are two implementations of
 * one formula and a listing sitting exactly on the radius could land either
 * way. The SQL side is generous by a nanomile so the database never drops a
 * row the brute-force truth set keeps.
 */
const BOUNDARY_EPS_MI = 1e-9;

/** A degrees box around a point, used to prefilter on idx_stores_lat_lng. */
function boundingBox(lat, lng, radiusMi) {
  const dLat = radiusMi / 69;
  // cos() is clamped so a search near a pole cannot produce an absurd width.
  const dLng = radiusMi / (69 * Math.max(0.2, Math.cos(lat * Math.PI / 180)));
  return { minLat: lat - dLat, maxLat: lat + dLat, minLng: lng - dLng, maxLng: lng + dLng };
}

// Names are compared with the punctuation people leave out: apostrophes and
// periods dropped, "&" read as "and". Otherwise "wild bills" misses every one
// of Wild Bill's listings.
const fold = value => `replace(translate(lower(${value}), '''’.,-', ''), '&', 'and')`;
const folded = text => String(text).toLowerCase().replace(/['’.,-]/g, '').replace(/&/g, 'and');

/**
 * Every non-spatial filter the list, the map and the monitor share.
 *
 * `open_now` is deliberately absent: it depends on each shop's own clock and is
 * applied in JS over the full candidate set (see the route). Everything else
 * runs in SQL, where it belongs.
 *
 * @param {object} query - req.query, or a plain object in the monitor.
 * @returns {{where: string[], params: any[]}}
 */
function buildFilters(query = {}) {
  const { q, city, state, has_lounge, has_walk_in_humidor, store_type, claimed, has_inventory } = query;
  const where = ['s.visible = 1'];
  const params = [];

  if (q) {
    where.push(`(${fold('s.name')} LIKE ? OR s.description ILIKE ? OR ${fold('s.city')} LIKE ?)`);
    params.push(`%${folded(q)}%`, `%${q}%`, `%${folded(q)}%`);
  }
  // A city chip carries its state, and matches the town itself: "Washington, DC"
  // used to return shops in Michigan, Missouri and Pennsylvania.
  if (city && state) { where.push(`${fold('s.city')} = ?`); params.push(folded(city)); }
  else if (city) { where.push(`${fold('s.city')} LIKE ?`); params.push(`%${folded(city)}%`); }
  if (state) { where.push('s.state = ?'); params.push(String(state).toUpperCase()); }
  if (has_lounge === '1') where.push('s.has_lounge = 1');
  if (has_walk_in_humidor === '1') where.push('s.has_walk_in_humidor = 1');
  // store_type accepts a comma-separated list ("cigar_shop,cigar_lounge") so the
  // type chips can multi-select.
  if (store_type) {
    const types = String(store_type).split(',').map(t => t.trim()).filter(Boolean);
    if (types.length) {
      where.push(`s.store_type IN (${types.map(() => '?').join(',')})`);
      params.push(...types);
    }
  }
  if (claimed === '1') where.push('s.claimed = 1');
  // EXISTS rather than a HAVING on the aggregate: it short-circuits on the
  // first in-stock row instead of counting every join row per store.
  if (has_inventory === '1') {
    where.push('EXISTS (SELECT 1 FROM inventory inv WHERE inv.store_id = s.id AND inv.in_stock = 1)');
  }
  return { where, params };
}

/** The same predicate in JS, for the monitor's brute-force truth set. */
function matchesFilters(store, query = {}) {
  const { q, city, state, has_lounge, has_walk_in_humidor, store_type, claimed, has_inventory } = query;
  if (Number(store.visible) !== 1) return false;
  if (q) {
    const needle = folded(q);
    const hit = folded(store.name || '').includes(needle)
      || String(store.description || '').toLowerCase().includes(String(q).toLowerCase())
      || folded(store.city || '').includes(needle);
    if (!hit) return false;
  }
  if (city && state) { if (folded(store.city || '') !== folded(city)) return false; }
  else if (city) { if (!folded(store.city || '').includes(folded(city))) return false; }
  if (state && String(store.state || '').toUpperCase() !== String(state).toUpperCase()) return false;
  if (has_lounge === '1' && Number(store.has_lounge) !== 1) return false;
  if (has_walk_in_humidor === '1' && Number(store.has_walk_in_humidor) !== 1) return false;
  if (store_type) {
    const types = String(store_type).split(',').map(t => t.trim()).filter(Boolean);
    if (types.length && !types.includes(store.store_type)) return false;
  }
  if (claimed === '1' && Number(store.claimed) !== 1) return false;
  if (has_inventory === '1' && !store.has_inventory) return false;
  return true;
}

/** Radius as the server will honour it: a number, clamped, never NaN. */
function normalizeRadius(raw, fallback = 50) {
  const r = parseFloat(raw);
  const value = Number.isFinite(r) && r > 0 ? r : fallback;
  return { radiusMi: Math.min(RADIUS_MAX_MI, value), capped: value > RADIUS_MAX_MI };
}

function hoursAreConfirmed(source) {
  return CONFIRMED_HOURS_SOURCES.includes(source);
}

module.exports = {
  RADIUS_MAX_MI, PAGE_SIZE, CANDIDATE_CEILING, CONFIRMED_HOURS_SOURCES, BOUNDARY_EPS_MI,
  haversine, distanceSql, boundingBox, fold, folded, buildFilters, matchesFilters,
  normalizeRadius, hoursAreConfirmed,
};

// ── self-test ────────────────────────────────────────────────────────────────
if (require.main === module) {
  let pass = 0, fail = 0;
  const ok = (cond, label, extra) => {
    if (cond) { pass++; console.log(`  ok   ${label}`); }
    else { fail++; console.log(`  FAIL ${label}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ''}`); }
  };

  // Distances against figures anyone can check on a map.
  const nycToPhilly = haversine(40.7549, -73.9840, 39.9526, -75.1652);
  ok(Math.abs(nycToPhilly - 83.3) < 1.5, 'Midtown to Philadelphia is about 83 miles', nycToPhilly);
  ok(haversine(41.8781, -87.6298, 41.8781, -87.6298) === 0, 'a point is zero miles from itself');
  const chiToMilw = haversine(41.8781, -87.6298, 43.0389, -87.9065);
  ok(Math.abs(chiToMilw - 80.5) < 2, 'Chicago to Milwaukee is about 80 miles', chiToMilw);

  // The box has to contain the circle, or the prefilter drops real rows.
  for (const [lat, lng] of [[40.75, -73.98], [25.77, -80.19], [47.6, -122.33], [21.3, -157.86]]) {
    for (const radius of [10, 25, 50, 100]) {
      const box = boundingBox(lat, lng, radius);
      let inside = true;
      for (let b = 0; b < 360; b += 5) {
        // Walk the circle's rim and check each point lies in the box.
        const br = b * Math.PI / 180;
        const pLat = lat + (radius / 69) * Math.cos(br);
        const pLng = lng + (radius / (69 * Math.cos(lat * Math.PI / 180))) * Math.sin(br);
        if (pLat < box.minLat || pLat > box.maxLat || pLng < box.minLng || pLng > box.maxLng) inside = false;
      }
      ok(inside, `the ${radius}mi box around ${lat},${lng} contains its own circle`);
    }
  }

  // Folding: the reason "wild bills" finds Wild Bill's.
  ok(folded("Wild Bill's Tobacco") === 'wild bills tobacco', 'an apostrophe folds away');
  ok(folded('Smith & Sons') === 'smith and sons', '"&" reads as "and"');

  // buildFilters and matchesFilters must agree on what a filter means.
  const rows = [
    { id: 1, visible: 1, name: "Wild Bill's", city: 'Detroit', state: 'MI', has_lounge: 1, store_type: 'cigar_shop', claimed: 0, has_inventory: false, description: '' },
    { id: 2, visible: 1, name: 'Havana Room', city: 'Detroit', state: 'MI', has_lounge: 0, store_type: 'cigar_lounge', claimed: 1, has_inventory: true, description: 'lounge and bar' },
    { id: 3, visible: 0, name: 'Hidden Shop', city: 'Detroit', state: 'MI', has_lounge: 1, store_type: 'cigar_shop', claimed: 0, has_inventory: false, description: '' },
    { id: 4, visible: 1, name: 'Tampa Smokes', city: 'Tampa', state: 'FL', has_lounge: 0, store_type: 'tobacco_shop', claimed: 0, has_inventory: false, description: '' },
  ];
  const ids = (qy) => rows.filter(r => matchesFilters(r, qy)).map(r => r.id);
  ok(JSON.stringify(ids({})) === '[1,2,4]', 'a hidden listing never matches', ids({}));
  ok(JSON.stringify(ids({ has_lounge: '1' })) === '[1]', 'the lounge filter', ids({ has_lounge: '1' }));
  ok(JSON.stringify(ids({ claimed: '1' })) === '[2]', 'the claimed filter', ids({ claimed: '1' }));
  ok(JSON.stringify(ids({ has_inventory: '1' })) === '[2]', 'the in-stock filter', ids({ has_inventory: '1' }));
  ok(JSON.stringify(ids({ store_type: 'cigar_shop,tobacco_shop' })) === '[1,4]', 'type chips multi-select', ids({ store_type: 'cigar_shop,tobacco_shop' }));
  ok(JSON.stringify(ids({ city: 'detroit', state: 'MI' })) === '[1,2]', 'a city chip carries its state', ids({ city: 'detroit', state: 'MI' }));
  ok(JSON.stringify(ids({ q: 'wild bills' })) === '[1]', '"wild bills" finds Wild Bill\'s', ids({ q: 'wild bills' }));
  ok(JSON.stringify(ids({ q: 'lounge' })) === '[2]', 'q also reads the description', ids({ q: 'lounge' }));

  // buildFilters produces one placeholder per parameter, or db.run misbinds.
  for (const qy of [{}, { q: 'cigar' }, { city: 'Tampa', state: 'FL' }, { store_type: 'a,b,c' },
    { has_lounge: '1', has_walk_in_humidor: '1', claimed: '1', has_inventory: '1' }]) {
    const { where, params } = buildFilters(qy);
    const holes = where.join(' AND ').split('?').length - 1;
    ok(holes === params.length, `placeholders match parameters for ${JSON.stringify(qy)}`, { holes, params: params.length });
  }

  // The radius contract.
  ok(normalizeRadius('25').radiusMi === 25, '25 miles is honoured');
  ok(normalizeRadius('500').radiusMi === 100 && normalizeRadius('500').capped, '500 miles is capped at 100 and says so');
  ok(normalizeRadius(undefined).radiusMi === 50, 'no radius means 50');
  ok(normalizeRadius('abc').radiusMi === 50, 'a nonsense radius means 50');
  ok(normalizeRadius('-5').radiusMi === 50, 'a negative radius means 50');

  ok(hoursAreConfirmed('website') && hoursAreConfirmed('chain'), 'website and chain hours are confirmed');
  ok(!hoursAreConfirmed('osm') && !hoursAreConfirmed(null), 'map hours and no hours are not confirmed');

  console.log(`\nstoreSearch self-test: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
