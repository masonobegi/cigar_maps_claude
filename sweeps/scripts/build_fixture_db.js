/**
 * A synthetic stand-in for production, so the sweeps can be dry-run where the
 * real database cannot be reached.
 *
 * THIS IS NOT PRODUCTION DATA. Every listing in it is invented. It exists so
 * that code which only fails against a populated database — the distance SQL,
 * the paging, the candidate ceiling, the recall monitor — is actually
 * exercised somewhere. A number produced from this fixture describes the code,
 * never the directory: no decision about a real shop may be taken from it.
 *
 * Its shape is copied from the audit in sweeps/plan.json so the code meets the
 * conditions it has to survive: shops piled onto the 62 metro centres with the
 * dense ones genuinely dense (Midtown's 100-mile box held 658 listings), a long
 * rural tail, hidden rows, a realistic spread of hours sources, and pathological
 * rows (no pin, two shops on one spot, a shop exactly on a radius).
 *
 *   PGLITE_DIR=/tmp/cbfixture node sweeps/scripts/build_fixture_db.js [count]
 */
'use strict';

const path = require('path');
const SRV = path.join(__dirname, '..', '..', 'server', 'src');
const db = require(path.join(SRV, 'database', 'db'));
const { initSchema, runMigrations } = require(path.join(SRV, 'database', 'schema'));
const { METROS } = require(path.join(SRV, 'jobs', 'recallMonitor'));

/** A fixed stream, so two runs of the fixture build the same directory. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

const STATE_OF = {
  'New York (Midtown)': 'NY', Brooklyn: 'NY', 'Newark NJ': 'NJ', 'Long Island (Hempstead)': 'NY',
  'Washington DC': 'DC', Baltimore: 'MD', 'Fort Lauderdale': 'FL', 'Los Angeles': 'CA',
  Chicago: 'IL', Houston: 'TX', Phoenix: 'AZ', Scottsdale: 'AZ', Philadelphia: 'PA',
  'San Antonio': 'TX', 'San Diego': 'CA', Dallas: 'TX', 'Fort Worth': 'TX', 'San Jose': 'CA',
  'San Francisco': 'CA', Austin: 'TX', Jacksonville: 'FL', 'Columbus OH': 'OH', Charlotte: 'NC',
  Indianapolis: 'IN', Seattle: 'WA', Denver: 'CO', Nashville: 'TN', 'Oklahoma City': 'OK',
  Boston: 'MA', Providence: 'RI', Hartford: 'CT', 'Portland OR': 'OR', 'Las Vegas': 'NV',
  Detroit: 'MI', Memphis: 'TN', Louisville: 'KY', Milwaukee: 'WI', Albuquerque: 'NM',
  Tucson: 'AZ', Sacramento: 'CA', 'Kansas City': 'MO', Atlanta: 'GA', Miami: 'FL',
  'West Palm Beach': 'FL', Tampa: 'FL', Orlando: 'FL', Raleigh: 'NC', Minneapolis: 'MN',
  'New Orleans': 'LA', Cleveland: 'OH', Pittsburgh: 'PA', Cincinnati: 'OH', 'St. Louis': 'MO',
  'Salt Lake City': 'UT', 'Richmond VA': 'VA', 'Virginia Beach': 'VA', 'Charleston SC': 'SC',
  Buffalo: 'NY', Honolulu: 'HI', 'Camas WA': 'WA', Boise: 'ID', 'Des Moines': 'IA',
};

// The eight metros the audit found losing rows get the crowds; the rest are
// ordinary. The weights reproduce "Midtown 658 in a 100-mile box".
const CROWDED = new Set(['New York (Midtown)', 'Brooklyn', 'Newark NJ', 'Long Island (Hempstead)',
  'Washington DC', 'Baltimore', 'Fort Lauderdale', 'Los Angeles', 'Philadelphia', 'Miami']);

const NAME_HEAD = ['Havana', 'El Rey', 'Smoke', 'Ash', 'Cohiba', 'Casa', 'Don', 'Royal', 'Old Town',
  'Liberty', 'Anthony', "Wild Bill", 'King', 'Cedar', 'Union', 'Corner', 'Fine', 'Premium'];
const NAME_TAIL = ['Cigars', 'Cigar Co.', 'Tobacco', 'Tobacconist', 'Cigar Lounge', 'Humidor',
  'Pipe & Cigar', 'Cigar Room', 'Smoke Shop', 'Cigar Bar'];
const TYPES = ['cigar_shop', 'cigar_lounge', 'tobacco_shop'];
// Roughly production's split: 782 of 4,377 public listings carry hours somebody
// stands behind, the rest carry map hours or none.
const HOURS_SOURCES = ['website', 'website', 'osm', 'osm', 'osm', 'osm', 'osm', null, null, 'chain', 'owner'];

const ALL_DAY = { Mon: '9am-9pm', Tue: '9am-9pm', Wed: '9am-9pm', Thu: '9am-9pm', Fri: '9am-11pm', Sat: '10am-11pm', Sun: '11am-6pm' };
const WEEKDAYS = { Mon: '10am-6pm', Tue: '10am-6pm', Wed: '10am-6pm', Thu: '10am-6pm', Fri: '10am-6pm', Sat: 'Closed', Sun: 'Closed' };
const LATE = { Thu: '5pm-2am', Fri: '5pm-2am', Sat: '5pm-2am' };

async function main() {
  const target = parseInt(process.argv[2]) || 6000;
  await initSchema();
  await runMigrations();
  for (const t of ['inventory', 'store_follows', 'store_ratings', 'store_views', 'stores']) {
    await db.run(`DELETE FROM ${t}`).catch(() => {});
  }

  const rand = rng(20260912);
  const rows = [];
  const weights = METROS.map(([n]) => (CROWDED.has(n) ? 7 : 1));
  const weightSum = weights.reduce((a, b) => a + b, 0);

  for (let i = 0; i < target; i++) {
    // One row in twelve is rural: dropped anywhere in the lower 48.
    const rural = rand() < 1 / 12;
    let lat, lng, city, state;
    if (rural) {
      lat = 26 + rand() * 21;
      lng = -123 + rand() * 55;
      city = `Township ${i}`;
      state = 'TX';
    } else {
      let pick = rand() * weightSum, m = 0;
      while (pick > weights[m]) { pick -= weights[m]; m++; }
      const [name, mLat, mLng] = METROS[m];
      // Spread inside about 60 miles, biased towards the centre the way a real
      // metro is, so the 10- and 25-mile boxes are not empty.
      const dist = Math.pow(rand(), 2) * 60;
      const bearing = rand() * 2 * Math.PI;
      lat = mLat + (dist / 69) * Math.cos(bearing);
      lng = mLng + (dist / (69 * Math.cos(mLat * Math.PI / 180))) * Math.sin(bearing);
      city = name.replace(/ \(.*\)| [A-Z]{2}$/, '');
      state = STATE_OF[name];
    }

    const hoursSource = HOURS_SOURCES[Math.floor(rand() * HOURS_SOURCES.length)];
    const shape = rand();
    const hours = hoursSource === null ? null
      : JSON.stringify(shape < 0.6 ? ALL_DAY : shape < 0.85 ? WEEKDAYS : LATE);

    rows.push({
      name: `${NAME_HEAD[Math.floor(rand() * NAME_HEAD.length)]} ${NAME_TAIL[Math.floor(rand() * NAME_TAIL.length)]} #${i}`,
      description: rand() < 0.3 ? 'A neighbourhood cigar lounge with a walk-in humidor.' : null,
      address: `${100 + Math.floor(rand() * 8000)} Main St`,
      city, state, zip: String(10000 + Math.floor(rand() * 89999)),
      lat, lng,
      hours, hours_source: hoursSource,
      // Zones are left null on purpose: timeZoneFor has to do the work, which is
      // what production does for listings recomputeTimezones has not reached.
      timezone: null,
      // About 40% hidden, as production is (4,377 public of ~42,000 rows, but a
      // fixture with 90% hidden rows would make every metro case trivial).
      visible: rand() < 0.6 ? 1 : 0,
      has_lounge: rand() < 0.42 ? 1 : 0,
      has_walk_in_humidor: rand() < 0.08 ? 1 : 0,
      store_type: TYPES[Math.floor(rand() * TYPES.length)],
      claimed: rand() < 0.004 ? 1 : 0,
      verified: 0,
      confidence: rand() < 0.5 ? 1 : 0.55,
    });
  }

  // The awkward rows, each one a bug this code has to not have.
  const [, chiLat, chiLng] = METROS.find(m => m[0] === 'Chicago');
  const edge = [
    { name: 'No Pin Cigars (fixture)', lat: null, lng: null, city: 'Chicago', state: 'IL', visible: 1 },
    { name: 'Same Spot A (fixture)', lat: chiLat, lng: chiLng, city: 'Chicago', state: 'IL', visible: 1 },
    { name: 'Same Spot B (fixture)', lat: chiLat, lng: chiLng, city: 'Chicago', state: 'IL', visible: 1 },
    // 25.0 miles due north of the Chicago centre, to sit on a radius boundary.
    { name: 'On The 25 Mile Line (fixture)', lat: chiLat + 25 / 69, lng: chiLng, city: 'Evanston', state: 'IL', visible: 1 },
    { name: 'Hidden Downtown (fixture)', lat: chiLat, lng: chiLng, city: 'Chicago', state: 'IL', visible: 0 },
  ];
  for (const e of edge) {
    rows.push({
      description: null, address: '1 Fixture Way', zip: '60601',
      hours: JSON.stringify(ALL_DAY), hours_source: 'website', timezone: null,
      has_lounge: 1, has_walk_in_humidor: 0, store_type: 'cigar_shop',
      claimed: 0, verified: 0, confidence: 1, ...e,
    });
  }

  const cols = ['name', 'description', 'address', 'city', 'state', 'zip', 'lat', 'lng', 'hours',
    'hours_source', 'timezone', 'visible', 'has_lounge', 'has_walk_in_humidor', 'store_type',
    'claimed', 'verified', 'confidence'];
  const list = cols.map(c => `"${c}"`).join(', ');
  for (let i = 0; i < rows.length; i += 1000) {
    const batch = rows.slice(i, i + 1000).map(r => { const o = {}; for (const c of cols) o[c] = r[c] ?? null; return o; });
    await db.run(
      `INSERT INTO stores (${list}) SELECT ${list} FROM json_populate_recordset(NULL::stores, ?::json)`,
      [JSON.stringify(batch)]);
  }

  // A handful of in-stock rows, so has_inventory is not a filter that matches
  // nothing. They need a cigar to point at.
  await db.run(`INSERT INTO cigars (brand, name) VALUES ('Fixture', 'House Blend')
                ON CONFLICT DO NOTHING`).catch(() => {});
  const cigar = await db.get(`SELECT id FROM cigars ORDER BY id LIMIT 1`);
  if (cigar) {
    const some = await db.all(`SELECT id FROM stores WHERE visible = 1 ORDER BY id LIMIT 60`);
    for (const s of some) {
      await db.run('INSERT INTO inventory (store_id, cigar_id, in_stock, price) VALUES (?, ?, 1, 12.5)', [s.id, cigar.id]);
    }
  }

  const c = await db.get('SELECT COUNT(*)::int AS n, SUM(visible)::int AS pub FROM stores');
  console.log(`fixture ready (SYNTHETIC, not production): ${c.n} listings, ${c.pub} public`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
