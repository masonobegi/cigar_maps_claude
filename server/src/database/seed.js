const db = require('./db');
const { initSchema } = require('./schema');
const bcrypt = require('bcryptjs');

// Bump this number whenever you want the DB wiped and reseeded on next deploy.
const SEED_VERSION = '2';

const cigars = [
  { brand: 'Brand 1', name: 'Cigar 1',  country: 'Nicaragua',          wrapper: 'Connecticut Shade',            binder: 'Nicaragua',  filler: 'Nicaragua',           strength: 'mild',        flavor_notes: JSON.stringify(['cream', 'cedar', 'honey', 'floral']),                       description: 'Light and creamy with delicate cedar and floral notes.',             year_introduced: 2018 },
  { brand: 'Brand 1', name: 'Cigar 2',  country: 'Honduras',           wrapper: 'Ecuador Connecticut',          binder: 'Honduras',   filler: 'Honduras/Dominican',  strength: 'mild-medium', flavor_notes: JSON.stringify(['cream', 'nuts', 'cedar', 'honey', 'coffee']),               description: 'Balanced and approachable with creamy nuts and light coffee.',         year_introduced: 2016 },
  { brand: 'Brand 1', name: 'Cigar 3',  country: 'Nicaragua',          wrapper: 'Connecticut Broadleaf Maduro', binder: 'Nicaragua',  filler: 'Nicaragua',           strength: 'medium-full', flavor_notes: JSON.stringify(['dark chocolate', 'espresso', 'earth', 'leather', 'cedar']), description: 'Rich and complex with a beautiful oily maduro wrapper.',              year_introduced: 2019 },
  { brand: 'Brand 1', name: 'Cigar 4',  country: 'Dominican Republic', wrapper: 'Ecuador Habano',               binder: 'Dominican',  filler: 'Dominican',           strength: 'medium',      flavor_notes: JSON.stringify(['cedar', 'coffee', 'leather', 'nuts', 'spice']),             description: 'Cedar and coffee up front giving way to spice on the finish.',        year_introduced: 2014 },
  { brand: 'Brand 1', name: 'Cigar 5',  country: 'Nicaragua',          wrapper: 'Ecuador Habano',               binder: 'Nicaragua',  filler: 'Nicaragua',           strength: 'medium',      flavor_notes: JSON.stringify(['spice', 'cedar', 'nuts', 'coffee', 'earth']),               description: 'Earthy with subtle spice. Consistent from first third to nub.',       year_introduced: 2020 },

  { brand: 'Brand 2', name: 'Cigar 6',  country: 'Nicaragua',          wrapper: 'Nicaragua Natural',            binder: 'Nicaragua',  filler: 'Nicaragua',           strength: 'medium',      flavor_notes: JSON.stringify(['earth', 'leather', 'nuts', 'pepper', 'cedar']),             description: 'Earthy leather notes and a peppery kick.',                            year_introduced: 2017 },
  { brand: 'Brand 2', name: 'Cigar 7',  country: 'Nicaragua',          wrapper: 'Ecuador Habano',               binder: 'Nicaragua',  filler: 'Nicaragua/Honduras',  strength: 'medium-full', flavor_notes: JSON.stringify(['cocoa', 'leather', 'earth', 'black pepper', 'cedar']),     description: 'Cocoa and leather with a lingering pepper finish.',                    year_introduced: 2015 },
  { brand: 'Brand 2', name: 'Cigar 8',  country: 'Nicaragua',          wrapper: 'Connecticut Broadleaf Maduro', binder: 'Nicaragua',  filler: 'Nicaragua',           strength: 'full',        flavor_notes: JSON.stringify(['dark chocolate', 'coffee', 'earth', 'leather', 'molasses']), description: 'Full-bodied with rich dark chocolate and a sweet molasses note.',    year_introduced: 2016 },
  { brand: 'Brand 2', name: 'Cigar 9',  country: 'Honduras',           wrapper: 'Ecuador Connecticut',          binder: 'Honduras',   filler: 'Honduras',            strength: 'mild-medium', flavor_notes: JSON.stringify(['cream', 'cedar', 'nuts', 'floral', 'honey']),               description: 'Creamy and smooth. Consistent from foot to nub.',                     year_introduced: 2013 },
  { brand: 'Brand 2', name: 'Cigar 10', country: 'Dominican Republic', wrapper: 'Ecuador Connecticut',          binder: 'Dominican',  filler: 'Dominican',           strength: 'medium',      flavor_notes: JSON.stringify(['cedar', 'cream', 'coffee', 'nuts', 'honey']),               description: 'A relaxed shorter smoke. Easy and enjoyable.',                        year_introduced: 2021 },

  { brand: 'Brand 3', name: 'Cigar 11', country: 'Nicaragua',          wrapper: 'Nicaragua Natural',            binder: 'Nicaragua',  filler: 'Nicaragua',           strength: 'medium',      flavor_notes: JSON.stringify(['cedar', 'earth', 'leather', 'pepper', 'nuts']),             description: 'Accessible and versatile. Pairs well with coffee or craft beer.',     year_introduced: 2018 },
  { brand: 'Brand 3', name: 'Cigar 12', country: 'Nicaragua',          wrapper: 'Ecuador Habano',               binder: 'Nicaragua',  filler: 'Nicaragua',           strength: 'medium',      flavor_notes: JSON.stringify(['nuts', 'earth', 'spice', 'cedar', 'cream']),               description: 'Creamy nuts and light spice.',                                         year_introduced: 2019 },
  { brand: 'Brand 3', name: 'Cigar 13', country: 'Nicaragua',          wrapper: 'Ecuador Habano',               binder: 'Nicaragua',  filler: 'Nicaragua/Dominican', strength: 'medium-full', flavor_notes: JSON.stringify(['dark chocolate', 'leather', 'cedar', 'pepper', 'coffee']), description: 'Chocolate and leather in the first third, cedar and pepper finish.',   year_introduced: 2020 },
  { brand: 'Brand 3', name: 'Cigar 14', country: 'Nicaragua',          wrapper: 'Nicaragua Maduro',             binder: 'Nicaragua',  filler: 'Nicaragua',           strength: 'full',        flavor_notes: JSON.stringify(['espresso', 'dark chocolate', 'earth', 'leather', 'pepper']), description: 'Full-strength Nicaraguan puro. Bold and unapologetic.',              year_introduced: 2021 },
  { brand: 'Brand 3', name: 'Cigar 15', country: 'Dominican Republic', wrapper: 'Connecticut Shade',            binder: 'Dominican',  filler: 'Dominican',           strength: 'mild',        flavor_notes: JSON.stringify(['cream', 'floral', 'honey', 'cedar', 'tea']),                description: 'Floral and honey throughout. Exceptionally smooth.',                  year_introduced: 2017 },

  { brand: 'Brand 4', name: 'Cigar 16', country: 'Honduras',           wrapper: 'Ecuador Natural',              binder: 'Honduras',   filler: 'Honduras/Nicaragua',  strength: 'medium',      flavor_notes: JSON.stringify(['cedar', 'leather', 'earth', 'nuts', 'coffee']),             description: 'Earthy and straightforward. A solid everyday smoke.',                 year_introduced: 2016 },
  { brand: 'Brand 4', name: 'Cigar 17', country: 'Nicaragua',          wrapper: 'Connecticut Broadleaf Maduro', binder: 'Nicaragua',  filler: 'Nicaragua',           strength: 'full',        flavor_notes: JSON.stringify(['dark chocolate', 'espresso', 'leather', 'earth', 'black pepper']), description: 'Rich espresso and dark chocolate in every puff.',              year_introduced: 2014 },
  { brand: 'Brand 4', name: 'Cigar 18', country: 'Dominican Republic', wrapper: 'Connecticut Shade',            binder: 'Dominican',  filler: 'Dominican',           strength: 'mild',        flavor_notes: JSON.stringify(['cream', 'honey', 'cedar', 'floral', 'vanilla']),             description: 'Smooth, creamy, and elegant. Reliable across the board.',             year_introduced: 2012 },
  { brand: 'Brand 4', name: 'Cigar 19', country: 'Nicaragua',          wrapper: 'Ecuador Habano',               binder: 'Nicaragua',  filler: 'Nicaragua',           strength: 'medium-full', flavor_notes: JSON.stringify(['spice', 'leather', 'cedar', 'cocoa', 'coffee']),             description: 'Spice-forward with cocoa and coffee notes developing beautifully.',    year_introduced: 2018 },
  { brand: 'Brand 4', name: 'Cigar 20', country: 'Dominican Republic', wrapper: 'Ecuador Habano',               binder: 'Dominican',  filler: 'Dominican/Nicaraguan', strength: 'medium',     flavor_notes: JSON.stringify(['cedar', 'nuts', 'cream', 'leather', 'spice']),              description: 'Cedary and creamy with light spice on the finish.',                   year_introduced: 2019 },

  { brand: 'Brand 5', name: 'Cigar 21', country: 'Nicaragua',          wrapper: 'Ecuador Corojo',               binder: 'Nicaragua',  filler: 'Nicaragua',           strength: 'medium-full', flavor_notes: JSON.stringify(['red pepper', 'cedar', 'leather', 'coffee', 'earth']),      description: 'Red pepper and cedar up front, softening into leather and coffee.',    year_introduced: 2017 },
  { brand: 'Brand 5', name: 'Cigar 22', country: 'Nicaragua',          wrapper: 'Connecticut Broadleaf Maduro', binder: 'Nicaragua',  filler: 'Nicaragua/Honduras',  strength: 'full',        flavor_notes: JSON.stringify(['dark chocolate', 'molasses', 'coffee', 'earth', 'leather']), description: 'Flavors evolve and deepen as you smoke toward the nub.',            year_introduced: 2015 },
  { brand: 'Brand 5', name: 'Cigar 23', country: 'Nicaragua',          wrapper: 'Ecuador Sun Grown',            binder: 'Nicaragua',  filler: 'Nicaragua',           strength: 'medium',      flavor_notes: JSON.stringify(['earth', 'leather', 'nuts', 'coffee', 'spice']),             description: 'Sun-grown Ecuador wrapper gives this toro unique rustic character.',   year_introduced: 2019 },
  { brand: 'Brand 5', name: 'Cigar 24', country: 'Dominican Republic', wrapper: 'Ecuador Natural',              binder: 'Dominican',  filler: 'Dominican',           strength: 'mild-medium', flavor_notes: JSON.stringify(['cream', 'cedar', 'nuts', 'honey', 'floral']),               description: 'Light and airy with cream, cedar, and gentle floral notes.',           year_introduced: 2016 },
  { brand: 'Brand 5', name: 'Cigar 25', country: 'Nicaragua',          wrapper: 'Ecuador Habano',               binder: 'Nicaragua',  filler: 'Nicaragua/Dominican', strength: 'medium',      flavor_notes: JSON.stringify(['cedar', 'leather', 'earth', 'nuts', 'coffee']),             description: 'A perfecto shape with a unique tapered draw profile.',                year_introduced: 2022 },
];

const vitolasMap = {
  'Brand 1 - Cigar 1':  [{ name: 'Robusto',      length: 5.0, ring_gauge: 50, msrp: 8  }, { name: 'Toro',         length: 6.0, ring_gauge: 52, msrp: 10 }],
  'Brand 1 - Cigar 2':  [{ name: 'Robusto',      length: 5.0, ring_gauge: 50, msrp: 9  }, { name: 'Toro',         length: 6.0, ring_gauge: 52, msrp: 11 }, { name: 'Churchill',    length: 7.0, ring_gauge: 48, msrp: 14 }],
  'Brand 1 - Cigar 3':  [{ name: 'Robusto',      length: 5.0, ring_gauge: 50, msrp: 12 }, { name: 'Toro',         length: 6.0, ring_gauge: 52, msrp: 15 }, { name: 'Gran Toro',    length: 6.5, ring_gauge: 54, msrp: 17 }],
  'Brand 1 - Cigar 4':  [{ name: 'Churchill',    length: 7.0, ring_gauge: 48, msrp: 16 }, { name: 'Toro',         length: 6.0, ring_gauge: 52, msrp: 14 }],
  'Brand 1 - Cigar 5':  [{ name: 'Torpedo',      length: 6.0, ring_gauge: 52, msrp: 11 }, { name: 'Short Torpedo',length: 5.0, ring_gauge: 52, msrp: 9  }],

  'Brand 2 - Cigar 6':  [{ name: 'Robusto',      length: 5.0, ring_gauge: 50, msrp: 10 }, { name: 'Toro',         length: 6.0, ring_gauge: 52, msrp: 12 }],
  'Brand 2 - Cigar 7':  [{ name: 'Toro',         length: 6.0, ring_gauge: 52, msrp: 14 }, { name: 'Robusto',      length: 5.0, ring_gauge: 50, msrp: 12 }, { name: 'Torpedo',      length: 6.25,ring_gauge: 52, msrp: 15 }],
  'Brand 2 - Cigar 8':  [{ name: 'Robusto',      length: 5.0, ring_gauge: 50, msrp: 13 }, { name: 'Toro',         length: 6.0, ring_gauge: 52, msrp: 16 }, { name: 'Double Toro',  length: 6.0, ring_gauge: 60, msrp: 18 }],
  'Brand 2 - Cigar 9':  [{ name: 'Lonsdale',     length: 6.5, ring_gauge: 44, msrp: 10 }, { name: 'Corona',       length: 5.5, ring_gauge: 44, msrp: 8  }],
  'Brand 2 - Cigar 10': [{ name: 'Corona',       length: 5.5, ring_gauge: 42, msrp: 7  }, { name: 'Robusto',      length: 5.0, ring_gauge: 50, msrp: 9  }],

  'Brand 3 - Cigar 11': [{ name: 'Toro',         length: 6.0, ring_gauge: 52, msrp: 10 }, { name: 'Robusto',      length: 5.0, ring_gauge: 50, msrp: 8  }, { name: 'Churchill',    length: 7.0, ring_gauge: 48, msrp: 13 }],
  'Brand 3 - Cigar 12': [{ name: 'Robusto',      length: 5.0, ring_gauge: 50, msrp: 9  }, { name: 'Toro',         length: 6.0, ring_gauge: 52, msrp: 11 }],
  'Brand 3 - Cigar 13': [{ name: 'Belicoso',     length: 5.5, ring_gauge: 52, msrp: 14 }, { name: 'Toro',         length: 6.0, ring_gauge: 52, msrp: 15 }, { name: 'Robusto',      length: 5.0, ring_gauge: 50, msrp: 13 }],
  'Brand 3 - Cigar 14': [{ name: 'Gran Toro',    length: 6.0, ring_gauge: 60, msrp: 16 }, { name: 'Toro',         length: 6.0, ring_gauge: 52, msrp: 14 }],
  'Brand 3 - Cigar 15': [{ name: 'Churchill',    length: 7.0, ring_gauge: 48, msrp: 13 }, { name: 'Lonsdale',     length: 6.5, ring_gauge: 44, msrp: 11 }],

  'Brand 4 - Cigar 16': [{ name: 'Toro',         length: 6.0, ring_gauge: 52, msrp: 9  }, { name: 'Robusto',      length: 5.0, ring_gauge: 50, msrp: 7  }, { name: 'Churchill',    length: 7.0, ring_gauge: 48, msrp: 11 }],
  'Brand 4 - Cigar 17': [{ name: 'Robusto',      length: 5.0, ring_gauge: 50, msrp: 11 }, { name: 'Toro',         length: 6.0, ring_gauge: 52, msrp: 13 }, { name: 'Short Robusto',length: 4.5, ring_gauge: 50, msrp: 9  }],
  'Brand 4 - Cigar 18': [{ name: 'Corona',       length: 5.5, ring_gauge: 42, msrp: 7  }, { name: 'Petit Corona', length: 4.5, ring_gauge: 42, msrp: 6  }, { name: 'Lonsdale',     length: 6.5, ring_gauge: 44, msrp: 9  }],
  'Brand 4 - Cigar 19': [{ name: 'Torpedo',      length: 6.0, ring_gauge: 52, msrp: 12 }, { name: 'Belicoso',     length: 5.5, ring_gauge: 52, msrp: 11 }],
  'Brand 4 - Cigar 20': [{ name: 'Churchill',    length: 7.0, ring_gauge: 48, msrp: 14 }, { name: 'Toro',         length: 6.0, ring_gauge: 52, msrp: 12 }, { name: 'Robusto',      length: 5.0, ring_gauge: 50, msrp: 10 }],

  'Brand 5 - Cigar 21': [{ name: 'Robusto',      length: 5.0, ring_gauge: 50, msrp: 13 }, { name: 'Toro',         length: 6.0, ring_gauge: 52, msrp: 15 }, { name: 'Torpedo',      length: 6.25,ring_gauge: 52, msrp: 16 }],
  'Brand 5 - Cigar 22': [{ name: 'Toro',         length: 6.0, ring_gauge: 52, msrp: 16 }, { name: 'Robusto',      length: 5.0, ring_gauge: 50, msrp: 14 }, { name: 'Gran Toro',    length: 6.5, ring_gauge: 54, msrp: 18 }],
  'Brand 5 - Cigar 23': [{ name: 'Toro',         length: 6.0, ring_gauge: 52, msrp: 12 }, { name: 'Robusto',      length: 5.0, ring_gauge: 50, msrp: 10 }],
  'Brand 5 - Cigar 24': [{ name: 'Lonsdale',     length: 6.5, ring_gauge: 44, msrp: 9  }, { name: 'Corona',       length: 5.5, ring_gauge: 42, msrp: 7  }, { name: 'Churchill',    length: 7.0, ring_gauge: 48, msrp: 12 }],
  'Brand 5 - Cigar 25': [{ name: 'Perfecto',     length: 5.5, ring_gauge: 50, msrp: 15 }, { name: 'Gran Perfecto',length: 6.5, ring_gauge: 52, msrp: 18 }],
};

async function truncateAll() {
  await db.pool.query(`
    TRUNCATE TABLE notifications, smoke_list, store_views, store_ratings, deals,
      verification_requests, store_follows, user_cigars, reviews, inventory,
      vitolas, cigars, stores, users
    RESTART IDENTITY CASCADE
  `);
}

async function seed(force = false) {
  if (!force) {
    const { rows } = await db.pool.query(
      `SELECT value FROM seed_meta WHERE key = 'version'`
    );
    const storedVersion = rows[0]?.value;
    if (storedVersion === SEED_VERSION) {
      console.log(`[seed] Version ${SEED_VERSION} already seeded — skipping.`);
      return;
    }
    console.log(`[seed] Version mismatch (db=${storedVersion ?? 'none'}, code=${SEED_VERSION}) — truncating and reseeding...`);
    await truncateAll();
  } else {
    await truncateAll();
  }
  console.log('[seed] Seeding fresh database...');

  const hash      = await bcrypt.hash('password123', 10);
  const adminHash = await bcrypt.hash('admin123', 10);

  const adminR = await db.run(`INSERT INTO users (email,password_hash,name,account_type) VALUES (?,?,?,?) RETURNING id`, ['admin@cigarbuddy.com', adminHash, 'Admin', 'admin']);
  const demoR  = await db.run(`INSERT INTO users (email,password_hash,name,account_type,bio,location_city,location_state) VALUES (?,?,?,?,?,?,?) RETURNING id`, ['smoker@demo.com', hash, 'Demo User 1', 'user', 'Portland cigar enthusiast.', 'Portland', 'OR']);
  const user2R = await db.run(`INSERT INTO users (email,password_hash,name,account_type,bio,location_city,location_state) VALUES (?,?,?,?,?,?,?) RETURNING id`, ['jane@demo.com', hash, 'Demo User 2', 'user', 'New to cigars, learning fast.', 'Vancouver', 'WA']);

  const su1R = await db.run(`INSERT INTO users (email,password_hash,name,account_type) VALUES (?,?,?,?) RETURNING id`, ['store1@demo.com', hash, 'Store 1 Owner', 'store']);
  const su2R = await db.run(`INSERT INTO users (email,password_hash,name,account_type) VALUES (?,?,?,?) RETURNING id`, ['store2@demo.com', hash, 'Store 2 Owner', 'store']);
  const su3R = await db.run(`INSERT INTO users (email,password_hash,name,account_type) VALUES (?,?,?,?) RETURNING id`, ['store3@demo.com', hash, 'Store 3 Owner', 'store']);
  const su4R = await db.run(`INSERT INTO users (email,password_hash,name,account_type) VALUES (?,?,?,?) RETURNING id`, ['store4@demo.com', hash, 'Store 4 Owner', 'store']);
  const su5R = await db.run(`INSERT INTO users (email,password_hash,name,account_type) VALUES (?,?,?,?) RETURNING id`, ['store5@demo.com', hash, 'Store 5 Owner', 'store']);

  const uid  = demoR.lastInsertRowid;
  const uid2 = user2R.lastInsertRowid;

  const h1 = JSON.stringify({ Mon: '10am-8pm', Tue: '10am-8pm', Wed: '10am-8pm', Thu: '10am-9pm', Fri: '10am-10pm', Sat: '9am-10pm',  Sun: '11am-7pm' });
  const h2 = JSON.stringify({ Mon: '11am-7pm', Tue: '11am-7pm', Wed: '11am-7pm', Thu: '11am-8pm', Fri: '11am-9pm',  Sat: '10am-9pm',  Sun: '12pm-6pm' });
  const h3 = JSON.stringify({ Mon: 'Closed',   Tue: '1pm-10pm', Wed: '1pm-10pm', Thu: '1pm-11pm', Fri: '12pm-12am', Sat: '11am-12am', Sun: '12pm-8pm' });
  const h4 = JSON.stringify({ Mon: '10am-7pm', Tue: '10am-7pm', Wed: '10am-7pm', Thu: '10am-7pm', Fri: '10am-8pm',  Sat: '9am-8pm',   Sun: '11am-5pm' });
  const h5 = JSON.stringify({ Mon: '11am-8pm', Tue: '11am-8pm', Wed: '11am-8pm', Thu: '11am-9pm', Fri: '11am-10pm', Sat: '10am-10pm', Sun: '12pm-7pm' });

  const s1R = await db.run(`INSERT INTO stores (user_id,name,description,address,city,state,zip,phone,hours,has_lounge,has_walk_in_humidor,tags,verified,setup_complete,lat,lng) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?) RETURNING id`,
    [su1R.lastInsertRowid,'Store 1','Downtown Portland walk-in humidor. Weekly smoke nights every Thursday.','927 SW Morrison St','Portland','OR','97205','(503) 555-0927',h1,1,1,JSON.stringify(['Walk-in Humidor','Lounge','Events']),1,45.5193,-122.6817]);
  const s2R = await db.run(`INSERT INTO stores (user_id,name,description,address,city,state,zip,phone,hours,has_lounge,has_walk_in_humidor,tags,verified,setup_complete,lat,lng) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?) RETURNING id`,
    [su2R.lastInsertRowid,'Store 2','Neighborhood smoke shop. Great prices, solid everyday selection.','3412 SE Hawthorne Blvd','Portland','OR','97214','(503) 555-3412',h2,0,1,JSON.stringify(['Walk-in Humidor','Budget-Friendly']),0,45.5121,-122.6317]);
  const s3R = await db.run(`INSERT INTO stores (user_id,name,description,address,city,state,zip,phone,hours,has_lounge,has_walk_in_humidor,tags,verified,setup_complete,lat,lng) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?) RETURNING id`,
    [su3R.lastInsertRowid,'Store 3','Upscale lounge in the Pearl District. Craft cocktail bar and curated humidor.','1242 NW Everett St','Portland','OR','97209','(503) 555-1242',h3,1,1,JSON.stringify(['Lounge','Craft Cocktails','Private Lockers']),1,45.5284,-122.6822]);
  const s4R = await db.run(`INSERT INTO stores (user_id,name,description,address,city,state,zip,phone,hours,has_lounge,has_walk_in_humidor,tags,verified,setup_complete,lat,lng) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?) RETURNING id`,
    [su4R.lastInsertRowid,'Store 4','Vancouver go-to cigar shop. Friendly staff, fair prices, over 150 SKUs.','512 W 8th St','Vancouver','WA','98660','(360) 555-0512',h4,0,1,JSON.stringify(['Walk-in Humidor','Everyday Value']),1,45.6275,-122.6739]);
  const s5R = await db.run(`INSERT INTO stores (user_id,name,description,address,city,state,zip,phone,hours,has_lounge,has_walk_in_humidor,tags,verified,setup_complete,lat,lng) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?) RETURNING id`,
    [su5R.lastInsertRowid,'Store 5','Refined neighborhood lounge in Lake Oswego. Whiskey bar and monthly pairing events.','15820 Boones Ferry Rd','Lake Oswego','OR','97035','(503) 555-5820',h5,1,1,JSON.stringify(['Lounge','Whiskey Bar','Walk-in Humidor']),1,45.4201,-122.7051]);

  const sid1 = s1R.lastInsertRowid, sid2 = s2R.lastInsertRowid, sid3 = s3R.lastInsertRowid;
  const sid4 = s4R.lastInsertRowid, sid5 = s5R.lastInsertRowid;

  const cigarIds  = {};
  const vitolaIds = {};

  for (const c of cigars) {
    const r = await db.run(
      `INSERT INTO cigars (brand,name,country,wrapper,binder,filler,strength,flavor_notes,description,year_introduced) VALUES (?,?,?,?,?,?,?,?,?,?) RETURNING id`,
      [c.brand, c.name, c.country, c.wrapper, c.binder, c.filler, c.strength, c.flavor_notes, c.description, c.year_introduced]
    );
    const key = `${c.brand} - ${c.name}`;
    cigarIds[key]  = r.lastInsertRowid;
    vitolaIds[key] = [];
    for (const v of (vitolasMap[key] || [])) {
      const vr = await db.run(
        `INSERT INTO vitolas (cigar_id,name,length,ring_gauge,msrp) VALUES (?,?,?,?,?) RETURNING id`,
        [r.lastInsertRowid, v.name, v.length, v.ring_gauge, v.msrp]
      );
      vitolaIds[key].push({ id: vr.lastInsertRowid, name: v.name, msrp: v.msrp });
    }
  }

  async function addToStore(storeId, key, featured = 0, newArrival = 0) {
    const cid = cigarIds[key];
    for (const v of (vitolaIds[key] || [])) {
      const price = +(v.msrp * (0.9 + Math.random() * 0.2)).toFixed(2);
      await db.run(
        `INSERT INTO inventory (store_id,cigar_id,vitola_id,price,quantity,in_stock,is_featured,is_new_arrival) VALUES (?,?,?,?,?,1,?,?)`,
        [storeId, cid, v.id, price, Math.floor(Math.random() * 30) + 5, featured, newArrival]
      );
    }
  }

  await addToStore(sid1, 'Brand 1 - Cigar 3', 1);
  await addToStore(sid1, 'Brand 1 - Cigar 4', 1);
  await addToStore(sid1, 'Brand 1 - Cigar 5');
  await addToStore(sid1, 'Brand 1 - Cigar 2');
  await addToStore(sid1, 'Brand 3 - Cigar 13', 1);
  await addToStore(sid1, 'Brand 3 - Cigar 14');
  await addToStore(sid1, 'Brand 3 - Cigar 11');
  await addToStore(sid1, 'Brand 2 - Cigar 7', 0, 1);
  await addToStore(sid1, 'Brand 2 - Cigar 8');
  await addToStore(sid1, 'Brand 5 - Cigar 21', 1);
  await addToStore(sid1, 'Brand 5 - Cigar 22', 1);
  await addToStore(sid1, 'Brand 5 - Cigar 25', 0, 1);
  await addToStore(sid1, 'Brand 4 - Cigar 20');
  await addToStore(sid1, 'Brand 4 - Cigar 19');

  await addToStore(sid2, 'Brand 1 - Cigar 1', 1);
  await addToStore(sid2, 'Brand 1 - Cigar 2', 1);
  await addToStore(sid2, 'Brand 2 - Cigar 6', 1);
  await addToStore(sid2, 'Brand 2 - Cigar 9');
  await addToStore(sid2, 'Brand 2 - Cigar 10');
  await addToStore(sid2, 'Brand 2 - Cigar 7');
  await addToStore(sid2, 'Brand 3 - Cigar 11', 0, 1);
  await addToStore(sid2, 'Brand 3 - Cigar 12');
  await addToStore(sid2, 'Brand 3 - Cigar 15');
  await addToStore(sid2, 'Brand 4 - Cigar 16', 1);
  await addToStore(sid2, 'Brand 4 - Cigar 18');
  await addToStore(sid2, 'Brand 4 - Cigar 17');

  await addToStore(sid3, 'Brand 5 - Cigar 21', 1);
  await addToStore(sid3, 'Brand 5 - Cigar 22', 1);
  await addToStore(sid3, 'Brand 5 - Cigar 23', 1, 1);
  await addToStore(sid3, 'Brand 5 - Cigar 24');
  await addToStore(sid3, 'Brand 5 - Cigar 25', 1);
  await addToStore(sid3, 'Brand 1 - Cigar 3');
  await addToStore(sid3, 'Brand 1 - Cigar 5', 0, 1);
  await addToStore(sid3, 'Brand 3 - Cigar 13', 1);
  await addToStore(sid3, 'Brand 3 - Cigar 14');
  await addToStore(sid3, 'Brand 4 - Cigar 19');
  await addToStore(sid3, 'Brand 4 - Cigar 20');
  await addToStore(sid3, 'Brand 2 - Cigar 8', 0, 1);

  await addToStore(sid4, 'Brand 4 - Cigar 16', 1);
  await addToStore(sid4, 'Brand 4 - Cigar 18', 1);
  await addToStore(sid4, 'Brand 4 - Cigar 17');
  await addToStore(sid4, 'Brand 4 - Cigar 20');
  await addToStore(sid4, 'Brand 2 - Cigar 6', 1);
  await addToStore(sid4, 'Brand 2 - Cigar 9');
  await addToStore(sid4, 'Brand 2 - Cigar 10');
  await addToStore(sid4, 'Brand 2 - Cigar 7');
  await addToStore(sid4, 'Brand 3 - Cigar 11', 1);
  await addToStore(sid4, 'Brand 3 - Cigar 12');
  await addToStore(sid4, 'Brand 3 - Cigar 15', 0, 1);
  await addToStore(sid4, 'Brand 1 - Cigar 1');
  await addToStore(sid4, 'Brand 1 - Cigar 2');

  await addToStore(sid5, 'Brand 1 - Cigar 4', 1);
  await addToStore(sid5, 'Brand 1 - Cigar 3', 1);
  await addToStore(sid5, 'Brand 1 - Cigar 5');
  await addToStore(sid5, 'Brand 5 - Cigar 22', 1);
  await addToStore(sid5, 'Brand 5 - Cigar 21', 1, 1);
  await addToStore(sid5, 'Brand 5 - Cigar 25');
  await addToStore(sid5, 'Brand 5 - Cigar 23');
  await addToStore(sid5, 'Brand 4 - Cigar 17');
  await addToStore(sid5, 'Brand 4 - Cigar 20', 0, 1);
  await addToStore(sid5, 'Brand 2 - Cigar 7');
  await addToStore(sid5, 'Brand 2 - Cigar 8', 1);
  await addToStore(sid5, 'Brand 3 - Cigar 13');
  await addToStore(sid5, 'Brand 3 - Cigar 14', 0, 1);

  await db.run(`INSERT INTO reviews (user_id,cigar_id,vitola_id,rating,draw_rating,burn_rating,appearance_rating,flavor_notes,strength_experienced,smoke_time,pairing,review_text) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [uid,  cigarIds['Brand 1 - Cigar 3'],  vitolaIds['Brand 1 - Cigar 3'][0].id,  92, 5, 5, 4, JSON.stringify(['dark chocolate','espresso','leather']), 'medium-full', 65, 'Cold brew coffee', 'Solid maduro. Dark chocolate up front, leather by halfway. Burn was razor sharp.']);
  await db.run(`INSERT INTO reviews (user_id,cigar_id,vitola_id,rating,draw_rating,burn_rating,appearance_rating,flavor_notes,strength_experienced,smoke_time,pairing,review_text) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [uid,  cigarIds['Brand 5 - Cigar 21'], vitolaIds['Brand 5 - Cigar 21'][0].id, 94, 5, 4, 5, JSON.stringify(['red pepper','cedar','leather','coffee']), 'medium-full', 60, 'Rye whiskey', 'Punchy red pepper right away then settles into leather and coffee. Near perfect construction.']);
  await db.run(`INSERT INTO reviews (user_id,cigar_id,vitola_id,rating,draw_rating,burn_rating,appearance_rating,flavor_notes,strength_experienced,smoke_time,pairing,review_text) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [uid,  cigarIds['Brand 2 - Cigar 7'],  vitolaIds['Brand 2 - Cigar 7'][0].id,  90, 4, 5, 4, JSON.stringify(['cocoa','leather','black pepper','earth']), 'medium-full', 70, 'Black coffee', 'Cocoa and earth throughout. Good construction, never went out on me.']);
  await db.run(`INSERT INTO reviews (user_id,cigar_id,vitola_id,rating,draw_rating,burn_rating,appearance_rating,flavor_notes,strength_experienced,smoke_time,pairing,review_text) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [uid,  cigarIds['Brand 3 - Cigar 11'], vitolaIds['Brand 3 - Cigar 11'][0].id, 87, 5, 4, 4, JSON.stringify(['cedar','earth','nuts','pepper']), 'medium', 55, 'IPA', 'Great everyday smoke. Reliable and consistent. Would buy a bundle.']);
  await db.run(`INSERT INTO reviews (user_id,cigar_id,vitola_id,rating,draw_rating,burn_rating,appearance_rating,flavor_notes,strength_experienced,smoke_time,pairing,review_text) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [uid2, cigarIds['Brand 1 - Cigar 1'],  vitolaIds['Brand 1 - Cigar 1'][0].id,  88, 5, 5, 4, JSON.stringify(['cream','cedar','honey','floral']), 'mild', 45, 'Latte', 'My first cigar and it was amazing. So smooth, zero harshness.']);
  await db.run(`INSERT INTO reviews (user_id,cigar_id,vitola_id,rating,draw_rating,burn_rating,appearance_rating,flavor_notes,strength_experienced,smoke_time,pairing,review_text) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [uid2, cigarIds['Brand 2 - Cigar 9'],  vitolaIds['Brand 2 - Cigar 9'][0].id,  85, 4, 4, 5, JSON.stringify(['cream','cedar','nuts','honey']), 'mild-medium', 55, 'Herbal tea', 'Beautiful looking cigar. Creamy nut flavors were exactly what I wanted.']);
  await db.run(`INSERT INTO reviews (user_id,cigar_id,vitola_id,rating,draw_rating,burn_rating,appearance_rating,flavor_notes,strength_experienced,smoke_time,pairing,review_text) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [uid,  cigarIds['Brand 5 - Cigar 22'], vitolaIds['Brand 5 - Cigar 22'][0].id, 96, 5, 5, 5, JSON.stringify(['dark chocolate','molasses','coffee','leather']), 'full', 80, 'Aged bourbon', 'Best maduro in a long time. The molasses note on the retrohale is something else.']);

  await db.run(`INSERT INTO user_cigars (user_id,cigar_id,vitola_id,status,quantity,purchase_price,purchase_date,notes) VALUES (?,?,?,?,?,?,?,?)`, [uid,  cigarIds['Brand 1 - Cigar 3'],  vitolaIds['Brand 1 - Cigar 3'][1].id,  'humidor',  10, 14.50, '2026-05-10', 'Box purchase. Letting these rest.']);
  await db.run(`INSERT INTO user_cigars (user_id,cigar_id,vitola_id,status,quantity,purchase_price,purchase_date,notes) VALUES (?,?,?,?,?,?,?,?)`, [uid,  cigarIds['Brand 5 - Cigar 21'], vitolaIds['Brand 5 - Cigar 21'][0].id, 'humidor',  5,  13.00, '2026-06-01', 'Great after-dinner smoke.']);
  await db.run(`INSERT INTO user_cigars (user_id,cigar_id,vitola_id,status,quantity,purchase_price,purchase_date,notes) VALUES (?,?,?,?,?,?,?,?)`, [uid,  cigarIds['Brand 3 - Cigar 13'], vitolaIds['Brand 3 - Cigar 13'][0].id, 'humidor',  3,  13.50, '2026-06-10', 'Picked up at a Thursday smoke night.']);
  await db.run(`INSERT INTO user_cigars (user_id,cigar_id,vitola_id,status,quantity,purchase_price,purchase_date,notes) VALUES (?,?,?,?,?,?,?,?)`, [uid,  cigarIds['Brand 2 - Cigar 7'],  vitolaIds['Brand 2 - Cigar 7'][0].id,  'smoked',   1,  13.00, '2026-05-25', 'Rainy porch smoke. Perfect.']);
  await db.run(`INSERT INTO user_cigars (user_id,cigar_id,vitola_id,status,quantity,purchase_price,purchase_date,notes) VALUES (?,?,?,?,?,?,?,?)`, [uid,  cigarIds['Brand 5 - Cigar 22'], vitolaIds['Brand 5 - Cigar 22'][0].id, 'wishlist', 1,  null,  null,         'Need to grab a box.']);
  await db.run(`INSERT INTO user_cigars (user_id,cigar_id,vitola_id,status,quantity,purchase_price,purchase_date,notes) VALUES (?,?,?,?,?,?,?,?)`, [uid2, cigarIds['Brand 1 - Cigar 1'],  vitolaIds['Brand 1 - Cigar 1'][0].id,  'humidor',  5,  7.50,  '2026-06-15', 'My go-to. Always keeping 5 on hand.']);
  await db.run(`INSERT INTO user_cigars (user_id,cigar_id,vitola_id,status,quantity,purchase_price,purchase_date,notes) VALUES (?,?,?,?,?,?,?,?)`, [uid2, cigarIds['Brand 2 - Cigar 9'],  vitolaIds['Brand 2 - Cigar 9'][0].id,  'humidor',  3,  9.50,  '2026-06-20', 'Second purchase. Love these.']);

  for (const [userId, storeId] of [[uid, sid1], [uid, sid3], [uid, sid5], [uid2, sid4], [uid2, sid2], [uid2, sid1]]) {
    await db.run('INSERT INTO store_follows (user_id,store_id,notify_broadcasts,notify_deals,notify_new_arrivals) VALUES (?,?,1,1,1)', [userId, storeId]);
  }

  await db.run(`INSERT INTO deals (store_id,title,description,discount_percent,cigar_id,expires_at) VALUES (?,?,?,?,?,?)`, [sid1, 'Thursday Smoke Night', 'Weekly smoke night this Thursday. Featured: Cigar 21. $5 off all night.', null, cigarIds['Brand 5 - Cigar 21'], '2026-07-01']);
  await db.run(`INSERT INTO deals (store_id,title,description,discount_percent,cigar_id,expires_at) VALUES (?,?,?,?,?,?)`, [sid2, '5 for $35 — Cigar 11',  'Stock up on the best everyday smoke. Buy 5 for $35 this week only.', null, cigarIds['Brand 3 - Cigar 11'], '2026-07-05']);
  await db.run(`INSERT INTO deals (store_id,title,description,discount_percent,cigar_id,expires_at) VALUES (?,?,?,?,?,?)`, [sid3, 'New: Cigar 23',          'Just landed — Ecuador sun-grown wrapper, medium body. First week: $10.50.', null, cigarIds['Brand 5 - Cigar 23'], '2026-07-10']);
  await db.run(`INSERT INTO deals (store_id,title,description,discount_percent,cigar_id,expires_at) VALUES (?,?,?,?,?,?)`, [sid4, '10% Off All Brand 4',   '15-year anniversary weekend. 10% off every Brand 4 single Sat and Sun.', 10, null, '2026-06-29']);
  await db.run(`INSERT INTO deals (store_id,title,description,discount_percent,cigar_id,expires_at) VALUES (?,?,?,?,?,?)`, [sid5, 'Bourbon & Maduro Night', 'Three cigars, three bourbons, guided tasting notes. $55 per person.', null, cigarIds['Brand 5 - Cigar 22'], '2026-07-12']);

  await db.run(`INSERT INTO store_ratings (user_id,store_id,rating,comment) VALUES (?,?,?,?)`, [uid,  sid1, 5, 'Best walk-in humidor in the city. Thursday smoke nights are a highlight.']);
  await db.run(`INSERT INTO store_ratings (user_id,store_id,rating,comment) VALUES (?,?,?,?)`, [uid,  sid3, 5, 'Unmatched lounge. Great cocktails and curated selection.']);
  await db.run(`INSERT INTO store_ratings (user_id,store_id,rating,comment) VALUES (?,?,?,?)`, [uid,  sid5, 4, 'Great whiskey selection and comfortable seating.']);
  await db.run(`INSERT INTO store_ratings (user_id,store_id,rating,comment) VALUES (?,?,?,?)`, [uid2, sid4, 5, 'Everyone was so helpful when I was starting out. Great prices too.']);
  await db.run(`INSERT INTO store_ratings (user_id,store_id,rating,comment) VALUES (?,?,?,?)`, [uid2, sid2, 4, 'No frills but exactly what you need. Solid prices and friendly regulars.']);
  await db.run(`INSERT INTO store_ratings (user_id,store_id,rating,comment) VALUES (?,?,?,?)`, [uid2, sid1, 5, 'Huge humidor and the smoke nights are super welcoming for newer folks.']);

  const viewInserts = [];
  for (let d = 0; d < 14; d++) {
    const date = new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
    for (const [sid, base] of [[sid1, 18], [sid2, 12], [sid3, 15], [sid4, 10], [sid5, 8]]) {
      const count = Math.floor(Math.random() * base) + 3;
      for (let v = 0; v < count; v++) {
        viewInserts.push(db.run('INSERT INTO store_views (store_id,viewed_at) VALUES (?,?)', [sid, `${date} 12:00:00`]));
      }
    }
  }
  await Promise.all(viewInserts);

  await db.run(`INSERT INTO notifications (store_id,title,message,type,cigar_id) VALUES (?,?,?,?,?)`, [sid1, 'New Arrival: Cigar 25',  'Fresh batch just arrived — limited quantity.',                          'new_arrival',  cigarIds['Brand 5 - Cigar 25']]);
  await db.run(`INSERT INTO notifications (store_id,title,message,type,cigar_id) VALUES (?,?,?,?,?)`, [sid2, 'Cigar 11 Back in Stock',  'Our best-selling everyday smoke. Fresh rotation just hit the humidor.',  'new_arrival',  cigarIds['Brand 3 - Cigar 11']]);
  await db.run(`INSERT INTO notifications (store_id,title,message,type,cigar_id) VALUES (?,?,?,?,?)`, [sid3, 'Members: Early Access',    '48-hour member early access to Cigar 23. Stop by or call to hold yours.','announcement', cigarIds['Brand 5 - Cigar 23']]);
  await db.run(`INSERT INTO notifications (store_id,title,message,type,cigar_id) VALUES (?,?,?,?,?)`, [sid4, '15th Anniversary — 10% Off','Celebrating 15 years! 10% off all singles this weekend.',               'deal',         null]);
  await db.run(`INSERT INTO notifications (store_id,title,message,type,cigar_id) VALUES (?,?,?,?,?)`, [sid5, 'July Pairing Night Tickets','Only 8 seats left. $55 includes three cigars and three bourbons.',       'event',        null]);

  await db.run(`INSERT INTO smoke_list (user_id,cigar_id,priority,notes,recommended_by,status) VALUES (?,?,?,?,?,'pending')`, [uid,  cigarIds['Brand 5 - Cigar 22'], 'high',   'Everyone at smoke night raves about this.',           'Store 1 staff']);
  await db.run(`INSERT INTO smoke_list (user_id,cigar_id,priority,notes,recommended_by,status) VALUES (?,?,?,?,?,'pending')`, [uid,  cigarIds['Brand 5 - Cigar 25'], 'high',   'Never smoked a perfecto shape before.',               null]);
  await db.run(`INSERT INTO smoke_list (user_id,cigar_id,priority,notes,recommended_by,status) VALUES (?,?,?,?,?,'pending')`, [uid,  cigarIds['Brand 1 - Cigar 4'],  'medium', 'Saving for a long Saturday afternoon.',               'Spotted at Store 5']);
  await db.run(`INSERT INTO smoke_list (user_id,cigar_id,priority,notes,recommended_by,status) VALUES (?,?,?,?,?,'pending')`, [uid,  cigarIds['Brand 4 - Cigar 19'], 'medium', 'Heard the torpedo cuts really well with this blend.', 'Forum recommendation']);
  await db.run(`INSERT INTO smoke_list (user_id,cigar_id,priority,notes,recommended_by,status) VALUES (?,?,?,?,?,'pending')`, [uid,  cigarIds['Brand 2 - Cigar 8'],  'low',    'Want to compare with Cigar 3 side by side.',         null]);
  await db.run(`INSERT INTO smoke_list (user_id,cigar_id,priority,notes,recommended_by,status) VALUES (?,?,?,?,?,'pending')`, [uid2, cigarIds['Brand 1 - Cigar 2'],  'high',   'Stepping up from Cigar 1. Seems like the next one.', 'Store 4 staff']);
  await db.run(`INSERT INTO smoke_list (user_id,cigar_id,priority,notes,recommended_by,status) VALUES (?,?,?,?,?,'pending')`, [uid2, cigarIds['Brand 3 - Cigar 12'], 'medium', 'Heard it is bolder but still approachable.',          null]);
  await db.run(`INSERT INTO smoke_list (user_id,cigar_id,priority,notes,recommended_by,status) VALUES (?,?,?,?,?,'pending')`, [uid2, cigarIds['Brand 2 - Cigar 10'], 'low',    'Short smoke for busy evenings.',                      null]);

  await db.run(`INSERT INTO verification_requests (store_id,business_name,business_ein,business_phone,business_address,license_number,notes,status) VALUES (?,?,?,?,?,?,?,?)`,
    [sid2, 'Store 2 LLC', '91-2345678', '(503) 555-3412', '3412 SE Hawthorne Blvd, Portland, OR 97214', 'OR-TB-2009-00341', 'Independent shop operating since 2009.', 'pending']);

  await db.pool.query(
    `INSERT INTO seed_meta (key, value) VALUES ('version', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [SEED_VERSION]
  );

  console.log('[seed] Done! Demo accounts:');
  console.log('  smoker@demo.com / password123');
  console.log('  jane@demo.com   / password123');
  console.log('  store1@demo.com / password123');
  console.log('  admin@cigarbuddy.com / admin123');
}

module.exports = { seed };

if (require.main === module) {
  const force = process.argv.includes('--force');
  initSchema()
    .then(() => seed(force))
    .then(() => db.pool.end())
    .catch(err => { console.error(err); process.exit(1); });
}
