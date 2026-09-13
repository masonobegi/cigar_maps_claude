/**
 * Take the researched verdicts off the map — reversibly, and only after a human
 * has read the list.
 *
 * This is the write half of the sweep that started with #10184 Cascade Cigar &
 * Tobacco: public, with full opening hours, shut for six months, noticed by
 * somebody who lives next door. The research half is
 * sweeps/workflows/prove-shops-open.js; this only carries its answers into the
 * database.
 *
 * THE RULE IT IMPLEMENTS, in the owner's words:
 *
 *   "only keep stores you are 100% sure are open ... this should not be innocent
 *    until proven guilty this should be guilty until proven innocent"
 *
 * So a listing stays public only if research found positive evidence it trades
 * now AND that it is a cigar shop, and a second agent failed to refute it.
 * Anything else comes off.
 *
 * FOUR THINGS THIS GETS RIGHT, EACH OF WHICH HAS BEEN GOT WRONG BEFORE:
 *
 *  1. Hiding survives the next deploy. importStores.js recomputes `visible`
 *     from the classifier on every boot; a regression once put 519 hidden
 *     listings back on the map, including a brewery. It honours only
 *     storefront IN ('not_retail','online_only','closed','duplicate','moved',
 *     'unproven','unverified') or staff_edited = 1. Every verdict written here
 *     is one of the first three, so every hide sticks.
 *  2. Nothing is deleted. visible = 0 plus a reason, through writeFields, so
 *     store_edits holds the before value and one statement puts any of it back.
 *  3. Claimed and staff-edited listings are not touched. source: 'rule' makes
 *     writeFields skip them, which is rule 4 in the owner's rules and not
 *     something this script should be arguing about.
 *  4. It refuses to run on a file nobody has approved. The decisions file must
 *     carry approved: true — set it only after the list has actually been read.
 *
 *   DRY=1 railway run --service Postgres node sweeps/scripts/prod.js <abs path>
 *         railway run --service Postgres node sweeps/scripts/prod.js <abs path>
 *
 *   FILE=sweeps/decisions/open_sweep_decisions.json   (default)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const db = require('../../server/src/database/db');
const { writeFields } = require('../../server/src/utils/storeEdits');

const DRY = process.env.DRY === '1';
const FILE = process.env.FILE || path.join(__dirname, '..', 'decisions', 'open_sweep_decisions.json');

/** The verdicts that hide a listing, and what each one means. */
const HIDE = {
  closed: 'the shop has shut',
  not_retail: 'not a cigar shop under the scope rule',
  unproven: 'nothing found that shows it is trading now',
  duplicate: 'the same shop is already in the directory under another row',
};

(async () => {
  const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const { approved, decisions, note } = raw;

  if (!Array.isArray(decisions)) {
    console.error('the file has no `decisions` array');
    process.exit(1);
  }
  if (!DRY && approved !== true) {
    console.error('refusing to write: the decisions file is not marked approved.');
    console.error('Read the list, then set "approved": true in the file. Or run with DRY=1.');
    process.exit(1);
  }
  if (note) console.log(`${note}\n`);

  const keep = decisions.filter(d => d.decision === 'keep');
  const drop = decisions.filter(d => d.decision !== 'keep');
  const bad = drop.filter(d => !HIDE[d.decision]);
  if (bad.length) {
    console.error(`unknown verdict on ${bad.length} rows, e.g. #${bad[0].id} "${bad[0].decision}"`);
    console.error(`allowed: keep, ${Object.keys(HIDE).join(', ')}`);
    process.exit(1);
  }

  console.log(`${decisions.length} researched listings`);
  console.log(`  keep  ${keep.length}`);
  for (const k of Object.keys(HIDE)) {
    const n = drop.filter(d => d.decision === k).length;
    console.log(`  ${k.padEnd(12)}${String(n).padStart(4)}   ${HIDE[k]}`);
  }

  const before = await db.get('SELECT COUNT(*) FILTER (WHERE visible = 1)::int AS n FROM stores');
  console.log(`\npublic now: ${before.n}`);
  console.log(`${DRY ? 'would hide' : 'hiding'} ${drop.length}\n`);

  const stamp = new Date().toISOString();
  let hidden = 0;
  const skipped = [];

  for (const d of drop) {
    const row = await db.get('SELECT id, name, city, state, visible, claimed, staff_edited FROM stores WHERE id = ?', [d.id]);
    if (!row) { skipped.push({ id: d.id, why: 'no such listing' }); continue; }
    if (Number(row.visible) === 0) { skipped.push({ id: d.id, why: 'already hidden' }); continue; }
    if (Number(row.claimed) === 1 || Number(row.staff_edited) === 1) {
      skipped.push({ id: d.id, why: 'claimed or staff-edited — a sweep does not argue with the shop itself' });
      continue;
    }

    // The evidence goes in the reason, so anybody looking at a hidden listing
    // can see what decided it without going back to a decisions file.
    const reason = `${HIDE[d.decision]}: ${String(d.reason || d.evidence || '').replace(/\s+/g, ' ').trim()}`.slice(0, 300);

    if (DRY) {
      console.log(`  would hide #${String(d.id).padEnd(6)} ${String(d.name).slice(0, 32).padEnd(32)} ${d.decision.padEnd(11)} ${reason.slice(0, 70)}`);
      hidden++;
      continue;
    }

    const written = await writeFields(d.id, {
      visible: 0,
      storefront: d.decision,
      storefront_reason: reason,
      storefront_checked_at: stamp,
    }, { source: 'rule', job: 'proveOpen', reason });

    if (written.includes('visible')) hidden++;
    else skipped.push({ id: d.id, why: `writeFields wrote nothing (${written.join(',') || 'no fields'})` });
  }

  // Every researched listing records what was found, keeps included.
  //
  // This is what verifiedSet reads before it publishes anything. Without it a
  // listing that gains hours next month gets published on the same four checks
  // Cascade Cigar passed while shut, and the directory quietly refills with
  // shops nobody has looked at. Writing it for the keeps is the half that
  // matters: the drops are already hidden.
  let stamped = 0;
  for (const d of decisions) {
    const verdict = d.decision === 'keep' ? 'open' : d.decision;
    if (DRY) { stamped++; continue; }
    const r = await db.run(
      `UPDATE stores SET open_verdict = ?, open_checked_at = ?
        WHERE id = ? AND COALESCE(claimed, 0) = 0 AND COALESCE(staff_edited, 0) = 0`,
      [verdict, stamp, d.id]);
    stamped += r.changes || 0;
  }
  console.log(`${DRY ? 'would stamp' : 'stamped'} ${stamped} listings with what the research found`);

  console.log(`\n${DRY ? 'would hide' : 'hid'} ${hidden}`);
  if (skipped.length) {
    console.log(`skipped ${skipped.length}:`);
    const why = {};
    for (const s of skipped) why[s.why] = (why[s.why] || 0) + 1;
    for (const [k, v] of Object.entries(why)) console.log(`  ${String(v).padStart(4)}  ${k}`);
  }

  if (!DRY) {
    const after = await db.get(`SELECT
      COUNT(*) FILTER (WHERE visible = 1)::int AS public,
      COUNT(*) FILTER (WHERE storefront = 'closed')::int AS closed,
      COUNT(*) FILTER (WHERE storefront = 'not_retail')::int AS not_retail,
      COUNT(*) FILTER (WHERE storefront = 'unproven')::int AS unproven
      FROM stores`);
    console.log(`\npublic listings: ${before.n} -> ${after.public}`);
    console.log(`  storefront: ${after.closed} closed, ${after.not_retail} not_retail, ${after.unproven} unproven`);
    console.log(`\nEvery one of those verdicts is in importStores.js's ruledOut list, so they stay hidden across deploys.`);
    console.log(`To put one back:  UPDATE stores SET visible = 1, storefront = 'yes' WHERE id = <id>;`);
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
