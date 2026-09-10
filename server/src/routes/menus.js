/**
 * Online-menu endpoints.
 *
 * Public: what we know about a shop's website feed.
 * Owner:  refresh on demand, or opt out of being read at all.
 * Staff:  work the queue of product titles the matcher could not place.
 *
 * Mounted at /api by index.js, so the paths below are /api/stores/... and
 * /api/admin/...
 */
'use strict';

const router = require('express').Router();
const db = require('../database/db');
const { requireAuth } = require('../middleware/auth');
const { syncStoreMenu, scanStale } = require('../jobs/webMenu');
const { asyncRoute } = db;

const COOLDOWN_MINUTES = 10; // an owner-triggered refresh is rate limited per store

function requireAdmin(req, res, next) {
  if (!['admin', 'staff'].includes(req.user.account_type)) return res.status(403).json({ error: 'Staff only' });
  next();
}

/** Load the store and confirm the caller owns it. */
async function ownedStore(req, res) {
  const store = await db.get(
    'SELECT id, user_id, name, website, menu_url, menu_platform, menu_status, menu_opt_out, menu_checked_at, menu_last_synced FROM stores WHERE id = ?',
    [req.params.id]);
  if (!store) { res.status(404).json({ error: 'Store not found' }); return null; }
  if (store.user_id !== req.user.id) { res.status(403).json({ error: 'Not your store' }); return null; }
  return store;
}

// ── Public ──────────────────────────────────────────────────────────────────

router.get('/stores/:id/menu-status', asyncRoute(async (req, res) => {
  const store = await db.get(
    'SELECT id, website, menu_url, menu_platform, menu_status, menu_opt_out, menu_checked_at, menu_last_synced FROM stores WHERE id = ?',
    [req.params.id]);
  if (!store) return res.status(404).json({ error: 'Store not found' });

  const count = await db.get(
    "SELECT COUNT(*) as n FROM inventory WHERE store_id = ? AND source = 'web' AND in_stock = 1", [store.id]);

  res.json({
    platform: store.menu_platform || null,
    url: store.menu_url || (store.website ? 'https://' + store.website : null),
    status: store.menu_status || null,
    last_synced: store.menu_last_synced || null,
    checked_at: store.menu_checked_at || null,
    opt_out: Number(store.menu_opt_out) === 1,
    web_items: Number(count.n) || 0,
  });
}));

// ── Owner ───────────────────────────────────────────────────────────────────

router.post('/stores/:id/menu/refresh', requireAuth, asyncRoute(async (req, res) => {
  const store = await ownedStore(req, res);
  if (!store) return;
  if (Number(store.menu_opt_out) === 1) return res.status(400).json({ error: 'Automatic menu reading is turned off for this store' });
  if (!store.website) return res.status(400).json({ error: 'Add your website in store settings first' });

  // Ask the database for the wait, so the cooldown uses the same clock that
  // wrote menu_checked_at rather than this process's.
  const cool = await db.get(`
    SELECT CEIL(EXTRACT(EPOCH FROM (menu_checked_at + INTERVAL '${COOLDOWN_MINUTES} minutes' - NOW())) / 60) AS minutes_left
    FROM stores WHERE id = ? AND menu_checked_at IS NOT NULL
      AND menu_checked_at > NOW() - INTERVAL '${COOLDOWN_MINUTES} minutes'`, [store.id]);
  if (cool) {
    const minutes = Math.max(1, Number(cool.minutes_left) || 1);
    return res.status(429).json({ error: `Just checked. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.` });
  }

  const summary = await syncStoreMenu(store.id, {});
  res.json(summary);
}));

router.put('/stores/:id/menu/opt-out', requireAuth, asyncRoute(async (req, res) => {
  const store = await ownedStore(req, res);
  if (!store) return;
  const optOut = req.body.opt_out ? 1 : 0;

  await db.run('UPDATE stores SET menu_opt_out = ? WHERE id = ?', [optOut, store.id]);
  if (optOut) {
    // Pull anything we read off the shelf right away; the owner's own rows stay.
    await db.run("UPDATE inventory SET in_stock = 0, updated_at = NOW() WHERE store_id = ? AND source = 'web'", [store.id]);
  }
  res.json({ opt_out: optOut === 1 });
}));

// ── Staff: catalog queue ────────────────────────────────────────────────────

router.get('/admin/catalog-pending', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const status = req.query.status || 'pending';
  const limit = Math.min(Number(req.query.limit) || 100, 300);
  const rows = await db.all(`
    SELECT cp.*, s.name as store_name, c.brand as suggested_brand, c.name as suggested_name
    FROM catalog_pending cp
    LEFT JOIN stores s ON s.id = cp.store_id
    LEFT JOIN cigars c ON c.id = cp.suggested_cigar_id
    WHERE cp.status = ?
    ORDER BY cp.seen_count DESC, cp.updated_at DESC
    LIMIT ?`, [status, limit]);
  res.json({ items: rows });
}));

router.post('/admin/catalog-pending/:id/resolve', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const row = await db.get('SELECT id FROM catalog_pending WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Not found' });

  if (req.body.dismiss) {
    await db.run("UPDATE catalog_pending SET status = 'dismissed', updated_at = NOW() WHERE id = ?", [row.id]);
    return res.json({ status: 'dismissed' });
  }

  const cigarId = Number(req.body.cigar_id);
  if (!cigarId) return res.status(400).json({ error: 'cigar_id required' });
  const cigar = await db.get('SELECT id FROM cigars WHERE id = ?', [cigarId]);
  if (!cigar) return res.status(400).json({ error: 'Unknown cigar' });

  // A linked row becomes an alias the matcher trusts on the next scan.
  await db.run(
    "UPDATE catalog_pending SET status = 'linked', suggested_cigar_id = ?, updated_at = NOW() WHERE id = ?",
    [cigarId, row.id]);
  res.json({ status: 'linked', cigar_id: cigarId });
}));

router.post('/admin/menu-scan', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const limit = Math.min(Number(req.body.limit) || 40, 200);
  // Fire and forget — a scan takes minutes and the caller should not wait.
  scanStale({ limit }).catch(err => console.error('[menu] admin scan failed:', err.message));
  res.json({ started: true, limit });
}));

module.exports = router;
