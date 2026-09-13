/** Look a shop up by name across the whole table, visible or not. */
'use strict';
const db = require('../../server/src/database/db');
(async () => {
  const q = process.env.Q || 'paul';
  const rows = await db.all(`
    SELECT id, name, address, city, state, zip, phone, website, visible, storefront,
           storefront_reason, claimed, staff_edited, source
    FROM stores WHERE name ILIKE ? ORDER BY state, city, name`, [`%${q}%`]);
  console.log(`${rows.length} rows matching "${q}"\n`);
  for (const r of rows) {
    console.log(`  #${r.id} ${r.name}`);
    console.log(`      ${r.address}, ${r.city}, ${r.state} ${r.zip || ''}  ${r.phone || ''}`);
    console.log(`      visible=${r.visible} storefront=${r.storefront || '-'} ${r.storefront_reason ? `(${String(r.storefront_reason).slice(0,90)})` : ''}`);
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
