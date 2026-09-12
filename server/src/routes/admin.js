const router = require('express').Router();
const db = require('../database/db');
const { requireAuth } = require('../middleware/auth');
const { asyncRoute } = db;
const { createInventorySheet } = require('../utils/googleSheets');
// Every staff write to a listing is recorded against the field it touched, so
// the next directory import honours it and the edit log says who did what.
const { writeFields } = require('../utils/storeEdits');
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
      (SELECT COUNT(*) FROM cigars WHERE source IS DISTINCT FROM 'retired') as total_cigars,
      (SELECT COUNT(*) FROM inventory WHERE in_stock = 1) as total_inventory,
      (SELECT COUNT(*) FROM smoke_list WHERE status = 'pending') as smoke_list_pending,
      (SELECT COUNT(*) FROM verification_requests WHERE status = 'pending') as pending_verifications,
      (SELECT COUNT(*) FROM store_follows) as total_follows,
      (SELECT COUNT(*) FROM notifications) as total_broadcasts,
      (SELECT COUNT(*) FROM stores WHERE visible = 1) as total_listings,
      (SELECT COUNT(*) FROM stores WHERE visible = 1 AND claimed = 0) as unclaimed_listings,
      (SELECT COUNT(*) FROM stores WHERE claimed = 1) as claimed_stores,
      (SELECT COUNT(*) FROM stores WHERE visible = 0) as hidden_listings,
      (SELECT COUNT(*) FROM store_claims WHERE status = 'pending') as pending_claims,
      (SELECT COUNT(*) FROM store_reports WHERE status = 'open') as open_reports
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

  // If store doesn't have a sheet yet, create one now
  if (process.env.GOOGLE_SERVICE_ACCOUNT) {
    const store = await db.get('SELECT s.name, s.sheet_url, u.email FROM stores s JOIN users u ON u.id = s.user_id WHERE s.id = ?', [vr.store_id]);
    if (store && !store.sheet_url) {
      createInventorySheet(store.email, store.name)
        .then(url => db.run('UPDATE stores SET sheet_url = ? WHERE id = ?', [url, vr.store_id]))
        .catch(err => console.error('[sheets] Failed to create sheet on verification approve:', err.message));
    }
  }

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
    WHERE s.user_id IS NOT NULL
    GROUP BY s.id, u.id, vr.id, vr.status, vr.submitted_at
    ORDER BY s.created_at DESC
  `, []);
  res.json(stores);
}));

// ── Store claims (unclaimed listing → owner) ────────────────────────────────

const { approveClaim, rejectClaim } = require('../utils/claims');

/**
 * The claim queue, with the evidence a decision actually needs.
 *
 * It used to return the claimant, the shop's name and its address, which is
 * not enough to answer the only question that matters: does this person run
 * this shop, and is this listing a shop we should be publishing at all? A
 * staff member approving a claim on a listing we had already hidden as a
 * duplicate, or on a domain that 40 other listings share, had nothing on the
 * card to tell them so.
 *
 * So the card now carries the listing's standing (visible, storefront,
 * operating status and the reasons behind each), the state of its website, the
 * gate's own verdict and reasons, how many listings share the domain, and what
 * the registry says about when that domain was registered — a shop domain
 * registered last week, behind a claim on a listing that has been in the
 * directory for years, is the shape of a takeover.
 */
router.get('/claims', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const { status } = req.query;
  const params = [];
  let where = '1=1';
  if (status) { where = 'sc.status = ?'; params.push(status); }
  const rows = await db.all(`
    SELECT sc.*, s.name as store_name, s.city, s.state, s.website as store_website, s.phone as store_phone, s.address as store_address,
      -- Is this listing one we are publishing, and if not, why not.
      s.visible as store_visible, s.storefront, s.storefront_reason,
      s.operating_status, s.closed_reason, s.staff_edited,
      -- Does the address on the listing still serve the shop's own site.
      s.website_status, s.website_final_url, s.website_checked_at,
      u.email as user_email, u.name as user_name, u.created_at as user_created_at,
      -- How many other listings stand on this domain. A claim proved by an
      -- email at a domain 40 listings share proves control of a chain's
      -- mailbox, not of this branch.
      (SELECT COUNT(*) FROM stores d
        WHERE d.website IS NOT NULL AND d.website <> '' AND d.id <> s.id
          AND regexp_replace(regexp_replace(lower(d.website), '^https?://', ''), '^www\\.', '')
              LIKE regexp_replace(regexp_replace(lower(s.website), '^https?://', ''), '^www\\.', '') || '%'
      )::int AS listings_sharing_domain
    FROM store_claims sc
    JOIN stores s ON s.id = sc.store_id
    JOIN users u ON u.id = sc.user_id
    WHERE ${where}
    ORDER BY CASE sc.status WHEN 'pending' THEN 1 WHEN 'approved' THEN 2 ELSE 3 END, sc.created_at DESC
    LIMIT 200
  `, params);

  // What the registry knows about each domain, from the cache the gate fills.
  // Read-only here: the queue must not make a staff member wait on RDAP, and a
  // domain nobody has looked up simply says so.
  const { registrableDomain } = require('../jobs/linkCheck');
  const domains = [...new Set(rows.map(r => r.store_website && registrableDomain(r.store_website)).filter(Boolean))];
  const facts = new Map();
  if (domains.length) {
    const holes = domains.map(() => '?').join(',');
    for (const f of await db.all(`SELECT * FROM domain_facts WHERE domain IN (${holes})`, domains)) {
      facts.set(f.domain, f);
    }
  }

  res.json(rows.map(r => {
    const domain = r.store_website ? registrableDomain(r.store_website) : null;
    const fact = domain ? facts.get(domain) : null;
    return {
      ...r,
      // The gate's own reasons, recorded when the claim was filed.
      proof_reasons: (() => {
        try { return JSON.parse(r.proof_reasons || 'null'); } catch { return null; }
      })(),
      domain,
      domain_rdap_status: fact ? fact.rdap_status : null,
      domain_registered_at: fact ? fact.registered_at : null,
      // Set when a person has to look at this one whatever the proof says.
      needs_manual_review: !r.store_visible || r.storefront === 'duplicate'
        || r.operating_status === 'permanently_closed' || r.storefront === 'closed',
    };
  }));
}));

router.post('/claims/:id/approve', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  try {
    const store = await approveClaim(req.params.id, { verify: true, adminNotes: req.body?.admin_notes || 'Approved by staff' });
    if (process.env.GOOGLE_SERVICE_ACCOUNT && !store.sheet_url) {
      const owner = await db.get('SELECT email FROM users WHERE id = ?', [store.user_id]);
      if (owner) createInventorySheet(owner.email, store.name)
        .then(url => db.run('UPDATE stores SET sheet_url = ? WHERE id = ?', [url, store.id]))
        .catch(err => console.error('[sheets] Failed to create sheet on claim approve:', err.message));
    }
    res.json({ success: true });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    throw e;
  }
}));

router.post('/claims/:id/reject', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  try {
    await rejectClaim(req.params.id, req.body?.admin_notes);
    res.json({ success: true });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    throw e;
  }
}));

/**
 * Hand a listing back. There was no way to undo an approval: a claim granted
 * to the wrong person, or to somebody who has since sold the shop, left that
 * account in control of the listing for good, and the only alternative was to
 * delete the whole row.
 *
 * The listing keeps its visibility and its data; it loses its owner, its
 * claimed flag and its verified badge, because all three were statements about
 * the account that is being removed. Any pending claims are left alone so a
 * legitimate owner can still be approved.
 */
router.post('/stores/:id/unclaim', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const store = await db.get('SELECT id, name, user_id, claimed, verified FROM stores WHERE id = ?', [req.params.id]);
  if (!store) return res.status(404).json({ error: 'Store not found' });
  if (!store.claimed && store.user_id === null) return res.status(409).json({ error: 'That listing is not claimed' });

  const reason = String(req.body?.reason || '').slice(0, 400) || `unclaimed by staff user ${req.user.id}`;
  // Recorded field by field, so the edit log can say what was taken away and
  // why — the same log every sweep writes to.
  await writeFields(store.id, { user_id: null, claimed: 0, verified: 0 },
    { source: 'staff', job: 'admin-unclaim', reason, force: true });
  // Approved claims on this listing no longer describe anything, so they are
  // marked rather than left looking live.
  await db.run(`UPDATE store_claims SET status = 'revoked', admin_notes = ?, reviewed_at = NOW()
                WHERE store_id = ? AND status = 'approved'`, [reason, store.id]);

  res.json({ success: true, id: store.id, unclaimed: store.user_id });
}));

// ── Directory listings (auto-imported, unclaimed) ───────────────────────────

router.get('/listings', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const { q, state, visible, min_conf, max_conf, storefront } = req.query;
  const limit = Math.min(500, parseInt(req.query.limit) || 100);
  // Both directory sources. This said `source = 'osm'` and so showed staff
  // only the OpenStreetMap rows — the Overture ones, which are most of the
  // directory, could not be reviewed, retyped or hidden from here at all.
  const where = ["s.source IN ('osm', 'overture')", 's.claimed = 0'];
  const params = [];
  if (q) { where.push('(s.name ILIKE ? OR s.city ILIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
  if (state) { where.push('s.state = ?'); params.push(String(state).toUpperCase()); }
  if (visible === '0' || visible === '1') { where.push('s.visible = ?'); params.push(+visible); }
  // Why a hidden listing is hidden. Without this the only way to review, say,
  // every row a sweep called a duplicate was to page through all of them.
  if (storefront) {
    const wanted = String(storefront).split(',').map(v => v.trim()).filter(Boolean);
    if (wanted.length) {
      where.push(`s.storefront IN (${wanted.map(() => '?').join(',')})`);
      params.push(...wanted);
    }
  }
  if (min_conf) { where.push('s.confidence >= ?'); params.push(+min_conf); }
  if (max_conf) { where.push('s.confidence <= ?'); params.push(+max_conf); }
  const rows = await db.all(`
    SELECT s.id, s.name, s.source_name, s.city, s.state, s.address, s.phone, s.website, s.store_type,
      s.confidence, s.visible, s.source, s.source_id, s.lat, s.lng,
      -- Why this listing stands where it does, so a staff member can see the
      -- sweep's reasoning instead of guessing at it.
      s.storefront, s.storefront_reason, s.operating_status, s.closed_reason,
      s.website_status, s.hours_source, s.field_sources,
      (SELECT COUNT(*) FROM store_views sv WHERE sv.store_id = s.id) as views,
      (SELECT COUNT(*) FROM store_reports sr WHERE sr.store_id = s.id AND sr.status = 'open') as open_reports
    FROM stores s
    WHERE ${where.join(' AND ')}
    ORDER BY s.confidence DESC, s.name
    LIMIT ?
  `, [...params, limit]);
  // How large the queue actually is, so "100 rows" is not mistaken for "all of
  // them" the way the map's 1,000 was.
  const total = await db.get(`SELECT COUNT(*)::int AS n FROM stores s WHERE ${where.join(' AND ')}`, params);
  res.json({ items: rows, total: Number(total.n), returned: rows.length, limit });
}));

const STORE_TYPES = ['cigar_shop', 'cigar_lounge', 'tobacco_shop', 'smoke_shop'];

router.patch('/stores/:id/visible', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const { visible, store_type } = req.body || {};
  if (store_type && !STORE_TYPES.includes(store_type)) return res.status(400).json({ error: 'Unknown store type' });
  // staff_edited pins this row: the next directory import keeps these values.
  if (visible !== undefined) await db.run('UPDATE stores SET visible = ?, staff_edited = 1 WHERE id = ?', [visible ? 1 : 0, req.params.id]);
  if (store_type) await db.run('UPDATE stores SET store_type = ?, staff_edited = 1 WHERE id = ?', [store_type, req.params.id]);
  res.json({ success: true });
}));

router.get('/reports', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const status = req.query.status || 'open';
  const rows = await db.all(`
    SELECT r.*, s.name as store_name, s.city, s.state, s.claimed, s.visible, u.email as reporter_email
    FROM store_reports r
    JOIN stores s ON s.id = r.store_id
    LEFT JOIN users u ON u.id = r.user_id
    WHERE r.status = ?
    ORDER BY r.created_at DESC LIMIT 200
  `, [status]);
  res.json(rows);
}));

router.patch('/reports/:id', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const { status, hide_store } = req.body || {};
  const report = await db.get('SELECT * FROM store_reports WHERE id = ?', [req.params.id]);
  if (!report) return res.status(404).json({ error: 'Not found' });
  if (hide_store) {
    // This used to carry `AND claimed = 0` and so did nothing at all on a
    // claimed listing, while still answering "success". A visitor reporting
    // that a claimed shop has shut got a staff member clicking Hide and
    // nothing happening, with no way to tell. Hiding a claimed listing is a
    // decision about somebody's business, so it is refused out loud instead.
    const store = await db.get('SELECT id, claimed FROM stores WHERE id = ?', [report.store_id]);
    if (!store) return res.status(404).json({ error: 'That report points at a listing that no longer exists' });
    if (store.claimed) {
      return res.status(409).json({
        error: 'That listing is claimed by its owner. Take the claim back first (Unclaim), then hide it.',
        store_id: store.id, claimed: true,
      });
    }
    await db.run('UPDATE stores SET visible = 0, staff_edited = 1 WHERE id = ?', [report.store_id]);
  }
  if (status) await db.run('UPDATE store_reports SET status = ? WHERE id = ?', [status, report.id]);
  res.json({ success: true });
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

router.delete('/stores/:id', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  await db.pool.query('DELETE FROM stores WHERE id = $1', [req.params.id]);
  res.json({ success: true });
}));

router.delete('/users/:id', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  await db.pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
  res.json({ success: true });
}));

module.exports = router;
