const db = require('../../server/src/database/db');
const ids = (process.env.IDS || '').split(',').map(Number).filter(Boolean);
(async () => {
  for (const id of ids) {
    const s = await db.get(`SELECT id, name, address, city, state, zip, phone, website, lat, lng, timezone,
      visible, storefront, storefront_reason, source, claimed, staff_edited, confidence FROM stores WHERE id = ?`, [id]);
    console.log(JSON.stringify(s, null, 1));
  }
  process.exit(0);
})();
