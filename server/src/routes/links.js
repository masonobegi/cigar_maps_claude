/**
 * Staff tools for the website link checker.
 *
 * The directory's website fields came from Overture Maps + OpenStreetMap and a
 * lot of them are stale. The job in jobs/linkCheck.js verifies them; these
 * endpoints let staff kick a sweep off, see the damage by status, and blank a
 * link that is plainly junk.
 *
 * Mounted at /api by index.js, so the paths below are /api/admin/...
 */
'use strict';

const router = require('express').Router();
const db = require('../database/db');
const { requireAuth } = require('../middleware/auth');
const { checkStores, STATUSES } = require('../jobs/linkCheck');
const { asyncRoute } = db;

function requireAdmin(req, res, next) {
  if (!['admin', 'staff'].includes(req.user.account_type)) return res.status(403).json({ error: 'Staff only' });
  next();
}

// ── Run a sweep ─────────────────────────────────────────────────────────────

router.post('/admin/link-check', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.body.limit) || 200, 1), 2000);
  // Fire and forget — a sweep takes minutes and the caller should not wait.
  checkStores({ limit }).catch(err => console.error('[links] admin check failed:', err.message));
  res.json({ started: true, limit });
}));

// ── The queue of bad links ──────────────────────────────────────────────────

router.get('/admin/dead-links', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
  const status = req.query.status && STATUSES.concat('removed').includes(req.query.status)
    ? req.query.status : null;

  const params = [];
  let where = "website_status IS NOT NULL AND website_status <> 'ok'";
  if (status) { where += ' AND website_status = ?'; params.push(status); }
  params.push(limit);

  const items = await db.all(`
    SELECT id, name, city, state, website, website_status, website_final_url, website_checked_at, claimed
    FROM stores
    WHERE ${where}
    ORDER BY website_checked_at DESC NULLS LAST, id
    LIMIT ?
  `, params);

  // Every status, 'ok' included, so staff can see the scale of the problem
  // rather than just the length of this page of results.
  const rows = await db.all(`
    SELECT website_status AS status, COUNT(*) AS n
    FROM stores WHERE website_status IS NOT NULL
    GROUP BY website_status
  `);
  const counts = {};
  let bad = 0;
  for (const r of rows) {
    counts[r.status] = Number(r.n) || 0;
    if (r.status !== 'ok') bad += counts[r.status];
  }

  const pending = await db.get(`
    SELECT COUNT(*) AS n FROM stores
    WHERE website IS NOT NULL AND website <> '' AND visible = 1 AND website_checked_at IS NULL
  `);

  res.json({ items, counts, total_bad: bad, unchecked: Number(pending?.n) || 0 });
}));

// ── Throw one away ──────────────────────────────────────────────────────────

router.post('/admin/dead-links/:id/clear', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const store = await db.get('SELECT id, name, website FROM stores WHERE id = ?', [req.params.id]);
  if (!store) return res.status(404).json({ error: 'Store not found' });

  // staff_edited marks the row as hand-corrected so a directory re-import
  // treats it as decided rather than recycling the same dead address.
  await db.run(`
    UPDATE stores
    SET website = NULL, website_final_url = NULL, website_status = 'removed',
        website_checked_at = NOW(), staff_edited = 1
    WHERE id = ?
  `, [store.id]);

  res.json({ id: store.id, cleared: store.website || null, website_status: 'removed' });
}));

module.exports = router;
