// Read-only snapshot of everything a store record shows, for the data audit.
const fs = require('fs');
const db = require('C:/Users/mason/OneDrive/Desktop/cigarApp/server/src/database/db');
const OUT = 'C:/Users/mason/AppData/Local/Temp/claude/c--Users-mason-OneDrive-Desktop-cigarApp/a956c8ab-bec6-4085-b83b-7fcd97853bc4/scratchpad/audit';
const clip = (v, n) => (typeof v === 'string' && v.length > n ? (v.startsWith('data:') ? `data-uri(${v.length} chars)` : v.slice(0, n) + '…') : v);
module.exports = (async () => {
  const stores = await db.all(`SELECT * FROM stores ORDER BY id`);
  for (const s of stores) {
    for (const k of ['stripe_customer_id', 'stripe_subscription_id']) delete s[k];
    for (const k of Object.keys(s)) s[k] = clip(s[k], k === 'description' ? 400 : 600);
  }
  fs.writeFileSync(`${OUT}/stores.json`, JSON.stringify(stores));
  const inv = await db.all(`
    SELECT i.store_id, COUNT(*)::int AS rows, COUNT(DISTINCT i.cigar_id)::int AS lines,
      COUNT(DISTINCT c.brand)::int AS brands, SUM(CASE WHEN i.in_stock = 1 THEN 1 ELSE 0 END)::int AS in_stock,
      MIN(i.price) AS min_price, MAX(i.price) AS max_price,
      MAX(i.updated_at) AS last_updated, MAX(i.last_confirmed_at) AS last_confirmed,
      STRING_AGG(DISTINCT COALESCE(i.source, 'none'), ',') AS sources,
      SUM(CASE WHEN c.source = 'retired' THEN 1 ELSE 0 END)::int AS on_retired_lines
    FROM inventory i JOIN cigars c ON c.id = i.cigar_id GROUP BY i.store_id`);
  fs.writeFileSync(`${OUT}/inventory_by_store.json`, JSON.stringify(inv));
  const reports = await db.all(`SELECT id, store_id, reason, LEFT(details, 300) AS details, status, created_at FROM store_reports ORDER BY id`);
  fs.writeFileSync(`${OUT}/store_reports.json`, JSON.stringify(reports));
  const claims = await db.all(`SELECT id, store_id, method, status, created_at, reviewed_at FROM store_claims ORDER BY id`);
  fs.writeFileSync(`${OUT}/store_claims.json`, JSON.stringify(claims));
  const ratings = await db.all(`SELECT store_id, COUNT(*)::int AS n, AVG(rating)::float AS avg FROM store_ratings GROUP BY store_id`);
  fs.writeFileSync(`${OUT}/store_ratings.json`, JSON.stringify(ratings));
  const views = await db.all(`SELECT store_id, COUNT(*)::int AS views, MAX(viewed_at) AS last_view FROM store_views GROUP BY store_id`);
  fs.writeFileSync(`${OUT}/store_views.json`, JSON.stringify(views));
  const extra = {};
  for (const t of ['deals', 'store_events', 'store_follows', 'inventory_requests']) {
    try { extra[t] = await db.all(`SELECT store_id, COUNT(*)::int AS n FROM ${t} GROUP BY store_id`); } catch (e) { extra[t] = `error: ${e.message}`; }
  }
  fs.writeFileSync(`${OUT}/store_activity.json`, JSON.stringify(extra));
  const cols = Object.keys(stores[0] || {});
  const pub = stores.filter(s => s.visible === 1).length;
  console.log(`stores ${stores.length} (${pub} public), columns ${cols.length}; inventory for ${inv.length} stores; reports ${reports.length}; claims ${claims.length}; rated ${ratings.length}; viewed ${views.length}`);
  process.exit(0);
})();
