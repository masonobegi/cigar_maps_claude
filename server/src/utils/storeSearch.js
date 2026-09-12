/**
 * The pieces GET /stores and the recall monitor both need.
 *
 * They used to live inside the route, which meant the monitor could only check
 * the route by calling it over HTTP, and any drift between "what the route
 * filters on" and "what the monitor thinks it filters on" went unnoticed. The
 * filter builder is now one function that both import, so a new filter is
 * covered by the monitor the day it is added.
 *
 * Run `node src/utils/storeSearch.js` for the self-test.
 */
'use strict';

/** Miles. The radius chips stop here, and the server refuses to go further. */
const RADIUS_MAX_MI = 100;

/** A page of results. The client asks for more by offset. */
const PAGE_SIZE = 60;

/**
 * How many listings we are willing to measure in one request. Past this the
 * answer is "narrow your search" rather than a quietly shortened list — the
 * whole point of this sweep is that a truncated list is worse than an honest
 * refusal.
 *
 * The number has to clear the WHOLE directory, not just the worst radius
 * search. A list with no location — the home page, the autocomplete, the review
 * picker — has no radius to bound it and is simply the directory, paged. Sized
 * at 5,000 it cleared the worst radius search (763 listings within 100 miles of
 * Philadelphia) by a wide margin and then refused the nationwide list outright,
 * because the directory has 7,904 public rows. The recall monitor's contract
 * check caught it.
 *
 * The candidate rows are eight small columns and the page is hydrated
 * separately, so the cost of a large set is a linear pass in JavaScript, not a
 * large response. 50,000 covers every listing in the directory, hidden ones
 * included, with room to grow.
 */
const CANDIDATE_CEILING = 50000;

// ── What a visitor with no location sees ────────────────────────────────────
//
// The nationwide list used to be ordered by paid placement, then claimed, then
// verified, then follower count, then in-stock count, then classifier
// confidence, then name. With nobody claimed, verified or followed, that came
// down to "how many cigars are in your web feed, then alphabetically" — so the
// list was the 42 shops with a feed, then names from "105 Cigar Co." to "Casa
// Fuente", and 96% of the directory never appeared at all. The home page showed
// the same Tucson and Florida online sellers to every visitor in the country.
//
// The audit left the choice open between a prompt, a neutral sample and IP
// geolocation. IP geolocation needs a paid or licensed database, and spending
// money is not this session's call, so it is out. Between the other two: a
// prompt refuses to answer a question the customer asked, and a directory whose
// front page is a form is not a directory. So: a neutral sample, ordered by
// what makes a listing useful rather than by what it paid or how its name
// begins.
//
//   1. A listing that looks closed goes last. A dead website or a
//      likely_closed flag is the one thing here that makes a row actively
//      unhelpful.
//   2. One listing per website ahead of the second. Anthony's has three Tucson
//      branches on one feed, 3J's four, Miami Humidor two, Lucky two; showing
//      all of them is showing one shop four times. Listings with no website
//      each count as their own, because they share no feed.
//   3. Then completeness, 0 to 4: a working website, known hours, a phone, a
//      picture. This is the closest thing to "would a customer get something
//      out of this card".
//   4. Then a shuffle seeded by the date, so the tail rotates daily and every
//      listing gets its turn, while any single day's order is stable enough to
//      cache, page through and test.
//
// Paid placement is deliberately NOT in this list: see the note below. A shop
// buys the top of a search near it, not the top of the country.

/**
 * The ORDER BY for a list with no location, as SQL. Takes no parameters so it
 * can be dropped into any query.
 */
function noLocationOrderSql() {
  return `
    -- 1. A listing that looks closed is last, whatever else it has.
    (CASE WHEN s.operating_status = 'likely_closed' THEN 1
          WHEN s.website IS NOT NULL AND s.website <> ''
               AND s.website_status IN ('dns_fail','timeout','refused','not_found','error',
                                        'parked','elsewhere','hijacked','store_unavailable','removed')
          THEN 1 ELSE 0 END) ASC,
    -- 2. The first listing on a website before the second on the same one.
    ROW_NUMBER() OVER (
      PARTITION BY CASE
        WHEN s.website IS NULL OR s.website = '' THEN 'id:' || s.id::text
        ELSE split_part(lower(regexp_replace(regexp_replace(s.website, '^[a-z]+://', ''), '^www\\.', '')), '/', 1)
      END
      ORDER BY s.claimed DESC, s.confidence DESC, s.id
    ) ASC,
    -- 3. Completeness: a working site, hours, a phone, a picture.
    ((CASE WHEN s.website IS NOT NULL AND s.website <> ''
                AND COALESCE(s.website_status, 'ok') IN ('ok','blocked') THEN 1 ELSE 0 END)
     + (CASE WHEN s.hours IS NOT NULL AND s.hours NOT IN ('', '{}', '[]', 'null') THEN 1 ELSE 0 END)
     + (CASE WHEN s.phone IS NOT NULL AND s.phone <> '' THEN 1 ELSE 0 END)
     + (CASE WHEN COALESCE(s.logo_url, s.cover_url, s.web_image_url) IS NOT NULL THEN 1 ELSE 0 END)
    ) DESC,
    -- 4. A daily shuffle, so the tail rotates and every listing gets its turn.
    md5(s.id::text || to_char(NOW(), 'YYYY-MM-DD')) ASC,
    s.id ASC`;
}

/** The same completeness score in JS, for tests and for anything paging in memory. */
function completenessScore(row) {
  const live = row.website && ['ok', 'blocked'].includes(row.website_status || 'ok');
  const hours = row.hours && !['', '{}', '[]', 'null'].includes(String(row.hours).trim());
  const phone = !!row.phone;
  const picture = !!(row.logo_url || row.cover_url || row.web_image_url);
  return (live ? 1 : 0) + (hours ? 1 : 0) + (phone ? 1 : 0) + (picture ? 1 : 0);
}

/** Does this row look closed enough to belong at the end of a neutral list? */
function looksUnhelpful(row) {
  if (row.operating_status === 'likely_closed') return true;
  return !!row.website && ['dns_fail', 'timeout', 'refused', 'not_found', 'error',
    'parked', 'elsewhere', 'hijacked', 'store_unavailable', 'removed'].includes(row.website_status);
}

// ── Paid placement ──────────────────────────────────────────────────────────
//
// billing.js sells Featured at $49 for "top placement in your city and on the
// map" and Partner at $149 for "top placement across your whole metro". Until
// now `is_featured` was simply the first sort key, which meant one Featured
// shop would have sat on top of every list in the country — the opposite of
// what "in your city" says — and in a location search the distance sort
// overrode it entirely, so the thing being sold did not happen at all.
//
// The reading taken here, and the reasoning, because somebody will want to
// change it:
//
//  1. A sponsored slot NEVER removes or displaces a result. It lifts a row that
//     already matched the search to the top of the list; the set and the total
//     are identical either way. Search recall is the one thing this codebase has
//     just spent a whole sweep fixing, and no amount of money should be able to
//     undo it.
//  2. It is labelled. Undisclosed paid placement is deceptive, and a directory
//     that quietly sells its result order is worth less than one that does not.
//     The client shows "Sponsored" on the row.
//  3. It only happens inside what the customer actually searched — a radius
//     around a point, or a named city. A paid shop is never inserted into a
//     town nobody searched. That is what makes "top placement in your city" an
//     honest promise rather than spam.
//  4. Featured and Partner differ by REACH, not just by precedence, because
//     that is what the two plans describe: "your city" against "your whole
//     metro". A Featured shop can take a slot when the search is near it; a
//     Partner shop can take one across the metro.
//  5. Two slots, first page only. The plans promise a shop comes up first, not
//     that it owns the page. A list that is half advertising is not a directory.
//  6. A list with no location gets NO sponsored slots at all. "Top placement in
//     your city" cannot mean "top of a nationwide list", and that contradiction
//     is exactly what the audit asked to have settled.
//
// The map is deliberately untouched: a viewport returns every pin in it, so
// there is no order to sell. "On the map" is honoured by the badge a paid shop
// already carries, not by moving pins.

/** How many rows at the top of the first page may be sponsored. */
const SPONSORED_SLOTS = 2;

/** "Your city" — how far a Featured shop's placement reaches, in miles. */
const FEATURED_REACH_MI = 15;

/** "Your whole metro" — the same for Partner. */
const PARTNER_REACH_MI = 50;

/** 2 for Partner, 1 for Featured, 0 for anyone not paying today. */
function sponsorRank(row, now = new Date()) {
  const until = row.featured_until ? new Date(row.featured_until) : null;
  if (!until || !(until.getTime() > now.getTime())) return 0;
  return row.plan === 'partner' ? 2 : row.plan === 'featured' ? 1 : 0;
}

/**
 * Reorder one already-filtered, already-sorted list so that up to
 * SPONSORED_SLOTS paying shops sit at the front.
 *
 * Pure, and deliberately a reordering: every row that went in comes out, which
 * is what lets the recall monitor assert that sponsorship cannot cost a
 * customer a result. `bounded` is false for a nationwide list, and then this
 * does nothing at all.
 *
 * Returns a new array; the input is not mutated. Sponsored rows are tagged
 * `sponsored` and `sponsored_plan` so the client can label them and so the
 * monitor can tell a paid lift from a broken sort.
 */
function applySponsored(rows, { bounded = false, now = new Date(), slots = SPONSORED_SLOTS } = {}) {
  if (!bounded || !Array.isArray(rows) || rows.length < 2) return rows;

  const eligible = [];
  for (const r of rows) {
    const rank = sponsorRank(r, now);
    if (!rank) continue;
    // Reach. A row with no distance (a city search) is inside its own city by
    // definition — that is what the customer asked for.
    const reach = rank === 2 ? PARTNER_REACH_MI : FEATURED_REACH_MI;
    const d = r.distance_mi === null || r.distance_mi === undefined ? null : Number(r.distance_mi);
    if (d !== null && d > reach) continue;
    eligible.push({ row: r, rank, d });
  }
  if (!eligible.length) return rows;

  // Partner first, then the nearer shop, then the lower id so the order never
  // wobbles between two identical requests.
  eligible.sort((a, b) => (b.rank - a.rank)
    || ((a.d ?? Infinity) - (b.d ?? Infinity))
    || (a.row.id - b.row.id));

  const lifted = eligible.slice(0, Math.max(0, slots));
  if (!lifted.length) return rows;
  const liftedIds = new Set(lifted.map(x => x.row.id));

  return [
    ...lifted.map(x => ({ ...x.row, sponsored: true, sponsored_plan: x.rank === 2 ? 'partner' : 'featured' })),
    ...rows.filter(r => !liftedIds.has(r.id)),
  ];
}

/**
 * Hours somebody stands behind. Map hours are not in this set: about half the
 * ones we could check against a shop's own site were wrong on some day, so an
 * "Open now" filter built on them sends customers to locked doors. This is the
 * server-side twin of CONFIRMED_HOURS in client/src/components/StoreCard.jsx.
 */
const CONFIRMED_HOURS_SOURCES = ['website', 'owner', 'staff', 'chain'];

/** Earth's radius in miles, as used everywhere else in this codebase. */
const EARTH_MI = 3958.8;

function haversine(lat1, lng1, lat2, lng2) {
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_MI * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * The same formula in SQL, so the radius cut happens in the database over the
 * whole filtered set instead of over whichever 300 rows survived a LIMIT.
 * `least(1, ...)` keeps asin inside its domain when rounding pushes the term a
 * hair over 1 for two points at the same spot.
 */
function distanceSql(latExpr, lngExpr, latParam = '?', lngParam = '?') {
  return `(${EARTH_MI} * 2 * asin(least(1, sqrt(
      power(sin(radians(${latExpr} - ${latParam}) / 2), 2) +
      cos(radians(${latParam})) * cos(radians(${latExpr})) *
      power(sin(radians(${lngExpr} - ${lngParam}) / 2), 2)
    ))))`;
}

/**
 * SQL and JS agree to about 1e-13 miles, but they are two implementations of
 * one formula and a listing sitting exactly on the radius could land either
 * way. The SQL side is generous by a nanomile so the database never drops a
 * row the brute-force truth set keeps.
 */
const BOUNDARY_EPS_MI = 1e-9;

/** A degrees box around a point, used to prefilter on idx_stores_lat_lng. */
function boundingBox(lat, lng, radiusMi) {
  const dLat = radiusMi / 69;
  // cos() is clamped so a search near a pole cannot produce an absurd width.
  const dLng = radiusMi / (69 * Math.max(0.2, Math.cos(lat * Math.PI / 180)));
  return { minLat: lat - dLat, maxLat: lat + dLat, minLng: lng - dLng, maxLng: lng + dLng };
}

// ── Folding a name the way a customer types it ─────────────────────────────
//
// Names are compared with the punctuation people leave out, the accents they
// cannot reach on a phone keyboard, and the abbreviations they expand or do
// not. Otherwise "wild bills" misses every one of Wild Bill's listings, "cafe
// havana" misses Caf\u00e9 Havana, "hawaii cigar" misses Hawai\u02bbi Cigar, and
// "saint james" misses St. James.
//
// Both halves must fold identically: `fold` is the SQL expression applied to
// the column, `folded` the JavaScript applied to what the customer typed. A
// difference between them is a search that quietly matches nothing rather than
// one that errors, so sweeps/scripts/fold_parity.js runs the pair against each
// other in the database engine itself.
//
// Accents are removed by Unicode decomposition rather than by a table of
// characters: NFD splits an accented letter into a plain letter plus a
// combining mark, and the marks are then dropped. Postgres has done this since
// version 13 (`normalize(text, NFD)`) and PGlite carries it, so both halves can
// use the same rule. A hand-kept table was the first attempt and it was already
// wrong on real data — it folded the Spanish names it was written for but not
// the macrons in Ā and ū, nor the Vietnamese ệ and ả, and there is no reason
// to keep discovering that one alphabet at a time.
//
// The steps, in order:
//   1. lower-case
//   2. NFD, then drop the combining marks (Caf\u00e9 \u2192 cafe, Đ\u1ec7 \u2192 de)
//   3. the letters NFD does not decompose, which need a letter of their own
//      (\u00df \u2192 ss, \u00e6 \u2192 ae, \u0153 \u2192 oe, \u00f8 \u2192 o, \u0111 \u2192 d, \u0142 \u2192 l)
//   4. decoration nobody types: \u00ae \u2122 \u2713 \u2714, the emoji block, and the variation
//      selector that follows them
//   5. apostrophes of every shape, periods, commas and hyphens dropped — the
//      okina in Hawai\u02bbi is an apostrophe to everyone who types it
//   6. "&" read as "and"
//   7. St \u2192 Saint and Mt \u2192 Mount, as whole words only, so "1st" and a shop
//      called "Smoke St" fold the same way on both sides and still match
//
// Step 7 runs after step 5 so that "St." has already lost its period.
//
// Characters outside the Latin alphabet are deliberately left alone. A shop
// whose name is in Arabic or Japanese is searchable by its own name; stripping
// those letters would make it searchable by nothing.

/** Letters with no canonical decomposition, each needing its own replacement. */
const EXPANSIONS = [
  ['\u00df', 'ss'], ['\u00e6', 'ae'], ['\u0153', 'oe'], ['\u00f8', 'o'],
  ['\u0111', 'd'], ['\u0142', 'l'], ['\u00f0', 'd'], ['\u0127', 'h'], ['\u00fe', 'th'],
];
/** Marks and badges that appear in names but that nobody searches for. */
const DECORATION = '\u00ae\u2122\u2713\u2714\u2605\u2606\u2665\u00a9\ufe0f\u200d';
/** Every apostrophe shape in use, including the Hawaiian okina. */
const DROPPED = "'\u2019\u2018\u02bb\u02bc\u02bd\u0060\u00b4.,-";
/** Abbreviations customers expand or do not, folded to the long form. */
const WORD_FORMS = [['st', 'saint'], ['mt', 'mount']];
/** The emoji planes, as a Postgres and a JavaScript pattern. */
const EMOJI_SQL = '[\\U0001F000-\\U0001FAFF\\u2600-\\u27bf]';
const EMOJI_JS = /[\u{1F000}-\u{1FAFF}\u2600-\u27bf]/gu;
/** Combining marks, which is what NFD leaves an accent as. */
const MARKS_SQL = '[\\u0300-\\u036f\\u1ab0-\\u1aff\\u20d0-\\u20f0\\ufe20-\\ufe2f]';
const MARKS_JS = /[\u0300-\u036f\u1ab0-\u1aff\u20d0-\u20f0\ufe20-\ufe2f]/g;

const sqlLiteral = text => `'${text.replace(/'/g, "''")}'`;

/** The SQL expression that folds a column. */
function fold(value) {
  let expr = `regexp_replace(normalize(lower(${value}), NFD), ${sqlLiteral(MARKS_SQL)}, '', 'g')`;
  for (const [from, to] of EXPANSIONS) expr = `replace(${expr}, ${sqlLiteral(from)}, ${sqlLiteral(to)})`;
  expr = `regexp_replace(${expr}, ${sqlLiteral(EMOJI_SQL)}, '', 'g')`;
  expr = `translate(${expr}, ${sqlLiteral(DECORATION + DROPPED)}, '')`;
  expr = `replace(${expr}, '&', 'and')`;
  // \y is a word boundary in Postgres' regular expressions, so this expands a
  // standalone "st" and leaves the "st" inside "1st" and "Best" alone.
  for (const [from, to] of WORD_FORMS) {
    expr = `regexp_replace(${expr}, ${sqlLiteral('\\y' + from + '\\y')}, ${sqlLiteral(to)}, 'g')`;
  }
  return expr;
}

/** The same folding, in JavaScript, for what the customer typed. */
function folded(text) {
  let out = String(text).toLowerCase().normalize('NFD').replace(MARKS_JS, '');
  for (const [from, to] of EXPANSIONS) out = out.split(from).join(to);
  out = out.replace(EMOJI_JS, '');
  for (const ch of DECORATION + DROPPED) out = out.split(ch).join('');
  out = out.replace(/&/g, 'and');
  for (const [from, to] of WORD_FORMS) {
    out = out.replace(new RegExp(`\\b${from}\\b`, 'g'), to);
  }
  return out;
}

/**
 * Every non-spatial filter the list, the map and the monitor share.
 *
 * `open_now` is deliberately absent: it depends on each shop's own clock and is
 * applied in JS over the full candidate set (see the route). Everything else
 * runs in SQL, where it belongs.
 *
 * @param {object} query - req.query, or a plain object in the monitor.
 * @returns {{where: string[], params: any[]}}
 */
function buildFilters(query = {}) {
  const { q, city, state, has_lounge, has_walk_in_humidor, store_type, claimed, has_inventory } = query;
  const where = ['s.visible = 1'];
  const params = [];

  if (q) {
    // name_aliases holds the names a shop has also gone by — what it was
    // called before a rebrand, its chain's brand — as a JSON array. Searching
    // the column's text is enough for a substring match and needs no JSON
    // functions: the quotes between entries stop a needle matching across two
    // separate aliases, which is the only thing that could go wrong here.
    where.push(`(${fold('s.name')} LIKE ? OR ${fold('COALESCE(s.name_aliases, \'\')')} LIKE ?`
      + ` OR s.description ILIKE ? OR ${fold('s.city')} LIKE ?)`);
    const needle = `%${folded(q)}%`;
    params.push(needle, needle, `%${q}%`, needle);
  }
  // A city chip carries its state, and matches the town itself: "Washington, DC"
  // used to return shops in Michigan, Missouri and Pennsylvania.
  if (city && state) { where.push(`${fold('s.city')} = ?`); params.push(folded(city)); }
  else if (city) { where.push(`${fold('s.city')} LIKE ?`); params.push(`%${folded(city)}%`); }
  if (state) { where.push('s.state = ?'); params.push(String(state).toUpperCase()); }
  if (has_lounge === '1') where.push('s.has_lounge = 1');
  if (has_walk_in_humidor === '1') where.push('s.has_walk_in_humidor = 1');
  // store_type accepts a comma-separated list ("cigar_shop,cigar_lounge") so the
  // type chips can multi-select.
  if (store_type) {
    const types = String(store_type).split(',').map(t => t.trim()).filter(Boolean);
    if (types.length) {
      where.push(`s.store_type IN (${types.map(() => '?').join(',')})`);
      params.push(...types);
    }
  }
  if (claimed === '1') where.push('s.claimed = 1');
  // EXISTS rather than a HAVING on the aggregate: it short-circuits on the
  // first in-stock row instead of counting every join row per store.
  if (has_inventory === '1') {
    where.push('EXISTS (SELECT 1 FROM inventory inv WHERE inv.store_id = s.id AND inv.in_stock = 1)');
  }
  return { where, params };
}

/** The same predicate in JS, for the monitor's brute-force truth set. */
function matchesFilters(store, query = {}) {
  const { q, city, state, has_lounge, has_walk_in_humidor, store_type, claimed, has_inventory } = query;
  if (Number(store.visible) !== 1) return false;
  if (q) {
    const needle = folded(q);
    const hit = folded(store.name || '').includes(needle)
      || folded(store.name_aliases || '').includes(needle)
      || String(store.description || '').toLowerCase().includes(String(q).toLowerCase())
      || folded(store.city || '').includes(needle);
    if (!hit) return false;
  }
  if (city && state) { if (folded(store.city || '') !== folded(city)) return false; }
  else if (city) { if (!folded(store.city || '').includes(folded(city))) return false; }
  if (state && String(store.state || '').toUpperCase() !== String(state).toUpperCase()) return false;
  if (has_lounge === '1' && Number(store.has_lounge) !== 1) return false;
  if (has_walk_in_humidor === '1' && Number(store.has_walk_in_humidor) !== 1) return false;
  if (store_type) {
    const types = String(store_type).split(',').map(t => t.trim()).filter(Boolean);
    if (types.length && !types.includes(store.store_type)) return false;
  }
  if (claimed === '1' && Number(store.claimed) !== 1) return false;
  if (has_inventory === '1' && !store.has_inventory) return false;
  return true;
}

/** Radius as the server will honour it: a number, clamped, never NaN. */
function normalizeRadius(raw, fallback = 50) {
  const r = parseFloat(raw);
  const value = Number.isFinite(r) && r > 0 ? r : fallback;
  return { radiusMi: Math.min(RADIUS_MAX_MI, value), capped: value > RADIUS_MAX_MI };
}

function hoursAreConfirmed(source) {
  return CONFIRMED_HOURS_SOURCES.includes(source);
}

module.exports = {
  RADIUS_MAX_MI, PAGE_SIZE, CANDIDATE_CEILING, CONFIRMED_HOURS_SOURCES, BOUNDARY_EPS_MI,
  SPONSORED_SLOTS, FEATURED_REACH_MI, PARTNER_REACH_MI, sponsorRank, applySponsored,
  noLocationOrderSql, completenessScore, looksUnhelpful,
  haversine, distanceSql, boundingBox, fold, folded, buildFilters, matchesFilters,
  normalizeRadius, hoursAreConfirmed,
};

// ── self-test ────────────────────────────────────────────────────────────────
if (require.main === module) {
  let pass = 0, fail = 0;
  const ok = (cond, label, extra) => {
    if (cond) { pass++; console.log(`  ok   ${label}`); }
    else { fail++; console.log(`  FAIL ${label}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ''}`); }
  };

  // Distances against figures anyone can check on a map.
  const nycToPhilly = haversine(40.7549, -73.9840, 39.9526, -75.1652);
  ok(Math.abs(nycToPhilly - 83.3) < 1.5, 'Midtown to Philadelphia is about 83 miles', nycToPhilly);
  ok(haversine(41.8781, -87.6298, 41.8781, -87.6298) === 0, 'a point is zero miles from itself');
  const chiToMilw = haversine(41.8781, -87.6298, 43.0389, -87.9065);
  ok(Math.abs(chiToMilw - 80.5) < 2, 'Chicago to Milwaukee is about 80 miles', chiToMilw);

  // The box has to contain the circle, or the prefilter drops real rows.
  for (const [lat, lng] of [[40.75, -73.98], [25.77, -80.19], [47.6, -122.33], [21.3, -157.86]]) {
    for (const radius of [10, 25, 50, 100]) {
      const box = boundingBox(lat, lng, radius);
      let inside = true;
      for (let b = 0; b < 360; b += 5) {
        // Walk the circle's rim and check each point lies in the box.
        const br = b * Math.PI / 180;
        const pLat = lat + (radius / 69) * Math.cos(br);
        const pLng = lng + (radius / (69 * Math.cos(lat * Math.PI / 180))) * Math.sin(br);
        if (pLat < box.minLat || pLat > box.maxLat || pLng < box.minLng || pLng > box.maxLng) inside = false;
      }
      ok(inside, `the ${radius}mi box around ${lat},${lng} contains its own circle`);
    }
  }

  // Folding: the reason "wild bills" finds Wild Bill's.
  ok(folded("Wild Bill's Tobacco") === 'wild bills tobacco', 'an apostrophe folds away');
  ok(folded('Smith & Sons') === 'smith and sons', '"&" reads as "and"');
  // Accents: a phone keyboard does not reach them, so neither side may need them.
  ok(folded('Caf\u00e9 Havana') === 'cafe havana', 'an accent folds to its plain letter');
  ok(folded('Do\u00f1a Flor') === 'dona flor', 'and so does a tilde');
  ok(folded('EL RE\u00dd') === 'el rey', 'folding is case-blind');
  ok(folded('Str\u00e6nge \u00dftuff') === 'straenge sstuff', 'a two-letter fold expands rather than dropping');
  ok(folded('plain ascii') === 'plain ascii', 'ordinary text is left as it is');
  // Abbreviations, whole words only.
  ok(folded('St. James Cigars') === 'saint james cigars', '"St." reads as "Saint"');
  ok(folded('Saint James Cigars') === 'saint james cigars', 'and so does "Saint", so the two agree');
  ok(folded('Mt Pleasant') === folded('Mount Pleasant'), '"Mt" and "Mount" agree too');
  ok(folded('1st Street Smokes') === '1st street smokes', 'the "st" in "1st" is not an abbreviation');
  ok(folded('Best Cigars') === 'best cigars', 'nor the one inside a word');
  ok(folded('Smoke St') === 'smoke saint', 'a trailing "St" folds, and folds the same way on both sides');
  // The two halves of the pair have to agree about their own shape.
  // Real names from the directory that the first, hand-kept accent table missed.
  ok(folded('Hawai\u02bbi Cigar') === 'hawaii cigar', 'the Hawaiian okina is an apostrophe');
  ok(folded('\u0100loha \u016bkulele') === 'aloha ukulele', 'a macron folds away');
  ok(folded('Ti\u1ec7m Thu\u1ed1c L\u00e1') === 'tiem thuoc la', 'and so do stacked Vietnamese marks');
  ok(folded('Ve\u0301lazquez') === folded('V\u00e9lazquez'),
    'a name typed as letter-plus-mark folds the same as the single composed character');
  ok(folded('Smoke\u00ae Shop\u2122') === 'smoke shop', 'a trademark badge is not part of the name');
  ok(folded('Smoke \ud83d\udca8 Shop') === 'smoke  shop', 'nor is an emoji');
  ok(folded('\u0160KODA') === 'skoda' && folded('Zigarren\u00dftube') === 'zigarrensstube',
    'the letters with no decomposition still get one');
  ok(folded('\u0645\u062d\u0644 \u0627\u0644\u062f\u062e\u0627\u0646') === '\u0645\u062d\u0644 \u0627\u0644\u062f\u062e\u0627\u0646',
    'a name in another alphabet is left intact, so it stays searchable by its own letters');
  ok(DECORATION.split('').every(c => !/[a-z0-9]/.test(c)) && DROPPED.split('').every(c => !/[a-z0-9]/.test(c)),
    'nothing dropped is a letter or a digit, which would corrupt ordinary names');

  // buildFilters and matchesFilters must agree on what a filter means.
  const rows = [
    { id: 1, visible: 1, name: "Wild Bill's", city: 'Detroit', state: 'MI', has_lounge: 1, store_type: 'cigar_shop', claimed: 0, has_inventory: false, description: '' },
    { id: 2, visible: 1, name: 'Havana Room', city: 'Detroit', state: 'MI', has_lounge: 0, store_type: 'cigar_lounge', claimed: 1, has_inventory: true, description: 'lounge and bar' },
    { id: 3, visible: 0, name: 'Hidden Shop', city: 'Detroit', state: 'MI', has_lounge: 1, store_type: 'cigar_shop', claimed: 0, has_inventory: false, description: '' },
    { id: 4, visible: 1, name: 'Tampa Smokes', city: 'Tampa', state: 'FL', has_lounge: 0, store_type: 'tobacco_shop', claimed: 0, has_inventory: false, description: '' },
  ];
  const ids = (qy) => rows.filter(r => matchesFilters(r, qy)).map(r => r.id);
  ok(JSON.stringify(ids({})) === '[1,2,4]', 'a hidden listing never matches', ids({}));
  ok(JSON.stringify(ids({ has_lounge: '1' })) === '[1]', 'the lounge filter', ids({ has_lounge: '1' }));
  ok(JSON.stringify(ids({ claimed: '1' })) === '[2]', 'the claimed filter', ids({ claimed: '1' }));
  ok(JSON.stringify(ids({ has_inventory: '1' })) === '[2]', 'the in-stock filter', ids({ has_inventory: '1' }));
  ok(JSON.stringify(ids({ store_type: 'cigar_shop,tobacco_shop' })) === '[1,4]', 'type chips multi-select', ids({ store_type: 'cigar_shop,tobacco_shop' }));
  ok(JSON.stringify(ids({ city: 'detroit', state: 'MI' })) === '[1,2]', 'a city chip carries its state', ids({ city: 'detroit', state: 'MI' }));
  ok(JSON.stringify(ids({ q: 'wild bills' })) === '[1]', '"wild bills" finds Wild Bill\'s', ids({ q: 'wild bills' }));
  ok(JSON.stringify(ids({ q: 'lounge' })) === '[2]', 'q also reads the description', ids({ q: 'lounge' }));

  // buildFilters produces one placeholder per parameter, or db.run misbinds.
  for (const qy of [{}, { q: 'cigar' }, { city: 'Tampa', state: 'FL' }, { store_type: 'a,b,c' },
    { has_lounge: '1', has_walk_in_humidor: '1', claimed: '1', has_inventory: '1' }]) {
    const { where, params } = buildFilters(qy);
    const holes = where.join(' AND ').split('?').length - 1;
    ok(holes === params.length, `placeholders match parameters for ${JSON.stringify(qy)}`, { holes, params: params.length });
  }

  // The radius contract.
  ok(normalizeRadius('25').radiusMi === 25, '25 miles is honoured');
  ok(normalizeRadius('500').radiusMi === 100 && normalizeRadius('500').capped, '500 miles is capped at 100 and says so');
  ok(normalizeRadius(undefined).radiusMi === 50, 'no radius means 50');
  ok(normalizeRadius('abc').radiusMi === 50, 'a nonsense radius means 50');
  ok(normalizeRadius('-5').radiusMi === 50, 'a negative radius means 50');

  ok(hoursAreConfirmed('website') && hoursAreConfirmed('chain'), 'website and chain hours are confirmed');
  ok(!hoursAreConfirmed('osm') && !hoursAreConfirmed(null), 'map hours and no hours are not confirmed');

  // ── what a visitor with no location sees ───────────────────────────────────
  const full = { website: 'x.com', website_status: 'ok', hours: '{"Mon":"9am-5pm"}', phone: '555', logo_url: 'a.png' };
  ok(completenessScore(full) === 4, 'a listing with a site, hours, a phone and a picture scores four');
  ok(completenessScore({}) === 0, 'and an empty one scores nothing');
  ok(completenessScore({ ...full, website_status: 'dns_fail' }) === 3, 'a dead website does not count towards it');
  ok(completenessScore({ ...full, website_status: 'blocked' }) === 4, 'but a site behind a firewall does');
  ok(completenessScore({ ...full, website_status: null }) === 4, 'and so does one nobody has checked yet');
  ok(completenessScore({ ...full, hours: '{}' }) === 3, 'empty hours are not hours');
  ok(completenessScore({ ...full, logo_url: null, cover_url: 'b.png' }) === 4, 'a cover counts as the picture');
  ok(completenessScore({ ...full, logo_url: null, web_image_url: 'c.png' }) === 4, 'so does one read off the shop\'s site');

  ok(looksUnhelpful({ operating_status: 'likely_closed' }), 'a likely-closed listing belongs at the end');
  ok(looksUnhelpful({ website: 'x.com', website_status: 'hijacked' }), 'so does one whose domain was taken over');
  ok(looksUnhelpful({ website: 'x.com', website_status: 'dns_fail' }), 'and one whose domain does not resolve');
  ok(!looksUnhelpful({ website: 'x.com', website_status: 'ok' }), 'a working listing does not');
  ok(!looksUnhelpful({ website: null, website_status: 'dns_fail' }), 'and a listing with no website is not judged on one');

  // The order has to name every column it reads, or the query fails at runtime
  // rather than in a test.
  const sql = noLocationOrderSql();
  for (const col of ['operating_status', 'website_status', 'website', 'hours', 'phone',
    'logo_url', 'cover_url', 'web_image_url', 'claimed', 'confidence']) {
    ok(sql.includes(`s.${col}`), `the no-location order reads s.${col}`);
  }
  ok(/ROW_NUMBER\(\) OVER/.test(sql), 'and spreads listings that share a website');
  ok(/md5/.test(sql) && /YYYY-MM-DD/.test(sql), 'and rotates daily rather than at random');
  ok(!/featured_until|s\.plan\b/.test(sql),
    'and paid placement is not one of its keys: a shop buys the top of a nearby search, not the country');

  // ── paid placement ─────────────────────────────────────────────────────────
  const NOW = new Date('2026-09-12T00:00:00Z');
  const LIVE = '2026-12-01T00:00:00Z';      // still paying
  const LAPSED = '2026-01-01T00:00:00Z';    // stopped paying
  const row = (id, d, extra = {}) => ({ id, distance_mi: d, ...extra });
  const list = [
    row(1, 0.5), row(2, 1.0), row(3, 2.0), row(4, 3.0), row(5, 4.0),
  ];
  const order = rs => rs.map(r => r.id);

  // The property that matters more than any other: a sponsored slot reorders,
  // it never removes. No amount of money can cost a customer a result.
  const withPaid = [...list];
  withPaid[3] = row(4, 3.0, { plan: 'partner', featured_until: LIVE });
  const done = applySponsored(withPaid, { bounded: true, now: NOW });
  ok(done.length === withPaid.length, 'a sponsored lift keeps every row', { was: withPaid.length, now: done.length });
  ok(new Set(order(done)).size === done.length, 'and never duplicates one');
  ok(JSON.stringify(order(done).slice().sort()) === JSON.stringify(order(withPaid).slice().sort()),
    'and the set is identical either way', order(done));
  ok(order(done)[0] === 4 && done[0].sponsored === true && done[0].sponsored_plan === 'partner',
    'the paying shop is lifted to the top and labelled', order(done));
  ok(order(done).slice(1).join() === '1,2,3,5', 'and everything else keeps its distance order', order(done));
  ok(done.slice(1).every(r => !r.sponsored), 'only the lifted row is labelled');
  ok(withPaid[3].sponsored === undefined, 'and the input is not mutated');

  // A nationwide list buys nothing. "Top placement in your city" cannot mean
  // "top of a national list".
  ok(applySponsored(withPaid, { bounded: false, now: NOW }) === withPaid,
    'a list with no location gets no sponsored slots');

  // Reach is what separates the two plans.
  const farFeatured = [row(1, 0.5), row(2, 30, { plan: 'featured', featured_until: LIVE })];
  ok(order(applySponsored(farFeatured, { bounded: true, now: NOW }))[0] === 1,
    'a Featured shop 30 miles away does not take a slot — "your city" is 15 miles');
  const nearFeatured = [row(1, 0.5), row(2, 10, { plan: 'featured', featured_until: LIVE })];
  ok(order(applySponsored(nearFeatured, { bounded: true, now: NOW }))[0] === 2,
    'and at 10 miles it does');
  const farPartner = [row(1, 0.5), row(2, 30, { plan: 'partner', featured_until: LIVE })];
  ok(order(applySponsored(farPartner, { bounded: true, now: NOW }))[0] === 2,
    'a Partner shop at 30 miles does — "your whole metro" is 50');
  const tooFarPartner = [row(1, 0.5), row(2, 80, { plan: 'partner', featured_until: LIVE })];
  ok(order(applySponsored(tooFarPartner, { bounded: true, now: NOW }))[0] === 1,
    'but not at 80 miles');

  // Partner outranks Featured, and distance breaks a tie between equals.
  const both = [
    row(1, 0.5), row(2, 5, { plan: 'featured', featured_until: LIVE }),
    row(3, 8, { plan: 'partner', featured_until: LIVE }),
  ];
  ok(order(applySponsored(both, { bounded: true, now: NOW })).join() === '3,2,1',
    'Partner takes the first slot, Featured the second', order(applySponsored(both, { bounded: true, now: NOW })));
  const twoPartners = [
    row(1, 0.5), row(2, 9, { plan: 'partner', featured_until: LIVE }),
    row(3, 4, { plan: 'partner', featured_until: LIVE }),
  ];
  ok(order(applySponsored(twoPartners, { bounded: true, now: NOW }))[0] === 3,
    'and between two Partners the nearer one goes first');

  // Only two slots, however many shops are paying.
  const fivePaying = [1, 2, 3, 4, 5].map(i => row(i, i, { plan: 'partner', featured_until: LIVE }));
  const capped = applySponsored(fivePaying, { bounded: true, now: NOW });
  ok(capped.filter(r => r.sponsored).length === SPONSORED_SLOTS,
    `at most ${SPONSORED_SLOTS} rows are ever sponsored`, capped.filter(r => r.sponsored).length);

  // A subscription that lapsed buys nothing.
  const lapsed = [row(1, 5), row(2, 0.5, { plan: 'partner', featured_until: LAPSED })];
  ok(order(applySponsored(lapsed, { bounded: true, now: NOW })).join() === '1,2',
    'a lapsed subscription buys no placement — and the shop keeps its natural position', order(applySponsored(lapsed, { bounded: true, now: NOW })));
  ok(sponsorRank({ plan: 'partner', featured_until: LAPSED }, NOW) === 0, 'a lapsed Partner ranks zero');
  ok(sponsorRank({ plan: 'partner', featured_until: LIVE }, NOW) === 2, 'a live Partner ranks two');
  ok(sponsorRank({ plan: 'featured', featured_until: LIVE }, NOW) === 1, 'a live Featured ranks one');
  ok(sponsorRank({ plan: 'free', featured_until: LIVE }, NOW) === 0, 'a free plan ranks zero whatever the date says');
  ok(sponsorRank({}, NOW) === 0, 'and so does a shop with no plan at all');

  // A city search has no distances, and every match is in the city by
  // definition — which is exactly what "top placement in your city" sells.
  const cityRows = [row(1, null), row(2, null, { plan: 'featured', featured_until: LIVE })];
  ok(order(applySponsored(cityRows, { bounded: true, now: NOW }))[0] === 2,
    'in a city search a paying shop in that city takes the slot');

  // Nothing to reorder.
  ok(applySponsored([], { bounded: true }).length === 0, 'an empty list survives');
  ok(order(applySponsored(list, { bounded: true, now: NOW })).join() === '1,2,3,4,5',
    'a list where nobody pays is untouched');

  console.log(`\nstoreSearch self-test: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
