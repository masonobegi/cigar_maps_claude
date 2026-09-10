/**
 * Staff tools for closed shops.
 *
 * jobs/closureCheck.js flags listings it believes have shut — from the source
 * map data, from the shop's own website, or from there being no way left to
 * contact the place. None of that is proof, so every flag lands in this queue
 * and a human makes the call.
 *
 * Both decisions write staff_edited = 1. That is the whole point of the flag: a
 * directory re-import, or a later sweep, must not quietly undo what a person
 * decided. Once staff has ruled, the row is theirs.
 *
 * Mounted at /api by index.js, so the paths below are /api/admin/...
 */
'use strict';

const router = require('express').Router();
const db = require('../database/db');
const { requireAuth } = require('../middleware/auth');
const { findClosures, applyClosures, reasonKey } = require('../jobs/closureCheck');
const { asyncRoute } = db;

function requireAdmin(req, res, next) {
  if (!['admin', 'staff'].includes(req.user.account_type)) return res.status(403).json({ error: 'Staff only' });
  next();
}

const FLAGGED = "operating_status IN ('permanently_closed', 'likely_closed')";

// ── The queue ───────────────────────────────────────────────────────────────

router.get('/admin/closures', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);

  // status: 'closed' | 'likely' | 'all' (default). The long-hand column values
  // are accepted too, because that is what the rows themselves say.
  const raw = String(req.query.status || 'all').toLowerCase();
  const status = ['closed', 'permanently_closed'].includes(raw) ? 'permanently_closed'
    : ['likely', 'likely_closed'].includes(raw) ? 'likely_closed'
      : null;

  const params = [];
  let where = FLAGGED;
  if (status) { where += ' AND operating_status = ?'; params.push(status); }
  params.push(limit);

  const items = await db.all(`
    SELECT id, name, city, state, address, website, website_status, phone,
           operating_status, closed_reason, closed_at, closure_checked_at,
           storefront, visible, claimed, COALESCE(staff_edited, 0) AS staff_edited
    FROM stores
    WHERE ${where}
    ORDER BY closure_checked_at DESC NULLS LAST, id
    LIMIT ?
  `, params);

  // Counts across the whole queue, not just this page, so the panel can show
  // the size of the job rather than the size of the response.
  const byStatus = await db.all(`
    SELECT operating_status AS status, COUNT(*)::int AS n
    FROM stores WHERE ${FLAGGED}
    GROUP BY operating_status
  `);
  const counts = { permanently_closed: 0, likely_closed: 0 };
  for (const r of byStatus) counts[r.status] = Number(r.n) || 0;
  counts.total = counts.permanently_closed + counts.likely_closed;

  // Why each one was flagged, folded onto the stable half of the reason: every
  // website verdict quotes a different sentence, and 40 rows of one-apiece
  // tells staff nothing.
  const reasonRows = await db.all(`
    SELECT closed_reason, COUNT(*)::int AS n
    FROM stores WHERE ${FLAGGED}
    GROUP BY closed_reason
  `);
  const byReason = {};
  for (const r of reasonRows) {
    const key = reasonKey(r.closed_reason);
    byReason[key] = (byReason[key] || 0) + (Number(r.n) || 0);
  }

  // Nobody has ruled on these yet — this is the number that should go down.
  const unreviewed = await db.get(`
    SELECT COUNT(*)::int AS n FROM stores
    WHERE ${FLAGGED} AND COALESCE(staff_edited, 0) = 0 AND claimed = 0
  `);
  // Flagged closed but still on the public map: the ones that can still send a
  // customer to a locked door.
  const stillVisible = await db.get(`
    SELECT COUNT(*)::int AS n FROM stores WHERE ${FLAGGED} AND visible = 1
  `);

  res.json({
    items,
    counts,
    by_reason: byReason,
    unreviewed: Number(unreviewed?.n) || 0,
    still_visible: Number(stillVisible?.n) || 0,
  });
}));

// ── Run a sweep ─────────────────────────────────────────────────────────────

router.post('/admin/closures/scan', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.body?.limit) || 300, 1), 2000);
  const useWeb = req.body?.web === true || req.body?.web === 'true';
  const confirm = req.body?.confirm === true || req.body?.confirm === 'true';

  if (!confirm) {
    // A dry run is fast enough to wait for when it stays off the network.
    const { counts } = await findClosures({ limit, useWeb, log: () => {} });
    return res.json({ dry_run: true, counts });
  }
  // Applying can take minutes with --web, so it runs detached.
  applyClosures({ confirm: true, limit, useWeb })
    .catch(err => console.error('[closures] admin sweep failed:', err.message));
  res.json({ started: true, limit, web: useWeb });
}));

// ── The two decisions ───────────────────────────────────────────────────────

/** Yes, it is gone: off the map, and marked so no sweep or import brings it back. */
router.post('/admin/closures/:id/confirm', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const store = await db.get('SELECT id, name, closed_reason FROM stores WHERE id = ?', [req.params.id]);
  if (!store) return res.status(404).json({ error: 'Store not found' });

  const note = typeof req.body?.reason === 'string' && req.body.reason.trim()
    ? req.body.reason.trim().slice(0, 300)
    : (store.closed_reason || 'confirmed closed by staff');

  await db.run(`
    UPDATE stores
    SET visible = 0, storefront = 'closed', storefront_reason = ?, storefront_checked_at = NOW(),
        operating_status = 'permanently_closed', closed_reason = ?,
        closed_at = COALESCE(closed_at, NOW()), closure_checked_at = NOW(),
        staff_edited = 1
    WHERE id = ?
  `, [note, note, store.id]);

  res.json({ id: store.id, name: store.name, visible: 0, storefront: 'closed', closed_reason: note });
}));

/** No, it is still trading: back on the map, and pinned there. */
router.post('/admin/closures/:id/reopen', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const store = await db.get('SELECT id, name FROM stores WHERE id = ?', [req.params.id]);
  if (!store) return res.status(404).json({ error: 'Store not found' });

  await db.run(`
    UPDATE stores
    SET visible = 1, storefront = 'yes', storefront_reason = 'confirmed open by staff',
        storefront_checked_at = NOW(),
        operating_status = 'open', closed_reason = NULL, closed_at = NULL,
        closure_checked_at = NOW(), staff_edited = 1
    WHERE id = ?
  `, [store.id]);

  res.json({ id: store.id, name: store.name, visible: 1, storefront: 'yes', operating_status: 'open' });
}));

module.exports = router;
