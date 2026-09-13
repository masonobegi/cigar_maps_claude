/** What the 541 "failures" actually are: a bug, or shops with no menu to read. */
'use strict';
const db = require('../../server/src/database/db');
(async () => {
  const st = await db.all(`SELECT COALESCE(menu_status,'(null)') AS status, COUNT(*)::int AS n,
      COUNT(*) FILTER (WHERE COALESCE(menu_fail_count,0) > 0)::int AS failing
    FROM stores WHERE visible = 1 GROUP BY 1 ORDER BY 2 DESC`);
  console.log('menu_status across public listings:');
  for (const r of st) console.log(`  ${String(r.status).padEnd(22)}${String(r.n).padStart(4)}   (${r.failing} with a fail count)`);

  const pl = await db.all(`SELECT COALESCE(menu_platform,'(none detected)') AS p, COUNT(*)::int AS n
    FROM stores WHERE visible = 1 GROUP BY 1 ORDER BY 2 DESC LIMIT 8`);
  console.log('\nmenu_platform:');
  for (const r of pl) console.log(`  ${String(r.p).padEnd(22)}${String(r.n).padStart(4)}`);

  const f = await db.all(`SELECT COALESCE(menu_fail_count,0) AS fails, COUNT(*)::int AS n
    FROM stores WHERE visible = 1 GROUP BY 1 ORDER BY 1`);
  console.log('\nfail counts (back-off is driven by this):');
  for (const r of f) console.log(`  ${String(r.fails).padStart(3)} fails  ${String(r.n).padStart(4)} shops`);

  const nxt = await db.get(`SELECT
      COUNT(*) FILTER (WHERE menu_next_check_at > NOW())::int AS scheduled,
      COUNT(*) FILTER (WHERE menu_next_check_at <= NOW())::int AS due,
      COUNT(*) FILTER (WHERE menu_next_check_at IS NULL)::int AS unscheduled
    FROM stores WHERE visible = 1`);
  console.log(`\nscheduling: ${nxt.scheduled} scheduled ahead, ${nxt.due} due now, ${nxt.unscheduled} unscheduled`);

  const top = await db.all(`SELECT s.name, s.menu_platform, COUNT(i.id)::int AS items
    FROM stores s JOIN inventory i ON i.store_id = s.id WHERE s.visible = 1
    GROUP BY s.id, s.name, s.menu_platform ORDER BY 3 DESC LIMIT 5`);
  console.log('\nbiggest live menus:');
  for (const r of top) console.log(`  ${String(r.name).slice(0,34).padEnd(34)} ${String(r.menu_platform||'-').padEnd(12)} ${r.items} items`);
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
