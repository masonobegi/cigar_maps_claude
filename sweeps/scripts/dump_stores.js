const db = require('C:/Users/mason/OneDrive/Desktop/cigarApp/server/src/database/db');
const fs = require('fs');
module.exports = (async () => {
  const rows = await db.all(`SELECT id, name, address, city, state, zip, phone, website, website_status, claimed, staff_edited,
      hours, hours_source, logo_url, cover_url, web_image_url, timezone, visible, lat, lng
    FROM stores WHERE visible = 1`);
  fs.writeFileSync('C:/Users/mason/AppData/Local/Temp/claude/c--Users-mason-OneDrive-Desktop-cigarApp/a956c8ab-bec6-4085-b83b-7fcd97853bc4/scratchpad/stores_snapshot.json', JSON.stringify(rows));
  console.log('dumped', rows.length, 'public listings;', rows.filter(r => r.website).length, 'with a website');
  process.exit(0);
})();
