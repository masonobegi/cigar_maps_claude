const router = require('express').Router();
const db = require('../database/db');
const https = require('https');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { asyncRoute } = db;
const { createInventorySheet } = require('../utils/googleSheets');
const { sendMail } = require('../utils/email');

const APP_URL = process.env.APP_URL || 'https://cigarmapsclaude-production.up.railway.app';

// Columns that exist for operations, not for the public: sheet URLs are
// effectively capability links, and the menu/import bookkeeping is noise.
const PRIVATE_STORE_FIELDS = ['sheet_url', 'sheet_last_synced', 'menu_url', 'menu_platform', 'menu_status',
  'menu_last_synced', 'menu_checked_at', 'menu_opt_out', 'source_id', 'osm_id', 'staff_edited',
  'stripe_customer_id', 'stripe_subscription_id', 'plan_status', 'plan_renews_at'];

function publicStore(store, privileged = false) {
  if (privileged) return store;
  const out = { ...store };
  for (const f of PRIVATE_STORE_FIELDS) delete out[f];
  return out;
}

function haversine(lat1, lng1, lat2, lng2) {
  const R = 3958.8;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

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
  const { q, city, state, has_lounge, has_walk_in_humidor, open_now, store_type, bbox, claimed, has_inventory } = req.query;
  const userLat = parseFloat(req.query.lat);
  const userLng = parseFloat(req.query.lng);
  const radiusMi = parseFloat(req.query.radius) || 50;
  const limit = Math.min(1500, Math.max(1, parseInt(req.query.limit) || 300));
  let where = ['s.visible = 1'];
  const params = [];

  if (q) {
    where.push('(s.name ILIKE ? OR s.description ILIKE ? OR s.city ILIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (city) { where.push('s.city ILIKE ?'); params.push(`%${city}%`); }
  if (state) { where.push('s.state = ?'); params.push(String(state).toUpperCase()); }
  if (has_lounge === '1') { where.push('s.has_lounge = 1'); }
  if (has_walk_in_humidor === '1') { where.push('s.has_walk_in_humidor = 1'); }
  // store_type accepts a comma-separated list ("cigar_shop,cigar_lounge") so the
  // type chips can multi-select.
  if (store_type) {
    const types = String(store_type).split(',').map(t => t.trim()).filter(Boolean);
    if (types.length) {
      where.push(`s.store_type IN (${types.map(() => '?').join(',')})`);
      params.push(...types);
    }
  }
  if (claimed === '1') { where.push('s.claimed = 1'); }
  // EXISTS rather than a HAVING on the aggregate: it short-circuits on the
  // first in-stock row instead of counting every join row per store.
  if (has_inventory === '1') {
    where.push('EXISTS (SELECT 1 FROM inventory inv WHERE inv.store_id = s.id AND inv.in_stock = 1)');
  }

  // Spatial prefilter so we never scan the whole directory: an explicit map
  // viewport (bbox=minLng,minLat,maxLng,maxLat) or a box around the radius.
  if (bbox) {
    const [minLng, minLat, maxLng, maxLat] = String(bbox).split(',').map(Number);
    if ([minLng, minLat, maxLng, maxLat].every(Number.isFinite)) {
      where.push('s.lat BETWEEN ? AND ? AND s.lng BETWEEN ? AND ?');
      params.push(minLat, maxLat, minLng, maxLng);
    }
  } else if (!isNaN(userLat) && !isNaN(userLng)) {
    const dLat = radiusMi / 69;
    const dLng = radiusMi / (69 * Math.max(0.2, Math.cos(userLat * Math.PI / 180)));
    where.push('s.lat BETWEEN ? AND ? AND s.lng BETWEEN ? AND ?');
    params.push(userLat - dLat, userLat + dLat, userLng - dLng, userLng + dLng);
  }

  const stores = await db.all(`
    SELECT s.*,
      COUNT(DISTINCT i.id) as inventory_count,
      COUNT(DISTINCT sf.user_id) as follower_count,
      COALESCE(AVG(sr.rating), 0) as avg_rating,
      COUNT(DISTINCT sr.id) as rating_count,
      -- Paid placement. Shops buy the top of the list, never the right to be
      -- listed at all, so this only reorders results that already matched.
      (CASE WHEN s.featured_until IS NOT NULL AND s.featured_until > NOW()
            THEN (CASE WHEN s.plan = 'partner' THEN 2 ELSE 1 END) ELSE 0 END) as is_featured
    FROM stores s
    LEFT JOIN inventory i ON i.store_id = s.id AND i.in_stock = 1
    LEFT JOIN store_follows sf ON sf.store_id = s.id
    LEFT JOIN store_ratings sr ON sr.store_id = s.id
    WHERE ${where.join(' AND ')}
    GROUP BY s.id
    ORDER BY is_featured DESC, s.claimed DESC, s.verified DESC, follower_count DESC, inventory_count DESC, s.confidence DESC, s.name
    LIMIT ?
  `, [...params, limit]);

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
        // Lounges routinely close after midnight ("11am-2am"), which reads as
        // a close hour at or before the open hour.
        isOpen = closeH <= openH
          ? (now.getHours() >= openH || now.getHours() < closeH)
          : (now.getHours() >= openH && now.getHours() < closeH);
      }
    } else if (todayHours === 'Closed') {
      isOpen = false;
    }
    return { ...publicStore(s), tags: s.tags ? JSON.parse(s.tags) : [], today_hours: todayHours || null, is_open: isOpen, avg_rating: +parseFloat(s.avg_rating).toFixed(1) };
  }).filter(s => open_now === '1' ? s.is_open === true : true);

  if (!isNaN(userLat) && !isNaN(userLng)) {
    const withDist = result.map(s => ({
      ...s,
      distance_mi: (s.lat && s.lng) ? Math.round(haversine(userLat, userLng, s.lat, s.lng) * 10) / 10 : null,
    }));
    const inRange = withDist.filter(s => s.distance_mi === null || s.distance_mi <= radiusMi);
    inRange.sort((a, b) => {
      if (a.distance_mi === null && b.distance_mi === null) return 0;
      if (a.distance_mi === null) return 1;
      if (b.distance_mi === null) return -1;
      return a.distance_mi - b.distance_mi;
    });
    return res.json(inRange);
  }

  res.json(result);
}));

router.get('/cities', asyncRoute(async (req, res) => {
  const cities = await db.all(`
    SELECT city, state, COUNT(*) as store_count, SUM(claimed) as claimed_count
    FROM stores WHERE city IS NOT NULL AND city != '' AND visible = 1
    GROUP BY city, state ORDER BY claimed_count DESC, store_count DESC, city
    LIMIT 40
  `, []);
  res.json(cities);
}));

router.get('/:id', optionalAuth, asyncRoute(async (req, res) => {
  const store = await db.get('SELECT * FROM stores WHERE id = ?', [req.params.id]);
  if (!store) return res.status(404).json({ error: 'Store not found' });

  // A listing staff hid (junk, closed, not a cigar shop) is gone for the
  // public. Its owner and staff can still open it to fix or review it.
  const isStaff = req.user && ['admin', 'staff'].includes(req.user.account_type);
  const isOwner = req.user && store.user_id === req.user.id;
  if (!store.visible && !isStaff && !isOwner) return res.status(404).json({ error: 'Store not found' });

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

  let myClaim = null;
  if (req.user && !store.claimed) {
    myClaim = await db.get(
      'SELECT id, status, method, created_at FROM store_claims WHERE store_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 1',
      [store.id, req.user.id]
    );
  }

  res.json({
    store: { ...publicStore(store, isOwner || isStaff), hours, tags: store.tags ? JSON.parse(store.tags) : [] },
    inventory_count: inventoryCount,
    deals,
    stats: { ...stats, avg_rating: +parseFloat(stats.avg_rating).toFixed(1) },
    recent_ratings: recentRatings,
    new_arrivals: newArrivals,
    is_following: isFollowing,
    follow_prefs: followPrefs,
    my_claim: myClaim,
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
    INSERT INTO stores (user_id, name, description, address, city, state, zip, phone, website, hours, has_lounge, has_walk_in_humidor, tags, setup_complete,
      claimed, claimed_at, source, visible, confidence)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, NOW(), 'owner', 1, 1) RETURNING id
  `, [req.user.id, name, n(description), n(address), city, state, n(zip), n(phone), n(website),
    typeof hours === 'object' ? JSON.stringify(hours) : (hours || '{}'),
    has_lounge ? 1 : 0, has_walk_in_humidor ? 1 : 0, JSON.stringify(tags || [])]);

  const storeId = result.lastInsertRowid;

  // Auto-create Google Sheet for inventory sync (non-blocking — don't fail store creation if this errors)
  if (process.env.GOOGLE_SERVICE_ACCOUNT) {
    createInventorySheet(req.user.email, name)
      .then(sheetUrl => db.run('UPDATE stores SET sheet_url = ? WHERE id = ?', [sheetUrl, storeId]))
      .catch(err => console.error('[sheets] Failed to create inventory sheet for store', storeId, err.message));
  }

  res.json({ id: storeId });
}));

router.put('/:id', requireAuth, asyncRoute(async (req, res) => {
  const store = await db.get('SELECT * FROM stores WHERE id = ?', [req.params.id]);
  if (!store) return res.status(404).json({ error: 'Store not found' });
  if (store.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

  const { name, description, address, city, state, zip, phone, website, hours, has_lounge, has_walk_in_humidor, tags, sheet_url } = req.body;
  const n = v => v ?? null;
  await db.run(`
    UPDATE stores SET name=?, description=?, address=?, city=?, state=?, zip=?, phone=?, website=?,
    hours=?, has_lounge=?, has_walk_in_humidor=?, tags=?, sheet_url=?, setup_complete=1 WHERE id=?
  `, [name, n(description), n(address), city, state, n(zip), n(phone), n(website),
    typeof hours === 'object' ? JSON.stringify(hours) : (hours || '{}'),
    has_lounge ? 1 : 0, has_walk_in_humidor ? 1 : 0, JSON.stringify(tags || []), n(sheet_url), req.params.id]);

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

  // Notify cigar followers who want in-stock alerts
  const cigarRow = await db.get('SELECT brand, name FROM cigars WHERE id = ?', [cigar_id]);
  const cigarFollowers = await db.all(`
    SELECT u.email FROM cigar_follows cf
    JOIN users u ON u.id = cf.user_id
    WHERE cf.cigar_id = ? AND cf.notify_in_stock = 1 AND u.email IS NOT NULL
  `, [cigar_id]);
  if (cigarRow && cigarFollowers.length > 0) {
    const cigarUrl = `${APP_URL}/cigars/${cigar_id}`;
    for (const f of cigarFollowers) {
      sendMail({
        to: f.email,
        subject: `${cigarRow.brand} ${cigarRow.name} is now in stock`,
        text: `${cigarRow.brand} ${cigarRow.name} is now available at a nearby store.\n\n${cigarUrl}`,
        html: `<p><strong>${cigarRow.brand} ${cigarRow.name}</strong> is now available at a store near you.</p><p><a href="${cigarUrl}">View cigar →</a></p>`,
      }).catch(() => {});
    }
  }

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
  const storeRow = await db.get('SELECT id, name FROM stores WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!storeRow) return res.status(403).json({ error: 'Forbidden' });

  const { title, description, discount_percent, deal_price, cigar_id, expires_at } = req.body;
  if (!title) return res.status(400).json({ error: 'Title required' });

  const result = await db.run(`
    INSERT INTO deals (store_id, title, description, discount_percent, deal_price, cigar_id, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id
  `, [req.params.id, title, description, discount_percent || null, deal_price || null, cigar_id || null, expires_at || null]);

  // Insert in-app notification
  await db.pool.query(
    `INSERT INTO notifications (store_id, title, message, type) VALUES ($1, $2, $3, 'deal')`,
    [req.params.id, `New deal at ${storeRow.name}`, `${title}${description ? ' — ' + description.slice(0, 80) : ''}`]
  );

  // Email followers who have notify_deals on
  const followers = await db.all(`
    SELECT u.email, u.name FROM store_follows sf
    JOIN users u ON u.id = sf.user_id
    WHERE sf.store_id = ? AND sf.notify_deals = 1 AND u.email IS NOT NULL
  `, [req.params.id]);

  const storeUrl = `${APP_URL}/stores/${req.params.id}?tab=deals`;
  for (const f of followers) {
    sendMail({
      to: f.email,
      subject: `New deal at ${storeRow.name}: ${title}`,
      text: [
        `${storeRow.name} just posted a new deal:`,
        ``,
        title,
        description ? description : '',
        discount_percent ? `-${discount_percent}% off` : deal_price ? `$${deal_price}` : '',
        expires_at ? `Expires: ${new Date(expires_at).toLocaleDateString()}` : '',
        ``,
        `View deal: ${storeUrl}`,
        ``,
        `— CigarBuddy`,
      ].filter(Boolean).join('\n'),
    }).catch(() => {});
  }

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

  sendMail({
    to: 'mason.obegi@gmail.com',
    subject: `[CigarBuddy] Verification Request: ${store.name}`,
    text: `New verification request submitted:\n\nStore: ${store.name} (ID: ${store.id})\nBusiness Name: ${business_name}\nEIN: ${business_ein || 'N/A'}\nPhone: ${business_phone || 'N/A'}\nAddress: ${business_address || 'N/A'}\nWebsite: ${business_website || 'N/A'}\nLicense: ${license_number || 'N/A'}\nNotes: ${notes || 'N/A'}\n\nReview at: ${APP_URL}/admin`,
  }).catch(() => {});

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

const { syncSheet } = require('../utils/sheetSync');

router.post('/:id/sync-sheet', requireAuth, asyncRoute(async (req, res) => {
  const store = await db.get('SELECT * FROM stores WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!store) return res.status(403).json({ error: 'Forbidden' });
  if (!store.sheet_url) return res.status(400).json({ error: 'No sheet URL configured' });
  const result = await syncSheet(req.params.id, store.sheet_url);
  res.json(result);
}));

// ── Claiming an unclaimed listing ───────────────────────────────────────────
// Listings imported from OpenStreetMap have no owner. A retailer account can
// claim one. If they can receive email at the store's own website domain we
// verify instantly with a 6-digit code; otherwise the claim waits for admin
// review (with whatever proof they typed in the message).

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { approveClaim, emailMatchesWebsite } = require('../utils/claims');

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'mason.obegi@gmail.com';

// A claim hands over control of a listing, so the two endpoints that can be
// guessed or spammed get their own limits on top of the global API limiter.
const claimLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many claim attempts. Try again in an hour.' },
});
const reportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many reports from this connection. Try again later.' },
});

const CODE_RESEND_MS = 2 * 60 * 1000;   // between verification emails for one claim
const MAX_CODE_ATTEMPTS = 5;            // wrong guesses before the code is burned

router.post('/:id/claim', requireAuth, claimLimiter, asyncRoute(async (req, res) => {
  if (req.user.account_type !== 'store') {
    return res.status(403).json({ error: 'Only retailer accounts can claim a store. Register a retailer account to continue.' });
  }
  const store = await db.get('SELECT * FROM stores WHERE id = ?', [req.params.id]);
  if (!store) return res.status(404).json({ error: 'Store not found' });
  if (store.claimed || store.user_id) return res.status(409).json({ error: 'This store has already been claimed' });

  const mine = await db.get('SELECT id, name FROM stores WHERE user_id = ?', [req.user.id]);
  if (mine) return res.status(409).json({ error: `Your account already manages ${mine.name}. One store per account for now.` });

  const pending = await db.get("SELECT * FROM store_claims WHERE store_id = ? AND user_id = ? AND status = 'pending'", [store.id, req.user.id]);
  const { contact_email, contact_phone, message } = req.body || {};
  const email = (contact_email || req.user.email || '').trim().toLowerCase();

  const canEmailVerify = !!process.env.SMTP_USER && emailMatchesWebsite(email, store.website);
  const method = canEmailVerify ? 'email' : 'manual';

  // Don't let a resend loop mail the shop's inbox repeatedly: within the
  // cooldown, keep the code that is already in flight.
  const recentlySent = pending && pending.code_sent_at && (Date.now() - new Date(pending.code_sent_at).getTime()) < CODE_RESEND_MS;
  const sendCode = canEmailVerify && !recentlySent;

  let code = null, codeHash = null, expires = null;
  if (sendCode) {
    code = String(crypto.randomInt(100000, 999999));
    codeHash = bcrypt.hashSync(code, 8);
    expires = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  }

  let claimId;
  if (pending) {
    if (sendCode) {
      await db.run(
        'UPDATE store_claims SET method = ?, contact_email = ?, contact_phone = ?, message = ?, code_hash = ?, code_expires_at = ?, code_sent_at = NOW(), attempts = 0 WHERE id = ?',
        [method, email, contact_phone || null, message || null, codeHash, expires, pending.id]);
    } else {
      await db.run(
        'UPDATE store_claims SET method = ?, contact_email = ?, contact_phone = ?, message = ? WHERE id = ?',
        [method, email, contact_phone || null, message || null, pending.id]);
    }
    claimId = pending.id;
  } else {
    const r = await db.run(`
      INSERT INTO store_claims (store_id, user_id, method, contact_email, contact_phone, message, code_hash, code_expires_at, code_sent_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${sendCode ? 'NOW()' : 'NULL'}) RETURNING id
    `, [store.id, req.user.id, method, email, contact_phone || null, message || null, codeHash, expires]);
    claimId = r.lastInsertRowid;
  }

  if (sendCode) {
    const sent = await sendMail({
      to: email,
      subject: `Your CigarBuddy verification code: ${code}`,
      text: `Enter this code to claim ${store.name} on CigarBuddy: ${code}\n\nIt expires in 30 minutes. If you did not request this, ignore this email.`,
      html: `<p>Enter this code to claim <strong>${store.name}</strong> on CigarBuddy:</p><p style="font-size:28px;letter-spacing:6px"><strong>${code}</strong></p><p>It expires in 30 minutes.</p>`,
    });
    // Delivery failed, so fall back to staff review rather than telling the
    // retailer to look for an email that will never arrive.
    if (sent === false) {
      await db.run("UPDATE store_claims SET method = 'manual', code_hash = NULL, code_expires_at = NULL WHERE id = ?", [claimId]);
      notifyAdminOfClaim(store, req.user, email, contact_phone, message);
      return res.json({ id: claimId, method: 'manual', status: 'pending', email_hint: null });
    }
  } else if (canEmailVerify) {
    // Cooldown: the previous code is still valid.
    return res.json({ id: claimId, method, status: 'code_sent', resent: false, email_hint: maskEmail(email) });
  } else {
    notifyAdminOfClaim(store, req.user, email, contact_phone, message);
  }

  res.json({ id: claimId, method, status: canEmailVerify ? 'code_sent' : 'pending', email_hint: canEmailVerify ? maskEmail(email) : null });
}));

function maskEmail(email) {
  return String(email || '').replace(/^(.).*(@.*)$/, '$1***$2');
}

function notifyAdminOfClaim(store, user, email, phone, message) {
  sendMail({
    to: ADMIN_EMAIL,
    subject: `[CigarBuddy] Store claim: ${store.name}`,
    text: `${user.name} <${user.email}> wants to claim ${store.name} (store #${store.id}, ${store.city || ''} ${store.state || ''}).\n\nContact email: ${email}\nPhone: ${phone || 'n/a'}\nMessage: ${message || 'n/a'}\n\nReview at ${APP_URL}/admin`,
  }).catch(() => {});
}

router.post('/:id/claim/verify', requireAuth, claimLimiter, asyncRoute(async (req, res) => {
  const { code } = req.body || {};
  const claim = await db.get(
    "SELECT * FROM store_claims WHERE store_id = ? AND user_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1",
    [req.params.id, req.user.id]);
  if (!claim || !claim.code_hash) return res.status(404).json({ error: 'No pending email verification for this store' });
  if (claim.code_expires_at && new Date(claim.code_expires_at) < new Date()) return res.status(410).json({ error: 'Code expired. Request a new one.' });
  if ((claim.attempts || 0) >= MAX_CODE_ATTEMPTS) {
    return res.status(429).json({ error: 'Too many incorrect codes. Request a new one.' });
  }
  if (!code || !bcrypt.compareSync(String(code).trim(), claim.code_hash)) {
    const attempts = (claim.attempts || 0) + 1;
    // Burn the code once the budget is spent so a guesser cannot keep going.
    if (attempts >= MAX_CODE_ATTEMPTS) {
      await db.run('UPDATE store_claims SET attempts = ?, code_hash = NULL, code_expires_at = NULL WHERE id = ?', [attempts, claim.id]);
      return res.status(429).json({ error: 'Too many incorrect codes. Request a new one.' });
    }
    await db.run('UPDATE store_claims SET attempts = ? WHERE id = ?', [attempts, claim.id]);
    return res.status(400).json({ error: `Incorrect code. ${MAX_CODE_ATTEMPTS - attempts} attempts left.` });
  }

  const store = await approveClaim(claim.id, { verify: false, adminNotes: 'Verified by email code' });

  if (process.env.GOOGLE_SERVICE_ACCOUNT && !store.sheet_url) {
    createInventorySheet(req.user.email, store.name)
      .then(url => db.run('UPDATE stores SET sheet_url = ? WHERE id = ?', [url, store.id]))
      .catch(err => console.error('[sheets] Failed to create sheet on claim:', err.message));
  }

  res.json({ success: true, store: { ...store, hours: safeJson(store.hours, {}), tags: safeJson(store.tags, []) } });
}));

router.get('/:id/claim-status', requireAuth, asyncRoute(async (req, res) => {
  const claim = await db.get(
    'SELECT id, status, method, contact_email, created_at, reviewed_at, admin_notes FROM store_claims WHERE store_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 1',
    [req.params.id, req.user.id]);
  res.json({ claim: claim || null });
}));

router.post('/:id/report', optionalAuth, reportLimiter, asyncRoute(async (req, res) => {
  const { reason, details } = req.body || {};
  const allowed = ['closed', 'not_cigar_shop', 'wrong_location', 'wrong_info', 'duplicate', 'other'];
  if (!allowed.includes(reason)) return res.status(400).json({ error: 'Invalid reason' });
  const store = await db.get('SELECT id, name FROM stores WHERE id = ?', [req.params.id]);
  if (!store) return res.status(404).json({ error: 'Store not found' });

  // One open report per person (or per reason when anonymous) keeps the queue
  // readable and stops a single visitor inflating a store's report count.
  const dupe = req.user
    ? await db.get("SELECT id FROM store_reports WHERE store_id = ? AND user_id = ? AND status = 'open'", [store.id, req.user.id])
    : await db.get("SELECT id FROM store_reports WHERE store_id = ? AND user_id IS NULL AND reason = ? AND status = 'open' AND created_at > NOW() - INTERVAL '24 hours'", [store.id, reason]);
  if (dupe) return res.json({ success: true, duplicate: true });

  await db.run('INSERT INTO store_reports (store_id, user_id, reason, details) VALUES (?, ?, ?, ?)',
    [store.id, req.user?.id || null, reason, (details || '').slice(0, 1000) || null]);
  res.json({ success: true });
}));

function safeJson(v, fallback) {
  if (v && typeof v === 'object') return v;
  try { return JSON.parse(v || ''); } catch { return fallback; }
}

module.exports = router;
