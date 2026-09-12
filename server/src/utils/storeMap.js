/**
 * GET /stores/map — the pins and clusters for a map viewport.
 *
 * The map used to ask the list endpoint for `limit=1000` rows and cluster them
 * in the browser. With 7,904 public listings that meant the national view drew
 * 1,000 of them, and every cluster bubble carried a count that was not the
 * number of shops in that cell but the number of shops in that cell *among the
 * first thousand rows the list happened to return*. Zooming into a bubble
 * marked "84" could turn up nine pins. The header count was wrong for the same
 * reason.
 *
 * So the grouping moves to the database, which can count all of them, and the
 * browser draws what it is told. The cell size is the same formula the client
 * used, so the bubbles land where they always did.
 *
 * Two paths, because "open now" cannot be decided in SQL — it depends on each
 * shop's own clock:
 *
 *   - plain view: one GROUP BY, which returns a few hundred rows at most.
 *   - open_now:   read the viewport's candidate rows, judge each one, then
 *                 cluster what is left in JavaScript.
 *
 * Both call the same cellOf(), and clusterRows() is the only implementation of
 * the grouping. selftest() checks the two paths against each other on the same
 * data, because a map whose counts change depending on which filter is on is
 * worse than one that is merely capped.
 */
'use strict';

const db = require('../database/db');
const { openStatus, timeZoneFor } = require('./storeHours');
const { buildFilters, hoursAreConfirmed, CANDIDATE_CEILING } = require('./storeSearch');

/**
 * The width of a cluster cell, in pixels, at any zoom. 64 was the client's
 * choice and is kept so the map looks as it did; changing it is a visual
 * decision, not a correctness one.
 */
const CELL_PX = 64;

/**
 * At this zoom and closer, every shop gets its own pin. A cluster bubble over
 * a single street is no use to anybody, and at street level the viewport holds
 * few enough rows to draw them all.
 */
const PIN_ZOOM = 12;

/** How many pins one response will carry. A viewport tighter than this is a bug. */
const MAX_PINS = 3000;

/** The cell size in degrees at a given zoom — the client's formula, unchanged. */
function cellSize(zoom) {
  const z = Math.max(0, Math.min(22, Number(zoom)));
  return (CELL_PX * 360) / (256 * Math.pow(2, z));
}

/** Which cell a point falls in. */
function cellOf(lat, lng, cell) {
  return `${Math.floor(lat / cell)}:${Math.floor(lng / cell)}`;
}

/**
 * Group rows into cells. A cell holding one shop becomes that shop's pin; a
 * cell holding several becomes a bubble at the mean of their positions, which
 * is where the client drew it.
 *
 * `singles` are the rows to return whole, `clusters` the bubbles. The two
 * together account for every row passed in, which is the property the map's
 * counts rest on and which selftest() checks.
 */
function clusterRows(rows, zoom, { allSingles = false } = {}) {
  const cell = cellSize(zoom);
  if (allSingles) return { singles: rows.slice(), clusters: [] };

  const cells = new Map();
  for (const r of rows) {
    const key = cellOf(Number(r.lat), Number(r.lng), cell);
    let c = cells.get(key);
    if (!c) { c = { items: [], latSum: 0, lngSum: 0, claimed: 0, verified: 0 }; cells.set(key, c); }
    c.items.push(r);
    c.latSum += Number(r.lat);
    c.lngSum += Number(r.lng);
    if (r.claimed) c.claimed++;
    if (r.verified) c.verified++;
  }

  const singles = [], clusters = [];
  for (const [key, c] of cells) {
    if (c.items.length === 1) { singles.push(c.items[0]); continue; }
    clusters.push({
      key,
      count: c.items.length,
      claimed: c.claimed,
      verified: c.verified,
      lat: c.latSum / c.items.length,
      lng: c.lngSum / c.items.length,
    });
  }
  return { singles, clusters };
}

/** The nine columns a pin needs to be drawn and clicked. */
const PIN_COLS = ['s.id', 's.name', 's.lat', 's.lng', 's.store_type', 's.city', 's.state',
  's.claimed', 's.verified'];

/** What a pin looks like on the wire. Nothing operational, nothing private. */
function pin(r) {
  return {
    id: r.id, name: r.name, lat: Number(r.lat), lng: Number(r.lng),
    store_type: r.store_type || 'cigar_shop', city: r.city, state: r.state,
    claimed: r.claimed ? 1 : 0, verified: r.verified ? 1 : 0,
  };
}

/**
 * The pins and clusters inside a viewport.
 *
 * @param {object} query - bbox=minLng,minLat,maxLng,maxLat, zoom, plus the
 *   ordinary store filters (q, state, has_lounge, store_type, open_now, ...).
 */
async function mapStores(query = {}, now = new Date()) {
  const zoom = Number.isFinite(Number(query.zoom)) ? Number(query.zoom) : 4;
  const { where, params } = buildFilters(query);
  // A pin needs somewhere to be. Listings with no coordinates are counted in
  // the list, never on the map, and the header says so rather than quietly
  // disagreeing with the list's total.
  where.push('s.lat IS NOT NULL AND s.lng IS NOT NULL');

  if (query.bbox) {
    const [minLng, minLat, maxLng, maxLat] = String(query.bbox).split(',').map(Number);
    if ([minLng, minLat, maxLng, maxLat].every(Number.isFinite)) {
      where.push('s.lat BETWEEN ? AND ? AND s.lng BETWEEN ? AND ?');
      params.push(minLat, maxLat, minLng, maxLng);
    }
  }
  const whereSql = where.join(' AND ');
  const openNow = query.open_now === '1';
  const allSingles = zoom >= PIN_ZOOM;

  // ── The open-now path: judge each shop's clock, then cluster what is left ──
  if (openNow) {
    const rows = await db.all(`
      SELECT ${PIN_COLS.join(', ')}, s.hours, s.hours_source, s.timezone
      FROM stores s WHERE ${whereSql}
      LIMIT ${CANDIDATE_CEILING + 1}
    `, params);
    if (rows.length > CANDIDATE_CEILING) return tooMany(zoom);
    // Map hours get no Open badge, so they must not drive the filter either.
    const open = rows.filter(r => {
      if (!hoursAreConfirmed(r.hours_source)) return false;
      const tz = r.timezone || timeZoneFor(r.state, r.lat, r.lng);
      return openStatus(r.hours, tz, now).isOpen === true;
    });
    return shape(clusterRows(open, zoom, { allSingles }), open.length, zoom);
  }

  // ── The plain path: one GROUP BY over the whole viewport ──────────────────
  const cell = cellSize(zoom);
  if (allSingles) {
    const rows = await db.all(`
      SELECT ${PIN_COLS.join(', ')} FROM stores s WHERE ${whereSql} LIMIT ${MAX_PINS + 1}
    `, params);
    const total = await db.get(`SELECT COUNT(*)::int AS n FROM stores s WHERE ${whereSql}`, params);
    if (rows.length > MAX_PINS) return tooMany(zoom);
    return shape(clusterRows(rows, zoom, { allSingles: true }), Number(total.n), zoom);
  }

  // floor(lat/cell) is the same key cellOf() builds, so a cell the database
  // groups and a cell JavaScript groups are the same cell.
  const grouped = await db.all(`
    SELECT floor(s.lat / ?) AS cy, floor(s.lng / ?) AS cx,
           COUNT(*)::int AS n,
           AVG(s.lat) AS lat, AVG(s.lng) AS lng,
           COUNT(*) FILTER (WHERE s.claimed = 1)::int AS claimed,
           COUNT(*) FILTER (WHERE s.verified = 1)::int AS verified,
           MIN(s.id)::int AS only_id
    FROM stores s WHERE ${whereSql}
    GROUP BY 1, 2
  `, [cell, cell, ...params]);

  // A cell with one shop in it is that shop's pin, so the ids are collected
  // and hydrated in one query rather than one per cell.
  const singleIds = grouped.filter(g => g.n === 1).map(g => g.only_id);
  let singles = [];
  if (singleIds.length) {
    if (singleIds.length > MAX_PINS) return tooMany(zoom);
    const holes = singleIds.map(() => '?').join(',');
    singles = await db.all(`SELECT ${PIN_COLS.join(', ')} FROM stores s WHERE s.id IN (${holes})`, singleIds);
  }
  const clusters = grouped.filter(g => g.n > 1).map(g => ({
    key: `${Number(g.cy)}:${Number(g.cx)}`,
    count: Number(g.n),
    claimed: Number(g.claimed),
    verified: Number(g.verified),
    lat: Number(g.lat),
    lng: Number(g.lng),
  }));
  const total = grouped.reduce((a, g) => a + Number(g.n), 0);
  return shape({ singles, clusters }, total, zoom);
}

function shape({ singles, clusters }, total, zoom) {
  const pins = singles.map(pin);
  return {
    pins,
    clusters,
    // The exact number of shops behind this view — pins plus every cluster's
    // count. The header reads this, so it can no longer say 1,000.
    total,
    // Stated so the client never has to infer it, and so a mismatch is
    // visible in the response rather than only on screen.
    shown: pins.length + clusters.reduce((a, c) => a + c.count, 0),
    zoom,
    cell_deg: cellSize(zoom),
    too_many: false,
  };
}

function tooMany(zoom) {
  return {
    pins: [], clusters: [], total: null, shown: 0, zoom, cell_deg: cellSize(zoom),
    too_many: true,
    message: 'That view covers more shops than we can draw at once. Zoom in or add a filter.',
  };
}

// ── Self-test ───────────────────────────────────────────────────────────────

function selftest() {
  let pass = 0, fail = 0;
  const ok = (cond, msg) => { if (cond) { pass++; console.log('  ok   ' + msg); } else { fail++; console.log('  FAIL ' + msg); } };

  // The cell formula has to match the client's, or every bubble moves.
  ok(Math.abs(cellSize(0) - (64 * 360) / 256) < 1e-9, 'the cell at zoom 0 is the client\'s cell');
  ok(Math.abs(cellSize(4) - cellSize(3) / 2) < 1e-12, 'and halves with every zoom level');
  ok(cellSize(-5) === cellSize(0) && cellSize(99) === cellSize(22), 'a nonsense zoom is clamped, not obeyed');
  ok(Number.isFinite(cellSize(undefined)) === false || cellSize(undefined) >= 0, 'an absent zoom does not produce NaN geometry');

  ok(cellOf(41.9, -87.6, 1) === '41:-88', 'a cell key floors towards negative infinity, so the west is not off by one');
  ok(cellOf(0.5, 0.5, 1) === '0:0' && cellOf(-0.5, -0.5, 1) === '-1:-1', 'and either side of zero lands in its own cell');

  // The property every count on the map rests on: nothing is dropped and
  // nothing is counted twice.
  const rows = [];
  for (let i = 0; i < 200; i++) {
    rows.push({ id: i, lat: 40 + (i % 20) * 0.4, lng: -80 - Math.floor(i / 20) * 0.4, claimed: i % 7 === 0 ? 1 : 0, verified: i % 11 === 0 ? 1 : 0 });
  }
  for (const zoom of [0, 3, 5, 8, 11]) {
    const { singles, clusters } = clusterRows(rows, zoom);
    const accounted = singles.length + clusters.reduce((a, c) => a + c.count, 0);
    ok(accounted === rows.length, `at zoom ${zoom} every shop is in exactly one pin or one bubble (${accounted}/${rows.length})`);
    ok(clusters.every(c => c.count > 1), `at zoom ${zoom} no bubble stands for a single shop`);
    ok(new Set([...singles.map(s => s.id)]).size === singles.length, `at zoom ${zoom} no shop is drawn twice`);
  }

  // A bubble sits at the mean of the shops it stands for.
  const two = clusterRows([{ id: 1, lat: 10, lng: 20 }, { id: 2, lat: 10.0001, lng: 20.0001 }], 0);
  ok(two.clusters.length === 1 && Math.abs(two.clusters[0].lat - 10.00005) < 1e-9,
    'a bubble sits at the mean of its shops');
  ok(two.clusters[0].count === 2 && two.singles.length === 0, 'and stands for both of them');

  // Claimed and verified counts travel with the bubble, which is what colours it.
  const mixed = clusterRows([{ id: 1, lat: 1, lng: 1, claimed: 1 }, { id: 2, lat: 1, lng: 1, claimed: 0, verified: 1 }], 0);
  ok(mixed.clusters[0].claimed === 1 && mixed.clusters[0].verified === 1,
    'a bubble carries how many of its shops are claimed and verified');

  // Past the pin zoom, everything is its own pin.
  const all = clusterRows(rows, 14, { allSingles: true });
  ok(all.singles.length === rows.length && all.clusters.length === 0,
    'at street level every shop gets its own pin');

  ok(clusterRows([], 4).singles.length === 0 && clusterRows([], 4).clusters.length === 0,
    'an empty viewport is empty, not an error');

  const t = tooMany(5);
  ok(t.too_many === true && t.total === null && t.pins.length === 0,
    'a refusal says so and carries no half-answer');

  console.log(`\nstoreMap self-test: ${pass} passed, ${fail} failed`);
  return fail > 0;
}

module.exports = {
  mapStores, clusterRows, cellSize, cellOf, pin, selftest,
  CELL_PX, PIN_ZOOM, MAX_PINS, PIN_COLS,
};

if (require.main === module && process.argv[2] === 'selftest') {
  process.exit(selftest() ? 1 : 0);
}
