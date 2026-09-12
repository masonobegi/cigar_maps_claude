/**
 * Collapse one shop listed twice.
 *
 * The directory build de-duplicates within 120 m, but the same shop survives
 * twice whenever the two sources place it further apart or spell its street
 * differently, and the copies then disagree in public: The Pipe Rack and "The
 * Pipe" sit at 2200 Manchester Rd in Akron, one with hours and an Open badge
 * and one without; Wild Bill's Berkley is listed at "2530 W Twelve Mile" and
 * "2530 12 Mile"; Roz's Cigar Emporium in Ocala is listed three times.
 *
 * Matching on an identical name in the same city found none of those, so the
 * door decides: the same house number, a street that agrees once "Twelve" is
 * read as 12 and "State Rd" as hwy, and the same town — or two pins 60 m
 * apart. Then the names have to be the same shop, comparing only the words
 * that say which shop it is (not "cigar", "tobacco", "lounge", or the town).
 *
 * A chain with several branches in one city is NOT a duplicate: Tobacco Depot
 * really does have two shops on North Dale Mabry, and Bellevue Cigar at 565
 * Lincoln is not the dealer at 553.
 *
 * Only the plain cases merge on their own — two rows, one door, and a shared
 * phone or website, or one row that carries nothing of its own. Anything else
 * (three or more rows, conflicting phones, different house numbers) goes to a
 * review list. The survivor keeps the detail, takes anything the twin has that
 * it lacks, and the rest are hidden with storefront='duplicate' pointing at it,
 * never deleted.
 *
 * Usage:
 *   node src/jobs/dedupeListings.js --out dupes.json     # dry run
 *   node src/jobs/dedupeListings.js --from dupes.json --confirm
 */
'use strict';

const fs = require('fs');
const db = require('../database/db');
const { haversineMeters } = require('./osm');
const { writeFields } = require('../utils/storeEdits');

const SAME_PIN_M = 60;

// Words that say nothing about which shop this is.
const TRADE_WORDS = new Set(['cigar', 'cigars', 'cigarette', 'cigarettes', 'tobacco', 'tobacconist', 'smoke', 'smokes',
  'smoking', 'shop', 'shoppe', 'store', 'stores', 'lounge', 'bar', 'co', 'company', 'inc', 'llc', 'ltd', 'the', 'and',
  'of', 'house', 'humidor', 'humidors', 'emporium', 'outlet', 'vape', 'vapes', 'vapor', 'pipe', 'pipes', 'club',
  'room', 'shop', 'discount', 'premium', 'fine', 'quality']);

const NUMBER_WORDS = {
  one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
  eleven: '11', twelve: '12', thirteen: '13', fourteen: '14', fifteen: '15', sixteen: '16', seventeen: '17',
  eighteen: '18', nineteen: '19', twenty: '20', first: '1', second: '2', third: '3', fourth: '4', fifth: '5',
  sixth: '6', seventh: '7', eighth: '8', ninth: '9', tenth: '10',
};

const STREET_WORDS = {
  street: 'st', avenue: 'ave', road: 'rd', boulevard: 'blvd', drive: 'dr', highway: 'hwy', lane: 'ln',
  place: 'pl', court: 'ct', parkway: 'pkwy', trail: 'trl', circle: 'cir', way: 'way', route: 'hwy',
  north: 'n', south: 's', east: 'e', west: 'w', mile: 'mile',
};

/** "590 Vance Rd Ste 103" and "590 Vance Rd" are the same doorway. */
function normalizeAddress(a) {
  return String(a || '')
    .toLowerCase()
    .replace(/\b(?:ste|suite|unit|apt|bldg)\b\.?\s*[\w-]+|#\s*[\w-]+/g, ' ')
    .replace(/\b(?:us|sr|state\s+(?:rd|road|route)|county\s+(?:rd|road))\s*(?:hwy|highway)?[\s-]*(\d+)\b/g, 'hwy $1')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .map(w => NUMBER_WORDS[w] || STREET_WORDS[w] || w)
    .filter(Boolean)
    .join(' ')
    .trim();
}

/** Punctuation people leave out, left out on both sides. */
function foldName(n) {
  return String(n || '').toLowerCase().replace(/['’]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
}

/** The words that say which shop this is: not the trade, not the town. */
function distinctiveWords(store) {
  const town = new Set(foldName(store.city).split(' '));
  return foldName(store.name).split(' ')
    .map(w => w.replace(/s$/, ''))
    .filter(w => w.length > 2 && !TRADE_WORDS.has(w) && !TRADE_WORDS.has(`${w}s`) && !town.has(w) && !town.has(`${w}s`));
}

function houseNumber(address) {
  const m = String(address || '').trim().match(/^(\d+)/);
  return m ? m[1] : null;
}

// "Blvd" is not a street name: 111 Victoria Commons Blvd and 111 N Woodland
// Blvd matched on the type word alone, and they are different doors in Deland.
const STREET_TYPE_WORD = new Set(['st', 'ave', 'rd', 'blvd', 'dr', 'hwy', 'ln', 'pl', 'ct', 'pkwy',
  'trl', 'cir', 'ter', 'way', 'n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']);

function streetWords(address) {
  return normalizeAddress(address).split(' ').slice(1)
    .filter(w => w.length > 1 && !STREET_TYPE_WORD.has(w));
}

/** Same door: the same house number on a street that agrees, or two pins 60 m apart. */
function sameDoor(a, b) {
  const na = houseNumber(a.address), nb = houseNumber(b.address);
  if (na && nb && na === nb) {
    const sa = streetWords(a.address), sb = streetWords(b.address);
    const shared = sa.filter(w => sb.includes(w)).length;
    const zipA = String(a.zip || '').slice(0, 5), zipB = String(b.zip || '').slice(0, 5);
    const sameTown = (zipA && zipA === zipB) || (a.city && foldName(a.city) === foldName(b.city));
    if (sameTown && sa.length && sb.length && shared >= Math.ceil(Math.min(sa.length, sb.length) / 2)) return 'address';
  }
  if (a.lat && b.lat && b.lng && a.lng && haversineMeters(a.lat, a.lng, b.lat, b.lng) <= SAME_PIN_M) return 'pin';
  return null;
}

/** Same shop: the same name once punctuation goes, or the same distinctive words. */
function sameShop(a, b) {
  const fa = foldName(a.name), fb = foldName(b.name);
  if (fa && fa === fb) return 'name';
  const da = distinctiveWords(a), dbw = distinctiveWords(b);
  if (!da.length || !dbw.length) {
    // "The Pipe" says nothing on its own, but at this door it is "The Pipe Rack".
    const wa = fa.split(' '), wb = fb.split(' ');
    return wa.every(w => wb.includes(w)) || wb.every(w => wa.includes(w)) ? 'contained' : null;
  }
  const shared = da.filter(w => dbw.includes(w));
  if (shared.length && shared.length >= Math.min(da.length, dbw.length)) return 'distinctive';
  return null;
}

const digits = p => String(p || '').replace(/\D/g, '').slice(-10);
const host = w => String(w || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
const bare = r => !r.phone && !r.website && (!r.hours || r.hours === '{}');

/** How much a row is worth keeping: stock and activity first, then contact detail. */
function richness(r) {
  return (r.inventory_count > 0 ? 20 : 0) + (r.follower_count > 0 ? 8 : 0)
    + (r.hours_source === 'website' ? 6 : 0) + (r.phone ? 4 : 0) + (r.website ? 3 : 0)
    + (r.address ? 2 : 0) + (r.hours && r.hours !== '{}' ? 2 : 0) + (r.description ? 1 : 0)
    + (r.source === 'overture' ? 1 : 0) + Number(r.confidence || 0);
}

/** A shop and its own lounge keep their own listings: they open at different hours. */
const LOUNGE_NAME = /\b(lounge|club|bar|speakeasy|social)\b/i;

/** Can this pair be merged without a person looking? */
function automatic(cluster) {
  if (cluster.length !== 2) return false;
  const [a, b] = cluster;
  const phoneA = digits(a.phone), phoneB = digits(b.phone);
  if (phoneA && phoneB && phoneA !== phoneB) return false;          // two doors, two numbers
  // One word in common is not a shop in common: Cigars Direct and Humidors
  // Direct share a warehouse, not a business.
  const why = sameShop(a, b);
  if (why === 'distinctive') {
    const shared = distinctiveWords(a).filter(w => distinctiveWords(b).includes(w));
    if (shared.length < 2) return false;
  }
  if (LOUNGE_NAME.test(a.name || '') !== LOUNGE_NAME.test(b.name || '')) return false;
  if (phoneA && phoneA === phoneB) return true;
  if (a.website && b.website && host(a.website) === host(b.website)) return true;
  return bare(a) || bare(b);
}

async function plan({ out, log = console.log } = {}) {
  const rows = await db.all(`
    SELECT s.id, s.name, s.address, s.city, s.state, s.zip, s.lat, s.lng, s.phone, s.website, s.hours,
           s.hours_source, s.description, s.source, s.confidence, s.web_image_url, s.has_lounge, s.store_type,
           (SELECT COUNT(*) FROM inventory i WHERE i.store_id = s.id)::int AS inventory_count,
           (SELECT COUNT(*) FROM store_follows f WHERE f.store_id = s.id)::int AS follower_count
    FROM stores s
    WHERE s.visible = 1 AND s.claimed = 0 AND COALESCE(s.staff_edited, 0) = 0
    ORDER BY s.id`);

  // Only rows that could share a door are compared: same town, or near pins.
  const byTown = new Map();
  for (const r of rows) {
    const key = `${String(r.state || '').toUpperCase()}|${foldName(r.city)}`;
    if (!byTown.has(key)) byTown.set(key, []);
    byTown.get(key).push(r);
  }

  const clusters = [];
  for (const [, town] of byTown) {
    const used = new Set();
    for (let i = 0; i < town.length; i++) {
      if (used.has(town[i].id)) continue;
      const group = [town[i]];
      for (let j = i + 1; j < town.length; j++) {
        if (used.has(town[j].id)) continue;
        const door = group.map(g => sameDoor(g, town[j])).find(Boolean);
        const shop = group.map(g => sameShop(g, town[j])).find(Boolean);
        if (door && shop) { group.push(town[j]); used.add(town[j].id); }
      }
      if (group.length > 1) { group.forEach(g => used.add(g.id)); clusters.push(group); }
    }
  }

  const decisions = [];
  for (const cluster of clusters) {
    const sorted = [...cluster].sort((a, b) => richness(b) - richness(a) || a.id - b.id);
    const keep = sorted[0];
    const drop = sorted.slice(1);
    const tier = automatic(cluster) ? 'auto' : 'review';
    // Anything the survivor lacks and a twin has is worth keeping.
    const fill = {};
    for (const field of ['phone', 'website', 'address', 'zip', 'web_image_url', 'description']) {
      if (!keep[field]) {
        const from = drop.find(d => d[field]);
        if (from) fill[field] = from[field];
      }
    }
    if (!keep.hours || keep.hours === '{}') {
      const from = drop.find(d => d.hours && d.hours !== '{}');
      if (from) { fill.hours = from.hours; fill.hours_source = from.hours_source; }
    }
    decisions.push({
      tier,
      why: `${sameDoor(cluster[0], cluster[1])} + ${sameShop(cluster[0], cluster[1])}`,
      keep: { id: keep.id, name: keep.name, address: keep.address, city: keep.city, state: keep.state, phone: keep.phone, website: keep.website },
      drop: drop.map(d => ({ id: d.id, name: d.name, address: d.address, phone: d.phone, website: d.website })),
      fill,
    });
  }

  const auto = decisions.filter(d => d.tier === 'auto');
  const review = decisions.filter(d => d.tier === 'review');
  log(`examined ${rows.length} public listings`);
  log(`${decisions.length} doors carry more than one listing: ${auto.length} plain enough to merge, ${review.length} for review`);
  log(`extra rows: ${decisions.reduce((n, d) => n + d.drop.length, 0)}`);
  for (const d of decisions.slice(0, 25)) {
    log(`  [${d.tier}] keep #${d.keep.id} ${d.keep.name} — ${d.keep.address}, ${d.keep.city} (${d.why})`);
    for (const x of d.drop) log(`         drop #${x.id} ${x.name} — ${x.address}`);
  }
  if (out) { fs.writeFileSync(out, JSON.stringify(decisions, null, 1)); log(`\nwritten to ${out}`); }
  return decisions;
}

async function apply(file, { log = console.log } = {}) {
  const decisions = JSON.parse(fs.readFileSync(file, 'utf8'));
  let hidden = 0, filled = 0;
  for (const d of decisions) {
    for (const [field, value] of Object.entries(d.fill || {})) {
      const done = await writeFields(d.keep.id, { [field]: value }, {
        source: 'rule', job: 'dedupeListings', reason: `taken from duplicate listing #${d.drop[0].id}`,
      });
      filled += done.length;
    }
    for (const x of d.drop) {
      const r = await db.run(`UPDATE stores SET visible = 0, storefront = 'duplicate', storefront_reason = ?,
          storefront_checked_at = NOW() WHERE id = ? AND COALESCE(claimed, 0) = 0`,
        [`Same shop as listing #${d.keep.id}`, x.id]);
      hidden += r.changes;
      // Follows and ratings move to the listing that stays.
      await db.run('UPDATE store_follows SET store_id = ? WHERE store_id = ?', [d.keep.id, x.id]).catch(() => {});
      await db.run('UPDATE store_ratings SET store_id = ? WHERE store_id = ?', [d.keep.id, x.id]).catch(() => {});
    }
  }
  const left = await db.get('SELECT COUNT(*)::int AS n FROM stores WHERE visible = 1');
  log(`hid ${hidden} duplicate rows and filled ${filled} empty fields from them. ${left.n} listings remain public.`);
  return { hidden, filled, remaining: left.n };
}

function selfTest() {
  let pass = 0, fail = 0;
  const ok = (c, l, got) => { if (c) pass++; else { fail++; console.log(`  FAIL ${l}${got !== undefined ? `  -> ${JSON.stringify(got)}` : ''}`); } };
  const row = (id, name, address, city, extra = {}) => ({ id, name, address, city, state: 'MI', lat: 42, lng: -83, ...extra });

  ok(normalizeAddress('2530 W Twelve Mile Rd') === normalizeAddress('2530 W 12 Mile Rd'), '"Twelve Mile" is 12 Mile');
  ok(normalizeAddress('3970 Old US Hwy 131 C') === normalizeAddress('3970 Old hwy 131 C'), 'US 131 is hwy 131');
  ok(sameDoor(row(1, 'a', '2200 Manchester Rd', 'Akron'), row(2, 'b', '2200 Manchester Road', 'Akron')) === 'address', 'one house number, one street');
  ok(!sameDoor(row(1, 'a', '565 Lincoln Ave', 'Bellevue', { lat: 41, lng: -81 }), row(2, 'b', '553 Lincoln Ave', 'Bellevue', { lat: 42, lng: -83 })), 'different house numbers are different doors');
  ok(sameShop(row(1, 'The Pipe Rack', '', 'Akron'), row(2, 'The Pipe', '', 'Akron')) === 'contained', 'The Pipe Rack and The Pipe');
  ok(sameShop(row(1, "Cole's Tobacco", '', 'Pottstown'), row(2, 'Coles Tobacco', '', 'Pottstown')) === 'name', 'an apostrophe is not a different shop');
  ok(!sameShop(row(1, "Holt's Cigar Company", '', 'Philadelphia'), row(2, 'Ashton Cigar Bar', '', 'Philadelphia')), 'two shops at one address stay two shops');
  ok(!sameShop(row(1, 'Tobacco Town', '', 'Louisville'), row(2, 'Tobacco Row', '', 'Louisville')), 'Tobacco Town is not Tobacco Row');
  ok(!sameShop(row(1, 'Jacksonville Cigars', '', 'Jacksonville'), row(2, 'Jacksonville Tobacco', '', 'Jacksonville')), 'the town name never makes a match');
  ok(automatic([row(1, 'a', '1 Main', 'x', { phone: '(555) 111-2222' }), row(2, 'b', '1 Main', 'x', { phone: '555-111-2222' })]), 'one phone, one shop');
  ok(!automatic([row(1, 'a', '1 Main', 'x', { phone: '(555) 111-2222' }), row(2, 'b', '1 Main', 'x', { phone: '(555) 333-4444' })]), 'two phones need a person');
  ok(!automatic([row(1, 'a', '1 Main', 'x'), row(2, 'b', '1 Main', 'x'), row(3, 'c', '1 Main', 'x')]), 'three rows need a person');
  ok(!automatic([row(1, 'Cigars Direct', '1208 N Ward St', 'Tampa', { phone: '(555) 111-1111' }),
    row(2, 'Humidors Direct', '1208 N Ward St', 'Tampa', { phone: '(555) 111-1111' })]), 'one word in common is not a shop in common');
  ok(!automatic([row(1, 'Maduros Fine Cigars', '4991 S Alma School Rd', 'Chandler', { phone: '(555) 222-2222' }),
    row(2, 'Maduros Social Cigar Club and Lounge', '4991 S Alma School Rd', 'Chandler', { phone: '(555) 222-2222' })]), 'a shop and its lounge stay two listings');
  console.log(`dedupeListings self-test: ${pass} passed, ${fail} failed`);
  return fail === 0;
}

module.exports = { plan, apply, normalizeAddress, sameDoor, sameShop, foldName, distinctiveWords };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const arg = name => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : null; };
  if (argv[0] === 'selftest') process.exit(selfTest() ? 0 : 1);
  (async () => {
    if (argv.includes('--confirm') && arg('--from')) await apply(arg('--from'));
    else await plan({ out: arg('--out') });
    process.exit(0);
  })().catch(err => { console.error(err); process.exit(1); });
}
