const db = require('./db');
const { initSchema } = require('./schema');
const bcrypt = require('bcryptjs');

initSchema();

const cigars = [
  { brand: 'Arturo Fuente', name: 'Hemingway Short Story', country: 'Dominican Republic', wrapper: 'Cameroon', binder: 'Dominican', filler: 'Dominican', strength: 'medium', flavor_notes: JSON.stringify(['cedar', 'cream', 'nuts', 'coffee', 'leather']), description: 'One of the most iconic figurados in the world. The Hemingway series is a testament to the Fuente family\'s artistry. Complex, creamy, and perfectly balanced.', year_introduced: 1982 },
  { brand: 'Arturo Fuente', name: 'Opus X', country: 'Dominican Republic', wrapper: 'Dominican Rosado', binder: 'Dominican', filler: 'Dominican', strength: 'medium-full', flavor_notes: JSON.stringify(['spice', 'cedar', 'chocolate', 'leather', 'coffee']), description: 'The holy grail of Dominican cigars. Carlos Fuente Jr. broke the mold by growing wrapper tobacco in the Dominican Republic — something many said was impossible.', year_introduced: 1995 },
  { brand: 'Padron', name: '1964 Anniversary', country: 'Nicaragua', wrapper: 'Nicaragua Maduro', binder: 'Nicaragua', filler: 'Nicaragua', strength: 'full', flavor_notes: JSON.stringify(['chocolate', 'coffee', 'earth', 'pepper', 'leather']), description: 'Released in 1994 to celebrate the company\'s 30th anniversary. Widely regarded as one of the finest cigars ever made.', year_introduced: 1994 },
  { brand: 'Padron', name: '1926 Serie No. 1', country: 'Nicaragua', wrapper: 'Nicaragua Natural', binder: 'Nicaragua', filler: 'Nicaragua', strength: 'full', flavor_notes: JSON.stringify(['cocoa', 'espresso', 'nuts', 'spice', 'earth']), description: 'Named for Jose Orlando Padron\'s birth year. The pinnacle of the Padron portfolio, released only for special occasions.', year_introduced: 1994 },
  { brand: 'Liga Privada', name: 'No. 9', country: 'Nicaragua', wrapper: 'Connecticut Habano Stalk-Cut', binder: 'Honduran', filler: 'Nicaraguan/Honduran', strength: 'full', flavor_notes: JSON.stringify(['dark chocolate', 'espresso', 'earth', 'leather', 'pepper', 'cream']), description: 'Originally crafted for Drew Estate\'s private smoking club. Its complex, dark flavor profile has made it a modern classic.', year_introduced: 2008 },
  { brand: 'Liga Privada', name: 'T52', country: 'Nicaragua', wrapper: 'Connecticut Broadleaf Stalk-Cut', binder: 'Costa Rican', filler: 'Nicaraguan', strength: 'full', flavor_notes: JSON.stringify(['dark fruit', 'cocoa', 'leather', 'espresso', 'earth']), description: 'Features a rare stalk-cut Connecticut Broadleaf wrapper. Rich, complex, and undeniably impressive.', year_introduced: 2009 },
  { brand: 'My Father', name: 'Le Bijou 1922', country: 'Nicaragua', wrapper: 'Ecuador Habano', binder: 'Nicaragua', filler: 'Nicaragua', strength: 'full', flavor_notes: JSON.stringify(['black pepper', 'cocoa', 'coffee', 'cedar', 'leather']), description: 'Named for the year of Jose "Pepin" Garcia\'s grandfather\'s birth. Exceptional construction and flavor.', year_introduced: 2010 },
  { brand: 'My Father', name: 'Flor de las Antillas', country: 'Nicaragua', wrapper: 'Ecuador Habano', binder: 'Nicaragua', filler: 'Nicaragua', strength: 'medium-full', flavor_notes: JSON.stringify(['cedar', 'cream', 'leather', 'coffee', 'spice']), description: 'Cigar Aficionado\'s Cigar of the Year in 2012. Complex and refined at an approachable price point.', year_introduced: 2011 },
  { brand: 'Davidoff', name: 'Millennium Blend', country: 'Dominican Republic', wrapper: 'Ecuador', binder: 'Dominican', filler: 'Dominican', strength: 'mild-medium', flavor_notes: JSON.stringify(['cream', 'nuts', 'cedar', 'floral', 'honey']), description: 'A refined, elegant cigar representing the best of Dominican craftsmanship. Creamy, nuanced, and impeccably constructed.', year_introduced: 2000 },
  { brand: 'Davidoff', name: 'Escurio', country: 'Dominican Republic', wrapper: 'Brazil Mata Fina Maduro', binder: 'Dominican', filler: 'Brazilian/Dominican/Peruvian', strength: 'medium-full', flavor_notes: JSON.stringify(['cocoa', 'coffee', 'dark fruit', 'leather', 'earth']), description: 'Davidoff\'s bold departure into darker territory. Features a Brazilian Mata Fina maduro wrapper.', year_introduced: 2015 },
  { brand: 'Romeo y Julieta', name: 'Reserva Real', country: 'Honduras', wrapper: 'Ecuador', binder: 'Honduras', filler: 'Honduras/Nicaragua', strength: 'mild-medium', flavor_notes: JSON.stringify(['cedar', 'cream', 'nuts', 'honey', 'floral']), description: 'A refined, accessible smoke perfect for newer cigar enthusiasts. Consistently smooth with excellent construction.', year_introduced: 1997 },
  { brand: 'Oliva', name: 'Serie V Melanio', country: 'Nicaragua', wrapper: 'Ecuador Sumatra', binder: 'Nicaragua', filler: 'Nicaragua', strength: 'full', flavor_notes: JSON.stringify(['dark chocolate', 'pepper', 'coffee', 'leather', 'nuts']), description: 'Named after Melanio Oliva. Won Cigar Aficionado\'s Cigar of the Year in 2013.', year_introduced: 2012 },
  { brand: 'Oliva', name: 'Serie G Maduro', country: 'Nicaragua', wrapper: 'Connecticut Broadleaf Maduro', binder: 'Nicaragua', filler: 'Nicaragua', strength: 'medium-full', flavor_notes: JSON.stringify(['chocolate', 'coffee', 'cedar', 'earth', 'cream']), description: 'Fantastic value for a top-tier Nicaraguan puro. Rich and complex with Oliva\'s signature backbone.', year_introduced: 2004 },
  { brand: 'Cohiba', name: 'Blue', country: 'Dominican Republic', wrapper: 'Ecuador', binder: 'Dominican', filler: 'Dominican', strength: 'medium', flavor_notes: JSON.stringify(['cedar', 'leather', 'spice', 'cream', 'nuts']), description: 'The US Cohiba offers a refined, medium-bodied smoke with excellent Dominican tobaccos.', year_introduced: 1997 },
  { brand: 'Rocky Patel', name: 'Vintage 1990', country: 'Honduras', wrapper: 'Ecuador', binder: 'Nicaragua', filler: 'Honduras/Nicaragua', strength: 'medium', flavor_notes: JSON.stringify(['cedar', 'coffee', 'leather', 'spice', 'nuts']), description: 'Named for the year the filler tobacco was harvested. A staple known for its balance and smoothness.', year_introduced: 2001 },
  { brand: 'Perdomo', name: 'Reserve 10th Anniversary Maduro', country: 'Nicaragua', wrapper: 'Nicaragua Maduro', binder: 'Nicaragua', filler: 'Nicaragua', strength: 'medium-full', flavor_notes: JSON.stringify(['chocolate', 'coffee', 'earth', 'leather', 'spice']), description: 'Celebrating Perdomo\'s 10th anniversary with one of their finest Nicaraguan puros. Rich and bold.', year_introduced: 2002 },
  { brand: 'Ashton', name: 'VSG', country: 'Dominican Republic', wrapper: 'Ecuador Sungrown', binder: 'Dominican', filler: 'Dominican', strength: 'medium-full', flavor_notes: JSON.stringify(['cedar', 'leather', 'cocoa', 'spice', 'earth']), description: 'Ashton\'s Vintage Sungrown stands among the finest Dominican blends. Complex, elegant, and richly satisfying.', year_introduced: 1997 },
  { brand: 'Macanudo', name: 'Inspirado White', country: 'Dominican Republic', wrapper: 'Ecuador Connecticut', binder: 'Dominican', filler: 'Dominican', strength: 'mild', flavor_notes: JSON.stringify(['cream', 'honey', 'cedar', 'floral', 'nuts']), description: 'A silky smooth introduction to premium cigars. The Inspirado White is approachable and beautifully constructed.', year_introduced: 2015 },
];

const vitolasMap = {
  'Arturo Fuente - Hemingway Short Story': [{ name: 'Short Story', length: 4.0, ring_gauge: 49, msrp: 12 }, { name: 'Masterpiece', length: 9.0, ring_gauge: 52, msrp: 28 }, { name: 'Best Seller', length: 6.0, ring_gauge: 47, msrp: 15 }],
  'Arturo Fuente - Opus X': [{ name: 'Robusto', length: 5.0, ring_gauge: 50, msrp: 42 }, { name: 'Toro', length: 6.0, ring_gauge: 52, msrp: 50 }, { name: 'Churchill', length: 7.0, ring_gauge: 48, msrp: 58 }, { name: 'Perfecxion No. 2', length: 6.0, ring_gauge: 52, msrp: 55 }],
  'Padron - 1964 Anniversary': [{ name: 'Robusto', length: 5.0, ring_gauge: 50, msrp: 22 }, { name: 'Toro', length: 6.0, ring_gauge: 52, msrp: 26 }, { name: 'Imperial', length: 7.0, ring_gauge: 54, msrp: 30 }, { name: 'Hermoso', length: 5.75, ring_gauge: 52, msrp: 25 }, { name: 'Presidente', length: 8.5, ring_gauge: 52, msrp: 35 }],
  'Padron - 1926 Serie No. 1': [{ name: 'No. 1', length: 6.25, ring_gauge: 54, msrp: 35 }, { name: 'No. 2', length: 5.5, ring_gauge: 54, msrp: 32 }, { name: 'No. 9', length: 5.0, ring_gauge: 56, msrp: 30 }, { name: '80 Anos', length: 6.0, ring_gauge: 54, msrp: 55 }],
  'Liga Privada - No. 9': [{ name: 'Robusto', length: 5.0, ring_gauge: 52, msrp: 20 }, { name: 'Toro', length: 6.0, ring_gauge: 52, msrp: 23 }, { name: 'Churchill', length: 7.0, ring_gauge: 50, msrp: 28 }, { name: 'Corona Viva', length: 5.75, ring_gauge: 46, msrp: 19 }],
  'Liga Privada - T52': [{ name: 'Robusto', length: 5.0, ring_gauge: 52, msrp: 20 }, { name: 'Toro', length: 6.0, ring_gauge: 52, msrp: 23 }, { name: 'Flying Pig', length: 4.5, ring_gauge: 60, msrp: 22 }],
  'My Father - Le Bijou 1922': [{ name: 'Robusto', length: 5.0, ring_gauge: 52, msrp: 15 }, { name: 'Toro', length: 6.0, ring_gauge: 52, msrp: 18 }, { name: 'Churchill', length: 7.0, ring_gauge: 50, msrp: 22 }, { name: 'Torpedo', length: 6.25, ring_gauge: 54, msrp: 19 }],
  'My Father - Flor de las Antillas': [{ name: 'Robusto', length: 5.0, ring_gauge: 50, msrp: 11 }, { name: 'Toro', length: 6.0, ring_gauge: 52, msrp: 13 }, { name: 'Churchill', length: 7.0, ring_gauge: 48, msrp: 15 }, { name: 'Gran Toro', length: 6.5, ring_gauge: 54, msrp: 14 }],
  'Davidoff - Millennium Blend': [{ name: 'Robusto', length: 5.0, ring_gauge: 50, msrp: 22 }, { name: 'Toro', length: 6.0, ring_gauge: 52, msrp: 28 }, { name: 'Lonsdale', length: 6.75, ring_gauge: 44, msrp: 25 }],
  'Davidoff - Escurio': [{ name: 'Robusto', length: 5.0, ring_gauge: 50, msrp: 26 }, { name: 'Gran Toro', length: 6.0, ring_gauge: 54, msrp: 32 }, { name: 'Churchill', length: 7.0, ring_gauge: 48, msrp: 36 }],
  'Romeo y Julieta - Reserva Real': [{ name: 'Robusto', length: 5.0, ring_gauge: 50, msrp: 9 }, { name: 'Toro', length: 6.0, ring_gauge: 50, msrp: 11 }, { name: 'Churchill', length: 7.0, ring_gauge: 48, msrp: 13 }],
  'Oliva - Serie V Melanio': [{ name: 'Robusto', length: 5.0, ring_gauge: 50, msrp: 18 }, { name: 'Toro', length: 6.0, ring_gauge: 52, msrp: 21 }, { name: 'Figurado', length: 6.5, ring_gauge: 52, msrp: 22 }, { name: 'Churchill', length: 7.0, ring_gauge: 47, msrp: 24 }, { name: 'Gran Reserva', length: 7.0, ring_gauge: 58, msrp: 30 }],
  'Oliva - Serie G Maduro': [{ name: 'Robusto', length: 5.0, ring_gauge: 50, msrp: 9 }, { name: 'Toro', length: 6.0, ring_gauge: 52, msrp: 11 }, { name: 'Churchill', length: 7.0, ring_gauge: 48, msrp: 13 }],
  'Cohiba - Blue': [{ name: 'Robusto', length: 5.0, ring_gauge: 50, msrp: 12 }, { name: 'Toro', length: 6.0, ring_gauge: 52, msrp: 14 }, { name: 'Churchill', length: 7.0, ring_gauge: 48, msrp: 18 }],
  'Rocky Patel - Vintage 1990': [{ name: 'Robusto', length: 5.0, ring_gauge: 50, msrp: 10 }, { name: 'Toro', length: 6.0, ring_gauge: 52, msrp: 12 }, { name: 'Churchill', length: 7.0, ring_gauge: 48, msrp: 14 }, { name: 'Torpedo', length: 6.5, ring_gauge: 52, msrp: 13 }],
  'Perdomo - Reserve 10th Anniversary Maduro': [{ name: 'Robusto', length: 5.0, ring_gauge: 50, msrp: 11 }, { name: 'Toro', length: 6.0, ring_gauge: 52, msrp: 13 }, { name: 'Churchill', length: 7.0, ring_gauge: 48, msrp: 15 }],
  'Ashton - VSG': [{ name: 'Robusto', length: 5.0, ring_gauge: 50, msrp: 18 }, { name: 'Toro', length: 6.0, ring_gauge: 52, msrp: 22 }, { name: 'Churchill', length: 7.25, ring_gauge: 52, msrp: 25 }, { name: 'Torpedo', length: 6.0, ring_gauge: 52, msrp: 22 }],
  'Macanudo - Inspirado White': [{ name: 'Robusto', length: 5.0, ring_gauge: 50, msrp: 9 }, { name: 'Toro', length: 6.0, ring_gauge: 52, msrp: 11 }, { name: 'Corona', length: 5.5, ring_gauge: 42, msrp: 8 }],
};

function seed() {
  console.log('Seeding database...');
  db.exec(`
    DELETE FROM notification_reads; DELETE FROM notifications; DELETE FROM store_ratings;
    DELETE FROM store_views; DELETE FROM deals; DELETE FROM store_follows; DELETE FROM reviews;
    DELETE FROM user_cigars; DELETE FROM inventory; DELETE FROM vitolas;
    DELETE FROM cigars; DELETE FROM stores; DELETE FROM users;
  `);

  const hash = bcrypt.hashSync('password123', 10);
  const adminHash = bcrypt.hashSync('admin123', 10);
  const insertUser = db.prepare(`INSERT INTO users (email, password_hash, name, account_type, bio, location_city, location_state) VALUES (?, ?, ?, ?, ?, ?, ?)`);

  insertUser.run('admin@cigarbuddy.com', adminHash, 'CigarBuddy Admin', 'admin', null, null, null);
  const demoUser = insertUser.run('smoker@demo.com', hash, 'Marcus Rivera', 'user', 'Passionate about Nicaraguan puros and aged Dominican blends. Humidor capacity: 200.', 'New Orleans', 'LA');
  const user2 = insertUser.run('jane@demo.com', hash, 'Jane Calloway', 'user', 'New to cigars. Love mild to medium sticks. Always looking for recommendations.', 'Atlanta', 'GA');
  const storeUser1 = insertUser.run('store1@demo.com', hash, 'The Cigar Vault', 'store', null, null, null);
  const storeUser2 = insertUser.run('store2@demo.com', hash, 'Smoke & Ember Lounge', 'store', null, null, null);
  const storeUser3 = insertUser.run('store3@demo.com', hash, "Hemingway's Tobacconist", 'store', null, null, null);
  const storeUser4 = insertUser.run('store4@demo.com', hash, 'The Smoking Jacket', 'store', null, null, null);

  const insertStore = db.prepare(`
    INSERT INTO stores (user_id, name, description, address, city, state, zip, phone, website, hours, has_lounge, has_walk_in_humidor, tags, verified, setup_complete)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `);

  const hoursWeekday = JSON.stringify({ Mon: '10am-8pm', Tue: '10am-8pm', Wed: '10am-8pm', Thu: '10am-10pm', Fri: '10am-10pm', Sat: '9am-10pm', Sun: '11am-7pm' });
  const hoursLounge = JSON.stringify({ Mon: 'Closed', Tue: '2pm-11pm', Wed: '2pm-11pm', Thu: '2pm-12am', Fri: '12pm-2am', Sat: '12pm-2am', Sun: '1pm-9pm' });
  const hoursMiami = JSON.stringify({ Mon: '10am-9pm', Tue: '10am-9pm', Wed: '10am-9pm', Thu: '10am-9pm', Fri: '10am-10pm', Sat: '9am-11pm', Sun: '10am-8pm' });
  const hoursChicago = JSON.stringify({ Mon: '11am-7pm', Tue: '11am-7pm', Wed: '11am-7pm', Thu: '11am-8pm', Fri: '11am-9pm', Sat: '10am-9pm', Sun: '12pm-6pm' });

  const s1 = insertStore.run(storeUser1.lastInsertRowid, 'The Cigar Vault', 'Premium cigars and accessories in the heart of downtown. Our walk-in humidor houses over 2,000 SKUs. Weekly smoke nights every Thursday at 7pm.', '142 Bourbon Street', 'New Orleans', 'LA', '70130', '(504) 555-0142', 'thecigarvault.com', hoursWeekday, 0, 1, JSON.stringify(['Walk-in Humidor', 'Accessories', 'Events']), 1);
  const s2 = insertStore.run(storeUser2.lastInsertRowid, 'Smoke & Ember Lounge', 'A world-class cigar lounge with a full craft cocktail bar. Monthly pairing events, exclusive releases, and a curated walk-in humidor. Our lounge seats 40 guests.', '88 Peachtree Pl NW', 'Atlanta', 'GA', '30309', '(404) 555-0088', 'smokeandemberatl.com', hoursLounge, 1, 1, JSON.stringify(['Lounge', 'Bar', 'Walk-in Humidor', 'Events', 'Rare Finds']), 1);
  const s3 = insertStore.run(storeUser3.lastInsertRowid, "Hemingway's Tobacconist", 'Old-world tobacconist with roots going back to 1978. Specializing in rare and vintage cigars, custom humidors, and expert consultations. The most knowledgeable staff in South Florida.', '2240 Collins Ave', 'Miami Beach', 'FL', '33139', '(305) 555-2240', 'hemingwaystobacconist.com', hoursMiami, 0, 1, JSON.stringify(['Rare Finds', 'Walk-in Humidor', 'Accessories', 'Custom Humidors']), 1);
  const s4 = insertStore.run(storeUser4.lastInsertRowid, 'The Smoking Jacket', 'Chicago\'s premier cigar boutique and lounge. Curated selection of premium sticks, whiskey lounge, and a private members club. Home to the monthly "Gentleman\'s Night" tasting event.', '875 N Michigan Ave', 'Chicago', 'IL', '60611', '(312) 555-0875', 'thesmokingjacket.com', hoursChicago, 1, 1, JSON.stringify(['Lounge', 'Members Club', 'Whiskey Bar', 'Walk-in Humidor']), 1);

  const store1Id = s1.lastInsertRowid, store2Id = s2.lastInsertRowid, store3Id = s3.lastInsertRowid, store4Id = s4.lastInsertRowid;

  // Insert cigars
  const insertCigar = db.prepare(`INSERT INTO cigars (brand, name, country, wrapper, binder, filler, strength, flavor_notes, description, year_introduced) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertVitola = db.prepare(`INSERT INTO vitolas (cigar_id, name, length, ring_gauge, msrp) VALUES (?, ?, ?, ?, ?)`);

  const cigarIds = {}, vitolaIds = {};
  for (const c of cigars) {
    const r = insertCigar.run(c.brand, c.name, c.country, c.wrapper, c.binder, c.filler, c.strength, c.flavor_notes, c.description, c.year_introduced);
    const key = `${c.brand} - ${c.name}`;
    cigarIds[key] = r.lastInsertRowid;
    vitolaIds[key] = [];
    for (const v of (vitolasMap[key] || [])) {
      const vr = insertVitola.run(r.lastInsertRowid, v.name, v.length, v.ring_gauge, v.msrp);
      vitolaIds[key].push({ id: vr.lastInsertRowid, name: v.name, msrp: v.msrp });
    }
  }

  const insertInv = db.prepare(`INSERT INTO inventory (store_id, cigar_id, vitola_id, price, quantity, in_stock, is_featured, is_new_arrival) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`);

  function addToStore(storeId, key, featured = 0, newArrival = 0) {
    const cid = cigarIds[key];
    const vs = vitolaIds[key] || [];
    for (const v of vs) {
      const price = +(v.msrp * (0.92 + Math.random() * 0.18)).toFixed(2);
      insertInv.run(storeId, cid, v.id, price, Math.floor(Math.random() * 35) + 5, featured, newArrival);
    }
  }

  // Store 1 - New Orleans
  addToStore(store1Id, 'Arturo Fuente - Hemingway Short Story', 1);
  addToStore(store1Id, 'Arturo Fuente - Opus X', 1);
  addToStore(store1Id, 'Padron - 1964 Anniversary', 1);
  addToStore(store1Id, 'Liga Privada - No. 9');
  addToStore(store1Id, 'My Father - Flor de las Antillas');
  addToStore(store1Id, 'Oliva - Serie V Melanio');
  addToStore(store1Id, 'Rocky Patel - Vintage 1990');
  addToStore(store1Id, 'Macanudo - Inspirado White');
  addToStore(store1Id, 'Romeo y Julieta - Reserva Real');
  addToStore(store1Id, 'Perdomo - Reserve 10th Anniversary Maduro', 0, 1);

  // Store 2 - Atlanta
  addToStore(store2Id, 'Liga Privada - No. 9', 1);
  addToStore(store2Id, 'Liga Privada - T52', 1, 1);
  addToStore(store2Id, 'My Father - Le Bijou 1922', 1);
  addToStore(store2Id, 'Padron - 1964 Anniversary');
  addToStore(store2Id, 'Oliva - Serie G Maduro');
  addToStore(store2Id, 'Davidoff - Escurio');
  addToStore(store2Id, 'Romeo y Julieta - Reserva Real');
  addToStore(store2Id, 'Ashton - VSG', 0, 1);
  addToStore(store2Id, 'Cohiba - Blue');

  // Store 3 - Miami
  addToStore(store3Id, 'Padron - 1926 Serie No. 1', 1);
  addToStore(store3Id, 'Arturo Fuente - Opus X', 1);
  addToStore(store3Id, 'Davidoff - Millennium Blend', 1);
  addToStore(store3Id, 'Davidoff - Escurio');
  addToStore(store3Id, 'My Father - Le Bijou 1922');
  addToStore(store3Id, 'Cohiba - Blue');
  addToStore(store3Id, 'Oliva - Serie V Melanio');
  addToStore(store3Id, 'Ashton - VSG', 0, 1);
  addToStore(store3Id, 'Rocky Patel - Vintage 1990');

  // Store 4 - Chicago
  addToStore(store4Id, 'Arturo Fuente - Opus X', 1);
  addToStore(store4Id, 'Padron - 1926 Serie No. 1', 1);
  addToStore(store4Id, 'Liga Privada - No. 9', 1);
  addToStore(store4Id, 'Davidoff - Millennium Blend', 0, 1);
  addToStore(store4Id, 'My Father - Le Bijou 1922');
  addToStore(store4Id, 'Ashton - VSG');
  addToStore(store4Id, 'Oliva - Serie V Melanio');
  addToStore(store4Id, 'Perdomo - Reserve 10th Anniversary Maduro');
  addToStore(store4Id, 'Cohiba - Blue');

  // Reviews
  const insertReview = db.prepare(`INSERT INTO reviews (user_id, cigar_id, vitola_id, rating, draw_rating, burn_rating, appearance_rating, flavor_notes, strength_experienced, smoke_time, pairing, review_text) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const uid = demoUser.lastInsertRowid, uid2 = user2.lastInsertRowid;

  insertReview.run(uid, cigarIds['Padron - 1964 Anniversary'], vitolaIds['Padron - 1964 Anniversary'][0].id, 97, 5, 5, 5, JSON.stringify(['dark chocolate', 'espresso', 'earth', 'leather']), 'full', 75, 'Aged Rum', 'Absolutely magnificent from start to finish. The construction is flawless — an even, razor-thin burn line throughout. Dark chocolate and espresso notes that just get richer through the second third. This is why Padron is legendary.');
  insertReview.run(uid, cigarIds['Liga Privada - No. 9'], vitolaIds['Liga Privada - No. 9'][0].id, 95, 4, 5, 5, JSON.stringify(['dark chocolate', 'espresso', 'cream', 'pepper']), 'full', 65, 'Bourbon', 'The No. 9 remains one of the most consistent smokes on the market. Rich cream and dark chocolate opening, transitioning to a peppery finish. Paired beautifully with a Woodford Reserve.');
  insertReview.run(uid, cigarIds['Arturo Fuente - Opus X'], vitolaIds['Arturo Fuente - Opus X'][0].id, 98, 5, 5, 5, JSON.stringify(['cedar', 'spice', 'chocolate', 'leather', 'coffee']), 'medium-full', 90, 'Espresso', 'One of the best cigars I have ever smoked. The Rosado wrapper is stunning and the complexity just keeps evolving. If you can find one, buy it.');
  insertReview.run(uid2, cigarIds['Romeo y Julieta - Reserva Real'], vitolaIds['Romeo y Julieta - Reserva Real'][0].id, 88, 4, 4, 5, JSON.stringify(['cedar', 'cream', 'honey']), 'mild-medium', 50, 'Coffee', 'Perfect for someone newer to cigars like me. Very approachable, no harshness, lovely creamy notes. Will definitely buy a box.');
  insertReview.run(uid2, cigarIds['Macanudo - Inspirado White'], vitolaIds['Macanudo - Inspirado White'][0].id, 86, 5, 5, 4, JSON.stringify(['cream', 'honey', 'cedar', 'floral']), 'mild', 45, 'Cappuccino', 'Incredibly smooth and forgiving. Great evening smoke when I want something relaxing. The construction is impressive at this price point.');
  insertReview.run(uid, cigarIds['Davidoff - Escurio'], vitolaIds['Davidoff - Escurio'][0].id, 93, 5, 5, 5, JSON.stringify(['cocoa', 'dark fruit', 'coffee', 'leather']), 'medium-full', 70, 'Single Malt Scotch', 'Davidoff proves they can do bold. The Mata Fina wrapper gives it an incredible oiliness and the dark fruit notes are captivating. World-class construction as expected from Davidoff.');

  // Humidor items
  const insertUC = db.prepare(`INSERT INTO user_cigars (user_id, cigar_id, vitola_id, status, quantity, purchase_price, purchase_date, notes, aging_goal_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  insertUC.run(uid, cigarIds['Padron - 1926 Serie No. 1'], vitolaIds['Padron - 1926 Serie No. 1'][0].id, 'humidor', 10, 33.00, '2025-10-15', 'Aging these for special occasions. Already showing wonderful depth.', '2027-01-01');
  insertUC.run(uid, cigarIds['Arturo Fuente - Opus X'], vitolaIds['Arturo Fuente - Opus X'][0].id, 'humidor', 5, 45.00, '2026-01-20', "Lucky grab from Hemingway's. These are hard to find.", null);
  insertUC.run(uid, cigarIds['Liga Privada - No. 9'], vitolaIds['Liga Privada - No. 9'][1].id, 'smoked', 1, 22.00, '2026-03-01', 'Smoked on the porch watching the sunset. One of the best sessions of the year.', null);
  insertUC.run(uid, cigarIds['Davidoff - Millennium Blend'], vitolaIds['Davidoff - Millennium Blend'][0].id, 'humidor', 3, 22.00, '2026-04-01', 'Gifted from a friend. Saving for a special dinner.', null);
  insertUC.run(uid, cigarIds['Padron - 1964 Anniversary'], vitolaIds['Padron - 1964 Anniversary'][2].id, 'wishlist', 1, null, null, 'Imperial size — the white whale. Need to track down a box.', null);
  insertUC.run(uid2, cigarIds['Macanudo - Inspirado White'], vitolaIds['Macanudo - Inspirado White'][0].id, 'humidor', 5, 8.50, '2026-04-10', 'My everyday smoke. Love these.', null);
  insertUC.run(uid2, cigarIds['Romeo y Julieta - Reserva Real'], vitolaIds['Romeo y Julieta - Reserva Real'][1].id, 'humidor', 3, 10.00, '2026-04-20', 'Picked up after my first review. Great value.', null);

  // Follows
  const insertFollow = db.prepare(`INSERT INTO store_follows (user_id, store_id, notify_broadcasts, notify_deals, notify_new_arrivals) VALUES (?, ?, 1, 1, 1)`);
  insertFollow.run(uid, store1Id);
  insertFollow.run(uid, store2Id);
  insertFollow.run(uid, store3Id);
  insertFollow.run(uid2, store1Id);
  insertFollow.run(uid2, store2Id);

  // Deals
  const insertDeal = db.prepare(`INSERT INTO deals (store_id, title, description, discount_percent, cigar_id, expires_at) VALUES (?, ?, ?, ?, ?, ?)`);
  insertDeal.run(store1Id, '20% Off Hemingway Short Story Boxes', 'Stock up on one of the finest figurados in the world. 20% off all box purchases of the Arturo Fuente Hemingway Short Story this week only.', 20, cigarIds['Arturo Fuente - Hemingway Short Story'], '2026-05-15');
  insertDeal.run(store2Id, 'Liga Privada Tasting Night — May 8th', 'Join us for an exclusive Liga Privada tasting event. Sample No. 9 and T52 side by side with guided tasting notes. $35 per person includes 2 sticks and cocktails.', null, cigarIds['Liga Privada - No. 9'], '2026-05-08');
  insertDeal.run(store3Id, 'New Arrival: Opus X Allocation In', 'We just received our quarterly Opus X allocation. Strictly limited — max 5 per customer. Come in or call ahead.', null, cigarIds['Arturo Fuente - Opus X'], '2026-05-20');
  insertDeal.run(store4Id, '15% Off Davidoff Millennium Blend', 'Celebrating the return of our Davidoff partnership with a one-week special on Millennium Blend singles and bundles.', 15, cigarIds['Davidoff - Millennium Blend'], '2026-05-10');
  insertDeal.run(store1Id, 'Thursday Smoke Night — Free Admission', 'Join us every Thursday evening for our signature smoke night. $2 off all singles, drink specials, and great company. All skill levels welcome.', null, null, '2026-12-31');

  // Store ratings
  const insertRating = db.prepare(`INSERT INTO store_ratings (user_id, store_id, rating, comment) VALUES (?, ?, ?, ?)`);
  insertRating.run(uid, store1Id, 5, 'Best cigar shop in New Orleans. The staff really knows their stuff and the walk-in humidor is incredible.');
  insertRating.run(uid, store2Id, 4, 'Love the lounge atmosphere. Cocktails are excellent. Selection is top notch.');
  insertRating.run(uid2, store1Id, 5, 'So helpful with beginners. They pointed me to the perfect first cigars and I\'ve been coming back weekly.');
  insertRating.run(uid2, store2Id, 5, 'The tasting events are worth every penny. Learned so much about pairing.');

  // Store views
  const insertView = db.prepare(`INSERT INTO store_views (store_id, viewed_at) VALUES (?, ?)`);
  const days = 14;
  for (let d = 0; d < days; d++) {
    const date = new Date(Date.now() - d * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const views = Math.floor(Math.random() * 20) + 5;
    for (let v = 0; v < views; v++) insertView.run(store1Id, `${date} 12:00:00`);
    const views2 = Math.floor(Math.random() * 15) + 3;
    for (let v = 0; v < views2; v++) insertView.run(store2Id, `${date} 12:00:00`);
  }

  // Notifications (broadcasts from stores)
  const insertNotif = db.prepare(`INSERT INTO notifications (store_id, title, message, type, cigar_id) VALUES (?, ?, ?, ?, ?)`);
  insertNotif.run(store1Id, '🔥 New Arrival: Perdomo Reserve 10th Anniversary', 'We just got a fresh shipment of the Perdomo Reserve 10th Anniversary Maduro. Limited quantities available — come in while they last!', 'new_arrival', cigarIds['Perdomo - Reserve 10th Anniversary Maduro']);
  insertNotif.run(store2Id, 'Liga Privada T52 Flying Pig Back In Stock!', 'By popular demand — the T52 Flying Pig is back. Picked up an allocation from Drew Estate. First come first served. Members get first pick tonight.', 'new_arrival', cigarIds['Liga Privada - T52']);
  insertNotif.run(store1Id, 'Thursday Smoke Night This Week: Dominican Night 🇩🇴', 'This Thursday we\'re going full Dominican. Featuring Arturo Fuente across the lineup with a special mystery Opus X tasting. $15 entry includes your first stick.', 'event', null);
  insertNotif.run(store2Id, '20% Off All Singles This Weekend Only', 'Memorial Day weekend special — 20% off every single cigar in the humidor Friday through Sunday. Lounge open until 2am Friday and Saturday.', 'deal', null);
  insertNotif.run(store3Id, 'Limited: 2020 Opus X Perfecxion No. 2 Available', 'We sourced a small lot of 2020 vintage Opus X Perfecxion No. 2. Rarely available. Max 2 per customer. Call or come in.', 'announcement', cigarIds['Arturo Fuente - Opus X']);

  // Smoke lists
  const insertSmoke = db.prepare(`INSERT INTO smoke_list (user_id, cigar_id, priority, notes, recommended_by, status) VALUES (?, ?, ?, ?, ?, 'pending')`);
  insertSmoke.run(uid, cigarIds['Padron - 1926 Serie No. 1'], 'high', 'Everyone says the 80 Anos is the best cigar they\'ve ever had. Need to try before I die.', 'Robert on the Cigar Dojo forum');
  insertSmoke.run(uid, cigarIds['Arturo Fuente - Hemingway Short Story'], 'high', 'Heard this is the best value Fuente. The figurado shape intrigues me.', null);
  insertSmoke.run(uid, cigarIds['Liga Privada - T52'], 'medium', 'Love the No. 9 so the T52 should be interesting. Broadleaf wrapper instead of Habano.', 'Tasted it at a friend\'s and loved it');
  insertSmoke.run(uid, cigarIds['Davidoff - Millennium Blend'], 'medium', 'Want to try a world-class mild smoke. Davidoff is the benchmark.', 'Cigar Aficionado review');
  insertSmoke.run(uid, cigarIds['Ashton - VSG'], 'low', 'VSG is supposed to be excellent. Dominican complexity in a sungrown wrapper.', null);
  insertSmoke.run(uid2, cigarIds['Romeo y Julieta - Reserva Real'], 'high', 'My friend loves these. Perfect for a beginner like me.', 'Jane\'s friend Lisa');
  insertSmoke.run(uid2, cigarIds['Macanudo - Inspirado White'], 'medium', 'Heard it\'s super smooth and approachable. Good starting point.', 'Staff at The Cigar Vault');
  insertSmoke.run(uid2, cigarIds['My Father - Flor de las Antillas'], 'low', 'Cigar of the Year 2012 — have to try it eventually.', 'CigarBuddy community');

  // Verification requests (2 pending, 1 approved already)
  const insertVerif = db.prepare(`
    INSERT INTO verification_requests (store_id, business_name, business_ein, business_phone, business_address, business_website, license_number, notes, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  // Store 4 (The Smoking Jacket) - pending
  insertVerif.run(store4Id, 'The Smoking Jacket LLC', '47-1234567', '(312) 555-0875', '875 N Michigan Ave, Chicago, IL 60611', 'thesmokingjacket.com', 'IL-LIQ-2019-00847', 'We have been in business since 2019. State tobacco retail license attached. References available on request.', 'pending');
  // Store 3 (Hemingway's) - pending but store already manually set as verified in seed
  insertVerif.run(store3Id, "Hemingway's Tobacconist Inc.", '65-9876543', '(305) 555-2240', '2240 Collins Ave, Miami Beach, FL 33139', 'hemingwaystobacconist.com', 'FL-TB-1978-00023', 'Established 1978. Florida state tobacco dealer license #FL-TB-1978-00023. Family owned and operated for 48 years.', 'approved');

  console.log('✅ Seed complete!');
  console.log('\nDemo accounts:');
  console.log('  Smoker:  smoker@demo.com / password123');
  console.log('  User 2:  jane@demo.com / password123');
  console.log('  Store 1: store1@demo.com / password123 (The Cigar Vault — New Orleans)');
  console.log('  Store 2: store2@demo.com / password123 (Smoke & Ember — Atlanta)');
  console.log('  Store 3: store3@demo.com / password123 (Hemingway\'s — Miami Beach)');
  console.log('  Store 4: store4@demo.com / password123 (The Smoking Jacket — Chicago)');
}

seed();
