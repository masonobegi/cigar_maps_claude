/**
 * The hours the browser pass recovered, read one by one.
 *
 * 1,231 held-back listings were opened in real Chrome; 409 showed hours-like
 * text and 21 produced hours that could be tied to the shop's own door. Those
 * 21 were read; four are refused:
 *
 *   #1335  CIGAR N SMOKE- Vape Shop — its own name, and its contact address is
 *          a vape brand's. Not a cigar shop; marked as such rather than left
 *          merely unverified, so no later pass tries again.
 *   #22067 Euphoria Cigar and Hookah Lounge — a hookah lounge that also sells
 *          cigars is the case the scope rule was written for. Same treatment.
 *   #9843  Skookum Creek Cigar Lounge — the hours are littlecreek.com's, which
 *          is the host casino. The same reading was cleared by hand this
 *          morning; the browser found it again and it is still not the lounge's.
 *   #3671  El Beso Cigars — its own page reads as a maker ("in production again
 *          making the small batch cigars you love") rather than a shop, and
 *          makers were deliberately taken off the map. Left held rather than
 *          judged either way.
 *
 * The other 17 publish their own hours on their own site. Writing them does not
 * make a listing public by itself: verifiedSet promotes it only if it also has
 * a live site of its own and a backed address, which is how it was chosen.
 *
 *   DRY=1 node sweeps/scripts/apply_recovered_hours.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const db = require('../../server/src/database/db');

const REFUSE = {
  1335: 'its own name is "CIGAR N SMOKE- Vape Shop" and its contact address is a vape brand\'s',
  22067: 'a hookah lounge that also sells cigars',
  9843: 'the hours belong to littlecreek.com, the host casino, not to the lounge',
  3671: 'its own page reads as a cigar maker rather than a shop',
};
/** The two that are not cigar shops at all, as opposed to merely unproven. */
const NOT_A_CIGAR_SHOP = [1335, 22067];

const D = path.join(__dirname, '..', 'decisions');

(async () => {
  const decisions = JSON.parse(fs.readFileSync(path.join(D, 'hours', 'recover.json'), 'utf8'));
  const held = new Set(JSON.parse(fs.readFileSync(path.join(D, 'render_queue.json'), 'utf8')).map(r => r.id));
  const rows = decisions.filter(x => x.hours && held.has(x.id));

  let wrote = 0, refused = 0, scoped = 0;
  for (const r of rows) {
    if (REFUSE[r.id]) {
      refused++;
      if (NOT_A_CIGAR_SHOP.includes(r.id) && process.env.DRY !== '1') {
        const res = await db.run(`UPDATE stores SET storefront = 'not_retail', storefront_reason = ?,
          storefront_checked_at = NOW() WHERE id = ? AND COALESCE(claimed, 0) = 0 AND COALESCE(staff_edited, 0) = 0`,
        [`not a cigar shop: ${REFUSE[r.id]}`.slice(0, 300), r.id]);
        scoped += res.changes;
      }
      console.log(`  refused #${r.id} ${String(r.name).slice(0, 30)} — ${REFUSE[r.id]}`);
      continue;
    }
    const s = await db.get('SELECT id, name, hours, hours_source, claimed, staff_edited FROM stores WHERE id = ?', [r.id]);
    if (!s || Number(s.claimed) === 1 || Number(s.staff_edited) === 1) continue;
    if (s.hours_source === 'website' && s.hours) continue;           // already has better
    if (process.env.DRY === '1') { console.log(`  would write #${r.id} ${s.name}`); wrote++; continue; }
    await db.run(`UPDATE stores SET hours = ?, hours_source = 'website', hours_checked_at = NOW() WHERE id = ?`,
      [JSON.stringify(r.hours), r.id]);
    wrote++;
  }

  console.log(`\n${process.env.DRY === '1' ? 'would write' : 'wrote'} hours for ${wrote}, refused ${refused}`
    + (scoped ? `, ${scoped} marked as not a cigar shop` : ''));
  const n = await db.get(`SELECT COUNT(*) FILTER (WHERE visible = 1)::int AS public,
    COUNT(*) FILTER (WHERE visible = 0 AND storefront = 'unverified')::int AS held FROM stores`);
  console.log(`${n.public} public, ${n.held} held back — verifiedSet promotes the ones that now qualify`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
