// One verdict a person made by hand, with the reason recorded.
const db = require('../../server/src/database/db');
(async () => {
  const r = await db.run(`UPDATE stores SET website_status = 'elsewhere', website_checked_at = NOW()
    WHERE id = 9499 AND website_status = 'ok'`);
  console.log(`#9499 Cigar Express: ${r.changes} row set to elsewhere ` +
    '(cigarexpress.com now lands on klafters.com, a jeweller; the checker kept the link because the word "express" appears on that page)');
  process.exit(0);
})();
