/**
 * Re-check the listings the sweep called 'elsewhere'.
 *
 * The sweep ran before namesShop learned that a shop moving to a longer
 * spelling of its own domain (ejcigars.com -> eandjcigars.com) is still the
 * same shop, so some of those verdicts took a working link off a real shop.
 */
const db = require('../../server/src/database/db');
const { checkStore } = require('../../server/src/jobs/linkCheck');
(async () => {
  const rows = await db.all(`SELECT id FROM stores WHERE visible = 1 AND website_status = ?`,
    [process.env.STATUS || 'elsewhere']);
  console.log(`${rows.length} to re-check`);
  let changed = 0;
  for (const r of rows) {
    const res = await checkStore(r.id, { log: () => {} });
    if (res.status !== (process.env.STATUS || 'elsewhere')) { changed++; console.log(`  #${r.id} ${res.name} -> ${res.status}  ${res.final_url || ''}`); }
  }
  console.log(`${changed} changed verdict`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
