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
const { checkStores, STATUSES, socialNetwork, destinationKind, PENDING_STATUS } = require('../jobs/linkCheck');
const { writeFields } = require('../utils/storeEdits');
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

  // Which links belong in the queue. 'bad' is every verdict other than a
  // working one — dead domains, but also the ones somebody else now holds
  // ('elsewhere', 'hijacked', 'parked') and a Shopify shop switched off, all
  // of which need a person rather than a re-check. 'link' widens it to the
  // listings whose stored website is not the shop's own site at all but a
  // Facebook page, a Linktree or an ordering platform: those need replacing,
  // not clearing, and no verdict will ever flag them because the link works.
  const kind = ['bad', 'link', 'all'].includes(req.query.kind) ? req.query.kind : 'bad';

  const params = [];
  let where = kind === 'all'
    ? "website IS NOT NULL AND website <> ''"
    : `website_status IS NOT NULL AND website_status NOT IN ('ok', 'blocked', '${PENDING_STATUS}')`;
  if (kind === 'link') where = "website IS NOT NULL AND website <> ''";
  if (status) { where += ' AND website_status = ?'; params.push(status); }

  // A social or platform link is decided from the host, which is on the row
  // already, so this needs no crawl. The whole column is read and filtered
  // here rather than in SQL so the host list stays in one place — the same
  // destinationKind() the checker uses — instead of being copied into a
  // hand-maintained SQL IN list that would drift out of step with it.
  const wideLimit = kind === 'link' ? 50000 : limit;
  let items = await db.all(`
    SELECT id, name, city, state, website, website_status, website_final_url, website_checked_at,
           claimed, staff_edited, visible, storefront
    FROM stores
    WHERE ${where}
    ORDER BY website_checked_at DESC NULLS LAST, id
    LIMIT ?
  `, [...params, wideLimit]);

  if (kind === 'link') {
    items = items.filter(r => ['social', 'platform', 'parking'].includes(destinationKind(r.website)));
  }
  // What each row's link actually is, so the queue reads as English rather
  // than as a column of URLs: "Facebook page" beats
  // "facebook.com/profile.php?id=100063..." for deciding what to do about it.
  items = items.slice(0, limit).map(r => ({
    ...r,
    link_kind: destinationKind(r.website),
    link_label: socialNetwork(r.website) || null,
    final_kind: r.website_final_url ? destinationKind(r.website_final_url) : null,
  }));

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
    // 'blocked' is a working link behind a Cloudflare front door and
    // 'checking' is an address nobody has looked at yet. Counting either as
    // damage would have staff chasing links that are fine.
    if (!['ok', 'blocked', PENDING_STATUS].includes(r.status)) bad += counts[r.status];
  }

  const pending = await db.get(`
    SELECT COUNT(*) AS n FROM stores
    WHERE website IS NOT NULL AND website <> '' AND visible = 1 AND website_checked_at IS NULL
  `);

  res.json({ items, counts, total_bad: bad, unchecked: Number(pending?.n) || 0, kind });
}));

// ── Correct one by hand ─────────────────────────────────────────────────────

/**
 * A staff editor for the two contact fields, which until now could only be
 * emptied. Replacing a Facebook link with the shop's own domain, or fixing a
 * transposed phone number, had no route at all.
 *
 * Deliberately writes 'staff' into field_sources without setting
 * staff_edited: the flag freezes a listing against every future sweep, which
 * is far more than "somebody typed the right phone number here". Provenance
 * alone is enough — a sweep source is weaker than staff, so the correction
 * survives, while the rest of the listing stays open to improvement.
 */
router.patch('/admin/stores/:id/contact', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const store = await db.get('SELECT id, website FROM stores WHERE id = ?', [req.params.id]);
  if (!store) return res.status(404).json({ error: 'Store not found' });

  const changes = {};
  if ('phone' in req.body) changes.phone = String(req.body.phone || '').trim() || null;
  if ('website' in req.body) changes.website = String(req.body.website || '').trim() || null;
  if (!Object.keys(changes).length) return res.status(400).json({ error: 'Send a phone or a website' });

  const written = await writeFields(store.id, changes, {
    source: 'staff', job: 'admin-contact-edit',
    reason: String(req.body.reason || '').slice(0, 400) || `edited by staff user ${req.user.id}`,
  });

  // Same rule as the owner form: a new address carries no verdict, and the old
  // verdict described the old domain.
  if (written.includes('website')) {
    await db.run(
      'UPDATE stores SET website_status = ?, website_final_url = NULL, website_checked_at = NULL WHERE id = ?',
      [changes.website ? PENDING_STATUS : null, store.id]);
    if (changes.website) {
      require('../jobs/linkCheck').checkStore(store.id, { log: () => {} })
        .catch(err => console.error('[links] re-check failed for', store.id, err.message));
    }
  }

  res.json({ id: store.id, written });
}));

// ── Throw one away ──────────────────────────────────────────────────────────

router.post('/admin/dead-links/:id/clear', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const store = await db.get('SELECT id, name, website FROM stores WHERE id = ?', [req.params.id]);
  if (!store) return res.status(404).json({ error: 'Store not found' });

  // The clearing is recorded against the website field, so a directory
  // re-import treats that address as decided rather than recycling the same
  // dead one — and so the edit log says who threw it away and when.
  //
  // It used to set staff_edited = 1 instead, which freezes the whole listing:
  // its type, its visibility, its hours and its badges all stop taking
  // corrections from any sweep, for good. That is a great deal to give up in
  // exchange for blanking one lapsed URL. Field-level provenance says the same
  // thing about the website and nothing at all about the rest of the row.
  await writeFields(store.id, { website: null }, {
    source: 'staff', job: 'admin-clear-dead-link',
    reason: `cleared ${store.website || 'an empty website'} as a dead link (staff user ${req.user.id})`,
  });
  await db.run(`
    UPDATE stores
    SET website_final_url = NULL, website_status = 'removed', website_checked_at = NOW()
    WHERE id = ?
  `, [store.id]);

  res.json({ id: store.id, cleared: store.website || null, website_status: 'removed' });
}));

module.exports = router;
