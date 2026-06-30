const router = require('express').Router();
const db = require('../database/db');
const { requireAuth } = require('../middleware/auth');
const { asyncRoute } = db;

function requireAdmin(req, res, next) {
  if (!['admin', 'staff'].includes(req.user.account_type)) return res.status(403).json({ error: 'Staff only' });
  next();
}

router.get('/stats', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const stats = await db.get(`
    SELECT
      (SELECT COUNT(*) FROM users WHERE account_type = 'user') as total_users,
      (SELECT COUNT(*) FROM users WHERE account_type = 'store') as total_stores,
      (SELECT COUNT(*) FROM stores WHERE verified = 1) as verified_stores,
      (SELECT COUNT(*) FROM stores WHERE verified = 0) as unverified_stores,
      (SELECT COUNT(*) FROM reviews) as total_reviews,
      (SELECT COUNT(*) FROM cigars) as total_cigars,
      (SELECT COUNT(*) FROM inventory WHERE in_stock = 1) as total_inventory,
      (SELECT COUNT(*) FROM smoke_list WHERE status = 'pending') as smoke_list_pending,
      (SELECT COUNT(*) FROM verification_requests WHERE status = 'pending') as pending_verifications,
      (SELECT COUNT(*) FROM store_follows) as total_follows,
      (SELECT COUNT(*) FROM notifications) as total_broadcasts
  `, []);

  const recentUsers = await db.all(`
    SELECT id, name, email, account_type, created_at FROM users ORDER BY created_at DESC LIMIT 10
  `, []);

  const recentReviews = await db.all(`
    SELECT r.id, r.rating, r.created_at, u.name as user_name, c.brand, c.name as cigar_name
    FROM reviews r JOIN users u ON u.id = r.user_id JOIN cigars c ON c.id = r.cigar_id
    ORDER BY r.created_at DESC LIMIT 10
  `, []);

  res.json({ stats, recent_users: recentUsers, recent_reviews: recentReviews });
}));

router.get('/verifications', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const { status } = req.query;
  let where = '1=1';
  const params = [];
  if (status) { where = 'vr.status = ?'; params.push(status); }

  const requests = await db.all(`
    SELECT vr.*, s.name as store_name, s.city, s.state, s.verified as store_verified,
      u.email as owner_email, u.name as owner_name
    FROM verification_requests vr
    JOIN stores s ON s.id = vr.store_id
    JOIN users u ON u.id = s.user_id
    WHERE ${where}
    ORDER BY CASE vr.status WHEN 'pending' THEN 1 WHEN 'approved' THEN 2 WHEN 'rejected' THEN 3 END,
             vr.submitted_at DESC
  `, params);

  res.json(requests);
}));

router.post('/verifications/:id/approve', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const { admin_notes } = req.body;
  const vr = await db.get('SELECT * FROM verification_requests WHERE id = ?', [req.params.id]);
  if (!vr) return res.status(404).json({ error: 'Not found' });

  await db.run("UPDATE verification_requests SET status='approved', admin_notes=?, reviewed_at=CURRENT_TIMESTAMP WHERE id=?",
    [admin_notes || null, req.params.id]);
  await db.run('UPDATE stores SET verified=1 WHERE id=?', [vr.store_id]);
  res.json({ success: true });
}));

router.post('/verifications/:id/reject', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const { admin_notes } = req.body;
  const vr = await db.get('SELECT * FROM verification_requests WHERE id = ?', [req.params.id]);
  if (!vr) return res.status(404).json({ error: 'Not found' });

  await db.run("UPDATE verification_requests SET status='rejected', admin_notes=?, reviewed_at=CURRENT_TIMESTAMP WHERE id=?",
    [admin_notes || 'Verification rejected by admin.', req.params.id]);
  res.json({ success: true });
}));

router.get('/stores', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const stores = await db.all(`
    SELECT s.*, u.email as owner_email,
      COUNT(DISTINCT i.id) as inventory_count,
      COUNT(DISTINCT sf.user_id) as followers,
      vr.status as verification_status, vr.submitted_at as verif_submitted_at
    FROM stores s JOIN users u ON u.id = s.user_id
    LEFT JOIN inventory i ON i.store_id = s.id
    LEFT JOIN store_follows sf ON sf.store_id = s.id
    LEFT JOIN verification_requests vr ON vr.store_id = s.id AND vr.id = (
      SELECT id FROM verification_requests WHERE store_id = s.id ORDER BY submitted_at DESC LIMIT 1
    )
    GROUP BY s.id, u.id, vr.id, vr.status, vr.submitted_at
    ORDER BY s.created_at DESC
  `, []);
  res.json(stores);
}));

router.patch('/stores/:id/verified', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const { verified } = req.body;
  await db.run('UPDATE stores SET verified=? WHERE id=?', [verified ? 1 : 0, req.params.id]);
  res.json({ success: true });
}));

router.get('/users', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const users = await db.all(`
    SELECT id, name, email, account_type, location_city, location_state, created_at FROM users ORDER BY created_at DESC
  `, []);
  res.json(users);
}));

// ── Cigar catalog management ────────────────────────────────────────────────
// Safe live-migration: all edits are UPDATE in place. IDs never change, so
// every inventory / review / humidor / follow row stays correctly linked.

router.get('/cigars', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const cigars = await db.all(`
    SELECT c.id, c.brand, c.name, c.country, c.wrapper, c.binder, c.filler,
           c.strength, c.flavor_notes, c.description, c.year_introduced,
           COUNT(DISTINCT i.id)     AS inventory_count,
           COUNT(DISTINCT r.id)     AS review_count,
           COUNT(DISTINCT cf.user_id) AS follow_count,
           COUNT(DISTINCT v.id)     AS vitola_count
    FROM cigars c
    LEFT JOIN inventory i      ON i.cigar_id  = c.id
    LEFT JOIN reviews r        ON r.cigar_id  = c.id
    LEFT JOIN cigar_follows cf ON cf.cigar_id = c.id
    LEFT JOIN vitolas v        ON v.cigar_id  = c.id
    GROUP BY c.id
    ORDER BY inventory_count DESC, c.brand, c.name
  `);
  res.json(cigars);
}));

router.post('/cigars', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const { brand, name, country, wrapper, binder, filler, strength, flavor_notes, description, year_introduced } = req.body;
  if (!brand || !name) return res.status(400).json({ error: 'Brand and name are required' });
  const fn = Array.isArray(flavor_notes) ? JSON.stringify(flavor_notes) : (flavor_notes || null);
  const result = await db.run(
    `INSERT INTO cigars (brand, name, country, wrapper, binder, filler, strength, flavor_notes, description, year_introduced)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    [brand, name, country || null, wrapper || null, binder || null, filler || null, strength || 'medium', fn, description || null, year_introduced || null]
  );
  res.json({ id: result.lastInsertRowid });
}));

router.put('/cigars/:id', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const { brand, name, country, wrapper, binder, filler, strength, flavor_notes, description, year_introduced } = req.body;
  if (!brand || !name) return res.status(400).json({ error: 'Brand and name are required' });
  const fn = Array.isArray(flavor_notes)
    ? JSON.stringify(flavor_notes)
    : (typeof flavor_notes === 'string' && flavor_notes ? flavor_notes : null);
  await db.run(
    `UPDATE cigars SET brand=?, name=?, country=?, wrapper=?, binder=?, filler=?, strength=?, flavor_notes=?, description=?, year_introduced=? WHERE id=?`,
    [brand, name, country || null, wrapper || null, binder || null, filler || null, strength || 'medium', fn, description || null, year_introduced || null, req.params.id]
  );
  res.json({ success: true });
}));

router.delete('/cigars/:id', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const refs = await db.get(`
    SELECT
      (SELECT COUNT(*) FROM inventory   WHERE cigar_id = $1)::int AS inventory,
      (SELECT COUNT(*) FROM reviews     WHERE cigar_id = $1)::int AS reviews,
      (SELECT COUNT(*) FROM user_cigars WHERE cigar_id = $1)::int AS humidor,
      (SELECT COUNT(*) FROM smoke_list  WHERE cigar_id = $1)::int AS smoke_list
  `, [req.params.id]);
  const total = refs.inventory + refs.reviews + refs.humidor + refs.smoke_list;
  if (total > 0) {
    return res.status(409).json({
      error: `Cannot delete — ${refs.inventory} inventory, ${refs.reviews} reviews, ${refs.humidor} humidor, ${refs.smoke_list} smoke-list items reference this cigar. Edit the name/details instead.`
    });
  }
  await db.run('DELETE FROM cigars WHERE id = ?', [req.params.id]);
  res.json({ success: true });
}));

router.get('/cigars/:id/vitolas', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const vitolas = await db.all(`
    SELECT v.*, COUNT(i.id)::int AS inventory_count
    FROM vitolas v LEFT JOIN inventory i ON i.vitola_id = v.id
    WHERE v.cigar_id = ? GROUP BY v.id ORDER BY v.name
  `, [req.params.id]);
  res.json(vitolas);
}));

router.post('/cigars/:id/vitolas', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const { name, length, ring_gauge, msrp } = req.body;
  if (!name) return res.status(400).json({ error: 'Vitola name is required' });
  const result = await db.run(
    'INSERT INTO vitolas (cigar_id, name, length, ring_gauge, msrp) VALUES (?, ?, ?, ?, ?) RETURNING id',
    [req.params.id, name, length || null, ring_gauge || null, msrp || null]
  );
  res.json({ id: result.lastInsertRowid });
}));

router.put('/vitolas/:id', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const { name, length, ring_gauge, msrp } = req.body;
  if (!name) return res.status(400).json({ error: 'Vitola name is required' });
  await db.run(
    'UPDATE vitolas SET name=?, length=?, ring_gauge=?, msrp=? WHERE id=?',
    [name, length || null, ring_gauge || null, msrp || null, req.params.id]
  );
  res.json({ success: true });
}));

router.delete('/vitolas/:id', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const ref = await db.get('SELECT COUNT(*)::int AS count FROM inventory WHERE vitola_id = ?', [req.params.id]);
  if (ref.count > 0) {
    return res.status(409).json({ error: `Cannot delete — ${ref.count} inventory items use this vitola.` });
  }
  await db.run('DELETE FROM vitolas WHERE id = ?', [req.params.id]);
  res.json({ success: true });
}));

module.exports = router;
