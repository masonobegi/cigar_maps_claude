/**
 * The test run: show only the listings every fact of which is backed.
 *
 * Mason, on 2026-09-12: "if any stores arent perfect right now just take them
 * off also, this should just be a test run. perfect meaning like your 100% sure
 * of its contents."
 *
 * So a listing stays public only when all four hold:
 *
 *   it is a cigar shop     the pure-cigar check kept it, and it is not a
 *                          duplicate or a chain counter
 *   the website is live    and still the shop's own (ok or blocked, after the
 *                          hijack and elsewhere checks)
 *   the hours came from    hours_source = 'website' — read off that page, never
 *   that website           from map data
 *   the door is backed     a current tobacco licence at this address, or the
 *                          shop's own site prints this street, or both
 *                          geocoders put the pin on it
 *
 * Everything else is hidden as 'unverified' — which is not a judgement about
 * the shop. It says only that we cannot yet stand behind every line on its
 * card. The reason on each row names the piece that is missing, so the set can
 * be rebuilt as the evidence arrives.
 *
 * To put them all back:
 *   UPDATE stores SET visible = 1, storefront = 'yes', storefront_reason = NULL
 *   WHERE storefront = 'unverified';
 *
 *   DRY=1 node sweeps/scripts/keep_only_certain.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const db = require('../../server/src/database/db');

const file = path.join(__dirname, '..', 'decisions', 'certain.json');
const certain = JSON.parse(fs.readFileSync(file, 'utf8'));
const keep = new Map((certain.rows || []).map(r => [r.id, r]));

(async () => {
  const rows = await db.all(`
    SELECT id, name, city, state, website_status, hours_source, hours, storefront, claimed, staff_edited
    FROM stores WHERE visible = 1 ORDER BY id`);

  let hidden = 0, locked = 0;
  const why = {};
  for (const s of rows) {
    if (keep.has(s.id)) continue;
    if (Number(s.claimed) === 1 || Number(s.staff_edited) === 1) { locked++; continue; }

    const missing = [];
    if (s.storefront === 'unproven' || s.storefront === 'duplicate') missing.push('it has not proved it is a cigar shop');
    if (!(s.website_status === 'ok' || s.website_status === 'blocked')) missing.push('no live website of its own');
    if (!(s.hours_source === 'website' && s.hours)) missing.push('no hours read from its own website');
    if (!missing.length) missing.push('nothing independently backs its address');
    const reason = `held back from the verified set: ${missing.join('; ')}`;
    why[missing[0]] = (why[missing[0]] || 0) + 1;

    if (process.env.DRY !== '1') {
      await db.run(`UPDATE stores SET visible = 0, storefront = 'unverified', storefront_reason = ?,
        storefront_checked_at = NOW() WHERE id = ?`, [reason.slice(0, 300), s.id]);
    }
    hidden++;
  }

  const n = await db.get(`SELECT
      COUNT(*) FILTER (WHERE visible = 1)::int AS public,
      COUNT(*) FILTER (WHERE visible = 1 AND hours IS NOT NULL)::int AS hours,
      COUNT(*) FILTER (WHERE visible = 1 AND web_image_url IS NOT NULL)::int AS pics,
      COUNT(*) FILTER (WHERE visible = 1 AND has_lounge = 1)::int AS lounge,
      COUNT(*) FILTER (WHERE visible = 0 AND storefront = 'unverified')::int AS held
    FROM stores`);

  console.log(`${process.env.DRY === '1' ? 'would hide' : 'hid'} ${hidden} listings, first reason each:`);
  for (const [k, v] of Object.entries(why).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(5)}  ${k}`);
  if (locked) console.log(`left ${locked} claimed or staff-edited listings alone`);
  console.log(`\npublic now: ${n.public} listings — ${n.hours} with hours, ${n.pics} with a picture, ${n.lounge} with a lounge badge`);
  console.log(`held back as 'unverified': ${n.held}`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
