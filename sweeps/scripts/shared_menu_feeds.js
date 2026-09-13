/**
 * How many shops are being given another shop's catalogue?
 *
 * A chain runs one webshop. Every branch's listing points at it, so every branch
 * syncs the same feed and the directory says each one stocks all of it. The
 * inventory table then carries the same catalogue several times over, and
 * "in stock here" stops meaning in stock HERE.
 */
'use strict';
const db = require('../../server/src/database/db');
(async () => {
  const groups = await db.all(`SELECT menu_url, COUNT(*)::int AS shops,
      STRING_AGG(DISTINCT name, ' | ') AS names
    FROM stores WHERE visible = 1 AND menu_url IS NOT NULL AND menu_url <> ''
    GROUP BY menu_url HAVING COUNT(*) > 1 ORDER BY COUNT(*) DESC LIMIT 15`);
  console.log(`${groups.length} menu feeds are shared by more than one public listing\n`);
  for (const g of groups) {
    console.log(`  ${g.shops} shops  ${String(g.menu_url).slice(0, 58)}`);
    console.log(`           ${String(g.names).slice(0, 100)}`);
  }

  const tot = await db.get(`SELECT
      COUNT(*)::int AS rows,
      COUNT(DISTINCT store_id)::int AS shops
    FROM inventory`);
  const dupRows = await db.get(`
    WITH shared AS (
      SELECT menu_url FROM stores WHERE visible = 1 AND menu_url IS NOT NULL AND menu_url <> ''
      GROUP BY menu_url HAVING COUNT(*) > 1)
    SELECT COUNT(i.id)::int AS n FROM inventory i
      JOIN stores s ON s.id = i.store_id
      WHERE s.menu_url IN (SELECT menu_url FROM shared)`);
  console.log(`\ninventory rows total:            ${tot.rows} across ${tot.shops} shops`);
  console.log(`rows belonging to a shared feed: ${dupRows.n} (${Math.round(100*dupRows.n/tot.rows)}%)`);
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
