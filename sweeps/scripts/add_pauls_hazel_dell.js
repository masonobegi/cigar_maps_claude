/**
 * Paul's Cigars, Hazel Dell — a shop the directory never had.
 *
 * Reported missing by somebody local. Paul's runs two shops in Vancouver WA and
 * we held exactly one of them: Mill Plain (#10234) was public, Hazel Dell was
 * not in the table at all, under any name.
 *
 * Everything below is first-hand, from paulscigars.net's own locations page:
 *
 *   Hazel Dell   1218 NE 88th St, Suite 114, Vancouver WA 98665  (360) 777-4075
 *   Mill Plain   11516 SE Mill Plain Blvd, Vancouver WA 98684    (360) 885-3838
 *   both         Monday-Saturday: 10am-6pm, Sunday: Closed
 *
 * Two other rows called "Paul's Cigars" exist — Beaverton OR and Hayden Island
 * Portland — and appear on no page of the company's own site. They are already
 * hidden and are left alone; they are most likely former locations, which is
 * the sweep's problem, not this script's.
 *
 * The pin is where two independent geocoders agree, which is the standard the
 * rest of the pins are held to: Census put 1218 NE 88TH ST at
 * 45.685933,-122.660164 and Nominatim put the same building at
 * 45.686535,-122.659352 — about 70 metres apart, in a multi-tenant strip
 * (Nominatim names Wash World and Domino's there), which is what "Suite 114"
 * implies. The Census figure is used, being the address-level match.
 *
 * staff_edited = 1 matters and is not decoration. importStores.js recomputes
 * `visible` from the classifier on every boot, and only honours a row a human
 * ruled on or one whose storefront verdict is in its ruledOut list. Without it
 * this shop would be re-judged by a classifier on the next deploy, and a shop
 * we added by hand because it was missing could go missing again.
 *
 *   DRY=1 railway run --service Postgres node sweeps/scripts/prod.js <abs path>
 *         railway run --service Postgres node sweeps/scripts/prod.js <abs path>
 */
'use strict';

const db = require('../../server/src/database/db');

const DRY = process.env.DRY === '1';

const SHOP = {
  name: "Paul's Cigars",
  address: '1218 NE 88th St Ste 114',
  city: 'Vancouver',
  state: 'WA',
  zip: '98665',
  phone: '(360) 777-4075',
  website: 'paulscigars.net',
  lat: 45.685933,
  lng: -122.660164,
  hours: {
    Mon: '10am-6pm', Tue: '10am-6pm', Wed: '10am-6pm', Thu: '10am-6pm',
    Fri: '10am-6pm', Sat: '10am-6pm', Sun: 'Closed',
  },
};

(async () => {
  // Two ways in, because the same shop arriving twice is the failure this
  // directory has spent the most time undoing.
  const dupe = await db.get(
    `SELECT id, name, address, city, state, visible FROM stores
      WHERE (phone = ? OR (LOWER(name) = LOWER(?) AND zip = ?))`,
    [SHOP.phone, SHOP.name, SHOP.zip]);
  if (dupe) {
    console.log(`already present as #${dupe.id} ${dupe.name}, ${dupe.address}, ${dupe.city} ${dupe.state} (visible=${dupe.visible})`);
    console.log('nothing to do');
    process.exit(0);
  }

  const sibling = await db.get('SELECT id, name, visible, storefront FROM stores WHERE phone = ?', ['(360) 885-3838']);
  console.log(`sibling shop: ${sibling ? `#${sibling.id} ${sibling.name} (visible=${sibling.visible}, storefront=${sibling.storefront})` : 'not found'}`);

  console.log(`\n${DRY ? 'would add' : 'adding'}: ${SHOP.name} — ${SHOP.address}, ${SHOP.city}, ${SHOP.state} ${SHOP.zip}`);
  console.log(`  phone ${SHOP.phone}   site ${SHOP.website}`);
  console.log(`  pin   ${SHOP.lat}, ${SHOP.lng}`);
  console.log(`  hours ${JSON.stringify(SHOP.hours)}`);
  if (DRY) process.exit(0);

  const row = await db.get(
    `INSERT INTO stores
       (name, address, city, state, zip, phone, website, lat, lng,
        hours, hours_source, hours_checked_at,
        store_type, source, source_name, confidence, visible,
        storefront, storefront_reason, storefront_checked_at,
        staff_edited, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'website', NOW(),
             'cigar_shop', 'manual', ?, 1, 1,
             'yes', ?, NOW(), 1, NOW())
     RETURNING id`,
    [SHOP.name, SHOP.address, SHOP.city, SHOP.state, SHOP.zip, SHOP.phone, SHOP.website,
      SHOP.lat, SHOP.lng, JSON.stringify(SHOP.hours), SHOP.name,
      "added by hand: reported missing, confirmed against paulscigars.net's own locations page"]);

  console.log(`\nadded as #${row.id}`);
  const check = await db.get(
    `SELECT id, name, address, city, state, visible, storefront, staff_edited, hours_source
       FROM stores WHERE id = ?`, [row.id]);
  console.log(`  ${JSON.stringify(check)}`);

  const both = await db.all(
    `SELECT id, name, address, city, visible FROM stores
      WHERE website ILIKE '%paulscigars%' OR phone IN (?, ?) ORDER BY id`,
    [SHOP.phone, '(360) 885-3838']);
  console.log(`\nboth Vancouver shops now:`);
  for (const b of both) console.log(`  #${b.id} ${b.name} — ${b.address}, ${b.city} (visible=${b.visible})`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
