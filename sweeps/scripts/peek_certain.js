const fs = require('fs');
const path = require('path');
const db = require('../../server/src/database/db');
const rows = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'decisions', 'certain.json'), 'utf8')).rows;
(async () => {
  const step = Math.floor(rows.length / 12) || 1;
  for (let i = 0; i < rows.length; i += step) {
    const s = await db.get(`SELECT id, name, address, city, state, phone, website, website_status,
      hours, has_lounge, web_image_url FROM stores WHERE id = ?`, [rows[i].id]);
    if (!s) continue;
    console.log(`#${s.id} ${s.name} — ${s.address}, ${s.city}, ${s.state}`);
    console.log(`     ${s.website} [${s.website_status}]  ${s.phone || 'no phone'}  ${s.web_image_url ? 'has picture' : 'no picture'}${Number(s.has_lounge) === 1 ? '  LOUNGE' : ''}`);
    console.log(`     ${s.hours}`);
  }
  process.exit(0);
})();
