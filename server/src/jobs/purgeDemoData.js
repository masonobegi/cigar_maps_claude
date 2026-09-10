/**
 * Remove the seeded demo data: the placeholder "Brand N / Cigar N" catalog, the
 * "Store N" shops, and the @demo.com accounts that own and review them.
 *
 * Deletes only rows that match the seed's own shapes, and refuses to touch a
 * demo cigar or store that a real person has interacted with, so live user data
 * can never be caught in the sweep.
 *
 * Usage:
 *   node src/jobs/purgeDemoData.js                # dry run, prints the plan
 *   node src/jobs/purgeDemoData.js --confirm      # actually delete
 */
'use strict';

const db = require('../database/db');

// The seed writes cigars as brand "Brand 1..5" with names "Cigar 1..25", stores
// as "Store 1..5", and the Portland variant as "Common Blend N" / "Unique N".
const DEMO_CIGAR_SQL = `
  (brand ~ '^Brand [0-9]+$' AND name ~ '^Cigar [0-9]+$')
  OR name ~ '^Common Blend [0-9]+$'
  OR name ~ '^Unique [0-9]+$'
`;
const DEMO_STORE_SQL = `(name ~ '^Store [0-9]+$')`;
const DEMO_USER_SQL = `(email ~ '@demo\\.com$' OR email ~ '^pdx[0-9]+@')`;

async function plan() {
  const cigars = await db.all(`SELECT id, brand, name FROM cigars WHERE ${DEMO_CIGAR_SQL} ORDER BY id`);
  const stores = await db.all(`SELECT id, name, city, state, user_id FROM stores WHERE ${DEMO_STORE_SQL} ORDER BY id`);
  const users = await db.all(`SELECT id, email, name, account_type FROM users WHERE ${DEMO_USER_SQL} ORDER BY id`);

  const cigarIds = cigars.map(c => c.id);
  const storeIds = stores.map(s => s.id);
  const userIds = users.map(u => u.id);

  // Anything a real account did to this data. Deleting it would be data loss,
  // so those rows are reported and their cigar or store is spared.
  const realReviews = cigarIds.length ? await db.all(`
    SELECT r.id, r.cigar_id, r.user_id, u.email
    FROM reviews r JOIN users u ON u.id = r.user_id
    WHERE r.cigar_id = ANY($1) AND NOT (${DEMO_USER_SQL.replace(/email/g, 'u.email')})
  `, [cigarIds]) : [];

  const realHumidor = cigarIds.length ? await db.all(`
    SELECT uc.id, uc.cigar_id, uc.user_id, u.email
    FROM user_cigars uc JOIN users u ON u.id = uc.user_id
    WHERE uc.cigar_id = ANY($1) AND NOT (${DEMO_USER_SQL.replace(/email/g, 'u.email')})
  `, [cigarIds]) : [];

  const realSmokeList = cigarIds.length ? await db.all(`
    SELECT sl.id, sl.cigar_id, sl.user_id, u.email
    FROM smoke_list sl JOIN users u ON u.id = sl.user_id
    WHERE sl.cigar_id = ANY($1) AND NOT (${DEMO_USER_SQL.replace(/email/g, 'u.email')})
  `, [cigarIds]) : [];

  const realFollows = storeIds.length ? await db.all(`
    SELECT sf.store_id, sf.user_id, u.email
    FROM store_follows sf JOIN users u ON u.id = sf.user_id
    WHERE sf.store_id = ANY($1) AND NOT (${DEMO_USER_SQL.replace(/email/g, 'u.email')})
  `, [storeIds]) : [];

  const blockedCigars = new Set([...realReviews, ...realHumidor, ...realSmokeList].map(r => r.cigar_id));

  return {
    cigars, stores, users, cigarIds, storeIds, userIds,
    realReviews, realHumidor, realSmokeList, realFollows,
    blockedCigars,
    deletableCigars: cigars.filter(c => !blockedCigars.has(c.id)),
  };
}

async function purge({ confirm = false, force = false, log = console.log } = {}) {
  const p = await plan();
  // --force also clears a real account's own rows against a placeholder cigar,
  // which is test data the owner created while trying the app out.
  if (force) {
    p.blockedCigars = new Set();
    p.deletableCigars = p.cigars;
  }

  log(`demo cigars found : ${p.cigars.length}`);
  log(`demo stores found : ${p.stores.length}  (${p.stores.map(s => s.name).join(', ') || 'none'})`);
  log(`demo accounts     : ${p.users.length}  (${p.users.map(u => u.email).join(', ') || 'none'})`);
  log(`real reviews on demo cigars    : ${p.realReviews.length}${p.realReviews.length ? ' by ' + [...new Set(p.realReviews.map(r => r.email))].join(', ') : ''}`);
  log(`real humidor rows on demo cigars: ${p.realHumidor.length}`);
  log(`real smoke-list rows            : ${p.realSmokeList.length}`);
  log(`real follows of demo stores     : ${p.realFollows.length}${p.realFollows.length ? ' by ' + [...new Set(p.realFollows.map(r => r.email))].join(', ') : ''}`);
  if (p.blockedCigars.size) {
    log(`SPARED (a real account uses them): ${[...p.blockedCigars].join(', ')}`);
  }
  log(`will delete: ${p.deletableCigars.length} cigars, ${p.stores.length} stores, ${p.users.length} accounts`);

  if (!confirm) {
    log('\nDry run. Nothing was deleted. Re-run with --confirm to apply.');
    return { dryRun: true, ...counts(p) };
  }

  const cigarIds = p.deletableCigars.map(c => c.id);
  const storeIds = p.storeIds;
  const userIds = p.userIds;
  const done = {};
  const run = async (label, sql, params) => {
    const r = await db.run(sql, params);
    done[label] = r.changes || 0;
  };

  // Children first: no foreign key is declared ON DELETE CASCADE for these.
  if (storeIds.length) {
    await run('deals', 'DELETE FROM deals WHERE store_id = ANY($1)', [storeIds]);
    await run('inventory_by_store', 'DELETE FROM inventory WHERE store_id = ANY($1)', [storeIds]);
    await run('inventory_requests', 'DELETE FROM inventory_requests WHERE store_id = ANY($1)', [storeIds]);
    await run('notification_reads', 'DELETE FROM notification_reads WHERE notification_id IN (SELECT id FROM notifications WHERE store_id = ANY($1))', [storeIds]);
    await run('notifications', 'DELETE FROM notifications WHERE store_id = ANY($1)', [storeIds]);
    await run('event_rsvps', 'DELETE FROM event_rsvps WHERE event_id IN (SELECT id FROM store_events WHERE store_id = ANY($1))', [storeIds]);
    await run('store_events', 'DELETE FROM store_events WHERE store_id = ANY($1)', [storeIds]);
    await run('community_likes', 'DELETE FROM community_likes WHERE post_id IN (SELECT id FROM community_posts WHERE store_id = ANY($1))', [storeIds]);
    await run('community_replies', 'DELETE FROM community_replies WHERE post_id IN (SELECT id FROM community_posts WHERE store_id = ANY($1))', [storeIds]);
    await run('community_posts', 'DELETE FROM community_posts WHERE store_id = ANY($1)', [storeIds]);
    await run('store_follows', 'DELETE FROM store_follows WHERE store_id = ANY($1)', [storeIds]);
    await run('store_ratings', 'DELETE FROM store_ratings WHERE store_id = ANY($1)', [storeIds]);
    await run('store_views', 'DELETE FROM store_views WHERE store_id = ANY($1)', [storeIds]);
    await run('store_reports', 'DELETE FROM store_reports WHERE store_id = ANY($1)', [storeIds]);
    await run('store_claims', 'DELETE FROM store_claims WHERE store_id = ANY($1)', [storeIds]);
    await run('verification_requests', 'DELETE FROM verification_requests WHERE store_id = ANY($1)', [storeIds]);
    await run('cigar_images_by_store', 'DELETE FROM cigar_images WHERE store_id = ANY($1)', [storeIds]);
    await run('stores', 'DELETE FROM stores WHERE id = ANY($1)', [storeIds]);
  }

  if (cigarIds.length) {
    await run('inventory_by_cigar', 'DELETE FROM inventory WHERE cigar_id = ANY($1)', [cigarIds]);
    await run('reviews', 'DELETE FROM reviews WHERE cigar_id = ANY($1)', [cigarIds]);
    await run('user_cigars', 'DELETE FROM user_cigars WHERE cigar_id = ANY($1)', [cigarIds]);
    await run('smoke_list', 'DELETE FROM smoke_list WHERE cigar_id = ANY($1)', [cigarIds]);
    await run('cigar_follows', 'DELETE FROM cigar_follows WHERE cigar_id = ANY($1)', [cigarIds]);
    await run('cigar_images_by_cigar', 'DELETE FROM cigar_images WHERE cigar_id = ANY($1)', [cigarIds]);
    await run('catalog_pending_refs', 'UPDATE catalog_pending SET suggested_cigar_id = NULL WHERE suggested_cigar_id = ANY($1)', [cigarIds]);
    await run('community_post_refs', 'UPDATE community_posts SET cigar_id = NULL WHERE cigar_id = ANY($1)', [cigarIds]);
    await run('deal_refs', 'UPDATE deals SET cigar_id = NULL WHERE cigar_id = ANY($1)', [cigarIds]);
    await run('notification_refs', 'UPDATE notifications SET cigar_id = NULL WHERE cigar_id = ANY($1)', [cigarIds]);
    await run('inventory_request_refs', 'UPDATE inventory_requests SET cigar_id = NULL WHERE cigar_id = ANY($1)', [cigarIds]);
    await run('vitolas', 'DELETE FROM vitolas WHERE cigar_id = ANY($1)', [cigarIds]);
    await run('cigars', 'DELETE FROM cigars WHERE id = ANY($1)', [cigarIds]);
  }

  if (userIds.length) {
    await run('user_reviews', 'DELETE FROM reviews WHERE user_id = ANY($1)', [userIds]);
    await run('user_humidor', 'DELETE FROM user_cigars WHERE user_id = ANY($1)', [userIds]);
    await run('user_smoke_list', 'DELETE FROM smoke_list WHERE user_id = ANY($1)', [userIds]);
    await run('user_cigar_follows', 'DELETE FROM cigar_follows WHERE user_id = ANY($1)', [userIds]);
    await run('user_store_follows', 'DELETE FROM store_follows WHERE user_id = ANY($1)', [userIds]);
    await run('user_store_ratings', 'DELETE FROM store_ratings WHERE user_id = ANY($1)', [userIds]);
    await run('user_notification_reads', 'DELETE FROM notification_reads WHERE user_id = ANY($1)', [userIds]);
    await run('user_community_likes', 'DELETE FROM community_likes WHERE user_id = ANY($1)', [userIds]);
    await run('user_community_replies', 'DELETE FROM community_replies WHERE user_id = ANY($1)', [userIds]);
    await run('user_community_posts', 'DELETE FROM community_posts WHERE user_id = ANY($1)', [userIds]);
    await run('user_event_rsvps', 'DELETE FROM event_rsvps WHERE user_id = ANY($1)', [userIds]);
    await run('user_store_events', 'DELETE FROM store_events WHERE created_by = ANY($1)', [userIds]);
    await run('user_inventory_requests', 'DELETE FROM inventory_requests WHERE user_id = ANY($1)', [userIds]);
    await run('user_store_claims', 'DELETE FROM store_claims WHERE user_id = ANY($1)', [userIds]);
    await run('user_follows_a', 'DELETE FROM user_follows WHERE follower_id = ANY($1) OR followed_id = ANY($1)', [userIds]);
    await run('user_password_resets', 'DELETE FROM password_resets WHERE user_id = ANY($1)', [userIds]);
    await run('orphan_stores', 'UPDATE stores SET user_id = NULL, claimed = 0 WHERE user_id = ANY($1)', [userIds]);
    await run('users', 'DELETE FROM users WHERE id = ANY($1)', [userIds]);
  }

  log('\ndeleted:');
  for (const [k, v] of Object.entries(done)) if (v) log(`  ${k}: ${v}`);

  const left = await db.get(`SELECT
    (SELECT COUNT(*) FROM cigars)::int AS cigars,
    (SELECT COUNT(*) FROM stores WHERE claimed = 1)::int AS claimed_stores,
    (SELECT COUNT(*) FROM users)::int AS users`);
  log(`\nremaining: ${left.cigars} cigars, ${left.claimed_stores} claimed stores, ${left.users} accounts`);
  return { ...counts(p), deleted: done, remaining: left };
}

function counts(p) {
  return {
    demo_cigars: p.cigars.length,
    demo_stores: p.stores.length,
    demo_users: p.users.length,
    spared_cigars: [...p.blockedCigars],
  };
}

if (require.main === module) {
  purge({ confirm: process.argv.includes('--confirm'), force: process.argv.includes('--force') })
    .then(() => process.exit(0))
    .catch(err => { console.error(err); process.exit(1); });
}

module.exports = { purge, plan };
