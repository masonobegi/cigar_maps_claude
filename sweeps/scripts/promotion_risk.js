/**
 * Would verifiedSet publish anything tonight that nobody has researched?
 *
 * The open/closed sweep researched the 672 listings that were public. Anything
 * it promotes from the held pile is, by definition, a listing that has been
 * through none of that — and it would appear on the map the day after a sweep
 * whose whole point was that unproven listings come off.
 */
'use strict';
const db = require('../../server/src/database/db');

(async () => {
  const rows = await db.all(`
    SELECT id, name, city, state, visible, storefront, website_status, hours_source,
           address_backed_by, claimed, staff_edited
    FROM stores
    WHERE visible = 0 AND storefront = 'unverified'
      AND COALESCE(claimed,0) = 0 AND COALESCE(staff_edited,0) = 0`);
  console.log(`${rows.length} listings are held by verifiedSet and could in principle be promoted\n`);

  const ready = rows.filter(r =>
    (r.website_status === 'ok' || r.website_status === 'blocked')
    && r.hours_source === 'website'
    && r.address_backed_by);
  console.log(`of those, ${ready.length} currently meet all four gates and WOULD be published on the next run:`);
  for (const r of ready.slice(0, 20)) {
    console.log(`  #${String(r.id).padEnd(6)} ${String(r.name).slice(0, 32).padEnd(32)} ${r.city}, ${r.state}  backed_by=${r.address_backed_by}`);
  }

  const byBacking = {};
  for (const r of ready) byBacking[r.address_backed_by] = (byBacking[r.address_backed_by] || 0) + 1;
  console.log(`\n  by what backs the address: ${JSON.stringify(byBacking)}`);

  // Did today's licence apply reach anything hidden? It should not have: the
  // match query only looks at visible = 1.
  const licHidden = await db.get(`SELECT COUNT(*)::int AS n FROM stores
    WHERE visible = 0 AND address_backed_by = 'licence'`);
  console.log(`\nhidden listings whose address is backed by a licence: ${licHidden.n}`);
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
