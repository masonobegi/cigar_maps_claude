/**
 * "Before": replay the OLD GET /stores behaviour against the same database the
 * recall monitor uses, and score it the same way, so the fix is demonstrated
 * rather than asserted.
 *
 * The old route ordered by placement, feed size and classifier confidence, took
 * LIMIT 300, and only then filtered "open now", cut to the radius circle and
 * sorted by distance — all in JavaScript, over whatever 300 rows survived.
 *
 * Read-only. Run with PGLITE_DIR pointing at a database.
 *   PGLITE_DIR=/tmp/cbfixture node sweeps/scripts/before_recall.js [--quick]
 *
 * (This replaces the copy in sweeps/decisions/search-and-menus/, which pointed
 * at absolute paths on the machine that wrote it.)
 */
'use strict';

const path = require('path');
const SRV = path.join(__dirname, '..', '..', 'server', 'src');
const db = require(path.join(SRV, 'database', 'db'));
const { openStatus, timeZoneFor } = require(path.join(SRV, 'utils', 'storeHours'));
const { buildFilters, haversine, boundingBox } = require(path.join(SRV, 'utils', 'storeSearch'));
const M = require(path.join(SRV, 'jobs', 'recallMonitor'));

/** The old limit, and the old sort keys. */
const OLD_LIMIT = 300;

async function oldQuery(filter, lat, lng, radiusMi, now) {
  const { where, params } = buildFilters(filter);
  const box = boundingBox(lat, lng, radiusMi);
  where.push('s.lat BETWEEN ? AND ? AND s.lng BETWEEN ? AND ?');
  params.push(box.minLat, box.maxLat, box.minLng, box.maxLng);

  const rows = await db.all(`
    SELECT s.id, s.lat, s.lng, s.hours, s.hours_source, s.timezone, s.state,
      COUNT(DISTINCT i.id) as inventory_count,
      COUNT(DISTINCT sf.user_id) as follower_count,
      (CASE WHEN s.featured_until IS NOT NULL AND s.featured_until > NOW()
            THEN (CASE WHEN s.plan = 'partner' THEN 2 ELSE 1 END) ELSE 0 END) as is_featured
    FROM stores s
    LEFT JOIN inventory i ON i.store_id = s.id AND i.in_stock = 1
    LEFT JOIN store_follows sf ON sf.store_id = s.id
    LEFT JOIN store_ratings sr ON sr.store_id = s.id
    WHERE ${where.join(' AND ')}
    GROUP BY s.id
    ORDER BY is_featured DESC, s.claimed DESC, s.verified DESC, follower_count DESC,
             inventory_count DESC, s.confidence DESC, s.name
    LIMIT ${OLD_LIMIT}
  `, params);

  let kept = rows;
  if (filter.open_now === '1') {
    // The old code judged "open now" on any hours at all, map data included.
    kept = kept.filter(s => openStatus(s.hours, s.timezone || timeZoneFor(s.state, Number(s.lat), Number(s.lng)), now).isOpen === true);
  }
  return kept
    .filter(s => s.lat !== null && s.lng !== null)
    .map(s => ({ id: s.id, d: haversine(lat, lng, Number(s.lat), Number(s.lng)) }))
    .filter(x => x.d <= radiusMi)
    .sort((a, b) => a.d - b.d);
}

(async () => {
  const quick = process.argv.includes('--quick');
  const metros = quick ? M.METROS.slice(0, 8) : M.METROS;
  const rows = await M.truthRows(db);
  const byCase = {};
  let got = 0, want = 0, short = 0;
  const worst = [];

  for (const [fname, filter, instant] of M.FILTERS) {
    const now = instant ? new Date(instant) : new Date();
    for (const [mname, lat, lng] of metros) {
      for (const radius of M.RADII) {
        // The truth set is the honest one: it counts "open now" only where the
        // hours are confirmed, which is the rule the site publishes.
        const truth = M.truthInside(rows, filter, lat, lng, radius, { openStatus, timeZoneFor, now });
        const old = await oldQuery(filter, lat, lng, radius, now);
        const oldIds = new Set(old.map(o => o.id));
        const missing = truth.filter(t => !oldIds.has(t.id)).length;
        got += truth.length - missing; want += truth.length;
        const key = `${radius}mi ${fname}`;
        byCase[key] = byCase[key] || { got: 0, want: 0 };
        byCase[key].got += truth.length - missing;
        byCase[key].want += truth.length;
        if (missing) {
          short++;
          worst.push({ label: `${mname} ${radius}mi ${fname}`, missing, truth: truth.length });
        }
      }
    }
  }

  worst.sort((a, b) => b.missing - a.missing);
  console.log(`BEFORE: recall ${(got / want * 100).toFixed(2)}% (${got}/${want}), ${short} cases short`);
  for (const [k, v] of Object.entries(byCase)) {
    if (v.got !== v.want) console.log(`  ${k}: ${v.got}/${v.want} = ${(v.got / v.want * 100).toFixed(1)}%`);
  }
  console.log('\nworst cases:');
  for (const w of worst.slice(0, 15)) console.log(`  ${w.label}: ${w.missing} of ${w.truth} missing`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
