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
 * A working link is not enough, though: an audit of the 4,863 listed sites
 * found domains that answer 200 and are no longer the shop's. puffnstuffcigars
 * .com now redirects to gamebaidoithuong.property, havanaonhudson.com to a
 * betting site, Paradise Cigars and Screaming Eagle to GoDaddy /lander stubs,
 * and Shopify answers 402 for shops that stopped paying. So the checker also
 * asks who the page belongs to, and only says 'ok' when the answer is still
 * this shop.
 *
 * Rules of the road:
 *  - node built-ins only (https/http/dns); no new dependencies
 *  - DNS first: most dead links never resolve at all, and that check is cheap
 *  - HEAD before GET, one identifiable User-Agent, a 10 s timeout, a 256 KB
 *    body cap, and body read only when a 200 needs to be sniffed for parking
 *    or the chain of redirects left the domain we listed
 *  - never throw: every failure mode is a status
 *  - a verdict only ever changes a link, never a shop's visibility
 *
 * CLI:  node src/jobs/linkCheck.js [--limit N] [--store ID] [--recheck-days N]
 *       node src/jobs/linkCheck.js sweep  --out evidence.jsonl [--limit N]   # read-only
 *       node src/jobs/linkCheck.js decide --from evidence.jsonl --out decisions.json
 *       node src/jobs/linkCheck.js apply  --from decisions.json --confirm
 *       node src/jobs/linkCheck.js selftest
 */
'use strict';

const fs = require('fs');
const https = require('https');
const http = require('http');
const dns = require('dns').promises;
const { URL } = require('url');
const db = require('../database/db');
const { writeFields } = require('../utils/storeEdits');

const UA = 'CigarBuddy/1.0 (+https://cigarmapsclaude-production.up.railway.app; link check)';
const TIMEOUT_MS = 10000;
const MAX_REDIRECTS = 4;
const MAX_BODY = 256 * 1024;      // 256 KB, the hard cap on anything we read
const TINY_BODY = 24 * 1024;      // a "for sale" page is small; a real shop's is not
const CONCURRENCY = 6;
const OVERALL_BUDGET_MS = 30000;  // whole check for one store, redirects included

/**
 * Statuses this module can write. Only 'ok' and 'blocked' mean the link is
 * usable; everything else is dead and the UI shows no link at all.
 *
 * The last four came out of the 2026-09 link audit, where 'ok' was hiding
 * links that had stopped being the shop's:
 *  - 'elsewhere'        the chain of redirects ends on another registrable
 *                       domain and nothing there names this shop
 *  - 'hijacked'         a lapsed domain now serving a gambling site
 *  - 'store_unavailable' Shopify's 402: the shop stopped paying, so the page
 *                       exists but sells nothing
 * and 'parked' now also catches registrar landers and the "Resources and
 * Information" template, not just the for-sale wording.
 */
//
// 'checking' is written by a hand that changes the address — the owner form,
// the staff editor, a directory re-import that brings a new domain — and means
// "this link is new and has not been looked at yet". It is deliberately not
// NULL: NULL means nobody has ever looked, which on today's data is 5,214 of
// the 5,214 public listings that carry a website, because the first full sweep
// has not run. Treating those two as one state would either hide every website
// on the site or dress a just-typed address up as verified.
const STATUSES = ['ok', 'blocked', 'checking', 'dns_fail', 'timeout', 'refused', 'not_found', 'error', 'parked',
  'elsewhere', 'hijacked', 'store_unavailable'];

/** The verdict a fresh or edited address carries until a sweep reaches it. */
const PENDING_STATUS = 'checking';

/** Verdicts that mean "there is no working link here". */
const DEAD_STATUSES = ['dns_fail', 'timeout', 'refused', 'not_found', 'error', 'parked',
  'elsewhere', 'hijacked', 'store_unavailable'];

/**
 * A dead domain somebody else is now using, as opposed to one that simply does
 * not answer. These lose their thumbnail: the picture on the card is coming
 * from whoever holds the domain now. Mike's Cigar Room showed a gambling
 * banner.
 */
const TAKEN_OVER_STATUSES = ['parked', 'hijacked', 'elsewhere'];

// A site that answers but refuses to serve a robot is alive for a customer.
// Cloudflare and similar front doors return 403 to anything that is not a
// browser, and several real shops sit behind them, so this is its own verdict
// and is treated as a working link.
//
// 402 used to be in here, which was wrong: it is what Shopify answers for a
// shop whose subscription lapsed ("This store is unavailable"), and a person
// with a browser sees nothing but that notice. It has its own dead verdict.
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
  // Found live in the 2026-09 audit, on shop domains that lapsed.
  'parkingcrew.org', 'cnhv.co', 'domain-for-sale.com', 'namecheap.com',
  'dynadot.com', 'porkbun.com', 'name.com', 'epik.com', 'domainagents.com',
  'sedopark.net', 'parklogic.com', 'bookmyname.com', 'hostinger.com',
  'registrar-servers.com', 'domaincontrol.com', 'expiredomains.net',
];

// GoDaddy and a few others serve their parking page from the shop's own
// domain, so the host says nothing — the path does. /lander is GoDaddy's
// (Paradise Cigars, Screaming Eagle both sit on one today).
const PARK_PATHS = /^\/(lander|park(ed|ing)?|default\.aspx|cgi-sys\/defaultwebpage\.cgi|suspendedpage\.cgi)(\/|$|\?)/i;

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

// The lander template that ad networks put on expired domains: a headline of
// "<domain> — Resources and Information", or the "first and best source for
// all of the information you are looking for" line under a page of ad links.
// These pages are not small, so the TINY_BODY rule above never sees them.
const LANDER_PHRASES = [
  'resources and information', 'is your first and best source for all of the information',
  'we hope you find what you are searching for', 'this webpage was generated by the domain owner',
  'the domain may be for sale', 'thank you for visiting', 'privatelabelparking',
];

// Two of these in a page's title or first 64 KB, with no cigar word anywhere,
// means a lapsed domain has been taken over by a gambling site. The audit found
// 24 of them: puffnstuffcigars.com → gamebaidoithuong.property (Vietnamese),
// havanaonhudson.com → a sportsbook, and a run of Indonesian slot sites that
// re-use old US shop domains for their backlinks.
const GAMBLING_TERMS = [
  'casino', 'slot gacor', 'slot online', 'situs slot', 'judi', 'judi bola', 'togel',
  'sportsbook', 'poker online', 'taruhan', 'bandar', 'agen slot', 'daftar slot',
  'rtp slot', 'maxwin', 'jackpot', 'baccarat', 'roulette', 'sbobet', 'pragmatic play',
  'link alternatif', 'deposit pulsa', 'bonus new member', 'game bai', 'doi thuong',
  'nha cai', 'ca cuoc', 'xo so', 'bookmaker', 'betting site', 'online betting',
  'free spins', 'no deposit bonus', 'sweepstakes casino', 'bet365', 'keno online',
];

// A page that talks about cigars is the shop's, whatever else is on it. A
// casino resort's own cigar lounge says both words, and it keeps its link.
const CIGAR_WORDS = /\b(cigars?|cigarro|tobacco|tobacconist|humidors?|pipe tobacco|smoke ?shop|cigarette|torcedor|vitola)\b/i;

// Words in a shop's name that identify nothing on their own. Same list the
// hours sweep uses, for the same reason: "Cigar Shop" names no shop.
const GENERIC_NAME = new Set(['cigar', 'cigars', 'tobacco', 'tobacconist', 'shop', 'shoppe', 'store', 'lounge', 'bar',
  'club', 'co', 'company', 'inc', 'llc', 'the', 'and', 'of', 'smoke', 'smokes', 'premium', 'fine', 'humidor', 'emporium',
  'house', 'room', 'cafe', 'at', 'by', 'de', 'la', 'el']);

// Redirects that are a real business relationship, proven by hand. Without
// these the parent company's site reads as somebody else's: Tobacco Connection
// is run by Jackson Beverage, and Cheap Tobacco's old domain is Wild Bill's.
const ALLOWED_REDIRECTS = {
  'tobaccoconnection.net': 'jacksonbevco.com',
  'cheaptobaccousa.com': 'wildbillstobacco.com',
  'stogiepairing.com': 'stogiesftmyers.com',
};

// Platforms a shop may legitimately use as its only web presence. The link
// stays — a Facebook page is where some shops post their hours — but the
// destination is the platform, so it is never judged as "the shop's own site"
// and never supplies a thumbnail or hours.
const SOCIAL_HOSTS = [
  'facebook.com', 'fb.me', 'fb.com', 'instagram.com', 'twitter.com', 'x.com',
  'tiktok.com', 'youtube.com', 'youtu.be', 'linkedin.com', 'linktr.ee',
  'pinterest.com', 'snapchat.com', 'threads.net',
];

// Not a shop's site and not a social profile either: a directory entry, a map
// pin, a shortener, a ticket page. Nothing here belongs to the shop.
const PLATFORM_HOSTS = [
  'yelp.com', 'yellowpages.com', 'mapquest.com', 'tripadvisor.com', 'foursquare.com',
  'bbb.org', 'nextdoor.com', 'hub.biz', 'hubbiz.net', 'cigarplaces.com', 'findsmokeshop.com',
  'google.com', 'g.co', 'maps.app.goo.gl', 'goo.gl', 'share.google', 'maps.apple.com',
  'business.site', 'plus.google.com', 'eventbrite.com', 'ticketmaster.com',
  'indeed.com', 'ziprecruiter.com', 'doordash.com', 'ubereats.com', 'grubhub.com',
  'square.site', 'venmo.com', 'paypal.com', 'cash.app', 'tinyurl.com', 'bit.ly',
  'rb.gy', 'linktree.com', 'wa.me',
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

// ── Who does this page belong to? ───────────────────────────────────────────
//
// Following a redirect is only safe when the destination is still this shop.
// Three things can prove that, in the order a page usually offers them: the
// shop's distinctive name, its phone number, or its street address. Any one is
// enough; none of them, on a different domain, is 'elsewhere'.

// Suffixes where the registrable domain is three labels, not two. The
// directory is US-only, so this is a short list kept for correctness rather
// than for the traffic it sees.
const MULTI_LABEL_TLDS = new Set(['co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'org.au',
  'co.nz', 'co.jp', 'ne.jp', 'or.jp', 'com.br', 'com.mx', 'com.ar', 'com.co', 'co.in', 'com.sg',
  'com.hk', 'com.tw', 'co.kr', 'com.vn', 'co.id', 'com.my', 'com.ph', 'co.za', 'com.tr', 'co.il']);

/** "example.com" from a URL, a host, or a stored "www.example.com/shop". */
function registrableDomain(value) {
  let h = String(value || '').trim().toLowerCase();
  if (!h) return null;
  h = h.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/^[^@/]*@/, '').split(/[/?#]/)[0].split(':')[0];
  h = h.replace(/^www\./, '').replace(/\.+$/, '');
  const parts = h.split('.').filter(Boolean);
  if (parts.length < 2) return null;
  const last2 = parts.slice(-2).join('.');
  if (parts.length > 2 && MULTI_LABEL_TLDS.has(last2)) return parts.slice(-3).join('.');
  return last2;
}

/** Visible words of a page, tags and scripts thrown away. */
function visibleText(html) {
  return String(html || '')
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/** The few things a page says about its own identity. */
function pageIdentity(body) {
  const html = String(body || '');
  const pick = re => { const m = html.match(re); return m ? m[1].trim() : ''; };
  const title = pick(/<title[^>]*>([\s\S]{0,300}?)<\/title>/i).replace(/\s+/g, ' ');
  const siteName = pick(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']{1,200})["']/i)
    || pick(/<meta[^>]+content=["']([^"']{1,200})["'][^>]+property=["']og:site_name["']/i);
  const ogTitle = pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']{1,200})["']/i);
  const ldNames = [];
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]{0,60000}?)<\/script>/gi)) {
    for (const n of m[1].matchAll(/"(?:name|legalName|alternateName)"\s*:\s*"([^"]{1,120})"/g)) ldNames.push(n[1]);
  }
  // Logo alt text: some shops put their name nowhere else on the page.
  const alts = [...html.matchAll(/<img[^>]+alt=["']([^"']{1,120})["']/gi)].map(m => m[1]).slice(0, 40);
  const text = visibleText(html);
  return { title, siteName, ogTitle, ldNames, alts, text, digits: text.replace(/[^0-9]/g, '') };
}

/** The words in a shop's name that could identify it on somebody's page. */
function nameTokens(store) {
  const words = String(store && store.name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ')
    .filter(w => w.length > 2 && !GENERIC_NAME.has(w));
  // A town name says nothing: "Tobacco Den Brainerd" matched brainerdglass.net.
  const town = new Set(String(store && store.city || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' '));
  const own = words.filter(w => !town.has(w));
  return own.length ? own : words;
}

const escapeRe = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Does this page belong to this shop? Returns the proof ('name', 'phone',
 * 'address', 'allowed') or null. Deliberately generous: a false "yes" leaves a
 * link alone, a false "no" takes a working link off a real shop's card.
 */
function namesShop(store, id, finalUrl) {
  if (!store) return 'no store context';
  const listed = registrableDomain(store.website);
  const final = registrableDomain(finalUrl);
  if (listed && final && ALLOWED_REDIRECTS[listed] === final) return 'allowed';

  const hay = [id.title, id.siteName, id.ogTitle, id.ldNames.join(' '), id.alts.join(' ')].join(' ').toLowerCase();
  const flat = hay.replace(/[^a-z0-9]+/g, '');
  const stem = String(final || '').replace(/\.[a-z.]+$/, '').replace(/[^a-z0-9]/g, '');
  const tokens = nameTokens(store);
  // Short words ("Den", "Joe") must stand alone; inside another word they are
  // only letters ("garden", "golden"). A trailing s is allowed, because a shop
  // called "Mike's Cigar Room" puts "Mikes Cigars" in its own page title and
  // its logo's alt text, and requiring an exact "mike" misses both.
  const spaced = ` ${hay.replace(/[^a-z0-9]+/g, ' ')} `;
  const standsAlone = w => spaced.includes(` ${w} `) || spaced.includes(` ${w}s `)
    || (w.endsWith('s') && spaced.includes(` ${w.slice(0, -1)} `));
  if (tokens.some(w => (w.length < 5 ? standsAlone(w) || stem.includes(w) : flat.includes(w) || stem.includes(w)))) return 'name';
  // A domain built from the name's initials: Tobacco Republic at trcigar.com.
  const initials = String(store.name || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/)
    .filter(w => w && !['the', 'and', 'of', 'at', 'by'].includes(w)).map(w => w[0]).join('');
  if (initials.length >= 2 && stem.startsWith(initials) && /^(cigars?|tobacco|smokes?|lounge|shop|co)?$/.test(stem.slice(initials.length))) return 'name';

  const phone = String(store.phone || '').replace(/[^0-9]/g, '').slice(-10);
  if (phone.length === 10 && id.digits.includes(phone)) return 'phone';

  // The street number alone is meaningless ("2024"), so it has to be followed
  // by the street's own word: "1530 McMullen".
  const addr = String(store.address || '').toLowerCase();
  const num = (addr.match(/\b(\d{1,6})\b/) || [])[1];
  const streetWord = (addr.replace(/^[\d\s-]+/, '').match(/[a-z]{4,}/) || [])[0];
  if (num && streetWord) {
    const re = new RegExp(`\\b${escapeRe(num)}\\b[^a-z0-9]{0,12}${escapeRe(streetWord)}`, 'i');
    if (re.test(id.text)) return 'address';
  }
  return null;
}

/** Gambling terms on the page, de-duplicated. Two or more is the threshold. */
function gamblingHits(id) {
  const hay = `${id.title} ${id.siteName} ${id.ogTitle} ${id.text}`.toLowerCase()
    .slice(0, 64 * 1024)
    // Vietnamese and Indonesian takeovers are written with accents; strip them
    // so "nhà cái" and "xổ số" match the plain terms above.
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\u0111/g, 'd');
  return [...new Set(GAMBLING_TERMS.filter(t => hay.includes(t)))];
}

/**
 * A gambling takeover, not a casino lounge. Three things must all be true: two
 * or more gambling terms, no cigar or tobacco word anywhere on the page, and
 * the shop's own name absent — a resort lounge's page says "Casino" and says
 * its own name, and keeps its link.
 */
function looksHijacked(store, id) {
  const hits = gamblingHits(id);
  if (hits.length < 2) return null;
  const page = `${id.title} ${id.siteName} ${id.ogTitle} ${id.ldNames.join(' ')} ${id.text}`;
  if (CIGAR_WORDS.test(page)) return null;
  if (store && namesShop(store, id, null)) return null;
  return hits;
}

/**
 * Is this 200 actually a placeholder? Either it landed on a known parking host,
 * or the page is small enough to be nothing but a for-sale notice and says so.
 */
function looksParked(finalUrl, body) {
  let host = '';
  let path = '';
  try { const u = new URL(finalUrl); host = u.hostname.toLowerCase(); path = u.pathname || ''; } catch {}
  if (hostMatches(host, PARK_HOSTS)) return true;
  // GoDaddy parks on the shop's own domain at /lander, so the host is no help.
  if (PARK_PATHS.test(path)) return true;

  const text = String(body || '');
  if (!text) return false;
  if (text.length <= TINY_BODY) {
    if (containsPhrase(text, FOR_SALE_PHRASES)) return true;
    const flat = text.toLowerCase().replace(/\s+/g, ' ');
    if (FOR_SALE_PATTERNS.some(re => re.test(flat))) return true;
  }
  if (hostMatches(host, PLACEHOLDER_HOSTS) && text.length <= TINY_BODY && containsPhrase(text, PLACEHOLDER_PHRASES)) return true;
  // The ad-network lander: a full page of sponsored links, so the size rule
  // above never catches it. Two marks of the template are needed, because a
  // real shop's page can say "thank you for visiting" on its own.
  const flatAll = visibleText(text);
  const landerHits = LANDER_PHRASES.filter(p => flatAll.includes(p));
  const title = (text.match(/<title[^>]*>([\s\S]{0,200}?)<\/title>/i) || ['', ''])[1].toLowerCase();
  if (landerHits.length >= 2) return true;
  if (landerHits.length >= 1 && /resources and information|for sale|^\s*[a-z0-9-]+\.[a-z]{2,}\s*$/.test(title)) return true;
  return false;
}

// ── The check ───────────────────────────────────────────────────────────────

/**
 * Which kind of address the redirects ended on: the shop's own site, a social
 * profile, or somebody's platform. Kept on the evidence so the review can
 * label a Facebook link rather than throw it away.
 */
/**
 * The human name of the network a link points at, or null for an ordinary
 * site. A listing whose only "website" is a Facebook page is not a listing
 * with no website, and it is not a listing with a website either — it wants
 * saying for what it is.
 */
const SOCIAL_NAMES = [
  [/(^|\.)facebook\.com$|(^|\.)fb\.(com|me)$/, 'Facebook page'],
  [/(^|\.)instagram\.com$/, 'Instagram profile'],
  [/(^|\.)twitter\.com$|(^|\.)x\.com$/, 'X profile'],
  [/(^|\.)tiktok\.com$/, 'TikTok profile'],
  [/(^|\.)yelp\.com$/, 'Yelp page'],
  [/(^|\.)linkedin\.com$/, 'LinkedIn page'],
  [/(^|\.)youtube\.com$|(^|\.)youtu\.be$/, 'YouTube channel'],
  [/(^|\.)linktr\.ee$|(^|\.)linktree\.com$/, 'Linktree'],
  [/(^|\.)google\.com$|(^|\.)business\.site$/, 'Google listing'],
  [/(^|\.)square\.site$|(^|\.)clover\.com$|(^|\.)toast\.?tab\.com$/, 'ordering page'],
];

function socialNetwork(url) {
  let host = '';
  try { host = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase(); } catch { return null; }
  for (const [re, name] of SOCIAL_NAMES) if (re.test(host)) return name;
  return null;
}

function destinationKind(url) {
  let host = '';
  // The scheme is added if it is missing. Without this, new URL() threw on
  // every value in the stores.website column — they are stored bare, as
  // "facebook.com/KUSH.Smoke.Emporium" — and the catch below answered 'site'
  // for all of them. On today's data that was 23,972 links called ordinary
  // sites, 2,366 of which are a Facebook page, a Linktree, a Google listing
  // or an ordering platform rather than the shop's own site.
  try { host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase(); }
  catch { return 'site'; }
  if (hostMatches(host, SOCIAL_HOSTS)) return 'social';
  if (hostMatches(host, PLATFORM_HOSTS)) return 'platform';
  if (hostMatches(host, PARK_HOSTS)) return 'parking';
  return 'site';
}

/**
 * Whose page is this? The pure half of the check, so it can be tested without
 * a network: given the body we ended on, return the verdict that takes the
 * link away ('hijacked', 'parked', 'elsewhere') or null to keep it.
 *
 * It exists as its own function because the first version of this audit built
 * looksHijacked, namesShop and pageIdentity, tested all three, and then never
 * called them from the checker — so every gambling takeover stayed 'ok' in
 * production while the self-test passed.
 */
function judgePage(store, listedWebsite, finalUrl, body) {
  if (!body) return null;
  const id = pageIdentity(body);
  const hijacked = looksHijacked(store, id);
  if (hijacked) return { status: 'hijacked', why: hijacked.join(', ') };
  if (looksParked(finalUrl, body)) return { status: 'parked' };
  if (!store) return null;
  const landed = registrableDomain(finalUrl);
  const listed = registrableDomain(store.website || listedWebsite);
  // Same domain: the shop still holds its address, whatever the page says.
  if (!landed || !listed || landed === listed) return null;
  // A social or ordering page is judged elsewhere in the UI, not here.
  if (destinationKind(finalUrl) !== 'site') return null;
  if (namesShop(store, id, finalUrl)) return null;
  return { status: 'elsewhere' };
}

/**
 * Decide whether a stored website actually serves a page.
 * Returns { status, code, final_url } and never throws.
 *
 * With a store row ({ name, city, phone, address, website }) it also asks
 * whether the page still belongs to that shop, which is what separates a
 * rebrand ('ok', follow the redirect) from a lapsed domain somebody else now
 * owns ('elsewhere' / 'hijacked'). Without one it behaves as it always did.
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
    if (!body && htmlish && !(Number.isFinite(len) && len > TINY_BODY) && Date.now() < deadline - 500) {
      try {
        const g = await once(finalUrl || ('https://' + host + path), 'GET', { wantBody: true, timeout: Math.min(TIMEOUT_MS, deadline - Date.now()) });
        body = g.body || '';
      } catch { /* the HEAD already proved it answers; parking sniff is best effort */ }
    }
    // Who does the page belong to? A 200 is not proof the shop still holds the
    // address: puffnstuffcigars.com answers 200 as a Vietnamese casino.
    const verdict = judgePage(store, website, finalUrl || `https://${host}${path}`, body);
    if (verdict) return { ...verdict, code, final_url: finalUrl };
    return { status: 'ok', code, final_url: finalUrl };
  }

  if (code >= 300 && code < 400) {
    // A 3xx we could not follow to a body still lands somewhere real when it
    // named a destination; one with no Location is broken.
    if (!finalUrl || finalUrl === ('https://' + host + path)) return { status: 'error', code, final_url: finalUrl };
    // Unless it landed on somebody else's domain. havanaonhudson.com answers
    // 302 straight to a betting site and stops there, so the check that reads
    // the page never ran and the link stayed 'ok'. Read the destination.
    const landed = registrableDomain(finalUrl);
    const listed = registrableDomain((store && store.website) || website);
    if (landed && listed && landed !== listed && Date.now() < deadline - 500) {
      let body = '';
      try {
        const g = await once(finalUrl, 'GET', { wantBody: true, timeout: Math.min(TIMEOUT_MS, deadline - Date.now()) });
        body = g.body || '';
      } catch { /* best effort: an unreadable destination stays the 'ok' below */ }
      const verdict = judgePage(store, website, finalUrl, body);
      if (verdict) return { ...verdict, code, final_url: finalUrl };
    }
    return { status: 'ok', code, final_url: finalUrl };
  }

  // Shopify answers 402 when a shop stops paying: the address resolves, the
  // page exists, and it sells nothing. That is not a link worth showing.
  if (code === 402) return { status: 'store_unavailable', code, final_url: finalUrl };

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
      SELECT id, name, website, city, phone, address, claimed, confidence
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
  const store = await db.get('SELECT id, name, website, city, phone, address FROM stores WHERE id = ?', [id]);
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


// ── self-test ───────────────────────────────────────────────────────────────
function selftest() {
  let pass = 0, fail = 0;
  const ok = (cond, label, extra) => {
    if (cond) { pass++; console.log(`  ok   ${label}`); }
    else { fail++; console.log(`  FAIL ${label}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ''}`); }
  };
  const page = html => pageIdentity(html);

  // Registrable domains, so a www or shop subdomain is not called a takeover.
  ok(registrableDomain('www.mikescigarroom.com') === 'mikescigarroom.com', 'www is the same domain');
  ok(registrableDomain('https://shop.davidoff.com/us') === 'davidoff.com', 'so is a shop subdomain');
  ok(registrableDomain('shop.cigars.co.uk') === 'cigars.co.uk', 'a two-label suffix is not the domain');

  // visibleText is the point of pageIdentity: a gambling word inside a script
  // or a tracking pixel must not brand a real shop as hijacked.
  const scripted = '<html><head><title>Ashford Cigars</title></head><body>'
    + '<script>var casino_tracking="slot online situs slot judi togel";</script>'
    + '<p>Premium cigars since 1974.</p></body></html>';
  ok(!visibleText(scripted).includes('judi'), 'script contents are not page text');
  ok(looksHijacked({ name: 'Ashford Cigars' }, page(scripted)) === null,
    'gambling words inside a script do not make a shop hijacked');

  // A real takeover: the visible page, no cigar word, two gambling terms.
  const taken = '<html><head><title>Situs Slot Gacor</title></head><body>'
    + '<p>Daftar judi bola dan live casino terbaik. Togel online.</p></body></html>';
  ok(looksHijacked(null, page(taken)), 'a casino page on a lapsed domain is hijacked');
  ok(looksHijacked({ name: 'Lucky Cigar' }, page(taken.replace('Situs Slot Gacor', 'Lucky Cigar'))) === null,
    'but a page that still names the shop is not');
  const pokerNight = '<html><body><p>Join us for poker night at the cigar lounge. Blackjack too.</p></body></html>';
  ok(looksHijacked(null, page(pokerNight)) === null,
    'and a cigar lounge with a poker night is not — it says cigar');
  const oneTerm = '<html><body><p>Our slot machines are in the back room.</p></body></html>';
  ok(looksHijacked(null, page(oneTerm)) === null, 'one gambling word alone is not enough');

  // The rebrand guardrail: a phone number, an address or the distinctive part
  // of the name on the destination keeps the link.
  const shop = { name: "Mike's Cigar Room", city: 'Bay Harbor Islands', phone: '(305) 866-2277', address: '1030 Kane Concourse' };
  ok(namesShop(shop, page('<html><body>Call us on 305-866-2277 for hours</body></html>'), null),
    'a phone number on the destination is a rebrand');
  ok(namesShop(shop, page('<html><body>Visit us at 1030 Kane Concourse</body></html>'), null),
    'so is the street address');
  ok(namesShop(shop, page('<html><title>Mikes Cigars</title><body>x</body></html>'), null),
    'so is the distinctive part of the name, from the title');
  ok(namesShop(shop, page('<html><body><img alt="Mikes Cigar Room logo" src="x.png"></body></html>'), null),
    'and from a logo\'s alt text, which is where some shops put their only name');
  ok(!namesShop(shop, page('<html><body>Premium cigars and lounge, established 1974</body></html>'), null),
    'but not the trade words every cigar shop shares');

  // Parking, including the paths and lander phrases a drop-catcher serves.
  ok(looksParked('http://sedoparking.com/x', ''), 'a known parking host is parked whatever it serves');
  ok(looksParked('https://cigarsandsmokeshop.com/lander', ''), 'and so is a /lander path');
  ok(looksParked('https://x.com/', 'This webpage was generated by the domain owner. Resources and information.'),
    'a drop-catcher lander is parked');
  ok(!looksParked('https://realshop.com/', '<html>' + 'x'.repeat(40000) + 'buy this domain</html>'),
    'a big page is not a for-sale notice, whatever words it contain');

  // The status vocabulary has to agree with itself, or a dead link is rendered
  // as a working one somewhere.
  ok(socialNetwork('https://www.facebook.com/tampasweethearts') === 'Facebook page', 'a Facebook link is named');
  ok(socialNetwork('http://m.facebook.com/x') === 'Facebook page', 'so is the mobile host');
  ok(socialNetwork('instagram.com/elreycigars') === 'Instagram profile', 'a bare host still parses');
  ok(socialNetwork('https://x.com/shop') === 'X profile', 'x.com is Twitter');
  ok(socialNetwork('https://linktr.ee/shop') === 'Linktree', 'a link hub is named');
  ok(socialNetwork('https://tampasweethearts.com') === null, 'a shop on its own domain has no network');
  ok(socialNetwork('https://notfacebook.com') === null, 'the name has to be the domain, not a substring');
  ok(socialNetwork('') === null && socialNetwork('::::') === null, 'junk is not a network');
  // The column stores bare hosts, so destinationKind has to read them. It used
  // to answer 'site' for every one of them, because new URL() threw.
  ok(destinationKind('facebook.com/KUSH.Smoke.Emporium') === 'social',
    'a stored website with no scheme is still classified');
  ok(destinationKind('https://facebook.com/x') === 'social', 'and so is one with a scheme');
  ok(destinationKind('m.facebook.com/x') === 'social', 'including the mobile host');
  ok(destinationKind('linktr.ee/shop') === 'social' || destinationKind('linktr.ee/shop') === 'platform',
    'a link hub is not the shop\u2019s own site');
  ok(destinationKind('tampasweethearts.com') === 'site', 'a shop on its own domain is a site');
  ok(destinationKind('not a url at all') === 'site', 'and junk falls back to a site rather than throwing');
  ok(PENDING_STATUS === 'checking' && STATUSES.includes(PENDING_STATUS), 'the pending verdict is a status');
  ok(!DEAD_STATUSES.includes(PENDING_STATUS),
    'a link we have not looked at yet is not a dead link: it is unknown, and the two get different copy');
  ok(DEAD_STATUSES.every(v => STATUSES.includes(v)), 'every dead status is a status');
  ok(TAKEN_OVER_STATUSES.every(v => DEAD_STATUSES.includes(v)), 'a taken-over domain is a dead link');
  ok(!DEAD_STATUSES.includes('ok') && !DEAD_STATUSES.includes('blocked'),
    'ok and blocked are the only statuses a customer may be shown');
  ok(!BLOCKED_CODES.has(402), '402 is no longer treated as a working link behind a firewall');

  // judgePage is the half of the check that decides whose page it is. These
  // assertions exist because the first version of this audit wrote
  // looksHijacked, namesShop and pageIdentity, tested them, and never called
  // them: every gambling takeover on the map stayed 'ok' and nothing failed.
  const casino = '<html><title>188BET - Nha Cai Ca Cuoc</title><body>casino sportsbook baccarat roulette jackpot</body></html>';
  const samhill = { name: 'Sam Hill Cigars', city: 'Prescott', phone: '(928) 778-7600', address: '202 S Montezuma St', website: 'samhillcigars.com' };
  ok(judgePage(samhill, samhill.website, 'https://samhillcigars.com/', casino).status === 'hijacked',
    'a lapsed shop domain now serving a casino is hijacked, and the checker asks');
  ok(judgePage(samhill, samhill.website, 'https://official-tomatbet.com/', casino).status === 'hijacked',
    'and so is one reached by a redirect off the shop’s own domain');
  const ownPage = '<html><title>Sam Hill Cigars</title><body>202 S Montezuma St, Prescott. Premium cigars.</body></html>';
  ok(judgePage(samhill, samhill.website, 'https://samhillcigars.com/', ownPage) === null,
    'the shop’s own page keeps its link');
  const rebrand = '<html><title>Sam Hill Cigars &amp; Lounge</title><body>Now at samhilllounge.com</body></html>';
  ok(judgePage(samhill, samhill.website, 'https://samhilllounge.com/', rebrand) === null,
    'a rebrand onto a new domain that still names the shop keeps its link');
  const stranger = '<html><title>Prescott Plumbing Supply</title><body>Fittings and valves since 1974.</body></html>';
  ok(judgePage(samhill, samhill.website, 'https://prescottplumbing.com/', stranger).status === 'elsewhere',
    'a redirect to a stranger’s site is elsewhere');
  ok(judgePage(samhill, samhill.website, 'https://facebook.com/samhillcigars', stranger) === null,
    'but a social page is judged in the UI, not taken away here');
  ok(judgePage(null, 'x.com', 'https://x.com/', ownPage) === null,
    'with no store context the check says nothing rather than guessing');
  ok(judgePage(samhill, samhill.website, 'https://samhillcigars.com/', '') === null,
    'and an unreadable body is never a verdict');

  // A shop whose only web presence is a Facebook page keeps its link, but the
  // destination is the platform's, so it is never the shop's own site.
  ok(destinationKind('https://www.facebook.com/someshop') === 'social', 'a Facebook page is a platform, not a site');
  ok(destinationKind('https://ashfordcigars.com/') === 'site', 'and a shop domain is a site');

  ok(parseWebsite('120cigarbar.com').host === '120cigarbar.com', 'a bare hostname parses');
  ok(parseWebsite('http://127.0.0.1/') === null, 'loopback is refused');

  console.log(`\nlinkCheck self-test: ${pass} passed, ${fail} failed`);
  return fail;
}

module.exports = {
  checkWebsite, checkStores, checkStore, runStartupLinkCheck,
  parseWebsite, looksParked, looksHijacked, namesShop, pageIdentity, visibleText, judgePage,
  registrableDomain, destinationKind, socialNetwork,
  STATUSES, DEAD_STATUSES, TAKEN_OVER_STATUSES, PENDING_STATUS, GAMBLING_TERMS, selftest,
};

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
