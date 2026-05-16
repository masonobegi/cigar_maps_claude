const router = require('express').Router();
const db = require('../database/db');
const https = require('https');
const { requireAuth, optionalAuth } = require('../middleware/auth');

// Geocode a store address via Nominatim (free, no key)
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

// List / search stores with rich filters
router.get('/', (req, res) => {
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

  const stores = db.prepare(`
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
  `).all(...params);

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
        const currentH = now.getHours();
        isOpen = currentH >= openH && currentH < closeH;
      }
    } else if (todayHours === 'Closed') {
      isOpen = false;
    }

    return {
      ...s,
      tags: s.tags ? JSON.parse(s.tags) : [],
      today_hours: todayHours || null,
      is_open: isOpen,
      avg_rating: +s.avg_rating.toFixed(1),
    };
  }).filter(s => open_now === '1' ? s.is_open === true : true);

  res.json(result);
});

// Get distinct cities that have stores
router.get('/cities', (req, res) => {
  const cities = db.prepare(`
    SELECT DISTINCT city, state, COUNT(*) as store_count
    FROM stores WHERE city IS NOT NULL AND city != ''
    GROUP BY city, state ORDER BY store_count DESC, city
  `).all();
  res.json(cities);
});

// Get store by id
router.get('/:id', optionalAuth, (req, res) => {
  const store = db.prepare('SELECT * FROM stores WHERE id = ?').get(req.params.id);
  if (!store) return res.status(404).json({ error: 'Store not found' });

  // Track view
  db.prepare('INSERT INTO store_views (store_id) VALUES (?)').run(store.id);

  let hours = {};
  try { hours = JSON.parse(store.hours || '{}'); } catch {}

  const inventoryCount = db.prepare('SELECT COUNT(*) as n FROM inventory WHERE store_id = ? AND in_stock = 1').get(store.id).n;

  const deals = db.prepare(`
    SELECT d.*, c.brand, c.name as cigar_name FROM deals d
    LEFT JOIN cigars c ON c.id = d.cigar_id
    WHERE d.store_id = ? AND (d.expires_at IS NULL OR d.expires_at > datetime('now'))
    ORDER BY d.created_at DESC
  `).all(store.id);

  const stats = db.prepare(`
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
  `).get(store.id);

  const recentRatings = db.prepare(`
    SELECT sr.*, u.name as user_name FROM store_ratings sr
    JOIN users u ON u.id = sr.user_id
    WHERE sr.store_id = ? ORDER BY sr.created_at DESC LIMIT 5
  `).all(store.id);

  const newArrivals = db.prepare(`
    SELECT i.*, c.brand, c.name as cigar_name, v.name as vitola_name
    FROM inventory i
    JOIN cigars c ON c.id = i.cigar_id
    JOIN vitolas v ON v.id = i.vitola_id
    WHERE i.store_id = ? AND i.is_new_arrival = 1 AND i.in_stock = 1
    ORDER BY i.updated_at DESC LIMIT 6
  `).all(store.id);

  let isFollowing = false;
  let followPrefs = null;
  if (req.user) {
    const follow = db.prepare('SELECT * FROM store_follows WHERE user_id = ? AND store_id = ?').get(req.user.id, store.id);
    isFollowing = !!follow;
    followPrefs = follow;
  }

  res.json({
    store: { ...store, hours, tags: store.tags ? JSON.parse(store.tags) : [] },
    inventory_count: inventoryCount,
    deals,
    stats: { ...stats, avg_rating: +stats.avg_rating.toFixed(1) },
    recent_ratings: recentRatings,
    new_arrivals: newArrivals,
    is_following: isFollowing,
    follow_prefs: followPrefs,
  });
});

// Get store inventory (public)
router.get('/:id/inventory', (req, res) => {
  const { page = 1, limit = 40, q, strength, is_new_arrival } = req.query;
  const offset = (page - 1) * limit;

  let where = ['i.store_id = ?', 'i.in_stock = 1'];
  const params = [req.params.id];

  if (q) {
    where.push('(c.brand LIKE ? OR c.name LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }
  if (strength) { where.push('c.strength = ?'); params.push(strength); }
  if (is_new_arrival === '1') { where.push('i.is_new_arrival = 1'); }

  const items = db.prepare(`
    SELECT i.*, c.brand, c.name as cigar_name, c.strength, c.wrapper, c.country, c.flavor_notes,
      v.name as vitola_name, v.length, v.ring_gauge, v.msrp
    FROM inventory i
    JOIN cigars c ON c.id = i.cigar_id
    JOIN vitolas v ON v.id = i.vitola_id
    WHERE ${where.join(' AND ')}
    ORDER BY i.is_featured DESC, i.is_new_arrival DESC, c.brand, c.name, v.ring_gauge
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  const total = db.prepare(`
    SELECT COUNT(*) as n FROM inventory i JOIN cigars c ON c.id = i.cigar_id WHERE ${where.join(' AND ')}
  `).get(...params).n;

  res.json({
    items: items.map(i => ({ ...i, flavor_notes: JSON.parse(i.flavor_notes || '[]') })),
    total, page: +page, pages: Math.ceil(total / limit)
  });
});

// Create store
router.post('/', requireAuth, (req, res) => {
  if (req.user.account_type !== 'store') return res.status(403).json({ error: 'Store accounts only' });
  const existing = db.prepare('SELECT id FROM stores WHERE user_id = ?').get(req.user.id);
  if (existing) return res.status(409).json({ error: 'Store already exists for this account' });

  const { name, description, address, city, state, zip, phone, website, hours,
    has_lounge, has_walk_in_humidor, tags } = req.body;
  if (!name || !city || !state) return res.status(400).json({ error: 'Name, city, and state required' });

  const n = v => v ?? null;
  const result = db.prepare(`
    INSERT INTO stores (user_id, name, description, address, city, state, zip, phone, website, hours, has_lounge, has_walk_in_humidor, tags, setup_complete)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(req.user.id, name, n(description), n(address), city, state, n(zip), n(phone), n(website),
    typeof hours === 'object' ? JSON.stringify(hours) : (hours || '{}'),
    has_lounge ? 1 : 0, has_walk_in_humidor ? 1 : 0,
    JSON.stringify(tags || []));

  res.json({ id: result.lastInsertRowid });
});

// Update store
router.put('/:id', requireAuth, (req, res) => {
  const store = db.prepare('SELECT * FROM stores WHERE id = ?').get(req.params.id);
  if (!store) return res.status(404).json({ error: 'Store not found' });
  if (store.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

  const { name, description, address, city, state, zip, phone, website, hours,
    has_lounge, has_walk_in_humidor, tags } = req.body;

  const n = v => v ?? null;
  db.prepare(`
    UPDATE stores SET name=?, description=?, address=?, city=?, state=?, zip=?, phone=?, website=?,
    hours=?, has_lounge=?, has_walk_in_humidor=?, tags=?, setup_complete=1 WHERE id=?
  `).run(name, n(description), n(address), city, state, n(zip), n(phone), n(website),
    typeof hours === 'object' ? JSON.stringify(hours) : (hours || '{}'),
    has_lounge ? 1 : 0, has_walk_in_humidor ? 1 : 0,
    JSON.stringify(tags || []), req.params.id);

  res.json({ success: true });
});

// --- Inventory Management (store owner) ---

router.get('/:id/manage-inventory', requireAuth, (req, res) => {
  const store = db.prepare('SELECT id FROM stores WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!store) return res.status(403).json({ error: 'Forbidden' });

  const { q } = req.query;
  let where = 'i.store_id = ?';
  const params = [req.params.id];
  if (q) { where += ' AND (c.brand LIKE ? OR c.name LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }

  const items = db.prepare(`
    SELECT i.*, c.brand, c.name as cigar_name, c.strength, c.country,
      v.name as vitola_name, v.length, v.ring_gauge, v.msrp
    FROM inventory i
    JOIN cigars c ON c.id = i.cigar_id
    JOIN vitolas v ON v.id = i.vitola_id
    WHERE ${where}
    ORDER BY i.in_stock DESC, c.brand, c.name, v.ring_gauge
  `).all(...params);

  const lowStock = items.filter(i => i.in_stock && i.quantity > 0 && i.quantity < 5).length;
  const outOfStock = items.filter(i => !i.in_stock || i.quantity === 0).length;

  res.json({ items, low_stock: lowStock, out_of_stock: outOfStock });
});

router.post('/:id/inventory', requireAuth, (req, res) => {
  const store = db.prepare('SELECT id FROM stores WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!store) return res.status(403).json({ error: 'Forbidden' });

  const { cigar_id, vitola_id, price, quantity, is_featured, is_new_arrival } = req.body;
  if (!cigar_id || !vitola_id || !price) return res.status(400).json({ error: 'cigar_id, vitola_id, price required' });

  const existing = db.prepare('SELECT id FROM inventory WHERE store_id = ? AND vitola_id = ?').get(req.params.id, vitola_id);
  if (existing) {
    db.prepare('UPDATE inventory SET price=?, quantity=?, in_stock=1, is_new_arrival=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
      .run(price, quantity || 0, is_new_arrival ? 1 : 0, existing.id);
    return res.json({ id: existing.id, updated: true });
  }

  const result = db.prepare(`
    INSERT INTO inventory (store_id, cigar_id, vitola_id, price, quantity, in_stock, is_featured, is_new_arrival)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
  `).run(req.params.id, cigar_id, vitola_id, price, quantity || 0, is_featured ? 1 : 0, is_new_arrival ? 1 : 0);

  res.json({ id: result.lastInsertRowid });
});

// Bulk add inventory (array of items)
router.post('/:id/inventory/bulk', requireAuth, (req, res) => {
  const store = db.prepare('SELECT id FROM stores WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!store) return res.status(403).json({ error: 'Forbidden' });

  const { items } = req.body;
  if (!Array.isArray(items)) return res.status(400).json({ error: 'items array required' });

  let added = 0, updated = 0;
  for (const item of items) {
    if (!item.cigar_id || !item.vitola_id || !item.price) continue;
    const existing = db.prepare('SELECT id FROM inventory WHERE store_id = ? AND vitola_id = ?').get(req.params.id, item.vitola_id);
    if (existing) {
      db.prepare('UPDATE inventory SET price=?, quantity=?, in_stock=1, updated_at=CURRENT_TIMESTAMP WHERE id=?')
        .run(item.price, item.quantity || 0, existing.id);
      updated++;
    } else {
      db.prepare('INSERT INTO inventory (store_id, cigar_id, vitola_id, price, quantity, in_stock) VALUES (?, ?, ?, ?, ?, 1)')
        .run(req.params.id, item.cigar_id, item.vitola_id, item.price, item.quantity || 0);
      added++;
    }
  }

  res.json({ added, updated });
});

router.put('/:id/inventory/:itemId', requireAuth, (req, res) => {
  const store = db.prepare('SELECT id FROM stores WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!store) return res.status(403).json({ error: 'Forbidden' });

  const { price, quantity, in_stock, is_featured, is_new_arrival } = req.body;
  db.prepare(`
    UPDATE inventory SET price=?, quantity=?, in_stock=?, is_featured=?, is_new_arrival=?, updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND store_id=?
  `).run(price, quantity, in_stock ? 1 : 0, is_featured ? 1 : 0, is_new_arrival ? 1 : 0, req.params.itemId, req.params.id);

  res.json({ success: true });
});

// Quick restock
router.patch('/:id/inventory/:itemId/restock', requireAuth, (req, res) => {
  const store = db.prepare('SELECT id FROM stores WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!store) return res.status(403).json({ error: 'Forbidden' });

  const { quantity } = req.body;
  db.prepare('UPDATE inventory SET quantity=?, in_stock=1, updated_at=CURRENT_TIMESTAMP WHERE id=? AND store_id=?')
    .run(quantity, req.params.itemId, req.params.id);

  res.json({ success: true });
});

router.delete('/:id/inventory/:itemId', requireAuth, (req, res) => {
  const store = db.prepare('SELECT id FROM stores WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!store) return res.status(403).json({ error: 'Forbidden' });
  db.prepare('DELETE FROM inventory WHERE id=? AND store_id=?').run(req.params.itemId, req.params.id);
  res.json({ success: true });
});

// --- Broadcast / Notifications ---

router.post('/:id/broadcast', requireAuth, (req, res) => {
  const store = db.prepare('SELECT id, name FROM stores WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!store) return res.status(403).json({ error: 'Forbidden' });

  const { title, message, type, cigar_id } = req.body;
  if (!title || !message) return res.status(400).json({ error: 'title and message required' });

  const validTypes = ['announcement', 'deal', 'new_arrival', 'event'];
  const notifType = validTypes.includes(type) ? type : 'announcement';

  const result = db.prepare(`
    INSERT INTO notifications (store_id, title, message, type, cigar_id) VALUES (?, ?, ?, ?, ?)
  `).run(req.params.id, title, message, notifType, cigar_id || null);

  const followerCount = db.prepare('SELECT COUNT(*) as n FROM store_follows WHERE store_id = ?').get(req.params.id).n;

  res.json({ id: result.lastInsertRowid, sent_to: followerCount });
});

// Get store's broadcast history
router.get('/:id/broadcasts', requireAuth, (req, res) => {
  const store = db.prepare('SELECT id FROM stores WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!store) return res.status(403).json({ error: 'Forbidden' });

  const broadcasts = db.prepare(`
    SELECT n.*, COUNT(nr.user_id) as read_count,
      (SELECT COUNT(*) FROM store_follows WHERE store_id = n.store_id) as total_followers
    FROM notifications n
    LEFT JOIN notification_reads nr ON nr.notification_id = n.id
    WHERE n.store_id = ?
    GROUP BY n.id
    ORDER BY n.created_at DESC LIMIT 30
  `).all(req.params.id);

  res.json(broadcasts);
});

// --- Analytics ---

router.get('/:id/analytics', requireAuth, (req, res) => {
  const store = db.prepare('SELECT id FROM stores WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!store) return res.status(403).json({ error: 'Forbidden' });

  const overview = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM store_follows WHERE store_id = ?) as followers,
      (SELECT COUNT(*) FROM store_views WHERE store_id = ? AND viewed_at > datetime('now', '-30 days')) as views_30d,
      (SELECT COUNT(*) FROM store_views WHERE store_id = ? AND viewed_at > datetime('now', '-7 days')) as views_7d,
      (SELECT COUNT(*) FROM inventory WHERE store_id = ? AND in_stock = 1) as items_in_stock,
      (SELECT COUNT(*) FROM inventory WHERE store_id = ? AND in_stock = 1 AND quantity < 5 AND quantity > 0) as low_stock,
      (SELECT COUNT(*) FROM inventory WHERE store_id = ? AND (in_stock = 0 OR quantity = 0)) as out_of_stock,
      (SELECT COUNT(*) FROM deals WHERE store_id = ? AND (expires_at IS NULL OR expires_at > datetime('now'))) as active_deals,
      (SELECT COUNT(*) FROM notifications WHERE store_id = ?) as total_broadcasts
  `).get(req.params.id, req.params.id, req.params.id, req.params.id, req.params.id, req.params.id, req.params.id, req.params.id);

  // Daily views for last 14 days
  const dailyViews = db.prepare(`
    SELECT DATE(viewed_at) as date, COUNT(*) as views
    FROM store_views WHERE store_id = ? AND viewed_at > datetime('now', '-14 days')
    GROUP BY DATE(viewed_at) ORDER BY date
  `).all(req.params.id);

  // Top cigars (by inventory views proxy = just list top featured)
  const topItems = db.prepare(`
    SELECT c.brand, c.name as cigar_name, v.name as vitola_name, i.price, i.quantity
    FROM inventory i JOIN cigars c ON c.id = i.cigar_id JOIN vitolas v ON v.id = i.vitola_id
    WHERE i.store_id = ? AND i.in_stock = 1
    ORDER BY i.is_featured DESC, i.quantity DESC LIMIT 5
  `).all(req.params.id);

  res.json({ overview, daily_views: dailyViews, top_items: topItems });
});

// --- Deals ---

router.post('/:id/deals', requireAuth, (req, res) => {
  const store = db.prepare('SELECT id FROM stores WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!store) return res.status(403).json({ error: 'Forbidden' });

  const { title, description, discount_percent, deal_price, cigar_id, expires_at } = req.body;
  if (!title) return res.status(400).json({ error: 'Title required' });

  const result = db.prepare(`
    INSERT INTO deals (store_id, title, description, discount_percent, deal_price, cigar_id, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(req.params.id, title, description, discount_percent || null, deal_price || null, cigar_id || null, expires_at || null);

  res.json({ id: result.lastInsertRowid });
});

router.delete('/:id/deals/:dealId', requireAuth, (req, res) => {
  const store = db.prepare('SELECT id FROM stores WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!store) return res.status(403).json({ error: 'Forbidden' });
  db.prepare('DELETE FROM deals WHERE id=? AND store_id=?').run(req.params.dealId, req.params.id);
  res.json({ success: true });
});

// --- Follow / Unfollow ---

router.post('/:id/follow', requireAuth, (req, res) => {
  const existing = db.prepare('SELECT 1 FROM store_follows WHERE user_id=? AND store_id=?').get(req.user.id, req.params.id);
  if (existing) {
    db.prepare('DELETE FROM store_follows WHERE user_id=? AND store_id=?').run(req.user.id, req.params.id);
    return res.json({ following: false });
  }
  db.prepare('INSERT INTO store_follows (user_id, store_id) VALUES (?, ?)').run(req.user.id, req.params.id);
  res.json({ following: true });
});

// Update follow notification preferences
router.put('/:id/follow-prefs', requireAuth, (req, res) => {
  const { notify_broadcasts, notify_deals, notify_new_arrivals } = req.body;
  db.prepare(`
    UPDATE store_follows SET notify_broadcasts=?, notify_deals=?, notify_new_arrivals=?
    WHERE user_id=? AND store_id=?
  `).run(notify_broadcasts ? 1 : 0, notify_deals ? 1 : 0, notify_new_arrivals ? 1 : 0, req.user.id, req.params.id);
  res.json({ success: true });
});

// --- Store Ratings ---

router.post('/:id/rate', requireAuth, (req, res) => {
  const { rating, comment } = req.body;
  if (!rating || rating < 1 || rating > 5) return res.status(400).json({ error: 'Rating must be 1-5' });

  try {
    db.prepare('INSERT OR REPLACE INTO store_ratings (user_id, store_id, rating, comment) VALUES (?, ?, ?, ?)')
      .run(req.user.id, req.params.id, rating, comment);
  } catch {
    db.prepare('UPDATE store_ratings SET rating=?, comment=? WHERE user_id=? AND store_id=?')
      .run(rating, comment, req.user.id, req.params.id);
  }
  res.json({ success: true });
});

// --- Verification Requests ---

router.post('/:id/verification-request', requireAuth, (req, res) => {
  const store = db.prepare('SELECT * FROM stores WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!store) return res.status(403).json({ error: 'Forbidden' });
  if (store.verified) return res.status(400).json({ error: 'Store is already verified' });

  const pending = db.prepare("SELECT id FROM verification_requests WHERE store_id = ? AND status = 'pending'").get(req.params.id);
  if (pending) return res.status(409).json({ error: 'You already have a pending verification request' });

  const { business_name, business_ein, business_phone, business_address, business_website, license_number, notes } = req.body;
  if (!business_name) return res.status(400).json({ error: 'Business name required' });

  const n = v => v ?? null;
  const result = db.prepare(`
    INSERT INTO verification_requests (store_id, business_name, business_ein, business_phone, business_address, business_website, license_number, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(req.params.id, business_name, n(business_ein), n(business_phone), n(business_address), n(business_website), n(license_number), n(notes));

  res.json({ id: result.lastInsertRowid });
});

router.get('/:id/verification-status', requireAuth, (req, res) => {
  const store = db.prepare('SELECT id, verified FROM stores WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!store) return res.status(403).json({ error: 'Forbidden' });

  const latest = db.prepare('SELECT * FROM verification_requests WHERE store_id = ? ORDER BY submitted_at DESC LIMIT 1').get(req.params.id);
  res.json({ verified: store.verified, request: latest || null });
});

// --- Inventory Requests ---

// Submit an inventory request (user → store)
router.post('/:id/inventory-requests', requireAuth, (req, res) => {
  const { cigar_id, cigar_name_free, message } = req.body;
  if (!cigar_id && !cigar_name_free) return res.status(400).json({ error: 'Specify a cigar or enter a name' });

  const result = db.prepare(`
    INSERT INTO inventory_requests (user_id, store_id, cigar_id, cigar_name_free, message)
    VALUES (?, ?, ?, ?, ?)
  `).run(req.user.id, req.params.id, cigar_id || null, cigar_name_free || null, message || null);

  res.json({ id: result.lastInsertRowid });
});

// Get inventory requests for a store (owner only)
router.get('/:id/inventory-requests', requireAuth, (req, res) => {
  const store = db.prepare('SELECT id FROM stores WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!store) return res.status(403).json({ error: 'Forbidden' });

  const requests = db.prepare(`
    SELECT ir.*, u.name as user_name,
      c.brand as cigar_brand, c.name as cigar_name,
      COUNT(*) OVER (PARTITION BY ir.cigar_id) as request_count
    FROM inventory_requests ir
    JOIN users u ON u.id = ir.user_id
    LEFT JOIN cigars c ON c.id = ir.cigar_id
    WHERE ir.store_id = ?
    ORDER BY ir.created_at DESC
    LIMIT 100
  `).all(req.params.id);

  res.json(requests);
});

// Acknowledge an inventory request
router.patch('/:id/inventory-requests/:reqId/acknowledge', requireAuth, (req, res) => {
  const store = db.prepare('SELECT id FROM stores WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!store) return res.status(403).json({ error: 'Forbidden' });
  db.prepare("UPDATE inventory_requests SET status='acknowledged' WHERE id=? AND store_id=?").run(req.params.reqId, req.params.id);
  res.json({ success: true });
});

// Public: top requested cigars for a store (shows demand)
router.get('/:id/top-requests', (req, res) => {
  const rows = db.prepare(`
    SELECT c.id, c.brand, c.name as cigar_name, COUNT(*) as request_count
    FROM inventory_requests ir
    JOIN cigars c ON c.id = ir.cigar_id
    WHERE ir.store_id = ? AND ir.cigar_id IS NOT NULL
    GROUP BY ir.cigar_id
    ORDER BY request_count DESC
    LIMIT 5
  `).all(req.params.id);
  res.json(rows);
});

// Geocode a store (called lazily when the map needs coordinates)
router.post('/:id/geocode', async (req, res) => {
  const store = db.prepare('SELECT * FROM stores WHERE id = ?').get(req.params.id);
  if (!store) return res.status(404).json({ error: 'Not found' });

  // Return cached coords if we have them
  if (store.lat && store.lng) return res.json({ lat: store.lat, lng: store.lng });

  const coords = await geocode(store.address, store.city, store.state);
  if (coords) {
    db.prepare('UPDATE stores SET lat=?, lng=? WHERE id=?').run(coords.lat, coords.lng, store.id);
    return res.json(coords);
  }
  res.status(404).json({ error: 'Could not geocode' });
});

// Bulk geocode all stores missing coordinates (admin use)
router.post('/admin/geocode-all', requireAuth, async (req, res) => {
  if (req.user.account_type !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const stores = db.prepare('SELECT * FROM stores WHERE lat IS NULL OR lat = 0').all();
  let done = 0;
  for (const s of stores) {
    const coords = await geocode(s.address, s.city, s.state);
    if (coords) {
      db.prepare('UPDATE stores SET lat=?, lng=? WHERE id=?').run(coords.lat, coords.lng, s.id);
      done++;
    }
    await new Promise(r => setTimeout(r, 1100)); // Nominatim rate limit: 1 req/sec
  }
  res.json({ geocoded: done, total: stores.length });
});

module.exports = router;
