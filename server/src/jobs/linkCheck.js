/**
 * Website link checker for directory listings.
 *
 * The national directory came from Overture Maps + OpenStreetMap, and a large
 * share of the website fields in it are stale: domains that expired years ago,
 * pages that now sit on a registrar's parking service, hosting that lapsed.
 * Rendering one of those as a working link makes the whole directory look
 * untrustworthy, so every stored website gets verified and only a verified
 * 'ok' is safe for the UI to treat as a link.
 *
 * Rules of the road:
 *  - node built-ins only (https/http/dns); no new dependencies
 *  - DNS first: most dead links never resolve at all, and that check is cheap
 *  - HEAD before GET, one identifiable User-Agent, a 10 s timeout, a 256 KB
 *    body cap, and body read only when a 200 needs to be sniffed for parking
 *  - never throw: every failure mode is a status
 *
 * CLI:  node src/jobs/linkCheck.js [--limit N] [--store ID] [--recheck-days N]
 */
'use strict';

const https = require('https');
const http = require('http');
const dns = require('dns').promises;
const { URL } = require('url');
const db = require('../database/db');

const UA = 'CigarBuddy/1.0 (+https://cigarbuddy.com; link check)';
const TIMEOUT_MS = 10000;
const MAX_REDIRECTS = 4;
const MAX_BODY = 256 * 1024;      // 256 KB, the hard cap on anything we read
const TINY_BODY = 24 * 1024;      // a "for sale" page is small; a real shop's is not
const CONCURRENCY = 6;
const OVERALL_BUDGET_MS = 30000;  // whole check for one store, redirects included

/** Statuses this module can write. Only 'ok' means the link is usable. */
const STATUSES = ['ok', 'blocked', 'dns_fail', 'timeout', 'refused', 'not_found', 'error', 'parked'];

// A site that answers but refuses to serve a robot is alive for a customer.
// Cloudflare and similar front doors return 403 to anything that is not a
// browser, and several real shops sit behind them, so this is its own verdict
// and is treated as a working link.
const BLOCKED_CODES = new Set([401, 402, 403, 407, 429, 451]);

// Hosts that only ever serve a for-sale / parking page. Landing on one of these
// means the domain is not the shop's site any more, whatever it returns.
const PARK_HOSTS = [
  'sedoparking.com', 'sedo.com', 'afternic.com', 'hugedomains.com', 'bodis.com',
  'parkingcrew.net', 'parkingcrew.com', 'dan.com', 'undeveloped.com', 'above.com',
  'parked.com', 'parkingpage.namecheap.com', 'cashparking.com', 'domainmarket.com',
  'buydomains.com', 'brandbucket.com', 'squadhelp.com', 'atom.com', 'efty.com',
  'sav.com', 'uniregistry.com', 'namesilo.com', 'domainnamesales.com',
  'searchvity.com', 'fastpark.net', 'voodoo.com', 'skenzo.com', 'smartname.com',
];

// Hosts that serve both real sites and blank builder placeholders. Landing here
// is not enough on its own — the body has to look like a placeholder too.
const PLACEHOLDER_HOSTS = [
  'godaddysites.com', 'websitebuilder.godaddy.com', 'secureserver.net',
  'wixsite.com', 'weebly.com', 'business.site', 'mysite.com',
];

// Phrases that mark a small page as a parking / for-sale / expired placeholder.
// Kept specific on purpose: a shop's own page may well say "cigars for sale",
// and calling a live retailer parked is worse than missing a parked domain.
const FOR_SALE_PHRASES = [
  'buy this domain', 'this domain is for sale', 'domain is for sale', 'domain for sale',
  'domain name is for sale', 'purchase this domain', 'inquire about this domain',
  'the owner of this domain', 'this domain has expired', 'domain has expired',
  'this webpage is parked', 'this domain is parked', 'parked domain', 'domain parking',
  'parked free, courtesy of', 'this domain may be for sale', 'related searches',
  'sponsored listings', 'domain broker',
];

// The same idea where the domain name itself sits between the two halves, e.g.
// Porkbun's "The domain cigarsandsmokeshop.com is for sale."
const FOR_SALE_PATTERNS = [
  /\bdomain\b[^.<>]{0,80}?\bis for sale\b/,
  /\bis for sale\b[^.<>]{0,80}?\bdomain\b/,
  /\bfor sale\b[^.<>]{0,60}?\bmake (an )?offer\b/,
];

// Phrases that only count on a PLACEHOLDER_HOST — an unfinished builder site.
const PLACEHOLDER_PHRASES = [
  'website coming soon', 'coming soon', 'under construction', 'future home of',
  'this site is not published', 'site not published', 'account suspended',
  'this domain is not connected', 'default web page', 'welcome to nginx',
  'apache2 ubuntu default page', 'index of /',
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Hostname sanity ─────────────────────────────────────────────────────────

/**
 * Never let a stored "website" point the checker at our own network. Same
 * guard the menu reader uses.
 */
function isPrivateHost(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;

  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;              // link-local
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;    // CGNAT
    if (a >= 224) return true;                            // multicast / reserved
    return false;
  }
  if (h.includes(':')) {                                  // IPv6 literal
    if (h === '::1' || h === '::') return true;
    if (/^f[cd]/.test(h)) return true;
    if (/^fe[89ab]/.test(h)) return true;
    return false;
  }
  return false;
}

/**
 * Turn a stored, scheme-less website ("120cigarbar.com", "shop.example.com/store",
 * sometimes with a stray scheme or spaces) into { host, path } — or null when
 * it could not plausibly be a hostname at all.
 */
function parseWebsite(website) {
  let raw = String(website == null ? '' : website).trim();
  if (!raw) return null;
  raw = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^\/+/, '').trim();
  if (!raw || /\s/.test(raw)) return null;
  // Things people paste that are not sites at all.
  if (/^(mailto:|tel:|n\/?a$|none$|null$|undefined$)/i.test(raw)) return null;

  const slash = raw.search(/[/?#]/);
  let host = slash === -1 ? raw : raw.slice(0, slash);
  const path = slash === -1 ? '/' : raw.slice(slash);

  host = host.replace(/^[^@]*@/, '');            // strip any user:pass@
  host = host.split(':')[0].toLowerCase();       // drop an explicit port
  host = host.replace(/\.+$/, '');
  if (!host || host.length > 253) return null;
  if (isPrivateHost(host)) return null;

  const labels = host.split('.');
  if (labels.length < 2) return null;
  if (labels.some(l => !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(l) || l.length > 63)) return null;
  const tld = labels[labels.length - 1];
  if (!/^[a-z]{2,24}$/.test(tld)) return null;

  return { host, path: path || '/' };
}

// ── One HTTP attempt ────────────────────────────────────────────────────────

/** Map a socket-level error onto one of our statuses. */
function errorStatus(err) {
  const code = String(err && (err.code || err.message) || '').toUpperCase();
  if (code.includes('ENOTFOUND') || code.includes('EAI_AGAIN')) return 'dns_fail';
  if (code.includes('TIMEOUT') || code === 'ETIMEDOUT' || code === 'ERR_SOCKET_CONNECTION_TIMEOUT') return 'timeout';
  if (code.includes('ECONNREFUSED') || code.includes('ECONNRESET') || code.includes('EHOSTUNREACH') ||
      code.includes('ENETUNREACH') || code.includes('EPIPE') || code.includes('ECONNABORTED')) return 'refused';
  // TLS problems: expired/mismatched certs, dead https listeners. Worth an http retry.
  if (code.includes('CERT') || code.includes('SSL') || code.includes('EPROTO') ||
      code.includes('ERR_TLS') || code.includes('UNABLE_TO_VERIFY') || code.includes('SELF_SIGNED')) return 'tls';
  return 'error';
}

/**
 * Single request, no redirect following. Resolves { code, headers, body, url }
 * or rejects with an Error carrying .status (one of our statuses / 'tls').
 */
function once(urlStr, method, { wantBody = false, timeout = TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(urlStr); } catch { return reject(Object.assign(new Error('bad url'), { status: 'error' })); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return reject(Object.assign(new Error('bad scheme'), { status: 'error' }));
    if (isPrivateHost(u.hostname)) return reject(Object.assign(new Error('private host'), { status: 'error' }));

    const lib = u.protocol === 'https:' ? https : http;
    let settled = false;
    const fail = err => { if (!settled) { settled = true; reject(Object.assign(err, { status: err.status || errorStatus(err) })); } };

    const req = lib.request(u, {
      method,
      timeout: Math.max(1000, timeout),
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        Connection: 'close',
      },
    }, res => {
      const code = res.statusCode || 0;
      if (!wantBody || method === 'HEAD') {
        res.resume();
        if (!settled) { settled = true; resolve({ code, headers: res.headers, body: '', url: u.toString() }); }
        return;
      }
      let size = 0;
      const chunks = [];
      const done = () => {
        if (settled) return;
        settled = true;
        resolve({ code, headers: res.headers, body: Buffer.concat(chunks).toString('utf8'), url: u.toString() });
      };
      res.on('data', d => {
        size += d.length;
        if (size > MAX_BODY) { chunks.push(d.slice(0, Math.max(0, MAX_BODY - (size - d.length)))); res.destroy(); done(); return; }
        chunks.push(d);
      });
      res.on('end', done);
      res.on('close', done);
      res.on('error', err => fail(err));
    });

    req.on('timeout', () => { req.destroy(Object.assign(new Error('timeout'), { status: 'timeout' })); });
    req.on('error', err => fail(err));
    req.end();
  });
}

/**
 * Walk one scheme's redirect chain. HEAD first — cheap and enough for most
 * hosts — falling back to GET for the servers that refuse HEAD outright.
 * Resolves { code, headers, body, final_url } or rejects with .status set.
 */
async function walk(startUrl, deadline) {
  let url = startUrl;
  let lastCode = 0;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const left = deadline - Date.now();
    if (left <= 500) { const e = new Error('out of time'); e.status = 'timeout'; throw e; }

    let res = await once(url, 'HEAD', { timeout: Math.min(TIMEOUT_MS, left) });
    // 405/501 = HEAD not implemented, 400/403/404/429 from a HEAD is often the
    // WAF rather than the page, so ask properly before believing it.
    if ([400, 403, 404, 405, 406, 409, 429, 501].includes(res.code)) {
      const left2 = deadline - Date.now();
      if (left2 > 500) {
        try { res = await once(url, 'GET', { wantBody: true, timeout: Math.min(TIMEOUT_MS, left2) }); } catch { /* keep the HEAD answer */ }
      }
    }
    lastCode = res.code;

    if (res.code >= 300 && res.code < 400) {
      const loc = res.headers.location;
      if (!loc) return { ...res, final_url: url };          // a 3xx going nowhere
      let next;
      try { next = new URL(loc, url).toString(); } catch { return { ...res, final_url: url }; }
      if (hop === MAX_REDIRECTS) return { ...res, final_url: next };  // budget spent; report where it pointed
      url = next;
      continue;
    }
    return { ...res, final_url: res.url || url };
  }
  return { code: lastCode, headers: {}, body: '', final_url: url };
}

// ── Parking detection ───────────────────────────────────────────────────────

function hostMatches(host, list) {
  const h = String(host || '').toLowerCase();
  return list.some(p => h === p || h.endsWith('.' + p));
}

function containsPhrase(body, phrases) {
  const text = String(body || '').toLowerCase().replace(/\s+/g, ' ');
  return phrases.some(p => text.includes(p));
}

/**
 * Is this 200 actually a placeholder? Either it landed on a known parking host,
 * or the page is small enough to be nothing but a for-sale notice and says so.
 */
function looksParked(finalUrl, body) {
  let host = '';
  try { host = new URL(finalUrl).hostname.toLowerCase(); } catch {}
  if (hostMatches(host, PARK_HOSTS)) return true;

  const text = String(body || '');
  if (!text) return false;
  if (text.length <= TINY_BODY) {
    if (containsPhrase(text, FOR_SALE_PHRASES)) return true;
    const flat = text.toLowerCase().replace(/\s+/g, ' ');
    if (FOR_SALE_PATTERNS.some(re => re.test(flat))) return true;
  }
  if (hostMatches(host, PLACEHOLDER_HOSTS) && text.length <= TINY_BODY && containsPhrase(text, PLACEHOLDER_PHRASES)) return true;
  return false;
}

// ── The check ───────────────────────────────────────────────────────────────

/**
 * Decide whether a stored website actually serves a page.
 * Returns { status, code, final_url } and never throws.
 */
async function checkWebsite(website) {
  const parsed = parseWebsite(website);
  if (!parsed) return { status: 'error', code: null, final_url: null };
  const { host, path } = parsed;

  // DNS first: an expired domain is the common case here and answers in
  // milliseconds, so there is no reason to open a socket for it.
  // ENOTFOUND is an expired domain; EAI_AGAIN is a resolver that gave up on it.
  // Either way there is no site behind the name, so nothing to link to.
  try {
    await dns.lookup(host);
  } catch {
    return { status: 'dns_fail', code: null, final_url: null };
  }

  const deadline = Date.now() + OVERALL_BUDGET_MS;
  let res = null;
  let firstStatus = null;

  try {
    res = await walk('https://' + host + path, deadline);
  } catch (err) {
    firstStatus = err.status || 'error';
    // https can be broken on a host that still serves plain http — an old shop
    // site on lapsed TLS is still a real page.
    if (Date.now() < deadline - 500) {
      try {
        res = await walk('http://' + host + path, deadline);
      } catch (err2) {
        // Neither scheme answered. A TLS failure on its own only means "no
        // working https"; with plain http dead too, the connection is refused
        // either way. Otherwise the http verdict is the more specific one.
        const overHttps = firstStatus === 'tls' ? 'refused' : firstStatus;
        const overHttp = err2.status === 'tls' ? 'refused' : (err2.status || 'error');
        return { status: overHttp === 'error' ? overHttps : overHttp, code: null, final_url: null };
      }
    } else {
      return { status: firstStatus === 'tls' ? 'refused' : firstStatus, code: null, final_url: null };
    }
  }

  const code = res.code || 0;
  const finalUrl = res.final_url || null;

  if (code === 404 || code === 410) return { status: 'not_found', code, final_url: finalUrl };
  if (code >= 500) return { status: 'error', code, final_url: finalUrl };

  if (code >= 200 && code < 300) {
    // Only a 200 is worth reading a body for. If the walk used HEAD we still
    // have none, so fetch a capped slice of the final URL — unless the server
    // already told us the page is far too big to be a for-sale notice.
    let body = res.body || '';
    const len = Number(res.headers && res.headers['content-length']);
    const type = String(res.headers && res.headers['content-type'] || '').toLowerCase();
    const htmlish = !type || type.includes('html') || type.includes('text');
    if (!body && htmlish && !(Number.isFinite(len) && len > TINY_BODY) && Date.now() < deadline - 500) {
      try {
        const g = await once(finalUrl || ('https://' + host + path), 'GET', { wantBody: true, timeout: Math.min(TIMEOUT_MS, deadline - Date.now()) });
        body = g.body || '';
      } catch { /* the HEAD already proved it answers; parking sniff is best effort */ }
    }
    if (looksParked(finalUrl, body)) return { status: 'parked', code, final_url: finalUrl };
    return { status: 'ok', code, final_url: finalUrl };
  }

  if (code >= 300 && code < 400) {
    // A 3xx we could not follow to a body still lands somewhere real when it
    // named a destination; one with no Location is broken.
    return { status: finalUrl && finalUrl !== ('https://' + host + path) ? 'ok' : 'error', code, final_url: finalUrl };
  }

  // 401/403/429: the server is up and answering, it just will not serve a
  // robot. Treated as working, because a person with a browser gets in.
  if (BLOCKED_CODES.has(code)) return { status: 'blocked', code, final_url: finalUrl };
  return { status: 'error', code: code || null, final_url: finalUrl };
}

// ── Batch over the directory ────────────────────────────────────────────────

function emptyCounts() {
  const c = {};
  for (const s of STATUSES) c[s] = 0;
  return c;
}

let running = false;

/**
 * Check a slice of the directory and record the verdicts.
 *
 * onlyMissing (default): rows never checked, plus rows whose last check has
 * gone stale. false: every visible listing with a website, however recently
 * it was checked.
 */
async function checkStores({ limit = 200, recheckDays = 30, onlyMissing = true, log = console.log } = {}) {
  if (running) { log('[links] a check is already running, skipping'); return { skipped: true }; }
  running = true;
  const t0 = Date.now();
  try {
    const days = Math.max(0, Math.floor(Number(recheckDays)) || 0);
    const take = Math.max(1, Math.min(Math.floor(Number(limit)) || 200, 5000));
    const staleClause = onlyMissing
      ? `AND (website_checked_at IS NULL OR website_checked_at < NOW() - INTERVAL '${days} days')`
      : '';

    const rows = await db.all(`
      SELECT id, name, website, claimed, confidence
      FROM stores
      WHERE website IS NOT NULL AND website <> '' AND visible = 1
      ${staleClause}
      ORDER BY claimed DESC, confidence DESC, id
      LIMIT ?
    `, [take]);

    const counts = emptyCounts();
    if (!rows.length) {
      log('[links] nothing to check');
      return { checked: 0, counts, seconds: 0 };
    }

    // A small pool: these are mostly DNS failures and finish fast, but the
    // in-flight host set keeps us from opening six sockets on one server.
    let next = 0;
    const inFlight = new Set();
    const deferred = [];

    const take1 = () => {
      while (next < rows.length) {
        const row = rows[next];
        const p = parseWebsite(row.website);
        const host = p ? p.host : `__bad_${row.id}`;
        if (p && inFlight.has(host)) { deferred.push(row); next++; continue; }
        next++;
        return { row, host };
      }
      while (deferred.length) {
        const row = deferred.shift();
        const p = parseWebsite(row.website);
        const host = p ? p.host : `__bad_${row.id}`;
        if (p && inFlight.has(host)) { deferred.push(row); return null; }  // let another worker come back to it
        return { row, host };
      }
      return null;
    };

    const worker = async () => {
      for (;;) {
        const job = take1();
        if (!job) {
          if (deferred.length) { await sleep(250); continue; }
          return;
        }
        const { row, host } = job;
        inFlight.add(host);
        let result;
        try {
          result = await checkWebsite(row.website);
        } catch (err) {
          result = { status: 'error', code: null, final_url: null };   // belt and braces: checkWebsite should not throw
        } finally {
          inFlight.delete(host);
        }
        const status = STATUSES.includes(result.status) ? result.status : 'error';
        counts[status]++;
        try {
          await db.run(
            'UPDATE stores SET website_status = ?, website_checked_at = NOW(), website_final_url = ? WHERE id = ?',
            [status, result.final_url || null, row.id]);
        } catch (err) {
          log(`[links] could not save store ${row.id}: ${err.message}`);
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length) }, worker));

    const seconds = Math.round((Date.now() - t0) / 1000);
    const summary = STATUSES.filter(s => counts[s]).map(s => `${s} ${counts[s]}`).join(', ');
    log(`[links] checked ${rows.length} websites in ${seconds}s — ${summary || 'no results'}`);
    return { checked: rows.length, counts, seconds };
  } finally {
    running = false;
  }
}

/** Check one listing by id and record the verdict. */
async function checkStore(id, { log = console.log } = {}) {
  const store = await db.get('SELECT id, name, website FROM stores WHERE id = ?', [id]);
  if (!store) return { error: 'store not found' };
  if (!store.website) return { error: 'store has no website' };
  const result = await checkWebsite(store.website);
  await db.run(
    'UPDATE stores SET website_status = ?, website_checked_at = NOW(), website_final_url = ? WHERE id = ?',
    [result.status, result.final_url || null, store.id]);
  log(`[links] ${store.id} ${store.name} — ${store.website} → ${result.status}${result.code ? ' (' + result.code + ')' : ''}`);
  return { id: store.id, name: store.name, website: store.website, ...result };
}

// ── Boot hook ───────────────────────────────────────────────────────────────

/** Called from index.js on boot. Quiet in dev with DISABLE_LINK_CHECK=1. */
function runStartupLinkCheck({ log = console.log } = {}) {
  if (process.env.DISABLE_LINK_CHECK === '1') return;
  // Three minutes, not on boot: a cold deploy is still importing the directory
  // for the first couple of minutes and there is no hurry here.
  setTimeout(() => {
    checkStores({ limit: 300, log }).catch(err => log('[links] check error: ' + err.message));
    setInterval(() => {
      checkStores({ limit: 500, log }).catch(err => log('[links] check error: ' + err.message));
    }, 12 * 60 * 60 * 1000);
  }, 3 * 60 * 1000);
}

module.exports = {
  checkWebsite, checkStores, checkStore, runStartupLinkCheck,
  parseWebsite, looksParked, STATUSES,
};

if (require.main === module) {
  const argv = process.argv.slice(2);
  const arg = name => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
  };
  const storeId = arg('--store');
  const limit = Number(arg('--limit')) || 200;
  const recheckDays = arg('--recheck-days') != null ? Number(arg('--recheck-days')) : 30;
  const { initSchema, runMigrations } = require('../database/schema');

  (async () => {
    await initSchema();
    await runMigrations();
    if (storeId) {
      console.log(JSON.stringify(await checkStore(Number(storeId)), null, 2));
    } else {
      console.log(JSON.stringify(await checkStores({ limit, recheckDays }), null, 2));
    }
    process.exit(0);
  })().catch(err => { console.error(err); process.exit(1); });
}
