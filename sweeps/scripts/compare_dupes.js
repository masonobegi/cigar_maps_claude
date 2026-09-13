/** Side by side, so the better record is kept and the other hidden as a duplicate. */
'use strict';
const db = require('../../server/src/database/db');
(async () => {
  const ids = [22080, 22082, 2827, 42345, 3979, 3980];
  const rows = await db.all(`SELECT id, name, address, city, state, zip, phone, website, lat, lng,
      hours, hours_source, has_lounge, has_walk_in_humidor, web_image_url, source, source_name,
      confidence, created_at, storefront, visible,
      (SELECT COUNT(*)::int FROM inventory i WHERE i.store_id = stores.id) AS items,
      (SELECT COUNT(*)::int FROM store_ratings r WHERE r.store_id = stores.id) AS ratings
    FROM stores WHERE id = ANY(?) ORDER BY id`, [ids]);
  for (const r of rows) {
    console.log(`#${r.id}  ${r.name}`);
    console.log(`   ${r.address}, ${r.city}, ${r.state} ${r.zip || ''}   ${r.phone || '-'}`);
    console.log(`   site=${r.website || '-'}  pin=${r.lat},${r.lng}`);
    console.log(`   hours=${r.hours ? `${r.hours_source} ${String(r.hours).slice(0,54)}` : 'none'}`);
    console.log(`   lounge=${r.has_lounge} humidor=${r.has_walk_in_humidor} image=${r.web_image_url ? 'yes' : 'no'} items=${r.items} ratings=${r.ratings}`);
    console.log(`   source=${r.source}/${r.source_name || '-'} conf=${r.confidence} created=${String(r.created_at).slice(0,10)} visible=${r.visible}\n`);
  }
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
