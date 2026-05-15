const router = require('express').Router();
const db = require('../database/db');
const { requireAuth } = require('../middleware/auth');

// My humidor
router.get('/me/humidor', requireAuth, (req, res) => {
  const { status } = req.query;
  let where = 'uc.user_id = ?';
  const params = [req.user.id];
  if (status) { where += ' AND uc.status = ?'; params.push(status); }

  const items = db.prepare(`
    SELECT uc.*, c.brand, c.name as cigar_name, c.strength, c.country, c.flavor_notes, c.wrapper,
      v.name as vitola_name, v.length, v.ring_gauge,
      COALESCE(AVG(r.rating),0) as avg_rating, COUNT(r.id) as review_count
    FROM user_cigars uc
    JOIN cigars c ON c.id = uc.cigar_id
    LEFT JOIN vitolas v ON v.id = uc.vitola_id
    LEFT JOIN reviews r ON r.cigar_id = uc.cigar_id
    WHERE ${where} GROUP BY uc.id ORDER BY uc.created_at DESC
  `).all(...params);

  const all = db.prepare('SELECT status, quantity, purchase_price FROM user_cigars WHERE user_id = ?').all(req.user.id);
  const stats = { total: 0, humidor: 0, smoked: 0, wishlist: 0, total_value: 0 };
  for (const i of all) {
    stats.total += i.quantity;
    if (stats[i.status] !== undefined) stats[i.status] += i.quantity;
    if (i.status === 'humidor' && i.purchase_price) stats.total_value += i.purchase_price * i.quantity;
  }

  res.json({
    items: items.map(i => ({ ...i, flavor_notes: JSON.parse(i.flavor_notes || '[]') })),
    stats
  });
});

router.post('/me/humidor', requireAuth, (req, res) => {
  const { cigar_id, vitola_id, status, quantity, purchase_price, purchase_date, notes, aging_goal_date } = req.body;
  if (!cigar_id) return res.status(400).json({ error: 'cigar_id required' });

  const result = db.prepare(`
    INSERT INTO user_cigars (user_id, cigar_id, vitola_id, status, quantity, purchase_price, purchase_date, notes, aging_goal_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(req.user.id, cigar_id, vitola_id, status || 'humidor', quantity || 1,
    purchase_price, purchase_date, notes, aging_goal_date);

  res.json({ id: result.lastInsertRowid });
});

router.put('/me/humidor/:id', requireAuth, (req, res) => {
  const { status, quantity, purchase_price, purchase_date, notes, aging_goal_date } = req.body;
  db.prepare(`
    UPDATE user_cigars SET status=?, quantity=?, purchase_price=?, purchase_date=?, notes=?, aging_goal_date=?
    WHERE id=? AND user_id=?
  `).run(status, quantity, purchase_price, purchase_date, notes, aging_goal_date, req.params.id, req.user.id);
  res.json({ success: true });
});

router.delete('/me/humidor/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM user_cigars WHERE id=? AND user_id=?').run(req.params.id, req.user.id);
  res.json({ success: true });
});

// My reviews
router.get('/me/reviews', requireAuth, (req, res) => {
  const reviews = db.prepare(`
    SELECT r.*, c.brand, c.name as cigar_name, v.name as vitola_name
    FROM reviews r JOIN cigars c ON c.id = r.cigar_id LEFT JOIN vitolas v ON v.id = r.vitola_id
    WHERE r.user_id = ? ORDER BY r.created_at DESC
  `).all(req.user.id);
  res.json(reviews.map(r => ({ ...r, flavor_notes: JSON.parse(r.flavor_notes || '[]') })));
});

// My followed stores
router.get('/me/followed-stores', requireAuth, (req, res) => {
  const stores = db.prepare(`
    SELECT s.*, sf.notify_broadcasts, sf.notify_deals, sf.notify_new_arrivals, sf.created_at as followed_at,
      COUNT(DISTINCT i.id) as inventory_count,
      COUNT(DISTINCT sf2.user_id) as follower_count,
      (
        SELECT COUNT(*) FROM notifications n
        LEFT JOIN notification_reads nr ON nr.notification_id = n.id AND nr.user_id = ?
        WHERE n.store_id = s.id AND nr.user_id IS NULL
      ) as unread_notifications
    FROM store_follows sf
    JOIN stores s ON s.id = sf.store_id
    LEFT JOIN inventory i ON i.store_id = s.id AND i.in_stock = 1
    LEFT JOIN store_follows sf2 ON sf2.store_id = s.id
    WHERE sf.user_id = ?
    GROUP BY s.id
    ORDER BY unread_notifications DESC, sf.created_at DESC
  `).all(req.user.id, req.user.id);
  res.json(stores);
});

// My profile update
router.put('/me/profile', requireAuth, (req, res) => {
  const { name, bio, location_city, location_state } = req.body;
  db.prepare('UPDATE users SET name=?, bio=?, location_city=?, location_state=? WHERE id=?')
    .run(name, bio, location_city, location_state, req.user.id);
  res.json({ success: true });
});

// Community feed
router.get('/me/feed', requireAuth, (req, res) => {
  const recentReviews = db.prepare(`
    SELECT r.*, u.name as user_name, u.avatar_url, c.brand, c.name as cigar_name, v.name as vitola_name
    FROM reviews r JOIN users u ON u.id = r.user_id JOIN cigars c ON c.id = r.cigar_id
    LEFT JOIN vitolas v ON v.id = r.vitola_id
    WHERE r.user_id != ? ORDER BY r.created_at DESC LIMIT 20
  `).all(req.user.id);

  const deals = db.prepare(`
    SELECT d.*, s.name as store_name, c.brand, c.name as cigar_name
    FROM deals d JOIN stores s ON s.id = d.store_id LEFT JOIN cigars c ON c.id = d.cigar_id
    WHERE (d.expires_at IS NULL OR d.expires_at > datetime('now'))
    ORDER BY d.created_at DESC LIMIT 8
  `).all();

  res.json({
    reviews: recentReviews.map(r => ({ ...r, flavor_notes: JSON.parse(r.flavor_notes || '[]') })),
    deals
  });
});

// Public user profile
router.get('/:id', (req, res) => {
  const user = db.prepare('SELECT id, name, bio, avatar_url, location_city, location_state, created_at FROM users WHERE id=?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const reviewCount = db.prepare('SELECT COUNT(*) as n FROM reviews WHERE user_id=?').get(req.params.id).n;
  const humidorCount = db.prepare("SELECT SUM(quantity) as n FROM user_cigars WHERE user_id=? AND status='humidor'").get(req.params.id).n || 0;
  const smokedCount = db.prepare("SELECT COUNT(*) as n FROM user_cigars WHERE user_id=? AND status='smoked'").get(req.params.id).n;

  const recentReviews = db.prepare(`
    SELECT r.*, c.brand, c.name as cigar_name, v.name as vitola_name
    FROM reviews r JOIN cigars c ON c.id = r.cigar_id LEFT JOIN vitolas v ON v.id = r.vitola_id
    WHERE r.user_id=? ORDER BY r.created_at DESC LIMIT 5
  `).all(req.params.id);

  res.json({
    user, review_count: reviewCount, humidor_count: humidorCount, smoked_count: smokedCount,
    recent_reviews: recentReviews.map(r => ({ ...r, flavor_notes: JSON.parse(r.flavor_notes || '[]') }))
  });
});

module.exports = router;
