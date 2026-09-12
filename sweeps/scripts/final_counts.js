const db = require('../../server/src/database/db');
(async () => {
  const n = await db.get(`SELECT
    COUNT(*) FILTER (WHERE visible = 1)::int AS public,
    COUNT(*) FILTER (WHERE visible = 1 AND hours IS NOT NULL)::int AS hours,
    COUNT(*) FILTER (WHERE visible = 1 AND hours_source = 'website')::int AS hours_site,
    COUNT(*) FILTER (WHERE visible = 1 AND web_image_url IS NOT NULL)::int AS thumbs,
    COUNT(*) FILTER (WHERE visible = 1 AND has_lounge = 1)::int AS lounge,
    COUNT(*) FILTER (WHERE visible = 1 AND has_walk_in_humidor = 1)::int AS humidor,
    COUNT(*) FILTER (WHERE visible = 1 AND last_verified_at IS NOT NULL)::int AS verified,
    COUNT(*) FILTER (WHERE visible = 0)::int AS hidden
    FROM stores`);
  console.log(JSON.stringify(n, null, 1));
  const links = await db.all(`SELECT COALESCE(website_status,'(none)') AS s, COUNT(*)::int AS n FROM stores
    WHERE visible = 1 AND website IS NOT NULL AND website <> '' GROUP BY 1 ORDER BY 2 DESC`);
  console.log(links.map(r => `${r.s} ${r.n}`).join(', '));
  process.exit(0);
})();
