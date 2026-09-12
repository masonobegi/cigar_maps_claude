const router = require('express').Router();
const db = require('../database/db');
const { asyncRoute } = db;

// A deal is a public advert for a shop, so it may only appear while the shop
// itself does. A listing a sweep took off the map — shut, a duplicate, not a
// cigar shop — kept advertising here, which is the one place a hidden listing
// could still send somebody to a locked door.
router.get('/', asyncRoute(async (req, res) => {
  const deals = await db.all(`
    SELECT d.*, s.name as store_name, s.city, s.state, s.verified,
      c.brand, c.name as cigar_name
    FROM deals d
    JOIN stores s ON s.id = d.store_id AND s.visible = 1
    LEFT JOIN cigars c ON c.id = d.cigar_id
    WHERE (d.expires_at IS NULL OR d.expires_at > NOW())
    ORDER BY d.created_at DESC
    LIMIT 50
  `, []);
  res.json(deals);
}));

module.exports = router;
