// What we hold for the shops with no email address found.
const db = require('../../server/src/database/db');
(async () => {
  const rows = await db.all(`
    SELECT s.id, s.name, s.website, s.phone, o.email, o.candidates
    FROM stores s LEFT JOIN store_outreach o ON o.store_id = s.id
    WHERE s.visible = 1`);
  const withEmail = rows.filter(r => r.email);
  const without = rows.filter(r => !r.email);
  console.log(`${rows.length} public shops: ${withEmail.length} with an email, ${without.length} without`);
  console.log(`of those without: ${without.filter(r => r.phone).length} have a phone, ${without.filter(r => r.website).length} have a website`);
  const social = rows.filter(r => /facebook|instagram|linktr/i.test(String(r.website || '')));
  console.log(`shops whose "website" is actually a social page: ${social.length}`);
  console.log('\nexamples with no email yet:');
  for (const r of without.slice(0, 8)) console.log(`   #${r.id} ${String(r.name).slice(0, 30).padEnd(32)} ${r.website || 'no site'}  ${r.phone || ''}`);
  process.exit(0);
})();
