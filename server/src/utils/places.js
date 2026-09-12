/**
 * The pages people actually search for.
 *
 * Nobody types a shop's name into Google unless they already know it. They type
 * "cigar shops tampa" or "cigar lounge near me", and the page that answers that
 * is a list for a place — which this directory could build for every town it
 * covers and did not have at all.
 *
 * Two rules decide which places get a page:
 *
 *   every state with a shop in it gets one. Fifty pages, each a real list.
 *   a city gets one once it holds MIN_CITY_SHOPS. A page listing a single shop
 *     is the thin doorway page search engines exist to filter out, and it
 *     answers the question worse than that shop's own page does. Today that
 *     leaves 86 city pages of 518 possible ones; as the directory grows the
 *     threshold lets more of them through on their own.
 *
 * Slugs are built from the name and read back by comparing slugs, never by
 * un-slugifying: "St. Petersburg", "Ste. Genevieve" and "Coeur d'Alene" all
 * survive the round trip that way, and none of them survives the other one.
 *
 *   node src/utils/places.js selftest
 */
'use strict';

const { US_STATES } = require('../jobs/osm');

/** Below this a city page lists too little to be worth having. */
const MIN_CITY_SHOPS = 2;

const slugify = s => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase()
  .replace(/['’]/g, '')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');

const stateSlug = state => slugify(US_STATES[String(state || '').toUpperCase()] || state);
const citySlug = (city, state) => `${slugify(city)}-${String(state || '').toLowerCase()}`;
const stateName = state => US_STATES[String(state || '').toUpperCase()] || String(state || '').toUpperCase();

/**
 * Which place a URL slug names, given the places that exist.
 *
 * Returns { kind: 'city', city, state } or { kind: 'state', state }, or null.
 * Matching is done by generating each candidate's slug and comparing, so a
 * name with a full stop or an apostrophe in it resolves like any other.
 */
function parsePlaceSlug(slug, places) {
  const want = slugify(slug);
  if (!want) return null;
  for (const c of places.cities || []) {
    if (citySlug(c.city, c.state) === want) return { kind: 'city', city: c.city, state: c.state, count: c.count };
  }
  for (const s of places.states || []) {
    if (stateSlug(s.state) === want) return { kind: 'state', state: s.state, count: s.count };
  }
  return null;
}

/**
 * Every place worth a page, from the directory as it stands.
 *
 * Cached, because it is read on every crawl of a place page and changes only
 * when the directory does.
 */
const TTL_MS = 10 * 60 * 1000;
let cache = { at: 0, value: null };

async function listPlaces(db, { force = false } = {}) {
  if (!force && cache.value && Date.now() - cache.at < TTL_MS) return cache.value;
  const cityRows = await db.all(`
    SELECT city, state, COUNT(*)::int AS count
    FROM stores
    WHERE visible = 1 AND city IS NOT NULL AND city <> '' AND state IS NOT NULL AND state <> ''
    GROUP BY city, state
    HAVING COUNT(*) >= ${MIN_CITY_SHOPS}
    ORDER BY COUNT(*) DESC, city`);
  const stateRows = await db.all(`
    SELECT state, COUNT(*)::int AS count
    FROM stores WHERE visible = 1 AND state IS NOT NULL AND state <> ''
    GROUP BY state ORDER BY COUNT(*) DESC, state`);

  const value = {
    cities: cityRows.map(r => ({ ...r, slug: citySlug(r.city, r.state) })),
    states: stateRows.map(r => ({ ...r, name: stateName(r.state), slug: stateSlug(r.state) })),
  };
  cache = { at: Date.now(), value };
  return value;
}

/** The shops on one place page, best first: the ones we know most about. */
async function shopsInPlace(db, place, { limit = 200 } = {}) {
  const where = place.kind === 'city'
    ? { sql: 'LOWER(city) = LOWER(?) AND UPPER(state) = UPPER(?)', params: [place.city, place.state] }
    : { sql: 'UPPER(state) = UPPER(?)', params: [place.state] };
  return db.all(`
    SELECT id, name, address, city, state, zip, phone, website, lat, lng, hours, hours_source,
           has_lounge, has_walk_in_humidor, web_image_url
    FROM stores
    WHERE visible = 1 AND ${where.sql}
    ORDER BY (hours_source = 'website') DESC, (web_image_url IS NOT NULL) DESC, has_lounge DESC, name
    LIMIT ?`, [...where.params, limit]);
}

module.exports = { MIN_CITY_SHOPS, slugify, citySlug, stateSlug, stateName, parsePlaceSlug, listPlaces, shopsInPlace, selftest };

// ── self-test ───────────────────────────────────────────────────────────────
function selftest() {
  let pass = 0, fail = 0;
  const ok = (cond, label, extra) => {
    if (cond) { pass++; console.log(`  ok   ${label}`); }
    else { fail++; console.log(`  FAIL ${label}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ''}`); }
  };

  ok(citySlug('Tampa', 'FL') === 'tampa-fl', 'a plain city');
  ok(citySlug('St. Petersburg', 'FL') === 'st-petersburg-fl', 'a full stop becomes nothing, not a dash of its own',
    citySlug('St. Petersburg', 'FL'));
  ok(citySlug("Coeur d'Alene", 'ID') === 'coeur-dalene-id', 'an apostrophe closes the gap rather than splitting the word',
    citySlug("Coeur d'Alene", 'ID'));
  ok(citySlug('Winston-Salem', 'NC') === 'winston-salem-nc', 'a hyphen survives as one');
  ok(citySlug('  Las   Vegas ', 'nv') === 'las-vegas-nv', 'spare whitespace and case are not part of the name');
  ok(stateSlug('FL') === 'florida' && stateSlug('NY') === 'new-york', 'a state is named, not abbreviated', stateSlug('NY'));
  ok(stateName('FL') === 'Florida' && stateName('ZZ') === 'ZZ', 'an unknown code falls back to itself');

  // Reading a slug back. The round trip is the point: these are the names that
  // break an un-slugify, which is why matching compares slugs instead.
  const places = {
    cities: [{ city: 'St. Petersburg', state: 'FL', count: 4 }, { city: 'Tampa', state: 'FL', count: 6 },
      { city: "Coeur d'Alene", state: 'ID', count: 2 }],
    states: [{ state: 'FL', count: 85 }, { state: 'NY', count: 12 }],
  };
  ok(parsePlaceSlug('st-petersburg-fl', places).city === 'St. Petersburg', 'a city with a full stop reads back');
  ok(parsePlaceSlug('coeur-dalene-id', places).city === "Coeur d'Alene", 'and one with an apostrophe');
  ok(parsePlaceSlug('florida', places).kind === 'state', 'a state slug reads as a state');
  ok(parsePlaceSlug('new-york', places).state === 'NY', 'a second state too');
  ok(parsePlaceSlug('wyoming', places) === null, 'a state with no shops in it has no page');
  ok(parsePlaceSlug('atlantis-xx', places) === null, 'and an invented place is not a page');
  ok(parsePlaceSlug('', places) === null && parsePlaceSlug(null, places) === null, 'nor is nothing');

  // A city page is only worth having once it lists more than one shop: the
  // directory holds 432 towns with exactly one, and a page for each of those
  // answers the question worse than the shop's own page already does.
  ok(MIN_CITY_SHOPS >= 2, 'a single-shop town gets no page of its own');

  console.log(`\nplaces self-test: ${pass} passed, ${fail} failed`);
  return fail === 0;
}

if (require.main === module && process.argv[2] === 'selftest') process.exit(selftest() ? 0 : 1);
