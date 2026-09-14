/**
 * The drop list, written so a person can actually read it.
 *
 * 184 listings is too many to check one by one, so this groups them by why they
 * are going and leads with the ones most worth a second opinion: the closures,
 * the out-of-scope calls, and the listings dropped despite a current state
 * licence at the door.
 *
 *   node sweeps/scripts/review_drop_list.js            # summary to the terminal
 *   node sweeps/scripts/review_drop_list.js --full     # every row, with evidence
 */
'use strict';

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'decisions', 'open_sweep_decisions.json');
const OUT = path.join(__dirname, '..', 'decisions', 'DROP_LIST.md');
const full = process.argv.includes('--full');

const trim = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

(() => {
  const d = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const rows = d.decisions;
  const drop = rows.filter(r => r.decision !== 'keep');
  const keep = rows.filter(r => r.decision === 'keep');

  const by = k => drop.filter(r => r.decision === k);
  const out = [];
  const say = s => { out.push(s); console.log(s); };

  say(`# The drop list`);
  say(``);
  say(`**${rows.length} listings researched. ${keep.length} stay, ${drop.length} come off.**`);
  say(``);
  say(`| verdict | n | what it means |`);
  say(`|---|---|---|`);
  say(`| closed | ${by('closed').length} | the shop has shut |`);
  say(`| not_retail | ${by('not_retail').length} | trading, but not a cigar shop under the scope rule |`);
  say(`| duplicate | ${by('duplicate').length} | the same shop is already in the directory |`);
  say(`| unproven | ${by('unproven').length} | nothing found that shows it is trading now |`);
  say(``);
  say(`Nothing here is deleted. Every row keeps its reason and one statement puts it back.`);
  say(``);

  // ── closures ──────────────────────────────────────────────────────────────
  say(`## Closed (${by('closed').length})`);
  say(``);
  say(`These have an explicit closure marker, a different business at the address, or`);
  say(`a dated news item. The strongest evidence in the whole sweep.`);
  say(``);
  for (const r of by('closed')) {
    say(`- **#${r.id} ${r.name}** — ${trim(r.where, 50)}`);
    say(`  ${trim(r.reason, 260)}`);
  }
  say(``);

  // ── out of scope ──────────────────────────────────────────────────────────
  say(`## Not a cigar shop (${by('not_retail').length})`);
  say(``);
  say(`Trading, but outside the rule: vape and smoke shops, restaurants and bars with a`);
  say(`cigar room, hookah lounges, liquor stores, manufacturers with no storefront.`);
  say(``);
  for (const r of by('not_retail')) {
    say(`- **#${r.id} ${r.name}** — ${trim(r.shopKind || r.deepStatus || '', 80)}`);
    if (full) say(`  ${trim(r.reason, 240)}`);
  }
  say(``);

  // ── duplicates ────────────────────────────────────────────────────────────
  if (by('duplicate').length) {
    say(`## The same shop twice (${by('duplicate').length})`);
    say(``);
    for (const r of by('duplicate')) {
      say(`- **#${r.id} ${r.name}** — ${trim(r.reason, 300)}`);
    }
    say(``);
  }

  // ── unproven, the judgement pile ──────────────────────────────────────────
  const unp = by('unproven');
  const withLicence = unp.filter(r => r.licenceVerdict === 'verified');
  say(`## Unproven (${unp.length})`);
  say(``);
  say(`No closure marker, but nothing showing it trades now either. Under the rule`);
  say(`— guilty until proven innocent — these come off. **${withLicence.length} of them hold a current`);
  say(`state tobacco licence**, which is the group most worth your eye, so they are listed first.`);
  say(``);
  if (withLicence.length) {
    say(`### Dropped despite a current licence at the door (${withLicence.length})`);
    say(``);
    for (const r of withLicence) {
      say(`- **#${r.id} ${r.name}** — ${trim(r.where, 46)}`);
      say(`  ${trim(r.reason, 240)}`);
    }
    say(``);
  }
  say(`### The rest (${unp.length - withLicence.length})`);
  say(``);
  for (const r of unp.filter(r => r.licenceVerdict !== 'verified')) {
    say(`- **#${r.id} ${r.name}** — ${trim(r.where, 44)}`);
    if (full) say(`  ${trim(r.reason, 220)}`);
  }
  say(``);

  fs.writeFileSync(OUT, out.join('\n'));
  console.log(`\n\nwritten to ${OUT}`);
})();
