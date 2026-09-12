/**
 * The store search: which listings a place query returns, and in what order.
 *
 * The list used to be built the wrong way round. Every filter ran in SQL, the
 * rows were ordered by paid placement, feed size and classifier score, cut to
 * 300, and only then were they filtered to the radius and sorted by distance.
 * In a dense metro the cut happened before anything knew how far away a shop
 * was, so the list dropped shops a few blocks away while keeping shops 49 miles
 * out. Measured against a brute-force truth set on the 2026-09-10 snapshot:
 * 131 public listings could not be found from their own doorstep at 50 miles,
 * recall was 93.5% at 50 and 73.1% at 100, and Midtown returned 272 of 364 —
 * missing #41493 Manhattan Tobacco at 0.9 mi and #21746 Davidoff of Geneva at
 * 0.6 mi. The count said "272 stores found" with nothing to say it was short.
 *
 * So now, when a place is given:
 *   1. a bounding box around the radius prefilters on idx_stores_lat_lng, with
 *      every SQL filter already applied;
 *   2. haversine runs in SQL and keeps what is really inside the circle, with
 *      no row cap at all — the worst case in the whole directory is 743 rows
 *      at 100 miles (Spring House PA);
 *   3. open/closed is worked out over that complete set, never over a page;
 *   4. the set is sorted by distance, then id, and the caller gets a total
 *      plus one page, so "Show more" can say what is left.
 *
 * The radius is capped at 100 miles and a set above CANDIDATE_CEILING answers
 * "narrow your search" rather than quietly returning a slice of it.
 *
 * Pure query-building and assembly so jobs/recallMonitor.js can replay exactly
 * what the route does and compare it with a brute-force count.
 */
'use strict';

const { openStatus, timeZoneFor } = require('./storeHours');

// The widest circle we will answer. 100 miles is already the worst case in the
// directory; beyond it a "nearby" list stops meaning anything.
const MAX_RADIUS_MI = 100;
const DEFAULT_RADIUS_MI = 50;

// One page of cards. The page carries the total, so 60 is a screenful and not
// a silent truncation.
const PAGE_SIZE = 60;
const MAX_PAGE_SIZE = 200;

// Above this many listings inside the circle we say so instead of paging
// through it. Nothing reaches it today (743 at 100 miles is the fullest box in
// the directory); it exists so that growth is loud rather than silent.
const CANDIDATE_CEILING = 5000;

// Paid placement buys the top of a list a shop already belongs in, inside the
// radius the customer chose — never a place in a town they did not search, and
// never more than a few slots. Partner outranks Featured.
const SPONSORED_SLOTS = 3;

// Hours somebody stands behind: read off the shop's own website, given by its
// owner, set by staff, or taken from its chain's own store list. Map hours are
// not one of them — about half of the ones we could check against a shop's own
// site were wrong on some day — so they never make a shop "Open now". The same
// set is in client/src/components/StoreCard.jsx (CONFIRMED_HOURS).
const CONFIRMED_HOURS_SOURCES = new Set(['website', 'owner', 'staff', 'chain']);

/** Only hours we can point at a source for decide "Open now". */
function hoursAreConfirmed(store) {
  return CONFIRMED_HOURS_SOURCES.has(store.hours_source);
}

/** Miles between two pins, the same formula as the SQL below. */
function haversine(lat1, lng1, lat2, lng2) {
  const R = 3958.8;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * The same distance in SQL, so the circle is cut in the database and no row
 * cap has to stand in for it. Plain arithmetic only: PGlite runs the same
 * statement as Postgres locally, and neither needs PostGIS for this.
 *
 * least(1.0, ...) keeps asin inside its domain when floating point nudges the
 * argument just past 1 for two pins at the same address.
 */
const DISTANCE_SQL = `(3958.8 * 2 * asin(least(1.0, sqrt(
    power(sin(radians(s.lat - ?) / 2), 2) +
    cos(radians(?)) * cos(radians(s.lat)) * power(sin(radians(s.lng - ?) / 2), 2)
  ))))`;

// Names are compared with the punctuation people leave out: apostrophes and
// periods dropped, "&" read as "and", accents folded. Otherwise "wild bills"
// misses every one of Wild Bill's 215 listings.
const fold = value => `replace(translate(lower(${value}), '''’.,-', ''), '&', 'and')`;
const folded = text => String(text).toLowerCase().replace(/['’.,-]/g, '').replace(/&/g, 'and');

/**
 * Every filter the customer chose, as SQL. Shared by the location search, the
 * map viewport and the nationwide list so that a filter can never be applied
 * to one of them and not another.
 */
function buildFilters(query) {
  const { q, city, state, has_lounge, has_walk_in_humidor, store_type, claimed, has_inventory } = query;
  const where = ['s.visible = 1'];
  const params = [];

  if (q) {
    where.push(`(${fold('s.name')} LIKE ? OR s.description ILIKE ? OR ${fold('s.city')} LIKE ?)`);
    params.push(`%${folded(q)}%`, `%${q}%`, `%${folded(q)}%`);
  }
  // A city chip carries its state, and matches the town itself: "Washington, DC"
  // used to return shops in Michigan, Missouri and Pennsylvania.
  if (city && state) { where.push(`${fold('s.city')} = ?`); params.push(folded(city)); }
  else if (city) { where.push(`${fold('s.city')} LIKE ?`); params.push(`%${folded(city)}%`); }
  if (state) { where.push('s.state = ?'); params.push(String(state).toUpperCase()); }
  if (has_lounge === '1') { where.push('s.has_lounge = 1'); }
  if (has_walk_in_humidor === '1') { where.push('s.has_walk_in_humidor = 1'); }
  // store_type accepts a comma-separated list ("cigar_shop,cigar_lounge") so the
  // type chips can multi-select.
  if (store_type) {
    const types = String(store_type).split(',').map(t => t.trim()).filter(Boolean);
    if (types.length) {
      where.push(`s.store_type IN (${types.map(() => '?').join(',')})`);
      params.push(...types);
    }
  }
  if (claimed === '1') { where.push('s.claimed = 1'); }
  // EXISTS rather than a HAVING on the aggregate: it short-circuits on the
  // first in-stock row instead of counting every join row per store.
  if (has_inventory === '1') {
    where.push('EXISTS (SELECT 1 FROM inventory inv WHERE inv.store_id = s.id AND inv.in_stock = 1)');
  }
  return { where, params };
}

/** The place the customer asked about, with the radius clamped to what we answer. */
function readLocation(query) {
  const lat = parseFloat(query.lat);
  const lng = parseFloat(query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const asked = parseFloat(query.radius);
  const radiusMi = Math.min(MAX_RADIUS_MI, Math.max(1, Number.isFinite(asked) ? asked : DEFAULT_RADIUS_MI));
  return { lat, lng, radiusMi, radiusCapped: Number.isFinite(asked) && asked > MAX_RADIUS_MI };
}

/** Paid placement, computed the same way in SQL and in the replay. */
const FEATURED_SQL = `(CASE WHEN s.featured_until IS NOT NULL AND s.featured_until > NOW()
        THEN (CASE WHEN s.plan = 'partner' THEN 2 ELSE 1 END) ELSE 0 END)`;

/**
 * Everything inside the circle, with no row cap: light columns only, because
 * ratings and stock are hydrated for one page and nothing else.
 */
async function candidatesNear(db, query, place) {
  const { where, params } = buildFilters(query);
  const { lat, lng, radiusMi } = place;

  // The box is the prefilter that keeps this off a full table scan; the
  // haversine below is what actually decides the circle.
  const dLat = radiusMi / 69;
  const dLng = radiusMi / (69 * Math.max(0.2, Math.cos(lat * Math.PI / 180)));
  where.push('s.lat BETWEEN ? AND ? AND s.lng BETWEEN ? AND ?');
  params.push(lat - dLat, lat + dLat, lng - dLng, lng + dLng);

  // db.js numbers the placeholders in the order they appear in the statement,
  // so the distance arguments come first: they sit in the SELECT list, ahead of
  // everything the WHERE clause asks for.
  return db.all(`
    SELECT * FROM (
      SELECT s.id, s.lat, s.lng, s.hours, s.hours_source, s.timezone, s.state,
             ${FEATURED_SQL} AS is_featured,
             ${DISTANCE_SQL} AS distance_mi
      FROM stores s
      WHERE ${where.join(' AND ')}
    ) c
    WHERE c.distance_mi <= ?
  `, [lat, lat, lng, ...params, radiusMi]);
}

/**
 * Sort the complete candidate set: nearest first, id to break a tie so the
 * order never wobbles between two shops at one address.
 *
 * Paid placement goes to the front, but only a few slots and only inside the
 * radius the customer chose. billing.js sells "top placement in your city", not
 * a place in somebody else's search.
 */
function orderCandidates(rows) {
  const byDistance = rows.slice().sort((a, b) =>
    (a.distance_mi - b.distance_mi) || (a.id - b.id));

  const sponsored = byDistance
    .filter(r => Number(r.is_featured) > 0)
    .sort((a, b) => (Number(b.is_featured) - Number(a.is_featured))
      || (a.distance_mi - b.distance_mi) || (a.id - b.id))
    .slice(0, SPONSORED_SLOTS);

  if (!sponsored.length) return byDistance;
  const pinned = new Set(sponsored.map(r => r.id));
  for (const r of sponsored) r.sponsored = true;
  return [...sponsored, ...byDistance.filter(r => !pinned.has(r.id))];
}

/**
 * Open or closed on each shop's own clock (see storeHours.js), worked out over
 * the whole candidate set rather than over whatever a cap happened to keep.
 *
 * Unknown and unconfirmed hours are not "closed" and not "open": they are
 * counted, so the page can say how many nearby shops we simply cannot vouch
 * for. 6,120 of the 7,431 public listings had no hours at all when this was
 * measured, and "Open now" silently pretended they did not exist.
 */
function applyOpenNow(rows, { openNow, now = new Date() } = {}) {
  let unconfirmed = 0;
  const kept = [];
  for (const r of rows) {
    const tz = r.timezone || timeZoneFor(r.state, r.lat, r.lng);
    const status = openStatus(r.hours, tz, now);
    const confirmed = hoursAreConfirmed(r) && status.isOpen !== null;
    r.open_status = status;
    r.hours_confirmed = confirmed;
    if (!confirmed) unconfirmed++;
    if (!openNow || (confirmed && status.isOpen === true)) kept.push(r);
  }
  return { rows: kept, unconfirmed };
}

/**
 * The full rows for one page: ratings, follows and stock counted per store
 * with scalar subqueries instead of a three-way join that multiplied every
 * store's inventory by its follows by its ratings before grouping them again.
 */
async function hydratePage(db, ids) {
  if (!ids.length) return [];
  const rows = await db.all(`
    SELECT s.*,
      (SELECT COUNT(*) FROM inventory i WHERE i.store_id = s.id AND i.in_stock = 1)::int AS inventory_count,
      (SELECT COUNT(*) FROM store_follows sf WHERE sf.store_id = s.id)::int AS follower_count,
      (SELECT COALESCE(AVG(sr.rating), 0) FROM store_ratings sr WHERE sr.store_id = s.id) AS avg_rating,
      (SELECT COUNT(*) FROM store_ratings sr WHERE sr.store_id = s.id)::int AS rating_count,
      -- Paid placement. Shops buy the top of the list, never the right to be
      -- listed at all, so this only reorders results that already matched.
      ${FEATURED_SQL} AS is_featured
    FROM stores s
    WHERE s.id IN (${ids.map(() => '?').join(',')})
  `, ids);
  const byId = new Map(rows.map(r => [r.id, r]));
  return ids.map(id => byId.get(id)).filter(Boolean);
}

/**
 * searchNear(db, query) -> one page of a complete, distance-sorted result set.
 *
 * Returns { rows, total, offset, limit, radius_mi, unconfirmed_hours,
 *           sponsored_ids, too_many }. rows are raw store rows in page order;
 *   the caller decorates them for the public.
 */
async function searchNear(db, query, { now = new Date() } = {}) {
  const place = readLocation(query);
  if (!place) throw new Error('searchNear needs lat and lng');

  const candidates = await candidatesNear(db, query, place);
  const { rows: matching, unconfirmed } = applyOpenNow(candidates, {
    openNow: query.open_now === '1', now,
  });
  const ordered = orderCandidates(matching);

  const base = {
    total: ordered.length,
    radius_mi: place.radiusMi,
    radius_capped: place.radiusCapped,
    unconfirmed_hours: unconfirmed,
  };

  // A circle this full is not a list anyone reads. Say so rather than hand
  // back a slice of it and call it the answer.
  if (ordered.length > CANDIDATE_CEILING) {
    return { ...base, rows: [], offset: 0, limit: 0, too_many: true, ceiling: CANDIDATE_CEILING };
  }

  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(query.limit) || PAGE_SIZE));
  const offset = Math.max(0, parseInt(query.offset) || 0);
  const page = ordered.slice(offset, offset + limit);
  const hydrated = await hydratePage(db, page.map(r => r.id));
  const byId = new Map(page.map(r => [r.id, r]));

  const rows = hydrated.map(full => {
    const c = byId.get(full.id) || {};
    return {
      ...full,
      distance_mi: Math.round(c.distance_mi * 10) / 10,
      open_status: c.open_status,
      hours_confirmed: !!c.hours_confirmed,
      sponsored: !!c.sponsored,
    };
  });

  return { ...base, rows, offset, limit, too_many: false };
}

module.exports = {
  MAX_RADIUS_MI, DEFAULT_RADIUS_MI, PAGE_SIZE, MAX_PAGE_SIZE, CANDIDATE_CEILING, SPONSORED_SLOTS,
  CONFIRMED_HOURS_SOURCES, DISTANCE_SQL, FEATURED_SQL,
  hoursAreConfirmed, haversine, buildFilters, readLocation,
  candidatesNear, orderCandidates, applyOpenNow, hydratePage, searchNear,
};
