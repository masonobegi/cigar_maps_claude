/**
 * Tier 0 inventory: read a shop's public online store.
 *
 * Most listings on our map are unclaimed shops that already sell online. A
 * Shopify store answers /products.json and a WooCommerce store answers the
 * Store API — both public, both JSON, no key needed. This job sniffs which
 * platform a website runs, pulls the product feed, matches each product to our
 * cigar catalog, and writes inventory rows tagged source='web' so a listing
 * nobody has claimed can still show what the shop carries.
 *
 * Rules of the road:
 *  - node built-ins only (https/http); no scraping libraries, no headless browser
 *  - one identifiable User-Agent, short timeouts, a 2 MB body cap, and a pause
 *    between shops so we are never a burden on a small retailer's site
 *  - source='web' rows are ours to write; anything an owner typed in is never
 *    touched
 *  - a shop can opt out (stores.menu_opt_out) and we stop reading it
 *
 * CLI:  node src/jobs/webMenu.js [--store ID] [--limit N]
 */
'use strict';

const https = require('https');
const http = require('http');
const { URL } = require('url');
const db = require('../database/db');
const { normalizeName, buildIndex, matchCigar, MATCHER_VERSION } = require('../utils/cigarMatcher');

const UA = 'CigarBuddy/1.0 (+https://cigarbuddy.com; menu reader)';
const TIMEOUT_MS = 12000;
const MAX_REDIRECTS = 3;
const MAX_BODY = 2 * 1024 * 1024; // 2 MB
const MAX_PAGES = 8;
const REDETECT_DAYS = 30;
const PAUSE_MS = 1500;

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Safety: never let a stored "website" point us at our own network ────────

function isPrivateHost(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;

  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;                 // link-local
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;       // CGNAT
    if (a >= 224) return true;                               // multicast / reserved
    return false;
  }
  if (h.includes(':')) {                                     // IPv6 literal
    if (h === '::1' || h === '::') return true;
    if (/^f[cd]/.test(h)) return true;                       // unique local
    if (/^fe[89ab]/.test(h)) return true;                    // link local
    return false;
  }
  return false;
}

function safeUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (isPrivateHost(u.hostname)) return null;
  return u;
}

/**
 * GET with a timeout, a body cap and bounded redirects. Resolves
 * { status, body, url, headers } or throws a short Error.
 */
function fetchUrl(raw, { redirects = MAX_REDIRECTS, accept = 'text/html,application/json' } = {}) {
  const u = safeUrl(raw);
  if (!u) return Promise.reject(new Error('unsafe url'));

  return new Promise((resolve, reject) => {
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.get(u, {
      headers: { 'User-Agent': UA, Accept: accept, 'Accept-Language': 'en-US,en;q=0.9' },
      timeout: TIMEOUT_MS,
    }, res => {
      const status = res.statusCode || 0;
      const loc = res.headers.location;
      if (status >= 300 && status < 400 && loc) {
        res.resume();
        if (redirects <= 0) return reject(new Error('too many redirects'));
        let next;
        try { next = new URL(loc, u).toString(); } catch { return reject(new Error('bad redirect')); }
        return resolve(fetchUrl(next, { redirects: redirects - 1, accept }));
      }

      let size = 0;
      let settled = false;
      const chunks = [];
      const done = () => {
        if (settled) return;
        settled = true;
        resolve({ status, body: Buffer.concat(chunks).toString('utf8'), url: u.toString(), headers: res.headers });
      };
      res.on('data', d => {
        size += d.length;
        if (size > MAX_BODY) { res.destroy(); done(); return; }  // 2 MB is plenty to sniff
        chunks.push(d);
      });
      res.on('end', done);
      res.on('close', done);
      res.on('error', err => {
        if (settled) return;
        settled = true;
        reject(new Error(err.message || 'read error'));
      });
    });

    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', err => reject(new Error(err.message || 'request failed')));
  });
}

// ── Platform detection ──────────────────────────────────────────────────────

const SNIFF = [
  ['shopify', /cdn\.shopify\.com|Shopify\.theme|shopify-section|myshopify\.com/i],
  ['woocommerce', /wp-content\/plugins\/woocommerce|wc-ajax|woocommerce-page|wc_add_to_cart/i],
  ['bigcommerce', /cdn\d*\.bigcommerce\.com|bigcommerce\.com\/s-/i],
  ['squarespace', /static\.squarespace\.com|squarespace\.com\/universal|Static\.SQUARESPACE_CONTEXT/i],
  ['wix', /static\.parastorage\.com|wixstatic\.com|wix\.com\//i],
];

/**
 * detectPlatform('example.com/shop') -> { platform, url }
 * Tries https first, falls back to http. platform is one of the SNIFF keys,
 * 'unknown' when nothing matched, or null when the site could not be read.
 */
async function detectPlatform(website) {
  const cleaned = String(website || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  if (!cleaned) return { platform: null, url: null, error: 'no website' };

  let last = null;
  for (const scheme of ['https://', 'http://']) {
    try {
      const res = await fetchUrl(scheme + cleaned);
      if (res.status >= 400) { last = `http ${res.status}`; continue; }
      const body = res.body || '';
      for (const [platform, re] of SNIFF) {
        if (re.test(body)) return { platform, url: res.url };
      }
      return { platform: 'unknown', url: res.url };
    } catch (err) {
      last = err.message;
    }
  }
  return { platform: null, url: null, error: last || 'unreachable' };
}

// ── Product feeds ───────────────────────────────────────────────────────────

const stripHtml = s => String(s == null ? '' : s)
  .replace(/<[^>]*>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&#\d+;/g, ' ').replace(/&[a-z]+;/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

function originOf(baseUrl) {
  try { return new URL(baseUrl).origin; } catch { return null; }
}

async function fetchJson(url) {
  const res = await fetchUrl(url, { accept: 'application/json' });
  if (res.status >= 400) throw new Error(`http ${res.status}`);
  const trimmed = (res.body || '').trim();
  if (!trimmed || (trimmed[0] !== '{' && trimmed[0] !== '[')) throw new Error('not json');
  return JSON.parse(trimmed);
}

async function fetchShopify(origin) {
  const products = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const data = await fetchJson(`${origin}/products.json?limit=250&page=${page}`);
    const list = Array.isArray(data && data.products) ? data.products : [];
    if (!list.length) break;
    for (const p of list) {
      const variants = Array.isArray(p.variants) && p.variants.length ? p.variants : [null];
      for (const variant of variants) {
        const v = variant || {};
        const suffix = v.title && v.title !== 'Default Title' ? ' ' + v.title : '';
        products.push({
          external_id: String(v.id != null ? v.id : p.id),
          title: stripHtml(p.title) + suffix,
          product_type: p.product_type || '',
          vendor: p.vendor || '',
          price: Number(v.price),
          available: v.available !== false,
          url: `${origin}/products/${p.handle}`,
        });
      }
    }
    if (list.length < 250) break;
  }
  return products;
}

async function fetchWoo(origin) {
  const products = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const data = await fetchJson(`${origin}/wp-json/wc/store/v1/products?per_page=100&page=${page}`);
    const list = Array.isArray(data) ? data : [];
    if (!list.length) break;
    for (const p of list) {
      const prices = p.prices || {};
      const minor = prices.currency_minor_unit == null ? 2 : Number(prices.currency_minor_unit);
      const price = prices.price == null ? NaN : Number(prices.price) / Math.pow(10, minor);
      products.push({
        external_id: String(p.id),
        title: stripHtml(p.name),
        product_type: (p.categories || []).map(c => c.name).filter(Boolean).join(' '),
        vendor: '',
        price,
        available: p.is_in_stock !== false,
        url: p.permalink || origin,
      });
    }
    if (list.length < 100) break;
  }
  return products;
}

/**
 * fetchProducts(baseUrl, platform) -> { products, status }
 * status is 'ok', 'unsupported', 'no_products' or 'error:<reason>'.
 */
async function fetchProducts(baseUrl, platform) {
  const origin = originOf(baseUrl);
  if (!origin) return { products: [], status: 'error:bad url' };
  if (platform !== 'shopify' && platform !== 'woocommerce') {
    return { products: [], status: 'unsupported' };
  }
  try {
    const products = platform === 'shopify' ? await fetchShopify(origin) : await fetchWoo(origin);
    return { products, status: products.length ? 'ok' : 'no_products' };
  } catch (err) {
    return { products: [], status: 'error:' + String(err.message || 'fetch failed').slice(0, 60) };
  }
}

// ── Is this thing a cigar? ──────────────────────────────────────────────────

const CIGAR_WORDS = /\b(cigars?|robustos?|toros?|churchills?|torpedos?|belicosos?|lanceros?|coronas?|gordos?|perfectos?|maduro|habano|connecticut|box of|single)\b/i;
const NOT_CIGAR = /\b(lighters?|cutters?|torch|butane|ashtrays?|humidors?|hygrometers?|cases?|hats?|shirts?|caps?|tee|mugs?|glass(es|ware)?|pipe tobacco|rolling|papers?|vape|e-?liquid|kratom|cbd|gift ?cards?)\b/i;

function isCigarProduct(p) {
  const hay = `${p.title || ''} ${p.product_type || ''}`;
  if (NOT_CIGAR.test(hay)) return false;
  return CIGAR_WORDS.test(hay);
}

// ── The sync ────────────────────────────────────────────────────────────────

/** Build the matching index from the whole catalog plus curated aliases. */
async function loadIndex() {
  const cigars = await db.all('SELECT id, brand, name FROM cigars', []);
  const vitolas = await db.all('SELECT id, cigar_id, name, length, ring_gauge FROM vitolas', []);
  const linked = await db.all(
    "SELECT normalized, suggested_cigar_id AS cigar_id FROM catalog_pending WHERE status = 'linked' AND suggested_cigar_id IS NOT NULL", []);
  return buildIndex(cigars, vitolas, linked);
}

/**
 * Re-sniff when we have never looked, when last time told us nothing, or when
 * the answer is a month old (shops do migrate platforms). detect_stale is
 * computed by the database so the age uses the clock that wrote the timestamp.
 */
function needsDetect(store) {
  if (!store.menu_platform || store.menu_platform === 'unknown') return true;
  return store.detect_stale === true || store.detect_stale === 1;
}

/**
 * syncStoreMenu(storeId, { index })
 * Reads one shop's online store and writes its source='web' inventory rows.
 */
async function syncStoreMenu(storeId, { index = null, log = () => {} } = {}) {
  const store = await db.get(`
    SELECT id, name, website, menu_url, menu_platform, menu_opt_out, menu_checked_at,
      (menu_checked_at IS NULL OR menu_checked_at < NOW() - INTERVAL '${REDETECT_DAYS} days') AS detect_stale
    FROM stores WHERE id = ?`, [storeId]);
  if (!store) return { store_id: Number(storeId), skipped: 'no such store' };
  if (Number(store.menu_opt_out) === 1) return { store_id: store.id, name: store.name, skipped: 'opted out' };
  if (!store.website) return { store_id: store.id, name: store.name, skipped: 'no website' };

  const idx = index || await loadIndex();

  // 1. Which platform?
  let platform = store.menu_platform;
  let baseUrl = store.menu_url;
  if (needsDetect(store)) {
    const detected = await detectPlatform(store.website);
    platform = detected.platform;
    baseUrl = detected.url;
    if (!platform) {
      const status = 'error:' + String(detected.error || 'unreachable').slice(0, 60);
      await db.run('UPDATE stores SET menu_checked_at = NOW(), menu_status = ? WHERE id = ?', [status, store.id]);
      return { store_id: store.id, name: store.name, platform: null, status, products: 0, matched: 0 };
    }
  }
  if (!baseUrl) baseUrl = 'https://' + String(store.website).replace(/^https?:\/\//i, '').replace(/\/+$/, '');

  // 2. Pull the feed.
  const { products, status: fetchStatus } = await fetchProducts(baseUrl, platform);

  const summary = {
    store_id: store.id, name: store.name, platform, url: baseUrl,
    products: products.length, cigarlike: 0, matched: 0,
    inserted: 0, updated: 0, deactivated: 0, pending: 0, status: fetchStatus,
  };

  if (fetchStatus !== 'ok') {
    await db.run(
      'UPDATE stores SET menu_platform = ?, menu_url = ?, menu_checked_at = NOW(), menu_status = ? WHERE id = ?',
      [platform, baseUrl, fetchStatus, store.id]);
    return summary;
  }

  // 3. Match, and write the rows we own.
  const existing = await db.all(
    "SELECT id, external_id, price, in_stock FROM inventory WHERE store_id = ? AND source = 'web'", [store.id]);
  const byExternal = new Map(existing.map(r => [String(r.external_id), r]));
  const seen = new Set();
  const pending = new Map();

  for (const p of products) {
    if (!isCigarProduct(p)) continue;
    const externalId = String(p.external_id);
    if (seen.has(externalId)) continue;
    summary.cigarlike++;

    // The Shopify "vendor" field is usually the brand, and plenty of titles
    // leave the brand off, so it is worth feeding to the matcher.
    const match = matchCigar(`${p.title} ${p.vendor || ''}`, idx);
    if (!match || !match.vitola_id) {
      const norm = normalizeName(p.title);
      if (norm && !pending.has(norm)) pending.set(norm, p);
      continue;
    }
    summary.matched++;
    seen.add(externalId);

    const price = Number.isFinite(p.price) && p.price > 0 ? p.price : 0;
    const inStock = p.available ? 1 : 0;
    const row = byExternal.get(externalId);
    if (row) {
      await db.run(
        `UPDATE inventory SET price = ?, in_stock = ?, source_url = ?, cigar_id = ?, vitola_id = ?,
           last_confirmed_at = NOW(), updated_at = NOW()
         WHERE id = ? AND source = 'web'`,
        [price, inStock, p.url || null, match.cigar_id, match.vitola_id, row.id]);
      summary.updated++;
    } else {
      await db.run(
        `INSERT INTO inventory (store_id, cigar_id, vitola_id, price, quantity, in_stock,
           source, source_url, external_id, last_confirmed_at, updated_at)
         VALUES (?, ?, ?, ?, 0, ?, 'web', ?, ?, NOW(), NOW())`,
        [store.id, match.cigar_id, match.vitola_id, price, inStock, p.url || null, externalId]);
      summary.inserted++;
    }
  }

  // 4. Anything of ours the feed no longer lists is off the shelf. Only our
  //    own source='web' rows — an owner's typed inventory is never touched.
  const stale = existing.filter(r => !seen.has(String(r.external_id)) && Number(r.in_stock) === 1);
  for (const r of stale) {
    await db.run("UPDATE inventory SET in_stock = 0, updated_at = NOW() WHERE id = ? AND source = 'web'", [r.id]);
    summary.deactivated++;
  }

  // 5. Cigar-looking titles we could not place go to the human queue.
  for (const [norm, p] of pending) {
    const price = Number.isFinite(p.price) && p.price > 0 ? p.price : null;
    await db.run(
      `INSERT INTO catalog_pending (raw_name, normalized, store_id, source, price, seen_count, status)
       VALUES (?, ?, ?, 'web', ?, 1, 'pending')
       ON CONFLICT (normalized) DO UPDATE
         SET seen_count = catalog_pending.seen_count + 1,
             price = EXCLUDED.price,
             updated_at = NOW()`,
      [String(p.title).slice(0, 300), norm, store.id, price]);
    summary.pending++;
  }

  summary.status = `ok:${summary.matched}/${summary.cigarlike}`;
  await db.run(
    `UPDATE stores SET menu_platform = ?, menu_url = ?, menu_checked_at = NOW(),
       menu_last_synced = NOW(), menu_status = ?, menu_matcher_version = ? WHERE id = ?`,
    [platform, baseUrl, summary.status, MATCHER_VERSION, store.id]);

  log(`[menu] ${store.name} (${store.id}) ${platform}: ${summary.products} products, ` +
      `${summary.cigarlike} cigar-like, ${summary.matched} matched, ` +
      `+${summary.inserted}/~${summary.updated}/-${summary.deactivated}, ${summary.pending} pending`);
  return summary;
}

/**
 * Shops due a read: ones we have not looked at in a week, plus any whose
 * inventory was matched by an older matcher. The second clause is what carries
 * a matcher fix back through data that is already on the shelf — those shops
 * go first, because their rows are currently wrong rather than merely old.
 */
async function scanStale({ limit = 40, log = console.log } = {}) {
  const stores = await db.all(`
    SELECT id FROM stores
    WHERE website IS NOT NULL AND menu_opt_out = 0 AND visible = 1
      AND (menu_checked_at IS NULL
           OR menu_checked_at < NOW() - INTERVAL '7 days'
           OR menu_matcher_version IS DISTINCT FROM ?)
    ORDER BY (menu_matcher_version IS DISTINCT FROM ? AND menu_last_synced IS NOT NULL) DESC,
             claimed DESC, confidence DESC, id
    LIMIT ?`, [MATCHER_VERSION, MATCHER_VERSION, limit]);

  if (!stores.length) { log('[menu] no stale store menus'); return { scanned: 0, matched: 0, ok: 0, errors: 0 }; }

  const index = await loadIndex();
  const totals = { scanned: 0, matched: 0, inserted: 0, ok: 0, errors: 0, pending: 0 };

  for (const s of stores) {
    try {
      const r = await syncStoreMenu(s.id, { index });
      totals.scanned++;
      totals.matched += r.matched || 0;
      totals.inserted += r.inserted || 0;
      totals.pending += r.pending || 0;
      if (r.status && r.status.startsWith('ok')) totals.ok++;
    } catch (err) {
      totals.scanned++;
      totals.errors++;
      // One broken site must never stop the scan.
      try {
        await db.run('UPDATE stores SET menu_checked_at = NOW(), menu_status = ? WHERE id = ?',
          ['error:' + String(err.message || 'failed').slice(0, 60), s.id]);
      } catch {}
    }
    await sleep(PAUSE_MS);
  }

  log(`[menu] scanned ${totals.scanned} stores — ${totals.ok} with products, ${totals.matched} matches, ` +
      `${totals.inserted} new rows, ${totals.pending} queued for review, ${totals.errors} errors`);
  return totals;
}

/** Called from index.js on boot. Quiet in dev with DISABLE_MENU_SCAN=1. */
function runStartupMenuScan({ log = console.log } = {}) {
  if (process.env.DISABLE_MENU_SCAN === '1') return;
  setTimeout(() => {
    scanStale({ limit: 40, log }).catch(err => log('[menu] scan error: ' + err.message));
    setInterval(() => {
      scanStale({ limit: 60, log }).catch(err => log('[menu] scan error: ' + err.message));
    }, 6 * 60 * 60 * 1000);
    // Five minutes, not one: a cold deploy is still importing the directory
    // for the first couple of minutes, and there is no hurry here.
  }, 5 * 60 * 1000);
}

module.exports = {
  detectPlatform, fetchProducts, isCigarProduct, syncStoreMenu, scanStale,
  runStartupMenuScan, loadIndex, fetchUrl, safeUrl,
};

if (require.main === module) {
  const argv = process.argv.slice(2);
  const arg = name => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
  };
  const storeId = arg('--store');
  const limit = Number(arg('--limit')) || 40;
  const { initSchema, runMigrations } = require('../database/schema');

  (async () => {
    await initSchema();
    await runMigrations();
    if (storeId) {
      const r = await syncStoreMenu(Number(storeId), { log: console.log });
      console.log(JSON.stringify(r, null, 2));
    } else {
      console.log(await scanStale({ limit }));
    }
    process.exit(0);
  })().catch(err => { console.error(err); process.exit(1); });
}
