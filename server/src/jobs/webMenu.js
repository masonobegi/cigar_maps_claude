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
const { appUrl } = require('../utils/appUrl');

const UA = `CigarBuddy/1.0 (+${appUrl()}; menu reader)`;
const TIMEOUT_MS = 12000;
const MAX_REDIRECTS = 3;
const MAX_BODY = 2 * 1024 * 1024; // 2 MB
const MAX_PAGES = 8;
const REDETECT_DAYS = 30;
const PAUSE_MS = 1500;

/**
 * How long to wait before looking at a shop's online store again, by what
 * happened last time.
 *
 * The scan used to have no such thing. Every shop whose read failed kept
 * menu_matcher_version NULL, which kept it permanently eligible, and the
 * selection was ordered by placement and classifier confidence rather than by
 * when a shop was last looked at — so the same forty shops came back every six
 * hours, for ever. Thirty-six of the forty-three shops with a live shelf were
 * due no re-read in the next thirty days, and no shop outside that forty was
 * ever reached at all.
 */
const BACKOFF_DAYS = {
  ok: 7,
  // Most shops simply have no online store. Asking again tomorrow will not
  // change that, and asking 3,000 of them daily is most of the scan's budget.
  unsupported: 60,
  // A site that is down today may be up next week. Give it four chances,
  // further apart each time, then treat it like any other shop with no feed.
  error: [3, 7, 14, 30],
};

/** Stock nobody has confirmed for this long stops being called in stock. */
const STOCK_EXPIRY_DAYS = 21;

/**
 * A website that is dead is not worth a menu request. These are linkCheck's
 * verdicts for a domain that does not resolve, does not answer, or is no
 * longer the shop's at all.
 */
const DEAD_WEBSITE_STATUSES = ['dns_fail', 'timeout', 'refused', 'not_found', 'error',
  'parked', 'elsewhere', 'hijacked', 'store_unavailable', 'removed'];

/** When is this shop next due, given what just happened? */
function nextCheckAfter(outcome, failCount = 0, now = new Date()) {
  const days = outcome === 'ok' ? BACKOFF_DAYS.ok
    : outcome === 'unsupported' ? BACKOFF_DAYS.unsupported
      : BACKOFF_DAYS.error[Math.min(Math.max(failCount, 1) - 1, BACKOFF_DAYS.error.length - 1)];
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

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
  // A retired line was replaced by a better-shaped one; matching to it again
  // would undo the replacement.
  const cigars = await db.all("SELECT id, brand, name FROM cigars WHERE source IS DISTINCT FROM 'retired'", []);
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

/** The registrable host of a stored website, for grouping listings by feed. */
function feedHost(website) {
  return String(website || '').toLowerCase()
    .replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0].replace(/:\d+$/, '');
}

/**
 * When several listings share one website, which of them does the feed belong
 * to? The one whose address the site names.
 *
 * Anthony's web shop carries 2,634 in-stock rows and is attached to three
 * Tucson branches and not to the Phoenix one, so "in stock" at a branch really
 * means "on the chain's web shop". A customer who drives to the branch for a
 * box that is in a warehouse has been told something untrue.
 *
 * Returns the listing id that owns the feed, or null when only one listing uses
 * this site (the ordinary case) or when the site names nobody.
 */
async function feedOwner(store) {
  const host = feedHost(store.website);
  if (!host) return null;
  const siblings = await db.all(
    `SELECT id, address, city FROM stores
     WHERE visible = 1 AND COALESCE(menu_opt_out, 0) = 0 AND website IS NOT NULL
       AND lower(regexp_replace(regexp_replace(website, '^[a-z]+://', ''), '^www\\.', '')) LIKE ?
     ORDER BY id`, [`${host}%`]);
  if (siblings.length <= 1) return null;

  let page = null;
  try {
    const res = await fetchUrl('https://' + host, { accept: 'text/html' });
    if (res && res.status < 400 && res.body) page = String(res.body).toLowerCase().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  } catch {}
  if (!page) return null;

  const named = siblings.filter(sib => {
    const m = /^\s*(\d+[a-z]?)\s+(.+)$/.exec(String(sib.address || '').toLowerCase());
    if (!m) return false;
    const streetWord = m[2].split(/\s+/).find(w => w.length > 2 && !/^(n|s|e|w|ne|nw|se|sw|north|south|east|west|ste|suite|unit|#)$/.test(w));
    return !!streetWord && page.includes(m[1]) && page.includes(streetWord);
  });
  // Exactly one, or we do not know. Two branches both named on the home page is
  // a locations list, and picking either would be a guess.
  return named.length === 1 ? named[0].id : null;
}

/**
 * Record that we looked, whatever came of it, and say when to look again.
 *
 * Every outcome goes through here. A read that failed used to leave the shop
 * looking exactly like one that had never been tried, which is how the scan
 * ended up walking the same forty shops for ever.
 */
async function recordAttempt(storeId, outcome, { status, platform, url, failCount = 0, synced = false } = {}) {
  const next = nextCheckAfter(outcome, failCount);
  const sets = ['menu_checked_at = NOW()', 'menu_status = ?', 'menu_next_check_at = ?', 'menu_fail_count = ?'];
  const params = [String(status || outcome).slice(0, 120), next, outcome === 'error' ? failCount : 0];
  if (platform !== undefined) { sets.push('menu_platform = ?'); params.push(platform); }
  if (url !== undefined) { sets.push('menu_url = ?'); params.push(url); }
  if (synced) { sets.push('menu_last_synced = NOW()', 'menu_matcher_version = ?'); params.push(MATCHER_VERSION); }
  params.push(storeId);
  await db.run(`UPDATE stores SET ${sets.join(', ')} WHERE id = ?`, params);
  return next;
}

/**
 * syncStoreMenu(storeId, { index })
 * Reads one shop's online store and writes its source='web' inventory rows.
 */
async function syncStoreMenu(storeId, { index = null, log = () => {} } = {}) {
  const store = await db.get(`
    SELECT id, name, address, city, state, website, website_status, menu_url, menu_platform,
      menu_opt_out, menu_checked_at, COALESCE(menu_fail_count, 0) AS menu_fail_count,
      (menu_checked_at IS NULL OR menu_checked_at < NOW() - INTERVAL '${REDETECT_DAYS} days') AS detect_stale
    FROM stores WHERE id = ?`, [storeId]);
  if (!store) return { store_id: Number(storeId), skipped: 'no such store' };
  if (Number(store.menu_opt_out) === 1) return { store_id: store.id, name: store.name, skipped: 'opted out' };
  if (!store.website) {
    await recordAttempt(store.id, 'unsupported', { status: 'no website' });
    return { store_id: store.id, name: store.name, skipped: 'no website' };
  }
  // A domain that does not resolve, does not answer, or is not the shop's any
  // more has no menu behind it. Asking is a wasted request every time.
  if (DEAD_WEBSITE_STATUSES.includes(store.website_status)) {
    await recordAttempt(store.id, 'unsupported', { status: `website ${store.website_status}` });
    return { store_id: store.id, name: store.name, skipped: `website ${store.website_status}` };
  }
  // One website, several listings: the feed belongs to the branch whose address
  // the site names, not to every branch of the chain. Anthony's web shop was
  // counted as stock at three Tucson listings and not at the Phoenix one.
  const owner = await feedOwner(store);
  if (owner && owner !== store.id) {
    await recordAttempt(store.id, 'unsupported', { status: `feed belongs to #${owner}` });
    return { store_id: store.id, name: store.name, skipped: `shared website; the feed is listing #${owner}'s` };
  }

  const idx = index || await loadIndex();

  // 1. Which platform?
  let platform = store.menu_platform;
  let baseUrl = store.menu_url;
  if (needsDetect(store)) {
    const detected = await detectPlatform(store.website);
    platform = detected.platform;
    baseUrl = detected.url;
    if (!platform) {
      // No platform is not a failure — most shops simply have no online store.
      // Treating it as one put thousands of shops on a three-day retry.
      const unreachable = /unreachable|timeout|refused|dns/i.test(String(detected.error || ''));
      const status = (unreachable ? 'error:' : 'unsupported:') + String(detected.error || 'no online store').slice(0, 60);
      await recordAttempt(store.id, unreachable ? 'error' : 'unsupported', {
        status, failCount: unreachable ? Number(store.menu_fail_count) + 1 : 0,
      });
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
    await recordAttempt(store.id, 'error', {
      status: fetchStatus, platform, url: baseUrl, failCount: Number(store.menu_fail_count) + 1,
    });
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
  await recordAttempt(store.id, 'ok', { status: summary.status, platform, url: baseUrl, synced: true });

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
      AND (website_status IS NULL OR website_status NOT IN (${DEAD_WEBSITE_STATUSES.map(() => '?').join(',')}))
      AND (menu_next_check_at IS NULL OR menu_next_check_at <= NOW()
           OR menu_matcher_version IS DISTINCT FROM ?)
    ORDER BY
      -- A shop whose rows the current matcher has never touched is wrong now,
      -- not merely old, so it goes first.
      (menu_matcher_version IS DISTINCT FROM ? AND menu_last_synced IS NOT NULL) DESC,
      -- Then shops nobody has ever looked at. Under the old order, ranked by
      -- placement and classifier confidence, no shop outside the top forty was
      -- ever reached at all.
      (menu_checked_at IS NULL) DESC,
      -- Then by how overdue, so the queue drains instead of circling.
      menu_next_check_at NULLS FIRST, menu_checked_at NULLS FIRST, id
    LIMIT ?`, [...DEAD_WEBSITE_STATUSES, MATCHER_VERSION, MATCHER_VERSION, limit]);

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
      // One broken site must never stop the scan — and it must still count as
      // an attempt, or the shop comes straight back to the front of the queue.
      try {
        const row = await db.get('SELECT COALESCE(menu_fail_count, 0) AS n FROM stores WHERE id = ?', [s.id]);
        await recordAttempt(s.id, 'error', {
          status: 'error:' + String(err.message || 'failed').slice(0, 60),
          failCount: (row ? Number(row.n) : 0) + 1,
        });
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
    const pass = (limit) => scanStale({ limit, log })
      .then(() => expireStaleStock({ log }))
      .then(() => expireHiddenStock({ log }))
      .catch(err => log('[menu] scan error: ' + err.message));
    pass(40);
    setInterval(() => pass(60), 6 * 60 * 60 * 1000);
    // Five minutes, not one: a cold deploy is still importing the directory
    // for the first couple of minutes, and there is no hurry here.
  }, 5 * 60 * 1000);
}

/**
 * Stock nobody has confirmed for three weeks stops being called in stock.
 *
 * A web feed's rows were left standing for ever once a shop's site stopped
 * answering, so "in stock" on a card could be a year old. The rows are marked
 * out of stock and told why — never deleted, because the shop may well still
 * carry the cigar and the row holds the price and the history.
 */
async function expireStaleStock({ days = STOCK_EXPIRY_DAYS, log = console.log } = {}) {
  const reason = `not confirmed by the shop's website in ${days} days`;
  const r = await db.run(`
    UPDATE inventory SET in_stock = 0, stale_reason = ?, updated_at = NOW()
    WHERE source = 'web' AND in_stock = 1
      AND COALESCE(last_confirmed_at, updated_at) < NOW() - INTERVAL '${Number(days)} days'`,
  [reason]);
  if (r.changes) log(`[menu] ${r.changes} stock rows expired: ${reason}`);
  return { expired: r.changes };
}

/**
 * Stock on a listing we have taken off the map stops being called in stock.
 *
 * A hidden listing is one we cannot show is a cigar shop, open, at the address
 * we hold — shut, a duplicate, not a retailer. Its shelf should not be
 * answering "who has this cigar near me". The public queries already join
 * stores and require visible = 1, so this is the second line rather than the
 * first: it means a query written later that forgets the join still cannot
 * publish a hidden shop's stock, and the counts in the database match what the
 * site says.
 *
 * Reconciled here rather than at each hide. Nine different places take a
 * listing off the map — six sweeps, a visitor report, a staff action, a
 * closure route — and a rule that has to be remembered in nine places is a
 * rule that will be missed in the tenth.
 *
 * Only web-read rows. A shop owner's own entry is theirs, stays as they left
 * it, and comes back untouched if the listing is restored. Nothing is deleted:
 * an unhide plus the next read of the shop's site puts the stock back.
 */
async function expireHiddenStock({ log = console.log } = {}) {
  const reason = 'the listing is not on the public map';
  const r = await db.run(`
    UPDATE inventory SET in_stock = 0, stale_reason = ?, updated_at = NOW()
    WHERE source = 'web' AND in_stock = 1
      AND store_id IN (SELECT id FROM stores WHERE visible = 0)`, [reason]);
  if (r.changes) log(`[menu] ${r.changes} stock rows taken out of public counts: ${reason}`);
  return { expired: r.changes };
}

module.exports = {
  detectPlatform, fetchProducts, isCigarProduct, syncStoreMenu, scanStale,
  runStartupMenuScan, loadIndex, fetchUrl, safeUrl,
  recordAttempt, nextCheckAfter, expireStaleStock, expireHiddenStock, feedOwner, feedHost,
  BACKOFF_DAYS, STOCK_EXPIRY_DAYS, DEAD_WEBSITE_STATUSES, replayThirtyDays, selftest,
};

// ── self-test ───────────────────────────────────────────────────────────────

/**
 * Replay the next thirty days of scanning against a model of the queue, and
 * check the two things that were broken: that a shop nobody has ever looked at
 * gets reached, and that a shop with a live shelf gets re-read.
 *
 * The model is the selection rule, not the database — it is the ORDER BY and
 * the back-off that were wrong, and a model of those can be checked without a
 * network or a stores table.
 */
function replayThirtyDays({ shops, perPass = 60, passesPerDay = 4, days = 30 } = {}) {
  const state = shops.map(s => ({ ...s, checkedAt: s.checkedAt ?? null, nextAt: s.nextAt ?? null, fails: 0, reads: 0, syncs: 0, syncHours: [] }));
  let now = 0;                                    // hours since the replay began
  for (let d = 0; d < days; d++) {
    for (let p = 0; p < passesPerDay; p++) {
      const due = state.filter(s => !s.dead && (s.nextAt === null || s.nextAt <= now || s.matcherStale));
      due.sort((a, b) => {
        const key = x => [
          x.matcherStale && x.synced ? 0 : 1,
          x.checkedAt === null ? 0 : 1,
          x.nextAt === null ? -Infinity : x.nextAt,
          x.checkedAt === null ? -Infinity : x.checkedAt,
          x.id,
        ];
        const ka = key(a), kb = key(b);
        for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] < kb[i] ? -1 : 1;
        return 0;
      });
      for (const s of due.slice(0, perPass)) {
        s.reads++;
        s.checkedAt = now;
        s.matcherStale = false;
        if (s.outcome === 'ok') { s.syncs++; s.syncHours.push(now); s.synced = true; s.fails = 0; s.nextAt = now + BACKOFF_DAYS.ok * 24; }
        else if (s.outcome === 'error') {
          s.fails++;
          s.nextAt = now + BACKOFF_DAYS.error[Math.min(s.fails - 1, BACKOFF_DAYS.error.length - 1)] * 24;
        } else { s.fails = 0; s.nextAt = now + BACKOFF_DAYS.unsupported * 24; }
      }
      now += 24 / passesPerDay;
    }
  }
  return state;
}

function selftest() {
  let pass = 0, fail = 0;
  const ok = (cond, label, extra) => {
    if (cond) { pass++; console.log(`  ok   ${label}`); }
    else { fail++; console.log(`  FAIL ${label}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ''}`); }
  };

  // The back-off schedule.
  const at = (o, n) => Math.round((nextCheckAfter(o, n, new Date(0)).getTime()) / 86400000);
  ok(at('ok', 0) === 7, 'a shop with a live feed comes back in a week');
  ok(at('unsupported', 0) === 60, 'a shop with no online store waits two months');
  ok(at('error', 1) === 3 && at('error', 2) === 7 && at('error', 3) === 14 && at('error', 4) === 30,
    'errors back off 3, 7, 14 then 30 days', [at('error', 1), at('error', 2), at('error', 3), at('error', 4)]);
  ok(at('error', 9) === 30, 'and stay at 30 however many times it fails');

  ok(DEAD_WEBSITE_STATUSES.includes('hijacked') && DEAD_WEBSITE_STATUSES.includes('dns_fail'),
    'a dead website is not asked for a menu');
  ok(!DEAD_WEBSITE_STATUSES.includes('blocked') && !DEAD_WEBSITE_STATUSES.includes('ok'),
    'but a site behind a firewall still is');

  ok(feedHost('https://www.anthonyscigars.com/shop') === 'anthonyscigars.com', 'a feed host drops scheme, www and path');
  ok(feedHost('anthonyscigars.com') === 'anthonyscigars.com', 'and a bare host is already one');

  // ── the replay ────────────────────────────────────────────────────────────
  // 4,000 shops, as production has: 43 with a live shelf, 200 that error, the
  // rest with no online store. Nothing has ever been read.
  const shops = [];
  for (let i = 1; i <= 4000; i++) {
    shops.push({
      id: i,
      outcome: i <= 43 ? 'ok' : i <= 243 ? 'error' : 'unsupported',
      checkedAt: null, nextAt: null, synced: false, matcherStale: false,
    });
  }
  const after = replayThirtyDays({ shops });

  const neverRead = after.filter(s => s.reads === 0);
  ok(neverRead.length === 0, 'every shop is reached inside thirty days', neverRead.length);

  const shelves = after.filter(s => s.outcome === 'ok');
  const reread = shelves.filter(s => s.syncs >= 2);
  ok(reread.length === shelves.length,
    `every one of the ${shelves.length} live shelves is re-read, not 7 of 43`,
    { reread: reread.length, of: shelves.length });
  // Three, not four, in the first month, and that is right: a shop nobody has
  // ever read goes ahead of a re-read, so the one-time backlog of 4,000 shops
  // holds the weekly cadence back while it drains. The steady state is what
  // matters, so the replay is run for two months and the second one measured.
  ok(shelves.every(s => s.syncs >= 2), 'at least twice even while the backlog drains', Math.min(...shelves.map(s => s.syncs)));
  const twoMonths = replayThirtyDays({ shops, days: 60 });
  const secondMonth = twoMonths.filter(s => s.outcome === 'ok')
    .map(s => s.syncHours.filter(h => h >= 30 * 24).length);
  ok(Math.min(...secondMonth) >= 4, 'and weekly once it has, four or more times in the second month', Math.min(...secondMonth));
  const backlogGone = twoMonths.filter(s => s.reads === 0).length;
  ok(backlogGone === 0, 'with nothing left unread');

  // A failing shop must not crowd the queue.
  const failing = after.filter(s => s.outcome === 'error');
  ok(failing.every(s => s.reads <= 7), 'a shop that keeps failing is not retried endlessly', Math.max(...failing.map(s => s.reads)));

  // The old rule, for comparison: same pool, but ordered by placement with no
  // back-off, which is what the scan actually did.
  const oldOrder = shops.map(s => ({ ...s, reads: 0, syncs: 0 }));
  let passes = 0;
  for (let d = 0; d < 30; d++) {
    for (let p = 0; p < 4; p++) {
      passes++;
      for (const s of oldOrder.slice(0, 60)) { s.reads++; if (s.outcome === 'ok') s.syncs++; }
    }
  }
  const oldNever = oldOrder.filter(s => s.reads === 0).length;
  ok(oldNever === 3940, `the old order left ${oldNever} shops untouched over ${passes} passes`, oldNever);

  console.log(`\nwebMenu self-test: ${pass} passed, ${fail} failed`);
  return fail;
}

if (require.main === module && process.argv[2] === 'selftest') {
  process.exit(selftest() ? 1 : 0);
}

if (require.main === module && process.argv[2] !== 'selftest') {
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
