const router = require('express').Router();
const db = require('../database/db');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { asyncRoute } = db;

// ── Community posts ──────────────────────────────────────────────────────────

router.get('/stores/:id/community', optionalAuth, asyncRoute(async (req, res) => {
  const posts = await db.all(`
    SELECT cp.id, cp.type, cp.content, cp.cigar_id, cp.is_pinned, cp.created_at,
      u.id as user_id, u.name as user_name, u.avatar_url,
      c.brand as cigar_brand, c.name as cigar_name
    FROM community_posts cp
    JOIN users u ON u.id = cp.user_id
    LEFT JOIN cigars c ON c.id = cp.cigar_id
    WHERE cp.store_id = ?
    ORDER BY cp.is_pinned DESC, cp.created_at DESC
    LIMIT 100
  `, [req.params.id]);
  res.json(posts);
}));

router.post('/stores/:id/community', requireAuth, asyncRoute(async (req, res) => {
  if (!['user', 'store'].includes(req.user.account_type)) {
    return res.status(403).json({ error: 'Only users and store accounts can post to community' });
  }
  const { type = 'post', content, cigar_id } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'Content is required' });
  if (!['post', 'checkin'].includes(type)) return res.status(400).json({ error: 'Invalid type' });

  const result = await db.run(
    'INSERT INTO community_posts (store_id, user_id, type, content, cigar_id) VALUES (?, ?, ?, ?, ?) RETURNING id',
    [req.params.id, req.user.id, type, content.trim(), cigar_id || null]
  );

  // Notify followers who opted into community updates
  const store = await db.get('SELECT name FROM stores WHERE id = ?', [req.params.id]);
  const notifTitle = type === 'checkin'
    ? `${req.user.name} just checked in at ${store?.name}`
    : `New community post at ${store?.name}`;
  const notifMsg = type === 'checkin' ? content.trim() : content.trim().slice(0, 120);
  await db.pool.query(
    `INSERT INTO notifications (store_id, title, message, type) VALUES ($1, $2, $3, 'community')`,
    [req.params.id, notifTitle, notifMsg]
  );

  res.json({ id: result.lastInsertRowid });
}));

router.patch('/community/:postId/pin', requireAuth, asyncRoute(async (req, res) => {
  const post = await db.get('SELECT * FROM community_posts WHERE id = ?', [req.params.postId]);
  if (!post) return res.status(404).json({ error: 'Not found' });
  const store = await db.get('SELECT user_id FROM stores WHERE id = ?', [post.store_id]);
  if (!store || store.user_id !== req.user.id) return res.status(403).json({ error: 'Store owners only' });
  await db.run('UPDATE community_posts SET is_pinned = CASE WHEN is_pinned = 1 THEN 0 ELSE 1 END WHERE id = ?', [req.params.postId]);
  res.json({ success: true });
}));

router.delete('/community/:postId', requireAuth, asyncRoute(async (req, res) => {
  const post = await db.get('SELECT * FROM community_posts WHERE id = ?', [req.params.postId]);
  if (!post) return res.status(404).json({ error: 'Not found' });
  const store = await db.get('SELECT user_id FROM stores WHERE id = ?', [post.store_id]);
  const isOwner = post.user_id === req.user.id;
  const isStoreOwner = store?.user_id === req.user.id;
  const isAdmin = ['admin', 'staff'].includes(req.user.account_type);
  if (!isOwner && !isStoreOwner && !isAdmin) return res.status(403).json({ error: 'Not allowed' });
  await db.run('DELETE FROM community_posts WHERE id = ?', [req.params.postId]);
  res.json({ success: true });
}));

// ── Events ───────────────────────────────────────────────────────────────────

router.get('/stores/:id/events', optionalAuth, asyncRoute(async (req, res) => {
  const events = await db.all(`
    SELECT e.*,
      COUNT(DISTINCT r.user_id) FILTER (WHERE r.status = 'going') as going_count,
      COUNT(DISTINCT r.user_id) FILTER (WHERE r.status = 'maybe') as maybe_count
    FROM store_events e
    LEFT JOIN event_rsvps r ON r.event_id = e.id
    WHERE e.store_id = ?
    GROUP BY e.id
    ORDER BY e.event_date ASC
  `, [req.params.id]);

  let userRsvps = {};
  if (req.user) {
    const rsvps = await db.all(
      'SELECT event_id, status FROM event_rsvps WHERE user_id = ?',
      [req.user.id]
    );
    for (const r of rsvps) userRsvps[r.event_id] = r.status;
  }

  res.json(events.map(e => ({ ...e, my_rsvp: userRsvps[e.id] || null })));
}));

router.post('/stores/:id/events', requireAuth, asyncRoute(async (req, res) => {
  const store = await db.get('SELECT user_id FROM stores WHERE id = ?', [req.params.id]);
  if (!store || store.user_id !== req.user.id) return res.status(403).json({ error: 'Store owners only' });
  const { title, description, event_date } = req.body;
  if (!title || !event_date) return res.status(400).json({ error: 'Title and date required' });

  const result = await db.run(
    'INSERT INTO store_events (store_id, created_by, title, description, event_date) VALUES (?, ?, ?, ?, ?) RETURNING id',
    [req.params.id, req.user.id, title, description || null, event_date]
  );

  // Notify all community-subscribed followers
  await db.pool.query(
    `INSERT INTO notifications (store_id, title, message, type) VALUES ($1, $2, $3, 'community')`,
    [req.params.id, `New event at ${store.name || 'your store'}`, `${title}${description ? ' — ' + description.slice(0, 80) : ''}`]
  );

  res.json({ id: result.lastInsertRowid });
}));

router.delete('/stores/:id/events/:eventId', requireAuth, asyncRoute(async (req, res) => {
  const store = await db.get('SELECT user_id FROM stores WHERE id = ?', [req.params.id]);
  if (!store || store.user_id !== req.user.id) return res.status(403).json({ error: 'Store owners only' });
  await db.run('DELETE FROM store_events WHERE id = ? AND store_id = ?', [req.params.eventId, req.params.id]);
  res.json({ success: true });
}));

router.post('/events/:id/rsvp', requireAuth, asyncRoute(async (req, res) => {
  if (req.user.account_type !== 'user') return res.status(403).json({ error: 'Users only' });
  const { status } = req.body;
  if (!status) {
    await db.run('DELETE FROM event_rsvps WHERE event_id = ? AND user_id = ?', [req.params.id, req.user.id]);
    return res.json({ success: true, status: null });
  }
  if (!['going', 'maybe'].includes(status)) return res.status(400).json({ error: 'Status must be going or maybe' });
  const existing = await db.get('SELECT * FROM event_rsvps WHERE event_id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (existing) {
    await db.run('UPDATE event_rsvps SET status = ? WHERE event_id = ? AND user_id = ?', [status, req.params.id, req.user.id]);
  } else {
    await db.run('INSERT INTO event_rsvps (event_id, user_id, status) VALUES (?, ?, ?)', [req.params.id, req.user.id, status]);
  }
  res.json({ success: true, status });
}));

module.exports = router;
