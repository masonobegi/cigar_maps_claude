const router = require('express').Router();
const db = require('../database/db');
const { asyncRoute } = db;

router.get('/', asyncRoute(async (req, res) => {
  const deals = await db.all(`
    SELECT d.*, s.name as store_name, s.city, s.state, s.verified,
      c.brand, c.name as cigar_name
    FROM deals d
    JOIN stores s ON s.id = d.store_id
    LEFT JOIN cigars c ON c.id = d.cigar_id
    WHERE (d.expires_at IS NULL OR d.expires_at > NOW())
    ORDER BY d.created_at DESC
    LIMIT 50
  `, []);
  res.json(deals);
}));

module.exports = router;
