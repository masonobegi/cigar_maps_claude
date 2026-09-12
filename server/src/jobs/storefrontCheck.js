/**
 * Keep the directory to places a person can actually walk into.
 *
 * The source datasets mix real shops with anything that merely has an address:
 * online-only retailers, wholesalers and distributors, cigar factories and
 * museums, holding companies registered at an office, and plain
 * mis-categorised businesses. A pressure-washing supplier called "Cigar City
 * Softwash Supply" is not a cigar shop.
 *
 * The rules are deliberately conservative and work from the source metadata,
 * because that is the only evidence that is reliable at this scale:
 *
 *   1. Category allow-list. A listing has to be categorised as retail tobacco
 *      or as a bar/lounge to stay. Everything else (metal suppliers, landmarks,
 *      ATMs, medical, event planning) goes. An allow-list beats a block-list
 *      here: the long tail of wrong categories is unbounded.
 *   2. Business-name rules. Wholesalers, distributors, importers, factories,
 *      marketing and holding companies, and names that read as a web store.
 *   3. Registry-only rows with no phone and no website, which are company
 *      filings at an address rather than a shop with a door.
 *
 * Deliberately NOT used: reading the shop's website to decide. Most modern shop
 * sites render their address in JavaScript, so the address is simply absent
 * from the HTML — judging on that would delete real shops. Website evidence is
 * only ever used to CLEAR a listing, never to condemn one.
 *
 * Verdicts go in stores.storefront: 'yes', 'online_only', 'not_retail'.
 * Anything other than 'yes' is hidden from the public map with its reason
 * recorded, so staff can review and reverse any of it in the admin panel.
 *
 * Usage:
 *   node src/jobs/storefrontCheck.js                 # dry run, shows the plan
 *   node src/jobs/storefrontCheck.js --confirm       # apply
 *   node src/jobs/storefrontCheck.js --sample 40     # print a random sample of keeps
 */
'use strict';

const fs = require('fs');
const db = require('../database/db');
const { loadDirectory } = require('./buildDirectory');

// ── What counts as a place you can walk into ────────────────────────────────

// Retail tobacco, plus the hospitality categories a cigar lounge shows up under.
const RETAIL_CATEGORIES = new Set([
  'tobacco_shop', 'cigar_shop', 'tobacconist', 'smoke_shop',
  'cigar_bar', 'lounge', 'bar', 'cocktail_bar', 'whisky_bar', 'wine_bar', 'pub',
  'nightlife', 'bar_and_grill_restaurant', 'social_club', 'pool_hall',
]);

// Not a shop, whatever the name says.
// A brewpub categorised as "pub" slipped through the category allow-list once:
// "Cigar City Brewing Brewpub & Taproom". Tampa's nickname puts "Cigar" in the
// name of businesses in every trade, so the trade word in the name has to be
// able to veto an otherwise-allowed category.
const NOT_A_SHOP = /\b(factory|manufactur\w+|museum|historical|distillery|plantation|warehouse|corporate\s+office|headquarters|brewery|brewing|brewpub|taproom|winery|cidery|meadery|barbershop|hair\s+salon|nail\s+salon|car\s+wash|laundromat|pharmacy|dentist|dental|urgent\s+care|storage)\b/i;
const TRADE = /\b(wholesale\w*|distributor\w*|distributi\w+|import(s|ers?|ing)?|export(s|ers?|ing)?|trading\s+(co|company|inc)|supply|supplies|vending|brokers?|logistics|fulfillment|marketing)\b/i;
const CORPORATE = /\b(holdings?|enterprises?|ventures?|investments?|management|associates|consulting|properties|realty|capital|industries)\b/i;
const ONLINE = /\b(online|web\s*store|webstore|e-?commerce|mail\s*order)\b|\.(com|net|shop|store)\b/i;
// "Ashton Cigar Bar LLC" is a shop; "A & D Enterprises" is not. A shop word
// rescues a name that would otherwise read as a pure company.
const SHOP_WORD = /\b(shop|store|lounge|bar|humidor|tobacconist|cigars?|smoke|tobacco|pipe)\b/i;
const LEGAL_ONLY = /\b(llc|l\.l\.c\.?|inc\.?|incorporated|corp\.?|corporation|ltd\.?)\b/i;

// The tobacco trade's own side of the business: makers, leaf dealers and head
// offices. R.J. Reynolds' five Winston-Salem sites, Lorillard, Liggett and
// Myers and Universal Leaf were all on the public map as tobacco shops.
// "Leaf tobacco" alone is a shop name — Green Leaf, Golden Leaf, Burning Leaf
// Tobacco Shoppe — so only a leaf company counts.
const MAKER = /\b(r\.?\s?j\.?\s+reynolds|reynolds\s+american|lorillard|liggett|philip\s+morris|altria|universal\s+leaf\s+tobacco|swedish\s+match|alliance\s+one|pyxus|santa\s+fe\s+natural\s+tobacco|leaf\s+tobacco\s+(co|company|corp|inc)|tobacco\s+(growers|processing|redrying|curing)|cigar\s+(factory|manufactur\w+))\b/i;

// Campaigns against smoking, health departments and quit lines: the opposite
// of a shop, and they carry the word "tobacco" in their name.
const CIVIC = /\b(tobacco[- ]free|tobacco\s*21|quit\s?line|health\s+(department|district|coalition)|department\s+of\s+health|prevention\s+(program|coalition)|cessation|american\s+lung|truth\s+initiative|smoke[- ]free)\b/i;

// A pin on something that is not a business at all.
// Marina is a district in Long Beach and San Francisco before it is a dock,
// so it is not here.
const NOT_A_PLACE = /\b(trail\s?head|trail\s+parking|boat\s+ramp|rv\s+(park|lot|resort)|campground|union\s+hall|city\s+hall|court\s?house|post\s+office|a\.?t\.?f\.?\s+(office|bureau)|bureau\s+of|state\s+office|county\s+office|fire\s+(station|department)|police\s+(station|department)|public\s+library|cemetery|park\s+(and|&)\s+ride|rest\s+area)\b/i;

// Cigars brought to a wedding, not a door to walk through. A lounge on wheels
// is always this, whatever else its name says; a shop that also rolls at
// events keeps its listing, so the rest is judged on the name before a dash.
const MOBILE_VENUE = /\b(mobile|pop[- ]?up)\s+(cigar|lounge|humidor|bar)\b|\bcigar\s+(truck|trailer|cart)\b/i;
const EVENT_SERVICE = /\bcigar\s+(roller|rolling|catering|caterer|bar\s+(hire|rental|service))\b|\bevent\s+(planning|services?|rentals?)\b/i;

// A back garden with a name. Some are jokes; none is open to customers.
// A man cave is not one of them: "Mancave Cigars" in Miami and "The Mancave
// Cigar Lounge and Barbershop" in Tampa are both shops.
const PRIVATE_PLACE = /\b(backyard|back\s+porch|garage\s+lounge|basement\s+lounge|monica\s+lewinsky)\b/i;

// Names that say "we ship humidors", with nowhere to walk in.
// "Cigarettes & Cigars For Less" is a corner shop in Orange, so only the
// catalogue names themselves count.
const WEB_CATALOGUE = /\b(humidors?\s+(direct|outlet|depot|discount|online|superstore|warehouse)|luxury\s+cigar\s+humidors|grand\s+humidors|cigars?\s+direct\s*$)/i;

// Another trade wearing a tobacco name. This directory is for cigar and pipe
// shops: cigarettes on the side are fine, but a glass and weed shop that keeps
// a few cigars by the till is not a cigar shop, whatever it sells. Mary Jane's
// House of Glass is the type.
const OTHER_TRADE = /\b(vape|vapes|vaping|vapor|vapour|e-?cigs?|e-?cigarettes?|e-?liquid|e-?juice|hookah|shisha|kava|kratom|cbd|hemp|delta[- ]?8|thc|marijuana|cannabis|dispensary|weed|420|710|dab|dabs|bong|bongs|glass|head\s?shop|hydro|smoke\s?&\s?glass|novelty|adult\s+(store|shop)|porn)\b/i;

// A shop whose main trade is cigarettes: "Cigarettes 4 Less", "Discount
// Cigarettes". The word alone is not enough — "Cigaret Shopper" in Maine sells
// cigars — so it has to read as the whole business.
const CIGARETTE_FIRST = /\b(cigarettes?|ciggies)\s*(4|for)?\s*(less|cheap|outlet|depot|city|discount|warehouse|express|plus)\b|\b(discount|cheap|wholesale)\s+cigarettes?\b/i;

/** Where a trade word sits in the name: first word wins the shop's identity. */
function tradeComesFirst(name) {
  const other = String(name).search(OTHER_TRADE);
  const cigar = String(name).search(/\b(cigars?|tobacconist|humidor|stogies?|habanos?|puros?|pipe\s+tobacco)\b/i);
  if (other < 0) return false;
  if (cigar < 0) return true;
  return other < cigar;
}

// The trade the business is in, and the kind of premises it is. Both halves
// have to be present: "Cigar City Brewing" names a city, not a cigar shop.
const TRADE_WORD = /\b(cigars?|tobacco|tobacconist|humidor|stogies?)\b/i;
const PREMISES_WORD = /\b(shop|shoppe|store|lounge|bar|house|company|co|club|room|den|emporium|cafe|café|parlor|parlour|outlet|depot)\b/i;

function namesACigarShop(name) {
  return TRADE_WORD.test(name) && PREMISES_WORD.test(name);
}

// A cigar room of its own, rather than "cigar" used as a place name. Tampa is
// nicknamed Cigar City, so "Cigar City Brewing" must not read as a cigar bar,
// while "Cigar Lounge and Barbershop" and "Cigars & Winery" must.
const CIGAR_PREMISES = /\bcigars?\s*(?:&|and)?\s*(?:lounge|bar|shop|shoppe|store|room|club|den|house|emporium|parlou?r)\b|\bcigars\b|\btobacconist\b|\bhumidor\b/i;

function namesACigarPremises(name) {
  return CIGAR_PREMISES.test(name);
}

/** The cigar word carries the name: at the head of it, or at its tail. */
function namesACigarBusiness(name) {
  const n = String(name).trim();
  return /^(the\s+)?(cigars?|tobacconist|humidor)\b/i.test(n)
    || /\b(cigars?|cigar\s+(bar|lounge|shop|room|club)|tobacconist|humidors?)\s*$/i.test(n);
}

/**
 * @param rec  the directory record (carries the source category in .raw)
 * @param row  the database row (name, phone, website, source)
 */
function verdict(rec, row) {
  const name = (row?.name || rec?.name || '').trim();
  const category = rec?.raw?.category || null;
  const isOsm = (rec?.source || row?.source) === 'osm';
  const hasPhone = !!(row?.phone || (rec?.phone));
  const hasSite = !!(row?.website || rec?.website);

  // Plenty of genuine lounges share premises with another trade — "Whiskey
  // Beard Barbershop and Cigar Lounge", "Three Beagles Brewing and Cigar Bar".
  // The other trade only disqualifies a listing that never names a cigar
  // premises of its own. "Cigar City Brewing" is a brewery; "Cigar Bar and
  // Brewery" is a cigar bar.
  //
  // A cash machine is the one exception to that: "CoinFlip Bitcoin ATM - Choice
  // Cigars & Tobacco" names a cigar shop, but the listing is the ATM in it.
  if (/\b(bitcoin|crypto(currency)?)\s+atm\b|\bcoinflip\b|\bbyte federal\b|\bathena bitcoin\b/i.test(name)) {
    return { storefront: 'not_retail', reason: `"${name}" is a cash machine inside a shop, not the shop` };
  }
  if (MAKER.test(name)) return { storefront: 'not_retail', reason: `"${name}" makes or handles tobacco, and does not sell it over a counter` };
  if (CIVIC.test(name)) return { storefront: 'not_retail', reason: `"${name}" is a health or anti-smoking body, not a shop` };
  // "City Hall Cigar Bar" and "Courthouse Cigar" are named after the building
  // across the street; they are still cigar bars.
  // "Courthouse Cigar" and "Cigar Bar at Sawmill Resort Campground" are named
  // after what they stand near; the cigar word at the head or the tail of the
  // name is the business. "Bureau Of Alcohol Tobacco" and "Port Tobacco RV
  // Resort" only carry the word in passing.
  if (NOT_A_PLACE.test(name) && !namesACigarBusiness(name)) {
    return { storefront: 'not_retail', reason: `"${name}" is not a business you can buy cigars in` };
  }
  if (MOBILE_VENUE.test(name)) {
    return { storefront: 'not_retail', reason: `"${name}" is a lounge on wheels, with no door of its own` };
  }
  // A shop that also rolls at weddings keeps its listing: only the service
  // itself goes. The name before a dash or slash is the business.
  if (EVENT_SERVICE.test(name) && !namesACigarPremises(name.split(/[-–/,]/)[0])) {
    return { storefront: 'not_retail', reason: `"${name}" brings cigars to events; it has no door of its own` };
  }
  // "Backyard Cigars" is a shop; a back garden with no phone and no website is not.
  if (PRIVATE_PLACE.test(name) && !hasPhone && !hasSite) {
    return { storefront: 'not_retail', reason: `"${name}" is somebody's own place, not a shop` };
  }
  // Another trade wearing a tobacco name, and cigarette outlets: this directory
  // is for shops whose trade is cigars and pipe tobacco.
  if (tradeComesFirst(name)) {
    return { storefront: 'not_retail', reason: `"${name}" is a vape, glass or smoke shop, not a cigar shop` };
  }
  if (CIGARETTE_FIRST.test(name) && !namesACigarPremises(name)) {
    return { storefront: 'not_retail', reason: `"${name}" sells cigarettes as its trade, not cigars` };
  }
  if (WEB_CATALOGUE.test(name)) return { storefront: 'online_only', reason: `"${name}" sells humidors and cigars by post` };
  // A plumber called Pipe Dreams is a plumber. The name alone is not enough:
  // its own website has to be a plumbing company's.
  if (/\bpipe/i.test(name) && /plumb/i.test(`${name} ${row?.website || ''}`)) {
    return { storefront: 'not_retail', reason: `"${name}" is a plumbing company` };
  }
  if (NOT_A_SHOP.test(name) && !namesACigarPremises(name)) {
    return { storefront: 'not_retail', reason: `"${name}" is another kind of business, not a cigar shop` };
  }
  if (ONLINE.test(name)) return { storefront: 'online_only', reason: `"${name}" reads as an online store` };
  if (TRADE.test(name)) return { storefront: 'not_retail', reason: `"${name}" reads as a wholesaler, distributor or supplier` };
  if (CORPORATE.test(name) && !SHOP_WORD.test(name)) {
    return { storefront: 'not_retail', reason: `"${name}" reads as a company, not a shop` };
  }

  // OpenStreetMap entries were placed by a person standing somewhere, and carry
  // no Overture category, so the category gate does not apply to them.
  if (!isOsm && category && !RETAIL_CATEGORIES.has(category)) {
    // Categories in this data are frequently wrong: Tampa is nicknamed Cigar
    // City, so a barbershop, a brewery and a title company all carry "cigar" in
    // their name, while genuine lounges get filed under "cafe" or "barber". A
    // name that says what the business sells outranks a category that does not.
    if (!namesACigarShop(name)) {
      return { storefront: 'not_retail', reason: `listed as "${category.replace(/_/g, ' ')}", which is not a shop you can visit` };
    }
  }

  // A business registration with no phone and no website is a filing, not a shop.
  if (!isOsm && !hasPhone && !hasSite && LEGAL_ONLY.test(name)) {
    return { storefront: 'not_retail', reason: 'company registration with no phone and no website' };
  }

  return { storefront: 'yes', reason: category ? `retail category "${category.replace(/_/g, ' ')}"` : 'mapped as a tobacco shop' };
}

// ── Sweep ───────────────────────────────────────────────────────────────────

/** Write the reviewed hides, and nothing else. */
async function applyDecisions(file, { log = console.log } = {}) {
  const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
  let hidden = 0;
  for (const r of rows) {
    const res = await db.run(`UPDATE stores SET storefront = ?, storefront_reason = ?, storefront_checked_at = NOW(), visible = 0
      WHERE id = ? AND COALESCE(claimed, 0) = 0 AND COALESCE(staff_edited, 0) = 0`,
      [r.storefront, String(r.reason).slice(0, 300), r.id]);
    hidden += res.changes;
  }
  const left = await db.get('SELECT COUNT(*)::int AS n FROM stores WHERE visible = 1');
  log(`hid ${hidden} of ${rows.length} reviewed listings. ${left.n} listings remain public.`);
  return { hidden, remaining: left.n };
}

async function sweep({ confirm = false, sample = 0, out = null, applyFrom = null, log = console.log } = {}) {
  const dir = loadDirectory();
  if (!dir) { log('no built directory file; run npm run build:directory first'); return { skipped: true }; }
  const bySourceId = new Map(dir.stores.map(s => [`${s.source}:${s.source_id}`, s]));

  // Claimed shops and anything staff has already ruled on are never touched.
  //
  // Neither is a listing another sweep has already settled. This check reads
  // only a name and a category, so it cannot know that a shop has shut or that
  // it is one listing of two: Redland Cigar Co was closed from its own website
  // and this sweep put its storefront back to "yes" six minutes later, which
  // would have returned it to the map, open, at the next import.
  const rows = await db.all(`
    SELECT id, name, city, state, phone, website, source, source_id, visible, store_type
    FROM stores
    WHERE claimed = 0 AND COALESCE(staff_edited, 0) = 0 AND source IN ('osm', 'overture')
      AND COALESCE(storefront, 'yes') NOT IN ('closed', 'duplicate', 'moved', 'unproven')
      AND COALESCE(operating_status, 'open') NOT IN ('permanently_closed', 'likely_closed')
    ORDER BY id
  `);
  log(`examining ${rows.length} unclaimed listings`);

  const results = [];
  for (const row of rows) {
    const rec = bySourceId.get(`${row.source}:${row.source_id}`) || null;
    results.push({ row, ...verdict(rec, row) });
  }

  const tally = {};
  for (const r of results) tally[r.storefront] = (tally[r.storefront] || 0) + 1;
  log(`verdicts: ${JSON.stringify(tally)}`);

  // Only listings currently on the public map matter for the count that shows.
  const removals = results.filter(r => r.storefront !== 'yes' && r.row.visible === 1);
  log(`\ncurrently public but not a storefront: ${removals.length}`);
  const byReason = {};
  for (const r of removals) {
    const key = r.reason.replace(/^"[^"]*" /, '').slice(0, 60);
    byReason[key] = (byReason[key] || 0) + 1;
  }
  for (const [k, v] of Object.entries(byReason).sort((a, b) => b[1] - a[1]).slice(0, 12)) log(`  ${v.toString().padStart(4)}  ${k}`);

  log('\nexamples of what would go:');
  for (const r of removals.slice(0, 25)) log(`  #${r.row.id} ${r.row.name} (${r.row.city || '?'}, ${r.row.state || '?'}) — ${r.reason}`);

  if (sample) {
    const keeps = results.filter(r => r.storefront === 'yes' && r.row.visible === 1);
    log(`\nrandom sample of ${sample} that would be KEPT (check these read like real shops):`);
    const step = Math.max(1, Math.floor(keeps.length / sample));
    for (let i = 0; i < keeps.length && i / step < sample; i += step) {
      const k = keeps[i];
      log(`  ${k.row.name} (${k.row.city || '?'}, ${k.row.state || '?'}) — ${k.reason}`);
    }
  }

  // The hides go to a file to be read through before anything is applied: a
  // rule written off a name is exactly the kind that catches a real shop.
  if (out) {
    fs.writeFileSync(out, JSON.stringify(removals.map(r => ({
      id: r.row.id, name: r.row.name, city: r.row.city, state: r.row.state,
      phone: r.row.phone, website: r.row.website, store_type: r.row.store_type,
      storefront: r.storefront, reason: r.reason,
    })), null, 1));
    log(`\n${removals.length} hides written to ${out}`);
  }

  if (!confirm) {
    log('\nDry run. Nothing changed. Re-run with --confirm to apply.');
    return { dryRun: true, tally, would_hide: removals.length };
  }

  let hidden = 0, marked = 0;
  for (const r of results) {
    const hide = r.storefront !== 'yes';
    await db.run(
      `UPDATE stores SET storefront = ?, storefront_reason = ?, storefront_checked_at = NOW()${hide ? ', visible = 0' : ''} WHERE id = ?`,
      [r.storefront, r.reason.slice(0, 300), r.row.id]);
    marked++;
    if (hide && r.row.visible === 1) hidden++;
  }
  const left = await db.get('SELECT COUNT(*)::int AS n FROM stores WHERE visible = 1');
  log(`\nmarked ${marked}, hid ${hidden}. ${left.n} listings remain on the public map.`);
  return { tally, hidden, remaining: left.n };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const i = args.indexOf('--sample');
  const arg = name => { const j = args.indexOf(name); return j >= 0 && args[j + 1] ? args[j + 1] : null; };
  const run = arg('--from') && args.includes('--confirm')
    ? applyDecisions(arg('--from'))
    : sweep({ confirm: args.includes('--confirm') && !arg('--from'), sample: i >= 0 ? parseInt(args[i + 1]) || 30 : 0, out: arg('--out') });
  run
    .then(() => process.exit(0))
    .catch(err => { console.error(err); process.exit(1); });
}

module.exports = { sweep, applyDecisions, verdict, RETAIL_CATEGORIES };
