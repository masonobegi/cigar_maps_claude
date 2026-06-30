const router = require('express').Router();
const db = require('../database/db');
const https = require('https');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { asyncRoute } = db;

let transporter = null;
try {
  const nodemailer = require('nodemailer');
  if (process.env.SMTP_USER && process.env.SMTP_PASS) {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
} catch (_) {}

async function geocode(address, city, state) {
  const q = [address, city, state].filter(Boolean).join(', ');
  return new Promise((resolve) => {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&countrycodes=us`;
    const options = { headers: { 'User-Agent': 'CigarBuddy/1.0 (mason.obegi@gmail.com)' } };
    https.get(url, options, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const results = JSON.parse(d);
          if (results[0]) resolve({ lat: parseFloat(results[0].lat), lng: parseFloat(results[0].lon) });
          else resolve(null);
        } catch { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

router.get('/', asyncRoute(async (req, res) => {
  const { q, city, state, has_lounge, has_walk_in_humidor, open_now } = req.query;
  let where = ['1=1'];
  const params = [];

  if (q) {
    where.push('(s.name LIKE ? OR s.description LIKE ? OR s.city LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (city) { where.push('s.city LIKE ?'); params.push(`%${city}%`); }
  if (state) { where.push('s.state = ?'); params.push(state); }
  if (has_lounge === '1') { where.push('s.has_lounge = 1'); }
  if (has_walk_in_humidor === '1') { where.push('s.has_walk_in_humidor = 1'); }

  const stores = await db.all(`
    SELECT s.*,
      COUNT(DISTINCT i.id) as inventory_count,
      COUNT(DISTINCT sf.user_id) as follower_count,
      COALESCE(AVG(sr.rating), 0) as avg_rating,
      COUNT(DISTINCT sr.id) as rating_count
    FROM stores s
    LEFT JOIN inventory i ON i.store_id = s.id AND i.in_stock = 1
    LEFT JOIN store_follows sf ON sf.store_id = s.id
    LEFT JOIN store_ratings sr ON sr.store_id = s.id
    WHERE ${where.join(' AND ')}
    GROUP BY s.id
    ORDER BY s.verified DESC, follower_count DESC, inventory_count DESC
  `, params);

  const now = new Date();
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const today = dayNames[now.getDay()];

  const result = stores.map(s => {
    let hours = {};
    try { hours = JSON.parse(s.hours || '{}'); } catch {}
    let isOpen = null;
    const todayHours = hours[today];
    if (todayHours && todayHours !== 'Closed') {
      const match = todayHours.match(/(\d+)(?::(\d+))?(am|pm)-(\d+)(?::(\d+))?(am|pm)/i);
      if (match) {
        let openH = parseInt(match[1]);
        const openAmPm = match[3].toLowerCase();
        let closeH = parseInt(match[4]);
        const closeAmPm = match[6].toLowerCase();
        if (openAmPm === 'pm' && openH !== 12) openH += 12;
        if (openAmPm === 'am' && openH === 12) openH = 0;
        if (closeAmPm === 'pm' && closeH !== 12) closeH += 12;
        if (closeAmPm === 'am' && closeH === 12) closeH = 0;
        isOpen = now.getHours() >= openH && now.getHours() < closeH;
      }
    } else if (todayHours === 'Closed') {
      isOpen = false;
    }
    return { ...s, tags: s.tags ? JSON.parse(s.tags) : [], today_hours: todayHours || null, is_open: isOpen, avg_rating: +parseFloat(s.avg_rating).toFixed(1) };
  }).filter(s => open_now === '1' ? s.is_open === true : true);

  res.json(result);
}));

router.get('/cities', asyncRoute(async (req, res) => {
  const cities = await db.all(`
    SELECT DISTINCT city, state, COUNT(*) as store_count
    FROM stores WHERE city IS NOT NULL AND city != ''
    GROUP BY city, state ORDER BY store_count DESC, city
  `, []);
  res.json(cities);
}));

router.get('/:id', optionalAuth, asyncRoute(async (req, res) => {
  const store = await db.get('SELECT * FROM stores WHERE id = ?', [req.params.id]);
  if (!store) return res.status(404).json({ error: 'Store not found' });

  await db.run('INSERT INTO store_views (store_id) VALUES (?)', [store.id]);

  let hours = {};
  try { hours = JSON.parse(store.hours || '{}'); } catch {}

  const inventoryCount = (await db.get('SELECT COUNT(*) as n FROM inventory WHERE store_id = ? AND in_stock = 1', [store.id])).n;

  const deals = await db.all(`
    SELECT d.*, c.brand, c.name as cigar_name FROM deals d
    LEFT JOIN cigars c ON c.id = d.cigar_id
    WHERE d.store_id = ? AND (d.expires_at IS NULL OR d.expires_at > NOW())
    ORDER BY d.created_at DESC
  `, [store.id]);

  const stats = await db.get(`
    SELECT
      COUNT(DISTINCT sf.user_id) as followers,
      COUNT(DISTINCT sv.id) as total_views,
      COALESCE(AVG(sr.rating), 0) as avg_rating,
      COUNT(DISTINCT sr.id) as rating_count
    FROM stores s
    LEFT JOIN store_follows sf ON sf.store_id = s.id
    LEFT JOIN store_views sv ON sv.store_id = s.id
    LEFT JOIN store_ratings sr ON sr.store_id = s.id
    WHERE s.id = ?
  `, [store.id]);

  const recentRatings = await db.all(`
    SELECT sr.*, u.name as user_name FROM store_ratings sr
    JOIN users u ON u.id = sr.user_id
    WHERE sr.store_id = ? ORDER BY sr.created_at DESC LIMIT 5
  `, [store.id]);

  const newArrivals = await db.all(`
    SELECT i.*, c.brand, c.name as cigar_name, v.name as vitola_name
    FROM inventory i
    JOIN cigars c ON c.id = i.cigar_id
    JOIN vitolas v ON v.id = i.vitola_id
    WHERE i.store_id = ? AND i.is_new_arrival = 1 AND i.in_stock = 1
    ORDER BY i.updated_at DESC LIMIT 6
  `, [store.id]);

  let isFollowing = false, followPrefs = null;
  if (req.user) {
    const follow = await db.get('SELECT * FROM store_follows WHERE user_id = ? AND store_id = ?', [req.user.id, store.id]);
    isFollowing = !!follow;
    followPrefs = follow;
  }

  res.json({
    store: { ...store, hours, tags: store.tags ? JSON.parse(store.tags) : [] },
    inventory_count: inventoryCount,
    deals,
    stats: { ...stats, avg_rating: +parseFloat(stats.avg_rating).toFixed(1) },
    recent_ratings: recentRatings,
    new_arrivals: newArrivals,
    is_following: isFollowing,
    follow_prefs: followPrefs,
  });
}));

router.get('/:id/inventory', asyncRoute(async (req, res) => {
  const { page = 1, limit = 40, q, strength, is_new_arrival } = req.query;
  const offset = (page - 1) * limit;

  let where = ['i.store_id = ?', 'i.in_stock = 1'];
  const params = [req.params.id];

  if (q) { where.push('(c.brand LIKE ? OR c.name LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
  if (strength) { where.push('c.strength = ?'); params.push(strength); }
  if (is_new_arrival === '1') { where.push('i.is_new_arrival = 1'); }

  const items = await db.all(`
    SELECT i.*, c.brand, c.name as cigar_name, c.strength, c.wrapper, c.country, c.flavor_notes,
      v.name as vitola_name, v.length, v.ring_gauge, v.msrp
    FROM inventory i
    JOIN cigars c ON c.id = i.cigar_id
    JOIN vitolas v ON v.id = i.vitola_id
    WHERE ${where.join(' AND ')}
    ORDER BY i.is_featured DESC, i.is_new_arrival DESC, c.brand, c.name, v.ring_gauge
    LIMIT ? OFFSET ?
  `, [...params, limit, offset]);

  const total = (await db.get(`SELECT COUNT(*) as n FROM inventory i JOIN cigars c ON c.id = i.cigar_id WHERE ${where.join(' AND ')}`, params)).n;

  res.json({
    items: items.map(i => ({ ...i, flavor_notes: JSON.parse(i.flavor_notes || '[]') })),
    total, page: +page, pages: Math.ceil(total / limit)
  });
}));

router.post('/', requireAuth, asyncRoute(async (req, res) => {
  if (req.user.account_type !== 'store') return res.status(403).json({ error: 'Store accounts only' });
  const existing = await db.get('SELECT id FROM stores WHERE user_id = ?', [req.user.id]);
  if (existing) return res.status(409).json({ error: 'Store already exists for this account' });

  const { name, description, address, city, state, zip, phone, website, hours, has_lounge, has_walk_in_humidor, tags } = req.body;
  if (!name || !city || !state) return res.status(400).json({ error: 'Name, city, and state required' });

  const n = v => v ?? null;
  const result = await db.run(`
    INSERT INTO stores (user_id, name, description, address, city, state, zip, phone, website, hours, has_lounge, has_walk_in_humidor, tags, setup_complete)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1) RETURNING id
  `, [req.user.id, name, n(description), n(address), city, state, n(zip), n(phone), n(website),
    typeof hours === 'object' ? JSON.stringify(hours) : (hours || '{}'),
    has_lounge ? 1 : 0, has_walk_in_humidor ? 1 : 0, JSON.stringify(tags || [])]);

  res.json({ id: result.lastInsertRowid });
}));

router.put('/:id', requireAuth, asyncRoute(async (req, res) => {
  const store = await db.get('SELECT * FROM stores WHERE id = ?', [req.params.id]);
  if (!store) return res.status(404).json({ error: 'Store not found' });
  if (store.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

  const { name, description, address, city, state, zip, phone, website, hours, has_lounge, has_walk_in_humidor, tags } = req.body;
  const n = v => v ?? null;
  await db.run(`
    UPDATE stores SET name=?, description=?, address=?, city=?, state=?, zip=?, phone=?, website=?,
    hours=?, has_lounge=?, has_walk_in_humidor=?, tags=?, setup_complete=1 WHERE id=?
  `, [name, n(description), n(address), city, state, n(zip), n(phone), n(website),
    typeof hours === 'object' ? JSON.stringify(hours) : (hours || '{}'),
    has_lounge ? 1 : 0, has_walk_in_humidor ? 1 : 0, JSON.stringify(tags || []), req.params.id]);

  res.json({ success: true });
}));

router.get('/:id/manage-inventory', requireAuth, asyncRoute(async (req, res) => {
  const store = await db.get('SELECT id FROM stores WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!store) return res.status(403).json({ error: 'Forbidden' });

  const { q } = req.query;
  let where = 'i.store_id = ?';
  const params = [req.params.id];
  if (q) { where += ' AND (c.brand LIKE ? OR c.name LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }

  const items = await db.all(`
    SELECT i.*, c.brand, c.name as cigar_name, c.strength, c.country,
      v.name as vitola_name, v.length, v.ring_gauge, v.msrp
    FROM inventory i
    JOIN cigars c ON c.id = i.cigar_id
    JOIN vitolas v ON v.id = i.vitola_id
    WHERE ${where}
    ORDER BY i.in_stock DESC, c.brand, c.name, v.ring_gauge
  `, params);

  const lowStock = items.filter(i => i.in_stock && i.quantity > 0 && i.quantity < 5).length;
  const outOfStock = items.filter(i => !i.in_stock || i.quantity === 0).length;
  res.json({ items, low_stock: lowStock, out_of_stock: outOfStock });
}));

router.post('/:id/inventory', requireAuth, asyncRoute(async (req, res) => {
  const store = await db.get('SELECT id FROM stores WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!store) return res.status(403).json({ error: 'Forbidden' });

  const { cigar_id, vitola_id, price, quantity, is_featured, is_new_arrival } = req.body;
  if (!cigar_id || !vitola_id || !price) return res.status(400).json({ error: 'cigar_id, vitola_id, price required' });

  const existing = await db.get('SELECT id FROM inventory WHERE store_id = ? AND vitola_id = ?', [req.params.id, vitola_id]);
  if (existing) {
    await db.run('UPDATE inventory SET price=?, quantity=?, in_stock=1, is_new_arrival=?, updated_at=CURRENT_TIMESTAMP WHERE id=?',
      [price, quantity || 0, is_new_arrival ? 1 : 0, existing.id]);
    return res.json({ id: existing.id, updated: true });
  }

  const result = await db.run(`
    INSERT INTO inventory (store_id, cigar_id, vitola_id, price, quantity, in_stock, is_featured, is_new_arrival)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?) RETURNING id
  `, [req.params.id, cigar_id, vitola_id, price, quantity || 0, is_featured ? 1 : 0, is_new_arrival ? 1 : 0]);

  res.json({ id: result.lastInsertRowid });
}));

router.post('/:id/inventory/bulk', requireAuth, asyncRoute(async (req, res) => {
  const store = await db.get('SELECT id FROM stores WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!store) return res.status(403).json({ error: 'Forbidden' });

  const { items } = req.body;
  if (!Array.isArray(items)) return res.status(400).json({ error: 'items array required' });

  let added = 0, updated = 0;
  for (const item of items) {
    if (!item.cigar_id || !item.vitola_id || !item.price) continue;
    const existing = await db.get('SELECT id FROM inventory WHERE store_id = ? AND vitola_id = ?', [req.params.id, item.vitola_id]);
    if (existing) {
      await db.run('UPDATE inventory SET price=?, quantity=?, in_stock=1, updated_at=CURRENT_TIMESTAMP WHERE id=?',
        [item.price, item.quantity || 0, existing.id]);
      updated++;
    } else {
      await db.run('INSERT INTO inventory (store_id, cigar_id, vitola_id, price, quantity, in_stock) VALUES (?, ?, ?, ?, ?, 1)',
        [req.params.id, item.cigar_id, item.vitola_id, item.price, item.quantity || 0]);
      added++;
    }
  }
  res.json({ added, updated });
}));

router.put('/:id/inventory/:itemId', requireAuth, asyncRoute(async (req, res) => {
  const store = await db.get('SELECT id FROM stores WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!store) return res.status(403).json({ error: 'Forbidden' });

  const { price, quantity, in_stock, is_featured, is_new_arrival } = req.body;
  await db.run(`
    UPDATE inventory SET price=?, quantity=?, in_stock=?, is_featured=?, is_new_arrival=?, updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND store_id=?
  `, [price, quantity, in_stock ? 1 : 0, is_featured ? 1 : 0, is_new_arrival ? 1 : 0, req.params.itemId, req.params.id]);
  res.json({ success: true });
}));

router.patch('/:id/inventory/:itemId/restock', requireAuth, asyncRoute(async (req, res) => {
  const store = await db.get('SELECT id FROM stores WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!store) return res.status(403).json({ error: 'Forbidden' });

  const { quantity } = req.body;
  await db.run('UPDATE inventory SET quantity=?, in_stock=1, updated_at=CURRENT_TIMESTAMP WHERE id=? AND store_id=?',
    [quantity, req.params.itemId, req.params.id]);
  res.json({ success: true });
}));

router.delete('/:id/inventory/:itemId', requireAuth, asyncRoute(async (req, res) => {
  const store = await db.get('SELECT id FROM stores WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!store) return res.status(403).json({ error: 'Forbidden' });
  await db.run('DELETE FROM inventory WHERE id=? AND store_id=?', [req.params.itemId, req.params.id]);
  res.json({ success: true });
}));

router.post('/:id/broadcast', requireAuth, asyncRoute(async (req, res) => {
  const store = await db.get('SELECT id, name FROM stores WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!store) return res.status(403).json({ error: 'Forbidden' });

  const { title, message, type, cigar_id } = req.body;
  if (!title || !message) return res.status(400).json({ error: 'title and message required' });

  const validTypes = ['announcement', 'deal', 'new_arrival', 'event'];
  const notifType = validTypes.includes(type) ? type : 'announcement';

  const result = await db.run(`
    INSERT INTO notifications (store_id, title, message, type, cigar_id) VALUES (?, ?, ?, ?, ?) RETURNING id
  `, [req.params.id, title, message, notifType, cigar_id || null]);

  const followerCount = (await db.get('SELECT COUNT(*) as n FROM store_follows WHERE store_id = ?', [req.params.id])).n;
  res.json({ id: result.lastInsertRowid, sent_to: followerCount });
}));

router.get('/:id/broadcasts', asyncRoute(async (req, res) => {
  const broadcasts = await db.all(`
    SELECT n.*, COUNT(nr.user_id) as read_count,
      (SELECT COUNT(*) FROM store_follows WHERE store_id = n.store_id) as total_followers
    FROM notifications n
    LEFT JOIN notification_reads nr ON nr.notification_id = n.id
    WHERE n.store_id = ?
    GROUP BY n.id
    ORDER BY n.created_at DESC LIMIT 30
  `, [req.params.id]);
  res.json(broadcasts);
}));

router.get('/:id/analytics', requireAuth, asyncRoute(async (req, res) => {
  const store = await db.get('SELECT id FROM stores WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!store) return res.status(403).json({ error: 'Forbidden' });

  const overview = await db.get(`
    SELECT
      (SELECT COUNT(*) FROM store_follows WHERE store_id = ?) as followers,
      (SELECT COUNT(*) FROM store_views WHERE store_id = ? AND viewed_at > NOW() - INTERVAL '30 days') as views_30d,
      (SELECT COUNT(*) FROM store_views WHERE store_id = ? AND viewed_at > NOW() - INTERVAL '7 days') as views_7d,
      (SELECT COUNT(*) FROM inventory WHERE store_id = ? AND in_stock = 1) as items_in_stock,
      (SELECT COUNT(*) FROM inventory WHERE store_id = ? AND in_stock = 1 AND quantity < 5 AND quantity > 0) as low_stock,
      (SELECT COUNT(*) FROM inventory WHERE store_id = ? AND (in_stock = 0 OR quantity = 0)) as out_of_stock,
      (SELECT COUNT(*) FROM deals WHERE store_id = ? AND (expires_at IS NULL OR expires_at > NOW())) as active_deals,
      (SELECT COUNT(*) FROM notifications WHERE store_id = ?) as total_broadcasts
  `, [req.params.id, req.params.id, req.params.id, req.params.id, req.params.id, req.params.id, req.params.id, req.params.id]);

  const dailyViews = await db.all(`
    SELECT DATE(viewed_at) as date, COUNT(*) as views
    FROM store_views WHERE store_id = ? AND viewed_at > NOW() - INTERVAL '14 days'
    GROUP BY DATE(viewed_at) ORDER BY date
  `, [req.params.id]);

  const topItems = await db.all(`
    SELECT c.brand, c.name as cigar_name, v.name as vitola_name, i.price, i.quantity
    FROM inventory i JOIN cigars c ON c.id = i.cigar_id JOIN vitolas v ON v.id = i.vitola_id
    WHERE i.store_id = ? AND i.in_stock = 1
    ORDER BY i.is_featured DESC, i.quantity DESC LIMIT 5
  `, [req.params.id]);

  res.json({ overview, daily_views: dailyViews, top_items: topItems });
}));

router.post('/:id/deals', requireAuth, asyncRoute(async (req, res) => {
  const store = await db.get('SELECT id FROM stores WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!store) return res.status(403).json({ error: 'Forbidden' });

  const { title, description, discount_percent, deal_price, cigar_id, expires_at } = req.body;
  if (!title) return res.status(400).json({ error: 'Title required' });

  const result = await db.run(`
    INSERT INTO deals (store_id, title, description, discount_percent, deal_price, cigar_id, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id
  `, [req.params.id, title, description, discount_percent || null, deal_price || null, cigar_id || null, expires_at || null]);

  res.json({ id: result.lastInsertRowid });
}));

router.delete('/:id/deals/:dealId', requireAuth, asyncRoute(async (req, res) => {
  const store = await db.get('SELECT id FROM stores WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!store) return res.status(403).json({ error: 'Forbidden' });
  await db.run('DELETE FROM deals WHERE id=? AND store_id=?', [req.params.dealId, req.params.id]);
  res.json({ success: true });
}));

router.post('/:id/follow', requireAuth, asyncRoute(async (req, res) => {
  const existing = await db.get('SELECT 1 FROM store_follows WHERE user_id=? AND store_id=?', [req.user.id, req.params.id]);
  if (existing) {
    await db.run('DELETE FROM store_follows WHERE user_id=? AND store_id=?', [req.user.id, req.params.id]);
    return res.json({ following: false });
  }
  await db.run('INSERT INTO store_follows (user_id, store_id) VALUES (?, ?)', [req.user.id, req.params.id]);
  res.json({ following: true });
}));

router.put('/:id/follow-prefs', requireAuth, asyncRoute(async (req, res) => {
  const { notify_broadcasts, notify_deals, notify_new_arrivals } = req.body;
  await db.run(`
    UPDATE store_follows SET notify_broadcasts=?, notify_deals=?, notify_new_arrivals=?
    WHERE user_id=? AND store_id=?
  `, [notify_broadcasts ? 1 : 0, notify_deals ? 1 : 0, notify_new_arrivals ? 1 : 0, req.user.id, req.params.id]);
  res.json({ success: true });
}));

router.post('/:id/rate', requireAuth, asyncRoute(async (req, res) => {
  const { rating, comment } = req.body;
  if (!rating || rating < 1 || rating > 5) return res.status(400).json({ error: 'Rating must be 1-5' });

  await db.run(`
    INSERT INTO store_ratings (user_id, store_id, rating, comment) VALUES (?, ?, ?, ?)
    ON CONFLICT (user_id, store_id) DO UPDATE SET rating = EXCLUDED.rating, comment = EXCLUDED.comment
  `, [req.user.id, req.params.id, rating, comment ?? null]);
  res.json({ success: true });
}));

router.post('/:id/verification-request', requireAuth, asyncRoute(async (req, res) => {
  const store = await db.get('SELECT * FROM stores WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!store) return res.status(403).json({ error: 'Forbidden' });
  if (store.verified) return res.status(400).json({ error: 'Store is already verified' });

  const pending = await db.get("SELECT id FROM verification_requests WHERE store_id = ? AND status = 'pending'", [req.params.id]);
  if (pending) return res.status(409).json({ error: 'You already have a pending verification request' });

  const { business_name, business_ein, business_phone, business_address, business_website, license_number, notes } = req.body;
  if (!business_name) return res.status(400).json({ error: 'Business name required' });

  const n = v => v ?? null;
  const result = await db.run(`
    INSERT INTO verification_requests (store_id, business_name, business_ein, business_phone, business_address, business_website, license_number, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id
  `, [req.params.id, business_name, n(business_ein), n(business_phone), n(business_address), n(business_website), n(license_number), n(notes)]);

  if (transporter) {
    const body = `New verification request submitted:\n\nStore: ${store.name} (ID: ${store.id})\nBusiness Name: ${business_name}\nEIN: ${business_ein || 'N/A'}\nPhone: ${business_phone || 'N/A'}\nAddress: ${business_address || 'N/A'}\nWebsite: ${business_website || 'N/A'}\nLicense: ${license_number || 'N/A'}\nNotes: ${notes || 'N/A'}\n\nReview at: https://cigarmapsclaude-production.up.railway.app/admin`;
    transporter.sendMail({ from: process.env.SMTP_USER, to: 'mason.obegi@gmail.com', subject: `[CigarBuddy] Verification Request: ${store.name}`, text: body }).catch(() => {});
  }

  res.json({ id: result.lastInsertRowid });
}));

router.get('/:id/verification-status', requireAuth, asyncRoute(async (req, res) => {
  const store = await db.get('SELECT id, verified FROM stores WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!store) return res.status(403).json({ error: 'Forbidden' });

  const latest = await db.get('SELECT * FROM verification_requests WHERE store_id = ? ORDER BY submitted_at DESC LIMIT 1', [req.params.id]);
  res.json({ verified: store.verified, request: latest || null });
}));

router.post('/:id/inventory-requests', requireAuth, asyncRoute(async (req, res) => {
  const { cigar_id, cigar_name_free, message } = req.body;
  if (!cigar_id && !cigar_name_free) return res.status(400).json({ error: 'Specify a cigar or enter a name' });

  const result = await db.run(`
    INSERT INTO inventory_requests (user_id, store_id, cigar_id, cigar_name_free, message)
    VALUES (?, ?, ?, ?, ?) RETURNING id
  `, [req.user.id, req.params.id, cigar_id || null, cigar_name_free || null, message || null]);

  res.json({ id: result.lastInsertRowid });
}));

router.get('/:id/inventory-requests', requireAuth, asyncRoute(async (req, res) => {
  const store = await db.get('SELECT id FROM stores WHERE id=? AND user_id=?', [req.params.id, req.user.id]);
  if (!store) return res.status(403).json({ error: 'Forbidden' });

  const requests = await db.all(`
    SELECT ir.*, u.name as user_name,
      c.brand as cigar_brand, c.name as cigar_name,
      COUNT(*) OVER (PARTITION BY ir.cigar_id) as request_count
    FROM inventory_requests ir
    JOIN users u ON u.id = ir.user_id
    LEFT JOIN cigars c ON c.id = ir.cigar_id
    WHERE ir.store_id = ?
    ORDER BY ir.created_at DESC
    LIMIT 100
  `, [req.params.id]);

  res.json(requests);
}));

router.patch('/:id/inventory-requests/:reqId/acknowledge', requireAuth, asyncRoute(async (req, res) => {
  const store = await db.get('SELECT id FROM stores WHERE id=? AND user_id=?', [req.params.id, req.user.id]);
  if (!store) return res.status(403).json({ error: 'Forbidden' });
  await db.run("UPDATE inventory_requests SET status='acknowledged' WHERE id=? AND store_id=?", [req.params.reqId, req.params.id]);
  res.json({ success: true });
}));

router.get('/:id/top-requests', asyncRoute(async (req, res) => {
  const rows = await db.all(`
    SELECT c.id, c.brand, c.name as cigar_name, COUNT(*) as request_count
    FROM inventory_requests ir
    JOIN cigars c ON c.id = ir.cigar_id
    WHERE ir.store_id = ? AND ir.cigar_id IS NOT NULL
    GROUP BY ir.cigar_id, c.id
    ORDER BY request_count DESC
    LIMIT 5
  `, [req.params.id]);
  res.json(rows);
}));

router.post('/:id/geocode', asyncRoute(async (req, res) => {
  const store = await db.get('SELECT * FROM stores WHERE id = ?', [req.params.id]);
  if (!store) return res.status(404).json({ error: 'Not found' });
  if (store.lat && store.lng) return res.json({ lat: store.lat, lng: store.lng });

  const coords = await geocode(store.address, store.city, store.state);
  if (coords) {
    await db.run('UPDATE stores SET lat=?, lng=? WHERE id=?', [coords.lat, coords.lng, store.id]);
    return res.json(coords);
  }
  res.status(404).json({ error: 'Could not geocode' });
}));

router.post('/admin/geocode-all', requireAuth, asyncRoute(async (req, res) => {
  if (req.user.account_type !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const stores = await db.all('SELECT * FROM stores WHERE lat IS NULL OR lat = 0', []);
  let done = 0;
  for (const s of stores) {
    const coords = await geocode(s.address, s.city, s.state);
    if (coords) {
      await db.run('UPDATE stores SET lat=?, lng=? WHERE id=?', [coords.lat, coords.lng, s.id]);
      done++;
    }
    await new Promise(r => setTimeout(r, 1100));
  }
  res.json({ geocoded: done, total: stores.length });
}));

module.exports = router;
