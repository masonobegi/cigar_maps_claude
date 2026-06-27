const router = require('express').Router();
const db = require('../database/db');
const { requireAuth } = require('../middleware/auth');
const { asyncRoute } = db;

router.get('/', requireAuth, asyncRoute(async (req, res) => {
  const notifications = await db.all(`
    SELECT n.*, s.name as store_name,
      c.brand as cigar_brand, c.name as cigar_name,
      CASE WHEN nr.user_id IS NOT NULL THEN 1 ELSE 0 END as is_read,
      sf.notify_broadcasts, sf.notify_deals, sf.notify_new_arrivals
    FROM notifications n
    JOIN store_follows sf ON sf.store_id = n.store_id AND sf.user_id = ?
    JOIN stores s ON s.id = n.store_id
    LEFT JOIN cigars c ON c.id = n.cigar_id
    LEFT JOIN notification_reads nr ON nr.notification_id = n.id AND nr.user_id = ?
    WHERE (
      (n.type = 'announcement' AND sf.notify_broadcasts = 1) OR
      (n.type = 'deal' AND sf.notify_deals = 1) OR
      (n.type = 'new_arrival' AND sf.notify_new_arrivals = 1) OR
      (n.type = 'event')
    )
    ORDER BY n.created_at DESC
    LIMIT 50
  `, [req.user.id, req.user.id]);
  res.json(notifications);
}));

router.get('/count', requireAuth, asyncRoute(async (req, res) => {
  const row = await db.get(`
    SELECT COUNT(*) as count
    FROM notifications n
    JOIN store_follows sf ON sf.store_id = n.store_id AND sf.user_id = ?
    LEFT JOIN notification_reads nr ON nr.notification_id = n.id AND nr.user_id = ?
    WHERE nr.user_id IS NULL
    AND (
      (n.type = 'announcement' AND sf.notify_broadcasts = 1) OR
      (n.type = 'deal' AND sf.notify_deals = 1) OR
      (n.type = 'new_arrival' AND sf.notify_new_arrivals = 1) OR
      (n.type = 'event')
    )
  `, [req.user.id, req.user.id]);
  res.json({ count: parseInt(row.count) });
}));

router.post('/:id/read', requireAuth, asyncRoute(async (req, res) => {
  await db.run(
    'INSERT INTO notification_reads (user_id, notification_id) VALUES (?, ?) ON CONFLICT DO NOTHING',
    [req.user.id, req.params.id]
  );
  res.json({ success: true });
}));

router.post('/mark-all-read', requireAuth, asyncRoute(async (req, res) => {
  const unread = await db.all(`
    SELECT n.id FROM notifications n
    JOIN store_follows sf ON sf.store_id = n.store_id AND sf.user_id = ?
    LEFT JOIN notification_reads nr ON nr.notification_id = n.id AND nr.user_id = ?
    WHERE nr.user_id IS NULL
  `, [req.user.id, req.user.id]);

  for (const n of unread) {
    await db.run(
      'INSERT INTO notification_reads (user_id, notification_id) VALUES (?, ?) ON CONFLICT DO NOTHING',
      [req.user.id, n.id]
    );
  }
  res.json({ marked: unread.length });
}));

module.exports = router;
