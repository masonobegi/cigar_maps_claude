const db = require('./db');
const { initSchema } = require('./schema');
const bcrypt = require('bcryptjs');

const cigars = [
  // Pacific Premium (5)
  { brand: 'Pacific Premium', name: 'Morning Mist Robusto', country: 'Nicaragua', wrapper: 'Connecticut Shade', binder: 'Nicaragua', filler: 'Nicaragua', strength: 'mild', flavor_notes: JSON.stringify(['cream', 'cedar', 'honey', 'floral']), description: 'A silky smooth morning smoke. Light and creamy with delicate cedar and floral notes. Perfect for beginners or those who prefer a relaxed smoke.', year_introduced: 2018 },
  { brand: 'Pacific Premium', name: 'Coastline Toro', country: 'Honduras', wrapper: 'Ecuador Connecticut', binder: 'Honduras', filler: 'Honduras/Dominican', strength: 'mild-medium', flavor_notes: JSON.stringify(['cream', 'nuts', 'cedar', 'honey', 'coffee']), description: 'Named for the rugged Pacific coastline. Balanced and approachable with creamy nuts and light coffee. Excellent construction at an everyday price.', year_introduced: 2016 },
  { brand: 'Pacific Premium', name: 'Reserve Maduro', country: 'Nicaragua', wrapper: 'Connecticut Broadleaf Maduro', binder: 'Nicaragua', filler: 'Nicaragua', strength: 'medium-full', flavor_notes: JSON.stringify(['dark chocolate', 'espresso', 'earth', 'leather', 'cedar']), description: 'Rich and complex with a beautiful oily maduro wrapper. Dark chocolate and espresso throughout, finishing with a satisfying leather note.', year_introduced: 2019 },
  { brand: 'Pacific Premium', name: 'Grand Churchill', country: 'Dominican Republic', wrapper: 'Ecuador Habano', binder: 'Dominican', filler: 'Dominican', strength: 'medium', flavor_notes: JSON.stringify(['cedar', 'coffee', 'leather', 'nuts', 'spice']), description: 'An elegant full-sized smoke blended for the long haul. Cedar and coffee up front giving way to a spicy leather finish. Ideal for a relaxed afternoon.', year_introduced: 2014 },
  { brand: 'Pacific Premium', name: 'Torpedo Select', country: 'Nicaragua', wrapper: 'Ecuador Habano', binder: 'Nicaragua', filler: 'Nicaragua', strength: 'medium', flavor_notes: JSON.stringify(['spice', 'cedar', 'nuts', 'coffee', 'earth']), description: 'A well-constructed torpedo with a Habano wrapper that delivers a consistent medium-bodied experience. Earthy with subtle spice.', year_introduced: 2020 },

  // Cascade Valley (5)
  { brand: 'Cascade Valley', name: 'Harvest Robusto', country: 'Nicaragua', wrapper: 'Nicaragua Natural', binder: 'Nicaragua', filler: 'Nicaragua', strength: 'medium', flavor_notes: JSON.stringify(['earth', 'leather', 'nuts', 'pepper', 'cedar']), description: 'Inspired by harvest season in the Pacific Northwest. A hearty, satisfying robusto with earthy leather notes and a peppery kick.', year_introduced: 2017 },
  { brand: 'Cascade Valley', name: 'Ridge Runner Toro', country: 'Nicaragua', wrapper: 'Ecuador Habano', binder: 'Nicaragua', filler: 'Nicaragua/Honduras', strength: 'medium-full', flavor_notes: JSON.stringify(['cocoa', 'leather', 'earth', 'black pepper', 'cedar']), description: 'Named for the ridge trails of the Cascades. A bold toro with plenty of complexity — cocoa and leather with a lingering pepper finish.', year_introduced: 2015 },
  { brand: 'Cascade Valley', name: 'Summit Maduro', country: 'Nicaragua', wrapper: 'Connecticut Broadleaf Maduro', binder: 'Nicaragua', filler: 'Nicaragua', strength: 'full', flavor_notes: JSON.stringify(['dark chocolate', 'coffee', 'earth', 'leather', 'molasses']), description: 'The boldest offering from Cascade Valley. Full-bodied with rich dark chocolate, deep earth, and a sweet molasses note on the retrohale.', year_introduced: 2016 },
  { brand: 'Cascade Valley', name: 'Classic Lonsdale', country: 'Honduras', wrapper: 'Ecuador Connecticut', binder: 'Honduras', filler: 'Honduras', strength: 'mild-medium', flavor_notes: JSON.stringify(['cream', 'cedar', 'nuts', 'floral', 'honey']), description: 'A classic Honduran lonsdale for those who appreciate elegance over power. Creamy, smooth, and consistent from foot to nub.', year_introduced: 2013 },
  { brand: 'Cascade Valley', name: 'Late Season Corona', country: 'Dominican Republic', wrapper: 'Ecuador Connecticut', binder: 'Dominican', filler: 'Dominican', strength: 'medium', flavor_notes: JSON.stringify(['cedar', 'cream', 'coffee', 'nuts', 'honey']), description: 'A relaxed shorter smoke ideal for those with limited time. Dominican tobaccos in a smooth Ecuador Connecticut — easy and enjoyable.', year_introduced: 2021 },

  // Northwest Blend (5)
  { brand: 'Northwest Blend', name: 'Toro No.1', country: 'Nicaragua', wrapper: 'Nicaragua Natural', binder: 'Nicaragua', filler: 'Nicaragua', strength: 'medium', flavor_notes: JSON.stringify(['cedar', 'earth', 'leather', 'pepper', 'nuts']), description: 'The flagship of the Northwest Blend line. An accessible, versatile toro that pairs well with coffee or craft beer. A solid everyday smoke.', year_introduced: 2018 },
  { brand: 'Northwest Blend', name: 'Robusto No.2', country: 'Nicaragua', wrapper: 'Ecuador Habano', binder: 'Nicaragua', filler: 'Nicaragua', strength: 'medium', flavor_notes: JSON.stringify(['nuts', 'earth', 'spice', 'cedar', 'cream']), description: 'Slightly lighter than the No.1. Creamy nuts and light spice make this great for enthusiasts stepping up from mild smokes.', year_introduced: 2019 },
  { brand: 'Northwest Blend', name: 'Belicoso Reserve', country: 'Nicaragua', wrapper: 'Ecuador Habano', binder: 'Nicaragua', filler: 'Nicaragua/Dominican', strength: 'medium-full', flavor_notes: JSON.stringify(['dark chocolate', 'leather', 'cedar', 'pepper', 'coffee']), description: 'The premium offering in the Northwest Blend line. Chocolate and leather in the first third, shifting to cedar and pepper through the finish.', year_introduced: 2020 },
  { brand: 'Northwest Blend', name: 'Gran Toro', country: 'Nicaragua', wrapper: 'Nicaragua Maduro', binder: 'Nicaragua', filler: 'Nicaragua', strength: 'full', flavor_notes: JSON.stringify(['espresso', 'dark chocolate', 'earth', 'leather', 'pepper']), description: 'The most powerful stick in the lineup. A full-strength Nicaraguan puro with a dark maduro leaf. Bold and unapologetic.', year_introduced: 2021 },
  { brand: 'Northwest Blend', name: 'Morning Churchill', country: 'Dominican Republic', wrapper: 'Connecticut Shade', binder: 'Dominican', filler: 'Dominican', strength: 'mild', flavor_notes: JSON.stringify(['cream', 'floral', 'honey', 'cedar', 'tea']), description: 'A long, slow morning smoke with a creamy Connecticut wrapper. Floral and honey throughout, exceptionally smooth with zero harshness.', year_introduced: 2017 },

  // Pioneer Leaf (5)
  { brand: 'Pioneer Leaf', name: 'Natural Toro', country: 'Honduras', wrapper: 'Ecuador Natural', binder: 'Honduras', filler: 'Honduras/Nicaragua', strength: 'medium', flavor_notes: JSON.stringify(['cedar', 'leather', 'earth', 'nuts', 'coffee']), description: 'A solid, dependable Honduran toro. Earthy and straightforward — the kind of cigar that never lets you down. Great everyday value.', year_introduced: 2016 },
  { brand: 'Pioneer Leaf', name: 'Maduro Robusto', country: 'Nicaragua', wrapper: 'Connecticut Broadleaf Maduro', binder: 'Nicaragua', filler: 'Nicaragua', strength: 'full', flavor_notes: JSON.stringify(['dark chocolate', 'espresso', 'leather', 'earth', 'black pepper']), description: 'Big, bold, and unapologetically full-bodied. The Maduro Robusto packs rich espresso and dark chocolate into every puff.', year_introduced: 2014 },
  { brand: 'Pioneer Leaf', name: 'Connecticut Corona', country: 'Dominican Republic', wrapper: 'Connecticut Shade', binder: 'Dominican', filler: 'Dominican', strength: 'mild', flavor_notes: JSON.stringify(['cream', 'honey', 'cedar', 'floral', 'vanilla']), description: 'Classic Connecticut construction. Smooth, creamy, and elegant. A reliable smoke that appeals to a wide range of palates.', year_introduced: 2012 },
  { brand: 'Pioneer Leaf', name: 'Habano Torpedo', country: 'Nicaragua', wrapper: 'Ecuador Habano', binder: 'Nicaragua', filler: 'Nicaragua', strength: 'medium-full', flavor_notes: JSON.stringify(['spice', 'leather', 'cedar', 'cocoa', 'coffee']), description: 'A pointed torpedo with a punchy Habano wrapper. Spice-forward with cocoa and coffee notes developing beautifully through the second third.', year_introduced: 2018 },
  { brand: 'Pioneer Leaf', name: 'Reserve Churchill', country: 'Dominican Republic', wrapper: 'Ecuador Habano', binder: 'Dominican', filler: 'Dominican/Nicaraguan', strength: 'medium', flavor_notes: JSON.stringify(['cedar', 'nuts', 'cream', 'leather', 'spice']), description: 'An elegant long smoke with refined Dominican character. Cedary and creamy with light spice on the finish. Made for a quiet evening.', year_introduced: 2019 },

  // Columbia Select (5)
  { brand: 'Columbia Select', name: 'Corojo Robusto', country: 'Nicaragua', wrapper: 'Ecuador Corojo', binder: 'Nicaragua', filler: 'Nicaragua', strength: 'medium-full', flavor_notes: JSON.stringify(['red pepper', 'cedar', 'leather', 'coffee', 'earth']), description: 'A bold, spicy robusto built around an Ecuador Corojo wrapper. Red pepper and cedar up front, softening into rich leather and coffee by the final third.', year_introduced: 2017 },
  { brand: 'Columbia Select', name: 'Broadleaf Maduro', country: 'Nicaragua', wrapper: 'Connecticut Broadleaf Maduro', binder: 'Nicaragua', filler: 'Nicaragua/Honduras', strength: 'full', flavor_notes: JSON.stringify(['dark chocolate', 'molasses', 'coffee', 'earth', 'leather']), description: 'Rich and indulgent. The Broadleaf Maduro rewards patience — flavors evolve and deepen as you smoke toward the nub.', year_introduced: 2015 },
  { brand: 'Columbia Select', name: 'Sun Grown Toro', country: 'Nicaragua', wrapper: 'Ecuador Sun Grown', binder: 'Nicaragua', filler: 'Nicaragua', strength: 'medium', flavor_notes: JSON.stringify(['earth', 'leather', 'nuts', 'coffee', 'spice']), description: 'A sun-grown Ecuador wrapper gives this toro unique rustic character. Well-rounded medium body with an earthy, leathery core.', year_introduced: 2019 },
  { brand: 'Columbia Select', name: 'Natural Lonsdale', country: 'Dominican Republic', wrapper: 'Ecuador Natural', binder: 'Dominican', filler: 'Dominican', strength: 'mild-medium', flavor_notes: JSON.stringify(['cream', 'cedar', 'nuts', 'honey', 'floral']), description: 'An elegant, understated lonsdale for those who like things smooth and refined. Light and airy with cream, cedar, and gentle floral notes.', year_introduced: 2016 },
  { brand: 'Columbia Select', name: 'Perfecto Reserve', country: 'Nicaragua', wrapper: 'Ecuador Habano', binder: 'Nicaragua', filler: 'Nicaragua/Dominican', strength: 'medium', flavor_notes: JSON.stringify(['cedar', 'leather', 'earth', 'nuts', 'coffee']), description: 'A rare perfecto shape that showcases the blender\'s art. The tapered ends create a unique draw profile — tighter up front, opening beautifully in the middle.', year_introduced: 2022 },
];

const vitolasMap = {
  'Pacific Premium - Morning Mist Robusto': [
    { name: 'Robusto', length: 5.0, ring_gauge: 50, msrp: 8 },
    { name: 'Toro', length: 6.0, ring_gauge: 52, msrp: 10 },
  ],
  'Pacific Premium - Coastline Toro': [
    { name: 'Robusto', length: 5.0, ring_gauge: 50, msrp: 9 },
    { name: 'Toro', length: 6.0, ring_gauge: 52, msrp: 11 },
    { name: 'Churchill', length: 7.0, ring_gauge: 48, msrp: 14 },
  ],
  'Pacific Premium - Reserve Maduro': [
    { name: 'Robusto', length: 5.0, ring_gauge: 50, msrp: 12 },
    { name: 'Toro', length: 6.0, ring_gauge: 52, msrp: 15 },
    { name: 'Gran Toro', length: 6.5, ring_gauge: 54, msrp: 17 },
  ],
  'Pacific Premium - Grand Churchill': [
    { name: 'Churchill', length: 7.0, ring_gauge: 48, msrp: 16 },
    { name: 'Toro', length: 6.0, ring_gauge: 52, msrp: 14 },
  ],
  'Pacific Premium - Torpedo Select': [
    { name: 'Torpedo', length: 6.0, ring_gauge: 52, msrp: 11 },
    { name: 'Short Torpedo', length: 5.0, ring_gauge: 52, msrp: 9 },
  ],
  'Cascade Valley - Harvest Robusto': [
    { name: 'Robusto', length: 5.0, ring_gauge: 50, msrp: 10 },
    { name: 'Toro', length: 6.0, ring_gauge: 52, msrp: 12 },
  ],
  'Cascade Valley - Ridge Runner Toro': [
    { name: 'Toro', length: 6.0, ring_gauge: 52, msrp: 14 },
    { name: 'Robusto', length: 5.0, ring_gauge: 50, msrp: 12 },
    { name: 'Torpedo', length: 6.25, ring_gauge: 52, msrp: 15 },
  ],
  'Cascade Valley - Summit Maduro': [
    { name: 'Robusto', length: 5.0, ring_gauge: 50, msrp: 13 },
    { name: 'Toro', length: 6.0, ring_gauge: 52, msrp: 16 },
    { name: 'Double Toro', length: 6.0, ring_gauge: 60, msrp: 18 },
  ],
  'Cascade Valley - Classic Lonsdale': [
    { name: 'Lonsdale', length: 6.5, ring_gauge: 44, msrp: 10 },
    { name: 'Corona', length: 5.5, ring_gauge: 44, msrp: 8 },
  ],
  'Cascade Valley - Late Season Corona': [
    { name: 'Corona', length: 5.5, ring_gauge: 42, msrp: 7 },
    { name: 'Robusto', length: 5.0, ring_gauge: 50, msrp: 9 },
  ],
  'Northwest Blend - Toro No.1': [
    { name: 'Toro', length: 6.0, ring_gauge: 52, msrp: 10 },
    { name: 'Robusto', length: 5.0, ring_gauge: 50, msrp: 8 },
    { name: 'Churchill', length: 7.0, ring_gauge: 48, msrp: 13 },
  ],
  'Northwest Blend - Robusto No.2': [
    { name: 'Robusto', length: 5.0, ring_gauge: 50, msrp: 9 },
    { name: 'Toro', length: 6.0, ring_gauge: 52, msrp: 11 },
  ],
  'Northwest Blend - Belicoso Reserve': [
    { name: 'Belicoso', length: 5.5, ring_gauge: 52, msrp: 14 },
    { name: 'Toro', length: 6.0, ring_gauge: 52, msrp: 15 },
    { name: 'Robusto', length: 5.0, ring_gauge: 50, msrp: 13 },
  ],
  'Northwest Blend - Gran Toro': [
    { name: 'Gran Toro', length: 6.0, ring_gauge: 60, msrp: 16 },
    { name: 'Toro', length: 6.0, ring_gauge: 52, msrp: 14 },
  ],
  'Northwest Blend - Morning Churchill': [
    { name: 'Churchill', length: 7.0, ring_gauge: 48, msrp: 13 },
    { name: 'Lonsdale', length: 6.5, ring_gauge: 44, msrp: 11 },
  ],
  'Pioneer Leaf - Natural Toro': [
    { name: 'Toro', length: 6.0, ring_gauge: 52, msrp: 9 },
    { name: 'Robusto', length: 5.0, ring_gauge: 50, msrp: 7 },
    { name: 'Churchill', length: 7.0, ring_gauge: 48, msrp: 11 },
  ],
  'Pioneer Leaf - Maduro Robusto': [
    { name: 'Robusto', length: 5.0, ring_gauge: 50, msrp: 11 },
    { name: 'Toro', length: 6.0, ring_gauge: 52, msrp: 13 },
    { name: 'Short Robusto', length: 4.5, ring_gauge: 50, msrp: 9 },
  ],
  'Pioneer Leaf - Connecticut Corona': [
    { name: 'Corona', length: 5.5, ring_gauge: 42, msrp: 7 },
    { name: 'Petit Corona', length: 4.5, ring_gauge: 42, msrp: 6 },
    { name: 'Lonsdale', length: 6.5, ring_gauge: 44, msrp: 9 },
  ],
  'Pioneer Leaf - Habano Torpedo': [
    { name: 'Torpedo', length: 6.0, ring_gauge: 52, msrp: 12 },
    { name: 'Belicoso', length: 5.5, ring_gauge: 52, msrp: 11 },
  ],
  'Pioneer Leaf - Reserve Churchill': [
    { name: 'Churchill', length: 7.0, ring_gauge: 48, msrp: 14 },
    { name: 'Toro', length: 6.0, ring_gauge: 52, msrp: 12 },
    { name: 'Robusto', length: 5.0, ring_gauge: 50, msrp: 10 },
  ],
  'Columbia Select - Corojo Robusto': [
    { name: 'Robusto', length: 5.0, ring_gauge: 50, msrp: 13 },
    { name: 'Toro', length: 6.0, ring_gauge: 52, msrp: 15 },
    { name: 'Torpedo', length: 6.25, ring_gauge: 52, msrp: 16 },
  ],
  'Columbia Select - Broadleaf Maduro': [
    { name: 'Toro', length: 6.0, ring_gauge: 52, msrp: 16 },
    { name: 'Robusto', length: 5.0, ring_gauge: 50, msrp: 14 },
    { name: 'Gran Toro', length: 6.5, ring_gauge: 54, msrp: 18 },
  ],
  'Columbia Select - Sun Grown Toro': [
    { name: 'Toro', length: 6.0, ring_gauge: 52, msrp: 12 },
    { name: 'Robusto', length: 5.0, ring_gauge: 50, msrp: 10 },
  ],
  'Columbia Select - Natural Lonsdale': [
    { name: 'Lonsdale', length: 6.5, ring_gauge: 44, msrp: 9 },
    { name: 'Corona', length: 5.5, ring_gauge: 42, msrp: 7 },
    { name: 'Churchill', length: 7.0, ring_gauge: 48, msrp: 12 },
  ],
  'Columbia Select - Perfecto Reserve': [
    { name: 'Perfecto', length: 5.5, ring_gauge: 50, msrp: 15 },
    { name: 'Gran Perfecto', length: 6.5, ring_gauge: 52, msrp: 18 },
  ],
};

async function seed() {
  const { rows } = await db.query('SELECT COUNT(*)::int AS count FROM users');
  if (rows[0].count > 0) {
    console.log('[seed] Database already has data — skipping seed.');
    return;
  }
  console.log('[seed] Empty database detected — seeding...');

  const hash = bcrypt.hashSync('password123', 10);
  const adminHash = bcrypt.hashSync('admin123', 10);

  const adminR = await db.run(`INSERT INTO users (email, password_hash, name, account_type) VALUES (?, ?, ?, ?) RETURNING id`,
    ['admin@cigarbuddy.com', adminHash, 'CigarBuddy Admin', 'admin']);
  const demoR = await db.run(`INSERT INTO users (email, password_hash, name, account_type, bio, location_city, location_state) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    ['smoker@demo.com', hash, 'Marcus Rivera', 'user', 'Passionate about medium-bodied blends and the occasional maduro. Portland native.', 'Portland', 'OR']);
  const user2R = await db.run(`INSERT INTO users (email, password_hash, name, account_type, bio, location_city, location_state) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    ['jane@demo.com', hash, 'Jane Calloway', 'user', 'New to cigars, learning fast. Love mild to medium sticks with coffee.', 'Vancouver', 'WA']);

  const su1R = await db.run(`INSERT INTO users (email, password_hash, name, account_type) VALUES (?, ?, ?, ?) RETURNING id`, ['store1@demo.com', hash, 'The Portland Humidor', 'store']);
  const su2R = await db.run(`INSERT INTO users (email, password_hash, name, account_type) VALUES (?, ?, ?, ?) RETURNING id`, ['store2@demo.com', hash, 'Cascade Smoke Shop', 'store']);
  const su3R = await db.run(`INSERT INTO users (email, password_hash, name, account_type) VALUES (?, ?, ?, ?) RETURNING id`, ['store3@demo.com', hash, 'Pearl District Tobacco', 'store']);
  const su4R = await db.run(`INSERT INTO users (email, password_hash, name, account_type) VALUES (?, ?, ?, ?) RETURNING id`, ['store4@demo.com', hash, 'Columbia Cigar Co.', 'store']);
  const su5R = await db.run(`INSERT INTO users (email, password_hash, name, account_type) VALUES (?, ?, ?, ?) RETURNING id`, ['store5@demo.com', hash, 'Lake Grove Cigars', 'store']);

  const uid = demoR.lastInsertRowid, uid2 = user2R.lastInsertRowid;

  const hoursDowntown = JSON.stringify({ Mon: '10am-8pm', Tue: '10am-8pm', Wed: '10am-8pm', Thu: '10am-9pm', Fri: '10am-10pm', Sat: '9am-10pm', Sun: '11am-7pm' });
  const hoursSE = JSON.stringify({ Mon: '11am-7pm', Tue: '11am-7pm', Wed: '11am-7pm', Thu: '11am-8pm', Fri: '11am-9pm', Sat: '10am-9pm', Sun: '12pm-6pm' });
  const hoursPearl = JSON.stringify({ Mon: 'Closed', Tue: '1pm-10pm', Wed: '1pm-10pm', Thu: '1pm-11pm', Fri: '12pm-12am', Sat: '11am-12am', Sun: '12pm-8pm' });
  const hoursVancouver = JSON.stringify({ Mon: '10am-7pm', Tue: '10am-7pm', Wed: '10am-7pm', Thu: '10am-7pm', Fri: '10am-8pm', Sat: '9am-8pm', Sun: '11am-5pm' });
  const hoursLakeGrove = JSON.stringify({ Mon: '11am-8pm', Tue: '11am-8pm', Wed: '11am-8pm', Thu: '11am-9pm', Fri: '11am-10pm', Sat: '10am-10pm', Sun: '12pm-7pm' });

  const s1R = await db.run(`INSERT INTO stores (user_id, name, description, address, city, state, zip, phone, website, hours, has_lounge, has_walk_in_humidor, tags, verified, setup_complete, lat, lng) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?) RETURNING id`,
    [su1R.lastInsertRowid, 'The Portland Humidor', 'Downtown Portland\'s premier cigar destination. Our 2,000 sq ft walk-in humidor is the largest in the Pacific Northwest. Weekly smoke nights every Thursday. Expert staff who actually smoke cigars.', '927 SW Morrison St', 'Portland', 'OR', '97205', '(503) 555-0927', 'portlandhumidor.com', hoursDowntown, 1, 1, JSON.stringify(['Walk-in Humidor', 'Lounge', 'Events', 'Accessories']), 1, 45.5193, -122.6817]);

  const s2R = await db.run(`INSERT INTO stores (user_id, name, description, address, city, state, zip, phone, website, hours, has_lounge, has_walk_in_humidor, tags, verified, setup_complete, lat, lng) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?) RETURNING id`,
    [su2R.lastInsertRowid, 'Cascade Smoke Shop', 'A no-frills neighborhood smoke shop on Hawthorne. Great prices, solid selection of everyday smokes. The kind of place where regulars have their own shelf. Cold beer in the fridge.', '3412 SE Hawthorne Blvd', 'Portland', 'OR', '97214', '(503) 555-3412', null, hoursSE, 0, 1, JSON.stringify(['Walk-in Humidor', 'Budget-Friendly', 'Neighborhood Vibe']), 0, 45.5121, -122.6317]);

  const s3R = await db.run(`INSERT INTO stores (user_id, name, description, address, city, state, zip, phone, website, hours, has_lounge, has_walk_in_humidor, tags, verified, setup_complete, lat, lng) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?) RETURNING id`,
    [su3R.lastInsertRowid, 'Pearl District Tobacco', 'Upscale cigar lounge and retail shop in the Pearl. Craft cocktail bar, private lockers, and a curated humidor focused on boutique and limited-edition blends. Members get early access to new arrivals.', '1242 NW Everett St', 'Portland', 'OR', '97209', '(503) 555-1242', 'pearldistrict.tobacco', hoursPearl, 1, 1, JSON.stringify(['Lounge', 'Craft Cocktails', 'Private Lockers', 'Boutique Blends', 'Members Club']), 1, 45.5284, -122.6822]);

  const s4R = await db.run(`INSERT INTO stores (user_id, name, description, address, city, state, zip, phone, website, hours, has_lounge, has_walk_in_humidor, tags, verified, setup_complete, lat, lng) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?) RETURNING id`,
    [su4R.lastInsertRowid, 'Columbia Cigar Co.', 'Vancouver\'s go-to cigar shop for over 15 years. Friendly staff, fair prices, and a solid everyday selection. No pretension — just good cigars. Walk-in humidor with over 150 SKUs.', '512 W 8th St', 'Vancouver', 'WA', '98660', '(360) 555-0512', 'columbiacigars.com', hoursVancouver, 0, 1, JSON.stringify(['Walk-in Humidor', 'Everyday Value', 'Accessories']), 1, 45.6275, -122.6739]);

  const s5R = await db.run(`INSERT INTO stores (user_id, name, description, address, city, state, zip, phone, website, hours, has_lounge, has_walk_in_humidor, tags, verified, setup_complete, lat, lng) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?) RETURNING id`,
    [su5R.lastInsertRowid, 'Lake Grove Cigars', 'A refined neighborhood lounge in Lake Oswego serving Portland\'s south suburbs. Whiskey selection, comfortable leather seating, and a focus on premium smokes. Monthly pairing events.', '15820 Boones Ferry Rd', 'Lake Oswego', 'OR', '97035', '(503) 555-5820', 'lakegrovecigars.com', hoursLakeGrove, 1, 1, JSON.stringify(['Lounge', 'Whiskey Bar', 'Walk-in Humidor', 'Events', 'Premium Selection']), 1, 45.4201, -122.7051]);

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

  // Store 1: The Portland Humidor — premium, broad selection
  await addToStore(store1Id, 'Pacific Premium - Reserve Maduro', 1);
  await addToStore(store1Id, 'Pacific Premium - Grand Churchill', 1);
  await addToStore(store1Id, 'Pacific Premium - Torpedo Select');
  await addToStore(store1Id, 'Pacific Premium - Coastline Toro');
  await addToStore(store1Id, 'Northwest Blend - Belicoso Reserve', 1);
  await addToStore(store1Id, 'Northwest Blend - Gran Toro');
  await addToStore(store1Id, 'Northwest Blend - Toro No.1');
  await addToStore(store1Id, 'Cascade Valley - Ridge Runner Toro', 0, 1);
  await addToStore(store1Id, 'Cascade Valley - Summit Maduro');
  await addToStore(store1Id, 'Columbia Select - Corojo Robusto', 1);
  await addToStore(store1Id, 'Columbia Select - Broadleaf Maduro', 1);
  await addToStore(store1Id, 'Columbia Select - Perfecto Reserve', 0, 1);
  await addToStore(store1Id, 'Pioneer Leaf - Reserve Churchill');
  await addToStore(store1Id, 'Pioneer Leaf - Habano Torpedo');

  // Store 2: Cascade Smoke Shop — everyday smokes, budget-friendly
  await addToStore(store2Id, 'Pacific Premium - Morning Mist Robusto', 1);
  await addToStore(store2Id, 'Pacific Premium - Coastline Toro', 1);
  await addToStore(store2Id, 'Cascade Valley - Harvest Robusto', 1);
  await addToStore(store2Id, 'Cascade Valley - Classic Lonsdale');
  await addToStore(store2Id, 'Cascade Valley - Late Season Corona');
  await addToStore(store2Id, 'Cascade Valley - Ridge Runner Toro');
  await addToStore(store2Id, 'Northwest Blend - Toro No.1', 0, 1);
  await addToStore(store2Id, 'Northwest Blend - Robusto No.2');
  await addToStore(store2Id, 'Northwest Blend - Morning Churchill');
  await addToStore(store2Id, 'Pioneer Leaf - Natural Toro', 1);
  await addToStore(store2Id, 'Pioneer Leaf - Connecticut Corona');
  await addToStore(store2Id, 'Pioneer Leaf - Maduro Robusto');

  // Store 3: Pearl District Tobacco — boutique, lounge-focused, bold selections
  await addToStore(store3Id, 'Columbia Select - Corojo Robusto', 1);
  await addToStore(store3Id, 'Columbia Select - Broadleaf Maduro', 1);
  await addToStore(store3Id, 'Columbia Select - Sun Grown Toro', 1, 1);
  await addToStore(store3Id, 'Columbia Select - Natural Lonsdale');
  await addToStore(store3Id, 'Columbia Select - Perfecto Reserve', 1);
  await addToStore(store3Id, 'Pacific Premium - Reserve Maduro');
  await addToStore(store3Id, 'Pacific Premium - Torpedo Select', 0, 1);
  await addToStore(store3Id, 'Northwest Blend - Belicoso Reserve', 1);
  await addToStore(store3Id, 'Northwest Blend - Gran Toro');
  await addToStore(store3Id, 'Pioneer Leaf - Habano Torpedo');
  await addToStore(store3Id, 'Pioneer Leaf - Reserve Churchill');
  await addToStore(store3Id, 'Cascade Valley - Summit Maduro', 0, 1);

  // Store 4: Columbia Cigar Co. (Vancouver, WA) — value-focused, everyday variety
  await addToStore(store4Id, 'Pioneer Leaf - Natural Toro', 1);
  await addToStore(store4Id, 'Pioneer Leaf - Connecticut Corona', 1);
  await addToStore(store4Id, 'Pioneer Leaf - Maduro Robusto');
  await addToStore(store4Id, 'Pioneer Leaf - Reserve Churchill');
  await addToStore(store4Id, 'Cascade Valley - Harvest Robusto', 1);
  await addToStore(store4Id, 'Cascade Valley - Classic Lonsdale');
  await addToStore(store4Id, 'Cascade Valley - Late Season Corona');
  await addToStore(store4Id, 'Cascade Valley - Ridge Runner Toro');
  await addToStore(store4Id, 'Northwest Blend - Toro No.1', 1);
  await addToStore(store4Id, 'Northwest Blend - Robusto No.2');
  await addToStore(store4Id, 'Northwest Blend - Morning Churchill', 0, 1);
  await addToStore(store4Id, 'Pacific Premium - Morning Mist Robusto');
  await addToStore(store4Id, 'Pacific Premium - Coastline Toro');

  // Store 5: Lake Grove Cigars — premium suburban lounge, curated
  await addToStore(store5Id, 'Pacific Premium - Grand Churchill', 1);
  await addToStore(store5Id, 'Pacific Premium - Reserve Maduro', 1);
  await addToStore(store5Id, 'Pacific Premium - Torpedo Select');
  await addToStore(store5Id, 'Columbia Select - Broadleaf Maduro', 1);
  await addToStore(store5Id, 'Columbia Select - Corojo Robusto', 1, 1);
  await addToStore(store5Id, 'Columbia Select - Perfecto Reserve');
  await addToStore(store5Id, 'Columbia Select - Sun Grown Toro');
  await addToStore(store5Id, 'Pioneer Leaf - Maduro Robusto');
  await addToStore(store5Id, 'Pioneer Leaf - Reserve Churchill', 0, 1);
  await addToStore(store5Id, 'Cascade Valley - Ridge Runner Toro');
  await addToStore(store5Id, 'Cascade Valley - Summit Maduro', 1);
  await addToStore(store5Id, 'Northwest Blend - Belicoso Reserve');
  await addToStore(store5Id, 'Northwest Blend - Gran Toro', 0, 1);

  // Reviews
  await db.run(`INSERT INTO reviews (user_id, cigar_id, vitola_id, rating, draw_rating, burn_rating, appearance_rating, flavor_notes, strength_experienced, smoke_time, pairing, review_text) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [uid, cigarIds['Pacific Premium - Reserve Maduro'], vitolaIds['Pacific Premium - Reserve Maduro'][0].id, 92, 5, 5, 4, JSON.stringify(['dark chocolate', 'espresso', 'leather']), 'medium-full', 65, 'Stumptown cold brew', 'Really solid maduro for the price. Dark chocolate up front, leather comes in around halfway. Burn was razor sharp. Pairs perfectly with cold brew — became one of my regular smokes.']);
  await db.run(`INSERT INTO reviews (user_id, cigar_id, vitola_id, rating, draw_rating, burn_rating, appearance_rating, flavor_notes, strength_experienced, smoke_time, pairing, review_text) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [uid, cigarIds['Columbia Select - Corojo Robusto'], vitolaIds['Columbia Select - Corojo Robusto'][0].id, 94, 5, 4, 5, JSON.stringify(['red pepper', 'cedar', 'leather', 'coffee']), 'medium-full', 60, 'Rye whiskey', 'The Corojo wrapper is the star here — punchy red pepper right away then settles into gorgeous leather and coffee. Construction was near perfect. Great with a rye whiskey.']);
  await db.run(`INSERT INTO reviews (user_id, cigar_id, vitola_id, rating, draw_rating, burn_rating, appearance_rating, flavor_notes, strength_experienced, smoke_time, pairing, review_text) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [uid, cigarIds['Cascade Valley - Ridge Runner Toro'], vitolaIds['Cascade Valley - Ridge Runner Toro'][0].id, 90, 4, 5, 4, JSON.stringify(['cocoa', 'leather', 'black pepper', 'earth']), 'medium-full', 70, 'Black coffee', 'Smoked this on my back porch during a rainy Portland evening. Exactly the right cigar for the mood. Cocoa and earth throughout, good construction, never went out on me.']);
  await db.run(`INSERT INTO reviews (user_id, cigar_id, vitola_id, rating, draw_rating, burn_rating, appearance_rating, flavor_notes, strength_experienced, smoke_time, pairing, review_text) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [uid, cigarIds['Northwest Blend - Toro No.1'], vitolaIds['Northwest Blend - Toro No.1'][0].id, 87, 5, 4, 4, JSON.stringify(['cedar', 'earth', 'nuts', 'pepper']), 'medium', 55, 'IPA', 'Great everyday smoke. Nothing flashy but reliable and consistent. Picked it up at Cascade Smoke Shop on a whim and was pleasantly surprised. Would buy a bundle.']);
  await db.run(`INSERT INTO reviews (user_id, cigar_id, vitola_id, rating, draw_rating, burn_rating, appearance_rating, flavor_notes, strength_experienced, smoke_time, pairing, review_text) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [uid2, cigarIds['Pacific Premium - Morning Mist Robusto'], vitolaIds['Pacific Premium - Morning Mist Robusto'][0].id, 88, 5, 5, 4, JSON.stringify(['cream', 'cedar', 'honey', 'floral']), 'mild', 45, 'Latte', 'My first ever cigar and it was amazing. So smooth, no harshness at all. The honey and floral notes were something I did not expect. The staff at Columbia Cigar helped me pick this one and they nailed it.']);
  await db.run(`INSERT INTO reviews (user_id, cigar_id, vitola_id, rating, draw_rating, burn_rating, appearance_rating, flavor_notes, strength_experienced, smoke_time, pairing, review_text) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [uid2, cigarIds['Cascade Valley - Classic Lonsdale'], vitolaIds['Cascade Valley - Classic Lonsdale'][0].id, 85, 4, 4, 5, JSON.stringify(['cream', 'cedar', 'nuts', 'honey']), 'mild-medium', 55, 'Herbal tea', 'Beautiful looking cigar. Smells amazing before you even light it. I am still new to this but the creamy nut flavors were exactly what I was looking for. Very forgiving smoke.']);
  await db.run(`INSERT INTO reviews (user_id, cigar_id, vitola_id, rating, draw_rating, burn_rating, appearance_rating, flavor_notes, strength_experienced, smoke_time, pairing, review_text) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [uid, cigarIds['Columbia Select - Broadleaf Maduro'], vitolaIds['Columbia Select - Broadleaf Maduro'][0].id, 96, 5, 5, 5, JSON.stringify(['dark chocolate', 'molasses', 'coffee', 'leather']), 'full', 80, 'Aged bourbon', 'Best maduro I have had in a long time. The molasses note on the retrohale is something else. Picked this up at Pearl District and the staff decanted it perfectly. Pairs unbelievably with bourbon.']);

  // Humidor items for demo users
  await db.run(`INSERT INTO user_cigars (user_id, cigar_id, vitola_id, status, quantity, purchase_price, purchase_date, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [uid, cigarIds['Pacific Premium - Reserve Maduro'], vitolaIds['Pacific Premium - Reserve Maduro'][1].id, 'humidor', 10, 14.50, '2026-05-10', 'Box purchase from Portland Humidor. Letting these rest a few months.']);
  await db.run(`INSERT INTO user_cigars (user_id, cigar_id, vitola_id, status, quantity, purchase_price, purchase_date, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [uid, cigarIds['Columbia Select - Corojo Robusto'], vitolaIds['Columbia Select - Corojo Robusto'][0].id, 'humidor', 5, 13.00, '2026-06-01', 'Great after-dinner smoke.']);
  await db.run(`INSERT INTO user_cigars (user_id, cigar_id, vitola_id, status, quantity, purchase_price, purchase_date, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [uid, cigarIds['Northwest Blend - Belicoso Reserve'], vitolaIds['Northwest Blend - Belicoso Reserve'][0].id, 'humidor', 3, 13.50, '2026-06-10', 'Picked up at a Thursday smoke night.']);
  await db.run(`INSERT INTO user_cigars (user_id, cigar_id, vitola_id, status, quantity, purchase_price, purchase_date, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [uid, cigarIds['Cascade Valley - Ridge Runner Toro'], vitolaIds['Cascade Valley - Ridge Runner Toro'][0].id, 'smoked', 1, 13.00, '2026-05-25', 'Rainy porch smoke. Perfect.']);
  await db.run(`INSERT INTO user_cigars (user_id, cigar_id, vitola_id, status, quantity, purchase_price, purchase_date, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [uid, cigarIds['Columbia Select - Broadleaf Maduro'], vitolaIds['Columbia Select - Broadleaf Maduro'][0].id, 'wishlist', 1, null, null, 'Need to grab a box of these from Pearl District.']);
  await db.run(`INSERT INTO user_cigars (user_id, cigar_id, vitola_id, status, quantity, purchase_price, purchase_date, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [uid2, cigarIds['Pacific Premium - Morning Mist Robusto'], vitolaIds['Pacific Premium - Morning Mist Robusto'][0].id, 'humidor', 5, 7.50, '2026-06-15', 'My go-to. Always keeping 5 on hand.']);
  await db.run(`INSERT INTO user_cigars (user_id, cigar_id, vitola_id, status, quantity, purchase_price, purchase_date, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [uid2, cigarIds['Cascade Valley - Classic Lonsdale'], vitolaIds['Cascade Valley - Classic Lonsdale'][0].id, 'humidor', 3, 9.50, '2026-06-20', 'Second purchase. Love these.']);

  // Store follows
  for (const [userId, storeId] of [[uid, store1Id], [uid, store3Id], [uid, store5Id], [uid2, store4Id], [uid2, store2Id], [uid2, store1Id]]) {
    await db.run('INSERT INTO store_follows (user_id, store_id, notify_broadcasts, notify_deals, notify_new_arrivals) VALUES (?, ?, 1, 1, 1)', [userId, storeId]);
  }

  // Deals
  await db.run(`INSERT INTO deals (store_id, title, description, discount_percent, cigar_id, expires_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [store1Id, 'Thursday Smoke Night — June 26th', 'Join us this Thursday for our weekly smoke night. Featured cigar: Columbia Select Corojo Robusto. $5 off this stick all night, plus drink specials. No RSVP needed.', null, cigarIds['Columbia Select - Corojo Robusto'], '2026-07-01']);
  await db.run(`INSERT INTO deals (store_id, title, description, discount_percent, cigar_id, expires_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [store2Id, '5 for $35 — Northwest Blend Toro No.1', 'Stock up on the most popular everyday smoke in Portland. Buy 5 Northwest Blend Toro No.1 singles for $35 — that\'s $7 each. This week only.', null, cigarIds['Northwest Blend - Toro No.1'], '2026-07-05']);
  await db.run(`INSERT INTO deals (store_id, title, description, discount_percent, cigar_id, expires_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [store3Id, 'New Arrival: Columbia Select Sun Grown Toro', 'Just landed — the Columbia Select Sun Grown Toro. Ecuador sun-grown wrapper, medium body, complex earthy profile. First week price: $10.50.', null, cigarIds['Columbia Select - Sun Grown Toro'], '2026-07-10']);
  await db.run(`INSERT INTO deals (store_id, title, description, discount_percent, cigar_id, expires_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [store4Id, '10% Off All Pioneer Leaf Singles', 'Celebrating 15 years in Vancouver! 10% off every Pioneer Leaf single this weekend — Sat and Sun only. No purchase minimum.', 10, null, '2026-06-29']);
  await db.run(`INSERT INTO deals (store_id, title, description, discount_percent, cigar_id, expires_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [store5Id, 'Monthly Pairing Night — Bourbon & Maduro', 'Join us July 12th for our bourbon and maduro pairing event. Three cigars, three bourbons, guided tasting notes. $55 per person. Limited to 20 seats — book early.', null, cigarIds['Columbia Select - Broadleaf Maduro'], '2026-07-12']);

  // Store ratings
  await db.run(`INSERT INTO store_ratings (user_id, store_id, rating, comment) VALUES (?, ?, ?, ?)`, [uid, store1Id, 5, 'Best walk-in humidor in the city. Staff is incredibly knowledgeable and never pushy. Thursday smoke nights are a highlight of my week.']);
  await db.run(`INSERT INTO store_ratings (user_id, store_id, rating, comment) VALUES (?, ?, ?, ?)`, [uid, store3Id, 5, 'The lounge at Pearl District is unmatched. Cocktails are great, selection is curated, and the atmosphere is exactly what you want.']);
  await db.run(`INSERT INTO store_ratings (user_id, store_id, rating, comment) VALUES (?, ?, ?, ?)`, [uid, store5Id, 4, 'Great whiskey selection and comfortable seating. A bit of a drive from Portland proper but absolutely worth it.']);
  await db.run(`INSERT INTO store_ratings (user_id, store_id, rating, comment) VALUES (?, ?, ?, ?)`, [uid2, store4Id, 5, 'Everyone was so helpful when I was just starting out. Never made me feel like a newbie. Great prices too.']);
  await db.run(`INSERT INTO store_ratings (user_id, store_id, rating, comment) VALUES (?, ?, ?, ?)`, [uid2, store2Id, 4, 'No frills but exactly what you need. Cold beer in the fridge, solid prices, and the regulars are friendly.']);
  await db.run(`INSERT INTO store_ratings (user_id, store_id, rating, comment) VALUES (?, ?, ?, ?)`, [uid2, store1Id, 5, 'Huge humidor, great staff, and the smoke nights are super welcoming for newer folks like me.']);

  // Store views (last 14 days)
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
    [store1Id, 'New Arrival: Columbia Select Perfecto Reserve', 'Just got in a fresh batch of the Columbia Select Perfecto Reserve — one of the most unique shapes we carry. Limited quantity. Come in or call ahead.', 'new_arrival', cigarIds['Columbia Select - Perfecto Reserve']]);
  await db.run(`INSERT INTO notifications (store_id, title, message, type, cigar_id) VALUES (?, ?, ?, ?, ?)`,
    [store2Id, 'Northwest Blend Toro No.1 Back in Full Stock', 'We restocked the shelves with Northwest Blend Toro No.1 — our best-selling everyday smoke. Fresh rotation just hit the humidor.', 'new_arrival', cigarIds['Northwest Blend - Toro No.1']]);
  await db.run(`INSERT INTO notifications (store_id, title, message, type, cigar_id) VALUES (?, ?, ?, ?, ?)`,
    [store3Id, 'Members: Early Access to Sun Grown Toro', 'Pearl District members get 48-hour early access to our new Columbia Select Sun Grown Toro before it opens to the public. Stop by or call to hold yours.', 'announcement', cigarIds['Columbia Select - Sun Grown Toro']]);
  await db.run(`INSERT INTO notifications (store_id, title, message, type, cigar_id) VALUES (?, ?, ?, ?, ?)`,
    [store4Id, '15th Anniversary Weekend — 10% Off Everything', 'Columbia Cigar Co. turns 15 this weekend! Celebrating with 10% off all singles Saturday and Sunday. Thanks for 15 years of support, Vancouver.', 'deal', null]);
  await db.run(`INSERT INTO notifications (store_id, title, message, type, cigar_id) VALUES (?, ?, ?, ?, ?)`,
    [store5Id, 'July Pairing Night Tickets Now Available', 'Our July bourbon and maduro pairing night is filling up fast. Only 8 seats left. $55 includes three cigars and three bourbons with guided tasting notes.', 'event', null]);

  // Smoke list
  await db.run(`INSERT INTO smoke_list (user_id, cigar_id, priority, notes, recommended_by, status) VALUES (?, ?, ?, ?, ?, 'pending')`,
    [uid, cigarIds['Columbia Select - Broadleaf Maduro'], 'high', 'Everyone at Thursday smoke night raves about this. Need to try the Gran Toro size.', 'Staff at Portland Humidor']);
  await db.run(`INSERT INTO smoke_list (user_id, cigar_id, priority, notes, recommended_by, status) VALUES (?, ?, ?, ?, ?, 'pending')`,
    [uid, cigarIds['Columbia Select - Perfecto Reserve'], 'high', 'The perfecto shape intrigues me. Never smoked one before.', null]);
  await db.run(`INSERT INTO smoke_list (user_id, cigar_id, priority, notes, recommended_by, status) VALUES (?, ?, ?, ?, ?, 'pending')`,
    [uid, cigarIds['Pacific Premium - Grand Churchill'], 'medium', 'Saving for a long Saturday afternoon session.', 'Spotted at Lake Grove']);
  await db.run(`INSERT INTO smoke_list (user_id, cigar_id, priority, notes, recommended_by, status) VALUES (?, ?, ?, ?, ?, 'pending')`,
    [uid, cigarIds['Pioneer Leaf - Habano Torpedo'], 'medium', 'Heard the torpedo cuts really well with this blend.', 'Forum recommendation']);
  await db.run(`INSERT INTO smoke_list (user_id, cigar_id, priority, notes, recommended_by, status) VALUES (?, ?, ?, ?, ?, 'pending')`,
    [uid, cigarIds['Cascade Valley - Summit Maduro'], 'low', 'Want to compare this to the Pacific Premium Reserve Maduro side by side.', null]);
  await db.run(`INSERT INTO smoke_list (user_id, cigar_id, priority, notes, recommended_by, status) VALUES (?, ?, ?, ?, ?, 'pending')`,
    [uid2, cigarIds['Pacific Premium - Coastline Toro'], 'high', 'Stepping up from the Morning Mist. This seems like the natural next one.', 'Staff at Columbia Cigar Co.']);
  await db.run(`INSERT INTO smoke_list (user_id, cigar_id, priority, notes, recommended_by, status) VALUES (?, ?, ?, ?, ?, 'pending')`,
    [uid2, cigarIds['Northwest Blend - Robusto No.2'], 'medium', 'Heard it is a bit bolder than my usual but approachable. Want to try.', 'Jane\'s friend at work']);
  await db.run(`INSERT INTO smoke_list (user_id, cigar_id, priority, notes, recommended_by, status) VALUES (?, ?, ?, ?, ?, 'pending')`,
    [uid2, cigarIds['Cascade Valley - Late Season Corona'], 'low', 'Short smoke for busy evenings. Seems perfect.', null]);

  // Verification requests
  await db.run(`INSERT INTO verification_requests (store_id, business_name, business_ein, business_phone, business_address, business_website, license_number, notes, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [store2Id, 'Cascade Smoke Shop LLC', '91-2345678', '(503) 555-3412', '3412 SE Hawthorne Blvd, Portland, OR 97214', null, 'OR-TB-2009-00341', 'Independent shop operating since 2009. Oregon state tobacco retail license attached.', 'pending']);

  console.log('\n✅ Seed complete!');
  console.log('\nDemo accounts:');
  console.log('  Smoker:  smoker@demo.com / password123 (Marcus Rivera — Portland, OR)');
  console.log('  User 2:  jane@demo.com / password123 (Jane Calloway — Vancouver, WA)');
  console.log('  Store 1: store1@demo.com / password123 (The Portland Humidor — Downtown Portland)');
  console.log('  Store 2: store2@demo.com / password123 (Cascade Smoke Shop — SE Portland)');
  console.log('  Store 3: store3@demo.com / password123 (Pearl District Tobacco — NW Portland)');
  console.log('  Store 4: store4@demo.com / password123 (Columbia Cigar Co. — Vancouver, WA)');
  console.log('  Store 5: store5@demo.com / password123 (Lake Grove Cigars — Lake Oswego)');
  console.log('  Admin:   admin@cigarbuddy.com / admin123');

  console.log('[seed] Done.');
}

module.exports = { seed };

// Allow running directly: node seed.js
if (require.main === module) {
  initSchema().then(seed).then(() => db.pool.end()).catch(err => { console.error(err); process.exit(1); });
}
