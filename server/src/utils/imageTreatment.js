/**
 * How a store's picture should be drawn, decided from the picture rather than
 * from its filename.
 *
 * StoreThumb used to ask `/logo/i.test(src)`. A shop whose logo lives at
 * /wp-content/uploads/2021/header.png failed that test, so it was drawn as a
 * photograph: object-fit: cover on a #2A2520 backdrop. A see-through logo drawn
 * in dark ink, composited onto a near-black square, is an invisible logo. Six
 * of them were effectively a flat dark tile — Havana Cigar and Sports Bar
 * measured a standard deviation of 0.022 across the whole thumbnail.
 *
 * So the picture is measured instead, and this turns those measurements into
 * one of four treatments. The numbers came from measuring all 349 pictures the
 * public directory shows; the comments say what each threshold was drawn from.
 *
 *   node src/utils/imageTreatment.js selftest
 */
'use strict';

/**
 * A quarter of the pixels being see-through means artwork on a transparent
 * ground — a logo — not a photograph. Photographs measured 0%: every one of
 * the twenty darkest was fully opaque. Nothing sat between 0.03 and 0.25, so
 * the gap is wide and the cut is not delicate.
 */
const ALPHA_IS_ARTWORK = 0.25;

/** Below this a square reads as dark rather than as a picture. 25% measured under it. */
const DARK_AT = 0.20;

/**
 * Dark AND nothing bright in it AND no spread: a black square at 72px. The
 * p95 term is what separates these from a dim room with a lit sign — Ezra Zion
 * measures luma 0.059 but p95 0.984, and is a perfectly good photograph.
 */
const BLANK_P95 = 0.35;
const BLANK_CONTRAST = 0.12;

/**
 * One of:
 *   'logo'  — artwork on a transparent ground: light backdrop, contain, padding
 *   'dim'   — a real photograph that is too dark to read: lift it
 *   'blank' — dark with nothing in it: not worth showing, use the monogram
 *   'photo' — fine as it is
 *
 * `null` when there is nothing to go on, which the caller must treat as 'photo'
 * so an unmeasured picture keeps its old behaviour.
 */
function treatmentFor(m) {
  if (!m || typeof m.luma !== 'number') return null;
  const alpha = typeof m.transparentFraction === 'number' ? m.transparentFraction : 0;
  // Artwork first: a see-through logo that is also dark is still a logo, and
  // putting it on a light ground fixes it without touching the pixels.
  if (alpha >= ALPHA_IS_ARTWORK) return 'logo';
  if (m.luma >= DARK_AT) return 'photo';
  const p95 = typeof m.p95 === 'number' ? m.p95 : 1;
  const contrast = typeof m.contrast === 'number' ? m.contrast : 1;
  if (p95 < BLANK_P95 && contrast < BLANK_CONTRAST) return 'blank';
  return 'dim';
}

/**
 * How much to lift a dim photograph, as a CSS brightness multiplier.
 *
 * Aimed at bringing the mean to roughly DARK_AT rather than at some fixed
 * amount, so a picture at 0.19 is barely touched and one at 0.05 is lifted
 * hard. Capped at 2.2: past that, compression noise in a dark JPEG becomes
 * more visible than the subject.
 */
function liftFor(luma) {
  if (typeof luma !== 'number' || luma <= 0 || luma >= DARK_AT) return 1;
  return Math.min(2.2, Math.round((DARK_AT / luma) * 100) / 100);
}

module.exports = { treatmentFor, liftFor, ALPHA_IS_ARTWORK, DARK_AT, selftest };

// ── self-test ───────────────────────────────────────────────────────────────
function selftest() {
  let pass = 0, fail = 0;
  const ok = (cond, label, extra) => {
    if (cond) { pass++; console.log(`  ok   ${label}`); }
    else { fail++; console.log(`  FAIL ${label}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ''}`); }
  };

  // Every row below is a real measurement taken from the live directory.
  const HAVANA = { luma: 0.144, p95: 0.148, contrast: 0.022, transparentFraction: 0.87 };
  const CITY = { luma: 0.108, p95: 0.148, contrast: 0.064, transparentFraction: 0.73 };
  const EZRA = { luma: 0.059, p95: 0.984, contrast: 0.231, transparentFraction: 0 };
  const BLACKLEAF = { luma: 0.037, p95: 0.000, contrast: 0.182, transparentFraction: 0 };
  const PRESTIGE = { luma: 0.023, p95: 0.018, contrast: 0.117, transparentFraction: 0 };
  const HUTCH = { luma: 0.171, p95: 0.165, contrast: 0.053, transparentFraction: 0 };
  const BRIGHT = { luma: 0.62, p95: 0.95, contrast: 0.24, transparentFraction: 0 };

  ok(treatmentFor(HAVANA) === 'logo',
    'a thumbnail that is 87% see-through is a logo, however dark the ink', treatmentFor(HAVANA));
  ok(treatmentFor(CITY) === 'logo', 'and so is one that is 73% see-through', treatmentFor(CITY));
  ok(treatmentFor(EZRA) === 'dim',
    'a dim room with something lit in it is a photograph, not a blank', treatmentFor(EZRA));
  ok(treatmentFor(BLACKLEAF) === 'dim',
    'white marks on black read fine: p95 of 0 with spread is bright pixels, not none', treatmentFor(BLACKLEAF));
  ok(treatmentFor(PRESTIGE) === 'blank', 'dark, nothing bright, no spread — a black square', treatmentFor(PRESTIGE));
  ok(treatmentFor(HUTCH) === 'blank', 'and one just under the line is still a black square', treatmentFor(HUTCH));
  ok(treatmentFor(BRIGHT) === 'photo', 'an ordinary picture is left alone', treatmentFor(BRIGHT));

  ok(treatmentFor(null) === null && treatmentFor({}) === null,
    'nothing measured yet returns null rather than guessing');
  ok(treatmentFor({ luma: 0.3 }) === 'photo',
    'a measurement missing its extras still classifies, rather than throwing', treatmentFor({ luma: 0.3 }));

  // The boundary, stated rather than implied.
  ok(treatmentFor({ luma: 0.20, transparentFraction: 0 }) === 'photo', 'exactly at DARK_AT is not dark');
  ok(treatmentFor({ luma: 0.199, p95: 0.9, contrast: 0.3, transparentFraction: 0 }) === 'dim', 'just under it is');
  ok(treatmentFor({ luma: 0.05, transparentFraction: ALPHA_IS_ARTWORK }) === 'logo', 'exactly at the alpha cut is artwork');

  ok(liftFor(0.10) === 2, 'a photo at half the target is lifted twice', liftFor(0.10));
  ok(liftFor(0.05) === 2.2, 'and a very dark one is capped rather than lifted four times', liftFor(0.05));
  ok(liftFor(0.19) > 1 && liftFor(0.19) < 1.1, 'one just under the line is barely touched', liftFor(0.19));
  ok(liftFor(0.5) === 1 && liftFor(0) === 1 && liftFor(null) === 1,
    'and anything that does not need lifting is left at 1');

  console.log(`\nimageTreatment self-test: ${pass} passed, ${fail} failed`);
  return fail === 0;
}

if (require.main === module && process.argv[2] === 'selftest') process.exit(selftest() ? 0 : 1);
