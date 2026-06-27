const router = require('express').Router();
const db = require('../database/db');
const { requireAuth } = require('../middleware/auth');
const { asyncRoute } = db;

router.get('/', requireAuth, asyncRoute(async (req, res) => {
  const { status } = req.query;
  let where = 'sl.user_id = ?';
  const params = [req.user.id];
  if (status) { where += ' AND sl.status = ?'; params.push(status); }

  const items = await db.all(`
    SELECT sl.*, c.brand, c.name as cigar_name, c.strength, c.country, c.wrapper, c.flavor_notes,
      COALESCE(AVG(r.rating), 0) as avg_rating, COUNT(r.id) as review_count,
      COUNT(DISTINCT i.store_id) as store_count, MIN(i.price) as min_price
    FROM smoke_list sl
    JOIN cigars c ON c.id = sl.cigar_id
    LEFT JOIN reviews r ON r.cigar_id = sl.cigar_id
    LEFT JOIN inventory i ON i.cigar_id = sl.cigar_id AND i.in_stock = 1
    WHERE ${where}
    GROUP BY sl.id, c.id
    ORDER BY
      CASE sl.priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END,
      sl.created_at DESC
  `, params);

  res.json(items.map(i => ({ ...i, flavor_notes: JSON.parse(i.flavor_notes || '[]'), avg_rating: Math.round(i.avg_rating) })));
}));

router.post('/', requireAuth, asyncRoute(async (req, res) => {
  const { cigar_id, priority, notes, recommended_by } = req.body;
  if (!cigar_id) return res.status(400).json({ error: 'cigar_id required' });

  const existing = await db.get("SELECT id FROM smoke_list WHERE user_id = ? AND cigar_id = ? AND status = 'pending'", [req.user.id, cigar_id]);
  if (existing) return res.status(409).json({ error: 'Already on your smoke list' });

  const result = await db.run(`
    INSERT INTO smoke_list (user_id, cigar_id, priority, notes, recommended_by)
    VALUES (?, ?, ?, ?, ?) RETURNING id
  `, [req.user.id, cigar_id, priority || 'medium', notes ?? null, recommended_by ?? null]);

  res.json({ id: result.lastInsertRowid });
}));

router.put('/:id', requireAuth, asyncRoute(async (req, res) => {
  const item = await db.get('SELECT id FROM smoke_list WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!item) return res.status(404).json({ error: 'Not found' });

  const { priority, notes, recommended_by, status, smoked_on } = req.body;
  const n = v => v ?? null;
  await db.run('UPDATE smoke_list SET priority=?, notes=?, recommended_by=?, status=?, smoked_on=? WHERE id=?',
    [n(priority), n(notes), n(recommended_by), n(status), n(smoked_on), req.params.id]);
  res.json({ success: true });
}));

router.post('/:id/mark-smoked', requireAuth, asyncRoute(async (req, res) => {
  const item = await db.get('SELECT id FROM smoke_list WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!item) return res.status(404).json({ error: 'Not found' });

  await db.run("UPDATE smoke_list SET status='smoked', smoked_on=CURRENT_DATE WHERE id=?", [req.params.id]);
  res.json({ success: true });
}));

router.delete('/:id', requireAuth, asyncRoute(async (req, res) => {
  await db.run('DELETE FROM smoke_list WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  res.json({ success: true });
}));

module.exports = router;
