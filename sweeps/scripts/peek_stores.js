// Print a few listings by id: node ... peek_stores.js 3889,16701
const db = require('../../server/src/database/db');
const ids = (process.env.IDS || '').split(',').map(Number).filter(Boolean);
(async () => {
  for (const id of ids) {
    const s = await db.get(`SELECT id, name, city, state, website, hours, hours_source, hours_checked_at,
      visible, claimed, staff_edited FROM stores WHERE id = ?`, [id]);
    console.log(s ? `#${s.id} ${s.name} (${s.city}, ${s.state}) src=${s.hours_source} checked=${s.hours_checked_at}\n   ${s.hours}` : `#${id} gone`);
  }
  process.exit(0);
})();
