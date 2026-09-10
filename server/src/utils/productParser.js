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
  'churchill extra', 'robusto extra', 'toro extra', 'torpedo extra', 'belicoso extra',
  'robusto grande', 'gran robusto', 'corona doble', 'doble corona', 'toro doble',
  'short churchill', 'short robusto', 'short torpedo', 'short perfecto',
  'half corona', 'long panetela', 'gran corona', 'super toro',
  'churchill', 'robusto', 'belicoso', 'torpedo', 'lancero', 'lonsdale',
  'panetela', 'panatela', 'figurado', 'perfecto', 'presidente', 'rothschild',
  'sublime', 'salomon', 'salomone', 'piramide', 'pyramid', 'culebra',
  'corona', 'gordo', 'toro', 'magnum', 'gigante', 'petit', 'nub', 'demi',
  'cigarillo', 'cigarillos', 'minuto', 'mareva', 'campana', 'hermoso',
  'pequenos', 'pequeno', 'puritos', 'purito', 'minis', 'mini', 'clubs', 'club', 'petite',
];

// How it is sold. None of this identifies the cigar.
const PACKAGING = [
  // The order matters: each rule must see its words before a later, greedier
  // rule takes one of them away.
  //
  // Awards and ratings first, or "#1 Cigar In 2020" loses "1 cigar" to the
  // count rule and strands "in 2020".
  /\b(?:\d+\s+)?cigar\s+(?:of\s+the\s+year|in\s+\d{4})(?:\s+\d{4})?\b/g,
  /\btop\s+\d+\b/g,
  /\b(?:rated\s+)?\d{2}\s*(?:points?|pts|rating)\b/g,
  /\brated\s+\d{2}\b/g,
  // "6 Packs of 6", "5 tins of 10": a count of containers of a count. The
  // leading number must not already belong to something: in "No. 5 Pack of 5
  // Pack of 5" (Shopify appends the variant to the title) the 5 is the size's,
  // and in "Pack of 4 Pack of 4" it is the first pack's.
  /(?<!\b(?:no|of|#)\.?\s{0,2})\b\d+\s+(?:packs?|tins?|boxes|bundles?|sleeves?)\s+of\s+\d+\b/g,
  // "10 count", "5-pack": a number that owns the word after it. Before the
  // container rule, or "Tin 10 count" loses "Tin 10" and strands "count".
  // Never the number of a "No. 2", which names a size, nor the number of an
  // "of 4", which belongs to the container before it.
  /(?<!\b(?:no|of|#)\.?\s{0,2})\b\d+\s*-?\s*(?:count|ct|packs?|pks?|cigars?|units?|tins?)\b/g,
  // A container and its count, with or without "of": "Box of 20", "Box 23".
  /\b(?:box(?:es)?|bundles?|tins?|packs?|cases?|sleeves?|cabinets?|jars?)\s+(?:of\s+)?\d+\b/g,
  /\b(?:available\s+for\s+)?special\s+order\b/g,
  /\bcigars?\s+\d+\b/g,                    // "Robusto - Cigars 20"
  /\b\d+\s*er\b/g,
  /\b(?:single|singles|loose|each|box|boxes|bundle|bundles|tin|tins|packs?|sleeves?|sampler|gift\s+set|carton|units?)\b/g,
  // Stock notes some shops leave in the title itself.
  /\b(?:out\s+of\s+stock|sold\s+out|pre-?\s*order|back\s*order(?:ed)?|in\s+stock|discontinued)\b/g,
  // Shop promotions. Not "new" or "limited": New World and Limited Edition are
  // the names of real lines.
  /\b(?:save|sale|clearance|discount)\b(?:\s+\$?\d+%?)?/g,
  // A count left stranded once its container word went ("Dorado of 5").
  /\bof\s+\d+\b/g,
];

// "5x50", "6 1/2 x 52", "(5.5 X 48)", and "6x54BP" with a box-pressed suffix
const DIMENSIONS = /\(?\b\d+(?:\s+\d+\/\d+|[.,]\d+)?\s*[x×]\s*\d+(?:[.,]\d+)?(?:bp|tp|p)?\b\)?/gi;

// The same size printed without the x: "Churchill 7 48", "Toro 6 1/4 54",
// "Robusto 5.5 55". A length of 4-9 inches then a ring of 30-80, at the end.
// Tight on purpose so "Vintage 1990", "Nub 460" and "Monument 20" survive.
const BARE_DIMENSIONS = /\s+[4-9](?:\.\d{1,2}|\s+\d\/\d{1,2})?\s+(?:[3-7]\d|80)\s*$/;

// How a cigar is finished or wrapped for sale, not which cigar it is.
const FINISH = /\b(?:box[\s-]?pressed|pressed|(?:en|in)\s+tubos?|(?:in\s+)?tubes?|tubos?)\b/g;

const SHAPE_SET = new Set(SHAPES);

function clean(str) {
  return String(str || '')
    // Typographic fractions: "4 3⁄16" and "6½" are sizes like any other.
    .replace(/⁄/g, '/')
    .replace(/½/g, ' 1/2').replace(/¼/g, ' 1/4').replace(/¾/g, ' 3/4')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&(amp|nbsp|quot|#\d+);/g, ' ')
    .replace(/[^a-z0-9/.\s-]+/g, ' ')
    // A dash with a space on either side separates words ("Liga Privada - H99");
    // one inside a word ("E.R.H", "T-52") is part of it.
    .replace(/\s-+|-+\s|^-+|-+$/g, ' ')
    // A slash separates words ("Lancero/Panatela") unless it is a fraction.
    .replace(/(^|[^0-9])\/|\/(?![0-9])/g, '$1 ')
    // A full stop that is not inside an abbreviation or a number.
    .replace(/(^|\s)\.+|\.+(\s|$)/g, '$1$2')
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
  // Keep the shop's capitals, not its separators: "Liga Privada - H99" is
  // shown as "Liga Privada H99".
  if (m) {
    return m[0]
      .replace(/\s+[-–—|:]+\s+/g, ' ')
      .replace(/[“”"(){}[\]]/g, ' ')
      .replace(/\s*\/\s*/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  return titleCase(lowered);
}

/**
 * Shops type in capitals more often than makers do. "ROCKY PATEL VINTAGE
 * 1990" reads as "Rocky Patel Vintage 1990"; short all-capital words stay as
 * they are, because VSG, CAO and H99 are names, not shouting.
 */
function calmCapitals(s) {
  if (!s || s !== s.toUpperCase() || !/[A-Z]{4,}/.test(s)) return s;
  return s.split(' ').map(w => (/^[A-Z]{4,}$/.test(w) ? w.charAt(0) + w.slice(1).toLowerCase() : w)).join(' ');
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

const dedot = t => t.replace(/[^a-z0-9]/g, '');
const COMPANY_WORDS = new Set(['cigars', 'cigar', 'co', 'company', 'tobacco', 'tabacos', 'tabaco', 'inc', 'llc', 'ltd']);

/**
 * The ways a brand can open a title, longest first. A shop's vendor field says
 * "Plasencia Cigars" while its titles say "Plasencia Reserva Original", so the
 * brand without its company words has to count as a prefix too.
 */
function brandPrefixes(brandClean) {
  const tokens = brandClean.split(' ').map(dedot).filter(Boolean);
  const out = [tokens];
  let trimmed = tokens.slice();
  while (trimmed.length > 1 && COMPANY_WORDS.has(trimmed[trimmed.length - 1])) {
    trimmed = trimmed.slice(0, -1);
    out.push(trimmed);
  }
  return out;
}

/** Token-wise prefix test that ignores punctuation: "a.j." equals "aj". */
function startsWithTokens(lineTokens, prefix) {
  if (!prefix.length || lineTokens.length < prefix.length) return false;
  return prefix.every((t, i) => dedot(lineTokens[i]) === t);
}

/**
 * parseProductTitle("My Father Blue Toro Gordo Box of 20", "My Father")
 *   -> { brand: 'My Father', line: 'My Father Blue', size: 'Toro Gordo' }
 *
 * `vendor` is the shop's own brand field where it has one. It is only trusted
 * as a prefix — a vendor of "My Father" on a title that never says so tells us
 * the brand but cannot tell us where the line begins.
 */
/**
 * A title with everything about how it is sold taken out: packaging, counts,
 * printed dimensions, finishes, promotions, awards. What is left names the
 * cigar and its size.
 *
 * The matcher reads titles through this too. A "5-Pack" left in place hands
 * the matcher a stray 5, and "Serie R No. 8 ... 5-Pack" then satisfies the
 * number check for "Serie R No. 5".
 */
function stripPackaging(rawTitle) {
  let text = clean(rawTitle);
  if (!text) return '';
  text = text.replace(DIMENSIONS, ' ');
  // Twice, because taking one word out can leave another pattern behind it:
  // "Cigars Box 23" is only "Cigars 23" after the first pass.
  for (let pass = 0; pass < 2; pass++) {
    for (const re of PACKAGING) text = text.replace(re, ' ');
    text = text.replace(/\s+/g, ' ').trim();
  }
  text = text.replace(FINISH, ' ');
  text = text.replace(/\s+/g, ' ').replace(/[-\s]+$/, '').trim();
  // "... Petit Corona Cigars": the word says what the product is, not which.
  text = text.replace(/\s+cigars?$/, '').trim();
  // Bare dimensions only come off once packaging has, so they sit at the end.
  return text.replace(BARE_DIMENSIONS, '').trim();
}

function parseProductTitle(rawTitle, vendor = '') {
  const text = stripPackaging(rawTitle);
  if (!text) return null;

  const { size, rest } = splitShape(text);
  let line = (rest || '').replace(/[-\s]+$/, '').trim();
  if (!line) return null;

  // The brand lives in its own column, so it never belongs in the line too.
  // A title that leads with its brand gives that prefix up; one that does not
  // ("Fuente Fuente OpusX" filed under vendor "Arturo Fuente") keeps its whole
  // title as the line, which is exactly how the catalog already spells it.
  const brandClean = clean(vendor);
  if (brandClean) {
    const lineTokens = line.split(' ');
    for (const prefix of brandPrefixes(brandClean)) {
      if (!startsWithTokens(lineTokens, prefix)) continue;
      if (lineTokens.length === prefix.length) return null;   // brand alone names no line
      line = lineTokens.slice(prefix.length).join(' ');
      break;
    }
  }

  // A line that is nothing but a shape ("Robusto") identifies no cigar.
  if (SHAPE_SET.has(line)) return null;

  return {
    // The shop's own spelling wins: "AVO" and "CAO" are acronyms that title
    // case would quietly ruin.
    brand: vendor ? String(vendor).trim() : null,
    line: recase(line, rawTitle),
    // A numbered size takes its punctuation back from the title: "No. 1".
    size: size && /\d/.test(size) ? calmCapitals(recase(size, rawTitle)) : size,
  };
}

/** Does this title open with this brand, however either is punctuated? */
function titleStartsWithBrand(title, brand) {
  const b = clean(brand);
  if (!b) return false;
  const tokens = clean(title).split(' ');
  return brandPrefixes(b).some(prefix => startsWithTokens(tokens, prefix));
}

module.exports = { parseProductTitle, stripPackaging, splitShape, clean, titleCase, recase, calmCapitals, titleStartsWithBrand, SHAPES };

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

  console.log('\nfailures seen in the real feeds:');
  const ch = p('Plasencia Reserva Original Churchill 7 48', 'Plasencia');
  ok(ch.line === 'Reserva Original' && ch.size === 'Churchill', 'dimensions without an x come off ("7 48")', ch);
  const tq = p('Plasencia Alma Fuerte Nestor IV Toro 6 1/4 54', 'Plasencia');
  ok(tq.line === 'Alma Fuerte Nestor IV' && tq.size === 'Toro', 'fractional bare dimensions come off', tq);
  const sv = p('Ashton VSG Robusto Save 10', 'Ashton');
  ok(sv.line === 'VSG' && sv.size === 'Robusto', 'a promotion is not part of the name', sv);
  const of5 = p('AJ Fernandez New World Dorado Pack of 5', 'AJ Fernandez');
  ok(of5.line === 'New World Dorado' && !/of/i.test(of5.line), 'New World survives, the count does not', of5);
  const lp = p('Liga Privada - H99 Robusto Single', 'Drew Estate');
  ok(lp.line === 'Liga Privada H99' || lp.line === 'Liga Privada - H99', 'a spaced dash separates, it is not part of the line', lp);
  ok(!/^-|-$/.test(lp.line), 'no stray dash left on the line', lp);
  const bp = p('Padron 1964 Anniversary Principe Box Pressed', 'Padron');
  ok(!/pressed/i.test(bp.line), 'box pressed is a finish, not a line', bp);
  ok(p('Rocky Patel Vintage 1990 Robusto', 'Rocky Patel').line === 'Vintage 1990', 'a year stays in the line');
  ok(p('Nub Maduro 460', 'Oliva').line.includes('460'), 'Nub 460 keeps its number');
  ok(p('CAO America Monument 20', 'CAO').line.includes('20'), 'a number that is not a ring gauge survives');

  const bpDim = p('Plasencia Alma Del Campo Travesia 6x54BP', 'Plasencia');
  ok(bpDim.line === 'Alma Del Campo Travesia', 'a box-pressed dimension suffix comes off', bpDim);
  const trailing = p('Oliva Serie V Melanio Petit Corona Cigars', 'Oliva');
  ok(trailing.line === 'Serie V Melanio' && trailing.size === 'Petit Corona', 'a trailing "Cigars" is dropped', trailing);

  console.log('\nmore real titles:');
  const box23 = p('My Father Connecticut Robusto - Box 23', 'My Father');
  ok(box23.line === 'Connecticut' && box23.size === 'Robusto', '"Box 23" with no "of" comes off whole', box23);
  const cbox = p('My Father Connecticut Robusto Cigars Box 23', 'My Father Cigars');
  ok(cbox.line === 'Connecticut' && cbox.size === 'Robusto', '"Cigars Box 23" needs two passes', cbox);
  const award = p('Pledge Prequel 5x50 #1 Cigar In 2020 Single', 'EP Carrillo');
  ok(award.line === 'Pledge Prequel', 'an award printed in the title is not the name', award);
  const frac = p('Cohiba Blue Pequenos 4 3⁄16 x 36', 'Cohiba');
  ok(frac.line === 'Blue' && frac.size === 'Pequenos', 'a typographic fraction reads as a size', frac);
  const sleeve = p('Cohiba Blue Pequeno 6ct Tin Sleeve of 5', 'Cohiba');
  ok(sleeve.line === 'Blue' && sleeve.size === 'Pequeno', 'tins and sleeves are packaging', sleeve);
  ok(p('Oliva Serie V 94 Points Robusto', 'Oliva').line === 'Serie V', 'a rating is not the name');
  // Shopify appends the variant to the title, so packaging arrives twice.
  const gc = p('Davidoff Grand Cru Grand Cru No. 5 Pack of 5 Pack of 5', 'Davidoff');
  ok(/No\.? 5$/.test(gc.line) && !/pack/i.test(gc.line), 'the 5 of "No. 5" is never taken as a pack count', gc);
  const st = p('Davidoff Aniversario Special T Pack of 4 Pack of 4', 'Davidoff');
  ok(st.line === 'Aniversario Special T', '"Pack of 4 Pack of 4" leaves no stray "of"', st);
  const mb = p('Davidoff Millennium Blend Petit Corona Pack of 5 Pack of 5', 'Davidoff');
  ok(mb.line === 'Millennium Blend' && mb.size === 'Petit Corona', 'a doubled pack still leaves the size readable', mb);
  const tin = p('Davidoff Signature No. 2 Tin of 5', 'Davidoff');
  ok(tin.line.includes('No. 2') || tin.size === 'No. 2', '"No. 2 Tin" keeps its 2', tin);
  const et = p('Romeo y Julieta 1875 Rothschild en Tubo Box of 10', 'Romeo y Julieta');
  ok(et.line === '1875' && et.size === 'Rothschild', '"en Tubo" comes off whole, leaving no stray "en"', et);
  const dt = p('Don Pepin Garcia Blue Demi-Tasse Petite Cigars 6 Packs of 6', 'Don Pepin Garcia Cigars');
  ok(dt.line === 'Blue Demi-Tasse' && dt.size === 'Petite', '"6 Packs of 6" comes off whole', dt);
  const so = p('Drew Estate Krush Classic **Available for Special Order** Blue Connecticut (Tin) - 10 count', 'Drew Estate');
  ok(!/special|order|available|tin|count/i.test(so.line), 'a special-order note is not part of the name', so);

  console.log('\nbrand prefixes that differ only in punctuation or company words:');
  const aj = p('A.J. Fernandez New World Toro', 'AJ Fernandez');
  ok(aj.line === 'New World', '"A.J." in the title matches vendor "AJ"', aj);
  const pc = p('Plasencia Reserva Original Robusto', 'Plasencia Cigars');
  ok(pc.line === 'Reserva Original', 'vendor "Plasencia Cigars" still strips "Plasencia"', pc);
  const erh = p('Don Pepin Garcia E.R.H Robusto', 'Don Pepin Garcia');
  ok(erh.line === 'E.R.H', 'punctuation inside the line itself is kept', erh);

  console.log('\ndimensions:');
  const dim = p('Padron 1964 Anniversary Exclusivo 5 1/2 x 50 Box of 25', 'Padron');
  ok(dim && !/x 50|1\/2/.test(dim.line), 'printed dimensions stripped', dim);

  console.log(`\nproductParser self-test: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
