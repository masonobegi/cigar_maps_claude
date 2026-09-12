/**
 * The 962 badges that rest on a map category and nothing else.
 *
 * A lounge or walk-in-humidor badge is the thing a smoker scans a card for, and
 * these came from Overture's `cigar_lounge` store type — not from anything the
 * shop said. The amenity crawl read 2,408 websites and could put a sentence
 * behind 675 badges; these are the ones it could not, because the shop has no
 * website (417 of them), or the site does not answer, or it never mentions a
 * lounge.
 *
 * Read on 2026-09-12, and they split cleanly in two:
 *
 *   the shop's own name says it     "Dads cigar shop, lounge", "Mister Z's
 *                                   Bourbon & Cigar Bar", "FUMA Cigar & Hookah
 *                                   Lounge". A business name is the shop's own
 *                                   claim, registered and printed over the
 *                                   door, and it is better evidence than a map
 *                                   category. The badge stays, and the reason
 *                                   recorded changes from the category to the
 *                                   name.
 *   nothing says it                 "The Cigar Vault", "Cigar Castle", "River
 *                                   City Cigars". No site, no sentence, no name
 *                                   — only Overture's category, which is also
 *                                   what put a brewery and a plumber in this
 *                                   directory. The badge comes off.
 *
 * The walk-in humidor badge is stricter: "The Humidor" in a name is not a
 * walk-in humidor, so only "walk-in" in the name itself counts. That clears
 * almost all of them, which is right — the badge was invented from names in the
 * first place.
 *
 * Every change goes through writeFields, so the edit log holds what it was and
 * why, and any of it can be put back.
 *
 *   DRY=1 node sweeps/scripts/settle_category_badges.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const db = require('../../server/src/database/db');
const { writeFields } = require('../../server/src/utils/storeEdits');

const LOUNGE = /\b(lounge|cigar bar|cigars bar|cigar club|cigars club|smoking room|smoke room|speakeasy)\b/i;
const WALK_IN = /\bwalk[- ]?in\b/i;

const file = path.join(__dirname, '..', 'decisions', 'site-facts', 'decisions.json');
const rows = JSON.parse(fs.readFileSync(file, 'utf8')).categoryOnly || [];

(async () => {
  const keep = [], clear = [];
  for (const r of rows) {
    const named = r.field === 'has_lounge' ? LOUNGE.test(r.name) : WALK_IN.test(r.name);
    (named ? keep : clear).push(r);
  }

  let cleared = 0, restated = 0, locked = 0;
  for (const r of clear) {
    const s = await db.get('SELECT id, name, claimed, staff_edited, has_lounge, has_walk_in_humidor FROM stores WHERE id = ?', [r.id]);
    if (!s) continue;
    if (Number(s.claimed) === 1 || Number(s.staff_edited) === 1) { locked++; continue; }
    if (Number(s[r.field]) !== 1) continue;                       // already off
    if (process.env.DRY === '1') { cleared++; continue; }
    const written = await writeFields(r.id, { [r.field]: 0 }, {
      source: 'rule', job: 'settle_category_badges',
      reason: `the badge came from ${r.from_category} and nothing else: ${r.why}, and the shop's own name does not claim it`,
    });
    if (written.length) cleared++;
  }

  // The kept ones get their reason rewritten, so the next reader can see the
  // badge rests on the name rather than on a map category.
  for (const r of keep) {
    const s = await db.get('SELECT id, claimed, staff_edited FROM stores WHERE id = ?', [r.id]);
    if (!s || Number(s.claimed) === 1 || Number(s.staff_edited) === 1) continue;
    if (process.env.DRY === '1') { restated++; continue; }
    const written = await writeFields(r.id, { [r.field]: 1 }, {
      source: 'rule', job: 'settle_category_badges',
      reason: `the shop's own name says so: "${String(r.name).slice(0, 80)}"`,
    });
    restated += written.length ? 1 : 0;
  }

  const n = await db.get(`SELECT COUNT(*) FILTER (WHERE visible = 1 AND has_lounge = 1)::int AS lounge,
      COUNT(*) FILTER (WHERE visible = 1 AND has_walk_in_humidor = 1)::int AS humidor FROM stores`);
  console.log(`${process.env.DRY === '1' ? 'would clear' : 'cleared'} ${cleared} badges that rested on a map category alone`);
  console.log(`${process.env.DRY === '1' ? 'would restate' : 'restated'} ${restated} whose own name claims it`);
  if (locked) console.log(`left ${locked} claimed or staff-edited alone`);
  console.log(`public listings now: ${n.lounge} with a lounge badge, ${n.humidor} with a walk-in humidor`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
