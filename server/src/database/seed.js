const db = require('./db');
const { initSchema } = require('./schema');
const bcrypt = require('bcryptjs');

const cigars = [
  // Brand 1 (5 cigars)
  { brand: 'Brand 1', name: 'Light Cigar 1',  country: 'Nicaragua',         wrapper: 'Connecticut Shade',           binder: 'Nicaragua',  filler: 'Nicaragua',          strength: 'mild',        flavor_notes: JSON.stringify(['cream', 'cedar', 'honey', 'floral']),                description: 'A silky smooth morning smoke. Light and creamy with delicate cedar and floral notes.', year_introduced: 2018 },
  { brand: 'Brand 1', name: 'Light Cigar 2',  country: 'Honduras',          wrapper: 'Ecuador Connecticut',         binder: 'Honduras',   filler: 'Honduras/Dominican', strength: 'mild-medium', flavor_notes: JSON.stringify(['cream', 'nuts', 'cedar', 'honey', 'coffee']),           description: 'Balanced and approachable with creamy nuts and light coffee.', year_introduced: 2016 },
  { brand: 'Brand 1', name: 'Dark Cigar 1',   country: 'Nicaragua',         wrapper: 'Connecticut Broadleaf Maduro', binder: 'Nicaragua',  filler: 'Nicaragua',          strength: 'medium-full', flavor_notes: JSON.stringify(['dark chocolate', 'espresso', 'earth', 'leather', 'cedar']), description: 'Rich and complex with a beautiful oily maduro wrapper. Dark chocolate and espresso throughout.', year_introduced: 2019 },
  { brand: 'Brand 1', name: 'Cigar 1',        country: 'Dominican Republic', wrapper: 'Ecuador Habano',             binder: 'Dominican',  filler: 'Dominican',          strength: 'medium',      flavor_notes: JSON.stringify(['cedar', 'coffee', 'leather', 'nuts', 'spice']),          description: 'An elegant full-sized smoke blended for the long haul. Cedar and coffee up front giving way to spice.', year_introduced: 2014 },
  { brand: 'Brand 1', name: 'Cigar 2',        country: 'Nicaragua',         wrapper: 'Ecuador Habano',              binder: 'Nicaragua',  filler: 'Nicaragua',          strength: 'medium',      flavor_notes: JSON.stringify(['spice', 'cedar', 'nuts', 'coffee', 'earth']),           description: 'A well-constructed torpedo with a Habano wrapper. Earthy with subtle spice.', year_introduced: 2020 },

  // Brand 2 (5 cigars)
  { brand: 'Brand 2', name: 'Cigar 3',        country: 'Nicaragua',         wrapper: 'Nicaragua Natural',           binder: 'Nicaragua',  filler: 'Nicaragua',          strength: 'medium',      flavor_notes: JSON.stringify(['earth', 'leather', 'nuts', 'pepper', 'cedar']),          description: 'A hearty, satisfying robusto with earthy leather notes and a peppery kick.', year_introduced: 2017 },
  { brand: 'Brand 2', name: 'Bold Cigar 1',   country: 'Nicaragua',         wrapper: 'Ecuador Habano',              binder: 'Nicaragua',  filler: 'Nicaragua/Honduras', strength: 'medium-full', flavor_notes: JSON.stringify(['cocoa', 'leather', 'earth', 'black pepper', 'cedar']),   description: 'A bold toro with plenty of complexity — cocoa and leather with a lingering pepper finish.', year_introduced: 2015 },
  { brand: 'Brand 2', name: 'Dark Cigar 2',   country: 'Nicaragua',         wrapper: 'Connecticut Broadleaf Maduro', binder: 'Nicaragua',  filler: 'Nicaragua',          strength: 'full',        flavor_notes: JSON.stringify(['dark chocolate', 'coffee', 'earth', 'leather', 'molasses']), description: 'Full-bodied with rich dark chocolate, deep earth, and a sweet molasses note.', year_introduced: 2016 },
  { brand: 'Brand 2', name: 'Light Cigar 3',  country: 'Honduras',          wrapper: 'Ecuador Connecticut',         binder: 'Honduras',   filler: 'Honduras',           strength: 'mild-medium', flavor_notes: JSON.stringify(['cream', 'cedar', 'nuts', 'floral', 'honey']),             description: 'A classic Honduran lonsdale for those who appreciate elegance over power.', year_introduced: 2013 },
  { brand: 'Brand 2', name: 'Cigar 4',        country: 'Dominican Republic', wrapper: 'Ecuador Connecticut',        binder: 'Dominican',  filler: 'Dominican',          strength: 'medium',      flavor_notes: JSON.stringify(['cedar', 'cream', 'coffee', 'nuts', 'honey']),            description: 'A relaxed shorter smoke ideal for those with limited time. Easy and enjoyable.', year_introduced: 2021 },

  // Brand 3 (5 cigars)
  { brand: 'Brand 3', name: 'Cigar 5',        country: 'Nicaragua',         wrapper: 'Nicaragua Natural',           binder: 'Nicaragua',  filler: 'Nicaragua',          strength: 'medium',      flavor_notes: JSON.stringify(['cedar', 'earth', 'leather', 'pepper', 'nuts']),          description: 'An accessible, versatile toro that pairs well with coffee or craft beer.', year_introduced: 2018 },
  { brand: 'Brand 3', name: 'Cigar 6',        country: 'Nicaragua',         wrapper: 'Ecuador Habano',              binder: 'Nicaragua',  filler: 'Nicaragua',          strength: 'medium',      flavor_notes: JSON.stringify(['nuts', 'earth', 'spice', 'cedar', 'cream']),             description: 'Creamy nuts and light spice. Great for enthusiasts stepping up from mild smokes.', year_introduced: 2019 },
  { brand: 'Brand 3', name: 'Bold Cigar 2',   country: 'Nicaragua',         wrapper: 'Ecuador Habano',              binder: 'Nicaragua',  filler: 'Nicaragua/Dominican', strength: 'medium-full', flavor_notes: JSON.stringify(['dark chocolate', 'leather', 'cedar', 'pepper', 'coffee']), description: 'Chocolate and leather in the first third, shifting to cedar and pepper.', year_introduced: 2020 },
  { brand: 'Brand 3', name: 'Dark Cigar 3',   country: 'Nicaragua',         wrapper: 'Nicaragua Maduro',            binder: 'Nicaragua',  filler: 'Nicaragua',          strength: 'full',        flavor_notes: JSON.stringify(['espresso', 'dark chocolate', 'earth', 'leather', 'pepper']), description: 'A full-strength Nicaraguan puro with a dark maduro leaf. Bold and unapologetic.', year_introduced: 2021 },
  { brand: 'Brand 3', name: 'Light Cigar 4',  country: 'Dominican Republic', wrapper: 'Connecticut Shade',          binder: 'Dominican',  filler: 'Dominican',          strength: 'mild',        flavor_notes: JSON.stringify(['cream', 'floral', 'honey', 'cedar', 'tea']),              description: 'A long, slow morning smoke with a creamy Connecticut wrapper. Floral and honey throughout.', year_introduced: 2017 },

  // Brand 4 (5 cigars)
  { brand: 'Brand 4', name: 'Cigar 7',        country: 'Honduras',          wrapper: 'Ecuador Natural',             binder: 'Honduras',   filler: 'Honduras/Nicaragua', strength: 'medium',      flavor_notes: JSON.stringify(['cedar', 'leather', 'earth', 'nuts', 'coffee']),          description: 'A solid, dependable Honduran toro. Earthy and straightforward.', year_introduced: 2016 },
  { brand: 'Brand 4', name: 'Dark Cigar 4',   country: 'Nicaragua',         wrapper: 'Connecticut Broadleaf Maduro', binder: 'Nicaragua',  filler: 'Nicaragua',          strength: 'full',        flavor_notes: JSON.stringify(['dark chocolate', 'espresso', 'leather', 'earth', 'black pepper']), description: 'Big, bold, and unapologetically full-bodied. Rich espresso and dark chocolate in every puff.', year_introduced: 2014 },
  { brand: 'Brand 4', name: 'Light Cigar 5',  country: 'Dominican Republic', wrapper: 'Connecticut Shade',          binder: 'Dominican',  filler: 'Dominican',          strength: 'mild',        flavor_notes: JSON.stringify(['cream', 'honey', 'cedar', 'floral', 'vanilla']),          description: 'Classic Connecticut construction. Smooth, creamy, and elegant.', year_introduced: 2012 },
  { brand: 'Brand 4', name: 'Bold Cigar 3',   country: 'Nicaragua',         wrapper: 'Ecuador Habano',              binder: 'Nicaragua',  filler: 'Nicaragua',          strength: 'medium-full', flavor_notes: JSON.stringify(['spice', 'leather', 'cedar', 'cocoa', 'coffee']),          description: 'A pointed torpedo with a punchy Habano wrapper. Spice-forward with cocoa and coffee notes.', year_introduced: 2018 },
  { brand: 'Brand 4', name: 'Cigar 8',        country: 'Dominican Republic', wrapper: 'Ecuador Habano',             binder: 'Dominican',  filler: 'Dominican/Nicaraguan', strength: 'medium',    flavor_notes: JSON.stringify(['cedar', 'nuts', 'cream', 'leather', 'spice']),            description: 'An elegant long smoke with refined Dominican character. Cedar and cream with light spice.', year_introduced: 2019 },

  // Brand 5 (5 cigars)
  { brand: 'Brand 5', name: 'Bold Cigar 4',   country: 'Nicaragua',         wrapper: 'Ecuador Corojo',              binder: 'Nicaragua',  filler: 'Nicaragua',          strength: 'medium-full', flavor_notes: JSON.stringify(['red pepper', 'cedar', 'leather', 'coffee', 'earth']),    description: 'A bold, spicy robusto built around an Ecuador Corojo wrapper. Red pepper and cedar up front.', year_introduced: 2017 },
  { brand: 'Brand 5', name: 'Dark Cigar 5',   country: 'Nicaragua',         wrapper: 'Connecticut Broadleaf Maduro', binder: 'Nicaragua',  filler: 'Nicaragua/Honduras', strength: 'full',        flavor_notes: JSON.stringify(['dark chocolate', 'molasses', 'coffee', 'earth', 'leather']), description: 'Rich and indulgent. Flavors evolve and deepen as you smoke toward the nub.', year_introduced: 2015 },
  { brand: 'Brand 5', name: 'Cigar 9',        country: 'Nicaragua',         wrapper: 'Ecuador Sun Grown',           binder: 'Nicaragua',  filler: 'Nicaragua',          strength: 'medium',      flavor_notes: JSON.stringify(['earth', 'leather', 'nuts', 'coffee', 'spice']),           description: 'A sun-grown Ecuador wrapper gives this toro unique rustic character.', year_introduced: 2019 },
  { brand: 'Brand 5', name: 'Light Cigar 6',  country: 'Dominican Republic', wrapper: 'Ecuador Natural',            binder: 'Dominican',  filler: 'Dominican',          strength: 'mild-medium', flavor_notes: JSON.stringify(['cream', 'cedar', 'nuts', 'honey', 'floral']),             description: 'An elegant, understated lonsdale. Light and airy with cream, cedar, and gentle floral notes.', year_introduced: 2016 },
  { brand: 'Brand 5', name: 'Cigar 10',       country: 'Nicaragua',         wrapper: 'Ecuador Habano',              binder: 'Nicaragua',  filler: 'Nicaragua/Dominican', strength: 'medium',     flavor_notes: JSON.stringify(['cedar', 'leather', 'earth', 'nuts', 'coffee']),           description: 'A rare perfecto shape that showcases the blender\'s art. Unique draw profile.', year_introduced: 2022 },
];

const vitolasMap = {
  'Brand 1 - Light Cigar 1': [
    { name: 'Robusto', length: 5.0, ring_gauge: 50, msrp: 8 },
    { name: 'Toro', length: 6.0, ring_gauge: 52, msrp: 10 },
  ],
  'Brand 1 - Light Cigar 2': [
    { name: 'Robusto', length: 5.0, ring_gauge: 50, msrp: 9 },
    { name: 'Toro', length: 6.0, ring_gauge: 52, msrp: 11 },
    { name: 'Churchill', length: 7.0, ring_gauge: 48, msrp: 14 },
  ],
  'Brand 1 - Dark Cigar 1': [
    { name: 'Robusto', length: 5.0, ring_gauge: 50, msrp: 12 },
    { name: 'Toro', length: 6.0, ring_gauge: 52, msrp: 15 },
    { name: 'Gran Toro', length: 6.5, ring_gauge: 54, msrp: 17 },
  ],
  'Brand 1 - Cigar 1': [
    { name: 'Churchill', length: 7.0, ring_gauge: 48, msrp: 16 },
    { name: 'Toro', length: 6.0, ring_gauge: 52, msrp: 14 },
  ],
  'Brand 1 - Cigar 2': [
    { name: 'Torpedo', length: 6.0, ring_gauge: 52, msrp: 11 },
    { name: 'Short Torpedo', length: 5.0, ring_gauge: 52, msrp: 9 },
  ],
  'Brand 2 - Cigar 3': [
    { name: 'Robusto', length: 5.0, ring_gauge: 50, msrp: 10 },
    { name: 'Toro', length: 6.0, ring_gauge: 52, msrp: 12 },
  ],
  'Brand 2 - Bold Cigar 1': [
    { name: 'Toro', length: 6.0, ring_gauge: 52, msrp: 14 },
    { name: 'Robusto', length: 5.0, ring_gauge: 50, msrp: 12 },
    { name: 'Torpedo', length: 6.25, ring_gauge: 52, msrp: 15 },
  ],
  'Brand 2 - Dark Cigar 2': [
    { name: 'Robusto', length: 5.0, ring_gauge: 50, msrp: 13 },
    { name: 'Toro', length: 6.0, ring_gauge: 52, msrp: 16 },
    { name: 'Double Toro', length: 6.0, ring_gauge: 60, msrp: 18 },
  ],
  'Brand 2 - Light Cigar 3': [
    { name: 'Lonsdale', length: 6.5, ring_gauge: 44, msrp: 10 },
    { name: 'Corona', length: 5.5, ring_gauge: 44, msrp: 8 },
  ],
  'Brand 2 - Cigar 4': [
    { name: 'Corona', length: 5.5, ring_gauge: 42, msrp: 7 },
    { name: 'Robusto', length: 5.0, ring_gauge: 50, msrp: 9 },
  ],
  'Brand 3 - Cigar 5': [
    { name: 'Toro', length: 6.0, ring_gauge: 52, msrp: 10 },
    { name: 'Robusto', length: 5.0, ring_gauge: 50, msrp: 8 },
    { name: 'Churchill', length: 7.0, ring_gauge: 48, msrp: 13 },
  ],
  'Brand 3 - Cigar 6': [
    { name: 'Robusto', length: 5.0, ring_gauge: 50, msrp: 9 },
    { name: 'Toro', length: 6.0, ring_gauge: 52, msrp: 11 },
  ],
  'Brand 3 - Bold Cigar 2': [
    { name: 'Belicoso', length: 5.5, ring_gauge: 52, msrp: 14 },
    { name: 'Toro', length: 6.0, ring_gauge: 52, msrp: 15 },
    { name: 'Robusto', length: 5.0, ring_gauge: 50, msrp: 13 },
  ],
  'Brand 3 - Dark Cigar 3': [
    { name: 'Gran Toro', length: 6.0, ring_gauge: 60, msrp: 16 },
    { name: 'Toro', length: 6.0, ring_gauge: 52, msrp: 14 },
  ],
  'Brand 3 - Light Cigar 4': [
    { name: 'Churchill', length: 7.0, ring_gauge: 48, msrp: 13 },
    { name: 'Lonsdale', length: 6.5, ring_gauge: 44, msrp: 11 },
  ],
  'Brand 4 - Cigar 7': [
    { name: 'Toro', length: 6.0, ring_gauge: 52, msrp: 9 },
    { name: 'Robusto', length: 5.0, ring_gauge: 50, msrp: 7 },
    { name: 'Churchill', length: 7.0, ring_gauge: 48, msrp: 11 },
  ],
  'Brand 4 - Dark Cigar 4': [
    { name: 'Robusto', length: 5.0, ring_gauge: 50, msrp: 11 },
    { name: 'Toro', length: 6.0, ring_gauge: 52, msrp: 13 },
    { name: 'Short Robusto', length: 4.5, ring_gauge: 50, msrp: 9 },
  ],
  'Brand 4 - Light Cigar 5': [
    { name: 'Corona', length: 5.5, ring_gauge: 42, msrp: 7 },
    { name: 'Petit Corona', length: 4.5, ring_gauge: 42, msrp: 6 },
    { name: 'Lonsdale', length: 6.5, ring_gauge: 44, msrp: 9 },
  ],
  'Brand 4 - Bold Cigar 3': [
    { name: 'Torpedo', length: 6.0, ring_gauge: 52, msrp: 12 },
    { name: 'Belicoso', length: 5.5, ring_gauge: 52, msrp: 11 },
  ],
  'Brand 4 - Cigar 8': [
    { name: 'Churchill', length: 7.0, ring_gauge: 48, msrp: 14 },
    { name: 'Toro', length: 6.0, ring_gauge: 52, msrp: 12 },
    { name: 'Robusto', length: 5.0, ring_gauge: 50, msrp: 10 },
  ],
  'Brand 5 - Bold Cigar 4': [
    { name: 'Robusto', length: 5.0, ring_gauge: 50, msrp: 13 },
    { name: 'Toro', length: 6.0, ring_gauge: 52, msrp: 15 },
    { name: 'Torpedo', length: 6.25, ring_gauge: 52, msrp: 16 },
  ],
  'Brand 5 - Dark Cigar 5': [
    { name: 'Toro', length: 6.0, ring_gauge: 52, msrp: 16 },
    { name: 'Robusto', length: 5.0, ring_gauge: 50, msrp: 14 },
    { name: 'Gran Toro', length: 6.5, ring_gauge: 54, msrp: 18 },
  ],
  'Brand 5 - Cigar 9': [
    { name: 'Toro', length: 6.0, ring_gauge: 52, msrp: 12 },
    { name: 'Robusto', length: 5.0, ring_gauge: 50, msrp: 10 },
  ],
  'Brand 5 - Light Cigar 6': [
    { name: 'Lonsdale', length: 6.5, ring_gauge: 44, msrp: 9 },
    { name: 'Corona', length: 5.5, ring_gauge: 42, msrp: 7 },
    { name: 'Churchill', length: 7.0, ring_gauge: 48, msrp: 12 },
  ],
  'Brand 5 - Cigar 10': [
    { name: 'Perfecto', length: 5.5, ring_gauge: 50, msrp: 15 },
    { name: 'Gran Perfecto', length: 6.5, ring_gauge: 52, msrp: 18 },
  ],
};

async function truncateAll() {
  console.log('[seed] Truncating all tables...');
  await db.pool.query(`
    TRUNCATE TABLE notifications, smoke_list, store_views, store_ratings, deals,
      verification_requests, store_follows, user_cigars, reviews, inventory,
      vitolas, cigars, stores, users
    RESTART IDENTITY CASCADE
  `);
  console.log('[seed] Tables cleared.');
}

async function seed(force = false) {
  if (force) {
    await truncateAll();
  } else {
    const { rows } = await db.pool.query('SELECT COUNT(*)::int AS count FROM users');
    if (rows[0].count > 0) {
      console.log('[seed] Database already has data — skipping seed.');
      return;
    }
  }
  console.log('[seed] Empty database detected — seeding...');

  const hash = await bcrypt.hash('password123', 10);
  const adminHash = await bcrypt.hash('admin123', 10);

  const adminR  = await db.run(`INSERT INTO users (email, password_hash, name, account_type) VALUES (?, ?, ?, ?) RETURNING id`, ['admin@cigarbuddy.com', adminHash, 'Admin', 'admin']);
  const demoR   = await db.run(`INSERT INTO users (email, password_hash, name, account_type, bio, location_city, location_state) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`, ['smoker@demo.com', hash, 'Demo User 1', 'user', 'Portland cigar enthusiast.', 'Portland', 'OR']);
  const user2R  = await db.run(`INSERT INTO users (email, password_hash, name, account_type, bio, location_city, location_state) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`, ['jane@demo.com', hash, 'Demo User 2', 'user', 'New to cigars, learning fast.', 'Vancouver', 'WA']);

  const su1R = await db.run(`INSERT INTO users (email, password_hash, name, account_type) VALUES (?, ?, ?, ?) RETURNING id`, ['store1@demo.com', hash, 'Cigar Store 1', 'store']);
  const su2R = await db.run(`INSERT INTO users (email, password_hash, name, account_type) VALUES (?, ?, ?, ?) RETURNING id`, ['store2@demo.com', hash, 'Cigar Store 2', 'store']);
  const su3R = await db.run(`INSERT INTO users (email, password_hash, name, account_type) VALUES (?, ?, ?, ?) RETURNING id`, ['store3@demo.com', hash, 'Cigar Store 3', 'store']);
  const su4R = await db.run(`INSERT INTO users (email, password_hash, name, account_type) VALUES (?, ?, ?, ?) RETURNING id`, ['store4@demo.com', hash, 'Cigar Store 4', 'store']);
  const su5R = await db.run(`INSERT INTO users (email, password_hash, name, account_type) VALUES (?, ?, ?, ?) RETURNING id`, ['store5@demo.com', hash, 'Cigar Store 5', 'store']);

  const uid = demoR.lastInsertRowid, uid2 = user2R.lastInsertRowid;

  const hours1 = JSON.stringify({ Mon: '10am-8pm', Tue: '10am-8pm', Wed: '10am-8pm', Thu: '10am-9pm', Fri: '10am-10pm', Sat: '9am-10pm', Sun: '11am-7pm' });
  const hours2 = JSON.stringify({ Mon: '11am-7pm', Tue: '11am-7pm', Wed: '11am-7pm', Thu: '11am-8pm', Fri: '11am-9pm', Sat: '10am-9pm', Sun: '12pm-6pm' });
  const hours3 = JSON.stringify({ Mon: 'Closed', Tue: '1pm-10pm', Wed: '1pm-10pm', Thu: '1pm-11pm', Fri: '12pm-12am', Sat: '11am-12am', Sun: '12pm-8pm' });
  const hours4 = JSON.stringify({ Mon: '10am-7pm', Tue: '10am-7pm', Wed: '10am-7pm', Thu: '10am-7pm', Fri: '10am-8pm', Sat: '9am-8pm', Sun: '11am-5pm' });
  const hours5 = JSON.stringify({ Mon: '11am-8pm', Tue: '11am-8pm', Wed: '11am-8pm', Thu: '11am-9pm', Fri: '11am-10pm', Sat: '10am-10pm', Sun: '12pm-7pm' });

  const s1R = await db.run(`INSERT INTO stores (user_id, name, description, address, city, state, zip, phone, website, hours, has_lounge, has_walk_in_humidor, tags, verified, setup_complete, lat, lng) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?) RETURNING id`,
    [su1R.lastInsertRowid, 'Cigar Store 1', 'Downtown Portland walk-in humidor. Weekly smoke nights every Thursday.', '927 SW Morrison St', 'Portland', 'OR', '97205', '(503) 555-0927', null, hours1, 1, 1, JSON.stringify(['Walk-in Humidor', 'Lounge', 'Events']), 1, 45.5193, -122.6817]);

  const s2R = await db.run(`INSERT INTO stores (user_id, name, description, address, city, state, zip, phone, website, hours, has_lounge, has_walk_in_humidor, tags, verified, setup_complete, lat, lng) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?) RETURNING id`,
    [su2R.lastInsertRowid, 'Cigar Store 2', 'Neighborhood smoke shop on Hawthorne. Great prices, solid everyday selection.', '3412 SE Hawthorne Blvd', 'Portland', 'OR', '97214', '(503) 555-3412', null, hours2, 0, 1, JSON.stringify(['Walk-in Humidor', 'Budget-Friendly']), 0, 45.5121, -122.6317]);

  const s3R = await db.run(`INSERT INTO stores (user_id, name, description, address, city, state, zip, phone, website, hours, has_lounge, has_walk_in_humidor, tags, verified, setup_complete, lat, lng) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?) RETURNING id`,
    [su3R.lastInsertRowid, 'Cigar Store 3', 'Upscale lounge in the Pearl District. Craft cocktail bar and curated humidor.', '1242 NW Everett St', 'Portland', 'OR', '97209', '(503) 555-1242', null, hours3, 1, 1, JSON.stringify(['Lounge', 'Craft Cocktails', 'Private Lockers']), 1, 45.5284, -122.6822]);

  const s4R = await db.run(`INSERT INTO stores (user_id, name, description, address, city, state, zip, phone, website, hours, has_lounge, has_walk_in_humidor, tags, verified, setup_complete, lat, lng) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?) RETURNING id`,
    [su4R.lastInsertRowid, 'Cigar Store 4', 'Vancouver go-to cigar shop. Friendly staff, fair prices, over 150 SKUs.', '512 W 8th St', 'Vancouver', 'WA', '98660', '(360) 555-0512', null, hours4, 0, 1, JSON.stringify(['Walk-in Humidor', 'Everyday Value']), 1, 45.6275, -122.6739]);

  const s5R = await db.run(`INSERT INTO stores (user_id, name, description, address, city, state, zip, phone, website, hours, has_lounge, has_walk_in_humidor, tags, verified, setup_complete, lat, lng) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?) RETURNING id`,
    [su5R.lastInsertRowid, 'Cigar Store 5', 'Refined neighborhood lounge in Lake Oswego. Whiskey bar and monthly pairing events.', '15820 Boones Ferry Rd', 'Lake Oswego', 'OR', '97035', '(503) 555-5820', null, hours5, 1, 1, JSON.stringify(['Lounge', 'Whiskey Bar', 'Walk-in Humidor']), 1, 45.4201, -122.7051]);

  const store1Id = s1R.lastInsertRowid, store2Id = s2R.lastInsertRowid, store3Id = s3R.lastInsertRowid;
  const store4Id = s4R.lastInsertRowid, store5Id = s5R.lastInsertRowid;

  // Insert cigars + vitolas
  const cigarIds = {}, vitolaIds = {};
  for (const c of cigars) {
    const r = await db.run(
      `INSERT INTO cigars (brand, name, country, wrapper, binder, filler, strength, flavor_notes, description, year_introduced) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      [c.brand, c.name, c.country, c.wrapper, c.binder, c.filler, c.strength, c.flavor_notes, c.description, c.year_introduced]
    );
    const key = `${c.brand} - ${c.name}`;
    cigarIds[key] = r.lastInsertRowid;
    vitolaIds[key] = [];
    for (const v of (vitolasMap[key] || [])) {
      const vr = await db.run(
        `INSERT INTO vitolas (cigar_id, name, length, ring_gauge, msrp) VALUES (?, ?, ?, ?, ?) RETURNING id`,
        [r.lastInsertRowid, v.name, v.length, v.ring_gauge, v.msrp]
      );
      vitolaIds[key].push({ id: vr.lastInsertRowid, name: v.name, msrp: v.msrp });
    }
  }

  async function addToStore(storeId, key, featured = 0, newArrival = 0) {
    const cid = cigarIds[key];
    const vs = vitolaIds[key] || [];
    for (const v of vs) {
      const price = +(v.msrp * (0.9 + Math.random() * 0.2)).toFixed(2);
      await db.run(
        `INSERT INTO inventory (store_id, cigar_id, vitola_id, price, quantity, in_stock, is_featured, is_new_arrival) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
        [storeId, cid, v.id, price, Math.floor(Math.random() * 30) + 5, featured, newArrival]
      );
    }
  }

  // Cigar Store 1 — premium, broad selection
  await addToStore(store1Id, 'Brand 1 - Dark Cigar 1', 1);
  await addToStore(store1Id, 'Brand 1 - Cigar 1', 1);
  await addToStore(store1Id, 'Brand 1 - Cigar 2');
  await addToStore(store1Id, 'Brand 1 - Light Cigar 2');
  await addToStore(store1Id, 'Brand 3 - Bold Cigar 2', 1);
  await addToStore(store1Id, 'Brand 3 - Dark Cigar 3');
  await addToStore(store1Id, 'Brand 3 - Cigar 5');
  await addToStore(store1Id, 'Brand 2 - Bold Cigar 1', 0, 1);
  await addToStore(store1Id, 'Brand 2 - Dark Cigar 2');
  await addToStore(store1Id, 'Brand 5 - Bold Cigar 4', 1);
  await addToStore(store1Id, 'Brand 5 - Dark Cigar 5', 1);
  await addToStore(store1Id, 'Brand 5 - Cigar 10', 0, 1);
  await addToStore(store1Id, 'Brand 4 - Cigar 8');
  await addToStore(store1Id, 'Brand 4 - Bold Cigar 3');

  // Cigar Store 2 — everyday smokes, budget-friendly
  await addToStore(store2Id, 'Brand 1 - Light Cigar 1', 1);
  await addToStore(store2Id, 'Brand 1 - Light Cigar 2', 1);
  await addToStore(store2Id, 'Brand 2 - Cigar 3', 1);
  await addToStore(store2Id, 'Brand 2 - Light Cigar 3');
  await addToStore(store2Id, 'Brand 2 - Cigar 4');
  await addToStore(store2Id, 'Brand 2 - Bold Cigar 1');
  await addToStore(store2Id, 'Brand 3 - Cigar 5', 0, 1);
  await addToStore(store2Id, 'Brand 3 - Cigar 6');
  await addToStore(store2Id, 'Brand 3 - Light Cigar 4');
  await addToStore(store2Id, 'Brand 4 - Cigar 7', 1);
  await addToStore(store2Id, 'Brand 4 - Light Cigar 5');
  await addToStore(store2Id, 'Brand 4 - Dark Cigar 4');

  // Cigar Store 3 — boutique lounge, bold selections
  await addToStore(store3Id, 'Brand 5 - Bold Cigar 4', 1);
  await addToStore(store3Id, 'Brand 5 - Dark Cigar 5', 1);
  await addToStore(store3Id, 'Brand 5 - Cigar 9', 1, 1);
  await addToStore(store3Id, 'Brand 5 - Light Cigar 6');
  await addToStore(store3Id, 'Brand 5 - Cigar 10', 1);
  await addToStore(store3Id, 'Brand 1 - Dark Cigar 1');
  await addToStore(store3Id, 'Brand 1 - Cigar 2', 0, 1);
  await addToStore(store3Id, 'Brand 3 - Bold Cigar 2', 1);
  await addToStore(store3Id, 'Brand 3 - Dark Cigar 3');
  await addToStore(store3Id, 'Brand 4 - Bold Cigar 3');
  await addToStore(store3Id, 'Brand 4 - Cigar 8');
  await addToStore(store3Id, 'Brand 2 - Dark Cigar 2', 0, 1);

  // Cigar Store 4 (Vancouver) — value-focused, everyday variety
  await addToStore(store4Id, 'Brand 4 - Cigar 7', 1);
  await addToStore(store4Id, 'Brand 4 - Light Cigar 5', 1);
  await addToStore(store4Id, 'Brand 4 - Dark Cigar 4');
  await addToStore(store4Id, 'Brand 4 - Cigar 8');
  await addToStore(store4Id, 'Brand 2 - Cigar 3', 1);
  await addToStore(store4Id, 'Brand 2 - Light Cigar 3');
  await addToStore(store4Id, 'Brand 2 - Cigar 4');
  await addToStore(store4Id, 'Brand 2 - Bold Cigar 1');
  await addToStore(store4Id, 'Brand 3 - Cigar 5', 1);
  await addToStore(store4Id, 'Brand 3 - Cigar 6');
  await addToStore(store4Id, 'Brand 3 - Light Cigar 4', 0, 1);
  await addToStore(store4Id, 'Brand 1 - Light Cigar 1');
  await addToStore(store4Id, 'Brand 1 - Light Cigar 2');

  // Cigar Store 5 — premium suburban lounge
  await addToStore(store5Id, 'Brand 1 - Cigar 1', 1);
  await addToStore(store5Id, 'Brand 1 - Dark Cigar 1', 1);
  await addToStore(store5Id, 'Brand 1 - Cigar 2');
  await addToStore(store5Id, 'Brand 5 - Dark Cigar 5', 1);
  await addToStore(store5Id, 'Brand 5 - Bold Cigar 4', 1, 1);
  await addToStore(store5Id, 'Brand 5 - Cigar 10');
  await addToStore(store5Id, 'Brand 5 - Cigar 9');
  await addToStore(store5Id, 'Brand 4 - Dark Cigar 4');
  await addToStore(store5Id, 'Brand 4 - Cigar 8', 0, 1);
  await addToStore(store5Id, 'Brand 2 - Bold Cigar 1');
  await addToStore(store5Id, 'Brand 2 - Dark Cigar 2', 1);
  await addToStore(store5Id, 'Brand 3 - Bold Cigar 2');
  await addToStore(store5Id, 'Brand 3 - Dark Cigar 3', 0, 1);

  // Reviews
  await db.run(`INSERT INTO reviews (user_id, cigar_id, vitola_id, rating, draw_rating, burn_rating, appearance_rating, flavor_notes, strength_experienced, smoke_time, pairing, review_text) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [uid, cigarIds['Brand 1 - Dark Cigar 1'], vitolaIds['Brand 1 - Dark Cigar 1'][0].id, 92, 5, 5, 4, JSON.stringify(['dark chocolate', 'espresso', 'leather']), 'medium-full', 65, 'Cold brew coffee', 'Really solid maduro. Dark chocolate up front, leather comes in around halfway. Burn was razor sharp.']);
  await db.run(`INSERT INTO reviews (user_id, cigar_id, vitola_id, rating, draw_rating, burn_rating, appearance_rating, flavor_notes, strength_experienced, smoke_time, pairing, review_text) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [uid, cigarIds['Brand 5 - Bold Cigar 4'], vitolaIds['Brand 5 - Bold Cigar 4'][0].id, 94, 5, 4, 5, JSON.stringify(['red pepper', 'cedar', 'leather', 'coffee']), 'medium-full', 60, 'Rye whiskey', 'Punchy red pepper right away then settles into gorgeous leather and coffee. Construction near perfect.']);
  await db.run(`INSERT INTO reviews (user_id, cigar_id, vitola_id, rating, draw_rating, burn_rating, appearance_rating, flavor_notes, strength_experienced, smoke_time, pairing, review_text) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [uid, cigarIds['Brand 2 - Bold Cigar 1'], vitolaIds['Brand 2 - Bold Cigar 1'][0].id, 90, 4, 5, 4, JSON.stringify(['cocoa', 'leather', 'black pepper', 'earth']), 'medium-full', 70, 'Black coffee', 'Smoked this on the back porch during a rainy evening. Cocoa and earth throughout, great construction.']);
  await db.run(`INSERT INTO reviews (user_id, cigar_id, vitola_id, rating, draw_rating, burn_rating, appearance_rating, flavor_notes, strength_experienced, smoke_time, pairing, review_text) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [uid, cigarIds['Brand 3 - Cigar 5'], vitolaIds['Brand 3 - Cigar 5'][0].id, 87, 5, 4, 4, JSON.stringify(['cedar', 'earth', 'nuts', 'pepper']), 'medium', 55, 'IPA', 'Great everyday smoke. Nothing flashy but reliable. Would buy a bundle.']);
  await db.run(`INSERT INTO reviews (user_id, cigar_id, vitola_id, rating, draw_rating, burn_rating, appearance_rating, flavor_notes, strength_experienced, smoke_time, pairing, review_text) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [uid2, cigarIds['Brand 1 - Light Cigar 1'], vitolaIds['Brand 1 - Light Cigar 1'][0].id, 88, 5, 5, 4, JSON.stringify(['cream', 'cedar', 'honey', 'floral']), 'mild', 45, 'Latte', 'My first cigar and it was amazing. So smooth, zero harshness. The honey and floral notes were unexpected.']);
  await db.run(`INSERT INTO reviews (user_id, cigar_id, vitola_id, rating, draw_rating, burn_rating, appearance_rating, flavor_notes, strength_experienced, smoke_time, pairing, review_text) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [uid2, cigarIds['Brand 2 - Light Cigar 3'], vitolaIds['Brand 2 - Light Cigar 3'][0].id, 85, 4, 4, 5, JSON.stringify(['cream', 'cedar', 'nuts', 'honey']), 'mild-medium', 55, 'Herbal tea', 'Beautiful looking cigar. Creamy nut flavors were exactly what I was looking for.']);
  await db.run(`INSERT INTO reviews (user_id, cigar_id, vitola_id, rating, draw_rating, burn_rating, appearance_rating, flavor_notes, strength_experienced, smoke_time, pairing, review_text) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [uid, cigarIds['Brand 5 - Dark Cigar 5'], vitolaIds['Brand 5 - Dark Cigar 5'][0].id, 96, 5, 5, 5, JSON.stringify(['dark chocolate', 'molasses', 'coffee', 'leather']), 'full', 80, 'Aged bourbon', 'Best maduro in a long time. The molasses note on the retrohale is something else. Pairs unbelievably with bourbon.']);

  // Humidor items
  await db.run(`INSERT INTO user_cigars (user_id, cigar_id, vitola_id, status, quantity, purchase_price, purchase_date, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [uid, cigarIds['Brand 1 - Dark Cigar 1'], vitolaIds['Brand 1 - Dark Cigar 1'][1].id, 'humidor', 10, 14.50, '2026-05-10', 'Box purchase. Letting these rest.']);
  await db.run(`INSERT INTO user_cigars (user_id, cigar_id, vitola_id, status, quantity, purchase_price, purchase_date, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [uid, cigarIds['Brand 5 - Bold Cigar 4'], vitolaIds['Brand 5 - Bold Cigar 4'][0].id, 'humidor', 5, 13.00, '2026-06-01', 'Great after-dinner smoke.']);
  await db.run(`INSERT INTO user_cigars (user_id, cigar_id, vitola_id, status, quantity, purchase_price, purchase_date, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [uid, cigarIds['Brand 3 - Bold Cigar 2'], vitolaIds['Brand 3 - Bold Cigar 2'][0].id, 'humidor', 3, 13.50, '2026-06-10', 'Picked up at a Thursday smoke night.']);
  await db.run(`INSERT INTO user_cigars (user_id, cigar_id, vitola_id, status, quantity, purchase_price, purchase_date, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [uid, cigarIds['Brand 2 - Bold Cigar 1'], vitolaIds['Brand 2 - Bold Cigar 1'][0].id, 'smoked', 1, 13.00, '2026-05-25', 'Rainy porch smoke. Perfect.']);
  await db.run(`INSERT INTO user_cigars (user_id, cigar_id, vitola_id, status, quantity, purchase_price, purchase_date, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [uid, cigarIds['Brand 5 - Dark Cigar 5'], vitolaIds['Brand 5 - Dark Cigar 5'][0].id, 'wishlist', 1, null, null, 'Need to grab a box.']);
  await db.run(`INSERT INTO user_cigars (user_id, cigar_id, vitola_id, status, quantity, purchase_price, purchase_date, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [uid2, cigarIds['Brand 1 - Light Cigar 1'], vitolaIds['Brand 1 - Light Cigar 1'][0].id, 'humidor', 5, 7.50, '2026-06-15', 'My go-to. Always keeping 5 on hand.']);
  await db.run(`INSERT INTO user_cigars (user_id, cigar_id, vitola_id, status, quantity, purchase_price, purchase_date, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [uid2, cigarIds['Brand 2 - Light Cigar 3'], vitolaIds['Brand 2 - Light Cigar 3'][0].id, 'humidor', 3, 9.50, '2026-06-20', 'Second purchase. Love these.']);

  // Store follows
  for (const [userId, storeId] of [[uid, store1Id], [uid, store3Id], [uid, store5Id], [uid2, store4Id], [uid2, store2Id], [uid2, store1Id]]) {
    await db.run('INSERT INTO store_follows (user_id, store_id, notify_broadcasts, notify_deals, notify_new_arrivals) VALUES (?, ?, 1, 1, 1)', [userId, storeId]);
  }

  // Deals
  await db.run(`INSERT INTO deals (store_id, title, description, discount_percent, cigar_id, expires_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [store1Id, 'Thursday Smoke Night', 'Weekly smoke night this Thursday. Featured cigar from Brand 5. $5 off all night, plus drink specials.', null, cigarIds['Brand 5 - Bold Cigar 4'], '2026-07-01']);
  await db.run(`INSERT INTO deals (store_id, title, description, discount_percent, cigar_id, expires_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [store2Id, '5 for $35 — Brand 3 Cigar 5', 'Stock up on the most popular everyday smoke. Buy 5 singles for $35 this week only.', null, cigarIds['Brand 3 - Cigar 5'], '2026-07-05']);
  await db.run(`INSERT INTO deals (store_id, title, description, discount_percent, cigar_id, expires_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [store3Id, 'New Arrival: Brand 5 Cigar 9', 'Just landed — Ecuador sun-grown wrapper, medium body. First week price: $10.50.', null, cigarIds['Brand 5 - Cigar 9'], '2026-07-10']);
  await db.run(`INSERT INTO deals (store_id, title, description, discount_percent, cigar_id, expires_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [store4Id, '10% Off All Brand 4 Singles', '15-year anniversary weekend special. 10% off every Brand 4 single Sat and Sun.', 10, null, '2026-06-29']);
  await db.run(`INSERT INTO deals (store_id, title, description, discount_percent, cigar_id, expires_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [store5Id, 'Monthly Pairing Night — Bourbon & Maduro', 'Three cigars, three bourbons, guided tasting notes. $55 per person. Limited seats.', null, cigarIds['Brand 5 - Dark Cigar 5'], '2026-07-12']);

  // Store ratings
  await db.run(`INSERT INTO store_ratings (user_id, store_id, rating, comment) VALUES (?, ?, ?, ?)`, [uid, store1Id, 5, 'Best walk-in humidor in the city. Staff is knowledgeable and never pushy. Thursday nights are a highlight.']);
  await db.run(`INSERT INTO store_ratings (user_id, store_id, rating, comment) VALUES (?, ?, ?, ?)`, [uid, store3Id, 5, 'The lounge is unmatched. Cocktails are great, selection is curated.']);
  await db.run(`INSERT INTO store_ratings (user_id, store_id, rating, comment) VALUES (?, ?, ?, ?)`, [uid, store5Id, 4, 'Great whiskey selection and comfortable seating. Worth the drive.']);
  await db.run(`INSERT INTO store_ratings (user_id, store_id, rating, comment) VALUES (?, ?, ?, ?)`, [uid2, store4Id, 5, 'Everyone was so helpful when I was starting out. Great prices too.']);
  await db.run(`INSERT INTO store_ratings (user_id, store_id, rating, comment) VALUES (?, ?, ?, ?)`, [uid2, store2Id, 4, 'No frills but exactly what you need. Solid prices and friendly regulars.']);
  await db.run(`INSERT INTO store_ratings (user_id, store_id, rating, comment) VALUES (?, ?, ?, ?)`, [uid2, store1Id, 5, 'Huge humidor and the smoke nights are super welcoming for newer folks.']);

  // Store views
  const viewInserts = [];
  for (let d = 0; d < 14; d++) {
    const date = new Date(Date.now() - d * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    for (const [sid, base] of [[store1Id, 18], [store2Id, 12], [store3Id, 15], [store4Id, 10], [store5Id, 8]]) {
      const count = Math.floor(Math.random() * base) + 3;
      for (let v = 0; v < count; v++) viewInserts.push(db.run('INSERT INTO store_views (store_id, viewed_at) VALUES (?, ?)', [sid, `${date} 12:00:00`]));
    }
  }
  await Promise.all(viewInserts);

  // Notifications
  await db.run(`INSERT INTO notifications (store_id, title, message, type, cigar_id) VALUES (?, ?, ?, ?, ?)`,
    [store1Id, 'New Arrival: Brand 5 Cigar 10', 'Fresh batch just arrived — limited quantity. Come in or call ahead.', 'new_arrival', cigarIds['Brand 5 - Cigar 10']]);
  await db.run(`INSERT INTO notifications (store_id, title, message, type, cigar_id) VALUES (?, ?, ?, ?, ?)`,
    [store2Id, 'Brand 3 Cigar 5 Back in Full Stock', 'Our best-selling everyday smoke. Fresh rotation just hit the humidor.', 'new_arrival', cigarIds['Brand 3 - Cigar 5']]);
  await db.run(`INSERT INTO notifications (store_id, title, message, type, cigar_id) VALUES (?, ?, ?, ?, ?)`,
    [store3Id, 'Members: Early Access to Brand 5 Cigar 9', '48-hour member early access. Stop by or call to hold yours.', 'announcement', cigarIds['Brand 5 - Cigar 9']]);
  await db.run(`INSERT INTO notifications (store_id, title, message, type, cigar_id) VALUES (?, ?, ?, ?, ?)`,
    [store4Id, '15th Anniversary — 10% Off Everything', 'Celebrating 15 years! 10% off all singles this weekend.', 'deal', null]);
  await db.run(`INSERT INTO notifications (store_id, title, message, type, cigar_id) VALUES (?, ?, ?, ?, ?)`,
    [store5Id, 'July Pairing Night Tickets', 'Only 8 seats left. $55 includes three cigars and three bourbons.', 'event', null]);

  // Smoke list
  await db.run(`INSERT INTO smoke_list (user_id, cigar_id, priority, notes, recommended_by, status) VALUES (?, ?, ?, ?, ?, 'pending')`,
    [uid, cigarIds['Brand 5 - Dark Cigar 5'], 'high', 'Everyone at smoke night raves about this.', 'Cigar Store 1 staff']);
  await db.run(`INSERT INTO smoke_list (user_id, cigar_id, priority, notes, recommended_by, status) VALUES (?, ?, ?, ?, ?, 'pending')`,
    [uid, cigarIds['Brand 5 - Cigar 10'], 'high', 'Never smoked a perfecto shape before.', null]);
  await db.run(`INSERT INTO smoke_list (user_id, cigar_id, priority, notes, recommended_by, status) VALUES (?, ?, ?, ?, ?, 'pending')`,
    [uid, cigarIds['Brand 1 - Cigar 1'], 'medium', 'Saving for a long Saturday afternoon.', 'Spotted at Cigar Store 5']);
  await db.run(`INSERT INTO smoke_list (user_id, cigar_id, priority, notes, recommended_by, status) VALUES (?, ?, ?, ?, ?, 'pending')`,
    [uid, cigarIds['Brand 4 - Bold Cigar 3'], 'medium', 'Heard the torpedo cuts really well with this blend.', 'Forum recommendation']);
  await db.run(`INSERT INTO smoke_list (user_id, cigar_id, priority, notes, recommended_by, status) VALUES (?, ?, ?, ?, ?, 'pending')`,
    [uid, cigarIds['Brand 2 - Dark Cigar 2'], 'low', 'Want to compare with Brand 1 Dark Cigar 1 side by side.', null]);
  await db.run(`INSERT INTO smoke_list (user_id, cigar_id, priority, notes, recommended_by, status) VALUES (?, ?, ?, ?, ?, 'pending')`,
    [uid2, cigarIds['Brand 1 - Light Cigar 2'], 'high', 'Stepping up from Light Cigar 1. Seems like the natural next one.', 'Cigar Store 4 staff']);
  await db.run(`INSERT INTO smoke_list (user_id, cigar_id, priority, notes, recommended_by, status) VALUES (?, ?, ?, ?, ?, 'pending')`,
    [uid2, cigarIds['Brand 3 - Cigar 6'], 'medium', 'Heard it is a bit bolder than my usual but still approachable.', null]);
  await db.run(`INSERT INTO smoke_list (user_id, cigar_id, priority, notes, recommended_by, status) VALUES (?, ?, ?, ?, ?, 'pending')`,
    [uid2, cigarIds['Brand 2 - Cigar 4'], 'low', 'Short smoke for busy evenings.', null]);

  // Verification request
  await db.run(`INSERT INTO verification_requests (store_id, business_name, business_ein, business_phone, business_address, business_website, license_number, notes, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [store2Id, 'Cigar Store 2 LLC', '91-2345678', '(503) 555-3412', '3412 SE Hawthorne Blvd, Portland, OR 97214', null, 'OR-TB-2009-00341', 'Independent shop operating since 2009.', 'pending']);

  console.log('\n✅ Seed complete!');
  console.log('\nDemo accounts:');
  console.log('  User 1:  smoker@demo.com / password123');
  console.log('  User 2:  jane@demo.com / password123');
  console.log('  Store 1: store1@demo.com / password123 (Cigar Store 1 — Portland downtown)');
  console.log('  Store 2: store2@demo.com / password123 (Cigar Store 2 — SE Portland)');
  console.log('  Store 3: store3@demo.com / password123 (Cigar Store 3 — Pearl District)');
  console.log('  Store 4: store4@demo.com / password123 (Cigar Store 4 — Vancouver, WA)');
  console.log('  Store 5: store5@demo.com / password123 (Cigar Store 5 — Lake Oswego)');
  console.log('  Admin:   admin@cigarbuddy.com / admin123');
  console.log('[seed] Done.');
}

module.exports = { seed };

if (require.main === module) {
  const force = process.argv.includes('--force');
  initSchema().then(() => seed(force)).then(() => db.pool.end()).catch(err => { console.error(err); process.exit(1); });
}
