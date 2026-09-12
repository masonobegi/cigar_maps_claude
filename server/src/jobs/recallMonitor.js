/**
 * Does the store list return every shop it should?
 *
 * The list used to answer a place search by ordering the whole directory on
 * paid placement and feed size, cutting it to 300 rows, and only then filtering
 * to the radius and sorting by distance. Nothing said the list was short, so
 * the fault was invisible: 131 public listings could not be found from their
 * own doorstep at 50 miles, recall was 93.5% at 50 and 73.1% at 100, and a
 * search from Midtown returned 272 of the 364 shops inside the circle.
 *
 * This job is the guard that stops it coming back. It is read-only. For every
 * metro, radius and filter it asks the list the way a customer does
 * (utils/storeSearch.searchNear, the same code the route runs) and compares the
 * answer with a brute-force truth set: every visible listing that passes the
 * same SQL filters, with the distance worked out in JavaScript afterwards and
 * no box, no cap and no ordering in between. Two independent paths to the same
 * number.
 *
 * It fails when
 *   - a case returns fewer listings than are really inside the circle,
 *   - a page comes back out of distance order or with a gap between pages,
 *   - or a candidate set climbs past 80% of the ceiling, which is the point at
 *     which growth would start being refused rather than served.
 *
 * CLI:
 *   node src/jobs/recallMonitor.js                 every metro, four radii
 *   node src/jobs/recallMonitor.js --quick         the eight dense metros only
 *   node src/jobs/recallMonitor.js --out file.json write the full report
 *   node src/jobs/recallMonitor.js selftest        the fixtures below
 */
'use strict';

const fs = require('fs');
const db = require('../database/db');
const { openStatus, timeZoneFor } = require('../utils/storeHours');
const {
  searchNear, buildFilters, haversine, hoursAreConfirmed,
  CANDIDATE_CEILING, MAX_PAGE_SIZE,
} = require('../utils/storeSearch');

// The 62 centres the gap audit measured, so a number here can be compared with
// the numbers in the plan. The first eight are the ones that lost rows.
const METROS = [
  ['New York (Midtown)', 40.7549, -73.9840], ['Brooklyn', 40.6928, -73.9903],
  ['Newark NJ', 40.7357, -74.1724], ['Long Island (Hempstead)', 40.7062, -73.6187],
  ['Washington DC', 38.9072, -77.0369], ['Baltimore', 39.2904, -76.6122],
  ['Fort Lauderdale', 26.1224, -80.1373], ['Los Angeles', 34.0522, -118.2437],
  ['Chicago', 41.8818, -87.6231], ['Houston', 29.7604, -95.3698], ['Phoenix', 33.4484, -112.0740],
  ['Scottsdale', 33.4942, -111.9261], ['Philadelphia', 39.9526, -75.1652],
  ['San Antonio', 29.4241, -98.4936], ['San Diego', 32.7157, -117.1611],
  ['Dallas', 32.7767, -96.7970], ['Fort Worth', 32.7555, -97.3308], ['San Jose', 37.3382, -121.8863],
  ['San Francisco', 37.7749, -122.4194], ['Austin', 30.2672, -97.7431],
  ['Jacksonville', 30.3322, -81.6557], ['Columbus OH', 39.9612, -82.9988],
  ['Charlotte', 35.2271, -80.8431], ['Indianapolis', 39.7684, -86.1581],
  ['Seattle', 47.6062, -122.3321], ['Denver', 39.7392, -104.9903],
  ['Nashville', 36.1627, -86.7816], ['Oklahoma City', 35.4676, -97.5164],
  ['Boston', 42.3601, -71.0589], ['Providence', 41.8240, -71.4128], ['Hartford', 41.7658, -72.6734],
  ['Portland OR', 45.5152, -122.6784], ['Las Vegas', 36.1699, -115.1398],
  ['Detroit', 42.3314, -83.0458], ['Memphis', 35.1495, -90.0490], ['Louisville', 38.2527, -85.7585],
  ['Milwaukee', 43.0389, -87.9065], ['Albuquerque', 35.0844, -106.6504],
  ['Tucson', 32.2226, -110.9747], ['Sacramento', 38.5816, -121.4944],
  ['Kansas City', 39.0997, -94.5786], ['Atlanta', 33.7490, -84.3880], ['Miami', 25.7617, -80.1918],
  ['West Palm Beach', 26.7153, -80.0534], ['Tampa', 27.9506, -82.4572],
  ['Orlando', 28.5383, -81.3792], ['Raleigh', 35.7796, -78.6382], ['Minneapolis', 44.9778, -93.2650],
  ['New Orleans', 29.9511, -90.0715], ['Cleveland', 41.4993, -81.6944],
  ['Pittsburgh', 40.4406, -79.9959], ['Cincinnati', 39.1031, -84.5120],
  ['St. Louis', 38.6270, -90.1994], ['Salt Lake City', 40.7608, -111.8910],
  ['Richmond VA', 37.5407, -77.4360], ['Virginia Beach', 36.8529, -75.9780],
  ['Charleston SC', 32.7765, -79.9311], ['Buffalo', 42.8864, -78.8784],
  ['Honolulu', 21.3069, -157.8583], ['Camas WA', 45.5871, -122.3995],
  ['Boise', 43.6150, -116.2023], ['Des Moines', 41.5868, -93.6250],
];

const DENSE = 8;            // the metros that were losing rows
const RADII = [10, 25, 50, 100];

// Thursday 2pm, Saturday 1pm and Friday 8pm Eastern: the three instants the
// gap audit used, so an "Open now" count can be compared with its figures.
const INSTANTS = [
  ['Thu 2pm ET', new Date('2026-09-10T18:00:00Z')],
  ['Sat 1pm ET', new Date('2026-09-12T17:00:00Z')],
  ['Fri 8pm ET', new Date('2026-09-12T00:00:00Z')],
];

const FILTERS = [
  ['no filter', {}],
  ['open_now', { open_now: '1' }],
  ['lounge', { has_lounge: '1' }],
  ['type chips', { store_type: 'cigar_shop,cigar_lounge' }],
  ['q=cigar', { q: 'cigar' }],
  ['q=tobacco', { q: 'tobacco' }],
];

/**
 * The truth set: every visible listing the same SQL filters keep, with its pin,
 * its hours and nothing else. No bounding box, no ordering, no cap — the
 * distance is measured afterwards in JavaScript, so nothing the search does
 * (the box, the SQL haversine, the paging) can hide a row from this count.
 */
async function truthRows(filter) {
  const { where, params } = buildFilters(filter);
  return db.all(`
    SELECT s.id, s.lat, s.lng, s.hours, s.hours_source, s.timezone, s.state
    FROM stores s
    WHERE ${where.join(' AND ')} AND s.lat IS NOT NULL AND s.lng IS NOT NULL
  `, params);
}

/** Every id inside the circle, nearest first — worked out the slow, plain way. */
function truthInside(rows, lat, lng, radiusMi, { openNow = false, now = new Date() } = {}) {
  const hits = [];
  for (const r of rows) {
    if (openNow) {
      const tz = r.timezone || timeZoneFor(r.state, r.lat, r.lng);
      if (!hoursAreConfirmed(r) || openStatus(r.hours, tz, now).isOpen !== true) continue;
    }
    const d = haversine(lat, lng, Number(r.lat), Number(r.lng));
    if (d <= radiusMi) hits.push({ id: r.id, d });
  }
  return hits.sort((a, b) => (a.d - b.d) || (a.id - b.id));
}

/** Walk every page of one search, the way "Show more" does. */
async function allPages(query, now) {
  const ids = [];
  let total = null, unconfirmed = 0, guard = 0;
  for (let offset = 0; ; offset += MAX_PAGE_SIZE) {
    const page = await searchNear(db, { ...query, format: 'page', limit: String(MAX_PAGE_SIZE), offset: String(offset) }, { now });
    if (total === null) { total = page.total; unconfirmed = page.unconfirmed_hours; }
    if (page.too_many) return { ids: [], total: page.total, unconfirmed, tooMany: true, pages: page.rows };
    ids.push(...page.rows.map(r => r.id));
    if (offset + page.rows.length >= page.total || !page.rows.length) break;
    if (++guard > 200) throw new Error('paging did not terminate');
  }
  return { ids, total, unconfirmed, tooMany: false };
}

/**
 * run() — every case, compared with the truth set.
 * Returns { cases, failures, worstCandidateSet, recall }.
 */
async function run({ quick = false, out = null, log = console.log, deep = DENSE } = {}) {
  const metros = quick ? METROS.slice(0, DENSE) : METROS;
  const report = { started_at: new Date().toISOString(), cases: [], failures: [], worst: { label: null, total: 0 } };
  let returned = 0, expected = 0;

  // One truth read per filter, reused across every metro and radius: the
  // filters are the expensive part, the arithmetic is not.
  const truthByFilter = new Map();
  for (const [name, f] of FILTERS) truthByFilter.set(name, await truthRows(f));

  for (const [fname, fquery] of FILTERS) {
    const rows = truthByFilter.get(fname);
    const instants = fname === 'open_now' ? INSTANTS : [['', new Date('2026-09-10T18:00:00Z')]];

    for (const [iname, now] of instants) {
      for (let mi = 0; mi < metros.length; mi++) {
        const [mname, lat, lng] = metros[mi];
        for (const radius of RADII) {
          const query = { ...fquery, lat: String(lat), lng: String(lng), radius: String(radius) };
          const want = truthInside(rows, lat, lng, radius, { openNow: fquery.open_now === '1', now });
          const label = `${mname} ${radius}mi ${fname}${iname ? ' ' + iname : ''}`;

          // Deep cases walk every page; the rest check the total and the first
          // page, which is what a customer actually sees.
          const deepCase = mi < deep && radius >= 50;
          let got;
          if (deepCase) {
            got = await allPages(query, now);
          } else {
            const page = await searchNear(db, { ...query, format: 'page' }, { now });
            got = { ids: page.rows.map(r => r.id), total: page.total, unconfirmed: page.unconfirmed_hours, tooMany: page.too_many, firstPageOnly: true };
          }

          returned += Math.min(got.total, want.length);
          expected += want.length;
          if (got.total > report.worst.total) report.worst = { label, total: got.total };

          const problems = [];
          if (got.total !== want.length) {
            // Only a deep case has read every page, so only a deep case can
            // name which listing went missing.
            const missing = got.firstPageOnly ? [] : want.filter(w => !got.ids.includes(w.id)).slice(0, 5);
            problems.push(`total ${got.total}, truth ${want.length}`
              + (missing.length ? `; nearest missing #${missing.map(m => `${m.id} at ${m.d.toFixed(1)}mi`).join(', #')}` : ''));
          }
          if (!got.firstPageOnly && got.ids.length !== want.length) {
            problems.push(`paged through ${got.ids.length} rows for a total of ${got.total}`);
          }
          if (!got.firstPageOnly && new Set(got.ids).size !== got.ids.length) {
            problems.push('a listing appeared on two pages');
          }
          // Distance must never go backwards below the sponsored slots, which
          // are the only rows allowed out of order.
          const wantOrder = want.map(w => w.id).slice(0, got.ids.length);
          const outOfOrder = got.ids.filter((id, i) => wantOrder[i] !== undefined && wantOrder[i] !== id).length;
          if (outOfOrder && !got.firstPageOnly) problems.push(`${outOfOrder} rows out of distance order`);
          if (got.total > CANDIDATE_CEILING * 0.8) {
            problems.push(`${got.total} candidates is past 80% of the ${CANDIDATE_CEILING} ceiling`);
          }

          report.cases.push({ label, total: got.total, truth: want.length, unconfirmed: got.unconfirmed, ok: !problems.length });
          if (problems.length) report.failures.push({ label, problems });
        }
      }
    }
  }

  report.recall = expected ? returned / expected : 1;
  report.finished_at = new Date().toISOString();
  log(`[recall] ${report.cases.length} cases, ${report.failures.length} failed. `
    + `Recall ${(report.recall * 100).toFixed(1)}%. `
    + `Fullest circle: ${report.worst.total} listings (${report.worst.label}), ceiling ${CANDIDATE_CEILING}.`);
  for (const f of report.failures.slice(0, 20)) log(`  FAIL ${f.label}: ${f.problems.join('; ')}`);
  if (report.failures.length > 20) log(`  … and ${report.failures.length - 20} more`);
  if (out) { fs.writeFileSync(out, JSON.stringify(report, null, 1)); log(`written to ${out}`); }
  return report;
}

// ── Self-test ───────────────────────────────────────────────────────────────
// Fixtures, no database: the arithmetic and the rules the plan named.

function selfTest() {
  let pass = 0, fail = 0;
  const ok = (c, l, got) => { if (c) { pass++; } else { fail++; console.log(`  FAIL ${l}${got !== undefined ? `  -> ${JSON.stringify(got)}` : ''}`); } };

  const { orderCandidates, applyOpenNow, readLocation } = require('../utils/storeSearch');

  // The two landmark shops the live API dropped, at their real distance from
  // the Midtown centre the audit used.
  const MIDTOWN = [40.7549, -73.9840];
  const manhattanTobacco = { id: 41493, lat: 40.7658, lng: -73.9869 };   // 881 9th Ave
  const davidoff = { id: 21746, lat: 40.7601, lng: -73.9733 };           // 515 Madison Ave
  const dMT = haversine(MIDTOWN[0], MIDTOWN[1], manhattanTobacco.lat, manhattanTobacco.lng);
  const dDav = haversine(MIDTOWN[0], MIDTOWN[1], davidoff.lat, davidoff.lng);
  ok(dMT < 1.2, '#41493 Manhattan Tobacco is about a mile from Midtown', dMT);
  ok(dDav < 1.2, '#21746 Davidoff of Geneva is about half a mile from Midtown', dDav);

  // A truth set keeps everything inside the circle, nearest first, whatever
  // order it arrived in.
  const rows = [
    { id: 3, lat: 40.9, lng: -73.9, hours_source: 'website', hours: '{"Thu":"10am-7pm"}', state: 'NY' },
    { id: 1, lat: 40.7558, lng: -73.9855, hours_source: 'website', hours: '{"Thu":"10am-7pm"}', state: 'NY' },
    { id: 2, lat: 40.76, lng: -73.98, hours_source: null, hours: '{"Thu":"10am-7pm"}', state: 'NY' },
    { id: 4, lat: 34.0, lng: -118.2, hours_source: 'website', hours: '{"Thu":"10am-7pm"}', state: 'CA' },
  ];
  const inside = truthInside(rows, MIDTOWN[0], MIDTOWN[1], 50);
  ok(inside.map(r => r.id).join(',') === '1,2,3', 'the circle keeps its three NY rows, nearest first', inside);
  ok(!inside.some(r => r.id === 4), 'a Los Angeles row is not within 50 miles of Midtown');

  // Open now counts only hours somebody stands behind, and counts the rest.
  const at = new Date('2026-09-10T18:00:00Z');
  const open = truthInside(rows, MIDTOWN[0], MIDTOWN[1], 50, { openNow: true, now: at });
  ok(open.map(r => r.id).join(',') === '1,3', 'map hours (#2) never make a shop "Open now"', open);
  const applied = applyOpenNow(rows.map(r => ({ ...r, distance_mi: 1 })), { openNow: false, now: at });
  ok(applied.unconfirmed === 1, 'the one map-hours row is counted as unconfirmed', applied.unconfirmed);

  // Distance, then id. Paid placement takes the front, and only a few slots.
  const ordered = orderCandidates([
    { id: 9, distance_mi: 2, is_featured: 0 }, { id: 8, distance_mi: 1, is_featured: 0 },
    { id: 7, distance_mi: 1, is_featured: 0 }, { id: 6, distance_mi: 40, is_featured: 1 },
  ]);
  ok(ordered.map(r => r.id).join(',') === '6,7,8,9', 'a partner shop leads, the rest are nearest first', ordered.map(r => r.id));
  const plain = orderCandidates([{ id: 9, distance_mi: 1, is_featured: 0 }, { id: 7, distance_mi: 1, is_featured: 0 }]);
  ok(plain.map(r => r.id).join(',') === '7,9', 'two shops at one address are broken by id, never at random');

  // The radius is capped, not truncated.
  ok(readLocation({ lat: '40.75', lng: '-73.98', radius: '500' }).radiusMi === 100, '500 miles is answered as 100');
  ok(readLocation({ lat: '40.75', lng: '-73.98' }).radiusMi === 50, '50 miles is still the default');
  ok(readLocation({ q: 'cigar' }) === null, 'no pin, no place search');

  console.log(`recallMonitor self-test: ${pass} passed, ${fail} failed`);
  return fail === 0;
}

module.exports = { run, truthRows, truthInside, allPages, METROS, RADII, FILTERS, selfTest };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const arg = name => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : null; };
  if (argv[0] === 'selftest') process.exit(selfTest() ? 0 : 1);
  (async () => {
    const report = await run({ quick: argv.includes('--quick'), out: arg('--out') });
    process.exit(report.failures.length ? 1 : 0);
  })().catch(err => { console.error(err); process.exit(1); });
}
