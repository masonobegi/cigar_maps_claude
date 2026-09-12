const db = require('../../server/src/database/db');
(async () => {
  const rows = await db.all(`SELECT COALESCE(website_status,'(never checked)') AS status, COUNT(*)::int AS n
    FROM stores WHERE visible = 1 AND website IS NOT NULL AND website <> '' GROUP BY 1 ORDER BY 2 DESC`);
  for (const r of rows) console.log(String(r.n).padStart(6), r.status);
  const t = await db.get(`SELECT COUNT(*)::int AS n FROM stores WHERE visible = 1 AND website IS NOT NULL AND website <> ''`);
  const old = await db.get(`SELECT MIN(website_checked_at) AS a, MAX(website_checked_at) AS b FROM stores WHERE visible = 1`);
  console.log(`${t.n} public listings carry a website; checked between ${old.a} and ${old.b}`);
  process.exit(0);
})();
