/**
 * Place pages: the shops in one city or one state.
 *
 * "cigar shops tampa" is a search somebody actually makes; "Central Cigars" is
 * not, unless they already know the shop. These are the pages that answer the
 * first kind.
 */
'use strict';

const express = require('express');
const db = require('../database/db');
const { listPlaces, parsePlaceSlug, shopsInPlace, stateName } = require('../utils/places');
const { openStatus, timeZoneFor } = require('../utils/storeHours');

const router = express.Router();
const asyncRoute = db.asyncRoute;

/** Every city and state with a page, for the index and the sitemap. */
router.get('/', asyncRoute(async (req, res) => {
  res.set('Cache-Control', 'public, max-age=600');
  res.json(await listPlaces(db));
}));

/** One place, with its shops. */
router.get('/:slug', asyncRoute(async (req, res) => {
  const places = await listPlaces(db);
  const place = parsePlaceSlug(req.params.slug, places);
  if (!place) return res.status(404).json({ error: 'No page for that place' });

  const shops = await shopsInPlace(db, place);
  const now = new Date();
  const stores = shops.map(s => {
    let hours = null;
    try { hours = s.hours ? JSON.parse(s.hours) : null; } catch { hours = null; }
    const confirmed = s.hours_source === 'website';
    const status = confirmed ? openStatus(hours, s.timezone || timeZoneFor(s.state, s.lat, s.lng), now) : null;
    return {
      ...s, hours,
      hours_confirmed: confirmed,
      is_open: status ? status.isOpen : null,
      open_label: status ? status.label : null,
      today_hours: status ? status.today : null,
    };
  });

  // Somewhere to go next, which is half of what a place page is for: a crawler
  // that lands here should be able to reach the rest of the directory, and a
  // person looking at a small town usually wants the next town over.
  const nearby = place.kind === 'city'
    ? places.cities.filter(c => c.state === place.state && c.slug !== req.params.slug).slice(0, 12)
    : places.states.filter(s => s.state !== place.state).slice(0, 12);

  res.set('Cache-Control', 'public, max-age=300');
  res.json({
    place: {
      ...place,
      name: place.kind === 'city' ? `${place.city}, ${place.state}` : stateName(place.state),
      state_name: stateName(place.state),
    },
    count: stores.length,
    with_hours: stores.filter(s => s.hours_confirmed).length,
    with_lounge: stores.filter(s => Number(s.has_lounge) === 1).length,
    stores,
    nearby,
  });
}));

module.exports = router;
