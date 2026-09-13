/**
 * Shops sharing a webshop: which are branches, and which are the same shop twice?
 *
 * A chain's branches share a feed legitimately — Anthony's has four addresses and
 * the owner has confirmed they are four real shops. But the same query turns up
 * pairs like "Zodi'X Cigar Lounge" and "ZODI'X Cigar Lounge", which is one shop
 * entered twice. The closure sweep cannot catch those: both copies are open.
 *
 * The address is what separates them, so print it and let a person read.
 */
'use strict';
const db = require('../../server/src/database/db');

/** Street number + first street word: enough to tell one door from another. */
const doorKey = a => {
  const s = String(a || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const m = /^(\d+)\s+(\w+)/.exec(s);
  return m ? `${m[1]} ${m[2]}` : s.slice(0, 14);
};

(async () => {
  const rows = await db.all(`SELECT id, name, address, city, state, zip, phone, menu_url, lat, lng
    FROM stores WHERE visible = 1 AND menu_url IS NOT NULL AND menu_url <> '' ORDER BY menu_url, name`);
  const byFeed = new Map();
  for (const r of rows) {
    if (!byFeed.has(r.menu_url)) byFeed.set(r.menu_url, []);
    byFeed.get(r.menu_url).push(r);
  }

  const dupes = [], branches = [];
  for (const [feed, group] of byFeed) {
    if (group.length < 2) continue;
    // Any two in the group at the same door, or on the same phone, are one shop.
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i], b = group[j];
        const sameDoor = doorKey(a.address) === doorKey(b.address) && (a.zip || '') === (b.zip || '');
        const samePhone = a.phone && b.phone && a.phone.replace(/\D/g, '') === b.phone.replace(/\D/g, '');
        if (sameDoor || samePhone) dupes.push({ a, b, feed, why: sameDoor ? 'same door' : 'same phone' });
      }
    }
    branches.push({ feed, n: group.length, group });
  }

  console.log(`=== SAME SHOP TWICE (${dupes.length} pairs) ===\n`);
  for (const d of dupes) {
    console.log(`  ${d.why}`);
    console.log(`    #${String(d.a.id).padEnd(6)} ${String(d.a.name).slice(0,32).padEnd(32)} ${d.a.address}, ${d.a.city} ${d.a.state} ${d.a.zip||''}  ${d.a.phone||''}`);
    console.log(`    #${String(d.b.id).padEnd(6)} ${String(d.b.name).slice(0,32).padEnd(32)} ${d.b.address}, ${d.b.city} ${d.b.state} ${d.b.zip||''}  ${d.b.phone||''}`);
  }

  console.log(`\n=== CHAINS SHARING ONE WEBSHOP (${branches.length} feeds) ===`);
  console.log(`(different doors, so real branches — but each is credited with the whole catalogue)\n`);
  for (const b of branches.sort((x, y) => y.n - x.n).slice(0, 10)) {
    console.log(`  ${b.n}x  ${String(b.feed).slice(0,52)}`);
    for (const g of b.group) console.log(`        #${String(g.id).padEnd(6)} ${String(g.name).slice(0,30).padEnd(30)} ${String(g.address||'').slice(0,32)}, ${g.city} ${g.state}`);
  }
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
