/**
 * "Before": replay the OLD GET /api/stores behaviour (SQL order by placement,
 * feed size and confidence, LIMIT 300, then the radius cut and distance sort in
 * JS) against the snapshot database, and compare it with the same brute-force
 * truth set the recall monitor uses.
 *
 * Read-only. Run with PGLITE_DIR pointing at a copy of the snapshot.
 */
'use strict';

const SERVER = 'C:/Users/mason/OneDrive/Desktop/cigarApp/.claude/worktrees/wf_0c894a48-04e-4/server/src';
const db = require(SERVER + '/database/db');
const { openStatus, timeZoneFor } = require(SERVER + '/utils/storeHours');
const { buildFilters, haversine } = require(SERVER + '/utils/storeSearch');
const M = require(SERVER + '/jobs/recallMonitor');

async function oldQuery(filter, lat, lng, radiusMi, now) {
  const { where, params } = buildFilters(filter);
  const dLat = radiusMi / 69;
  const dLng = radiusMi / (69 * Math.max(0.2, Math.cos(lat * Math.PI / 180)));
  where.push('s.lat BETWEEN ? AND ? AND s.lng BETWEEN ? AND ?');
  params.push(lat - dLat, lat + dLat, lng - dLng, lng + dLng);

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
    ORDER BY is_featured DESC, s.claimed DESC, s.verified DESC, follower_count DESC, inventory_count DESC, s.confidence DESC, s.name
    LIMIT 300
  `, params);

  let kept = rows;
  if (filter.open_now === '1') {
    kept = kept.filter(s => openStatus(s.hours, s.timezone || timeZoneFor(s.state, s.lat, s.lng), now).isOpen === true);
  }
  return kept
    .map(s => ({ id: s.id, d: Math.round(haversine(lat, lng, Number(s.lat), Number(s.lng)) * 10) / 10 }))
    .filter(x => x.d <= radiusMi)
    .sort((a, b) => a.d - b.d);
}

(async () => {
  const quick = process.argv.includes('--quick');
  const metros = quick ? M.METROS.slice(0, 8) : M.METROS;
  const now = new Date('2026-09-10T18:00:00Z');
  const out = { cases: [], byRadius: {} };
  let ret = 0, exp = 0;

  for (const [fname, fq] of M.FILTERS) {
    const rows = await M.truthRows(fq);
    for (const [mname, lat, lng] of metros) {
      for (const radius of M.RADII) {
        const want = M.truthInside(rows, lat, lng, radius, { openNow: fq.open_now === '1', now });
        // The old code judged "open now" on any hours at all, map data included.
        const got = await oldQuery({ ...fq }, lat, lng, radius, now);
        ret += got.length; exp += want.length;
        const key = `${radius}mi ${fname}`;
        out.byRadius[key] = out.byRadius[key] || { got: 0, want: 0 };
        out.byRadius[key].got += got.length;
        out.byRadius[key].want += want.length;
        if (got.length !== want.length) {
          out.cases.push({ label: `${mname} ${radius}mi ${fname}`, got: got.length, want: want.length });
        }
      }
    }
  }
  console.log(`BEFORE: recall ${(ret / exp * 100).toFixed(1)}% (${ret}/${exp}), ${out.cases.length} short cases`);
  for (const [k, v] of Object.entries(out.byRadius)) {
    if (v.got !== v.want) console.log(`  ${k}: ${v.got}/${v.want} = ${(v.got / v.want * 100).toFixed(1)}%`);
  }
  for (const c of out.cases.slice(0, 25)) console.log(`  short: ${c.label} ${c.got}/${c.want}`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
