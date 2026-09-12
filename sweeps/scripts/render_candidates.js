/**
 * Who a browser pass could actually help.
 *
 * A listing held back for want of hours, whose site is alive and whose address
 * is backed, is one readable page away from being public. If that page draws
 * its hours with JavaScript — Wix, GoDaddy, Square, a booking widget — the
 * plain reader saw nothing and a browser would see everything.
 */
const fs = require('fs');
const path = require('path');
const db = require('../../server/src/database/db');

(async () => {
  const held = await db.all(`
    SELECT id, name, city, state, website, website_status, address_backed_by, storefront_reason
    FROM stores
    WHERE visible = 0 AND storefront = 'unverified'
      AND website IS NOT NULL AND website <> ''
      AND website_status IN ('ok', 'blocked')
      AND address_backed_by IS NOT NULL
      AND (hours IS NULL OR hours_source IS DISTINCT FROM 'website')
    ORDER BY id`);

  const thin = await db.all(`
    SELECT id, name, city, state, website FROM stores
    WHERE visible = 1 AND website IS NOT NULL AND website <> ''
      AND website_status IN ('ok', 'blocked') ORDER BY id`);

  console.log(`held back, one readable page from public: ${held.length}`);
  const byHost = {};
  for (const h of held) {
    const m = String(h.website).match(/(wix|squarespace|godaddy|square|weebly|shopify|wordpress|duda|bigcommerce)/i);
    const k = m ? m[1].toLowerCase() : 'their own domain';
    byHost[k] = (byHost[k] || 0) + 1;
  }
  console.log('  by builder in the URL: ' + Object.entries(byHost).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', '));
  for (const h of held.slice(0, 10)) console.log(`   #${String(h.id).padEnd(6)}${String(h.name).slice(0, 30).padEnd(32)}${h.website}`);

  const out = path.join(__dirname, '..', 'decisions', 'render_queue.json');
  // hoursRender reads a skips file: [{ id, skip }], keeping only the retryable reasons.
  fs.writeFileSync(out, JSON.stringify(held.map(h => ({ id: h.id, skip: 'no hours found' })), null, 1));
  console.log(`\nwritten to sweeps/decisions/render_queue.json (${held.length} listings)`);
  console.log(`public listings with a live site, for reference: ${thin.length}`);
  process.exit(0);
})();
