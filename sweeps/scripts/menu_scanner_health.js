/**
 * The menu scanner's first real day, read off production.
 *
 * Its back-off and staleness ordering were proved against a 30-day replay and
 * never against the live table. Three things a model cannot show: whether every
 * shop is actually being reached, whether failures are backing off rather than
 * retrying in a tight loop, and whether the inventory double-insert this table
 * has no unique key to prevent has happened.
 */
'use strict';
const db = require('../../server/src/database/db');

(async () => {
  const cols = await db.all(`SELECT column_name FROM information_schema.columns
    WHERE table_name = 'stores' AND column_name LIKE 'menu%'`);
  console.log(`menu columns: ${cols.map(c => c.column_name).join(', ') || '(none)'}\n`);

  const s = await db.get(`SELECT
      COUNT(*) FILTER (WHERE visible = 1)::int AS public,
      COUNT(*) FILTER (WHERE visible = 1 AND menu_checked_at IS NOT NULL)::int AS ever_checked,
      COUNT(*) FILTER (WHERE visible = 1 AND menu_checked_at > NOW() - INTERVAL '24 hours')::int AS last_24h,
      COUNT(*) FILTER (WHERE visible = 1 AND COALESCE(menu_fail_count,0) > 0)::int AS failing,
      COUNT(*) FILTER (WHERE visible = 1 AND COALESCE(menu_fail_count,0) >= 5)::int AS backed_off,
      MIN(menu_checked_at) AS oldest, MAX(menu_checked_at) AS newest
    FROM stores`).catch(e => ({ err: e.message }));
  if (s.err) { console.log(`could not read: ${s.err}`); process.exit(0); }

  console.log(`public listings          ${s.public}`);
  console.log(`  ever scanned           ${s.ever_checked}`);
  console.log(`  scanned in last 24h    ${s.last_24h}`);
  console.log(`  with failures          ${s.failing}`);
  console.log(`  backed off (>=5 fails) ${s.backed_off}`);
  console.log(`  oldest check           ${s.oldest || '-'}`);
  console.log(`  newest check           ${s.newest || '-'}`);

  // The failure mode this table cannot prevent by itself: inventory has no
  // unique key on (store_id, source, external_id), so two syncers racing
  // double-insert. If it has happened, it is visible as duplicate rows.
  const dupes = await db.all(`SELECT store_id, source, external_id, COUNT(*)::int AS n
      FROM inventory WHERE external_id IS NOT NULL
      GROUP BY store_id, source, external_id HAVING COUNT(*) > 1
      ORDER BY COUNT(*) DESC LIMIT 10`).catch(() => []);
  console.log(`\nduplicate inventory rows: ${dupes.length ? `${dupes.length} groups` : 'none'}`);
  for (const d of dupes) console.log(`  store ${d.store_id} ${d.source} ${String(d.external_id).slice(0, 28)} x${d.n}`);

  const inv = await db.get(`SELECT COUNT(*)::int AS rows, COUNT(DISTINCT store_id)::int AS stores FROM inventory`);
  console.log(`\ninventory: ${inv.rows} rows across ${inv.stores} shops`);
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
