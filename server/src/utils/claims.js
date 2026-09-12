const db = require('../database/db');
const { sendMail } = require('./email');

const APP_URL = process.env.APP_URL || 'https://cigarmapsclaude-production.up.railway.app';

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

/**
 * Attach a store to the claiming user. Used by both the self-serve email code
 * flow (verify=false) and admin approval (verify=true, which also grants the
 * verified badge since a human checked the proof). Only a staff approval can
 * surface a listing that staff hid; self-serve keeps the visibility as is.
 */
async function approveClaim(claimId, { verify = false, adminNotes = null } = {}) {
  const claim = await db.get('SELECT * FROM store_claims WHERE id = ?', [claimId]);
  if (!claim) throw httpError(404, 'Claim not found');
  if (claim.status !== 'pending') throw httpError(409, 'Claim has already been reviewed');

  const store = await db.get('SELECT * FROM stores WHERE id = ?', [claim.store_id]);
  if (!store) throw httpError(404, 'Store not found');
  if (store.claimed || store.user_id) throw httpError(409, 'Store is already claimed');
  // A listing that duplicates another must never be claimed: approving it puts
  // a second pin on the map for one shop, and the owner then maintains the
  // wrong one. The canonical listing's id is in storefront_reason.
  if (store.storefront === 'duplicate') {
    throw httpError(409, `That listing duplicates another one${store.storefront_reason ? ` — ${store.storefront_reason}` : ''}. Claim the original instead.`);
  }
  // Self-serve never un-hides a listing. Staff hid #10022 Broadway Cigar
  // Company after confirming it closed; approving a claim on it would have put
  // it back on the map with a green verified check. Reopening is its own
  // decision, through /admin/closures/:id/reopen, with its reason recorded.
  if (!store.visible && !verify) {
    throw httpError(409, 'That listing is not on the public map. A member of staff has to review it before it can be claimed.');
  }

  const already = await db.get('SELECT id FROM stores WHERE user_id = ?', [claim.user_id]);
  if (already) throw httpError(409, 'That account already manages another store');

  await db.run(`
    UPDATE stores
    SET user_id = ?, claimed = 1, claimed_at = NOW(), last_verified_at = NOW()
        ${verify ? ', verified = 1, visible = 1' : ''}
    WHERE id = ?
  `, [claim.user_id, store.id]);

  await db.run(`UPDATE store_claims SET status = 'approved', admin_notes = ?, reviewed_at = NOW() WHERE id = ?`, [adminNotes, claimId]);
  await db.run(`
    UPDATE store_claims SET status = 'rejected', admin_notes = 'Store was claimed by another account', reviewed_at = NOW()
    WHERE store_id = ? AND status = 'pending' AND id <> ?
  `, [store.id, claimId]);

  notifyClaimant(claim.user_id, {
    subject: `Your claim for ${store.name} was approved`,
    text: `Good news: you now manage ${store.name} on CigarBuddy.\n\nOpen your store dashboard to fix hours, add inventory, and post deals:\n${APP_URL}/store-dashboard\n\n— CigarBuddy`,
    html: `<p>Good news: you now manage <strong>${store.name}</strong> on CigarBuddy.</p><p><a href="${APP_URL}/store-dashboard">Open your store dashboard</a> to fix hours, add inventory, and post deals.</p>`,
  });

  return db.get('SELECT * FROM stores WHERE id = ?', [store.id]);
}

async function rejectClaim(claimId, adminNotes) {
  const claim = await db.get('SELECT * FROM store_claims WHERE id = ?', [claimId]);
  if (!claim) throw httpError(404, 'Claim not found');
  const notes = adminNotes || 'Claim not approved. Reply to this notice with proof of ownership to try again.';
  await db.run(`UPDATE store_claims SET status = 'rejected', admin_notes = ?, reviewed_at = NOW() WHERE id = ?`, [notes, claimId]);

  const store = await db.get('SELECT name FROM stores WHERE id = ?', [claim.store_id]);
  const storeName = store ? store.name : 'the listing';
  notifyClaimant(claim.user_id, {
    subject: `Your claim for ${storeName} was not approved`,
    text: `We could not approve your claim for ${storeName} on CigarBuddy.\n\nNote from our team: ${notes}\n\nYou can submit a new claim with more proof from the listing page:\n${APP_URL}/stores/${claim.store_id}\n\n— CigarBuddy`,
    html: `<p>We could not approve your claim for <strong>${storeName}</strong> on CigarBuddy.</p><p>Note from our team: ${notes}</p><p>You can <a href="${APP_URL}/stores/${claim.store_id}">submit a new claim</a> with more proof from the listing page.</p>`,
  });
}

/** Email the claimant about a decision. Fire and forget; sendMail never rejects and no-ops without SMTP. */
function notifyClaimant(userId, { subject, text, html }) {
  db.get('SELECT email FROM users WHERE id = ?', [userId])
    .then(u => { if (u && u.email) return sendMail({ to: u.email, subject, text, html }); })
    .catch(err => console.error('[claims] claimant email failed:', err.message));
}

/** "example.com" from "example.com/path" or "shop.example.com" */
function rootDomain(host) {
  if (!host) return null;
  const h = String(host).toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0];
  const parts = h.split('.').filter(Boolean);
  if (parts.length < 2) return null;
  return parts.slice(-2).join('.');
}

// Hosts many businesses share a website on. A mailbox there proves nothing
// about who runs the shop, so these never qualify for instant verification.
const SHARED_HOSTS = new Set([
  'facebook.com', 'instagram.com', 'business.site', 'mybusiness.site', 'wixsite.com', 'weebly.com',
  'square.site', 'yelp.com', 'linktr.ee', 'godaddysites.com', 'google.com', 'squarespace.com',
  'wordpress.com', 'blogspot.com', 'twitter.com', 'x.com', 'tiktok.com', 'youtube.com', 'linkedin.com',
]);

/** The domain a claimant must receive email at for instant verification, or null when the website cannot prove ownership. */
function verifiableDomain(website) {
  const wd = rootDomain(website);
  if (!wd || SHARED_HOSTS.has(wd)) return null;
  return wd;
}

function emailMatchesWebsite(email, website) {
  const ed = rootDomain((email || '').split('@')[1]);
  const wd = verifiableDomain(website);
  return !!ed && !!wd && ed === wd;
}

module.exports = { approveClaim, rejectClaim, emailMatchesWebsite, verifiableDomain, rootDomain, httpError };
