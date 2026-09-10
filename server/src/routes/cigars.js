const router = require('express').Router();
const db = require('../database/db');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { asyncRoute } = db;

function haversine(lat1, lng1, lat2, lng2) {
  const R = 3958.8, toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

router.get('/', asyncRoute(async (req, res) => {
  const { q, brand, strength, wrapper, country, city, state, min_price, max_price,
    in_stock_only, min_rating, sort = 'popular' } = req.query;
  const page  = Math.max(1, parseInt(req.query.page)  || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 24));
  const offset = (page - 1) * limit;

  let where = ['1=1'];
  const params = [];

  if (q) {
    // Case-insensitive, every word must appear somewhere in "brand name description",
    // so "padron 1964" and "1964 padron" both find Padron 1964 Anniversary.
    // Accents are folded on both sides so "padron" finds "Padrón".
    const COMBINING = new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g');
    const fold = s => s.normalize('NFD').replace(COMBINING, '').toLowerCase();
    const FOLD_SQL = "translate(LOWER(CONCAT(c.brand, ' ', c.name, ' ', COALESCE(c.description, ''))), 'áéíóúñüàèìòùâêîôûäëïöç', 'aeiounuaeiouaeiouaeioc')";
    const tokens = fold(String(q).trim()).split(/\s+/).filter(Boolean).slice(0, 6);
    for (const t of tokens) {
      where.push(`${FOLD_SQL} LIKE ?`);
      params.push(`%${t}%`);
    }
  }
  if (brand) { where.push('c.brand = ?'); params.push(brand); }
  if (strength) { where.push('c.strength = ?'); params.push(strength); }
  if (wrapper) { where.push('c.wrapper LIKE ?'); params.push(`%${wrapper}%`); }
  if (country) { where.push('c.country = ?'); params.push(country); }

  let storeJoin = '';
  if (city || state) {
    storeJoin = `
      JOIN inventory ci_check ON ci_check.cigar_id = c.id AND ci_check.in_stock = 1
      JOIN stores ci_store ON ci_store.id = ci_check.store_id
    `;
    if (city) { where.push('ci_store.city LIKE ?'); params.push(`%${city}%`); }
    if (state) { where.push('ci_store.state = ?'); params.push(state); }
  }

  if (min_price) { where.push('(SELECT MIN(i2.price) FROM inventory i2 WHERE i2.cigar_id = c.id AND i2.in_stock = 1) >= ?'); params.push(+min_price); }
  if (max_price) { where.push('(SELECT MIN(i2.price) FROM inventory i2 WHERE i2.cigar_id = c.id AND i2.in_stock = 1) <= ?'); params.push(+max_price); }
  if (in_stock_only === '1') {
    where.push('EXISTS (SELECT 1 FROM inventory i3 WHERE i3.cigar_id = c.id AND i3.in_stock = 1)');
  }
  if (min_rating) {
    where.push('(SELECT COALESCE(AVG(r2.rating),0) FROM reviews r2 WHERE r2.cigar_id = c.id) >= ?');
    params.push(+min_rating);
  }

  const sortClause = {
    popular: 'review_count DESC, avg_rating DESC',
    rating: 'avg_rating DESC, review_count DESC',
    price_asc: 'min_price ASC',
    price_desc: 'min_price DESC',
    newest: 'c.created_at DESC',
  }[sort] || 'review_count DESC, avg_rating DESC';

  const whereStr = where.join(' AND ');

  const cigars = await db.all(`
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
  `, [...params, limit, offset]);

  const totalRow = await db.get(`
    SELECT COUNT(DISTINCT c.id) as n FROM cigars c ${storeJoin} WHERE ${whereStr}
  `, params);

  res.json({
    cigars: cigars.map(c => ({
      ...c,
      flavor_notes: JSON.parse(c.flavor_notes || '[]'),
      avg_rating: Math.round(c.avg_rating),
    })),
    total: totalRow.n, page: +page, pages: Math.ceil(totalRow.n / limit)
  });
}));

router.get('/brands', asyncRoute(async (req, res) => {
  const brands = await db.all('SELECT brand, COUNT(*) as cigar_count FROM cigars GROUP BY brand ORDER BY brand', []);
  res.json(brands);
}));

// Must be registered before /:id to avoid route shadowing
router.get('/followed', requireAuth, asyncRoute(async (req, res) => {
  const cigars = await db.all(`
    SELECT c.*, cf.created_at as followed_at,
      COUNT(DISTINCT i.store_id) as store_count,
      MIN(i.price) as min_price,
      COALESCE(AVG(r.rating), 0) as avg_rating
    FROM cigar_follows cf
    JOIN cigars c ON c.id = cf.cigar_id
    LEFT JOIN inventory i ON i.cigar_id = c.id AND i.in_stock = 1
    LEFT JOIN reviews r ON r.cigar_id = c.id
    WHERE cf.user_id = ?
    GROUP BY c.id, cf.created_at
    ORDER BY cf.created_at DESC
  `, [req.user.id]);
  res.json(cigars.map(c => ({ ...c, flavor_notes: JSON.parse(c.flavor_notes || '[]'), avg_rating: Math.round(c.avg_rating) })));
}));

router.get('/filters', asyncRoute(async (req, res) => {
  const strengths = (await db.all(`
    SELECT strength FROM cigars WHERE strength IS NOT NULL
    GROUP BY strength
    ORDER BY CASE strength WHEN 'mild' THEN 1 WHEN 'mild-medium' THEN 2 WHEN 'medium' THEN 3 WHEN 'medium-full' THEN 4 WHEN 'full' THEN 5 END
  `, [])).map(r => r.strength);
  const countries = (await db.all('SELECT DISTINCT country FROM cigars WHERE country IS NOT NULL ORDER BY country', [])).map(r => r.country);
  const wrappers = (await db.all('SELECT DISTINCT wrapper FROM cigars WHERE wrapper IS NOT NULL ORDER BY wrapper', [])).map(r => r.wrapper);
  const brands = (await db.all('SELECT brand, COUNT(*) as n FROM cigars GROUP BY brand ORDER BY n DESC, brand', [])).map(r => r.brand);
  res.json({ strengths, countries, wrappers, brands });
}));

router.get('/:id', optionalAuth, asyncRoute(async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(404).json({ error: 'Cigar not found' });
  const cigar = await db.get('SELECT * FROM cigars WHERE id = ?', [id]);
  if (!cigar) return res.status(404).json({ error: 'Cigar not found' });

  const vitolas = await db.all('SELECT * FROM vitolas WHERE cigar_id = ? ORDER BY ring_gauge', [cigar.id]);

  const stats = await db.get(`
    SELECT COALESCE(AVG(rating),0) as avg_rating, COUNT(*) as review_count,
      COALESCE(AVG(draw_rating),0) as avg_draw, COALESCE(AVG(burn_rating),0) as avg_burn,
      COALESCE(AVG(appearance_rating),0) as avg_appearance, COALESCE(AVG(smoke_time),0) as avg_smoke_time
    FROM reviews WHERE cigar_id = ?
  `, [cigar.id]);

  const reviewFlavors = await db.all('SELECT flavor_notes FROM reviews WHERE cigar_id = ? AND flavor_notes IS NOT NULL', [cigar.id]);
  const flavorCounts = {};
  for (const r of reviewFlavors) {
    for (const n of JSON.parse(r.flavor_notes || '[]')) flavorCounts[n] = (flavorCounts[n] || 0) + 1;
  }
  const topFlavors = Object.entries(flavorCounts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([note, count]) => ({ note, count }));

  const similar = await db.all(`
    SELECT c.id, c.brand, c.name, c.strength, COALESCE(AVG(r.rating),0) as avg_rating
    FROM cigars c LEFT JOIN reviews r ON r.cigar_id = c.id
    WHERE c.id != ? AND (c.brand = ? OR c.strength = ?)
    GROUP BY c.id ORDER BY avg_rating DESC LIMIT 4
  `, [cigar.id, cigar.brand, cigar.strength]);

  res.json({
    cigar: { ...cigar, flavor_notes: JSON.parse(cigar.flavor_notes || '[]') },
    vitolas,
    stats: {
      avg_rating: Math.round(stats.avg_rating),
      review_count: stats.review_count,
      avg_draw: +parseFloat(stats.avg_draw).toFixed(1),
      avg_burn: +parseFloat(stats.avg_burn).toFixed(1),
      avg_appearance: +parseFloat(stats.avg_appearance).toFixed(1),
      avg_smoke_time: Math.round(stats.avg_smoke_time),
    },
    top_flavors: topFlavors,
    similar,
  });
}));

// "Where to find it": every visible shop with an in-stock row for this cigar.
// Optional lat/lng adds a haversine distance and sorts nearest-first; without
// coordinates the claimed + verified shops lead. Fields are only ever added
// here — the old shape (store_id, name, city, state, phone, verified,
// has_lounge, has_walk_in_humidor, distance_mi, vitolas[]) stays intact.
const AVAILABILITY_LIMIT = 25;

router.get('/:id/availability', asyncRoute(async (req, res) => {
  const { city, state, lat, lng } = req.query;
  let where = 'i.cigar_id = ? AND i.in_stock = 1 AND COALESCE(s.visible, 1) = 1';
  const params = [req.params.id];
  if (city) { where += ' AND s.city LIKE ?'; params.push(`%${city}%`); }
  if (state) { where += ' AND s.state = ?'; params.push(state); }

  const rows = await db.all(`
    SELECT s.id as store_id, s.name as store_name, s.city, s.state, s.phone, s.verified,
      s.has_lounge, s.has_walk_in_humidor, s.lat, s.lng, s.claimed, s.store_type,
      v.name as vitola_name, v.length, v.ring_gauge,
      i.price, i.quantity, i.in_stock, i.vitola_id, i.is_new_arrival,
      i.source, i.source_url, i.updated_at, i.last_confirmed_at
    FROM inventory i
    JOIN stores s ON s.id = i.store_id
    JOIN vitolas v ON v.id = i.vitola_id
    WHERE ${where}
    ORDER BY s.name, v.ring_gauge
  `, params);

  const storeMap = {};
  const userLat = parseFloat(lat), userLng = parseFloat(lng);
  const hasOrigin = !isNaN(userLat) && !isNaN(userLng);
  const stamp = (t) => { const n = t ? new Date(t).getTime() : NaN; return isNaN(n) ? null : n; };

  for (const row of rows) {
    if (!storeMap[row.store_id]) {
      let distance_mi = null;
      if (hasOrigin && row.lat != null && row.lng != null) {
        distance_mi = Math.round(haversine(userLat, userLng, row.lat, row.lng) * 10) / 10;
      }
      storeMap[row.store_id] = {
        store_id: row.store_id, name: row.store_name, city: row.city, state: row.state,
        phone: row.phone, verified: row.verified, has_lounge: row.has_lounge,
        has_walk_in_humidor: row.has_walk_in_humidor, distance_mi, vitolas: [],
        claimed: row.claimed, store_type: row.store_type || 'cigar_shop',
        lat: row.lat, lng: row.lng,
        min_price: null, max_price: null, updated_at: null, source: 'owner',
      };
    }
    const s = storeMap[row.store_id];
    // Anything not entered by the shop owner came off the shop's own website.
    const rowSource = row.source && row.source !== 'owner' ? 'web' : 'owner';
    if (rowSource === 'web') s.source = 'web';
    const confirmed = row.last_confirmed_at || row.updated_at;
    s.vitolas.push({
      vitola_id: row.vitola_id, name: row.vitola_name, length: row.length,
      ring_gauge: row.ring_gauge, price: row.price, quantity: row.quantity,
      is_new_arrival: row.is_new_arrival,
      source: rowSource, source_url: row.source_url || null,
      last_confirmed_at: confirmed || null,
    });
    if (row.price != null) {
      if (s.min_price == null || row.price < s.min_price) s.min_price = row.price;
      if (s.max_price == null || row.price > s.max_price) s.max_price = row.price;
    }
    // Freshest signal wins: an explicit re-confirmation or the last edit.
    for (const t of [row.updated_at, row.last_confirmed_at]) {
      const n = stamp(t);
      if (n != null && (s.updated_at == null || n > stamp(s.updated_at))) s.updated_at = t;
    }
  }

  const list = Object.values(storeMap);
  list.sort((a, b) => {
    if (hasOrigin) {
      const ad = a.distance_mi, bd = b.distance_mi;
      if (ad != null && bd != null && ad !== bd) return ad - bd;
      if (ad != null && bd == null) return -1;
      if (ad == null && bd != null) return 1;
    }
    if ((b.claimed ? 1 : 0) !== (a.claimed ? 1 : 0)) return (b.claimed ? 1 : 0) - (a.claimed ? 1 : 0);
    if ((b.verified ? 1 : 0) !== (a.verified ? 1 : 0)) return (b.verified ? 1 : 0) - (a.verified ? 1 : 0);
    return String(a.name || '').localeCompare(String(b.name || ''));
  });

  res.json(list.slice(0, AVAILABILITY_LIMIT));
}));

router.get('/:id/price-comparison', asyncRoute(async (req, res) => {
  const rows = await db.all(`
    SELECT s.id as store_id, s.name as store_name, s.city, s.state,
      v.name as vitola_name, v.ring_gauge, v.length,
      i.price, i.quantity, i.in_stock
    FROM inventory i
    JOIN stores s ON s.id = i.store_id
    JOIN vitolas v ON v.id = i.vitola_id
    WHERE i.cigar_id = ?
    ORDER BY v.ring_gauge, i.price ASC
  `, [req.params.id]);

  const byVitola = {};
  for (const r of rows) {
    if (!byVitola[r.vitola_name]) byVitola[r.vitola_name] = { name: r.vitola_name, ring_gauge: r.ring_gauge, length: r.length, stores: [] };
    byVitola[r.vitola_name].stores.push({ store_id: r.store_id, store_name: r.store_name, city: r.city, state: r.state, price: r.price, quantity: r.quantity, in_stock: r.in_stock });
  }
  res.json(Object.values(byVitola));
}));

router.get('/:id/reviews', asyncRoute(async (req, res) => {
  const { page = 1, limit = 10, sort = 'newest' } = req.query;
  const offset = (page - 1) * limit;
  const orderBy = sort === 'highest' ? 'r.rating DESC' : sort === 'lowest' ? 'r.rating ASC' : 'r.created_at DESC';

  // Never SELECT r.* here: photo_data holds a base64 image, and a page of 20
  // reviews would carry several megabytes of it. The client loads photos from
  // /api/review-images/:id instead.
  const reviews = await db.all(`
    SELECT r.id, r.user_id, r.cigar_id, r.vitola_id, r.store_id, r.logged_date, r.rating,
      r.draw_rating, r.burn_rating, r.appearance_rating, r.flavor_intensity,
      r.first_third_notes, r.second_third_notes, r.final_third_notes,
      r.first_third_text, r.second_third_text, r.final_third_text,
      r.ash_color, r.finish_length, r.retrohale_notes, r.would_buy_again,
      r.strength_start, r.strength_end, r.flavor_notes, r.strength_experienced,
      r.smoke_time, r.pairing, r.occasion, r.review_text, r.created_at,
      (r.photo_data IS NOT NULL) as has_photo,
      u.name as user_name, u.avatar_url, v.name as vitola_name
    FROM reviews r JOIN users u ON u.id = r.user_id
    LEFT JOIN vitolas v ON v.id = r.vitola_id
    WHERE r.cigar_id = ? ORDER BY ${orderBy} LIMIT ? OFFSET ?
  `, [req.params.id, limit, offset]);

  const total = (await db.get('SELECT COUNT(*) as n FROM reviews WHERE cigar_id = ?', [req.params.id])).n;

  const distribution = await db.get(`
    SELECT
      COUNT(CASE WHEN rating >= 95 THEN 1 END) as outstanding,
      COUNT(CASE WHEN rating >= 90 AND rating < 95 THEN 1 END) as excellent,
      COUNT(CASE WHEN rating >= 85 AND rating < 90 THEN 1 END) as very_good,
      COUNT(CASE WHEN rating < 85 THEN 1 END) as good
    FROM reviews WHERE cigar_id = ?
  `, [req.params.id]);

  res.json({
    reviews: reviews.map(r => ({ ...r, flavor_notes: JSON.parse(r.flavor_notes || '[]') })),
    total, page: +page, pages: Math.ceil(total / limit), distribution
  });
}));

router.post('/:id/reviews', requireAuth, asyncRoute(async (req, res) => {
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

  if (req.user.account_type !== 'user') return res.status(403).json({ error: 'Only regular user accounts can post reviews' });
  if (!rating || rating < 50 || rating > 100) return res.status(400).json({ error: 'Rating must be 50-100' });

  const existing = await db.get('SELECT id FROM reviews WHERE user_id=? AND cigar_id=? AND vitola_id=?', [req.user.id, req.params.id, vitola_id]);
  if (existing) return res.status(409).json({ error: 'You already logged this cigar in this size. Edit your existing entry.' });

  const n = v => v ?? null;
  const result = await db.run(`
    INSERT INTO reviews (
      user_id, cigar_id, vitola_id, store_id, logged_date, rating,
      draw_rating, burn_rating, appearance_rating, flavor_intensity,
      first_third_notes, second_third_notes, final_third_notes,
      first_third_text, second_third_text, final_third_text,
      ash_color, finish_length, retrohale_notes,
      would_buy_again, strength_start, strength_end,
      flavor_notes, strength_experienced, smoke_time,
      pairing, occasion, review_text
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id
  `, [
    req.user.id, req.params.id, n(vitola_id), n(store_id), n(logged_date), rating,
    n(draw_rating), n(burn_rating), n(appearance_rating), n(flavor_intensity),
    JSON.stringify(first_third_notes || []), JSON.stringify(second_third_notes || []), JSON.stringify(final_third_notes || []),
    n(first_third_text), n(second_third_text), n(final_third_text),
    n(ash_color), n(finish_length), n(retrohale_notes),
    n(would_buy_again), n(strength_start), n(strength_end),
    JSON.stringify(flavor_notes || []), n(strength_experienced), n(smoke_time),
    n(pairing), n(occasion), n(review_text)
  ]);

  res.json({ id: result.lastInsertRowid });
}));

router.post('/:id/follow', requireAuth, asyncRoute(async (req, res) => {
  const existing = await db.get('SELECT 1 FROM cigar_follows WHERE user_id=? AND cigar_id=?', [req.user.id, req.params.id]);
  if (existing) {
    await db.run('DELETE FROM cigar_follows WHERE user_id=? AND cigar_id=?', [req.user.id, req.params.id]);
    return res.json({ following: false });
  }
  await db.run('INSERT INTO cigar_follows (user_id, cigar_id) VALUES (?,?)', [req.user.id, req.params.id]);
  res.json({ following: true });
}));

router.get('/:id/follow-status', optionalAuth, asyncRoute(async (req, res) => {
  const follower_count = (await db.get('SELECT COUNT(*) as n FROM cigar_follows WHERE cigar_id=?', [req.params.id])).n;
  let following = false;
  if (req.user) {
    following = !!(await db.get('SELECT 1 FROM cigar_follows WHERE user_id=? AND cigar_id=?', [req.user.id, req.params.id]));
  }
  res.json({ following, follower_count });
}));

module.exports = router;
