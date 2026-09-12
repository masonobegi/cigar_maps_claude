/**
 * The search folds a name twice: once in SQL, over the column, and once in
 * JavaScript, over what the customer typed. utils/storeSearch.js keeps the two
 * halves side by side, and its own self-test checks the JavaScript one — but
 * nothing there can tell whether Postgres agrees. A `translate()` with
 * mismatched argument lengths, or a `regexp_replace` whose word-boundary
 * escape the engine reads differently, produces a search that silently matches
 * nothing rather than an error.
 *
 * This runs both halves over the same strings, in the engine, and reports any
 * disagreement. Read-only; it touches no table.
 *
 *   PGLITE_DIR=/tmp/cbfixture node sweeps/scripts/fold_parity.js
 */
'use strict';

const path = require('path');
const SRV = path.join(__dirname, '..', '..', 'server', 'src');
const db = require(path.join(SRV, 'database', 'db'));
const { fold, folded } = require(path.join(SRV, 'utils', 'storeSearch'));

// Every shape the fold has a rule for, plus the ones that have bitten: a name
// where "St" is both an abbreviation and a street type, a two-letter accent
// expansion next to an already-expanded spelling, and a bare ASCII string that
// must come through untouched.
const CASES = [
  "Wild Bill's Tobacco", 'Smith & Sons', 'Café Havana', 'Doña Flor', 'EL REÝ',
  'St. James Cigars', 'Saint James Cigars', 'Mt Pleasant', 'Mount Pleasant',
  '1st Street Smokes', 'Best Cigars', 'Smoke St', 'Ybor City Cigar Co.',
  'J & J Cigars', 'Anthony’s Cigar Emporium', 'Straenge Sstuff',
  'Strænge ßtuff', 'La Casa del Habano', 'Père Noël', 'Zigarren-Haus',
  'Tobacco Row, Inc.', 'A-1 Smoke Shop', 'plain ascii', '',
  'ŠKODA Cigars', 'Mister Mt. Vernon St. Co.',
  // Every non-ASCII character that actually appears in a name in the directory,
  // found by enumerating the column rather than by guessing which alphabets a
  // US cigar directory would contain. The first hand-kept accent table folded
  // the Spanish names it was written for and missed all of these.
  'Hawaiʻi Cigar', 'Āloha ūkulele', 'Tiệm Thuốc Lá', 'Velázquez Cigar Company',
  'Smokin’ Royalty Smoke Shop & Lounge LLC', 'Smoke® Shop™', 'Smoke 💨 Shop',
  'Vélazquez', 'Zigarrenßtube', 'محل الدخان', '台灣 Cigars', 'サンロゼ ルス',
  'České Doutníky', 'Côte d’Or', 'Łódź Tobacco', 'Ðþ Old English',
];

(async () => {
  let pass = 0, fail = 0;
  for (const c of CASES) {
    const row = await db.get(`SELECT ${fold('?::text')} AS out`, [c]);
    const js = folded(c);
    if (row.out === js) pass++;
    else {
      fail++;
      console.log(`  MISMATCH ${JSON.stringify(c)}\n    sql=${JSON.stringify(row.out)}\n    js =${JSON.stringify(js)}`);
    }
  }
  console.log(`fold parity: ${pass} agree, ${fail} differ`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e.message); process.exit(1); });
