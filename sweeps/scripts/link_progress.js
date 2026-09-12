const db = require('../../server/src/database/db');
(async () => {
  const r = await db.get(`SELECT
    COUNT(*) FILTER (WHERE website_checked_at > NOW() - INTERVAL '12 minutes')::int AS fresh,
    COUNT(*)::int AS total FROM stores WHERE visible = 1 AND website IS NOT NULL AND website <> ''`);
  console.log(`${r.fresh} of ${r.total} checked in the last twelve minutes`);
  const s = await db.all(`SELECT id, name, website, website_status, website_final_url
    FROM stores WHERE website ILIKE '%samhill%' OR website ILIKE '%puffnstuff%' OR website ILIKE '%havanaonhudson%'`);
  for (const x of s) console.log(`#${x.id} ${x.name} ${x.website} -> ${x.website_status} ${x.website_final_url || ''}`);
  process.exit(0);
})();
