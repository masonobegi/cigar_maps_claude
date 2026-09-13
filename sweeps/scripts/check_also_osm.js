/** Do the absorbed OSM ids name rows that actually exist in production? */
'use strict';
const fs = require('fs');
const db = require('../../server/src/database/db');
(async () => {
  const ids = JSON.parse(fs.readFileSync(process.env.IDS_FILE || '/tmp/also_ids.json', 'utf8'));
  console.log(`checking ${ids.length} absorbed OSM ids\n`);
  for (const id of ids) {
    const rows = await db.all('SELECT id, name, address, city, state, visible, storefront, source, osm_id FROM stores WHERE osm_id = ?', [String(id)]);
    if (!rows.length) { console.log(`  ${id}: no row in production`); continue; }
    for (const r of rows) console.log(`  ${id}: #${r.id} ${r.name} — ${r.address}, ${r.city} ${r.state} (visible=${r.visible}, source=${r.source})`);
  }
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
