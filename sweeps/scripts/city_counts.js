const db = require('../../server/src/database/db');
(async () => {
  const rows = await db.all(`SELECT city, state, COUNT(*)::int AS n FROM stores
    WHERE visible = 1 AND city IS NOT NULL AND city <> '' AND state IS NOT NULL
    GROUP BY city, state ORDER BY n DESC`);
  const states = await db.all(`SELECT state, COUNT(*)::int AS n FROM stores WHERE visible = 1 AND state IS NOT NULL GROUP BY state ORDER BY n DESC`);
  console.log(`${rows.length} city pages, ${states.length} state pages`);
  console.log('cities with 1 shop: ' + rows.filter(r => r.n === 1).length
    + ', with 2-4: ' + rows.filter(r => r.n >= 2 && r.n <= 4).length
    + ', with 5+: ' + rows.filter(r => r.n >= 5).length);
  console.log('top: ' + rows.slice(0, 12).map(r => `${r.city}, ${r.state} (${r.n})`).join('; '));
  const odd = rows.filter(r => /[^A-Za-z0-9 .'-]/.test(r.city)).slice(0, 6);
  console.log('names with unusual characters: ' + (odd.map(r => r.city).join(' | ') || 'none'));
  process.exit(0);
})();
