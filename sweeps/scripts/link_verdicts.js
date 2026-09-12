const db = require('../../server/src/database/db');
(async () => {
  const rows = await db.all(`SELECT id, name, city, state, website, website_status, website_final_url
    FROM stores WHERE visible = 1 AND website_status IN ('elsewhere','hijacked','store_unavailable','parked')
    ORDER BY website_status, id`);
  for (const r of rows) console.log(`[${r.website_status}] #${r.id} ${r.name} (${r.city}, ${r.state})\n    ${r.website}  ->  ${r.website_final_url || '(same)'}`);
  console.log(`${rows.length} rows`);
  process.exit(0);
})();
