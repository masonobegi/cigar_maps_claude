const db = require('../../server/src/database/db');
(async () => {
  const n = await db.get(`SELECT
    COUNT(*) FILTER (WHERE visible = 1)::int AS public,
    COUNT(*) FILTER (WHERE visible = 1 AND claimed = 1)::int AS claimed,
    COUNT(*) FILTER (WHERE visible = 1 AND phone IS NOT NULL AND phone <> '')::int AS with_phone,
    COUNT(*) FILTER (WHERE visible = 1 AND website_status IN ('ok','blocked'))::int AS live_site,
    COUNT(*) FILTER (WHERE visible = 1 AND hours IS NOT NULL)::int AS with_hours
    FROM stores`);
  console.log(JSON.stringify(n));
  const users = await db.get('SELECT COUNT(*)::int AS n FROM users').catch(() => ({ n: '?' }));
  const claims = await db.all('SELECT status, COUNT(*)::int AS n FROM store_claims GROUP BY status').catch(() => []);
  const reviews = await db.get('SELECT COUNT(*)::int AS n FROM store_ratings').catch(() => ({ n: '?' }));
  const inv = await db.get('SELECT COUNT(*)::int AS n, COUNT(DISTINCT store_id)::int AS shops FROM inventory').catch(() => ({}));
  console.log('users', users.n, '| claims', JSON.stringify(claims), '| ratings', reviews.n, '| inventory rows', inv.n, 'across', inv.shops, 'shops');
  const top = await db.all(`SELECT state, COUNT(*)::int AS n FROM stores WHERE visible = 1 GROUP BY state ORDER BY n DESC LIMIT 12`);
  console.log('top states: ' + top.map(r => `${r.state} ${r.n}`).join(', '));
  const cities = await db.all(`SELECT city, state, COUNT(*)::int AS n FROM stores WHERE visible = 1 GROUP BY city, state ORDER BY n DESC LIMIT 12`);
  console.log('top cities: ' + cities.map(r => `${r.city}, ${r.state} ${r.n}`).join('; '));
  process.exit(0);
})();
