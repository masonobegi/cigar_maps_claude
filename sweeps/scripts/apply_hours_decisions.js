/**
 * Apply the reviewed hours decisions (handoff task 1).
 *
 * Read row by row before applying, and four of the eight replacements were
 * changed by hand. What was written and why is in SWEEPS.md; in short:
 *   #3032  skipped  — the new read is a truncated page, it would lose Fri-Sun
 *   #9843  cleared  — both readings are the host casino's, not the lounge's
 *   #9541  split    — the site says "Friday 12pm-6pm & 7pm-10pm", both shifts
 *   #20766 seasonal — the page prints two seasons; September is the first one
 *
 * Guards: the row must still hold the hours that were reviewed, must still be
 * sourced from the shop's own website, and must be neither claimed nor
 * staff-edited. Anything that moved since the review is reported, not written.
 *
 *   node sweeps/scripts/apply_hours_decisions.js          # local
 *   railway run --service Postgres node <prod.js> <this>  # production
 */
'use strict';

const fs = require('fs');
const path = require('path');
const db = require('../../server/src/database/db');

const dir = path.join(__dirname, '..', 'decisions', 'hours');
const read = name => {
  const doc = JSON.parse(fs.readFileSync(path.join(dir, name + '.json'), 'utf8'));
  return Array.isArray(doc) ? doc : (doc.rows || []);
};

// The four hand decisions, keyed by listing.
const BY_HAND = {
  3032: { action: 'skip', why: 'the replacement comes from a page that stopped at Friday' },
  9843: { action: 'clear', why: 'the hours on littlecreek.com are the casino\'s, not the lounge\'s' },
  9541: {
    action: 'write', why: 'the site writes Friday as two shifts with an hour shut between them',
    hours: { Mon: '12pm-6pm', Tue: '12pm-6pm', Wed: '12pm-6pm', Thu: '12pm-6pm',
             Fri: '12pm-6pm, 7pm-10pm', Sat: '12pm-5pm', Sun: 'Closed' },
  },
  20766: {
    action: 'write', why: 'the page prints September-April beside May-August; September is the season running now',
    hours: { Sun: '12pm-10pm', Mon: '4pm-12am', Tue: '4pm-9pm', Wed: '4pm-9pm' },
  },
};

const same = (a, b) => JSON.stringify(a || null) === JSON.stringify(b || null);
const parse = v => { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return null; } };

async function main() {
  const clearRows = read('hours_clear').map(r => ({ ...r, action: 'clear', why: r.why }));
  for (const r of read('hours_replace')) {
    const hand = BY_HAND[r.id];
    if (hand) clearRows.push({ ...r, ...hand });
    else clearRows.push({ ...r, action: 'write', hours: r.now, why: 'a closer read of the same page' });
  }

  const done = { clear: 0, write: 0, skip: 0 };
  const moved = [], locked = [];
  for (const row of clearRows) {
    if (row.action === 'skip') { done.skip++; continue; }
    const s = await db.get('SELECT id, name, hours, hours_source, claimed, staff_edited FROM stores WHERE id = ?', [row.id]);
    if (!s) { moved.push(`${row.id} gone`); continue; }
    if (Number(s.claimed) === 1 || Number(s.staff_edited) === 1 || s.hours_source === 'owner') { locked.push(row.id); continue; }
    if (!same(parse(s.hours), row.was)) { moved.push(`${row.id} ${s.name}`); continue; }

    if (process.env.DRY === '1') {
      console.log(`  ${row.action === 'clear' ? 'clear ' : 'write '} #${row.id} ${s.name}` +
        (row.action === 'write' ? ` -> ${JSON.stringify(row.hours)}` : '') + `  (${row.why})`);
      done[row.action]++;
      continue;
    }
    if (row.action === 'clear') {
      await db.run(`UPDATE stores SET hours = NULL, hours_source = NULL, hours_checked_at = NOW() WHERE id = ?`, [row.id]);
      done.clear++;
    } else {
      await db.run(`UPDATE stores SET hours = ?, hours_source = 'website', hours_checked_at = NOW() WHERE id = ?`,
        [JSON.stringify(row.hours), row.id]);
      done.write++;
    }
  }

  const n = await db.get(`SELECT
      COUNT(*) FILTER (WHERE visible = 1)::int AS public,
      COUNT(*) FILTER (WHERE visible = 1 AND hours_source = 'website')::int AS from_site,
      COUNT(*) FILTER (WHERE visible = 1 AND hours IS NOT NULL)::int AS any_hours
    FROM stores`);
  console.log(`cleared ${done.clear} schedules the evidence no longer supports`);
  console.log(`wrote ${done.write} re-read from the same page, skipped ${done.skip}`);
  if (locked.length) console.log(`left ${locked.length} alone: claimed, staff-edited or owner-set (${locked.join(', ')})`);
  if (moved.length) console.log(`${moved.length} had already changed since the review: ${moved.slice(0, 20).join(' | ')}`);
  console.log(`\n${n.public} public listings: ${n.any_hours} with hours, ${n.from_site} of them from the shop's own site`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
