/** Did the sweep land where it should, and did it leave anything it should not? */
'use strict';
const db = require('../../server/src/database/db');
(async () => {
  const n = await db.get(`SELECT
    COUNT(*) FILTER (WHERE visible=1)::int AS public,
    COUNT(*) FILTER (WHERE visible=1 AND open_verdict='open')::int AS public_proven,
    COUNT(*) FILTER (WHERE visible=1 AND open_verdict IS NULL)::int AS public_unproven,
    COUNT(*) FILTER (WHERE open_verdict IS NOT NULL)::int AS stamped
    FROM stores`);
  console.log(`public ${n.public}, of which ${n.public_proven} carry open_verdict='open'`);
  console.log(`public with NO verdict: ${n.public_unproven}   (expect 1 staff-edited + 1 added by hand)`);
  console.log(`stamped in total: ${n.stamped}`);

  for (const id of [10184, 13340, 1949, 42345, 22080, 42931]) {
    const r = await db.get('SELECT id,name,visible,storefront,open_verdict,LEFT(storefront_reason,58) AS why FROM stores WHERE id=?', [id]);
    if (r) console.log(`  #${String(r.id).padEnd(6)} ${String(r.name).slice(0,28).padEnd(28)} visible=${r.visible} ${String(r.storefront).padEnd(11)} ${r.why||''}`);
  }
  const lost = await db.get(`SELECT COUNT(*)::int AS n FROM stores WHERE visible=1 AND storefront IN ('closed','not_retail','unproven','duplicate')`);
  console.log(`\ncontradictions (public but ruled out): ${lost.n}   must be 0`);
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
