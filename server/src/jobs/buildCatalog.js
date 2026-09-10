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
 * CLI:  node src/jobs/buildCatalog.js [--confirm] [--min-stores N]
 */
'use strict';

const db = require('../database/db');
const { fetchProducts, isCigarProduct } = require('./webMenu');
const { parseProductTitle, clean } = require('../utils/productParser');

const PAUSE_MS = 1200;

// A tail containing one of these is a different subline, never a size.
const WRAPPERS = /\b(maduro|connecticut|cameroon|habano|corojo|sumatra|oscuro|natural|claro|colorado|broadleaf|san andres|ecuador|ecuadorian|nicaragua|nicaraguan|criollo|rosado|candela|shade|sun grown|double maduro|triple maduro|reserva|reserve|limited|edition|anniversary|aniversario|especial|special|vintage|blue|red|black|white|gold|silver|green)\b/i;

// Things shops sell that are not cigars, in case the product filter let one by.
const NOT_A_CIGAR = /\b(cutter|lighter|torch|humidor|ashtray|case|hygrometer|boveda|humidifier|punch|holder|travel|stand|pouch|bag|shirt|hat|cap|gift card|card|glass|decanter|matches|lighter fluid|butane|pipe|tobacco pouch|rolling|papers|wraps|vape|hookah|shisha|grinder|scale|poster)\b/i;

const JUNK_LINE = /\b(sampler|assorted|variety|gift|collection set|bundle|combo|pack|kit|selection)\b/i;

/**
 * Does this tail name a size of the line before it?
 *
 * Only a tail carrying a number qualifies ("Perfecxion No. 2", "No. 66",
 * "Short Story 4"), and never one that names a wrapper or edition — those are
 * sublines. Erring this way means an unusual size occasionally stays its own
 * entry, which is harmless; erring the other way would bury a real subline
 * inside its parent, which is not.
 */
function tailIsSize(tail) {
  if (!tail) return false;
  if (!/\d/.test(tail)) return false;
  if (WRAPPERS.test(tail)) return false;
  return tail.split(' ').length <= 4;
}

function keyOf(brand, line) {
  return `${clean(brand)}|${clean(line)}`;
}

/**
 * Longest known brand that opens a title, for feeds with no vendor field.
 * Brands are learned from shops that do fill it in, so one well-kept Shopify
 * store teaches us to read a WooCommerce store that did not bother.
 */
function brandFromTitle(title, brandsByLength) {
  const t = clean(title);
  for (const b of brandsByLength) {
    if (t === b.key || t.startsWith(b.key + ' ')) return b.name;
  }
  return null;
}

async function loadFeeds({ log }) {
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

/**
 * Turn raw feeds into proposed lines. Pure: no I/O, so it can be tested.
 * `known` is a Set of keyOf(brand, name) for lines the catalog already has.
 */
function proposeLines(feeds, known, { minStores = 1 } = {}) {
  // 1. Brands, learned from every vendor field any shop filled in.
  const brandNames = new Map();
  for (const f of feeds) {
    for (const p of f.products) {
      const v = String(p.vendor || '').trim();
      if (v && v.length <= 40 && !NOT_A_CIGAR.test(v)) brandNames.set(clean(v), v);
    }
  }
  const brandsByLength = [...brandNames.entries()]
    .map(([key, name]) => ({ key, name }))
    .sort((a, b) => b.key.length - a.key.length);

  // 2. Parse every product into brand / line / size.
  const groups = new Map();
  for (const f of feeds) {
    for (const p of f.products) {
      if (NOT_A_CIGAR.test(p.title)) continue;
      const vendor = String(p.vendor || '').trim() || brandFromTitle(p.title, brandsByLength);
      if (!vendor) continue;
      const parsed = parseProductTitle(p.title, vendor);
      if (!parsed || !parsed.brand || !parsed.line) continue;
      if (JUNK_LINE.test(parsed.line) || NOT_A_CIGAR.test(parsed.line)) continue;
      if (parsed.line.length < 2 || /^\d+$/.test(parsed.line)) continue;

      const k = keyOf(parsed.brand, parsed.line);
      if (!groups.has(k)) {
        groups.set(k, { brand: parsed.brand, line: parsed.line, sizes: new Map(), stores: new Set() });
      }
      const g = groups.get(k);
      g.stores.add(f.url);
      if (parsed.size) g.sizes.set(clean(parsed.size), parsed.size);
    }
  }

  // 3. Fold house sizes into their line. Within a brand, a line that merely
  //    extends a shorter line by a numbered tail is that line in another size.
  const byBrand = new Map();
  for (const [k, g] of groups) {
    const b = clean(g.brand);
    if (!byBrand.has(b)) byBrand.set(b, []);
    byBrand.get(b).push([k, g]);
  }
  for (const [, list] of byBrand) {
    list.sort((a, b) => clean(a[1].line).length - clean(b[1].line).length);
    for (let i = 0; i < list.length; i++) {
      const [longKey, long] = list[i];
      if (!groups.has(longKey)) continue;
      const longLine = clean(long.line);
      for (let j = 0; j < i; j++) {
        const [shortKey, short] = list[j];
        if (!groups.has(shortKey)) continue;
        const shortLine = clean(short.line);
        if (!longLine.startsWith(shortLine + ' ')) continue;
        const tail = long.line.slice(short.line.length).trim();
        if (!tailIsSize(clean(tail))) continue;
        short.sizes.set(clean(tail), tail);
        for (const [sk, sv] of long.sizes) short.sizes.set(sk, sv);
        for (const s of long.stores) short.stores.add(s);
        groups.delete(longKey);
        break;
      }
    }
  }

  // 4. Keep what is new and seen often enough to trust.
  const proposals = [];
  let alreadyKnown = 0;
  for (const [k, g] of groups) {
    if (known.has(k)) { alreadyKnown++; continue; }
    if (g.stores.size < minStores) continue;
    proposals.push({
      brand: g.brand,
      line: g.line,
      sizes: [...g.sizes.values()].sort(),
      storeCount: g.stores.size,
    });
  }
  proposals.sort((a, b) => b.storeCount - a.storeCount || a.brand.localeCompare(b.brand) || a.line.localeCompare(b.line));
  return { proposals, alreadyKnown, brandsLearned: brandsByLength.length };
}

async function buildCatalog({ confirm = false, minStores = 1, log = console.log } = {}) {
  const feeds = await loadFeeds({ log });
  const existing = await db.all('SELECT brand, name FROM cigars');
  const known = new Set(existing.map(c => keyOf(c.brand, c.name)));

  const { proposals, alreadyKnown, brandsLearned } = proposeLines(feeds, known, { minStores });
  const brands = new Set(proposals.map(p => clean(p.brand)));
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

  let lines = 0, vitolas = 0;
  for (const p of proposals) {
    const row = await db.get(`
      INSERT INTO cigars (brand, name, source, seen_at_stores)
      VALUES (?, ?, 'shop_feed', ?)
      RETURNING id
    `, [p.brand, p.line, p.storeCount]);
    lines++;
    // Every line needs at least one size for inventory to attach to. A line
    // we only ever saw without a size gets a single honest placeholder.
    const sizes = p.sizes.length ? p.sizes : ['Assorted'];
    for (const s of sizes) {
      await db.run('INSERT INTO vitolas (cigar_id, name) VALUES (?, ?)', [row.id, s]);
      vitolas++;
    }
  }

  // Shops whose feeds we just learned from can now match far more of what
  // they sell. Clearing the version sends them to the front of the next scan.
  const reset = await db.run(`
    UPDATE stores SET menu_matcher_version = NULL
    WHERE menu_platform IN ('shopify', 'woocommerce') AND menu_url IS NOT NULL
  `);

  log(`\nadded ${lines} lines and ${vitolas} sizes. ` +
      `${reset && reset.rowCount !== undefined ? reset.rowCount + ' shops' : 'Shop menus'} queued for a re-read.`);
  return { lines, vitolas };
}

module.exports = { buildCatalog, proposeLines, tailIsSize, keyOf, brandFromTitle };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const arg = name => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : null; };
  const { initSchema, runMigrations } = require('../database/schema');
  (async () => {
    await initSchema();
    await runMigrations();
    await buildCatalog({ confirm: argv.includes('--confirm'), minStores: Number(arg('--min-stores')) || 1 });
    process.exit(0);
  })().catch(err => { console.error(err); process.exit(1); });
}
