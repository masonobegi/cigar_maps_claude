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
 *       node src/jobs/linkCheck.js --all        recheck every public website
 *       node src/jobs/linkCheck.js selftest
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

/**
 * Statuses this module can write. Only 'ok' and 'blocked' mean a customer can
 * reach the page; everything else is a dead link and must not be rendered as
 * one.
 *
 * The last four are what a lapsed shop domain turns into. About 318 public
 * links now end on a different domain than the one we store, and fourteen of
 * those supply a thumbnail — Mike's Cigar Room showed a gambling banner on its
 * card. Calling all of that 'ok' because the server returned 200 is how that
 * happened.
 */
const STATUSES = ['ok', 'blocked', 'dns_fail', 'timeout', 'refused', 'not_found', 'error',
  'parked', 'elsewhere', 'hijacked', 'store_unavailable'];

/** Everything that is not a link we can show a customer. */
const DEAD_STATUSES = ['dns_fail', 'timeout', 'refused', 'not_found', 'error',
  'parked', 'elsewhere', 'hijacked', 'store_unavailable'];

/** A dead domain someone else is now using. These lose their thumbnail. */
const TAKEN_OVER_STATUSES = ['parked', 'hijacked', 'elsewhere'];

// A site that answers but refuses to serve a robot is alive for a customer.
// Cloudflare and similar front doors return 403 to anything that is not a
// browser, and several real shops sit behind them, so this is its own verdict
// and is treated as a working link.
//
// 402 used to be in here. It is not a WAF: Shopify and Squarespace answer 402
// when a shop stopped paying, so the store is genuinely gone for a customer.
const BLOCKED_CODES = new Set([401, 403, 407, 429, 451]);

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
//
// The gap used to be [^.<>], which cannot cross the dot in the domain name it
// exists to span — so the example in this very comment did not match. It now
// allows a dot inside a word and stops at a sentence end (a dot followed by
// whitespace) or a tag, so the two halves still have to be one sentence.
const GAP = '(?:(?!\\.[\\s<])[^<>]){0,80}?';
const FOR_SALE_PATTERNS = [
  new RegExp(`\\bdomain\\b${GAP}\\bis for sale\\b`),
  new RegExp(`\\bis for sale\\b${GAP}\\bdomain\\b`),
  new RegExp(`\\bfor sale\\b${GAP}\\bmake (an )?offer\\b`),
];

// Phrases that only count on a PLACEHOLDER_HOST — an unfinished builder site.
const PLACEHOLDER_PHRASES = [
  'website coming soon', 'coming soon', 'under construction', 'future home of',
  'this site is not published', 'site not published', 'account suspended',
  'this domain is not connected', 'default web page', 'welcome to nginx',
  'apache2 ubuntu default page', 'index of /',
];

/**
 * Gambling words. A lapsed shop domain is very often resold to an online
 * casino, so two or more of these with no cigar word anywhere is the signature
 * of a takeover. Two, not one: a real cigar lounge may well mention poker
 * night, and a shop called "Lucky" must not be hidden for its name.
 */
const GAMBLING_TERMS = [
  'casino', 'slot', 'slots', 'betting', 'bet365', 'sportsbook', 'baccarat',
  'roulette', 'blackjack', 'jackpot', 'gacor', 'togel', 'judi', 'situs',
  'poker online', 'online casino', 'free spins', 'deposit bonus', 'wagering',
  'bandar', 'maxwin', 'slot88', 'pragmatic play', 'live casino', 'agen',
  'taruhan', 'bo slot', 'rtp slot', 'link alternatif',
];

/** Any word that says the page is still about cigars. */
const CIGAR_WORDS = /\b(cigars?|cigarros?|tobacco|tobacconist|humidor|pipes?|stogie|habano|torpedo|robusto|churchill|maduro|connecticut wrapper|smoke ?shop|lounge)\b/i;

/**
 * A short public-suffix list, enough for the domains this directory holds.
 * Comparing whole hostnames would call every www -> apex or apex -> shop
 * redirect a takeover; comparing registrable domains does not.
 */
const MULTI_LABEL_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'me.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'org.au',
  'co.nz', 'co.za', 'com.br', 'com.mx', 'com.ar', 'co.jp', 'co.in', 'co.kr',
  'com.sg', 'com.hk', 'com.tw', 'com.ph', 'com.my', 'co.il', 'com.tr',
]);

/** example.co.uk from shop.example.co.uk; example.com from www.example.com. */
function registrableDomain(hostOrUrl) {
  let host = String(hostOrUrl || '').toLowerCase();
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(host)) {
    try { host = new URL(host).hostname.toLowerCase(); } catch { return null; }
  }
  host = host.replace(/^\[|\]$/g, '').split(':')[0].replace(/\.+$/, '');
  if (!host || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return host || null;
  const parts = host.split('.');
  if (parts.length < 2) return host;
  const lastTwo = parts.slice(-2).join('.');
  if (MULTI_LABEL_SUFFIXES.has(lastTwo) && parts.length >= 3) return parts.slice(-3).join('.');
  return lastTwo;
}

/** The digits of a phone number, for comparing one against a page. */
function phoneDigits(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  return d.length === 11 && d[0] === '1' ? d.slice(1) : d;
}

/**
 * Does this page belong to this shop? The guardrail on 'elsewhere': a real
 * rebrand redirect keeps its link, and a phone number or a street address on
 * the destination is what proves it is one.
 *
 * Deliberately generous. Wrongly calling a live shop's new site "elsewhere"
 * takes a working link off a real listing, which is worse than leaving one
 * stale link in place for another month.
 */
function destinationNamesShop(body, store) {
  if (!store) return false;
  const text = String(body || '').toLowerCase().replace(/\s+/g, ' ');
  if (!text) return false;

  // The phone number, however it is punctuated on the page.
  const digits = phoneDigits(store.phone);
  if (digits.length === 10) {
    const loose = String(body || '').replace(/[^0-9]/g, '');
    if (loose.includes(digits)) return true;
  }

  // The street number with the first real word of the street name.
  const addr = String(store.address || '').toLowerCase();
  const num = /^\s*(\d+[a-z]?)\s+(.+)$/.exec(addr);
  if (num) {
    const streetWord = num[2].split(/\s+/).find(w => w.length > 2 && !/^(n|s|e|w|ne|nw|se|sw|north|south|east|west)$/.test(w));
    if (streetWord && text.includes(num[1].toLowerCase()) && text.includes(streetWord)) return true;
  }

  // The distinctive words of the shop's own name — not the trade words every
  // cigar shop shares, which would match any cigar site in the world.
  const GENERIC = new Set(['cigar', 'cigars', 'tobacco', 'tobacconist', 'lounge', 'shop', 'store',
    'smoke', 'house', 'company', 'co', 'club', 'room', 'the', 'and', 'of', 'llc', 'inc', 'humidor', 'pipe', 'pipes']);
  const words = String(store.name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ')
    .filter(w => w.length > 3 && !GENERIC.has(w));
  if (words.length && words.some(w => text.includes(w))) return true;

  return false;
}

/**
 * Has someone else taken this domain over? Two gambling terms and not one
 * cigar word.
 */
function looksHijacked(body) {
  const text = String(body || '').toLowerCase().replace(/\s+/g, ' ');
  if (!text) return false;
  if (CIGAR_WORDS.test(text)) return false;
  const hits = new Set();
  for (const term of GAMBLING_TERMS) if (text.includes(term)) hits.add(term);
  return hits.size >= 2;
}

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
 * Decide whether a stored website actually serves a page — and, when a store
 * row is given, whether the page it serves is still that shop's.
 *
 * Returns { status, code, final_url } and never throws.
 */
async function checkWebsite(website, store = null) {
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
    // Without a store row we only need enough to sniff a for-sale notice, which
    // is always small. With one, the page has to be read to tell a rebrand from
    // a takeover, however big it is.
    const needFullRead = !!store;
    if (!body && htmlish && (needFullRead || !(Number.isFinite(len) && len > TINY_BODY)) && Date.now() < deadline - 500) {
      try {
        const g = await once(finalUrl || ('https://' + host + path), 'GET', { wantBody: true, timeout: Math.min(TIMEOUT_MS, deadline - Date.now()) });
        body = g.body || '';
      } catch { /* the HEAD already proved it answers; parking sniff is best effort */ }
    }
    if (looksParked(finalUrl, body)) return { status: 'parked', code, final_url: finalUrl };

    // Somebody else's site on the shop's old domain. Order matters: a hijacked
    // page is the more specific answer, and it is also the one that must never
    // be shown, so it is asked first.
    if (looksHijacked(body)) return { status: 'hijacked', code, final_url: finalUrl };

    // A link that ends on a different registrable domain than the one we hold.
    // A real rebrand keeps its link — a phone number or a street address on the
    // destination passes it. Without a store row we cannot ask, so we do not
    // guess, and the old behaviour stands.
    const storedDomain = registrableDomain(host);
    const landedDomain = registrableDomain(finalUrl || '');
    if (store && storedDomain && landedDomain && storedDomain !== landedDomain
        && !destinationNamesShop(body, store)) {
      return { status: 'elsewhere', code, final_url: finalUrl };
    }
    return { status: 'ok', code, final_url: finalUrl };
  }

  // A shop that stopped paying its platform. Shopify and Squarespace answer
  // 402 here, and the store really is gone for a customer.
  if (code === 402) return { status: 'store_unavailable', code, final_url: finalUrl };

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
    // 5,000 is the ceiling for the routine background pass. A deliberate full
    // sweep (onlyMissing: false) has to be able to cover the whole directory,
    // or "recheck every public website" quietly means "recheck 5,000 of them".
    const ceiling = onlyMissing ? 5000 : 100000;
    const take = Math.max(1, Math.min(Math.floor(Number(limit)) || 200, ceiling));
    const staleClause = onlyMissing
      ? `AND (website_checked_at IS NULL OR website_checked_at < NOW() - INTERVAL '${days} days')`
      : '';

    const rows = await db.all(`
      SELECT id, name, website, claimed, confidence, phone, address, city, state
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
          result = await checkWebsite(row.website, row);
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
  const store = await db.get('SELECT id, name, website, phone, address, city, state FROM stores WHERE id = ?', [id]);
  if (!store) return { error: 'store not found' };
  if (!store.website) return { error: 'store has no website' };
  const result = await checkWebsite(store.website, store);
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
  parseWebsite, looksParked, looksHijacked, destinationNamesShop, registrableDomain, phoneDigits,
  STATUSES, DEAD_STATUSES, TAKEN_OVER_STATUSES, GAMBLING_TERMS, selftest,
};

// ── self-test ───────────────────────────────────────────────────────────────
function selftest() {
  let pass = 0, fail = 0;
  const ok = (cond, label, extra) => {
    if (cond) { pass++; console.log(`  ok   ${label}`); }
    else { fail++; console.log(`  FAIL ${label}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ''}`); }
  };

  // Registrable domains, so a www or shop subdomain is not called a takeover.
  ok(registrableDomain('www.mikescigarroom.com') === 'mikescigarroom.com', 'www is the same domain');
  ok(registrableDomain('https://shop.davidoff.com/us') === 'davidoff.com', 'so is a shop subdomain');
  ok(registrableDomain('cigars.co.uk') === 'cigars.co.uk', 'a two-label suffix is not the domain');
  ok(registrableDomain('shop.cigars.co.uk') === 'cigars.co.uk', 'and a subdomain under one still is not');
  ok(registrableDomain('') === null, 'nothing is nothing');

  // Hijacked: two gambling terms, no cigar word.
  ok(looksHijacked('<h1>Situs Slot Gacor</h1><p>Daftar judi bola dan live casino terbaik</p>'),
    'a casino page on a lapsed domain is hijacked');
  ok(looksHijacked('Welcome to our online casino. Free spins and a deposit bonus await.'),
    'so is a plain English one');
  ok(!looksHijacked('Join us for poker night at the cigar lounge. Blackjack too.'),
    'a cigar lounge with a poker night is not hijacked — it says cigar');
  ok(!looksHijacked('Lucky Cigar — premium cigars and pipe tobacco since 1974'),
    'and a shop called Lucky is safe');
  ok(!looksHijacked('Our slot machines are in the back room.'),
    'one gambling word alone is not enough');
  ok(!looksHijacked(''), 'an empty page is not hijacked');

  // The rebrand guardrail. This is the one that must not misfire: a live shop
  // keeps its link.
  const shop = { name: "Mike's Cigar Room", phone: '(305) 866-2277', address: '1030 Kane Concourse', city: 'Bay Harbor Islands' };
  ok(destinationNamesShop('Call us on 305-866-2277 for hours', shop), 'a phone number on the destination is a rebrand');
  ok(destinationNamesShop('Visit us at 1030 Kane Concourse', shop), 'so is the street address');
  ok(destinationNamesShop('Welcome to the new home of Mikes Cigars', shop), 'so is the distinctive part of the name');
  ok(!destinationNamesShop('Premium cigars and lounge, established 1974', shop),
    'but the trade words every cigar shop shares are not — they would match any cigar site anywhere');
  ok(!destinationNamesShop('Situs slot gacor', shop), 'and a casino page names nobody');
  ok(!destinationNamesShop('anything at all', null), 'with no store row we do not guess');
  // A different shop's site must not pass as this shop's.
  ok(!destinationNamesShop("Welcome to Anthony's Cigar Emporium, Tucson", shop),
    "another shop's site does not pass as this one's");

  // Parking, unchanged, plus the phrase patterns.
  ok(looksParked('http://sedoparking.com/x', ''), 'a known parking host is parked whatever it serves');
  ok(looksParked('https://cigarsandsmokeshop.com/', 'The domain cigarsandsmokeshop.com is for sale.'),
    'and a for-sale notice is parked');
  ok(!looksParked('https://realshop.com/', '<html>' + 'x'.repeat(40000) + 'buy this domain</html>'),
    'a big page is not a for-sale notice, whatever words it contains');
  ok(!looksParked('https://realshop.com/', 'We stock every domain of cigar. Our finest robusto is for sale now.'),
    'and the two halves of the phrase have to be in one sentence');

  // The status vocabulary has to agree with itself, or a dead link is rendered
  // as a working one somewhere.
  ok(DEAD_STATUSES.every(v => STATUSES.includes(v)), 'every dead status is a status');
  ok(TAKEN_OVER_STATUSES.every(v => DEAD_STATUSES.includes(v)), 'a taken-over domain is a dead link');
  ok(!DEAD_STATUSES.includes('ok') && !DEAD_STATUSES.includes('blocked'),
    'ok and blocked are the only statuses a customer may be shown');
  ok(!BLOCKED_CODES.has(402), '402 is no longer treated as a working link behind a firewall');
  for (const v of ['elsewhere', 'hijacked', 'store_unavailable', 'parked']) {
    ok(DEAD_STATUSES.includes(v), `${v} counts as dead`);
  }

  // parseWebsite, which everything above rests on.
  ok(parseWebsite('120cigarbar.com').host === '120cigarbar.com', 'a bare hostname parses');
  ok(parseWebsite('http://127.0.0.1/') === null, 'loopback is refused');
  ok(parseWebsite('mailto:a@b.com') === null, 'an email address is not a website');

  console.log(`\nlinkCheck self-test: ${pass} passed, ${fail} failed`);
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
  // --all forces a recheck of every public website, however recently it was
  // looked at. The new verdicts (elsewhere, hijacked, store_unavailable) did
  // not exist when the current statuses were written, so every 'ok' in the
  // table predates them and has to be asked again.
  const all = argv.includes('--all');
  const limit = Number(arg('--limit')) || (all ? 100000 : 200);
  const recheckDays = arg('--recheck-days') != null ? Number(arg('--recheck-days')) : 30;
  const { initSchema, runMigrations } = require('../database/schema');

  (async () => {
    await initSchema();
    await runMigrations();
    if (storeId) {
      console.log(JSON.stringify(await checkStore(Number(storeId)), null, 2));
    } else {
      console.log(JSON.stringify(await checkStores({ limit, recheckDays, onlyMissing: !all }), null, 2));
    }
    process.exit(0);
  })().catch(err => { console.error(err); process.exit(1); });
}
