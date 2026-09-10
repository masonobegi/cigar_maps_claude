/**
 * Learn the catalog from what shops actually sell.
 *
 * We shipped with 169 hand-written lines across 55 brands. The shops whose
 * websites we read list tens of thousands of cigar products, and 22,000 of
 * their titles matched nothing we knew — which is why a shop like Anthony's
 * showed a handful of brands on its page while its own site lists dozens.
 *
 * Every product title is brand + line + size + packaging. Strip the last two
 * and what remains is a line the catalog should know. Across every shop, the
 * same line turns up again and again in different sizes, and that repetition
 * is what lets us trust it.
 *
 * Sublines stay separate. Camacho Corojo, Camacho Connecticut and Camacho
 * Broadleaf are three lines, not three sizes of one — a wrapper word always
 * marks a subline. Sizes fold in beneath their line: "Fuente Fuente OpusX
 * Robusto" and "... Perfecxion No. 2" are both Fuente Fuente OpusX.
 *
 * Only new lines are written, tagged source='shop_feed'. Curated lines, which
 * a person wrote and which carry tasting notes, are never modified.
 *
 * CLI:  node src/jobs/buildCatalog.js --cache feeds.json          # read, save, propose
 *       node src/jobs/buildCatalog.js --cache feeds.json --confirm   # write what was reviewed
 */
'use strict';

const fs = require('fs');
const db = require('../database/db');
const { fetchProducts, isCigarProduct } = require('./webMenu');
const { SIZE_NOUNS } = require('../utils/cigarMatcher');
const { parseProductTitle, clean, calmCapitals, titleStartsWithBrand } = require('../utils/productParser');

const PAUSE_MS = 1200;

// A tail containing one of these is a different subline, never a size.
const WRAPPERS = /\b(maduro|connecticut|cameroon|habano|corojo|sumatra|oscuro|natural|claro|colorado|broadleaf|san andres|ecuador|ecuadorian|nicaragua|nicaraguan|criollo|rosado|candela|shade|sun grown|double maduro|triple maduro|reserva|reserve|limited|edition|anniversary|aniversario|especial|special|vintage|blue|red|black|white|gold|silver|green)\b/i;

// Things shops sell that are not cigars, in case the product filter let one by.
const NOT_A_CIGAR = /\b(cutter|lighter|torch|humidor|ashtray|cigar rest|case|hygrometer|boveda|humidifier|punch|holder|travel|stand|pouch|bag|shirt|hat|cap|gift card|card|glass|decanter|matches|lighter fluid|butane|pipe|tobacco pouch|rolling|papers|wraps|vape|hookah|shisha|grinder|scale|poster)\b/i;

const JUNK_LINE = /\b(sampler|assorted|assortment|variety|gift|collection set|bundle|combo|pack|kit|selection|sets?|flight|trio|duo|copy|compare|clone|knock-?off|replica|points|rated|out of stock|sold out|accessor(?:y|ies)|\d+ different)\b/i;

// Words a vendor field adds around a brand that do not change which brand it
// is: "Rocky Patel Premium Cigars" is Rocky Patel.
const GENERIC_BRAND_WORDS = /\b(?:premium|handmade|hand made|fine|cigars?|cigar co|cigar company|company|co|tobacco|tabacos?|inc|llc|ltd|brands?|international|usa)\b\.?/gi;

// A single shop's line must be short enough to be a name, not a sentence.
// Real names run long — "Long Live the King Mad MoFo Maduro" is seven words —
// and a line cut for length sends its stock to the wrong parent.
const MAX_LINE_WORDS_SINGLE_SHOP = 8;

/**
 * "Moontrance Moontrance" and "Nica Rustica Nica Rustica" are a shop typing
 * the name twice. "Fuente Fuente OpusX" is the name: a doubled word that is the
 * brand's own is deliberate, and is left alone.
 */
function collapseRepeats(line, brand) {
  const brandWords = new Set(clean(brand).split(' '));
  // The repeat must end at a space or the end: "Queen Queen's Sword" names two
  // different words and is left alone.
  return line.replace(/\b([A-Za-z0-9À-ɏ.'-]+(?:\s+[A-Za-z0-9À-ɏ.'-]+)?)\s+\1(?=\s|$)/gi,
    (whole, phrase) => (brandWords.has(clean(phrase)) ? whole : phrase));
}

/** "Don Pepin Garcia Cigars" is shown as Don Pepin Garcia. Only trailing. */
function displayBrand(name) {
  if (!name) return name;
  let s = name.trim();
  for (;;) {
    const next = s.replace(/[\s,]+(?:cigars?|cigar co\.?|cigar company|tabacos?|company|co\.?|inc\.?|llc|ltd\.?)$/i, '').trim();
    if (next === s || !next) break;
    s = next;
  }
  return s;
}

/**
 * A vendor field that names a sub-brand or a "line by maker" resolves to the
 * brand plus the start of the line.
 *
 *   "Arturo Fuente Hemingway"  -> Arturo Fuente, line begins "Hemingway"
 *   "1875 by Romeo y Julieta"  -> Romeo y Julieta, line begins "1875"
 *   "H. Upmann by AJ Fernandez"-> H. Upmann (it is already a brand; AJ made it)
 *
 * Only an established brand can absorb a vendor this way, so an unknown
 * two-word brand is never split in half.
 */
function resolveVendor(vendor, established, establishedPrefixes) {
  const v = String(vendor || '').trim();
  const by = v.match(/^(.+?)\s+by\s+(.+)$/i);
  if (by) {
    if (established(brandKey(by[1]))) return { brand: by[1].trim(), linePrefix: null };
    if (established(brandKey(by[2]))) return { brand: by[2].trim(), linePrefix: by[1].trim() };
  }
  const vc = clean(v);
  for (const b of establishedPrefixes) {
    if (!vc.startsWith(b.prefix + ' ')) continue;
    const extra = v.split(/\s+/).slice(b.prefix.split(' ').length).join(' ')
      .replace(GENERIC_BRAND_WORDS, ' ').replace(/\s+/g, ' ').trim();
    return { brand: b.name, linePrefix: extra || null };
  }
  return { brand: v, linePrefix: null };
}

// Years, ordinals and edition words name a release, and a release is a line:
// Rocky Patel Vintage 1990 and Vintage 1992 are different cigars, and so are
// My Father Le Bijou 1922 and CAO America 250th.
const RELEASE = /\b(?:1[89]\d\d|20\d\d|\d+(?:st|nd|rd|th)|anos|años|le|ltd|l\.e)\b/i;

/**
 * Could this tail be a size of the line before it, going by its words alone?
 *
 * It must carry a number ("Perfecxion No. 2", "No. 66") and must not name a
 * wrapper, an edition or a year — those are sublines. This is necessary but
 * not enough: see foldable(), which also asks the data.
 */
function tailIsSize(tail) {
  if (!tail) return false;
  if (!/\d/.test(tail)) return false;
  if (WRAPPERS.test(tail)) return false;
  if (RELEASE.test(tail)) return false;
  return tail.split(' ').length <= 4;
}

/**
 * A line that turns up in sizes of its own is a line, whatever its name looks
 * like. Liga Privada H99 is sold as a Robusto and a Toro, so H99 is a blend,
 * not a size of Liga Privada. OpusX Perfecxion No. 2 is never sold in any
 * other size, so Perfecxion No. 2 is the size.
 */
function foldable(tail, extended) {
  return tailIsSize(tail) && extended.sizes.size === 0;
}

/**
 * One identity per brand however a shop types it: "A.J. Fernandez",
 * "AJ Fernandez" and "aj fernandez" are one maker, and so are "Plasencia" and
 * "Plasencia Cigars". Company suffixes and every bit of punctuation go.
 */
function brandKey(brand) {
  return clean(brand)
    .replace(/\b(?:cigars?|cigar co|cigar company|tabacos?|tobacco|company|co|inc|llc|ltd)\b\.?/g, ' ')
    .replace(/[^a-z0-9]+/g, '');
}

/** Ordered, for prefix tests. "No. 2" and "#2" are the same thing. */
function lineKey(line) {
  return clean(line).replace(/[^a-z0-9]+/g, ' ').replace(/\bno\s+(?=\d)/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Which line this is, regardless of word order: one shop's "1875 Connecticut
 * Nicaragua" is another's "1875 Nicaragua Connecticut", and they are one cigar.
 */
function identityKey(line) {
  return lineKey(line).split(' ').filter(Boolean).sort().join(' ');
}

function keyOf(brand, line) {
  return `${brandKey(brand)}|${identityKey(line)}`;
}

const STOPWORDS = new Set(['of', 'the', 'and', 'en', 'de', 'la', 'el', 'y', 'by', 'with', 'in', 'a']);

/** Does this name say which cigar it is, or only how big and in what? */
function hasIdentity(line) {
  return lineKey(line).split(' ').some(t => t && !SIZE_NOUNS.has(t) && !STOPWORDS.has(t));
}

/**
 * The spelling to show. The catalog's own curated spelling wins; after that,
 * whatever most shops typed, preferring "Rocky Patel" over "ROCKY PATEL" or
 * "rocky patel" when counts tie.
 */
function pickSpelling(counts, preferred = null) {
  if (preferred) return preferred;
  if (!counts || !counts.size) return null;
  const caseScore = s => (s === s.toUpperCase() || s === s.toLowerCase() ? 0 : 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || caseScore(b[0]) - caseScore(a[0]) || a[0].localeCompare(b[0]))[0][0];
}

// What a shop platform writes into "vendor" when nobody fills it in.
const PLACEHOLDER_VENDORS = /^(?:my store|store|shop|default|vendor|unknown|n\/?a|none|test|brand|cigars?|tobacco)$/i;

/** A vendor field we will believe names a brand. */
function validVendor(v) {
  return !!v && v.length <= 40 && !PLACEHOLDER_VENDORS.test(v.trim())
    && !NOT_A_CIGAR.test(v) && !!brandKey(v);
}

/** "black label trading" is shown as Black Label Trading. */
function calmLowercase(s) {
  if (!s || s !== s.toLowerCase() || !/[a-z]/.test(s)) return s;
  return s.split(' ').map((w, i) => (i > 0 && /^(?:de|del|la|el|y|of|the|and|by)$/.test(w)
    ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
}

const alnum = s => clean(s).replace(/[^a-z0-9]+/g, '');

/**
 * Is this vendor field just the shop's own name?
 *
 * Shopify fills "vendor" with the store's name unless someone changes it, so a
 * shop called Cigars To Go lists every Rocky Patel and Padron it sells under
 * the vendor "Cigars To Go". Taken at face value, that invents a cigar brand
 * named after a shop.
 */
function isHouseVendor(vendor, feed) {
  const v = alnum(vendor);
  if (v.length < 4) return false;
  const store = alnum(feed.store && feed.store.name);
  const host = String(feed.url || '').replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  const domain = alnum(host.replace(/\.[a-z.]+$/i, ''));
  return (store && (store.includes(v) || v.includes(store)))
      || (domain.length >= 4 && (domain.includes(v) || v.includes(domain)));
}


/**
 * Longest known brand that opens a title, for feeds with no vendor field.
 * Brands are learned from shops that do fill it in, so one well-kept Shopify
 * store teaches us to read a WooCommerce store that did not bother.
 */
function brandFromTitle(title, brandsByLength) {
  const t = clean(title);
  for (const b of brandsByLength) {
    if (t === b.prefix || t.startsWith(b.prefix + ' ')) return b.name;
  }
  return null;
}

/**
 * Read every shop feed once, or replay a saved read.
 *
 * The cache is what makes review honest: the dry run reads the feeds and saves
 * them, a person reads the proposals, and --confirm builds from that same saved
 * read. A shop that changed its site in between cannot change what is written.
 */
async function loadFeeds({ log, cache = null }) {
  if (cache && fs.existsSync(cache)) {
    const feeds = JSON.parse(fs.readFileSync(cache, 'utf8'));
    log(`replaying ${feeds.length} saved shop feeds from ${cache}`);
    return feeds;
  }
  const feeds = await fetchFeeds({ log });
  if (cache) {
    // Only what parsing needs, so the file stays small.
    fs.writeFileSync(cache, JSON.stringify(feeds.map(f => ({
      url: f.url, store: { id: f.store.id, name: f.store.name },
      products: f.products.map(p => ({ title: p.title, vendor: p.vendor || '' })),
    }))));
    log(`saved ${feeds.length} feeds to ${cache}`);
  }
  return feeds;
}

async function fetchFeeds({ log }) {
  const stores = await db.all(`
    SELECT id, name, menu_platform, menu_url
    FROM stores
    WHERE menu_platform IN ('shopify', 'woocommerce') AND menu_url IS NOT NULL
      AND menu_opt_out = 0 AND visible = 1
    ORDER BY id
  `);
  log(`reading ${stores.length} shop feeds`);

  // Several listings can share one website (a chain's branches all point at
  // the same shop). Read each website once.
  const byUrl = new Map();
  for (const s of stores) if (!byUrl.has(s.menu_url)) byUrl.set(s.menu_url, s);

  const feeds = [];
  for (const [url, s] of byUrl) {
    try {
      const { products, status } = await fetchProducts(url, s.menu_platform);
      const cigars = (products || []).filter(isCigarProduct);
      feeds.push({ store: s, url, products: cigars });
      log(`  ${s.name}: ${cigars.length} cigar products (${status})`);
    } catch (err) {
      log(`  ${s.name}: failed (${err.message})`);
    }
    await new Promise(r => setTimeout(r, PAUSE_MS));
  }
  return feeds;
}

const bump = (map, key) => map.set(key, (map.get(key) || 0) + 1);

/**
 * Turn raw feeds into proposed lines. Pure: no I/O, so it can be tested.
 * `catalog` is the [{ brand, name }] the catalog already holds.
 */
function proposeLines(feeds, catalog = [], { minStores = 1 } = {}) {
  const known = new Set(catalog.map(c => keyOf(c.brand, c.name)));
  const curated = new Map();
  for (const c of catalog) if (!curated.has(brandKey(c.brand))) curated.set(brandKey(c.brand), c.brand);

  // 1. Brands, learned from every vendor field any shop filled in, plus the
  //    catalog's own. Each brand is known by every spelling it arrived in, and
  //    by how many different shops vouch for it.
  const spellings = new Map();              // brandKey -> Map(spelling -> count)
  const vouchers = new Map();               // brandKey -> Set(feed url)
  const prefixes = new Map();               // how a brand opens a title -> that spelling
  const learn = (name, feedUrl, weight = 1) => {
    const bk = brandKey(name);
    if (!bk) return;
    if (!spellings.has(bk)) spellings.set(bk, new Map());
    const m = spellings.get(bk);
    m.set(name, (m.get(name) || 0) + weight);
    if (!vouchers.has(bk)) vouchers.set(bk, new Set());
    if (feedUrl) vouchers.get(bk).add(feedUrl);
    prefixes.set(clean(name), name);
  };
  const plausible = (p, f) => {
    const v = String(p.vendor || '').trim();
    return validVendor(v) && !isHouseVendor(v, f) ? v : null;
  };

  // Is a vendor field telling the truth? The tell of a shop's alias is that
  // it files other makers' cigars: Cozy Cigar Lounge puts Arturo Fuente,
  // Cohiba, My Father and Padrón all under "handrolledcigars". A real maker's
  // titles open with its own name or its own lines — Drew Estate sells
  // "Deadwood", "Liga Privada", "Undercrown" — never with a rival's name. A
  // brand the catalog has, or that two shops use, is believed without asking.
  const rawVouchers = new Map();            // brandKey -> Set(feed url)
  const rawSpelling = new Map();            // brandKey -> a spelling
  for (const f of feeds) for (const p of f.products) {
    const v = plausible(p, f);
    if (!v) continue;
    const bk = brandKey(v);
    if (!rawVouchers.has(bk)) rawVouchers.set(bk, new Set());
    rawVouchers.get(bk).add(f.url);
    if (!rawSpelling.has(bk)) rawSpelling.set(bk, v);
  }
  for (const [bk, name] of curated) if (!rawSpelling.has(bk)) rawSpelling.set(bk, name);
  const knownOpeners = [...rawSpelling.entries()]
    .map(([bk, name]) => ({ bk, prefix: clean(name) }))
    .filter(b => b.prefix)
    .sort((a, b) => b.prefix.length - a.prefix.length);
  // The brand a title opens with, if some other shop (or the catalog) vouches
  // for it — a brand only this shop names proves nothing here.
  const openerElsewhere = (title, url) => {
    const t = clean(title);
    for (const b of knownOpeners) {
      if (t !== b.prefix && !t.startsWith(b.prefix + ' ')) continue;
      if (curated.has(b.bk) || [...rawVouchers.get(b.bk) || []].some(u => u !== url)) return b.bk;
    }
    return null;
  };
  const agreement = new Map();              // url|brandKey -> { self, other, total }
  for (const f of feeds) for (const p of f.products) {
    const v = plausible(p, f);
    if (!v) continue;
    const bk = brandKey(v);
    const key = `${f.url}|${bk}`;
    const a = agreement.get(key) || { self: 0, other: 0, total: 0 };
    a.total++;
    if (titleStartsWithBrand(p.title, v)) a.self++;
    else {
      const opener = openerElsewhere(p.title, f.url);
      if (opener && opener !== bk) a.other++;
    }
    agreement.set(key, a);
  }
  const trustworthy = (v, f) => {
    const bk = brandKey(v);
    if (curated.has(bk) || (rawVouchers.get(bk) || new Set()).size >= 2) return true;
    const a = agreement.get(`${f.url}|${bk}`);
    if (!a || !a.total) return false;
    if (a.self / a.total >= 0.5) return true;
    return a.other / a.total < 0.3;
  };
  const vendorOf = (p, f) => {
    const v = plausible(p, f);
    return v && trustworthy(v, f) ? v : null;
  };

  for (const f of feeds) for (const p of f.products) {
    const v = vendorOf(p, f);
    if (v) learn(v, f.url);
  }
  for (const [, name] of curated) learn(name, null, 0);

  // A brand is established when the catalog already has it or two shops that
  // do not share a website both file products under it. A shop's own name
  // never gets that far: only one shop ever uses it.
  const established = bk => curated.has(bk) || (vouchers.get(bk) || new Set()).size >= 2;
  // Vouched for by some shop other than this one — enough to overrule a
  // vendor field that only this shop uses.
  const vouchedElsewhere = (bk, url) => curated.has(bk) || [...(vouchers.get(bk) || [])].some(u => u !== url);
  const titlePrefixes = [...prefixes.entries()]
    .map(([prefix, name]) => ({ prefix, name }))
    .sort((a, b) => b.prefix.length - a.prefix.length);
  const establishedPrefixes = titlePrefixes.filter(b => established(brandKey(b.name)));
  const brandName = bk => displayBrand(calmLowercase(calmCapitals(pickSpelling(spellings.get(bk) || new Map(), curated.get(bk)))));

  // 2. Parse every product into brand / line / size, grouped by identity so
  //    every spelling of one line lands in one place.
  const groups = new Map();
  for (const f of feeds) {
    for (const p of f.products) {
      if (NOT_A_CIGAR.test(p.title)) continue;
      // Which brand is this? An established vendor field is believed. A vendor
      // only this shop uses is believed only when the title does not open with
      // an established brand instead — that is how "Cigars To Go" loses to
      // "Rocky Patel". Parsing uses the spelling the title actually carries so
      // the brand comes off cleanly; the canonical spelling is applied later.
      const v = vendorOf(p, f);
      const fromTitle = brandFromTitle(p.title, titlePrefixes);
      let vendor;
      if (v && established(brandKey(v))) vendor = v;
      else if (fromTitle && brandKey(fromTitle) !== brandKey(v || '') && vouchedElsewhere(brandKey(fromTitle), f.url)) vendor = fromTitle;
      else vendor = v || fromTitle;
      if (!vendor) continue;
      if (JUNK_LINE.test(vendor)) continue;
      const resolved = resolveVendor(vendor, established, establishedPrefixes);
      const parsed = parseProductTitle(p.title, resolved.brand);
      if (!parsed || !parsed.brand || !parsed.line) continue;
      // A sub-brand vendor leaves the start of the line to put back, unless
      // the title already carried it.
      if (resolved.linePrefix && !lineKey(parsed.line).startsWith(lineKey(resolved.linePrefix))) {
        parsed.line = `${resolved.linePrefix} ${parsed.line}`;
      }
      // "Cigars" names the product type, never the line; a leading "Company"
      // is the tail of a brand name the vendor field cut short.
      parsed.line = parsed.line
        .replace(/\bcigars?\b/gi, ' ')
        .replace(/^\s*(?:company|co\.?)\s+/i, '')
        // "Criollo and" is what is left of "Criollo and Connecticut" once the
        // listing's second half was read as something else.
        .replace(/\s+(?:and|&|or|with)\s*$/i, '')
        .replace(/[¨"“”]+/g, ' ')
        .replace(/\s+/g, ' ').trim();
      parsed.line = collapseRepeats(parsed.line, parsed.brand);
      // "20 Acre Farm" filed as its own brand with the line "by Drew Estate" is
      // the Drew Estate line 20 Acre Farm. Only when the vendor is not itself
      // established — H. Upmann by AJ Fernandez stays an H. Upmann.
      const byMaker = parsed.line.match(/^by\s+(.+)$/i);
      if (byMaker && established(brandKey(byMaker[1])) && !established(brandKey(parsed.brand))) {
        parsed.line = parsed.brand;
        parsed.brand = byMaker[1];
      }
      if (!parsed.line) continue;
      if (JUNK_LINE.test(parsed.line) || NOT_A_CIGAR.test(parsed.line)) continue;
      // A bare count ("20") is not a line; a model number is: Romeo y Julieta
      // 1875, Padrón 4000.
      if (parsed.line.length < 2) continue;
      if (/^[\d\s./-]+$/.test(parsed.line) && !/^\d{3,4}$/.test(parsed.line.trim())) continue;
      // "Toro of" names a size and nothing else.
      if (!hasIdentity(parsed.line)) continue;

      const bk = brandKey(parsed.brand);
      if (!bk) continue;
      const k = `${bk}|${identityKey(parsed.line)}`;
      if (!groups.has(k)) {
        groups.set(k, { bk, lineSpellings: new Map(), sizes: new Map(), stores: new Set() });
      }
      const g = groups.get(k);
      bump(g.lineSpellings, parsed.line);
      g.stores.add(f.url);
      if (parsed.size) {
        // "Belicoso 1" and "Belicoso No. 1" are one size; show the fuller name.
        const sk = lineKey(parsed.size).replace(/\bno\b/g, ' ').replace(/\s+/g, ' ').trim();
        const had = g.sizes.get(sk);
        if (sk && (!had || (!/no\.?\s*\d/i.test(had) && /no\.?\s*\d/i.test(parsed.size)))) g.sizes.set(sk, parsed.size);
      }
    }
  }
  for (const g of groups.values()) g.line = calmLowercase(calmCapitals(pickSpelling(g.lineSpellings)));

  // 3. Fold house sizes into their line. Within a brand, a line that merely
  //    extends a shorter one by a numbered tail, and is never itself sold in a
  //    size, is that shorter line in another size.
  const byBrand = new Map();
  for (const [k, g] of groups) {
    if (!byBrand.has(g.bk)) byBrand.set(g.bk, []);
    byBrand.get(g.bk).push([k, g]);
  }
  for (const [, list] of byBrand) {
    list.sort((a, b) => lineKey(a[1].line).length - lineKey(b[1].line).length);
    for (let i = 0; i < list.length; i++) {
      const [longKey, long] = list[i];
      if (!groups.has(longKey)) continue;
      const longK = lineKey(long.line);
      for (let j = i - 1; j >= 0; j--) {           // nearest parent first
        const [shortKey, short] = list[j];
        if (!groups.has(shortKey)) continue;
        const shortK = lineKey(short.line);
        if (!longK.startsWith(shortK + ' ')) continue;
        const tail = longK.slice(shortK.length).trim();
        if (!foldable(tail, long)) break;          // its nearest parent says no
        const shown = long.line.split(' ').slice(short.line.split(' ').length).join(' ') || tail;
        short.sizes.set(tail, shown);
        for (const s of long.stores) short.stores.add(s);
        groups.delete(longKey);
        break;
      }
    }
  }

  // 3b. The same, where the parent is a curated line. "Reserva Real #2" is the
  //     curated Reserva Real in its No. 2 size; it must not become a line of
  //     its own. Curated lines are never edited, so the group is simply not
  //     proposed and its stock will match the curated line.
  const curatedLines = new Map();           // brandKey -> [lineKey]
  for (const c of catalog) {
    const bk = brandKey(c.brand);
    if (!curatedLines.has(bk)) curatedLines.set(bk, []);
    curatedLines.get(bk).push(lineKey(c.name));
  }
  for (const [k, g] of groups) {
    const longK = lineKey(g.line);
    const parent = (curatedLines.get(g.bk) || [])
      .filter(ck => ck && longK.startsWith(ck + ' '))
      .sort((a, b) => b.length - a.length)[0];
    if (parent && foldable(longK.slice(parent.length).trim(), g)) groups.delete(k);
  }

  // 4. Keep what is new and seen often enough to trust.
  const proposals = [];
  let alreadyKnown = 0;
  for (const [k, g] of groups) {
    if (known.has(k)) { alreadyKnown++; continue; }
    if (g.stores.size < minStores) continue;
    const brand = brandName(g.bk);
    if (!brand || !g.line) continue;              // the catalog requires both
    // One shop's odd title is not a line. Several shops agreeing on a long name
    // is fine; one shop's sentence-length title is not.
    if (g.stores.size === 1 && g.line.split(' ').length > MAX_LINE_WORDS_SINGLE_SHOP) continue;
    proposals.push({
      brand,
      line: g.line,
      sizes: [...g.sizes.values()].filter(s => s && !/^[\d\s./-]+$/.test(s)).sort(),
      storeCount: g.stores.size,
    });
  }
  proposals.sort((a, b) => b.storeCount - a.storeCount || a.brand.localeCompare(b.brand) || a.line.localeCompare(b.line));
  return { proposals, alreadyKnown, brandsLearned: spellings.size };
}

async function buildCatalog({ confirm = false, minStores = 1, cache = null, log = console.log } = {}) {
  // Writing from a fresh read would mean writing something nobody reviewed.
  if (confirm && !(cache && fs.existsSync(cache))) {
    throw new Error('--confirm needs --cache <file> saved by a reviewed dry run');
  }
  const feeds = await loadFeeds({ log, cache });
  const existing = await db.all('SELECT brand, name FROM cigars');

  const { proposals, alreadyKnown, brandsLearned } = proposeLines(feeds, existing, { minStores });
  const brands = new Set(proposals.map(p => brandKey(p.brand)));
  const sizeCount = proposals.reduce((n, p) => n + Math.max(1, p.sizes.length), 0);

  log(`\nbrands learned from shop feeds: ${brandsLearned}`);
  log(`lines already in the catalog: ${alreadyKnown}`);
  log(`new lines to add: ${proposals.length} across ${brands.size} brands, ${sizeCount} sizes`);
  for (const p of proposals.slice(0, 25)) {
    log(`  ${p.brand} — ${p.line}  [${p.storeCount} shop${p.storeCount === 1 ? '' : 's'}]` +
        (p.sizes.length ? `  sizes: ${p.sizes.slice(0, 6).join(', ')}${p.sizes.length > 6 ? ` +${p.sizes.length - 6}` : ''}` : ''));
  }
  if (proposals.length > 25) log(`  ...and ${proposals.length - 25} more`);

  if (!confirm) {
    log('\nDry run. Nothing written. Re-run with --confirm to add these lines.');
    return { dryRun: true, proposals: proposals.length, brands: brands.size };
  }

  const written = await writeLines(proposals);

  // Shops whose feeds we just learned from can now match far more of what
  // they sell. Clearing the version sends them to the front of the next scan.
  const reset = await db.run(`
    UPDATE stores SET menu_matcher_version = NULL
    WHERE menu_platform IN ('shopify', 'woocommerce') AND menu_url IS NOT NULL
  `);

  log(`\nadded ${written.lines} lines and ${written.vitolas} sizes. ${reset.changes} shops queued for a re-read.`);
  return written;
}

/**
 * Write every proposed line and its sizes in one statement.
 *
 * One statement is one transaction: the catalog gains all of these lines or
 * none of them, never half a brand. It is also one round trip instead of
 * twenty thousand. A line already in the catalog, in any capitalisation, is
 * skipped, so running this twice adds nothing the second time.
 */
async function writeLines(proposals) {
  // Two proposals can only share a display name if two spellings collapsed
  // onto it; fold their sizes together so the join below stays one-to-one.
  const byName = new Map();
  for (const p of proposals) {
    const k = `${p.brand.toLowerCase()}|${p.line.toLowerCase()}`;
    const cur = byName.get(k);
    if (cur) {
      cur.sizes = [...new Set([...cur.sizes, ...p.sizes])];
      cur.seen = Math.max(cur.seen, p.storeCount);
    } else {
      byName.set(k, { brand: p.brand, name: p.line, seen: p.storeCount, sizes: [...p.sizes] });
    }
  }
  const rows = [...byName.values()].map(r => ({
    ...r,
    // Every line needs at least one size for inventory to attach to. A line
    // only ever seen without a size gets a single honest placeholder, which
    // the store page knows not to display.
    sizes: r.sizes.length ? r.sizes : ['Assorted'],
  }));
  if (!rows.length) return { lines: 0, vitolas: 0 };

  const result = await db.get(`
    WITH input AS (
      SELECT * FROM json_to_recordset(?::json) AS x(brand text, name text, seen int, sizes json)
    ),
    fresh AS (
      SELECT i.* FROM input i
      WHERE NOT EXISTS (
        SELECT 1 FROM cigars c
        WHERE LOWER(c.brand) = LOWER(i.brand) AND LOWER(c.name) = LOWER(i.name)
      )
    ),
    ins AS (
      INSERT INTO cigars (brand, name, source, seen_at_stores)
      SELECT brand, name, 'shop_feed', seen FROM fresh
      RETURNING id, brand, name
    ),
    sizes AS (
      INSERT INTO vitolas (cigar_id, name)
      SELECT ins.id, s.value
      FROM ins
      JOIN fresh f ON f.brand = ins.brand AND f.name = ins.name
      CROSS JOIN LATERAL json_array_elements_text(f.sizes) AS s(value)
      RETURNING id
    )
    SELECT (SELECT COUNT(*) FROM ins)::int AS lines, (SELECT COUNT(*) FROM sizes)::int AS vitolas
  `, [JSON.stringify(rows)]);
  return { lines: result.lines, vitolas: result.vitolas };
}

module.exports = { buildCatalog, proposeLines, writeLines, tailIsSize, foldable, keyOf, brandKey, lineKey, pickSpelling, brandFromTitle };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const arg = name => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : null; };
  const { initSchema, runMigrations } = require('../database/schema');
  (async () => {
    await initSchema();
    await runMigrations();
    await buildCatalog({
      confirm: argv.includes('--confirm'),
      minStores: Number(arg('--min-stores')) || 1,
      cache: arg('--cache'),
    });
    process.exit(0);
  })().catch(err => { console.error(err); process.exit(1); });
}
