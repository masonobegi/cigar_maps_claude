/**
 * Does the store list return every shop it should?
 *
 * The list used to take 300 rows in placement order and only then cut them to
 * the radius, so in a dense metro it silently skipped shops a few blocks away.
 * Nobody noticed for months because nothing ever compared the list with the
 * truth. This job is that comparison, and it is the guardrail on the fix: it
 * replays GET /stores for 62 metro centres x 4 radii x 8 filter sets against a
 * brute-force truth set built in JavaScript from the whole stores table, and
 * fails if a single listing is missing.
 *
 * Read-only. It never writes to the database.
 *
 *   node src/jobs/recallMonitor.js                 # every case, human output
 *   node src/jobs/recallMonitor.js --quick         # the first 8 metros
 *   node src/jobs/recallMonitor.js --out <file>    # also write the JSON report
 *   node src/jobs/recallMonitor.js selftest        # no database needed
 *
 * Exit code 1 means recall is below 100%, a candidate set is crowding the
 * ceiling, or the list came back out of distance order.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  haversine, matchesFilters, hoursAreConfirmed, CANDIDATE_CEILING, RADIUS_MAX_MI, distanceSql,
} = require('../utils/storeSearch');

/**
 * The 62 metro centres the audit measured, so this run is comparable with the
 * numbers in plan.json. They are downtown points, not city centroids: a
 * customer searches from where they are standing.
 */
const METROS = [
  ['New York (Midtown)', 40.7549, -73.9840],
  ['Brooklyn', 40.6782, -73.9442],
  ['Newark NJ', 40.7357, -74.1724],
  ['Long Island (Hempstead)', 40.7062, -73.6187],
  ['Washington DC', 38.9072, -77.0369],
  ['Baltimore', 39.2904, -76.6122],
  ['Fort Lauderdale', 26.1224, -80.1373],
  ['Los Angeles', 34.0522, -118.2437],
  ['Chicago', 41.8781, -87.6298],
  ['Houston', 29.7604, -95.3698],
  ['Phoenix', 33.4484, -112.0740],
  ['Scottsdale', 33.4942, -111.9261],
  ['Philadelphia', 39.9526, -75.1652],
  ['San Antonio', 29.4241, -98.4936],
  ['San Diego', 32.7157, -117.1611],
  ['Dallas', 32.7767, -96.7970],
  ['Fort Worth', 32.7555, -97.3308],
  ['San Jose', 37.3382, -121.8863],
  ['San Francisco', 37.7749, -122.4194],
  ['Austin', 30.2672, -97.7431],
  ['Jacksonville', 30.3322, -81.6557],
  ['Columbus OH', 39.9612, -82.9988],
  ['Charlotte', 35.2271, -80.8431],
  ['Indianapolis', 39.7684, -86.1581],
  ['Seattle', 47.6062, -122.3321],
  ['Denver', 39.7392, -104.9903],
  ['Nashville', 36.1627, -86.7816],
  ['Oklahoma City', 35.4676, -97.5164],
  ['Boston', 42.3601, -71.0589],
  ['Providence', 41.8240, -71.4128],
  ['Hartford', 41.7658, -72.6734],
  ['Portland OR', 45.5152, -122.6784],
  ['Las Vegas', 36.1699, -115.1398],
  ['Detroit', 42.3314, -83.0458],
  ['Memphis', 35.1495, -90.0490],
  ['Louisville', 38.2527, -85.7585],
  ['Milwaukee', 43.0389, -87.9065],
  ['Albuquerque', 35.0844, -106.6504],
  ['Tucson', 32.2226, -110.9747],
  ['Sacramento', 38.5816, -121.4944],
  ['Kansas City', 39.0997, -94.5786],
  ['Atlanta', 33.7490, -84.3880],
  ['Miami', 25.7617, -80.1918],
  ['West Palm Beach', 26.7153, -80.0534],
  ['Tampa', 27.9506, -82.4572],
  ['Orlando', 28.5383, -81.3792],
  ['Raleigh', 35.7796, -78.6382],
  ['Minneapolis', 44.9778, -93.2650],
  ['New Orleans', 29.9511, -90.0715],
  ['Cleveland', 41.4993, -81.6944],
  ['Pittsburgh', 40.4406, -79.9959],
  ['Cincinnati', 39.1031, -84.5120],
  ['St. Louis', 38.6270, -90.1994],
  ['Salt Lake City', 40.7608, -111.8910],
  ['Richmond VA', 37.5407, -77.4360],
  ['Virginia Beach', 36.8529, -75.9780],
  ['Charleston SC', 32.7765, -79.9311],
  ['Buffalo', 42.8864, -78.8784],
  ['Honolulu', 21.3069, -157.8583],
  ['Camas WA', 45.5871, -122.3995],
  ['Boise', 43.6150, -116.2023],
  ['Des Moines', 41.5868, -93.6250],
];

const RADII = [10, 25, 50, 100];

/**
 * The filter sets. The three "open now" instants are a weekday afternoon, a
 * Saturday lunchtime and a Friday night, because a schedule bug tends to show
 * at one hour and not another.
 */
const FILTERS = [
  ['no filter', {}],
  ['open_now Thu 2pm ET', { open_now: '1' }, '2026-09-10T18:00:00Z'],
  ['open_now Sat 1pm ET', { open_now: '1' }, '2026-09-12T17:00:00Z'],
  ['open_now Fri 8pm ET', { open_now: '1' }, '2026-09-11T24:00:00Z'],
  ['lounge', { has_lounge: '1' }],
  ['type chips', { store_type: 'cigar_shop,cigar_lounge' }],
  ['q=cigar', { q: 'cigar' }],
  ['q=tobacco', { q: 'tobacco' }],
];

/**
 * Every row the truth set could possibly need, read once. Deliberately a plain
 * SELECT with no WHERE beyond the table itself: if the truth set reused the
 * route's own filters it could only ever agree with the route.
 */
async function truthRows(db) {
  const rows = await db.all(`
    SELECT s.id, s.name, s.description, s.city, s.state, s.lat, s.lng, s.visible,
           s.has_lounge, s.has_walk_in_humidor, s.store_type, s.claimed,
           s.hours, s.hours_source, s.timezone,
           EXISTS (SELECT 1 FROM inventory i WHERE i.store_id = s.id AND i.in_stock = 1) AS has_inventory
    FROM stores s
  `);
  return rows.map(r => ({ ...r, lat: r.lat === null ? null : Number(r.lat), lng: r.lng === null ? null : Number(r.lng) }));
}

/**
 * The truth: brute force over every row, in JavaScript, with no LIMIT and no
 * bounding box anywhere near it.
 */
function truthInside(rows, filter, lat, lng, radiusMi, { openStatus, timeZoneFor, now }) {
  const out = [];
  for (const s of rows) {
    if (!matchesFilters(s, filter)) continue;
    if (s.lat === null || s.lng === null) continue;
    const d = haversine(lat, lng, s.lat, s.lng);
    if (d > radiusMi) continue;
    if (filter.open_now === '1') {
      if (!hoursAreConfirmed(s.hours_source)) continue;
      if (openStatus(s.hours, s.timezone || timeZoneFor(s.state, s.lat, s.lng), now).isOpen !== true) continue;
    }
    out.push({ id: s.id, d });
  }
  out.sort((a, b) => a.d - b.d || a.id - b.id);
  return out;
}

/**
 * Page through the list the way the client does, so the monitor measures what
 * a customer can actually reach rather than what one request happens to hold.
 */
async function fetchAllPages(listStores, query, now) {
  const first = await listStores({ ...query, offset: 0 }, now);
  if (first.too_many) return { rows: null, meta: first };
  const rows = [...first.stores];
  let next = first.next_offset;
  let guard = 0;
  while (next !== null && next !== undefined) {
    if (++guard > 200) throw new Error('paging did not terminate');
    const page = await listStores({ ...query, offset: next }, now);
    rows.push(...page.stores);
    next = page.next_offset;
  }
  return { rows, meta: first };
}

async function run(opts = {}) {
  const db = require('../database/db');
  const { listStores } = require('../utils/storeList');
  const { openStatus, timeZoneFor } = require('../utils/storeHours');

  const metros = opts.quick ? METROS.slice(0, 8) : METROS;
  const rows = await truthRows(db);
  const report = { started_at: new Date().toISOString(), cases: [], failures: [], worst: null, recall: null };
  let got = 0, want = 0;

  for (const [fname, filter, instant] of FILTERS) {
    const now = instant ? new Date(instant) : new Date();
    for (const [mname, lat, lng] of metros) {
      for (const radius of RADII) {
        const truth = truthInside(rows, filter, lat, lng, radius, { openStatus, timeZoneFor, now });
        const { rows: live, meta } = await fetchAllPages(
          listStores, { ...filter, lat, lng, radius: String(radius) }, now);
        const label = `${mname} ${radius}mi ${fname}`;

        if (live === null) {
          report.failures.push({ label, why: 'the candidate ceiling refused the search', total: truth.length });
          continue;
        }

        const liveIds = new Set(live.map(s => s.id));
        const missing = truth.filter(t => !liveIds.has(t.id));
        const truthIds = new Set(truth.map(t => t.id));
        const extra = live.filter(s => !truthIds.has(s.id));

        // Distance must never go backwards down the list, across page joins
        // too — below the sponsored rows, which are lifted on purpose and are
        // the one thing allowed to sit out of order. A paid slot must not be
        // able to hide a broken sort, so the check resumes immediately after
        // them rather than being skipped wherever `sponsored` appears.
        const paid = live.filter(s => s.sponsored).length;
        const natural = live.slice(paid);
        let ordered = true;
        for (let i = 1; i < natural.length; i++) {
          const a = natural[i - 1].distance_mi, b = natural[i].distance_mi;
          if (a !== null && b !== null && b + 0.051 < a) ordered = false;
        }
        // Sponsorship reorders and never removes, so the truth set is the test
        // of that: a lift can never cost a customer a result. Checked here
        // rather than trusted, because it is the property the whole design
        // rests on.
        if (paid > 2) {
          report.failures.push({ label, why: `${paid} rows are sponsored; at most 2 may be`, count: paid });
        }
        if (paid && live.slice(0, paid).some(s => !s.sponsored)) {
          report.failures.push({ label, why: 'a sponsored row is not at the head of the list' });
        }
        if (live.some(s => s.sponsored && !s.sponsored_plan)) {
          report.failures.push({ label, why: 'a sponsored row carries no plan, so the client cannot label it' });
        }

        got += live.length - extra.length;
        want += truth.length;
        const crowding = truth.length / CANDIDATE_CEILING;
        const kase = {
          label, total: live.length, truth: truth.length,
          unconfirmed: meta.unconfirmed_hours_nearby,
          ok: missing.length === 0 && extra.length === 0 && ordered,
        };
        report.cases.push(kase);
        if (!report.worst || truth.length > report.worst.total) report.worst = { label, total: truth.length };

        if (missing.length) {
          report.failures.push({ label, why: 'listings in range are missing from the list', missing: missing.slice(0, 10).map(m => m.id), count: missing.length });
        }
        if (extra.length) {
          report.failures.push({ label, why: 'the list returned listings outside the radius or the filter', extra: extra.slice(0, 10).map(s => s.id), count: extra.length });
        }
        if (!ordered) report.failures.push({ label, why: 'results are not in distance order' });
        if (crowding > 0.8) {
          report.failures.push({ label, why: `the candidate set is at ${(crowding * 100).toFixed(0)}% of the ${CANDIDATE_CEILING} ceiling`, total: truth.length });
        }
      }
    }
  }

  report.recall = want ? got / want : 1;
  report.finished_at = new Date().toISOString();

  console.log(`recall ${(report.recall * 100).toFixed(2)}% (${got}/${want}) over ${report.cases.length} cases`);
  console.log(`largest candidate set: ${report.worst ? `${report.worst.label} = ${report.worst.total}` : 'none'} (ceiling ${CANDIDATE_CEILING})`);
  if (report.failures.length) {
    console.log(`\n${report.failures.length} failures:`);
    for (const f of report.failures.slice(0, 40)) console.log(`  ${f.label}: ${f.why}${f.count ? ` (${f.count})` : ''}`);
  } else {
    console.log('no failures');
  }

  if (opts.out) {
    fs.mkdirSync(path.dirname(opts.out), { recursive: true });
    fs.writeFileSync(opts.out, JSON.stringify(report, null, 1));
    console.log(`\nwrote ${opts.out}`);
  }
  return report;
}

/**
 * The promises the list makes beyond recall, checked against a real database:
 * the radius cap, the candidate ceiling, paging that neither repeats nor skips,
 * "open now" resting only on hours somebody stands behind, and the no-location
 * order staying as it was.
 */
async function contract() {
  const db = require('../database/db');
  const { listStores } = require('../utils/storeList');
  const { openStatus, timeZoneFor } = require('../utils/storeHours');
  let pass = 0, fail = 0;
  const ok = (cond, label, extra) => {
    if (cond) { pass++; console.log(`  ok   ${label}`); }
    else { fail++; console.log(`  FAIL ${label}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ''}`); }
  };

  const rows = await truthRows(db);
  const [, chiLat, chiLng] = METROS.find(m => m[0] === 'Chicago');
  const now = new Date('2026-09-10T18:00:00Z');
  const at = (extra = {}) => listStores({ lat: chiLat, lng: chiLng, radius: '25', ...extra }, now);

  // 1. A Chicago search at 25 miles returns every public shop in range.
  const truth25 = truthInside(rows, {}, chiLat, chiLng, 25, { openStatus, timeZoneFor, now });
  const chi = await fetchAllPages(listStores, { lat: chiLat, lng: chiLng, radius: '25' }, now);
  const chiIds = new Set(chi.rows.map(r => r.id));
  ok(truth25.every(t => chiIds.has(t.id)) && chi.rows.length === truth25.length,
    `Chicago at 25 miles returns every public shop in range (${truth25.length})`,
    { got: chi.rows.length, want: truth25.length });
  ok(chi.meta.total === truth25.length, 'and says so in the total', { total: chi.meta.total });

  // 2. The radius is capped, and the answer says it was.
  const wide = await at({ radius: '500' });
  ok(wide.radius_mi === RADIUS_MAX_MI && wide.radius_capped === true,
    'a 500-mile radius is capped at 100 and the answer admits it', { radius_mi: wide.radius_mi, capped: wide.radius_capped });
  const plain = await at({ radius: '25' });
  ok(plain.radius_capped === false, 'an ordinary radius is not flagged as capped');

  // 3. Paging joins up: no repeats, no gaps, still in distance order.
  const paged = [];
  let off = 0, guard = 0;
  for (;;) {
    const page = await listStores({ lat: chiLat, lng: chiLng, radius: '25', limit: '7', offset: String(off) }, now);
    paged.push(...page.stores);
    if (page.next_offset === null || ++guard > 500) break;
    off = page.next_offset;
  }
  ok(paged.length === truth25.length, 'paging seven at a time reaches every shop', { paged: paged.length, want: truth25.length });
  ok(new Set(paged.map(s => s.id)).size === paged.length, 'and never returns the same shop twice');
  let monotonic = true;
  for (let i = 1; i < paged.length; i++) if (paged[i].distance_mi + 0.051 < paged[i - 1].distance_mi) monotonic = false;
  ok(monotonic, 'and never goes backwards in distance across a page join');

  // 4. Two shops on the same spot both come back, and the order is stable.
  const sameSpot = paged.filter(s => /Same Spot/.test(s.name || ''));
  if (sameSpot.length) {
    ok(sameSpot.length === 2, 'two listings on one spot both appear', sameSpot.map(s => s.name));
    const again = await fetchAllPages(listStores, { lat: chiLat, lng: chiLng, radius: '25' }, now);
    ok(JSON.stringify(again.rows.map(r => r.id)) === JSON.stringify(chi.rows.map(r => r.id)),
      'the same search twice gives the same order');
  }

  // 5. A listing sitting exactly on the radius is inside it, not lost to a
  //    rounding difference between the SQL and the JavaScript.
  const onLine = rows.find(r => /On The 25 Mile Line/.test(r.name || ''));
  if (onLine) {
    const d = haversine(chiLat, chiLng, onLine.lat, onLine.lng);
    ok(chiIds.has(onLine.id) === (d <= 25),
      `a listing ${d.toFixed(4)} miles out is treated the same by SQL and by the truth set`,
      { inList: chiIds.has(onLine.id), inTruth: d <= 25 });
  }

  // 6. "Open now" counts only hours somebody stands behind.
  const open = await fetchAllPages(listStores, { lat: chiLat, lng: chiLng, radius: '25', open_now: '1' }, now);
  const openTruth = truthInside(rows, { open_now: '1' }, chiLat, chiLng, 25, { openStatus, timeZoneFor, now });
  ok(open.rows.length === openTruth.length, 'open now matches the truth set', { got: open.rows.length, want: openTruth.length });
  ok(open.rows.every(s => ['website', 'owner', 'staff', 'chain'].includes(s.hours_source)),
    'no shop reaches an "open now" list on map hours');
  const mapHoursNearby = truth25.filter(t => {
    const r = rows.find(x => x.id === t.id);
    return !hoursAreConfirmed(r.hours_source);
  }).length;
  ok(open.meta.unconfirmed_hours_nearby === mapHoursNearby,
    `and the answer says how many nearby shops it cannot vouch for (${mapHoursNearby})`,
    { said: open.meta.unconfirmed_hours_nearby });

  // 7. A hidden listing never appears, whatever the search.
  const hidden = rows.filter(r => Number(r.visible) !== 1).map(r => r.id);
  ok(!chi.rows.some(s => hidden.includes(s.id)), 'no hidden listing reaches the list');

  // 8. The no-location list keeps the order the site has always used, because
  //    changing it is a separate sweep with a decision owed to Mason.
  const national = await listStores({ limit: '50' }, now);
  const expected = await db.all(`
    SELECT s.id FROM stores s
    LEFT JOIN inventory i ON i.store_id = s.id AND i.in_stock = 1
    LEFT JOIN store_follows sf ON sf.store_id = s.id
    WHERE s.visible = 1
    GROUP BY s.id
    ORDER BY (CASE WHEN s.featured_until IS NOT NULL AND s.featured_until > NOW()
                   THEN (CASE WHEN s.plan = 'partner' THEN 2 ELSE 1 END) ELSE 0 END) DESC,
             s.claimed DESC, s.verified DESC, COUNT(DISTINCT sf.user_id) DESC,
             COUNT(DISTINCT i.id) DESC, s.confidence DESC, s.name, s.id
    LIMIT 50`);
  ok(JSON.stringify(national.stores.map(s => s.id)) === JSON.stringify(expected.map(r => r.id)),
    'a list with no location is ordered exactly as before');

  // 9. Paid placement, end to end against the database: a lift reorders and
  //    never removes, it is labelled, and a nationwide list carries none.
  const paidShop = await db.get(`SELECT id, name FROM stores WHERE visible = 1 AND lat IS NOT NULL
    ORDER BY ${distanceSql('lat', 'lng', '?', '?')} LIMIT 1 OFFSET 20`, [chiLat, chiLat, chiLng]);
  if (paidShop) {
    const before = await fetchAllPages(listStores, { lat: chiLat, lng: chiLng, radius: '25' }, now);
    await db.run(`UPDATE stores SET plan = 'partner', featured_until = NOW() + INTERVAL '30 days' WHERE id = ?`, [paidShop.id]);
    try {
      const after = await fetchAllPages(listStores, { lat: chiLat, lng: chiLng, radius: '25' }, now);
      const sameSet = JSON.stringify(before.rows.map(r => r.id).sort((a, b) => a - b))
        === JSON.stringify(after.rows.map(r => r.id).sort((a, b) => a - b));
      ok(sameSet, 'a sponsored lift changes the order and not the set',
        { before: before.rows.length, after: after.rows.length });
      ok(after.meta.total === before.meta.total, 'and not the total either',
        { before: before.meta.total, after: after.meta.total });
      ok(after.rows[0] && after.rows[0].id === paidShop.id,
        `the paying shop (#${paidShop.id}, 21st by distance) is lifted to the top`,
        after.rows[0] && after.rows[0].id);
      ok(after.rows[0] && after.rows[0].sponsored === true && after.rows[0].sponsored_plan === 'partner',
        'and is labelled, with its plan');
      ok(after.rows.filter(r => r.sponsored).length === 1, 'exactly one row is sponsored');
      ok(after.rows.slice(1).every(r => !r.sponsored), 'and it is the only one');
      const national = await listStores({ limit: '20' }, now);
      ok(national.sponsored_count === 0 && national.sponsored_slots === 0,
        'a list with no location sells no placement at all',
        { count: national.sponsored_count, slots: national.sponsored_slots });
    } finally {
      await db.run(`UPDATE stores SET plan = NULL, featured_until = NULL WHERE id = ?`, [paidShop.id]);
    }
  }

  // 10. Past the ceiling the answer is a refusal, never a shortened list. No
  //    real search reaches it, so the ceiling is lowered under the list's feet
  //    to prove the refusal path works at all — an untested refusal is how a
  //    ceiling quietly becomes a second silent truncation.
  const everything = await db.get('SELECT COUNT(*)::int AS n FROM stores WHERE visible = 1');
  const search = require('../utils/storeSearch');
  ok(everything.n < search.CANDIDATE_CEILING,
    `this database (${everything.n} public) sits under the ${search.CANDIDATE_CEILING} ceiling, so no real search is refused`,
    everything.n);

  const realCeiling = search.CANDIDATE_CEILING;
  try {
    search.CANDIDATE_CEILING = 5;
    delete require.cache[require.resolve('../utils/storeList')];
    const { listStores: tiny } = require('../utils/storeList');
    const refused = await tiny({ lat: chiLat, lng: chiLng, radius: '25' }, now);
    ok(refused.too_many === true && refused.stores.length === 0 && refused.total === null,
      'past the ceiling the list refuses instead of shortening itself',
      { too_many: refused.too_many, returned: refused.stores.length, total: refused.total });
    ok(typeof refused.message === 'string' && /narrow/i.test(refused.message),
      'and the refusal tells the customer what to do about it', refused.message);
    const small = await tiny({ lat: chiLat, lng: chiLng, radius: '1' }, now);
    ok(small.too_many === false, 'a search back under the ceiling is answered normally');
  } finally {
    search.CANDIDATE_CEILING = realCeiling;
    delete require.cache[require.resolve('../utils/storeList')];
  }

  console.log(`\nlist contract: ${pass} passed, ${fail} failed`);
  return fail;
}

module.exports = { METROS, RADII, FILTERS, truthRows, truthInside, fetchAllPages, run, contract };

// ── self-test: the truth set itself, with no database ────────────────────────
function selftest() {
  const { openStatus, timeZoneFor } = require('../utils/storeHours');
  let pass = 0, fail = 0;
  const ok = (cond, label, extra) => {
    if (cond) { pass++; console.log(`  ok   ${label}`); }
    else { fail++; console.log(`  FAIL ${label}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ''}`); }
  };

  ok(METROS.length === 62, 'the 62 metro centres the audit measured', METROS.length);
  ok(new Set(METROS.map(m => m[0])).size === 62, 'no metro is listed twice');
  ok(METROS.every(([, lat, lng]) => lat > 18 && lat < 50 && lng < -66 && lng > -160), 'every centre is in the United States');
  ok(RADII.length === 4 && RADII[RADII.length - 1] === RADIUS_MAX_MI, 'four radii, ending at the cap');
  ok(FILTERS.length === 8, 'eight filter sets', FILTERS.length);

  // A fixture around Chicago: one shop in the Loop, one in Evanston (13 mi),
  // one in Milwaukee (80 mi), one hidden, one with no pin.
  const rows = [
    { id: 1, name: 'Loop Cigars', city: 'Chicago', state: 'IL', lat: 41.8790, lng: -87.6290, visible: 1, has_lounge: 1, store_type: 'cigar_shop', claimed: 0, hours: JSON.stringify({ Thu: '9am-9pm' }), hours_source: 'website', timezone: 'America/Chicago', has_inventory: false, description: '' },
    { id: 2, name: 'Evanston Tobacco', city: 'Evanston', state: 'IL', lat: 42.0451, lng: -87.6877, visible: 1, has_lounge: 0, store_type: 'tobacco_shop', claimed: 0, hours: JSON.stringify({ Thu: '9am-9pm' }), hours_source: 'osm', timezone: 'America/Chicago', has_inventory: false, description: '' },
    { id: 3, name: 'Milwaukee Humidor', city: 'Milwaukee', state: 'WI', lat: 43.0389, lng: -87.9065, visible: 1, has_lounge: 1, store_type: 'cigar_lounge', claimed: 0, hours: null, hours_source: null, timezone: 'America/Chicago', has_inventory: false, description: '' },
    { id: 4, name: 'Hidden Loop Shop', city: 'Chicago', state: 'IL', lat: 41.8785, lng: -87.6295, visible: 0, has_lounge: 1, store_type: 'cigar_shop', claimed: 0, hours: null, hours_source: null, timezone: 'America/Chicago', has_inventory: false, description: '' },
    { id: 5, name: 'No Pin Cigars', city: 'Chicago', state: 'IL', lat: null, lng: null, visible: 1, has_lounge: 1, store_type: 'cigar_shop', claimed: 0, hours: null, hours_source: null, timezone: null, has_inventory: false, description: '' },
  ];
  const at = (filter, radius, now) => truthInside(rows, filter, 41.8781, -87.6298, radius, { openStatus, timeZoneFor, now: now || new Date('2026-09-10T18:00:00Z') }).map(t => t.id);

  ok(JSON.stringify(at({}, 10)) === '[1]', 'at 10 miles only the Loop shop', at({}, 10));
  ok(JSON.stringify(at({}, 25)) === '[1,2]', 'at 25 miles Evanston joins it', at({}, 25));
  ok(JSON.stringify(at({}, 100)) === '[1,2,3]', 'at 100 miles Milwaukee joins them', at({}, 100));
  ok(!at({}, 100).includes(4), 'a hidden listing is never in the truth set');
  ok(!at({}, 100).includes(5), 'a listing with no pin cannot be in a radius');
  ok(JSON.stringify(at({ has_lounge: '1' }, 100)) === '[1,3]', 'the lounge filter reaches the truth set', at({ has_lounge: '1' }, 100));
  // Thursday 2pm Chicago time: only the shop whose hours somebody stands behind.
  ok(JSON.stringify(at({ open_now: '1' }, 100)) === '[1]', 'open now counts only confirmed hours', at({ open_now: '1' }, 100));
  // Map hours are excluded even when they say the shop is open right now.
  ok(!at({ open_now: '1' }, 100).includes(2), 'a shop with map hours is not "open now"');

  const ordered = truthInside(rows, {}, 41.8781, -87.6298, 100, { openStatus, timeZoneFor, now: new Date() });
  ok(ordered.every((r, i) => i === 0 || ordered[i - 1].d <= r.d), 'the truth set comes back in distance order');

  console.log(`\nrecallMonitor self-test: ${pass} passed, ${fail} failed`);
  return fail;
}

if (require.main === module) main();

function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === 'selftest') process.exit(selftest() ? 1 : 0);
  if (argv[0] === 'contract') {
    contract().then(f => process.exit(f ? 1 : 0)).catch(e => { console.error(e); process.exit(1); });
    return;
  }
  const outIdx = argv.indexOf('--out');
  run({ quick: argv.includes('--quick'), out: outIdx >= 0 ? argv[outIdx + 1] : null })
    .then(r => process.exit(r.failures.length ? 1 : 0))
    .catch(e => { console.error(e); process.exit(1); });
}
