/**
 * The recoverable hours candidates, decided by hand.
 *
 * 292 listings with no hours had a readable block on a page already in the
 * evidence. 236 carried a refusal that still stands; the other 56 were read one
 * by one against the real listing. Most turned out to be a call centre, a
 * warehouse or a live-chat desk rather than a door — "Our Customer Service
 * Hours", "Live Support is available", "8:30AM Warehouse / 9:00AM Office",
 * a Connecticut shop showing a Strongsville, Ohio address, JR Cigar's
 * concierge line standing in for a shop in Absecon. Those are refused here in
 * writing so the next pass does not have to read them again.
 *
 * The 18 below print their own store hours, on their own domain, with one door
 * behind the page — the same standard decide() applies to the 423 it accepts.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const db = require('../../server/src/database/db');

const ACCEPT = {
  223:   'the page prints this door\'s address above "Hours"',
  815:   '"Store Hours", a day per line, on the shop\'s own domain',
  5185:  'a full week under the shop\'s own phone number',
  6422:  '"OPENING HOURS" on its own site; Sunday unreadable, so left unknown',
  7283:  '"Hours:" on its own site (its address there differs from ours — for the pins sweep)',
  7485:  '"Hours" beside the shop\'s own phone number',
  7702:  '"- HOURS - ... Everyday 11am - 9 pm / OPEN DAILY"',
  7712:  '"Store Hours" on its own domain',
  10597: 'a full week on the lounge\'s own site',
  12311: '"Business Hours" on the shop\'s own one-page site',
  14340: '"OPENING HOURS" above this door\'s address',
  15593: '"Hours" beside the branch\'s own address and email',
  15622: 'every branch on the page states the same hours',
  17482: '"Hours:" beside the shop\'s own phone number',
  17551: '"Hours of Operation" above this door\'s address',
  19193: '"Our Hours" above this door\'s address',
  19506: '"Opening Hours" above this door\'s address',
  19685: 'a full week beside the branch\'s own phone number',
};

const REFUSE = {
  719: 'office hours', 820: 'phone hours', 1015: 'office hours', 1019: 'unclear whose hours',
  1025: 'online shop support hours', 1027: 'warehouse and office hours', 1634: 'phone hours for an online humidor seller',
  1831: 'customer service hours', 3415: 'not a public listing', 6510: 'a header phone line, not a door',
  8127: 'office hours for a mobile lounge', 8374: 'support hours, quoted in GMT+1', 8755: 'already has hours',
  10817: 'the host convenience store\'s hours', 11287: 'booking and support hours for a pop-up',
  13585: 'support hours', 14047: 'not a public listing', 14066: 'not a public listing',
  14856: 'phone hours', 15188: 'customer service hours', 15476: 'the block was navigation, not hours',
  16333: 'not a public listing', 16672: 'already has hours', 17020: 'phone-order hours',
  17969: 'not a public listing', 18585: 'live-chat hours', 18586: 'live-chat hours',
  19573: 'the hours belong to the other branch printed on the page',
  19620: 'office hours', 19881: 'the hours belong to the Norfolk door, not this one',
  20553: 'the block was navigation, and the week came out missing two days',
  20929: 'JR Cigar\'s concierge line, not this shop', 21546: 'business hours quoted in CST for a New York address',
  21871: 'a manufacturer\'s phone hours at an industrial park', 22241: 'the page shows a Strongsville, Ohio address',
  22340: 'not a public listing', 39455: 'phone hours, and the listing has no address to match',
  42356: 'Serious Cigars\' call centre, not the bar',
};

const D = path.join(__dirname, '..', 'decisions', 'hours');

async function main() {
  const rows = (JSON.parse(fs.readFileSync(path.join(D, 'hours_recoverable.json'), 'utf8')).rows || [])
    .filter(r => r.standing_refusal === false);
  const unknown = rows.filter(r => !ACCEPT[r.id] && !REFUSE[r.id]).map(r => r.id);
  if (unknown.length) { console.error(`undecided: ${unknown.join(', ')}`); process.exit(1); }

  let wrote = 0; const skipped = [];
  for (const r of rows) {
    if (!ACCEPT[r.id]) continue;
    const s = await db.get('SELECT id, name, hours, claimed, staff_edited, visible FROM stores WHERE id = ?', [r.id]);
    if (!s || Number(s.visible) !== 1) { skipped.push(`${r.id} not public`); continue; }
    if (Number(s.claimed) === 1 || Number(s.staff_edited) === 1) { skipped.push(`${r.id} claimed or staff-edited`); continue; }
    if (s.hours) { skipped.push(`${r.id} already has hours`); continue; }
    if (process.env.DRY === '1') { console.log(`  #${r.id} ${s.name} -> ${JSON.stringify(r.hours)}  (${ACCEPT[r.id]})`); wrote++; continue; }
    await db.run(`UPDATE stores SET hours = ?, hours_source = 'website', hours_checked_at = NOW() WHERE id = ?`,
      [JSON.stringify(r.hours), r.id]);
    wrote++;
  }
  const n = await db.get(`SELECT COUNT(*) FILTER (WHERE visible = 1)::int AS public,
      COUNT(*) FILTER (WHERE visible = 1 AND hours IS NOT NULL)::int AS with_hours FROM stores`);
  console.log(`${process.env.DRY === '1' ? 'would write' : 'wrote'} hours for ${wrote} listings, refused ${Object.keys(REFUSE).length}`);
  if (skipped.length) console.log(`skipped: ${skipped.join(' | ')}`);
  console.log(`${n.public} public listings, ${n.with_hours} with hours`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
