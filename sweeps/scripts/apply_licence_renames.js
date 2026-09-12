/**
 * The 57 listings whose door holds a licence under another trading name.
 *
 * Read on 2026-09-12. They are three different things and get three different
 * answers:
 *
 *   the same name, formalised   "Cigars 09" -> "CIGARS 09", "E&A Cigars" ->
 *                               "E & A CIGARS LLC". Nothing to do.
 *   a licence holder            "SMITHANIO, LLC", "ABACUS INTERESTS, INC.",
 *                               "THE 3 OWNERS CORP." — the company that holds
 *                               the licence, not the name over the door. Not an
 *                               alias anybody would search for.
 *   another name in the trade   "TJ's Cigar Lounge" -> "TOBACCO JUNCTION",
 *                               "Egars" -> "NICE ASH CIGARS". Worth holding as
 *                               an alias so the shop is findable both ways.
 *
 * And one group that is not a rename at all: a door whose current licence
 * belongs to a liquor store, a feed company, a card room or a wholesaler. That
 * is a shop that may be gone, and it is a staff flag — never a hide, because a
 * licence at the same street number can be the unit next door.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const db = require('../../server/src/database/db');
const { isKnownOpen } = require('../../server/src/jobs/licenceSync');

const d = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'decisions', 'licences.json'), 'utf8'));

const fold = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const squash = s => fold(s).replace(/ /g, '');
const TRADE = /\b(cigar|cigars|tobacco|tobacconist|smoke|smokes|humidor|lounge|pipe|pipes|vape)\b/i;
const ENTITY = /\b(llc|inc|corp|incorporated|company|co|group|holdings|interests|enterprises|ventures|partners)\b\.?$/i;
// A door now licensed to a different trade: our cigar listing there may be gone.
const OTHER_TRADE = /\b(liquor|liquors|wine|beer|feed|grocery|grocer|market|deli|pharmacy|card house|casino|restaurant|cafe|barber|salon|laundry|wholesale|distributors?)\b/i;

const GENERIC = new Set(['cigar', 'cigars', 'tobacco', 'tobacconist', 'smoke', 'smokes', 'smoking', 'shop', 'shoppe',
  'store', 'lounge', 'bar', 'the', 'and', 'of', 'inc', 'llc', 'corp', 'co', 'company', 'house', 'humidor', 'club',
  'premium', 'fine', 'room', 'lounges']);

const distinctive = s => fold(s).split(' ').filter(w => w.length > 2 && !GENERIC.has(w));

(async () => {
  const alias = [], flag = [], same = [], holder = [];
  for (const r of d.renamed || []) {
    const ours = r.name, theirs = r.licence && r.licence.name;
    if (!theirs) continue;
    // The same name, punctuation and entity suffix aside.
    const bare = s => squash(String(s).replace(ENTITY, '').replace(/[#].*$/, ''));
    if (bare(ours) === bare(theirs) || bare(theirs).startsWith(bare(ours)) || bare(ours).startsWith(bare(theirs))) {
      same.push(r); continue;
    }
    // The shops the audit checked by hand are open, whoever else holds a
    // licence at that street number: Stogies World Class Cigars is next door
    // to the Texas Card House, not replaced by it.
    if (OTHER_TRADE.test(theirs)) { (isKnownOpen(ours) ? same : flag).push(r); continue; }
    // A licence holder: no word in common with our name, and nothing of the trade in it.
    const shares = distinctive(ours).some(w => distinctive(theirs).includes(w));
    if (!shares && !TRADE.test(theirs)) { holder.push(r); continue; }
    alias.push(r);
  }

  console.log(`the same name, formalised: ${same.length}`);
  console.log(`a licence holder, not a name over the door: ${holder.length}`);
  console.log(`another name in the trade, worth holding as an alias: ${alias.length}`);
  for (const r of alias) console.log(`   #${r.id} ${String(r.name).slice(0, 30).padEnd(32)} also "${r.licence.name}"`);
  console.log(`another trade at this door, for staff: ${flag.length}`);
  for (const r of flag) console.log(`   #${r.id} ${String(r.name).slice(0, 30).padEnd(32)} licence: "${r.licence.name}"`);

  if (process.env.DRY === '1') process.exit(0);

  let wrote = 0, flagged = 0;
  for (const r of alias) {
    const s = await db.get('SELECT name_aliases, claimed, staff_edited FROM stores WHERE id = ?', [r.id]);
    if (!s || Number(s.claimed) === 1 || Number(s.staff_edited) === 1) continue;
    const have = String(s.name_aliases || '').split('|').map(x => x.trim()).filter(Boolean);
    if (have.some(x => squash(x) === squash(r.licence.name))) continue;
    have.push(r.licence.name);
    await db.run('UPDATE stores SET name_aliases = ? WHERE id = ?', [have.join('|'), r.id]);
    wrote++;
  }
  for (const r of flag) {
    const res = await db.run(`UPDATE stores SET closed_reason = ?, closure_checked_at = NOW()
      WHERE id = ? AND visible = 1 AND operating_status IS NULL
        AND COALESCE(claimed, 0) = 0 AND COALESCE(staff_edited, 0) = 0`,
    [`licence registry: the current licence at this door is "${String(r.licence.name).slice(0, 80)}", another trade. `
      + 'A licence at the same street number can be the unit next door, so this is a flag, not a closure.', r.id]);
    flagged += res.changes;
  }
  console.log(`\nwrote ${wrote} aliases and flagged ${flagged} doors for staff`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
