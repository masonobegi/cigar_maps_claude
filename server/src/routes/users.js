const router = require('express').Router();
const db = require('../database/db');
const { requireAuth } = require('../middleware/auth');
const { asyncRoute } = db;
const { createHumidorSheet, syncHumidorSheet } = require('../utils/googleSheets');

router.get('/me/humidor', requireAuth, asyncRoute(async (req, res) => {
  const { status } = req.query;
  let where = 'uc.user_id = ?';
  const params = [req.user.id];
  if (status) { where += ' AND uc.status = ?'; params.push(status); }

  const items = await db.all(`
    SELECT uc.*, c.brand, c.name as cigar_name, c.strength, c.country, c.flavor_notes, c.wrapper,
      v.name as vitola_name, v.length, v.ring_gauge,
      COALESCE(AVG(r.rating),0) as avg_rating, COUNT(r.id) as review_count
    FROM user_cigars uc
    JOIN cigars c ON c.id = uc.cigar_id
    LEFT JOIN vitolas v ON v.id = uc.vitola_id
    LEFT JOIN reviews r ON r.cigar_id = uc.cigar_id
    WHERE ${where} GROUP BY uc.id, c.id, v.id ORDER BY uc.created_at DESC
  `, params);

  const all = await db.all('SELECT status, quantity, purchase_price FROM user_cigars WHERE user_id = ?', [req.user.id]);
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
}));

router.post('/me/humidor', requireAuth, asyncRoute(async (req, res) => {
  const { cigar_id, size_label, status, quantity, purchase_price, purchase_date, notes, aging_goal_date } = req.body;
  if (!cigar_id) return res.status(400).json({ error: 'cigar_id required' });

  // Treat empty strings as NULL so PostgreSQL typed columns don't error
  const n = v => (v === '' || v == null) ? null : v;
  const finalStatus = status || 'humidor';
  const result = await db.run(`
    INSERT INTO user_cigars (user_id, cigar_id, size_label, status, quantity, purchase_price, purchase_date, notes, aging_goal_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id
  `, [req.user.id, cigar_id, n(size_label), finalStatus, quantity || 1,
    n(purchase_price), n(purchase_date), n(notes), n(aging_goal_date)]);

  if (finalStatus === 'smoked') {
    await db.run("DELETE FROM smoke_list WHERE user_id = ? AND cigar_id = ? AND status = 'pending'", [req.user.id, cigar_id]);
  }

  res.json({ id: result.lastInsertRowid });
}));

router.put('/me/humidor/:id', requireAuth, asyncRoute(async (req, res) => {
  const { status, size_label, quantity, purchase_price, purchase_date, notes, aging_goal_date } = req.body;
  const n = v => (v === '' || v == null) ? null : v;
  await db.run(`
    UPDATE user_cigars SET status=?, size_label=?, quantity=?, purchase_price=?, purchase_date=?, notes=?, aging_goal_date=?
    WHERE id=? AND user_id=?
  `, [n(status), n(size_label), n(quantity), n(purchase_price), n(purchase_date), n(notes), n(aging_goal_date), req.params.id, req.user.id]);
  res.json({ success: true });
}));

router.delete('/me/humidor/:id', requireAuth, asyncRoute(async (req, res) => {
  await db.run('DELETE FROM user_cigars WHERE id=? AND user_id=?', [req.params.id, req.user.id]);
  res.json({ success: true });
}));

router.get('/me/reviews', requireAuth, asyncRoute(async (req, res) => {
  const reviews = await db.all(`
    SELECT r.id, r.user_id, r.cigar_id, r.vitola_id, r.store_id, r.logged_date, r.rating,
      r.draw_rating, r.burn_rating, r.appearance_rating, r.ash_color,
      r.first_third_notes, r.first_third_text, r.second_third_notes, r.second_third_text,
      r.final_third_notes, r.final_third_text, r.flavor_notes, r.flavor_intensity,
      r.finish_length, r.retrohale_notes, r.strength_start, r.strength_end,
      r.would_buy_again, r.strength_experienced, r.smoke_time, r.pairing, r.occasion,
      r.review_text, r.created_at,
      (r.photo_data IS NOT NULL) as has_photo,
      c.brand, c.name as cigar_name, v.name as vitola_name
    FROM reviews r JOIN cigars c ON c.id = r.cigar_id LEFT JOIN vitolas v ON v.id = r.vitola_id
    WHERE r.user_id = ? ORDER BY r.created_at DESC
  `, [req.user.id]);
  res.json(reviews.map(r => ({ ...r, flavor_notes: JSON.parse(r.flavor_notes || '[]') })));
}));

router.get('/me/recommendations', requireAuth, asyncRoute(async (req, res) => {
  const topReviews = await db.all(`
    SELECT c.strength, c.wrapper, c.country, c.flavor_notes, r.rating
    FROM reviews r JOIN cigars c ON c.id = r.cigar_id
    WHERE r.user_id = ? AND r.rating >= 85
    ORDER BY r.rating DESC LIMIT 30
  `, [req.user.id]);

  if (topReviews.length === 0) {
    const popular = await db.all(`
      SELECT c.id, c.brand, c.name, c.strength, c.wrapper, c.country, c.flavor_notes,
        COALESCE(ROUND((SELECT AVG(r3.rating) FROM reviews r3 WHERE r3.cigar_id = c.id)::numeric, 1), 0) as avg_rating,
        COUNT(DISTINCT r2.id) as review_count,
        COUNT(DISTINCT i.store_id) as store_count, MIN(i.price) as min_price
      FROM cigars c
      LEFT JOIN reviews r2 ON r2.cigar_id = c.id
      LEFT JOIN inventory i ON i.cigar_id = c.id AND i.in_stock = 1
      GROUP BY c.id HAVING COUNT(DISTINCT r2.id) >= 2
      ORDER BY avg_rating DESC, review_count DESC LIMIT 8
    `, []);
    return res.json({
      recommendations: popular.map(c => ({ ...c, flavor_notes: JSON.parse(c.flavor_notes || '[]'), reason: 'Top rated by the community' })),
      has_profile: false,
    });
  }

  // Build taste profile weighted by rating
  const strengthCounts = {}, wrapperCounts = {}, countryCounts = {}, flavorCounts = {};
  for (const r of topReviews) {
    const w = r.rating >= 95 ? 3 : r.rating >= 90 ? 2 : 1;
    if (r.strength) strengthCounts[r.strength] = (strengthCounts[r.strength] || 0) + w;
    if (r.wrapper) wrapperCounts[r.wrapper] = (wrapperCounts[r.wrapper] || 0) + w;
    if (r.country) countryCounts[r.country] = (countryCounts[r.country] || 0) + w;
    for (const fn of JSON.parse(r.flavor_notes || '[]')) flavorCounts[fn] = (flavorCounts[fn] || 0) + w;
  }
  const top2 = obj => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, 2).map(e => e[0]);
  const topStrengths = top2(strengthCounts);
  const topWrappers = top2(wrapperCounts);
  const topCountries = top2(countryCounts);
  const topFlavors = Object.entries(flavorCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(e => e[0]);

  const candidates = await db.all(`
    SELECT c.id, c.brand, c.name, c.strength, c.wrapper, c.country, c.flavor_notes,
      COALESCE(ROUND((SELECT AVG(r3.rating) FROM reviews r3 WHERE r3.cigar_id = c.id)::numeric, 1), 0) as avg_rating,
      COUNT(DISTINCT r2.id) as review_count,
      COUNT(DISTINCT i.store_id) as store_count, MIN(i.price) as min_price
    FROM cigars c
    LEFT JOIN reviews r2 ON r2.cigar_id = c.id
    LEFT JOIN inventory i ON i.cigar_id = c.id AND i.in_stock = 1
    WHERE c.id NOT IN (SELECT cigar_id FROM reviews WHERE user_id = ?)
    GROUP BY c.id HAVING COUNT(DISTINCT r2.id) >= 1
    ORDER BY avg_rating DESC LIMIT 80
  `, [req.user.id]);

  const scored = candidates.map(c => {
    const notes = JSON.parse(c.flavor_notes || '[]');
    let score = 0;
    if (topStrengths.includes(c.strength)) score += 3;
    if (topWrappers.includes(c.wrapper)) score += 2;
    if (topCountries.includes(c.country)) score += 2;
    for (const fn of notes) { if (topFlavors.includes(fn)) score += 1; }
    score += (+c.avg_rating / 100) * 2;
    return { ...c, flavor_notes: notes, score };
  });
  scored.sort((a, b) => b.score - a.score);

  res.json({
    recommendations: scored.slice(0, 8),
    profile: { strengths: topStrengths, wrappers: topWrappers, countries: topCountries, flavors: topFlavors },
    has_profile: true,
  });
}));

router.get('/me/followed-stores', requireAuth, asyncRoute(async (req, res) => {
  const stores = await db.all(`
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
    GROUP BY s.id, sf.notify_broadcasts, sf.notify_deals, sf.notify_new_arrivals, sf.created_at
    ORDER BY unread_notifications DESC, sf.created_at DESC
  `, [req.user.id, req.user.id]);
  res.json(stores);
}));

router.post('/me/humidor-sheet', requireAuth, asyncRoute(async (req, res) => {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT) return res.status(503).json({ error: 'Google Sheets not configured' });

  const user = await db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
  const items = await db.all(`
    SELECT uc.*, c.brand, c.name as cigar_name, v.name as vitola_name
    FROM user_cigars uc
    JOIN cigars c ON c.id = uc.cigar_id
    LEFT JOIN vitolas v ON v.id = uc.vitola_id
    WHERE uc.user_id = ?
    ORDER BY uc.status, c.brand, c.name
  `, [req.user.id]);

  let sheetUrl = user.humidor_sheet_url;
  if (!sheetUrl) {
    sheetUrl = await createHumidorSheet(user.email, user.name, items);
    await db.run('UPDATE users SET humidor_sheet_url = ? WHERE id = ?', [sheetUrl, req.user.id]);
  } else {
    await syncHumidorSheet(sheetUrl, items);
  }

  res.json({ sheet_url: sheetUrl });
}));

router.put('/me/profile', requireAuth, asyncRoute(async (req, res) => {
  const { name, bio, location_city, location_state, home_lat, home_lng, home_label } = req.body;
  const n = v => v ?? null;
  await db.run('UPDATE users SET name=?, bio=?, location_city=?, location_state=?, home_lat=?, home_lng=?, home_label=? WHERE id=?',
    [n(name), n(bio), n(location_city), n(location_state), n(home_lat), n(home_lng), n(home_label), req.user.id]);
  res.json({ success: true });
}));

router.get('/me/feed', requireAuth, asyncRoute(async (req, res) => {
  // Who does this user follow?
  const follows = await db.all('SELECT followed_id FROM user_follows WHERE follower_id = ?', [req.user.id]);
  const followedIds = follows.map(f => f.followed_id);

  let reviews = [];
  if (followedIds.length > 0) {
    const placeholders = followedIds.map(() => '?').join(',');
    reviews = await db.all(`
      SELECT r.id, r.user_id, r.cigar_id, r.vitola_id, r.rating,
        r.draw_rating, r.burn_rating, r.appearance_rating,
        r.first_third_notes, r.second_third_notes, r.final_third_notes,
        r.flavor_notes, r.pairing, r.smoke_time, r.review_text, r.created_at,
        u.name as user_name, u.avatar_url,
        c.brand, c.name as cigar_name, v.name as vitola_name
      FROM reviews r
      JOIN users u ON u.id = r.user_id
      JOIN cigars c ON c.id = r.cigar_id
      LEFT JOIN vitolas v ON v.id = r.vitola_id
      WHERE r.user_id IN (${placeholders})
      ORDER BY r.created_at DESC LIMIT 30
    `, followedIds);
  }

  // Discover: active reviewers not yet followed
  const suggestions = await db.all(`
    SELECT u.id, u.name, u.avatar_url, u.location_city, u.location_state,
      COUNT(r.id) as review_count,
      ROUND(AVG(r.rating)::numeric, 0) as avg_rating
    FROM users u
    JOIN reviews r ON r.user_id = u.id
    WHERE u.id != ? AND u.account_type = 'user'
      AND u.id NOT IN (SELECT followed_id FROM user_follows WHERE follower_id = ?)
    GROUP BY u.id HAVING COUNT(r.id) >= 1
    ORDER BY review_count DESC, avg_rating DESC LIMIT 8
  `, [req.user.id, req.user.id]);

  const deals = await db.all(`
    SELECT d.*, s.name as store_name, c.brand, c.name as cigar_name
    FROM deals d JOIN stores s ON s.id = d.store_id LEFT JOIN cigars c ON c.id = d.cigar_id
    WHERE (d.expires_at IS NULL OR d.expires_at > NOW())
    ORDER BY d.created_at DESC LIMIT 8
  `, []);

  res.json({
    reviews: reviews.map(r => ({ ...r, flavor_notes: JSON.parse(r.flavor_notes || '[]') })),
    following_ids: followedIds,
    suggestions,
    deals,
  });
}));

router.post('/:id/follow', requireAuth, asyncRoute(async (req, res) => {
  const targetId = +req.params.id;
  if (!Number.isInteger(targetId) || targetId < 1) return res.status(400).json({ error: 'Invalid user id' });
  if (targetId === req.user.id) return res.status(400).json({ error: 'Cannot follow yourself' });
  const target = await db.get('SELECT id FROM users WHERE id = ?', [targetId]);
  if (!target) return res.status(404).json({ error: 'User not found' });
  const existing = await db.get('SELECT 1 FROM user_follows WHERE follower_id = ? AND followed_id = ?', [req.user.id, targetId]);
  if (existing) {
    await db.run('DELETE FROM user_follows WHERE follower_id = ? AND followed_id = ?', [req.user.id, targetId]);
    return res.json({ following: false });
  }
  await db.run('INSERT INTO user_follows (follower_id, followed_id) VALUES (?, ?)', [req.user.id, targetId]);
  res.json({ following: true });
}));

router.get('/:id', asyncRoute(async (req, res) => {
  const user = await db.get('SELECT id, name, bio, avatar_url, location_city, location_state, created_at FROM users WHERE id=?', [req.params.id]);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const reviewCount = (await db.get('SELECT COUNT(*) as n FROM reviews WHERE user_id=?', [req.params.id])).n;
  const humidorCount = (await db.get("SELECT SUM(quantity) as n FROM user_cigars WHERE user_id=? AND status='humidor'", [req.params.id])).n || 0;
  const smokedCount = (await db.get("SELECT COUNT(*) as n FROM user_cigars WHERE user_id=? AND status='smoked'", [req.params.id])).n;

  const recentReviews = await db.all(`
    SELECT r.*, c.brand, c.name as cigar_name, v.name as vitola_name
    FROM reviews r JOIN cigars c ON c.id = r.cigar_id LEFT JOIN vitolas v ON v.id = r.vitola_id
    WHERE r.user_id=? ORDER BY r.created_at DESC LIMIT 5
  `, [req.params.id]);

  res.json({
    user, review_count: reviewCount, humidor_count: humidorCount, smoked_count: smokedCount,
    recent_reviews: recentReviews.map(r => ({ ...r, flavor_notes: JSON.parse(r.flavor_notes || '[]') }))
  });
}));

module.exports = router;
