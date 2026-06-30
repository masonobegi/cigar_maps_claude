const router = require('express').Router();
const db = require('../database/db');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { asyncRoute } = db;
const { sendMail } = require('../utils/email');

const APP_URL = process.env.APP_URL || 'https://cigarmapsclaude-production.up.railway.app';

// ── Community posts ──────────────────────────────────────────────────────────

router.get('/stores/:id/community', optionalAuth, asyncRoute(async (req, res) => {
  const posts = await db.all(`
    SELECT cp.id, cp.type, cp.content, cp.cigar_id, cp.is_pinned, cp.created_at,
      u.id as user_id, u.name as user_name, u.avatar_url,
      c.brand as cigar_brand, c.name as cigar_name,
      COUNT(DISTINCT cl.user_id) as like_count,
      COUNT(DISTINCT cr.id) as reply_count
    FROM community_posts cp
    JOIN users u ON u.id = cp.user_id
    LEFT JOIN cigars c ON c.id = cp.cigar_id
    LEFT JOIN community_likes cl ON cl.post_id = cp.id
    LEFT JOIN community_replies cr ON cr.post_id = cp.id
    WHERE cp.store_id = ?
    GROUP BY cp.id, u.id, c.id
    ORDER BY cp.is_pinned DESC, cp.created_at DESC
    LIMIT 100
  `, [req.params.id]);

  // If authenticated, attach which posts the user liked
  let likedSet = new Set();
  if (req.user) {
    const liked = await db.all(
      'SELECT post_id FROM community_likes WHERE user_id = ?',
      [req.user.id]
    );
    likedSet = new Set(liked.map(r => r.post_id));
  }

  res.json(posts.map(p => ({ ...p, my_like: likedSet.has(p.id) })));
}));

router.post('/stores/:id/community', requireAuth, asyncRoute(async (req, res) => {
  const { type = 'post', content, cigar_id } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'Content is required' });
  if (!['post', 'checkin'].includes(type)) return res.status(400).json({ error: 'Invalid type' });

  const result = await db.run(
    'INSERT INTO community_posts (store_id, user_id, type, content, cigar_id) VALUES (?, ?, ?, ?, ?) RETURNING id',
    [req.params.id, req.user.id, type, content.trim(), cigar_id || null]
  );

  const store = await db.get('SELECT name FROM stores WHERE id = ?', [req.params.id]);
  const notifTitle = type === 'checkin'
    ? `${req.user.name} just checked in at ${store?.name}`
    : `New community post at ${store?.name}`;
  const notifMsg = content.trim().slice(0, 120);

  // Store created_by_user_id so the poster doesn't see their own notification
  await db.pool.query(
    `INSERT INTO notifications (store_id, title, message, type, created_by_user_id) VALUES ($1, $2, $3, 'community', $4)`,
    [req.params.id, notifTitle, notifMsg, req.user.id]
  );

  res.json({ id: result.lastInsertRowid });
}));

// ── Likes ────────────────────────────────────────────────────────────────────

router.post('/community/:postId/like', requireAuth, asyncRoute(async (req, res) => {
  const existing = await db.get(
    'SELECT 1 FROM community_likes WHERE post_id = ? AND user_id = ?',
    [req.params.postId, req.user.id]
  );
  if (existing) {
    await db.run('DELETE FROM community_likes WHERE post_id = ? AND user_id = ?', [req.params.postId, req.user.id]);
  } else {
    await db.run(
      'INSERT INTO community_likes (post_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING',
      [req.params.postId, req.user.id]
    );
  }
  const row = await db.get('SELECT COUNT(*) as count FROM community_likes WHERE post_id = ?', [req.params.postId]);
  res.json({ liked: !existing, like_count: parseInt(row.count) });
}));

// ── Replies ──────────────────────────────────────────────────────────────────

router.get('/community/:postId/replies', optionalAuth, asyncRoute(async (req, res) => {
  const replies = await db.all(`
    SELECT cr.id, cr.content, cr.created_at, u.id as user_id, u.name as user_name, u.avatar_url
    FROM community_replies cr
    JOIN users u ON u.id = cr.user_id
    WHERE cr.post_id = ?
    ORDER BY cr.created_at ASC
  `, [req.params.postId]);
  res.json(replies);
}));

router.post('/community/:postId/replies', requireAuth, asyncRoute(async (req, res) => {
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'Content required' });

  const post = await db.get(`
    SELECT cp.*, u.email as author_email, u.name as author_name, u.id as author_id,
      s.id as store_id, s.name as store_name
    FROM community_posts cp
    JOIN users u ON u.id = cp.user_id
    JOIN stores s ON s.id = cp.store_id
    WHERE cp.id = ?
  `, [req.params.postId]);
  if (!post) return res.status(404).json({ error: 'Post not found' });

  await db.run(
    'INSERT INTO community_replies (post_id, user_id, content) VALUES (?, ?, ?)',
    [req.params.postId, req.user.id, content.trim()]
  );

  // Email OP if the replier is not them
  if (post.author_id !== req.user.id && post.author_email) {
    sendMail({
      to: post.author_email,
      subject: `${req.user.name} replied to your post on CigarBuddy`,
      text: [
        `${req.user.name} replied to your community post at ${post.store_name}:`,
        ``,
        `Your post: "${post.content.slice(0, 100)}${post.content.length > 100 ? '…' : ''}"`,
        ``,
        `Their reply: "${content.trim()}"`,
        ``,
        `See the full conversation: ${APP_URL}/stores/${post.store_id}?tab=community`,
      ].join('\n'),
    }).catch(() => {});
  }

  res.json({ success: true });
}));

router.delete('/community/:postId/replies/:replyId', requireAuth, asyncRoute(async (req, res) => {
  const reply = await db.get('SELECT * FROM community_replies WHERE id = ?', [req.params.replyId]);
  if (!reply) return res.status(404).json({ error: 'Not found' });
  const post = await db.get('SELECT cp.*, s.user_id as store_owner_id FROM community_posts cp JOIN stores s ON s.id = cp.store_id WHERE cp.id = ?', [reply.post_id]);
  const canDelete = reply.user_id === req.user.id || post?.store_owner_id === req.user.id || ['admin', 'staff'].includes(req.user.account_type);
  if (!canDelete) return res.status(403).json({ error: 'Not allowed' });
  await db.run('DELETE FROM community_replies WHERE id = ?', [req.params.replyId]);
  res.json({ success: true });
}));

// ── Pin / Delete post ────────────────────────────────────────────────────────

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
  const store = await db.get('SELECT user_id, name FROM stores WHERE id = ?', [req.params.id]);
  if (!store || store.user_id !== req.user.id) return res.status(403).json({ error: 'Store owners only' });
  const { title, description, event_date } = req.body;
  if (!title || !event_date) return res.status(400).json({ error: 'Title and date required' });

  const result = await db.run(
    'INSERT INTO store_events (store_id, created_by, title, description, event_date) VALUES (?, ?, ?, ?, ?) RETURNING id',
    [req.params.id, req.user.id, title, description || null, event_date]
  );

  await db.pool.query(
    `INSERT INTO notifications (store_id, title, message, type) VALUES ($1, $2, $3, 'community')`,
    [req.params.id, `New event at ${store.name}`, `${title}${description ? ' — ' + description.slice(0, 80) : ''}`]
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
