/**
 * The eight rows recomputeTimezones held back (handoff task 4).
 *
 * Each is a listing whose pin sits in a zone its state does not use, so the
 * clock "open now" is judged on could not be trusted either way. Five are
 * hidden and no customer sees them. The three public ones are settled here:
 *
 *   #5577 Cigar Mafia — the address, the ZIP, the phone and the pin all say
 *     Houston; only the state letter says New York. The state is the error.
 *   #5780 Cigar Crafted — a Salt Lake City address, a Houston pin, a toll-free
 *     number and a t-shirt shop for a website. Nothing in the row agrees with
 *     anything else, so there is nothing to repair: it comes off the map.
 *   #39731 Vip smoke and cigar — no address, no ZIP, no website; a California
 *     town, a Colorado state letter and a pin in empty Nevada. Same.
 */
'use strict';

const db = require('../../server/src/database/db');
const { writeFields } = require('../../server/src/utils/storeEdits');
const { timeZoneFor } = require('../../server/src/utils/storeHours');

(async () => {
  const fix = await db.get('SELECT id, name, lat, lng, state, timezone FROM stores WHERE id = 5577');
  if (fix && fix.state === 'NY') {
    const zone = timeZoneFor('TX', Number(fix.lat), Number(fix.lng));
    await writeFields(5577, { state: 'TX' },
      { source: 'geocode', job: 'settle_timezones', reason: 'the address, ZIP 77002, the 281 phone and the pin are all Houston; only the state letter said New York' });
    await db.run('UPDATE stores SET timezone = ? WHERE id = ?', [zone, 5577]);
    console.log(`#5577 Cigar Mafia: state NY -> TX, clock ${fix.timezone} -> ${zone}`);
  } else {
    console.log(`#5577 already settled (state ${fix && fix.state})`);
  }

  const hide = [
    [5780, 'a Salt Lake City address, a Houston pin, a toll-free number and a t-shirt shop for a website: no two facts in the row agree'],
    [39731, 'no address, no ZIP and no website; a California town, a Colorado state and a pin in empty Nevada'],
  ];
  for (const [id, why] of hide) {
    const s = await db.get('SELECT id, name, visible, claimed, staff_edited FROM stores WHERE id = ?', [id]);
    if (!s) { console.log(`#${id} gone`); continue; }
    if (Number(s.claimed) === 1 || Number(s.staff_edited) === 1) { console.log(`#${id} claimed or staff-edited, left alone`); continue; }
    if (Number(s.visible) === 0) { console.log(`#${id} ${s.name} already hidden`); continue; }
    await db.run(`UPDATE stores SET visible = 0, storefront = 'unproven', storefront_reason = ?, storefront_checked_at = NOW()
      WHERE id = ?`, [why, id]);
    console.log(`#${id} ${s.name}: hidden — ${why}`);
  }

  const left = await db.get(`SELECT COUNT(*) FILTER (WHERE visible = 1)::int AS n FROM stores`);
  console.log(`${left.n} public listings`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
