/**
 * GET /stores, as a function.
 *
 * The route is a two-line wrapper around this. It lives here so the recall
 * monitor can check the real code path rather than a second copy of it: the
 * truncation this sweep removes was invisible for months precisely because
 * nothing replayed the list and compared it with the truth.
 */
'use strict';

const db = require('../database/db');
const { openStatus, timeZoneFor } = require('../utils/storeHours');
const {
  PAGE_SIZE, CANDIDATE_CEILING, BOUNDARY_EPS_MI, SPONSORED_SLOTS,
  distanceSql, boundingBox, buildFilters, normalizeRadius, hoursAreConfirmed,
  applySponsored,
} = require('./storeSearch');

// Columns that exist for operations, not for the public: sheet URLs are
// effectively capability links, and the menu/import bookkeeping is noise.
//
// website_status / website_checked_at / website_final_url are deliberately NOT
// here. The profile needs them to decide whether the listed domain is still a
// working link, and the answer is not a secret — a link we could not reach must
// not be rendered as a link.
const PRIVATE_STORE_FIELDS = ['sheet_url', 'sheet_last_synced', 'menu_url', 'menu_platform', 'menu_status',
  'menu_last_synced', 'menu_checked_at', 'menu_opt_out', 'source_id', 'osm_id', 'staff_edited',
  'stripe_customer_id', 'stripe_subscription_id', 'plan_status', 'plan_renews_at'];

function publicStore(store, privileged = false) {
  if (privileged) return store;
  const out = { ...store };
  for (const f of PRIVATE_STORE_FIELDS) delete out[f];
  return out;
}

/**
 * The store list.
 *
 * Distance first. Every SQL filter and the radius cut run in the database over
 * the whole matching set; only then is a page taken. The old route did the
 * opposite — it took 300 rows in placement order and cut them to the radius
 * afterwards, so in a dense metro the list silently skipped shops a few blocks
 * away while showing shops 49 miles out. Measured against a brute-force truth
 * set, that lost 6.5% of results at 50 miles and 27% at 100, and 131 listings
 * could not be found from their own doorstep. See jobs/recallMonitor.js, which
 * fails if that ever comes back.
 *
 * The response is an object, not a bare array: a list that does not say how
 * many shops it is standing on is how the truncation stayed invisible.
 */
async function listStores(query = {}, now = new Date()) {
  const { open_now } = query;
  const userLat = parseFloat(query.lat);
  const userLng = parseFloat(query.lng);
  const hasPoint = Number.isFinite(userLat) && Number.isFinite(userLng);
  const { radiusMi, capped } = normalizeRadius(query.radius);
  const offset = Math.max(0, parseInt(query.offset) || 0);
  const pageSize = Math.min(1000, Math.max(1, parseInt(query.limit) || PAGE_SIZE));

  const { where, params } = buildFilters(query);

  // Spatial prefilter on idx_stores_lat_lng: an explicit map viewport
  // (bbox=minLng,minLat,maxLng,maxLat) or a box around the radius. The box is
  // only a prefilter — the circle is cut below, in SQL.
  const { bbox } = query;
  if (bbox) {
    const [minLng, minLat, maxLng, maxLat] = String(bbox).split(',').map(Number);
    if ([minLng, minLat, maxLng, maxLat].every(Number.isFinite)) {
      where.push('s.lat BETWEEN ? AND ? AND s.lng BETWEEN ? AND ?');
      params.push(minLat, maxLat, minLng, maxLng);
    }
  } else if (hasPoint) {
    const box = boundingBox(userLat, userLng, radiusMi);
    where.push('s.lat BETWEEN ? AND ? AND s.lng BETWEEN ? AND ?');
    params.push(box.minLat, box.maxLat, box.minLng, box.maxLng);
  }

  // Pass one: the candidate set, uncapped, with just the columns needed to
  // measure distance and judge "open now". No joins, so no GROUP BY over the
  // inventory x follows x ratings product.
  const candidateCols = ['s.id', 's.lat', 's.lng', 's.hours', 's.hours_source', 's.timezone', 's.state', 's.name',
    // Paid placement is decided over the whole candidate set, so the two
    // columns it rests on are read here rather than in a second query.
    's.plan', 's.featured_until'];
  let order;
  if (hasPoint) {
    const dist = distanceSql('s.lat', 's.lng');
    candidateCols.push(`${dist} AS distance_mi`);
    where.push(`${dist} <= ?`);
    // Distance, then id, so a page boundary never repeats or skips a shop when
    // two sit at the same spot.
    order = 'distance_mi, s.id';
  } else {
    // No location means no distance to sort on, and what a visitor with no
    // location should see is its own sweep and its own decision for Mason (see
    // "Neutral no-location order" in plan.json). Until that is settled this is
    // the order the site has always used, so only location searches change here.
    candidateCols.push(`(CASE WHEN s.featured_until IS NOT NULL AND s.featured_until > NOW()
        THEN (CASE WHEN s.plan = 'partner' THEN 2 ELSE 1 END) ELSE 0 END) AS is_featured`);
    candidateCols.push('(SELECT COUNT(*) FROM store_follows sf WHERE sf.store_id = s.id) AS follower_count');
    candidateCols.push('(SELECT COUNT(*) FROM inventory i WHERE i.store_id = s.id AND i.in_stock = 1) AS inventory_count');
    order = 'is_featured DESC, s.claimed DESC, s.verified DESC, follower_count DESC, '
      + 'inventory_count DESC, s.confidence DESC, s.name, s.id';
  }

  // distanceSql lays its placeholders down as (lat, lat, lng) — the two
  // latitude terms come before the longitude one. Getting this order wrong
  // measures a different planet, so it is spelled out rather than inferred.
  const distParams = hasPoint ? [userLat, userLat, userLng] : [];
  const candidateParams = hasPoint
    // SELECT's three distance parameters, then the filters, then the radius
    // cut's own three plus the radius itself.
    ? [...distParams, ...params, ...distParams, radiusMi + BOUNDARY_EPS_MI]
    : params;

  // One row over the ceiling is enough to know we are past it.
  const candidates = await db.all(`
    SELECT ${candidateCols.join(', ')}
    FROM stores s
    WHERE ${where.join(' AND ')}
    ORDER BY ${order}
    LIMIT ${CANDIDATE_CEILING + 1}
  `, candidateParams);

  if (candidates.length > CANDIDATE_CEILING) {
    // Refusing is the honest answer. Shortening the list is what this sweep
    // exists to stop.
    return {
      stores: [], total: null, returned: 0, offset: 0, next_offset: null,
      radius_mi: hasPoint ? radiusMi : null, radius_capped: capped,
      too_many: true,
      message: 'That search covers more shops than we can measure at once. Narrow the area or add a filter.',
    };
  }

  // "Open now" is judged on each shop's own clock, over the whole candidate
  // set rather than over a page, and only where somebody stands behind the
  // hours. Map hours get no Open badge, so they must not drive the filter
  // either: they were wrong on some day about half the time we could check.
  let rows = candidates;
  const noConfirmedHours = candidates.filter(s => !hoursAreConfirmed(s.hours_source)).length;

  if (open_now === '1') {
    rows = candidates.filter(s => {
      if (!hoursAreConfirmed(s.hours_source)) return false;
      const tz = s.timezone || timeZoneFor(s.state, s.lat, s.lng);
      return openStatus(s.hours, tz, now).isOpen === true;
    });
  }

  const total = rows.length;

  // Paid placement, applied to the whole ordered set before it is paged, so a
  // lifted row appears exactly once and paging stays consistent. It reorders
  // and never removes: `total` above is already final.
  //
  // Only a search the customer bounded geographically — a radius around a
  // point, or a named city — can carry a sponsored slot. A nationwide list
  // carries none, because "top placement in your city" cannot honestly mean
  // "top of a national list". See the reasoning in utils/storeSearch.js.
  const bounded = hasPoint || !!(query.city && query.state);
  rows = applySponsored(rows, { bounded, now });
  const page = rows.slice(offset, offset + pageSize);

  // Pass two: the full row, plus ratings and inventory, for this page only.
  // A list page used to weigh about 404 KB; a page of 60 is about 80 KB.
  let hydrated = [];
  if (page.length) {
    const ids = page.map(r => r.id);
    const holes = ids.map(() => '?').join(',');
    const full = await db.all(`
      SELECT s.*,
        (SELECT COUNT(*) FROM inventory i WHERE i.store_id = s.id AND i.in_stock = 1) AS inventory_count,
        (SELECT COUNT(*) FROM store_follows sf WHERE sf.store_id = s.id) AS follower_count,
        (SELECT COALESCE(AVG(sr.rating), 0) FROM store_ratings sr WHERE sr.store_id = s.id) AS avg_rating,
        (SELECT COUNT(*) FROM store_ratings sr WHERE sr.store_id = s.id) AS rating_count,
        -- Paid placement. Shops buy a position among results they already
        -- match, never the right to be listed at all.
        (CASE WHEN s.featured_until IS NOT NULL AND s.featured_until > NOW()
              THEN (CASE WHEN s.plan = 'partner' THEN 2 ELSE 1 END) ELSE 0 END) AS is_featured
      FROM stores s WHERE s.id IN (${holes})
    `, ids);

    const byId = new Map(full.map(s => [s.id, s]));
    hydrated = page.map(r => {
      const s = byId.get(r.id);
      if (!s) return null;
      const tz = s.timezone || timeZoneFor(s.state, s.lat, s.lng);
      const status = openStatus(s.hours, tz, now);
      return {
        ...publicStore(s),
        tags: s.tags ? JSON.parse(s.tags) : [],
        today_hours: status.today,
        is_open: status.isOpen,
        open_status: status,
        avg_rating: +parseFloat(s.avg_rating).toFixed(1),
        distance_mi: r.distance_mi === undefined || r.distance_mi === null
          ? null : Math.round(Number(r.distance_mi) * 10) / 10,
        // Set only on a row a shop paid to lift, so the card can say so. A
        // sponsored slot that is not labelled is not one we are willing to
        // sell.
        sponsored: r.sponsored === true,
        sponsored_plan: r.sponsored ? r.sponsored_plan : null,
      };
    }).filter(Boolean);
  }

  return {
    stores: hydrated,
    total,
    returned: hydrated.length,
    offset,
    next_offset: offset + page.length < total ? offset + page.length : null,
    radius_mi: hasPoint ? radiusMi : null,
    radius_capped: capped,
    // How many shops in range we cannot say are open, so the client can say so
    // instead of leaving an "Open now" search looking empty for no reason.
    unconfirmed_hours_nearby: noConfirmedHours,
    // How many of the rows above are paid placement. Zero for a nationwide
    // list, and never more than SPONSORED_SLOTS.
    sponsored_count: hydrated.filter(x => x.sponsored).length,
    sponsored_slots: bounded ? SPONSORED_SLOTS : 0,
    too_many: false,
  };
}

module.exports = { listStores, publicStore, PRIVATE_STORE_FIELDS };
