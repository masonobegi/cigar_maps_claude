const router = require('express').Router();
const db = require('../database/db');
const { requireAuth, optionalAuth } = require('../middleware/auth');

// Search and browse cigars
router.get('/', (req, res) => {
  const { q, brand, strength, wrapper, country, city, state, min_price, max_price,
    vitola_size, in_stock_only, sort = 'popular', page = 1, limit = 24 } = req.query;
  const offset = (page - 1) * limit;

  let where = ['1=1'];
  const params = [];

  if (q) {
    where.push('(c.name LIKE ? OR c.brand LIKE ? OR c.description LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (brand) { where.push('c.brand = ?'); params.push(brand); }
  if (strength) { where.push('c.strength = ?'); params.push(strength); }
  if (wrapper) { where.push('c.wrapper LIKE ?'); params.push(`%${wrapper}%`); }
  if (country) { where.push('c.country = ?'); params.push(country); }

  // City/state filter — only cigars available at stores in that city
  let storeJoin = '';
  if (city || state) {
    storeJoin = `
      JOIN inventory ci_check ON ci_check.cigar_id = c.id AND ci_check.in_stock = 1
      JOIN stores ci_store ON ci_store.id = ci_check.store_id
    `;
    if (city) { where.push('ci_store.city LIKE ?'); params.push(`%${city}%`); }
    if (state) { where.push('ci_store.state = ?'); params.push(state); }
  }

  // Price filter
  if (min_price) { where.push('(SELECT MIN(i2.price) FROM inventory i2 WHERE i2.cigar_id = c.id AND i2.in_stock = 1) >= ?'); params.push(+min_price); }
  if (max_price) { where.push('(SELECT MIN(i2.price) FROM inventory i2 WHERE i2.cigar_id = c.id AND i2.in_stock = 1) <= ?'); params.push(+max_price); }
  if (in_stock_only === '1') {
    where.push('EXISTS (SELECT 1 FROM inventory i3 WHERE i3.cigar_id = c.id AND i3.in_stock = 1)');
  }

  const sortClause = {
    popular: 'review_count DESC, avg_rating DESC',
    rating: 'avg_rating DESC, review_count DESC',
    price_asc: 'min_price ASC',
    price_desc: 'min_price DESC',
    newest: 'c.created_at DESC',
  }[sort] || 'review_count DESC, avg_rating DESC';

  const whereStr = where.join(' AND ');

  const cigars = db.prepare(`
    SELECT c.*,
      COALESCE(AVG(r.rating), 0) as avg_rating,
      COUNT(DISTINCT r.id) as review_count,
      COUNT(DISTINCT i.store_id) as store_count,
      MIN(i.price) as min_price
    FROM cigars c
    ${storeJoin}
    LEFT JOIN reviews r ON r.cigar_id = c.id
    LEFT JOIN inventory i ON i.cigar_id = c.id AND i.in_stock = 1
    WHERE ${whereStr}
    GROUP BY c.id
    ORDER BY ${sortClause}
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  const total = db.prepare(`
    SELECT COUNT(DISTINCT c.id) as n FROM cigars c ${storeJoin} WHERE ${whereStr}
  `).get(...params).n;

  res.json({
    cigars: cigars.map(c => ({
      ...c,
      flavor_notes: JSON.parse(c.flavor_notes || '[]'),
      avg_rating: Math.round(c.avg_rating),
    })),
    total, page: +page, pages: Math.ceil(total / limit)
  });
});

// Brands list
router.get('/brands', (req, res) => {
  const brands = db.prepare(`
    SELECT brand, COUNT(*) as cigar_count FROM cigars GROUP BY brand ORDER BY brand
  `).all();
  res.json(brands);
});

// Filter options
router.get('/filters', (req, res) => {
  const strengths = db.prepare('SELECT DISTINCT strength FROM cigars WHERE strength IS NOT NULL ORDER BY CASE strength WHEN "mild" THEN 1 WHEN "mild-medium" THEN 2 WHEN "medium" THEN 3 WHEN "medium-full" THEN 4 WHEN "full" THEN 5 END').all().map(r => r.strength);
  const countries = db.prepare('SELECT DISTINCT country FROM cigars WHERE country IS NOT NULL ORDER BY country').all().map(r => r.country);
  const wrappers = db.prepare('SELECT DISTINCT wrapper FROM cigars WHERE wrapper IS NOT NULL ORDER BY wrapper').all().map(r => r.wrapper);
  res.json({ strengths, countries, wrappers });
});

// Single cigar
router.get('/:id', optionalAuth, (req, res) => {
  const cigar = db.prepare('SELECT * FROM cigars WHERE id = ?').get(req.params.id);
  if (!cigar) return res.status(404).json({ error: 'Cigar not found' });

  const vitolas = db.prepare('SELECT * FROM vitolas WHERE cigar_id = ? ORDER BY ring_gauge').all(cigar.id);

  const stats = db.prepare(`
    SELECT COALESCE(AVG(rating),0) as avg_rating, COUNT(*) as review_count,
      COALESCE(AVG(draw_rating),0) as avg_draw, COALESCE(AVG(burn_rating),0) as avg_burn,
      COALESCE(AVG(appearance_rating),0) as avg_appearance, COALESCE(AVG(smoke_time),0) as avg_smoke_time
    FROM reviews WHERE cigar_id = ?
  `).get(cigar.id);

  const reviewFlavors = db.prepare('SELECT flavor_notes FROM reviews WHERE cigar_id = ? AND flavor_notes IS NOT NULL').all(cigar.id);
  const flavorCounts = {};
  for (const r of reviewFlavors) {
    for (const n of JSON.parse(r.flavor_notes || '[]')) flavorCounts[n] = (flavorCounts[n] || 0) + 1;
  }
  const topFlavors = Object.entries(flavorCounts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([note, count]) => ({ note, count }));

  // Similar cigars
  const similar = db.prepare(`
    SELECT c.id, c.brand, c.name, c.strength, COALESCE(AVG(r.rating),0) as avg_rating
    FROM cigars c LEFT JOIN reviews r ON r.cigar_id = c.id
    WHERE c.id != ? AND (c.brand = ? OR c.strength = ?)
    GROUP BY c.id ORDER BY avg_rating DESC LIMIT 4
  `).all(cigar.id, cigar.brand, cigar.strength);

  res.json({
    cigar: { ...cigar, flavor_notes: JSON.parse(cigar.flavor_notes || '[]') },
    vitolas,
    stats: {
      avg_rating: Math.round(stats.avg_rating),
      review_count: stats.review_count,
      avg_draw: +stats.avg_draw.toFixed(1),
      avg_burn: +stats.avg_burn.toFixed(1),
      avg_appearance: +stats.avg_appearance.toFixed(1),
      avg_smoke_time: Math.round(stats.avg_smoke_time),
    },
    top_flavors: topFlavors,
    similar,
  });
});

// Store availability
router.get('/:id/availability', (req, res) => {
  const { city, state } = req.query;
  let where = 'i.cigar_id = ? AND i.in_stock = 1';
  const params = [req.params.id];
  if (city) { where += ' AND s.city LIKE ?'; params.push(`%${city}%`); }
  if (state) { where += ' AND s.state = ?'; params.push(state); }

  const rows = db.prepare(`
    SELECT s.id as store_id, s.name as store_name, s.city, s.state, s.phone, s.verified,
      s.has_lounge, s.has_walk_in_humidor,
      v.name as vitola_name, v.length, v.ring_gauge,
      i.price, i.quantity, i.in_stock, i.vitola_id, i.is_new_arrival
    FROM inventory i
    JOIN stores s ON s.id = i.store_id
    JOIN vitolas v ON v.id = i.vitola_id
    WHERE ${where}
    ORDER BY s.name, v.ring_gauge
  `).all(...params);

  const storeMap = {};
  for (const row of rows) {
    if (!storeMap[row.store_id]) {
      storeMap[row.store_id] = {
        store_id: row.store_id, name: row.store_name, city: row.city, state: row.state,
        phone: row.phone, verified: row.verified, has_lounge: row.has_lounge,
        has_walk_in_humidor: row.has_walk_in_humidor, vitolas: []
      };
    }
    storeMap[row.store_id].vitolas.push({
      vitola_id: row.vitola_id, name: row.vitola_name, length: row.length,
      ring_gauge: row.ring_gauge, price: row.price, quantity: row.quantity,
      is_new_arrival: row.is_new_arrival
    });
  }
  res.json(Object.values(storeMap));
});

// Price comparison across stores for a cigar
router.get('/:id/price-comparison', (req, res) => {
  const rows = db.prepare(`
    SELECT s.id as store_id, s.name as store_name, s.city, s.state,
      v.name as vitola_name, v.ring_gauge, v.length,
      i.price, i.quantity, i.in_stock
    FROM inventory i
    JOIN stores s ON s.id = i.store_id
    JOIN vitolas v ON v.id = i.vitola_id
    WHERE i.cigar_id = ?
    ORDER BY v.ring_gauge, i.price ASC
  `).all(req.params.id);

  // Group by vitola
  const byVitola = {};
  for (const r of rows) {
    if (!byVitola[r.vitola_name]) byVitola[r.vitola_name] = { name: r.vitola_name, ring_gauge: r.ring_gauge, length: r.length, stores: [] };
    byVitola[r.vitola_name].stores.push({ store_id: r.store_id, store_name: r.store_name, city: r.city, state: r.state, price: r.price, quantity: r.quantity, in_stock: r.in_stock });
  }
  res.json(Object.values(byVitola));
});

// Reviews
router.get('/:id/reviews', (req, res) => {
  const { page = 1, limit = 10, sort = 'newest' } = req.query;
  const offset = (page - 1) * limit;
  const orderBy = sort === 'highest' ? 'r.rating DESC' : sort === 'lowest' ? 'r.rating ASC' : 'r.created_at DESC';

  const reviews = db.prepare(`
    SELECT r.*, u.name as user_name, u.avatar_url, v.name as vitola_name
    FROM reviews r JOIN users u ON u.id = r.user_id
    LEFT JOIN vitolas v ON v.id = r.vitola_id
    WHERE r.cigar_id = ? ORDER BY ${orderBy} LIMIT ? OFFSET ?
  `).all(req.params.id, limit, offset);

  const total = db.prepare('SELECT COUNT(*) as n FROM reviews WHERE cigar_id = ?').get(req.params.id).n;

  const distribution = db.prepare(`
    SELECT
      COUNT(CASE WHEN rating >= 95 THEN 1 END) as outstanding,
      COUNT(CASE WHEN rating >= 90 AND rating < 95 THEN 1 END) as excellent,
      COUNT(CASE WHEN rating >= 85 AND rating < 90 THEN 1 END) as very_good,
      COUNT(CASE WHEN rating < 85 THEN 1 END) as good
    FROM reviews WHERE cigar_id = ?
  `).get(req.params.id);

  res.json({
    reviews: reviews.map(r => ({ ...r, flavor_notes: JSON.parse(r.flavor_notes || '[]') })),
    total, page: +page, pages: Math.ceil(total / limit), distribution
  });
});

// Post review (full logbook entry)
router.post('/:id/reviews', requireAuth, (req, res) => {
  const {
    vitola_id, store_id, logged_date, rating,
    draw_rating, burn_rating, appearance_rating, flavor_intensity,
    first_third_notes, second_third_notes, final_third_notes,
    first_third_text, second_third_text, final_third_text,
    ash_color, finish_length, retrohale_notes,
    would_buy_again, strength_start, strength_end,
    flavor_notes, strength_experienced, smoke_time,
    pairing, occasion, review_text,
  } = req.body;

  if (!rating || rating < 50 || rating > 100) return res.status(400).json({ error: 'Rating must be 50-100' });

  const existing = db.prepare('SELECT id FROM reviews WHERE user_id=? AND cigar_id=? AND vitola_id=?').get(req.user.id, req.params.id, vitola_id);
  if (existing) return res.status(409).json({ error: 'You already logged this cigar in this size. Edit your existing entry.' });

  const result = db.prepare(`
    INSERT INTO reviews (
      user_id, cigar_id, vitola_id, store_id, logged_date, rating,
      draw_rating, burn_rating, appearance_rating, flavor_intensity,
      first_third_notes, second_third_notes, final_third_notes,
      first_third_text, second_third_text, final_third_text,
      ash_color, finish_length, retrohale_notes,
      would_buy_again, strength_start, strength_end,
      flavor_notes, strength_experienced, smoke_time,
      pairing, occasion, review_text
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    req.user.id, req.params.id, vitola_id, store_id || null, logged_date || null, rating,
    draw_rating, burn_rating, appearance_rating, flavor_intensity,
    JSON.stringify(first_third_notes || []), JSON.stringify(second_third_notes || []), JSON.stringify(final_third_notes || []),
    first_third_text, second_third_text, final_third_text,
    ash_color, finish_length, retrohale_notes,
    would_buy_again, strength_start, strength_end,
    JSON.stringify(flavor_notes || []), strength_experienced, smoke_time,
    pairing, occasion, review_text
  );

  res.json({ id: result.lastInsertRowid });
});

// Follow / unfollow a cigar (in-stock alerts)
router.post('/:id/follow', requireAuth, (req, res) => {
  const existing = db.prepare('SELECT 1 FROM cigar_follows WHERE user_id=? AND cigar_id=?').get(req.user.id, req.params.id);
  if (existing) {
    db.prepare('DELETE FROM cigar_follows WHERE user_id=? AND cigar_id=?').run(req.user.id, req.params.id);
    return res.json({ following: false });
  }
  db.prepare('INSERT INTO cigar_follows (user_id, cigar_id) VALUES (?,?)').run(req.user.id, req.params.id);
  res.json({ following: true });
});

// Check follow status (also returns follower count for stores to see demand)
router.get('/:id/follow-status', optionalAuth, (req, res) => {
  const follower_count = db.prepare('SELECT COUNT(*) as n FROM cigar_follows WHERE cigar_id=?').get(req.params.id).n;
  let following = false;
  if (req.user) {
    following = !!db.prepare('SELECT 1 FROM cigar_follows WHERE user_id=? AND cigar_id=?').get(req.user.id, req.params.id);
  }
  res.json({ following, follower_count });
});

// Get user's followed cigars
router.get('/followed', requireAuth, (req, res) => {
  const cigars = db.prepare(`
    SELECT c.*, cf.created_at as followed_at,
      COUNT(DISTINCT i.store_id) as store_count,
      MIN(i.price) as min_price,
      COALESCE(AVG(r.rating), 0) as avg_rating
    FROM cigar_follows cf
    JOIN cigars c ON c.id = cf.cigar_id
    LEFT JOIN inventory i ON i.cigar_id = c.id AND i.in_stock = 1
    LEFT JOIN reviews r ON r.cigar_id = c.id
    WHERE cf.user_id = ?
    GROUP BY c.id
    ORDER BY cf.created_at DESC
  `).all(req.user.id);
  res.json(cigars.map(c => ({ ...c, flavor_notes: JSON.parse(c.flavor_notes || '[]'), avg_rating: Math.round(c.avg_rating) })));
});

module.exports = router;
