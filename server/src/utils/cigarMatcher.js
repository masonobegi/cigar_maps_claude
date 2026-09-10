/**
 * Cigar name matcher.
 *
 * Turns a free-text product title from a shop's online store ("Padron 1964
 * Anniversary Exclusivo Maduro", "Arturo Fuente Hemingway Short Story 4x49")
 * into a (cigar_id, vitola_id) pair from our catalog.
 *
 * Pure functions only — no database, no I/O. The caller loads cigars, vitolas
 * and any curated aliases, calls buildIndex() once, then matchCigar() per
 * product. Everything is deliberately conservative: a wrong match puts a cigar
 * on a shop's shelf that isn't there, which is worse than no match at all
 * (unmatched titles land in the catalog_pending queue for a human).
 *
 * Self-test:  node src/utils/cigarMatcher.js
 */
'use strict';

const { stripPackaging } = require('./productParser');

// Words that carry no identity: they show up in half of all product titles and
// would inflate every score if they counted as name tokens.
const NOISE = new Set([
  'cigar', 'cigars', 'single', 'singles', 'box', 'boxes', 'pack', 'of', 'the',
  'and', 'natural', 'cello', 'tubo', 'tube', 'stick', 'sticks', 'each', 'ea',
]);

// Common vitola shape words, used as a fallback when the catalog vitola name
// itself isn't spelled out in the title.
const SHAPE_WORDS = [
  'robusto', 'toro', 'churchill', 'torpedo', 'belicoso', 'lancero', 'corona',
  'gordo', 'perfecto', 'lonsdale', 'panetela', 'panatela', 'figurado',
  'petit', 'gigante', 'double', 'magnum', 'presidente', 'rothschild', 'sublime',
];

// The nouns that name a size and nothing else. A title's "Corona" says how
// big the cigar is, not which cigar it is, so it is not evidence for a line
// that happens to carry the word. Modifiers ("double", "gran", "petit") are
// left out on purpose: they are part of real names like Double Ligero and
// Gran Reserva.
const SIZE_NOUNS = new Set([
  'robusto', 'toro', 'churchill', 'torpedo', 'belicoso', 'lancero', 'corona',
  'gordo', 'perfecto', 'lonsdale', 'panetela', 'panatela', 'figurado', 'gigante',
  'magnum', 'presidente', 'rothschild', 'sublime', 'salomon', 'piramide',
  'pyramid', 'culebra', 'cigarillo', 'cigarillos', 'petite', 'pequeno', 'pequenos',
  'minuto', 'mareva',
]);

/**
 * lowercase, drop accents, drop punctuation, drop noise words.
 * "Padrón 1964 Anniversary (Maduro), Box of 25" -> "padron 1964 anniversary maduro 25"
 */
function normalizeName(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')        // strip combining accents
    .toLowerCase()
    .replace(/&(amp|nbsp|quot|#\d+);/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')            // punctuation -> space
    .split(' ')
    .filter(t => t && !NOISE.has(t))
    .join(' ');
}

function tokenize(str) {
  const n = normalizeName(str);
  return n ? n.split(' ') : [];
}

/** "6 1/2" -> 6.5, "5.5" -> 5.5, "1/2" -> 0.5 */
function parseFraction(raw) {
  const s = String(raw).trim();
  const mixed = s.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = s.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const SIZE_RE = /(\d{1,2}\s+\d{1,2}\s*\/\s*\d{1,2}|\d{1,2}\s*\/\s*\d{1,2}|\d{1,2}(?:\.\d+)?)\s*(?:x|×)\s*(\d{2,3}(?:\.\d+)?)/i;

/**
 * Pull a cigar size out of free text.
 * '5x50', '5 x 50', '5.5x52', '6 1/2 x 52', '(5x50)' -> { length, ring }
 */
function parseSize(str) {
  if (!str) return null;
  const m = String(str).match(SIZE_RE);
  if (!m) return null;
  const length = parseFraction(m[1]);
  const ring = Math.round(Number(m[2]));
  if (!length || !Number.isFinite(length) || !Number.isFinite(ring)) return null;
  if (length < 2 || length > 14) return null;      // not a cigar length
  if (ring < 20 || ring > 100) return null;        // not a ring gauge
  return { length: Math.round(length * 100) / 100, ring };
}

const isNumeric = t => /^\d+$/.test(t);

/**
 * buildIndex(cigars, vitolas, aliases)
 *   cigars  [{ id, brand, name }]
 *   vitolas [{ id, cigar_id, name, length, ring_gauge }]
 *   aliases [{ normalized, cigar_id }]  curated "this raw title is that cigar"
 */
function buildIndex(cigars = [], vitolas = [], aliases = []) {
  const byId = new Map();
  const byBrand = new Map();

  for (const c of cigars) {
    if (!c || c.id === undefined || c.id === null) continue;
    const brandTokens = tokenize(c.brand);
    if (!brandTokens.length) continue;
    const nameTokens = tokenize(c.name);
    // A line whose name repeats its own brand ("Arturo Fuente" / "Fuente
    // Fuente OpusX") must not earn credit for the brand words: every product
    // by that brand carries them, so they identify nothing. Score on what is
    // left — here, "opusx" alone. Without this, any Arturo Fuente title
    // scored 2/3 against OpusX and the whole shop collapsed onto one line.
    const brandSet = new Set(brandTokens);
    // Each distinct word counts once: a name that repeats a word
    // ("Moontrance Moontrance") must not score twice for it.
    const distinct = [...new Set(nameTokens.filter(t => !brandSet.has(t)))];
    // Score on the words that identify the line. A size noun only counts when
    // it is all the name has left — Davidoff "Winston Churchill" still scores
    // on "winston", but a line named only "Churchill" keeps its one word.
    const identity = distinct.filter(t => !SIZE_NOUNS.has(t));
    const scoreTokens = identity.length ? identity : distinct;
    const sizeWords = distinct.length - scoreTokens.length;
    const entry = {
      id: c.id,
      brand: c.brand,
      name: c.name,
      brandKey: brandTokens.join(' '),
      brandTokens,
      nameTokens,
      scoreTokens,
      sizeWords,
      // A name that is nothing but a size ("Toro") identifies no line; it
      // loses every tie to a name that does.
      sizeOnly: identity.length === 0,
      nameNumbers: nameTokens.filter(isNumeric),
      vitolas: [],
    };
    byId.set(c.id, entry);
    if (!byBrand.has(entry.brandKey)) byBrand.set(entry.brandKey, { tokens: brandTokens, cigars: [] });
    byBrand.get(entry.brandKey).cigars.push(entry);
  }

  for (const v of vitolas || []) {
    const c = byId.get(v && v.cigar_id);
    if (!c) continue;
    c.vitolas.push({
      id: v.id,
      cigar_id: v.cigar_id,
      name: v.name,
      tokens: tokenize(v.name),
      length: v.length === null || v.length === undefined ? null : Number(v.length),
      ring_gauge: v.ring_gauge === null || v.ring_gauge === undefined ? null : Number(v.ring_gauge),
    });
  }

  const aliasMap = new Map();
  for (const a of aliases || []) {
    if (!a || !a.normalized || !a.cigar_id) continue;
    if (!byId.has(a.cigar_id)) continue;
    aliasMap.set(String(a.normalized), a.cigar_id);
  }

  return { byId, byBrand, aliases: aliasMap, size: byId.size };
}

/** Pick the vitola for a matched cigar from the raw product text. */
function pickVitola(entry, rawName, tokens, size) {
  const vitolas = entry.vitolas;
  if (!vitolas.length) return null;

  // 1. Exact printed size wins ("Robusto 5x50" when the catalog knows 5 x 50).
  if (size) {
    const exact = vitolas.find(v =>
      v.ring_gauge === size.ring && v.length !== null && Math.abs(v.length - size.length) < 0.13);
    if (exact) return exact;
    const ringOnly = vitolas.filter(v => v.ring_gauge === size.ring);
    if (ringOnly.length === 1) return ringOnly[0];
  }

  // 2. The catalog's own vitola name appears in the title ("Exclusivo",
  //    "Short Story", "No. 9"). Longest name wins so "Double Robusto" beats
  //    "Robusto".
  const tokenSet = new Set(tokens);
  let named = null;
  for (const v of vitolas) {
    if (!v.tokens.length) continue;
    if (!v.tokens.every(t => tokenSet.has(t))) continue;
    if (!named || v.tokens.length > named.tokens.length) named = v;
  }
  if (named) return named;

  // 3. A generic shape word in the title that one vitola happens to carry.
  for (const word of SHAPE_WORDS) {
    if (!tokenSet.has(word)) continue;
    const hit = vitolas.find(v => v.tokens.includes(word));
    if (hit) return hit;
  }

  // 4. Give up and use the line's first size, so the row still joins cleanly.
  return vitolas[0];
}

function result(entry, vitola, score) {
  return {
    cigar_id: entry.id,
    vitola_id: vitola ? vitola.id : null,
    score: Math.round(score * 100) / 100,
    brand: entry.brand,
    name: entry.name,
    vitola_name: vitola ? vitola.name : null,
  };
}

/**
 * matchCigar(rawName, index) -> null | { cigar_id, vitola_id, score, brand, name }
 *
 * Rules:
 *  - every token of the brand must be present in the title (no brand, no match)
 *  - candidates from that brand score = fraction of the cigar's name tokens present
 *  - numbers are compared exactly: a "1926" title never matches the "1964" line
 *  - accept >= 0.5, or >= 0.34 when the brand has a single line and the title
 *    printed a size (a lone-line brand plus a size is enough signal)
 */
function matchCigar(rawName, index) {
  if (!rawName || !index || !index.byId || !index.byId.size) return null;
  // Aliases were recorded against the whole title as a shop wrote it.
  const aliasNorm = normalizeName(rawName);
  // Scoring reads the title with its packaging taken out, so a "5-Pack" or a
  // "Box of 20" cannot pass itself off as the 5 in "No. 5" or the 20 in a
  // line's name.
  const norm = normalizeName(stripPackaging(rawName)) || aliasNorm;
  if (!norm) return null;
  const tokens = norm.split(' ');
  const tokenSet = new Set(tokens);
  const size = parseSize(rawName);

  // Curated alias: a human already told us what this title is.
  const aliasId = index.aliases.get(aliasNorm);
  if (aliasId) {
    const entry = index.byId.get(aliasId);
    if (entry) return result(entry, pickVitola(entry, rawName, tokens, size), 1);
  }

  let best = null;
  for (const [, brand] of index.byBrand) {
    if (!brand.tokens.every(t => tokenSet.has(t))) continue;
    const soloBrand = brand.cigars.length === 1;

    for (const entry of brand.cigars) {
      // A line named with a number only matches a title carrying that number.
      // Guards "Padron 1926 No. 9" against the 1964 line.
      if (entry.nameNumbers.length) {
        const anyNumberHit = entry.nameNumbers.some(n => tokenSet.has(n));
        const titleHasNumbers = tokens.some(isNumeric);
        if (!anyNumberHit && titleHasNumbers) continue;
      }

      let score;
      let hits = 0;
      if (!entry.scoreTokens.length) {
        score = 0.5; // brand-only line, or a name that is just the brand again
      } else {
        for (const t of entry.scoreTokens) if (tokenSet.has(t)) hits++;
        score = hits / entry.scoreTokens.length;
      }

      const threshold = soloBrand && size ? 0.34 : 0.5;
      if (score < threshold) continue;

      // Longer brand match, then higher score, then more literal tokens matched.
      // Longer brand match, then higher score, then more identifying words
      // matched, then the name carrying fewer size words: "Flavours
      // Moontrance" over "Flavours Corona Moontrance" for a Petit Corona.
      const sameSoFar = brand.tokens.length === best?.brandLen && score === best.score && hits === best.hits;
      const better = !best
        || brand.tokens.length > best.brandLen
        || (brand.tokens.length === best.brandLen && score > best.score)
        || (brand.tokens.length === best.brandLen && score === best.score && hits > best.hits)
        || (sameSoFar && best.entry.sizeOnly && !entry.sizeOnly)
        || (sameSoFar && entry.sizeOnly === best.entry.sizeOnly && entry.sizeWords < best.entry.sizeWords);
      if (better) best = { entry, score, hits, brandLen: brand.tokens.length };
    }
  }

  if (!best) return null;
  return result(best.entry, pickVitola(best.entry, rawName, tokens, size), best.score);
}

/**
 * Bump whenever scoring changes shape.
 *
 * Inventory read from a shop's website is only as good as the matcher that
 * read it, so a row carries the version that produced it. The menu scanner
 * treats anything matched by an older version as stale and re-reads that shop,
 * which is how a matcher fix reaches data that was already written instead of
 * waiting for the next weekly sweep.
 *
 *  1 — original
 *  2 — a line's name no longer earns credit for repeating its own brand
 *  3 — titles are read with packaging and counts removed, and a repeated
 *      word in a line's name counts once
 *  4 — the number of a "No. 5" or an "of 4" is never read as a pack count,
 *      and retired lines leave the index
 */
const MATCHER_VERSION = 4;

module.exports = { normalizeName, tokenize, parseSize, buildIndex, matchCigar, NOISE, SHAPE_WORDS, SIZE_NOUNS, MATCHER_VERSION };

// ── Self-test ───────────────────────────────────────────────────────────────
if (require.main === module) {
  let pass = 0, fail = 0;
  const ok = (cond, label, extra) => {
    if (cond) { pass++; console.log('  ok   ' + label); }
    else { fail++; console.log('  FAIL ' + label + (extra ? '  -> ' + JSON.stringify(extra) : '')); }
  };

  // ── normalizeName ──
  ok(normalizeName('Padrón 1964 Anniversary') === 'padron 1964 anniversary', 'normalize strips accents');
  ok(normalizeName('  Cigar,  Box of 25!  ') === '25', 'normalize drops noise + punctuation');
  ok(normalizeName('Arturo   Fuente') === 'arturo fuente', 'normalize collapses whitespace');
  ok(normalizeName(null) === '', 'normalize handles null');

  // ── parseSize ──
  const sizes = [
    ['5x50', 5, 50], ['5 x 50', 5, 50], ['5.5x52', 5.5, 52],
    ['6 1/2 x 52', 6.5, 52], ['Robusto (5x50)', 5, 50], ['Toro 6 X 52 Maduro', 6, 52],
  ];
  for (const [raw, l, r] of sizes) {
    const s = parseSize(raw);
    ok(s && s.length === l && s.ring === r, `parseSize ${JSON.stringify(raw)}`, s);
  }
  ok(parseSize('Xikar Xi2 Cutter') === null, 'parseSize ignores non-sizes');
  ok(parseSize('Box of 25') === null, 'parseSize ignores counts');

  // ── index ──
  const cigars = [
    { id: 1, brand: 'Padrón', name: '1964 Anniversary Series Natural' },
    { id: 2, brand: 'Padrón', name: '1964 Anniversary Series Maduro' },
    { id: 3, brand: 'Padrón', name: '1926 Serie' },
    { id: 4, brand: 'Arturo Fuente', name: 'Hemingway' },
    { id: 5, brand: 'Arturo Fuente', name: 'Fuente Fuente OpusX' },
    { id: 6, brand: 'Oliva', name: 'Serie V Melanio' },
    { id: 7, brand: 'Oliva', name: 'Serie O' },
    { id: 8, brand: 'Foundation', name: 'Tabernacle' },
  ];
  const vitolas = [
    { id: 11, cigar_id: 1, name: 'Exclusivo', length: 5.5, ring_gauge: 50 },
    { id: 12, cigar_id: 1, name: 'Principe', length: 4.5, ring_gauge: 46 },
    { id: 21, cigar_id: 2, name: 'Principe', length: 4.5, ring_gauge: 46 },
    { id: 22, cigar_id: 2, name: 'Exclusivo', length: 5.5, ring_gauge: 50 },
    { id: 23, cigar_id: 2, name: 'Torpedo', length: 6, ring_gauge: 52 },
    { id: 31, cigar_id: 3, name: 'No. 9', length: 5.25, ring_gauge: 56 },
    { id: 32, cigar_id: 3, name: 'No. 2', length: 5.5, ring_gauge: 52 },
    { id: 41, cigar_id: 4, name: 'Short Story', length: 4, ring_gauge: 49 },
    { id: 42, cigar_id: 4, name: 'Signature', length: 6, ring_gauge: 47 },
    { id: 51, cigar_id: 5, name: 'Robusto', length: 5.25, ring_gauge: 50 },
    { id: 61, cigar_id: 6, name: 'Robusto', length: 5, ring_gauge: 52 },
    { id: 62, cigar_id: 6, name: 'Churchill', length: 7, ring_gauge: 50 },
    { id: 71, cigar_id: 7, name: 'Robusto', length: 5, ring_gauge: 50 },
    { id: 81, cigar_id: 8, name: 'Robusto', length: 5, ring_gauge: 50 },
    { id: 82, cigar_id: 8, name: 'Toro', length: 6, ring_gauge: 52 },
  ];
  const aliases = [{ normalized: normalizeName('AF Hemingway SS'), cigar_id: 4 }];
  const index = buildIndex(cigars, vitolas, aliases);
  ok(index.size === 8, 'buildIndex loaded every cigar', index.size);
  ok(index.byId.get(2).vitolas.length === 3, 'buildIndex attached vitolas');

  // ── matchCigar ──
  let m = matchCigar('Padron 1964 Anniversary Exclusivo Maduro', index);
  ok(m && m.cigar_id === 2 && m.vitola_id === 22, 'Padron 1964 Anniversary Exclusivo Maduro -> 1964 Maduro / Exclusivo', m);

  m = matchCigar('Padron 1964 Anniversary Exclusivo Natural', index);
  ok(m && m.cigar_id === 1 && m.vitola_id === 11, 'the natural title takes the natural line', m);

  m = matchCigar('Arturo Fuente Hemingway Short Story', index);
  ok(m && m.cigar_id === 4 && m.vitola_id === 41, 'Arturo Fuente Hemingway Short Story -> Hemingway / Short Story', m);

  m = matchCigar('Xikar Xi2 Cutter', index);
  ok(m === null, 'Xikar Xi2 Cutter -> null (unknown brand)', m);

  m = matchCigar('Padron 1926 No. 9', index);
  ok(m && m.cigar_id === 3, 'Padron 1926 No. 9 -> the 1926, never the 1964', m);
  ok(m && m.vitola_id === 31, 'Padron 1926 No. 9 -> vitola No. 9', m);

  m = matchCigar('Padron 1926 Serie No. 2 Maduro', index);
  ok(m && m.cigar_id === 3 && m.vitola_id === 32, '1926 Serie No. 2 -> vitola No. 2', m);

  m = matchCigar('Oliva Serie V Melanio Robusto (5x52)', index);
  ok(m && m.cigar_id === 6 && m.vitola_id === 61, 'Oliva Serie V Melanio Robusto 5x52', m);

  m = matchCigar('Oliva Serie O Robusto', index);
  ok(m && m.cigar_id === 7, 'Oliva Serie O stays on the O line', m);

  // Single-line brand + printed size clears the lower 0.34 bar.
  m = matchCigar('Foundation Cigar Co. Tabernacle Havana Seed CT No. 142 Toro 6x52', index);
  ok(m && m.cigar_id === 8 && m.vitola_id === 82, 'single-line brand with a size matches at the lower bar', m);

  // Brand present but nothing else: below threshold.
  m = matchCigar('Oliva Ashtray', index);
  ok(m === null, 'brand alone is not a match', m);

  // Curated alias short-circuits the scorer.
  m = matchCigar('AF Hemingway SS', index);
  ok(m && m.cigar_id === 4 && m.score === 1, 'curated alias matches exactly', m);

  // Size beats a shape word when they disagree.
  m = matchCigar('Arturo Fuente Hemingway 6 x 47', index);
  ok(m && m.vitola_id === 42, 'exact size picks the Signature', m);

  // No vitola named or sized -> first vitola of the line, never a null join.
  m = matchCigar('Arturo Fuente Hemingway', index);
  ok(m && m.vitola_id === 41, 'falls back to the line first vitola', m);

  ok(matchCigar('', index) === null, 'empty title -> null');
  ok(matchCigar('Padron Robusto', buildIndex([], [], [])) === null, 'empty index -> null');

  // Real failures from Anthony's shelf.
  const real = buildIndex(
    [
      { id: 501, brand: 'La Gloria Cubana', name: 'Serie R No. 5' },
      { id: 502, brand: 'La Gloria Cubana', name: 'Serie R No. 8' },
      { id: 503, brand: 'CAO', name: 'Moontrance Moontrance' },
      { id: 504, brand: 'CAO', name: 'Flavours Moontrance' },
    ],
    [
      { id: 601, cigar_id: 501, name: 'Robusto' }, { id: 602, cigar_id: 502, name: 'Robusto' },
      { id: 603, cigar_id: 503, name: 'Robusto' }, { id: 604, cigar_id: 504, name: 'Robusto' },
    ], []);
  m = matchCigar('La Gloria Cubana Serie R No. 8 Natural 5-Pack', real);
  ok(m && m.cigar_id === 502, 'a "5-Pack" is not the 5 in "No. 5"', m);
  m = matchCigar('La Gloria Cubana Serie R No. 8 Maduro Box of 25', real);
  ok(m && m.cigar_id === 502, 'nor is "Box of 25" a number in the name', m);
  m = matchCigar('CAO Flavours Moontrance Robusto Box of 20', real);
  ok(m && m.cigar_id === 504, 'a name that repeats a word does not score twice for it', m);

  const sizeIdx = buildIndex(
    [
      { id: 701, brand: 'CAO', name: 'Flavours Moontrance' },
      { id: 702, brand: 'CAO', name: 'Flavours Corona Moontrance' },
      { id: 703, brand: 'Davidoff', name: 'Winston Churchill' },
      { id: 704, brand: 'Davidoff', name: 'Winston Churchill The Late Hour' },
      { id: 705, brand: 'Davidoff', name: 'Signature' },
    ],
    [701, 702, 703, 704, 705].map((c, i) => ({ id: 800 + i, cigar_id: c, name: 'Robusto' })), []);
  m = matchCigar('CAO Flavours Moontrance Petit Corona 5-Pack', sizeIdx);
  ok(m && m.cigar_id === 701, 'the size in a title is not evidence for a line carrying that word', m);
  m = matchCigar('Davidoff Winston Churchill Robusto', sizeIdx);
  ok(m && m.cigar_id === 703, 'Winston Churchill still matches on Winston', m);
  m = matchCigar('Davidoff Winston Churchill The Late Hour Toro', sizeIdx);
  ok(m && m.cigar_id === 704, 'and The Late Hour is still told apart from it', m);
  m = matchCigar('Davidoff Churchill Box of 25', sizeIdx);
  ok(!m || m.cigar_id !== 703, 'a bare "Churchill" size does not claim Winston Churchill', m);

  const onlySize = buildIndex(
    [{ id: 901, brand: 'Romeo y Julieta', name: 'Toro of' }, { id: 902, brand: 'Romeo y Julieta', name: 'Reserve' }],
    [{ id: 911, cigar_id: 901, name: 'Toro' }, { id: 912, cigar_id: 902, name: 'Toro' }], []);
  m = matchCigar('Romeo y Julieta Reserve Toro 5-Pack', onlySize);
  ok(m && m.cigar_id === 902, 'a line named only for a size loses the tie to one with a name', m);
  m = matchCigar('Romeo y Julieta Toro of 25', onlySize);
  ok(m && m.cigar_id === 902 || m && m.cigar_id === 901, 'and still matches when it is all there is', m);

  console.log(`\ncigarMatcher self-test: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
