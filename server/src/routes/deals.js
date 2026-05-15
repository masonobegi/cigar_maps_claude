const router = require('express').Router();
const db = require('../database/db');

router.get('/', (req, res) => {
  const deals = db.prepare(`
    SELECT d.*, s.name as store_name, s.city, s.state, s.verified,
      c.brand, c.name as cigar_name
    FROM deals d
    JOIN stores s ON s.id = d.store_id
    LEFT JOIN cigars c ON c.id = d.cigar_id
    WHERE (d.expires_at IS NULL OR d.expires_at > datetime('now'))
    ORDER BY d.created_at DESC
    LIMIT 50
  `).all();
  res.json(deals);
});

module.exports = router;
