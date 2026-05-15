/**
 * Adds 3 fake Portland OR stores with shared + unique inventory.
 * Runs on top of the existing DB — does not wipe anything.
 * node src/database/seed_portland.js
 */
const db = require('./db');
const { initSchema } = require('./schema');
const bcrypt = require('bcryptjs');

initSchema();

const hash = bcrypt.hashSync('password123', 10);

// ── 3 fake Portland store accounts ──────────────────────────────────────────

const insertUser = db.prepare(`
  INSERT INTO users (email, password_hash, name, account_type) VALUES (?, ?, ?, 'store')
`);

const s1User = insertUser.run('pdx1@demo.com', hash, 'PDX Smoke Co.');
const s2User = insertUser.run('pdx2@demo.com', hash, 'Burnside Cigars');
const s3User = insertUser.run('pdx3@demo.com', hash, 'Alberta Street Tobacco');

// ── Stores ───────────────────────────────────────────────────────────────────

const insertStore = db.prepare(`
  INSERT INTO stores (user_id, name, description, address, city, state, zip, phone, hours, has_lounge, has_walk_in_humidor, tags, verified, setup_complete)
  VALUES (?, ?, ?, ?, 'Portland', 'OR', ?, ?, ?, ?, ?, ?, 1, 1)
`);

const hours = JSON.stringify({ Mon: '10am-8pm', Tue: '10am-8pm', Wed: '10am-8pm', Thu: '10am-9pm', Fri: '10am-10pm', Sat: '9am-10pm', Sun: '11am-7pm' });

const s1 = insertStore.run(s1User.lastInsertRowid, 'PDX Smoke Co.', 'Portland\'s go-to walk-in humidor on the east side. 500+ SKUs, weekly events, and a relaxed lounge vibe.', '1234 SE Hawthorne Blvd', '97214', '(503) 555-0101', hours, 1, 1, JSON.stringify(['Walk-in Humidor', 'Lounge', 'Events']));
const s2 = insertStore.run(s2User.lastInsertRowid, 'Burnside Cigars', 'Tucked under the Burnside Bridge. Small but curated — every stick is hand-picked by the owner.', '88 NE Burnside St', '97232', '(503) 555-0202', hours, 0, 0, JSON.stringify(['Rare Finds', 'Accessories']));
const s3 = insertStore.run(s3User.lastInsertRowid, 'Alberta Street Tobacco', 'Neighborhood shop on Alberta Arts District. Great prices, friendly staff, always something new coming in.', '2200 NE Alberta St', '97211', '(503) 555-0303', hours, 1, 0, JSON.stringify(['Lounge', 'Walk-in Humidor']));

const store1Id = s1.lastInsertRowid;
const store2Id = s2.lastInsertRowid;
const store3Id = s3.lastInsertRowid;

// ── 10 common cigars (all 3 stores carry these) ──────────────────────────────

const insertCigar = db.prepare(`
  INSERT INTO cigars (brand, name, country, wrapper, binder, filler, strength, flavor_notes, description)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertVitola = db.prepare(`
  INSERT INTO vitolas (cigar_id, name, length, ring_gauge, msrp) VALUES (?, ?, ?, ?, ?)
`);

const insertInv = db.prepare(`
  INSERT INTO inventory (store_id, cigar_id, vitola_id, price, quantity, in_stock, is_featured)
  VALUES (?, ?, ?, ?, ?, 1, ?)
`);

const commonCigars = [
  { name: 'Common Blend 1', strength: 'mild',        wrapper: 'Connecticut',       flavor_notes: ['cream', 'cedar', 'honey'] },
  { name: 'Common Blend 2', strength: 'mild-medium',  wrapper: 'Ecuador Natural',   flavor_notes: ['nuts', 'cedar', 'floral'] },
  { name: 'Common Blend 3', strength: 'medium',       wrapper: 'Cameroon',          flavor_notes: ['coffee', 'leather', 'spice'] },
  { name: 'Common Blend 4', strength: 'medium',       wrapper: 'Honduras Natural',  flavor_notes: ['cedar', 'earth', 'cream'] },
  { name: 'Common Blend 5', strength: 'medium-full',  wrapper: 'Ecuador Habano',    flavor_notes: ['pepper', 'cocoa', 'leather'] },
  { name: 'Common Blend 6', strength: 'medium-full',  wrapper: 'Nicaraguan',        flavor_notes: ['espresso', 'dark chocolate', 'earth'] },
  { name: 'Common Blend 7', strength: 'full',         wrapper: 'Broadleaf Maduro',  flavor_notes: ['chocolate', 'coffee', 'pepper'] },
  { name: 'Common Blend 8', strength: 'full',         wrapper: 'Brazilian Maduro',  flavor_notes: ['dark fruit', 'cocoa', 'leather'] },
  { name: 'Common Blend 9', strength: 'medium',       wrapper: 'Sumatra',           flavor_notes: ['nuts', 'spice', 'cedar'] },
  { name: 'Common Blend 10',strength: 'mild-medium',  wrapper: 'Colorado Claro',    flavor_notes: ['cream', 'honey', 'nuts'] },
];

const commonVitolas = [
  { name: 'Robusto',   length: 5.0, ring_gauge: 50, msrp: 11 },
  { name: 'Toro',      length: 6.0, ring_gauge: 52, msrp: 13 },
  { name: 'Churchill', length: 7.0, ring_gauge: 48, msrp: 15 },
];

for (const c of commonCigars) {
  const row = insertCigar.run(
    'House Brand', c.name, 'Nicaragua',
    c.wrapper, 'Nicaragua', 'Nicaragua',
    c.strength, JSON.stringify(c.flavor_notes),
    `A reliable everyday smoke. ${c.wrapper} wrapper, ${c.strength} body.`
  );
  const cid = row.lastInsertRowid;

  const vids = [];
  for (const v of commonVitolas) {
    const vrow = insertVitola.run(cid, v.name, v.length, v.ring_gauge, v.msrp);
    vids.push({ id: vrow.lastInsertRowid, msrp: v.msrp });
  }

  // All 3 stores carry every common cigar in all 3 sizes
  for (const storeId of [store1Id, store2Id, store3Id]) {
    for (const v of vids) {
      const price = +(v.msrp * (0.95 + Math.random() * 0.15)).toFixed(2);
      const qty = Math.floor(Math.random() * 20) + 8;
      insertInv.run(storeId, cid, v.id, price, qty, 0);
    }
  }
}

// ── Unique cigars per store (3 each, only at that store) ─────────────────────

const storeUniques = [
  {
    storeId: store1Id,
    storeName: 'PDX Smoke Co.',
    cigars: [
      { name: 'PDX Reserve 1', strength: 'medium',      wrapper: 'Costa Rican',   flavor_notes: ['cedar', 'cream', 'citrus'] },
      { name: 'PDX Reserve 2', strength: 'medium-full', wrapper: 'Ecuador Rosado',flavor_notes: ['spice', 'leather', 'nuts'] },
      { name: 'PDX Reserve 3', strength: 'full',        wrapper: 'Oscuro',        flavor_notes: ['dark chocolate', 'earth', 'pepper'] },
    ],
  },
  {
    storeId: store2Id,
    storeName: 'Burnside Cigars',
    cigars: [
      { name: 'Burnside Select 1', strength: 'mild',        wrapper: 'Candela',        flavor_notes: ['grass', 'cream', 'floral'] },
      { name: 'Burnside Select 2', strength: 'medium',      wrapper: 'Dominican',      flavor_notes: ['cedar', 'coffee', 'leather'] },
      { name: 'Burnside Select 3', strength: 'full',        wrapper: 'Connecticut Broadleaf', flavor_notes: ['cocoa', 'espresso', 'dark fruit'] },
    ],
  },
  {
    storeId: store3Id,
    storeName: 'Alberta Street Tobacco',
    cigars: [
      { name: 'Alberta Single 1', strength: 'mild-medium', wrapper: 'Claro',         flavor_notes: ['honey', 'nuts', 'cedar'] },
      { name: 'Alberta Single 2', strength: 'medium-full', wrapper: 'Corojo',        flavor_notes: ['pepper', 'leather', 'earth'] },
      { name: 'Alberta Single 3', strength: 'full',        wrapper: 'Double Maduro', flavor_notes: ['molasses', 'chocolate', 'coffee'] },
    ],
  },
];

for (const { storeId, cigars } of storeUniques) {
  for (const c of cigars) {
    const row = insertCigar.run(
      'House Brand', c.name, 'Nicaragua',
      c.wrapper, 'Nicaragua', 'Nicaragua',
      c.strength, JSON.stringify(c.flavor_notes),
      `A store exclusive. ${c.wrapper} wrapper, ${c.strength} body. Only available at this location.`
    );
    const cid = row.lastInsertRowid;

    for (const v of commonVitolas) {
      const vrow = insertVitola.run(cid, v.name, v.length, v.ring_gauge, v.msrp);
      const price = +(v.msrp * (0.95 + Math.random() * 0.2)).toFixed(2);
      insertInv.run(storeId, cid, vrow.lastInsertRowid, price, Math.floor(Math.random() * 15) + 5, 1);
    }
  }
}

// ── A deal and a broadcast for each store ────────────────────────────────────

const insertDeal = db.prepare(`
  INSERT INTO deals (store_id, title, description, discount_percent, expires_at) VALUES (?, ?, ?, ?, ?)
`);
insertDeal.run(store1Id, '15% Off All Common Blends This Weekend', 'Stock up on your favorites. 15% off every Common Blend single and bundle Friday through Sunday.', 15, '2026-06-01');
insertDeal.run(store2Id, 'Burnside Buy 4 Get 1 Free', 'Mix and match any singles in the humidor. Buy 4 sticks, the cheapest one is on us.', null, '2026-06-15');
insertDeal.run(store3Id, 'New Arrival: Alberta Singles In Stock', 'Our exclusive house line just landed. Come try them before they sell out.', null, '2026-05-30');

const insertNotif = db.prepare(`
  INSERT INTO notifications (store_id, title, message, type) VALUES (?, ?, ?, ?)
`);
insertNotif.run(store1Id, 'New batch of Common Blend 7 in', 'Just got a fresh run of Common Blend 7 Maduro. Robusto and Toro both in stock. Come grab them while they last.', 'new_arrival');
insertNotif.run(store2Id, 'Thursday night smoke — this week', 'Casual smoke night this Thursday at 7pm. Bring what you\'ve got, we\'ll have some singles to try. No ticket required.', 'event');
insertNotif.run(store3Id, 'Alberta Singles are here', 'Our house-exclusive blends finally landed. Three new cigars you won\'t find anywhere else in Portland. In the humidor now.', 'new_arrival');

console.log('Portland stores added successfully.');
console.log('');
console.log('Store accounts:');
console.log('  pdx1@demo.com / password123  ->  PDX Smoke Co. (SE Hawthorne)');
console.log('  pdx2@demo.com / password123  ->  Burnside Cigars');
console.log('  pdx3@demo.com / password123  ->  Alberta Street Tobacco');
console.log('');
console.log('Common cigars (all 3 stores): Common Blend 1-10');
console.log('PDX Smoke Co. exclusives:     PDX Reserve 1-3');
console.log('Burnside exclusives:          Burnside Select 1-3');
console.log('Alberta exclusives:           Alberta Single 1-3');
