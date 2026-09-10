/**
 * Split a shop's product title into the three things a smoker actually reads:
 * the brand, the line, and the size.
 *
 * A shop sells "My Father Blue Toro Gordo Box of 20". That is not a cigar of
 * its own — it is the My Father Blue line in a Toro Gordo, sold by the box.
 * The line is the identity; the size and the packaging are how you buy it.
 * Filing every size and every pack count as a separate cigar is what buried
 * store pages under thousands of near-identical entries.
 *
 * So: peel off the packaging, peel off the size, and what remains names the
 * line. "Fuente Fuente OpusX Robusto" and "Fuente Fuente OpusX Perfecxion No.
 * 2" both come home to "Fuente Fuente OpusX".
 *
 * Pure functions, no I/O. Self-test:  node src/utils/productParser.js
 */
'use strict';

// Shapes a cigar comes in. Longest first so "Petit Robusto" wins over
// "Robusto" and "Toro Gordo" over "Toro".
const SHAPES = [
  'double perfecto', 'double robusto', 'double corona', 'double toro',
  'petit corona', 'petit robusto', 'petit lancero', 'petit belicoso',
  'corona gorda', 'corona corta', 'corona larga', 'corona extra',
  'toro gordo', 'toro grande', 'gran toro', 'grand toro', 'gordo extra',
  'short churchill', 'short robusto', 'short torpedo', 'short perfecto',
  'half corona', 'long panetela', 'gran corona', 'super toro',
  'churchill', 'robusto', 'belicoso', 'torpedo', 'lancero', 'lonsdale',
  'panetela', 'panatela', 'figurado', 'perfecto', 'presidente', 'rothschild',
  'sublime', 'salomon', 'salomone', 'piramide', 'pyramid', 'culebra',
  'corona', 'gordo', 'toro', 'magnum', 'gigante', 'petit', 'nub', 'demi',
  'cigarillo', 'cigarillos', 'minuto', 'mareva', 'campana', 'hermoso',
];

// How it is sold. None of this identifies the cigar.
const PACKAGING = [
  /\bbox(?:es)?\s+of\s+\d+\b/g,
  /\bbundle\s+of\s+\d+\b/g,
  /\btin\s+of\s+\d+\b/g,
  /\bpack\s+of\s+\d+\b/g,
  /\bcase\s+of\s+\d+\b/g,
  /\b\d+\s*-?\s*(?:count|ct|pack|pk|cigars?)\b/g,
  /\b\d+\s*er\b/g,
  /\b(?:single|singles|loose|each|box|bundle|tin|sampler|gift\s+set|carton)\b/g,
];

// "5x50", "6 1/2 x 52", "(5.5 X 48)"
const DIMENSIONS = /\(?\b\d+(?:\s+\d+\/\d+|[.,]\d+)?\s*[x×]\s*\d+(?:[.,]\d+)?\b\)?/gi;

const SHAPE_SET = new Set(SHAPES);

function clean(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&(amp|nbsp|quot|#\d+);/g, ' ')
    .replace(/[^a-z0-9/.\s-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Title case that leaves short joining words alone: "Fuente Fuente OpusX". */
function titleCase(str) {
  const small = new Set(['de', 'del', 'la', 'el', 'y', 'of', 'the', 'and']);
  return String(str || '')
    .split(' ')
    .filter(Boolean)
    .map((w, i) => (i > 0 && small.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

/**
 * Recover the shop's own capitalisation for a stretch of text we matched
 * against the lowercased title, so "opusx" goes back to "OpusX". Falls back to
 * title case when the words are not contiguous in the original.
 */
function recase(lowered, rawTitle) {
  const words = lowered.split(' ').filter(Boolean);
  if (!words.length) return '';
  const raw = String(rawTitle || '');
  const pattern = words
    .map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[^A-Za-z0-9]+');
  const m = raw.match(new RegExp(pattern, 'i'));
  if (m) return m[0].replace(/\s+/g, ' ').trim();
  return titleCase(lowered);
}

/**
 * The size named in a title, if any, plus the title with it removed.
 * Only a trailing or standalone shape counts — "Corona" in "Corona Extra
 * Reserve" is part of the line, so we take the longest shape that sits at the
 * end of what is left after packaging comes off.
 */
function splitShape(text) {
  for (const shape of SHAPES) {
    // At the end, or followed only by a number ("Robusto No. 2", "Nub 460").
    const re = new RegExp(`\\b${shape}\\b(\\s+(?:no\\.?\\s*)?\\d+[a-z]?)?\\s*$`, 'i');
    const m = text.match(re);
    if (m) {
      return {
        size: titleCase(`${shape}${m[1] ? ' ' + m[1].trim() : ''}`.replace(/\s+/g, ' ').trim()),
        rest: text.slice(0, m.index).trim(),
      };
    }
  }
  return { size: null, rest: text };
}

/**
 * parseProductTitle("My Father Blue Toro Gordo Box of 20", "My Father")
 *   -> { brand: 'My Father', line: 'My Father Blue', size: 'Toro Gordo' }
 *
 * `vendor` is the shop's own brand field where it has one. It is only trusted
 * as a prefix — a vendor of "My Father" on a title that never says so tells us
 * the brand but cannot tell us where the line begins.
 */
function parseProductTitle(rawTitle, vendor = '') {
  let text = clean(rawTitle);
  if (!text) return null;

  text = text.replace(DIMENSIONS, ' ');
  for (const re of PACKAGING) text = text.replace(re, ' ');
  text = text.replace(/\s+/g, ' ').replace(/[-\s]+$/, '').trim();
  if (!text) return null;

  const { size, rest } = splitShape(text);
  let line = (rest || '').replace(/[-\s]+$/, '').trim();
  if (!line) return null;

  // The brand lives in its own column, so it never belongs in the line too.
  // A title that leads with its brand gives that prefix up; one that does not
  // ("Fuente Fuente OpusX" filed under vendor "Arturo Fuente") keeps its whole
  // title as the line, which is exactly how the catalog already spells it.
  const brandClean = clean(vendor);
  let brand = null;
  if (brandClean) {
    brand = titleCase(brandClean);
    if (line === brandClean) return null;             // brand alone names no line
    if (line.startsWith(brandClean + ' ')) line = line.slice(brandClean.length).trim();
  }

  // A line that is nothing but a shape ("Robusto") identifies no cigar.
  if (SHAPE_SET.has(line)) return null;

  return {
    // The shop's own spelling wins: "AVO" and "CAO" are acronyms that title
    // case would quietly ruin.
    brand: vendor ? String(vendor).trim() : null,
    line: recase(line, rawTitle),
    size: size,
  };
}

module.exports = { parseProductTitle, splitShape, clean, titleCase, recase, SHAPES };

// ── Self-test ───────────────────────────────────────────────────────────────
if (require.main === module) {
  let pass = 0, fail = 0;
  const ok = (cond, label, extra) => {
    if (cond) { pass++; console.log('  ok   ' + label); }
    else { fail++; console.log('  FAIL ' + label + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
  };
  const p = (t, v) => parseProductTitle(t, v);

  console.log('every size of a line comes home to the same line:');
  const opus = [
    'Fuente Fuente OpusX Robusto',
    'Fuente Fuente OpusX Perfecxion No. 2',
    'Fuente Fuente OpusX Toro Box of 20',
    'Fuente Fuente OpusX Double Corona Single',
  ].map(t => p(t, 'Arturo Fuente'));
  ok(opus[0].line === 'Fuente Fuente OpusX', 'line keeps the shop spelling', opus[0]);
  ok(opus[0].size === 'Robusto', 'robusto read as the size', opus[0].size);
  ok(opus[2].size === 'Toro' && !/box/i.test(opus[2].line), 'packaging removed', opus[2]);
  ok(opus[0].line === opus[2].line && opus[0].line === opus[3].line,
    'the shaped sizes agree on one line', opus.map(r => r && r.line));
  // "Perfecxion" is a house vitola name, not a generic shape, so the parser
  // cannot know it is a size. The catalog builder folds these in afterwards by
  // noticing the prefix. See buildCatalog.js.
  ok(opus[1].line.startsWith(opus[0].line), 'a house vitola leaves the line as a prefix', opus[1].line);

  console.log('\nreal titles from the pending queue:');
  const mf = p('My Father Blue Toro Gordo Box of 20', 'My Father');
  ok(mf.brand === 'My Father' && mf.line === 'Blue' && mf.size === 'Toro Gordo',
    'My Father / Blue / Toro Gordo', mf);
  const mf2 = p('My Father Blue Petit Robusto Box of 20', 'My Father');
  ok(mf2.line === mf.line, 'petit robusto files under the same line', mf2);
  const avo = p('AVO Expresivo Robusto Box of 20', 'AVO');
  ok(avo.brand === 'AVO' && avo.line === 'Expresivo' && avo.size === 'Robusto',
    'AVO keeps its capitals', avo);
  const pl = p('Plasencia Reserva Original Corona Corta Box of 20', 'Plasencia');
  ok(pl.brand === 'Plasencia' && pl.line === 'Reserva Original' && pl.size === 'Corona Corta',
    'Plasencia / Reserva Original / Corona Corta', pl);
  const nub = p('Nub Maduro 460 Cigars Single', 'Oliva');
  ok(nub && !/single/i.test(nub.line), 'Nub keeps its identity, packaging gone', nub);

  console.log('\nlines that merely contain a shape word are left whole:');
  const cg = p('Corona Extra Reserve', 'Some Brand');
  ok(cg && /corona extra reserve/i.test(cg.line), 'Corona Extra Reserve is a line, not a size', cg);
  const dc = p('Don Carlos Robusto', 'Arturo Fuente');
  ok(dc.brand === 'Arturo Fuente' && dc.line === 'Don Carlos' && dc.size === 'Robusto',
    'Don Carlos / Robusto', dc);

  console.log('\nvendor handling:');
  ok(p('Padron 1964 Anniversary Exclusivo', 'Padrón').brand === 'Padrón', 'accented brand survives');
  const noBrandInTitle = p('Blue Label Toro', 'Rocky Patel');
  ok(noBrandInTitle.brand === 'Rocky Patel' && noBrandInTitle.line === 'Blue Label',
    'the vendor supplies the brand a title omits', noBrandInTitle);
  const already = p('Rocky Patel Decade Toro', 'Rocky Patel');
  ok(already.brand === 'Rocky Patel' && already.line === 'Decade',
    'a title leading with its brand hands that prefix over', already);
  ok(p('Rocky Patel', 'Rocky Patel') === null, 'a brand on its own names no line');

  console.log('\nrubbish is rejected:');
  ok(p('Robusto Single') === null, 'a bare shape is not a cigar');
  ok(p('') === null, 'empty title');
  ok(p('   ') === null, 'blank title');
  ok(p('Box of 20') === null, 'packaging only');

  console.log('\ndimensions:');
  const dim = p('Padron 1964 Anniversary Exclusivo 5 1/2 x 50 Box of 25', 'Padron');
  ok(dim && !/x 50|1\/2/.test(dim.line), 'printed dimensions stripped', dim);

  console.log(`\nproductParser self-test: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
