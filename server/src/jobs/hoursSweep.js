/**
 * Opening hours, read from each shop's own website.
 *
 * Map data gives hours for 4% of listings, so nearly every card said nothing
 * useful — and a display bug turned "no hours" into "Closed today", which sent
 * people away from shops that were open. A shop's own site is the authority on
 * when its door is open.
 *
 * Two stages, so what gets written is exactly what was reviewed:
 *
 *   collect  read every listed website and save the evidence: schema.org
 *            opening hours (JSON-LD and microdata), the visible text around
 *            "Hours" and day names, and the page's preview image. Appends one
 *            line per shop to a JSONL file and resumes where it stopped.
 *   apply    parse that saved evidence (utils/hoursParser.js) and write hours
 *            and images for listings that nobody has edited by hand.
 *
 * Never touches a claimed or staff-edited listing: an owner's hours beat ours.
 *
 * CLI:  node src/jobs/hoursSweep.js collect --out evidence.jsonl [--limit N]
 *       node src/jobs/hoursSweep.js chains  --out chains.jsonl     # chain store pages and locators
 *       node src/jobs/hoursSweep.js decide  --from evidence.jsonl[,rendered.jsonl] --chains chains.jsonl
 *                                           --out decisions.json --skips skips.json   # review this
 *       node src/jobs/hoursRender.js --skips skips.json --out rendered.jsonl        # optional, local
 *       node src/jobs/hoursSweep.js apply   --from decisions.json --confirm
 *       node src/jobs/hoursSweep.js selftest
 */
'use strict';

const fs = require('fs');
const { URL } = require('url');
const db = require('../database/db');
const { fetchUrl } = require('./webMenu');

const WORKERS = 8;
const MAX_EXTRA_PAGES = 3;
const PAUSE_MS = 400;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Pages worth opening after the homepage, judged by link text or address.
const LINK_HINT = /hour|contact|location|visit|about|store|find|direction|lounge|info/i;
const DAY = /\b(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(day|s)?\b|\bdaily\b|\b7 days\b|\bweekdays?\b|\bweekends?\b/i;
const TIME = /\b\d{1,2}(:\d{2})?\s*(a\.?m\.?|p\.?m\.?)\b|\b\d{1,2}:\d{2}\b|\bnoon\b|\bmidnight\b/i;

const ENTITIES = { nbsp: ' ', amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', ndash: '–', mdash: '—', rsquo: "'", lsquo: "'", hellip: '…' };
function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => (ENTITIES[n.toLowerCase()] !== undefined ? ENTITIES[n.toLowerCase()] : m));
}

/** Visible text with block structure kept as line breaks. */
function pageText(html) {
  return decodeEntities(String(html || '')
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|td|th|h[1-6]|dt|dd|section|article|span)>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/\n\s*/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/** The lines that talk about hours, with a little context either side. */
function hoursSnippets(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const keep = new Set();
  lines.forEach((l, i) => {
    const dayAndTime = DAY.test(l) && (TIME.test(l) || /closed|open 24|24 hours/i.test(l));
    // An hours table puts the day and its times in separate cells, so they
    // arrive on separate lines: "Monday" / "8:30 AM - 8:00 PM".
    const dayThenTime = DAY.test(l) && l.length < 30 && i + 1 < lines.length && (TIME.test(lines[i + 1]) || /^closed$/i.test(lines[i + 1].trim()));
    const heading = /\b(hours|store hours|opening hours|business hours|hours of operation|lounge hours)\b/i.test(l) && l.length < 80;
    if (dayAndTime || dayThenTime || heading) for (let j = Math.max(0, i - 1); j <= Math.min(lines.length - 1, i + (heading ? 9 : dayThenTime ? 2 : 1)); j++) keep.add(j);
  });
  const out = [...keep].sort((a, b) => a - b).map(i => lines[i].slice(0, 200));
  return out.slice(0, 60);
}

function jsonLdBlocks(html) {
  const out = [];
  for (const m of String(html || '').matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    const raw = m[1].trim();
    if (raw && raw.length < 60000) out.push(raw);
  }
  return out;
}

function microdataHours(html) {
  const out = [];
  for (const m of String(html || '').matchAll(/itemprop=["']openingHours["'][^>]*?(?:content=["']([^"']+)["'])?[^>]*>([^<]{0,120})/gi)) {
    const v = (m[1] || m[2] || '').trim();
    if (v) out.push(v);
  }
  return out;
}

function metaImage(html, base) {
  const pick = re => { const m = String(html || '').match(re); return m ? m[1] : null; };
  const raw = pick(/<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i)
    || pick(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)
    || pick(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i);
  if (!raw) return null;
  try {
    const u = new URL(decodeEntities(raw), base);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch { return null; }
}

function candidateLinks(html, base) {
  let host;
  try { host = new URL(base).host.replace(/^www\./, ''); } catch { return []; }
  const seen = new Set();
  const out = [];
  for (const m of String(html || '').matchAll(/<a[^>]+href=["']([^"'#]+)["'][^>]*>([\s\S]{0,200}?)<\/a>/gi)) {
    let u;
    try { u = new URL(decodeEntities(m[1]), base); } catch { continue; }
    if (!/^https?:$/.test(u.protocol) || u.host.replace(/^www\./, '') !== host) continue;
    const text = m[2].replace(/<[^>]+>/g, ' ');
    if (!LINK_HINT.test(u.pathname) && !LINK_HINT.test(text)) continue;
    if (/\.(jpg|jpeg|png|gif|pdf|webp|svg|zip)$/i.test(u.pathname)) continue;
    const key = u.origin + u.pathname;
    if (seen.has(key) || key === new URL(base).origin + new URL(base).pathname) continue;
    seen.add(key);
    // Prefer an hours page, then contact, then location.
    const rank = /hour/i.test(u.pathname + text) ? 0 : /contact/i.test(u.pathname + text) ? 1 : 2;
    out.push({ url: u.toString(), rank });
  }
  return out.sort((a, b) => a.rank - b.rank).slice(0, MAX_EXTRA_PAGES).map(x => x.url);
}

async function fetchPage(url) {
  try {
    const res = await fetchUrl(url, { accept: 'text/html,application/xhtml+xml' });
    if (!res || res.status >= 400 || !res.body) return null;
    return { url: res.url || url, body: res.body };
  } catch { return null; }
}

/** Everything a shop's site says about its hours, and one picture of it. */
async function collectOne(store) {
  const site = /^https?:\/\//i.test(store.website) ? store.website : `https://${store.website}`;
  const home = await fetchPage(site);
  if (!home) return { id: store.id, ok: false };
  const pages = [home];
  for (const link of candidateLinks(home.body, home.url)) {
    await sleep(PAUSE_MS);
    const p = await fetchPage(link);
    if (p) pages.push(p);
  }
  const evidence = { id: store.id, ok: true, url: home.url, jsonld: [], microdata: [], text: [], image: null };
  for (const p of pages) {
    evidence.jsonld.push(...jsonLdBlocks(p.body));
    evidence.microdata.push(...microdataHours(p.body));
    const snip = hoursSnippets(pageText(p.body));
    if (snip.length) evidence.text.push({ url: p.url, lines: snip });
    if (!evidence.image) evidence.image = metaImage(p.body, p.url);
  }
  // Keep the file small: only JSON-LD that could carry hours or an address.
  evidence.jsonld = evidence.jsonld.filter(b => /openingHours|dayOfWeek|streetAddress|"image"|"logo"/i.test(b)).slice(0, 8);
  return evidence;
}

async function collect({ out, limit = 0, ids = null, log = console.log } = {}) {
  if (!out) throw new Error('collect needs --out <file.jsonl>');
  const done = new Set();
  if (fs.existsSync(out)) {
    for (const line of fs.readFileSync(out, 'utf8').split('\n')) {
      try { const r = JSON.parse(line); if (r && r.id) done.add(r.id); } catch {}
    }
  }
  let stores = await db.all(`
    SELECT id, name, website FROM stores
    WHERE visible = 1 AND website IS NOT NULL AND website <> ''
      AND COALESCE(website_status, 'ok') IN ('ok', 'blocked')
    ORDER BY id`);
  if (ids) stores = stores.filter(s => ids.includes(s.id));
  stores = stores.filter(s => !done.has(s.id));
  if (limit) stores = stores.slice(0, limit);
  log(`${done.size} already collected; reading ${stores.length} more websites with ${WORKERS} workers`);

  const stream = fs.createWriteStream(out, { flags: 'a' });
  let next = 0, finished = 0, withHours = 0, withImage = 0;
  const started = Date.now();
  async function worker() {
    while (next < stores.length) {
      const s = stores[next++];
      let ev;
      try { ev = await collectOne(s); } catch (e) { ev = { id: s.id, ok: false, error: String(e.message || e).slice(0, 80) }; }
      stream.write(JSON.stringify(ev) + '\n');
      finished++;
      if (ev.ok && (ev.jsonld.some(b => /openingHours|dayOfWeek/i.test(b)) || ev.microdata.length || ev.text.length)) withHours++;
      if (ev.image) withImage++;
      if (finished % 100 === 0) {
        const mins = (Date.now() - started) / 60000;
        log(`  ${finished}/${stores.length} read — ${withHours} with hours evidence, ${withImage} with an image — ${(finished / mins).toFixed(0)}/min`);
      }
      await sleep(PAUSE_MS);
    }
  }
  await Promise.all(Array.from({ length: WORKERS }, worker));
  await new Promise(r => stream.end(r));
  log(`done: ${finished} read, ${withHours} with hours evidence, ${withImage} with an image`);
  return { read: finished, withHours, withImage };
}

// ── Deciding ────────────────────────────────────────────────────────────────

const { addressKey, hostOf } = require('./chainCheck');
const { parseOpeningHoursString, parseSpecification, parseTextHours, fillClosedPerSpec, describe } = require('../utils/hoursParser');

// Hours next to these are the phone line's or the web shop's, not the door's:
// "Call us … Mon-Fri 9-5", "WhatsApp … Mon-Fri 9AM-5PM Eastern".
// Not a bare "Phone:" or "Email:" label, which every store page prints beside
// its real hours; only words that say the times are the phone's or the web's.
const PHONE_CONTEXT = /\b(call(s|ing)? us|call (between|during)|phone (hours|orders|support)|by phone|customer (service|care|support)|support (hours|team)|whatsapp|office hours|order(s|ing)? (by|before|placed)|shipping|ships? (same|next)|online (orders?|store|shop)|live chat|chat with|text us|representatives?|mail order|warehouse|pick-?up hours)\b/i;
const TIME_ZONE = /\b(e[sd]t|c[sd]t|m[sd]t|p[sd]t|eastern|central|pacific|mountain|easter time)\b/i;
const STORE_CONTEXT = /\b(store|shop|lounge|showroom|walk-?in|retail) hours\b|\bhours of operation\b|\bvisit us\b/i;
// A street number is not the minutes of a time ("8:00 AM") or a year's tail.
const ADDRESS_IN_LINE = /(?<![:\d.-])\b(\d{2,6})\s+(?!(?:am|pm|a\.m|p\.m)\b)((?:[NSEW]\.?\s+)?[A-Za-z][A-Za-z0-9'.]*(?:\s+[A-Za-z0-9'.]+){0,4})/i;

function lineAddressKey(line) {
  const m = String(line || '').match(ADDRESS_IN_LINE);
  if (!m || /^0+$/.test(m[1])) return null;
  const key = addressKey(m[0]);
  // "opened in 1994 and today…", "Open 365 days!" are prose, not a street.
  if (!key || /\s(and|or|the|of|to|in|at|for|years?|days?|hours?|weeks?|months?|minutes?|locations?|stores?|miles?|cigars?|brands?|people|members?|seats?|percent|off)$/.test(key)) return null;
  return key;
}

function looksLikeAddress(line) {
  return /\b\d{2,6}\s+\S+.*\b(st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|hwy|highway|ln|lane|pkwy|parkway|way|pl|place|ct|court|pike|trl|trail)\b/i.test(line)
    || /\b[A-Z][a-z]+,\s*[A-Z]{2}\s+\d{5}\b/.test(line);
}

function parseLd(raw) {
  try { return JSON.parse(raw); } catch {}
  try { return JSON.parse(raw.replace(/[\u0000-\u001f]+/g, ' ')); } catch {}
  return null;
}

/**
 * Hours an SEO plugin writes when nobody fills the field in. Rank Math and Yoast
 * Local SEO both default to "Mo-Su 09:00-17:00"; a hijacked domain's markup
 * says open around the clock. Seven identical days of either is a template,
 * not a shop — verification caught it on seven real sites, one of which is
 * actually open until 10pm.
 */
function placeholderHours(hours) {
  const vals = Object.values(hours || {});
  if (vals.length < 7) return false;
  return new Set(vals).size === 1 && ['9am-5pm', '12am-12am', '8am-5pm'].includes(vals[0]);
}

// WP Store Locator fills every new store with Mon-Fri 9-5, weekends closed.
// Wiregrass Tobacco's locator still carries it; its site gives no hours at all.
function locatorDefaultHours(hours) {
  const h = hours || {};
  return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].every(d => h[d] === '9am-5pm') && h.Sat === 'Closed' && h.Sun === 'Closed';
}

// A web shop's markup describes its office or support line, not a door.
const NOT_A_PLACE = /^(OnlineStore|OnlineBusiness|WebSite|WebPage|Organization)$/i;

/** Every opening-hours statement in the site's markup, with the address it belongs to. */
function structuredCandidates(ev) {
  const out = [];
  const seen = new Set();
  const push = (hours, street, kind, name) => {
    if (!hours || !describe(hours).open || placeholderHours(hours)) return;
    const key = street ? addressKey(street) : null;
    const sig = JSON.stringify(hours) + '|' + key;
    if (seen.has(sig)) return;
    seen.add(sig);
    out.push({ hours, addressKey: key, street: street || null, kind, name: name || null });
  };
  for (const raw of ev.jsonld || []) {
    const data = parseLd(raw);
    const visit = node => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) return node.forEach(visit);
      const types = [].concat(node['@type'] || []);
      const placeLess = types.length && types.every(t => NOT_A_PLACE.test(String(t)));
      let hours = null;
      if (!placeLess && node.openingHoursSpecification) hours = parseSpecification(node.openingHoursSpecification);
      if (!placeLess && !hours && node.openingHours) hours = fillClosedPerSpec(parseOpeningHoursString(node.openingHours));
      if (hours) {
        const a = node.address;
        push(hours, a ? (typeof a === 'string' ? a : a.streetAddress) : null, 'markup', typeof node.name === 'string' ? node.name : null);
      }
      for (const [k, v] of Object.entries(node)) if (k !== 'openingHoursSpecification' && v && typeof v === 'object') visit(v);
    };
    visit(data);
  }
  for (const m of ev.microdata || []) push(fillClosedPerSpec(parseOpeningHoursString(m)), null, 'microdata');
  return out;
}

// Times on these lines are an event's or a special's, not the door's:
// "Happy Hour Monday - Friday | 4 pm to 6 pm" is not when a lounge opens.
const EVENT_LINE = /\b(happy hour|special|specials|deals?|trivia|live music|tasting|events?|class(es)?|league|poker|ladies'? night|karaoke|brunch|kitchen|food|menu|bingo|comedy|open mic|dj|watch party|pairing|seminar|meet(s|ing)?|holiday|christmas|thanksgiving|new year'?s?|easter|memorial day|labor day|july 4|4th of july|game day|games?)\b/i;

// Words in a shop's name that say nothing about which shop it is.
const GENERIC_NAME = new Set(['cigar', 'cigars', 'tobacco', 'tobacconist', 'shop', 'shoppe', 'store', 'lounge', 'bar',
  'club', 'co', 'company', 'inc', 'llc', 'the', 'and', 'of', 'smoke', 'smokes', 'premium', 'fine', 'humidor', 'emporium',
  'house', 'room', 'cafe', 'at', 'by', 'de', 'la', 'el']);

/** Words a cigar shop's domain shares with every other cigar shop's domain. */
const TRADE_WORD = ['cigar', 'cigars', 'tobacco', 'tobacconist', 'smoke', 'smokes', 'humidor',
  'lounge', 'pipe', 'pipes', 'stogie', 'stogies', 'shop', 'shoppe', 'store', 'cellar', 'emporium'];

/**
 * Does this website speak about this shop at all? A listing's "website" is
 * sometimes someone else's: verification found a tattoo studio, a distillery,
 * a life-insurance blog and a Bitcoin-ATM locator. If the shop's own name
 * appears nowhere in the site's address, markup or hours text, neither its
 * hours nor its picture are this shop's.
 *
 * Three things changed after the re-audit read the failures:
 *
 *  - The page text is matched on whole words. It used to be matched against the
 *    text with every space stripped out, so "Ash" found "cash", "Den" found
 *    "garden" and any three-letter name matched almost any page.
 *  - A domain has no spaces, so it cannot be matched on whole words — and a
 *    single short word inside a domain is close to no evidence at all. It now
 *    has to carry two of the name's own words, or one of them beside a trade
 *    word: "donestebancigars.com" passes, "denver.net" does not.
 *  - The town-only fallback is gone. A shop named after its town ("Brainerd
 *    Cigars") used to be confirmed by any page that said the town, which is
 *    every business in it — that is how Tobacco Den Brainerd took its hours
 *    from brainerdglass.net. Where the name says nothing but the town, only a
 *    domain carrying the town AND a trade word counts.
 */
function mentionsShop(ev, store) {
  const allWords = String(store.name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ')
    .filter(w => w.length > 2 && !GENERIC_NAME.has(w));
  if (!allWords.length) return true;             // "Cigar Shop" names nothing to look for
  const town = new Set(String(store.city || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' '));
  const own = allWords.filter(w => !town.has(w));

  const stem = hostOf(ev.url || '').replace(/\.[a-z.]+$/i, '').replace(/[^a-z0-9]/gi, '').toLowerCase();
  // A domain built from the name's initials and a trade word: Tobacco
  // Republic at trcigar.com.
  const initials = String(store.name || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/)
    .filter(w => w && !['the', 'and', 'of', 'at', 'by'].includes(w)).map(w => w[0]).join('');
  if (initials.length >= 2 && stem.startsWith(initials) && /^(cigars?|tobacco|smokes?|lounge|shop|co)?$/.test(stem.slice(initials.length))) return true;

  const said = [
    ...(ev.jsonld || []).map(b => (String(b).match(/"name"\s*:\s*"[^"]{1,120}"/g) || []).join(' ')),
    ...(ev.text || []).flatMap(t => t.lines || []),
  ].join(' ').toLowerCase();
  const spaced = ` ${said.replace(/[^a-z0-9]+/g, ' ')} `;
  const inText = w => spaced.includes(` ${w} `);
  const inDomain = w => stem.includes(w);
  const domainHasTrade = TRADE_WORD.some(t => stem.includes(t));

  // The evidence only carries the lines around the hours, not the whole page, so
  // a shop's own name often never appears in it. The domain does most of the
  // work here, and has to be read carefully rather than strictly: reading the
  // first run of refusals by hand found eleven of fourteen were real shops on
  // their own domains — Tampa Sweethearts at tampasweethearts.com, GarVino's at
  // garvinos.com, The Cigar Shop at thecigarshop.com.
  const townWords = allWords.filter(w => town.has(w));
  const townInDomain = townWords.some(inDomain);
  // The domain IS the shop's name, run together: "thecigarshop.com" for The
  // Cigar Shop - Indian Trail, "tobaccoshop.com" for The Tobacco Shop of
  // Ridgewood. Every word of those names is a trade word, so nothing else can
  // confirm them.
  const domainIsTheName = (() => {
    if (stem.length < 6) return false;
    const tokens = String(store.name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter(Boolean);
    const variants = [tokens, tokens.filter(w => w !== 'the'), tokens.filter(w => !town.has(w)),
      tokens.filter(w => w !== 'the' && !town.has(w))];
    return variants.some(v => v.join('').startsWith(stem));
  })();

  if (own.length) {
    if (own.some(inText)) return true;
    // Two of the name's own words in the domain, the town counting as one of
    // them: "tampasweethearts.com" holds both halves of Tampa Sweethearts.
    if (allWords.filter(inDomain).length >= 2) return true;
    const hits = own.filter(inDomain);
    // One distinctive word, beside something that ties the domain to this shop
    // rather than to any shop: a trade word, the town, or the fact that the
    // domain opens with that word.
    if (hits.length >= 1 && (domainHasTrade || townInDomain || hits.some(w => stem.startsWith(w)))) return true;
    return domainIsTheName;
  }
  // Every distinctive word in the name is the town's. The page text cannot help
  // — every business in the town says the town — so the domain has to. This is
  // what stopped Tobacco Den Brainerd taking its hours from brainerdglass.net.
  return (townInDomain && domainHasTrade) || domainIsTheName;
}

/** Does the text around these lines say they are phone or web-shop hours? */
function phoneHours(lines, from, to) {
  const window = lines.slice(Math.max(0, from - 2), Math.min(lines.length, to + 2)).join(' ');
  if (STORE_CONTEXT.test(window)) return false;
  return PHONE_CONTEXT.test(window) || TIME_ZONE.test(window);
}

// ── the four refusals the hours re-audit added ──────────────────────────────

/** A desk, not a shop floor. */
const DESK_CONTEXT = /\b(working hours|office|support|customer (service|care)|fax|orders?|order desk|corporate|headquarters|head office|administration|admin|billing|accounts|reception|by appointment only|wholesale)\b/i;

/**
 * A Monday-to-Friday nine-to-five is what a desk keeps, not a cigar shop: a
 * shop that shuts at five and never opens at the weekend is rare enough that,
 * next to the word "office" or "support", the block is almost always the
 * company's phone line. One of these published a Hong Kong support team's
 * hours as a San Francisco shop's.
 */
function isDeskWeek(hours) {
  const weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  const days = Object.keys(hours || {});
  // Monday to Friday only, or Monday to Friday with the weekend marked shut.
  const open = days.filter(d => hours[d] !== 'Closed');
  if (open.length !== 5 || !weekday.every(d => hours[d] && hours[d] !== 'Closed')) return false;
  return weekday.every(d => /^(8|9)am-5pm$/.test(hours[d]));
}

function officeHours(hours, lines, from, to) {
  if (!isDeskWeek(hours)) return false;
  const window = lines.slice(Math.max(0, from - 3), Math.min(lines.length, to + 3)).join(' ');
  if (STORE_CONTEXT.test(window)) return false;
  return DESK_CONTEXT.test(window);
}

/**
 * The same question for markup, which has no lines around it to read. A
 * LocalBusiness block stating a desk's week, on a page that talks about a desk
 * and never about a shop floor, is the company's phone line — one of these was
 * a Hong Kong support team published as a San Francisco shop's hours.
 */
function officeHoursInMarkup(hours, ev) {
  if (!isDeskWeek(hours)) return false;
  const page = (ev.text || []).flatMap(t => t.lines || []).join(' ');
  if (STORE_CONTEXT.test(page)) return false;
  return DESK_CONTEXT.test(page);
}

/**
 * The hours of the building, not of the shop inside it. A tobacconist in a
 * casino or a shopping centre picks up its host's block, which is usually much
 * longer than the shop's own day.
 */
const HOST_VENUE = /\b(casino|convenience store|gas station|travel (plaza|center|centre)|truck stop|mall hours|the mall|shopping (mall|cent(er|re))|food court|airport|terminal|hotel (lobby|front desk)|grocery|supermarket)\b/i;

function hostVenueHours(lines, from, to) {
  const window = lines.slice(Math.max(0, from - 3), Math.min(lines.length, to + 3)).join(' ');
  // "Our shop is in the Grand Casino" is an address, not a schedule heading.
  // A heading is what sits directly above the times.
  const heading = lines.slice(Math.max(0, from - 3), from + 1).join(' ');
  if (STORE_CONTEXT.test(heading)) return false;
  return HOST_VENUE.test(heading) && /\bhours?\b/i.test(window);
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july',
  'august', 'september', 'october', 'november', 'december'];

/**
 * A schedule labelled with a season that today is not in. "Summer Hours:
 * Memorial Day through Labor Day" is last year's block still on the page, and
 * publishing it in December sends people to a shut door.
 *
 * Only a named season with a stated span counts. A bare "Summer Hours" with no
 * dates is left alone: plenty of shops never take the heading down and the
 * hours under it are still current.
 */
function seasonExcludesToday(lines, from, to, now = new Date()) {
  const window = lines.slice(Math.max(0, from - 3), Math.min(lines.length, to + 2)).join(' ');
  if (!/\b(summer|winter|spring|fall|autumn|holiday|seasonal)\s+(hours|schedule)\b/i.test(window)) return false;
  const month = now.getMonth();          // 0-11
  const day = now.getDate();
  const at = m => MONTHS.indexOf(m.toLowerCase());

  // An explicit span: "May 1 - September 30", "November - March".
  const span = /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s*(\d{1,2})?\s*(?:-|to|through|thru|until)\s*(january|february|march|april|may|june|july|august|september|october|november|december)\s*(\d{1,2})?/i.exec(window);
  if (span) {
    const a = at(span[1]), b = at(span[3]);
    const aDay = span[2] ? Number(span[2]) : 1;
    const bDay = span[4] ? Number(span[4]) : 31;
    const after = month > a || (month === a && day >= aDay);
    const before = month < b || (month === b && day <= bDay);
    // A span that wraps the new year ("November - March") is inside when it is
    // after the start OR before the end.
    const inside = a <= b ? (after && before) : (after || before);
    return !inside;
  }
  // The American summer season, named by its holidays.
  if (/memorial day\s*(?:-|to|through|thru|until)\s*labor day/i.test(window)) {
    return !(month > 4 || (month === 4 && day >= 25)) || month > 8;
  }
  return false;
}

/**
 * A town name in a heading between this listing's address and its hours. On a
 * chain's page the blocks run "Miami / 123 Main St / Hours ... / Palm Beach
 * Gardens / 456 PGA Blvd / Hours ...", and a heading naming another town
 * between our door and the times means the times belong to that town.
 */
const TOWN_HEADING = /^\s*([A-Za-z][A-Za-z .'-]{2,30})(?:,\s*([A-Z]{2}))?\s*$/;

function otherTownHeading(seg, store) {
  const ourCity = String(store.city || '').toLowerCase().trim();
  if (!ourCity) return false;
  for (const line of seg) {
    const raw = String(line || '').trim();
    if (raw.length > 34 || /\d/.test(raw)) continue;             // not a bare heading
    const m = TOWN_HEADING.exec(raw);
    if (!m) continue;
    const town = m[1].toLowerCase().trim();
    if (town === ourCity) return false;                          // our own heading: stop looking
    // Only a word that is plausibly a place, not "Hours" or "Contact Us".
    if (/^(hours?|open|closed|contact|about|visit|location|address|phone|store hours|our hours|directions|menu|home|shop|events?)$/i.test(town)) continue;
    // A two-letter state after it makes it certainly a place.
    if (m[2]) return true;
  }
  return false;
}

/** Hours printed on the site's pages, anchored to this listing where possible. */
function textCandidates(ev, store) {
  const anchored = [], loose = [];
  let contradicted = 0;
  const key = addressKey(store.address);
  for (const block of ev.text || []) {
    // Drop event lines, and the day-and-time lines right under an event
    // heading: "Happy Hour" / "Monday - Friday | 4 pm to 6 pm".
    const raw = block.lines || [];
    if (raw.some(l => /\[(your|insert|enter|add)\b|lorem ipsum/i.test(l))) continue;
    const lines = raw.filter((l, i) => {
      if (EVENT_LINE.test(l)) return false;
      const above = raw[i - 1] || '', twoAbove = raw[i - 2] || '';
      const heading = s => EVENT_LINE.test(s) && s.length < 40 && !/\d/.test(s);
      return !(heading(above) || (heading(twoAbove) && !/\bhours\b/i.test(above)));
    });
    // 1. Hours printed after this listing's own street address.
    if (key) {
      const at = lines.findIndex(l => lineAddressKey(l) === key);
      if (at >= 0) {
        const seg = [];
        for (let i = at + 1; i < Math.min(lines.length, at + 8); i++) {
          if (i > at + 1 && looksLikeAddress(lines[i])) break;
          seg.push(lines[i]);
        }
        const r = parseTextHours(seg);
        const end = at + 1 + seg.length;
        if (r && !r.conflicts && describe(r.hours).days >= 3 && describe(r.hours).open
          && !phoneHours(lines, at + 1, end)
          // Another town's heading between our door and the times means the
          // times are that town's: on a chain page the blocks run address,
          // hours, next town, next address, next hours.
          && !otherTownHeading(seg, store)
          && !officeHours(r.hours, lines, at + 1, end)
          && !hostVenueHours(lines, at + 1, end)
          && !seasonExcludesToday(lines, at + 1, end)) {
          anchored.push({ hours: r.hours, kind: 'text-at-address', url: block.url, lines: [lines[at], ...seg] });
        }
      }
    }
    // 2. A page with one shop's hours on it.
    const addresses = new Set(lines.map(lineAddressKey).filter(Boolean));
    if (addresses.size > 1) continue;              // a locations page: only an anchor can be trusted
    // Hours printed beside an address in another town are that town's: Sabor
    // Havana's Palm Beach Gardens listing must not take its Miami branch's.
    // Only another town counts — a street number or suite written differently
    // from ours is still the same door, and refusing those cost 73 real shops.
    if (addresses.size === 1 && key && !addresses.has(key)) {
      const addrLine = lines.find(l => lineAddressKey(l)) || '';
      const ourCity = String(store.city || '').toLowerCase();
      const namesACity = /,\s*[A-Za-z .'-]{3,},?\s*[A-Z]{2}\b/.test(addrLine);
      if (namesACity && ourCity && !addrLine.toLowerCase().includes(ourCity)) continue;
    }
    // The span of lines that talk in days and times. Found line by line, not
    // rule by rule: an hours table puts "Monday" and "8:30 AM - 8:00 PM" on
    // separate lines, and neither is a rule on its own.
    const hoursLines = lines.map((l, i) => (DAY.test(l) || TIME.test(l) ? i : -1)).filter(i => i >= 0);
    if (!hoursLines.length) continue;
    const from = hoursLines[0], to = hoursLines[hoursLines.length - 1];
    const r = parseTextHours(lines.slice(Math.max(0, from - 1), to + 1));
    // One day with two answers means two blocks (an old hidden one and the
    // current one, a footer and the hours page): refuse to pick.
    if (r && r.conflicts) contradicted++;
    if (!r || r.conflicts || describe(r.hours).days < 3 || !describe(r.hours).open) continue;
    if (phoneHours(lines, from, to)) continue;
    // A desk's week, a host building's day, or last season's block.
    if (officeHours(r.hours, lines, from, to)) continue;
    if (hostVenueHours(lines, from, to)) continue;
    if (seasonExcludesToday(lines, from, to)) continue;
    loose.push({ hours: r.hours, kind: 'text', url: block.url, lines: lines.slice(Math.max(0, from - 2), to + 2) });
  }
  return { anchored, loose, contradicted };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Several pages of one site that agree on every day they both state are one
 * statement, cut off in different places: the homepage block stops before
 * "Sunday: Closed" and the contact page does not. Their union is the answer.
 * Any day stated two ways is a real disagreement, and nothing is merged.
 */
function mergeAgreeing(cands) {
  if (cands.length < 2) return cands;
  // A blanket "Open Daily 10-9" footer never fills a day a specific block
  // leaves out: Cigar World's homepage said "Sun 10am - 5ish".
  const blanket = c => Object.keys(c.hours).length === 7 && new Set(Object.values(c.hours)).size === 1;
  if (cands.some(blanket) && cands.some(c => !blanket(c))) return cands;
  const hours = {};
  for (const c of cands) {
    for (const [day, h] of Object.entries(c.hours)) {
      if (hours[day] && hours[day] !== h) return cands;
      hours[day] = h;
    }
  }
  const base = cands.slice().sort((a, b) => Object.keys(b.hours).length - Object.keys(a.hours).length)[0];
  const ordered = {};
  for (const d of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) if (hours[d]) ordered[d] = hours[d];
  return [{ ...base, hours: ordered }];
}

/**
 * The hours to believe for one listing, or why none are.
 * `siblings` is how many public listings share this website: on a chain's
 * site, only hours tied to this listing's address count.
 */
function decide(ev, store, siblings) {
  if (!ev || !ev.ok) return { skip: 'site unreachable' };
  if (!mentionsShop(ev, store)) return { skip: 'the site never names this shop' };
  const structured = structuredCandidates(ev);
  const key = addressKey(store.address);
  const { anchored, loose, contradicted } = textCandidates(ev, store);
  const looseDistinct = mergeAgreeing(loose.filter((c, i, a) => a.findIndex(x => same(x.hours, c.hours)) === i));

  // 1. Printed hours after this listing's own street address: what a visitor
  //    to the page reads for this door. Verified 93% correct.
  if (anchored.length) return { hours: anchored[0].hours, kind: anchored[0].kind, url: anchored[0].url, lines: anchored[0].lines };

  // 2. Markup tied to this address, unless the visible page says otherwise.
  //    Squarespace and SEO plugins keep old hours in markup long after the
  //    page changed; where they disagree, the page a customer reads wins.
  const atAddress = structured.filter(c => c.addressKey && key && c.addressKey === key);
  if (atAddress.length) {
    // Two markup blocks on one street number that state different hours are two
    // businesses in two suites — Don Juan Cigar Company in Ste 170 and Don Juan
    // Cigar Bar in Ste 160 — and addressKey cannot tell them apart. Picking the
    // first gave the shop the lounge's two-in-the-afternoon-to-midnight day.
    const distinctAtAddress = atAddress.filter((c, i, a) => a.findIndex(x => same(x.hours, c.hours)) === i);
    if (distinctAtAddress.length > 1) {
      // There is no tie-breaker here. The visible text is as likely to be the
      // other business's as ours — at 7539 Corporate Blvd it was the lounge's,
      // and preferring it published the shop as opening at two in the
      // afternoon. When two businesses share a street number, we do not know.
      return { skip: 'two businesses at this street number state different hours' };
    }
    if (siblings <= 1 && looseDistinct.length === 1 && !same(looseDistinct[0].hours, atAddress[0].hours)) {
      return { hours: looseDistinct[0].hours, kind: 'text-over-markup', url: looseDistinct[0].url, lines: looseDistinct[0].lines };
    }
    if (siblings <= 1 && looseDistinct.length > 1) return { skip: 'the site prints different hours in different places' };
    return { hours: atAddress[0].hours, kind: 'markup-at-address', detail: atAddress[0].street };
  }

  // Markup with no address is not used at all: verification found it was a
  // restaurant's, a sister branch's, an online retailer's office or a template
  // more often than it was the shop's.
  const addressedElsewhere = structured.filter(c => c.addressKey && c.addressKey !== key);
  if (siblings > 1) return { skip: addressedElsewhere.length ? 'chain site: no hours for this address' : 'chain site: hours not tied to an address' };
  if (looseDistinct.length > 1) return { skip: 'the site prints different hours in different places' };
  // A page that contradicts itself means the site says two things; a lone
  // "Open Daily 10-9" repeated elsewhere is not the tie-breaker. Cigar World's
  // homepage has "Sun 10am - 5ish" above that same footer.
  const blanket = h => Object.keys(h).length === 7 && new Set(Object.values(h)).size === 1;
  if (looseDistinct.length === 1 && contradicted && blanket(looseDistinct[0].hours)) return { skip: 'the site prints different hours in different places' };
  if (looseDistinct.length === 1) return { hours: looseDistinct[0].hours, kind: 'text', url: looseDistinct[0].url, lines: looseDistinct[0].lines };

  // 3. Markup with no address, only in the one case verification found it
  //    reliable: a single-shop site stating one set of hours, with no markup
  //    for any other address and no printed hours to contradict it. Templates
  //    and web-shop offices have already been filtered out above.
  const unaddressed = structured.filter(c => !c.addressKey);
  const unaddressedDistinct = unaddressed.filter((c, i, a) => a.findIndex(x => same(x.hours, c.hours)) === i);
  if (unaddressedDistinct.length === 1 && !addressedElsewhere.length) {
    if (officeHoursInMarkup(unaddressedDistinct[0].hours, ev)) {
      return { skip: 'markup stating a desk\'s week on a page that only talks about a desk' };
    }
    return { hours: unaddressedDistinct[0].hours, kind: 'markup' };
  }
  return { skip: structured.length ? 'markup that cannot be tied to this shop' : 'no hours found' };
}

// Not the shop's own site: a profile or listing on someone else's platform.
// Nothing there is the shop speaking for itself, and most of it sits behind a
// login or terms that forbid reading it.
const NOT_THE_SHOPS_SITE = /(^|\.)(facebook\.com|fb\.me|instagram\.com|linktr\.ee|yelp\.[a-z.]+|google\.[a-z.]+|business\.site|tripadvisor\.[a-z.]+|foursquare\.com|mapquest\.com|yellowpages\.com|bbb\.org|twitter\.com|x\.com|tiktok\.com|youtube\.com|eventbrite\.[a-z.]+|nextdoor\.com|findsmokeshop\.com|cigarplaces\.com|hub\.biz|hubbiz\.net|yahoo\.com|exxonmobilfuels\.com|[a-z0-9-]+\.gov)$/i;

// Pictures that are nobody's shop: blank and tracking images, a platform's
// default share card, an avatar service, a map provider's street photo.
const GENERIC_IMAGE = /\/(blank|spacer|pixel|placeholder|no-?image|default|default-(og|share)|og-default|business_logo)\.(jpe?g|png|gif|webp|svg)(\?|$)|twimg\.com\/.*\/default\/|gravatar\.com|blavatar|streetviewpixels|googleapis\.com|facebook\.com\/tr/i;

/** A website as a place: host and path, so a chain's location page is its own. */
function pageKey(website) {
  return String(website || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '')
    .replace(/[?#].*$/, '').replace(/\/+$/, '');
}

/** Read saved evidence and write the decisions a person reviews before applying. */
/** JSON lines from one or more files ("a.jsonl,b.jsonl"), in order. */
function readJsonl(list) {
  const out = [];
  for (const file of String(list || '').split(',').map(f => f.trim()).filter(Boolean)) {
    if (!fs.existsSync(file)) throw new Error(`no such file: ${file}`);
    for (const line of fs.readFileSync(file, 'utf8').split(String.fromCharCode(10))) {
      if (!line.trim()) continue;
      try { out.push(JSON.parse(line)); } catch {}
    }
  }
  return out;
}

async function decideAll({ from, out, chains = null, skipsOut = null, log = console.log } = {}) {
  if (!from) throw new Error('decide needs --from evidence.jsonl[,more.jsonl]');
  // Store pages read from chain websites (and their store locators), by host.
  const chainPages = new Map();
  if (chains) {
    for (const p of readJsonl(chains)) {
      if (p.marker || !p.host) continue;
      if (!chainPages.has(p.host)) chainPages.set(p.host, []);
      chainPages.get(p.host).push(p);
    }
    log(`${[...chainPages.values()].reduce((n, l) => n + l.length, 0)} chain store pages from ${chainPages.size} websites`);
  }
  // Several reads of the same sites (a first pass, a re-read, a browser pass):
  // a later read replaces an earlier one, unless it failed where that worked.
  const evidence = new Map();
  for (const ev of readJsonl(from)) {
    const prev = evidence.get(ev.id);
    if (!prev || ev.ok || !prev.ok) evidence.set(ev.id, ev);
  }
  const stores = await db.all(`
    SELECT id, name, address, city, state, zip, website, claimed, staff_edited, hours, hours_source,
           logo_url, cover_url, web_image_url
    FROM stores WHERE visible = 1 AND website IS NOT NULL AND website <> ''`);
  const byId = new Map(stores.map(s => [s.id, s]));
  // Listings that point at the very same page share it; a chain listing that
  // links its own location page (".../locations/boca-raton") stands alone.
  // Doors are counted, not listings: one shop listed twice at one street is
  // still one shop, and its homepage hours are its own.
  const doorsPerPage = new Map();
  for (const s of stores) {
    const k = pageKey(s.website);
    if (!doorsPerPage.has(k)) doorsPerPage.set(k, new Set());
    doorsPerPage.get(k).add(addressKey(s.address) || `#${s.id}`);
  }
  const perPage = new Map([...doorsPerPage].map(([k, doors]) => [k, doors.size]));

  const decisions = [];
  const skips = [];
  const why = {};
  for (const ev of evidence.values()) {
    const s = byId.get(ev.id);
    if (!s) continue;
    if (NOT_THE_SHOPS_SITE.test(hostOf(s.website)) || (ev.url && NOT_THE_SHOPS_SITE.test(hostOf(ev.url)))) {
      why['a social or listing page, not the shop\'s own site'] = (why['a social or listing page, not the shop\'s own site'] || 0) + 1;
      continue;
    }
    let d = decide(ev, s, perPage.get(pageKey(s.website)) || 1);
    // Any listing on a crawled chain's site is matched to its store page by
    // street address, whatever the first read said: a listing linking its own
    // store page may have had its hours table missed, and a page carrying this
    // listing's exact street is proof enough that the site is its own.
    if (d.skip && chainPages.has(hostOf(s.website))) {
      const c = decideChainListing(s, chainPages.get(hostOf(s.website)));
      d = c.hours ? c : { skip: `${d.skip}; ${c.skip}` };
    }
    const locked = s.claimed || s.staff_edited || s.hours_source === 'owner';
    // A picture only from a site that is plainly this shop's: a tattoo
    // studio's banner must not become a cigar shop's thumbnail.
    const image = ev.image && !s.logo_url && !s.cover_url && !NOT_THE_SHOPS_SITE.test(hostOf(ev.image)) && !GENERIC_IMAGE.test(ev.image) && mentionsShop(ev, s) ? ev.image : null;
    if (d.skip || locked) {
      why[locked ? 'owner or staff set these hours' : d.skip] = (why[locked ? 'owner or staff set these hours' : d.skip] || 0) + 1;
      if (!locked) skips.push({ id: s.id, skip: d.skip });
      if (image && !locked) decisions.push({ id: s.id, name: s.name, image });
      continue;
    }
    let prev = null;
    try { prev = s.hours ? JSON.parse(s.hours) : null; } catch {}
    decisions.push({
      id: s.id, name: s.name, address: s.address, city: s.city, state: s.state,
      hours: d.hours, kind: d.kind, url: d.url || ev.url, lines: d.lines || null, detail: d.detail || null,
      previous: prev && Object.keys(prev).length ? prev : null, previousSource: s.hours_source || (prev ? 'map' : null),
      image,
    });
    why[`hours: ${d.kind}`] = (why[`hours: ${d.kind}`] || 0) + 1;
  }
  fs.writeFileSync(out, JSON.stringify(decisions, null, 1));
  // Why each listing got none, so a browser pass (hoursRender.js) can retry
  // the ones whose sites showed nothing to a plain download.
  if (skipsOut) fs.writeFileSync(skipsOut, JSON.stringify(skips));
  const withHours = decisions.filter(d => d.hours).length;
  log(`${withHours} listings get hours, ${decisions.filter(d => d.image).length} get a picture. Decisions in ${out}`);
  for (const [k, n] of Object.entries(why).sort((a, b) => b[1] - a[1])) log(`  ${String(n).padStart(5)}  ${k}`);
  return { withHours, why };
}

/**
 * Write reviewed decisions. Guards again at write time: a listing claimed or
 * edited since the review, or given owner hours, is left alone.
 */
async function applyDecisions(file, { log = console.log } = {}) {
  const decisions = JSON.parse(fs.readFileSync(file, 'utf8'));
  const hoursRows = decisions.filter(d => d.hours).map(d => ({ id: d.id, hours: JSON.stringify(d.hours) }));
  const imageRows = decisions.filter(d => d.image).map(d => ({ id: d.id, image: d.image.replace(/^http:\/\//, 'https://') }));
  const h = hoursRows.length ? await db.get(`
    WITH x AS (SELECT * FROM json_to_recordset(?::json) AS x(id int, hours text)),
    u AS (
      UPDATE stores s SET hours = x.hours, hours_source = 'website', hours_checked_at = NOW()
      FROM x WHERE s.id = x.id AND COALESCE(s.claimed, 0) = 0 AND COALESCE(s.staff_edited, 0) = 0
        AND s.hours_source IS DISTINCT FROM 'owner'
      RETURNING s.id
    ) SELECT COUNT(*)::int AS n FROM u`, [JSON.stringify(hoursRows)]) : { n: 0 };
  const i = imageRows.length ? await db.get(`
    WITH x AS (SELECT * FROM json_to_recordset(?::json) AS x(id int, image text)),
    u AS (
      UPDATE stores s SET web_image_url = x.image
      FROM x WHERE s.id = x.id AND s.logo_url IS NULL AND s.cover_url IS NULL
      RETURNING s.id
    ) SELECT COUNT(*)::int AS n FROM u`, [JSON.stringify(imageRows)]) : { n: 0 };
  log(`wrote hours for ${h.n} listings and pictures for ${i.n}`);
  return { hours: h.n, images: i.n };
}

// ── Chains ──────────────────────────────────────────────────────────────────
//
// A chain lists every branch under one website, so the homepage cannot say
// which hours belong to which door. Most chains publish a page per store —
// Wild Bill's has 239 of them in a sitemap — and each carries that store's
// address and hours. Read those pages, and give a listing the hours of the
// page that names its street address.

const LOCATION_PATH = /\/(locations?|stores?|store-locator|shops?|branch(es)?|find-(us|a-store)|our-stores|visit|wpsl_stores)(\/|$)/i;
const NOT_A_STORE_PAGE = /\/(blog|news|posts?|articles?|events?|press|category|tag)(\/|$)/i;

async function fetchText(url, accept) {
  try {
    const res = await fetchUrl(url, { accept });
    return res && res.status < 400 ? res.body : null;
  } catch { return null; }
}

/** Every URL a site's sitemaps list, following one level of sitemap index. */
async function sitemapUrls(origin) {
  const seeds = new Set([`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`, `${origin}/wp-sitemap.xml`]);
  const robots = await fetchText(`${origin}/robots.txt`, 'text/plain');
  for (const m of String(robots || '').matchAll(/^sitemap:\s*(\S+)/gim)) seeds.add(m[1].trim());
  const urls = new Set();
  const children = [];
  for (const s of seeds) {
    const xml = await fetchText(s, 'application/xml,text/xml');
    if (!xml) continue;
    for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
      const u = decodeEntities(m[1]);
      if (/\.xml(\?|$)/i.test(u)) children.push(u); else urls.add(u);
    }
    await sleep(PAUSE_MS);
  }
  // Store sitemaps first ("wpsl_stores-sitemap.xml", "locations-sitemap.xml").
  children.sort((a, b) => Number(/wpsl|store|location|shop|branch/i.test(b)) - Number(/wpsl|store|location|shop|branch/i.test(a)));
  for (const c of children.slice(0, 8)) {
    const xml = await fetchText(c, 'application/xml,text/xml');
    for (const m of String(xml || '').matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) urls.add(decodeEntities(m[1]));
    await sleep(PAUSE_MS);
  }
  return [...urls];
}

/** What one store page says: its hours evidence and every street address on it. */
function pageEvidence(url, html) {
  const text = pageText(html);
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const addressKeys = [...new Set(lines.map(lineAddressKey).filter(Boolean))];
  const snippets = hoursSnippets(text);
  return {
    url, ok: true,
    jsonld: jsonLdBlocks(html).filter(b => /openingHours|dayOfWeek|streetAddress/i.test(b)).slice(0, 6),
    microdata: microdataHours(html),
    text: snippets.length ? [{ url, lines: snippets }] : [],
    // A store page is one shop's page: keep its words, so a later rule can
    // read them without crawling the chain again.
    allLines: lines.slice(0, 400).map(l => l.slice(0, 200)),
    addressKeys,
    image: metaImage(html, url),
  };
}

/**
 * Stores from a WP Store Locator site: the JSON its own locator page reads,
 * with each store's street and an hours table. The plugin answers at most 100
 * stores within a radius, so ask around each of our listings and pool them.
 * Returns pages in the same shape as pageEvidence, or [] for other sites.
 */
async function wpslPages(origin, points) {
  const grid = new Map();
  for (const p of points) if (p.lat && p.lng) grid.set(`${Math.round(p.lat * 2)},${Math.round(p.lng * 2)}`, p);
  const found = new Map();
  let first = true;
  for (const p of [...grid.values()].slice(0, 40)) {
    const body = await fetchText(`${origin}/wp-admin/admin-ajax.php?action=store_search&lat=${p.lat}&lng=${p.lng}&max_results=100&search_radius=100`, 'application/json');
    let list = null;
    try { list = JSON.parse(String(body || '').trim()); } catch {}
    if (!Array.isArray(list)) { if (first) return []; continue; }
    first = false;
    for (const x of list) if (x && x.id && x.address) found.set(x.id, x);
    await sleep(PAUSE_MS);
  }
  return [...found.values()].map(x => {
    let hoursLines = pageText(String(x.hours || '')).split('\n').map(l => l.trim()).filter(Boolean);
    const parsed = parseTextHours(hoursLines);
    if (parsed && locatorDefaultHours(parsed.hours)) hoursLines = [];
    const place = `${decodeEntities(String(x.city || ''))}, ${x.state || ''} ${x.zip || ''}`.trim();
    const allLines = [decodeEntities(String(x.store || '')), decodeEntities(String(x.address || '')), decodeEntities(String(x.address2 || '')), place, ...hoursLines].filter(Boolean);
    const url = x.permalink || x.url || origin;
    return {
      url, ok: true, source: 'wpsl', jsonld: [], microdata: [],
      text: hoursLines.length ? [{ url, lines: ['Hours', ...hoursLines] }] : [],
      allLines, addressKeys: [addressKey(x.address)].filter(Boolean), image: null,
    };
  });
}

/**
 * Read the store pages of every website several listings share. One line per
 * page in a JSONL file; resumes by host.
 */
async function collectChains({ out, limitHosts = 0, log = console.log } = {}) {
  if (!out) throw new Error('chains needs --out <file.jsonl>');
  const done = new Set();
  if (fs.existsSync(out)) {
    for (const line of fs.readFileSync(out, 'utf8').split('\n')) {
      try { const r = JSON.parse(line); if (r && r.host) done.add(r.host); } catch {}
    }
  }
  const stores = await db.all(`
    SELECT id, city, website, lat, lng FROM stores
    WHERE visible = 1 AND website IS NOT NULL AND website <> ''
      AND COALESCE(website_status, 'ok') IN ('ok', 'blocked')`);
  const byPage = new Map();
  for (const s of stores) {
    const k = pageKey(s.website);
    if (!byPage.has(k)) byPage.set(k, []);
    byPage.get(k).push(s);
  }
  const chains = new Map();          // host -> listings
  for (const [, list] of byPage) {
    if (list.length < 2) continue;
    const host = hostOf(list[0].website);
    if (NOT_THE_SHOPS_SITE.test(host)) continue;
    chains.set(host, (chains.get(host) || []).concat(list));
  }
  let hosts = [...chains.entries()].filter(([h]) => !done.has(h)).sort((a, b) => b[1].length - a[1].length);
  if (limitHosts) hosts = hosts.slice(0, limitHosts);
  log(`${chains.size} chain websites; reading ${hosts.length} (${done.size} already done)`);

  const stream = fs.createWriteStream(out, { flags: 'a' });
  let next = 0, pagesRead = 0;
  async function worker() {
    while (next < hosts.length) {
      const [host, listings] = hosts[next++];
      let origin = `https://${host}`;
      // A brand that now lives on its owner's site (cheaptobaccousa.com sends
      // visitors to wildbillstobacco.com) is read where it lives; its pages are
      // still filed under the host the listings link.
      try {
        const res = await fetchUrl(origin, { accept: 'text/html' });
        if (res && res.url && hostOf(res.url) !== host && !NOT_THE_SHOPS_SITE.test(hostOf(res.url))) origin = new URL(res.url).origin;
      } catch {}
      // A store-locator feed is the whole chain in one structured answer.
      const located = await wpslPages(origin, listings).catch(() => []);
      if (located.length) {
        for (const p of located) stream.write(JSON.stringify({ host, ...p }) + '\n');
        stream.write(JSON.stringify({ host, marker: true, pages: located.length, listings: listings.length, source: 'wpsl' }) + '\n');
        pagesRead += located.length;
        log(`  ${host}: ${located.length} stores from its store locator for ${listings.length} listings`);
        continue;
      }
      const citySlugs = [...new Set(listings.map(l => String(l.city || '').toLowerCase().replace(/[^a-z0-9]+/g, '-')).filter(s => s.length > 2))];
      let urls = [];
      try { urls = await sitemapUrls(origin); } catch {}
      let pages = urls.filter(u => {
        try {
          const p = new URL(u).pathname.toLowerCase();
          return !NOT_A_STORE_PAGE.test(p) && (LOCATION_PATH.test(p) || citySlugs.some(c => p.includes(c)));
        } catch { return false; }
      });
      if (!pages.length) {
        // No sitemap worth the name: follow the homepage's location links.
        const home = await fetchText(origin, 'text/html');
        if (home) {
          const links = [...String(home).matchAll(/<a[^>]+href=["']([^"'#]+)["']/gi)]
            .map(m => { try { return new URL(decodeEntities(m[1]), origin).toString(); } catch { return null; } })
            .filter(u => u && hostOf(u) === host && LOCATION_PATH.test(new URL(u).pathname));
          pages = [...new Set(links)];
        }
      }
      const cap = Math.min(300, Math.max(30, listings.length * 3));
      if (pages.length > cap) pages = pages.slice(0, cap);
      let hostPages = 0;
      for (const u of pages) {
        const html = await fetchText(u, 'text/html');
        if (html) {
          stream.write(JSON.stringify({ host, ...pageEvidence(u, html) }) + '\n');
          hostPages++;
        }
        await sleep(PAUSE_MS);
      }
      // A marker so a resumed run skips this host even if it had no pages.
      stream.write(JSON.stringify({ host, marker: true, pages: hostPages, listings: listings.length }) + '\n');
      pagesRead += hostPages;
      log(`  ${host}: ${hostPages} store pages for ${listings.length} listings`);
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  await new Promise(r => stream.end(r));
  log(`done: ${pagesRead} store pages from ${hosts.length} chains`);
  return { pagesRead, chains: hosts.length };
}

/**
 * Chain listings' hours from the store pages read above. A page that names
 * only this listing's street is this listing's page. A page naming many
 * addresses is an index, where only hours printed after this listing's own
 * address count.
 */
function decideChainListing(store, pages) {
  const key = addressKey(store.address);
  if (!key) return { skip: 'listing has no street address to match' };
  const keysOf = p => (p.allLines ? [...new Set(p.allLines.map(lineAddressKey).filter(Boolean))] : (p.addressKeys || []));
  // A street key is a number and one word, and a chain can have "1060 Main St"
  // in two towns: Cheap Tobacco's Ravenna shop is not Wild Bill's of Bowling
  // Green. The page has to name our town or ZIP as well — anywhere on a
  // store's own page, and beside the address on a page listing many.
  const town = String(store.city || '').toLowerCase();
  const zip = String(store.zip || '').slice(0, 5);
  const namesPlace = l => { const t = String(l).toLowerCase(); return (town.length > 2 && t.includes(town)) || (/^\d{5}$/.test(zip) && t.includes(zip)); };
  const inOurTown = p => {
    const lines = p.allLines;
    if (!lines) return true;
    if (keysOf(p).length <= 2) return lines.some(namesPlace);
    return lines.some((l, i) => lineAddressKey(l) === key && lines.slice(Math.max(0, i - 2), i + 4).some(namesPlace));
  };
  let mine = pages.filter(p => (keysOf(p).includes(key)
    || structuredCandidates(p).some(c => c.addressKey === key)) && inOurTown(p));
  if (!mine.length) {
    // "1160 Mount Vernon Ave" is "1160 Mt Vernon Ave" on the chain's page, and
    // "W Twelve Mile Rd" is "12 Mile Rd". The same house number on the one
    // page that also names our town is the same door.
    const num = key.split(' ')[0];
    const byNumber = pages.filter(p => keysOf(p).length <= 2 && keysOf(p).some(k => k.split(' ')[0] === num)
      && (p.allLines || []).some(namesPlace));
    if (byNumber.length === 1) mine = byNumber;
  }
  if (!mine.length) return { skip: 'no store page for this address' };
  for (const p of mine) {
    try { if (NOT_A_STORE_PAGE.test(new URL(p.url).pathname)) continue; } catch {}
    const own = keysOf(p).length <= 2;
    const d = decide(p, store, own ? 1 : 2);
    if (d.hours) return { ...d, kind: `chain-${d.kind}`, url: p.url };
  }
  return { skip: 'store page has no hours we can read' };
}

module.exports = {
  collect, collectOne, pageText, hoursSnippets, jsonLdBlocks, microdataHours, metaImage, candidateLinks,
  decide, decideAll, applyDecisions, structuredCandidates, textCandidates, phoneHours,
  mentionsShop, officeHours, officeHoursInMarkup, isDeskWeek, hostVenueHours, seasonExcludesToday, otherTownHeading,
  collectChains, sitemapUrls, pageEvidence, wpslPages, decideChainListing, pageKey, NOT_THE_SHOPS_SITE,
};

/** Decision rules on fixed evidence; no network, no database queries. */
function selfTest() {
  let pass = 0, fail = 0;
  const ok = (c, label, got) => { if (c) pass++; else { fail++; console.log('  FAIL ' + label + (got !== undefined ? '  -> ' + JSON.stringify(got) : '')); } };
  const page = (url, lines) => ({ ok: true, url, jsonld: [], microdata: [], text: [{ url, lines }] });
  const shop = { id: 1, name: 'Tower Pipes and Cigars', address: '1600 Broadway', city: 'Sacramento', zip: '95818' };

  // Two pages that agree wherever both speak are one statement.
  let d = decide({ ok: true, url: 'https://www.towercigars.com/', jsonld: [], microdata: [], text: [
    { url: 'https://www.towercigars.com/', lines: ['Tower Pipes and Cigars', 'Regular Store Hours', 'Monday-Saturday: 9am-6pm', 'Sunday: Closed'] },
    { url: 'https://www.towercigars.com/contact', lines: ['Store hours', 'Monday - Saturday', '9am-6pm'] },
  ] }, shop, 1);
  ok(d.hours && d.hours.Sun === 'Closed' && d.hours.Mon === '9am-6pm', 'pages that agree are merged', d);
  d = decide({ ok: true, url: 'https://www.towercigars.com/', jsonld: [], microdata: [], text: [
    { url: 'https://www.towercigars.com/', lines: ['Tower Pipes and Cigars', 'Store Hours', 'Monday-Saturday: 9am-6pm', 'Sunday: Closed'] },
    { url: 'https://www.towercigars.com/contact', lines: ['Store hours', 'Monday - Saturday', '9am-7pm'] },
  ] }, shop, 1);
  ok(d.skip === 'the site prints different hours in different places', 'pages that disagree are not merged', d);

  // A chain's store page: the street and the town must both be ours.
  const wb = { id: 2, name: "Wild Bill's Tobacco", address: '1060 W Main St', city: 'Ravenna', zip: '44266' };
  const bowlingGreen = { ...page('https://wildbillstobacco.com/locations/bowling-green/', ['Monday', '9:00 AM - 8:00 PM', 'Tuesday', '9:00 AM - 8:00 PM', 'Wednesday', '9:00 AM - 8:00 PM', 'Sunday', '10:00 AM - 6:00 PM']),
    allLines: ["Wild Bill's of Bowling Green", '1060 N Main St', 'Bowling Green, Ohio 43402', 'Monday', '9:00 AM - 8:00 PM', 'Tuesday', '9:00 AM - 8:00 PM', 'Wednesday', '9:00 AM - 8:00 PM', 'Sunday', '10:00 AM - 6:00 PM'] };
  d = decideChainListing(wb, [bowlingGreen]);
  ok(!d.hours, 'the same street in another town is another shop', d);
  const ravenna = { ...bowlingGreen, url: 'https://wildbillstobacco.com/locations/ravenna/', allLines: bowlingGreen.allLines.map(l => l.replace('Bowling Green, Ohio 43402', 'Ravenna, Ohio 44266').replace('1060 N Main', '1060 W Main')) };
  d = decideChainListing(wb, [bowlingGreen, ravenna]);
  ok(d.hours && d.hours.Sun === '10am-6pm' && d.url.includes('ravenna'), 'the store page in our town is ours', d);
  // "Mount Vernon" written "Mt Vernon": same number, same town, own page.
  const marion = { id: 3, name: "Wild Bill's Tobacco", address: '1160 Mount Vernon Ave', city: 'Marion', zip: '43302' };
  const mt = { ...ravenna, url: 'https://wildbillstobacco.com/locations/marion/', allLines: ["Wild Bill's of Marion", '1160 Mt Vernon Ave', 'Marion, Ohio 43302', 'Monday', '9:00 AM - 9:00 PM', 'Tuesday', '9:00 AM - 9:00 PM', 'Wednesday', '9:00 AM - 9:00 PM'],
    text: [{ url: 'https://wildbillstobacco.com/locations/marion/', lines: ['Hours', 'Monday', '9:00 AM - 9:00 PM', 'Tuesday', '9:00 AM - 9:00 PM', 'Wednesday', '9:00 AM - 9:00 PM'] }] };
  d = decideChainListing(marion, [ravenna, mt]);
  ok(d.hours && d.hours.Mon === '9am-9pm', 'a street written another way matches by number and town', d);

  // A blog post naming the town is not the store's page.
  const blog = { ...ravenna, url: 'https://wildbillstobacco.com/blog/best-tobacco-in-ravenna/' };
  d = decideChainListing(wb, [blog]);
  ok(!d.hours, 'a blog post is not a store page', d);
  d = decide(page('https://towercigars.com/', ['Tower Pipes and Cigars', 'Location: Main St', 'Hours: Open 7 days a week, 9 AM - 10 PM', 'Contact: Call us at [your contact number]']), shop, 1);
  ok(!d.hours, 'template text is not hours', d);
  ok(locatorDefaultHours({ Mon: '9am-5pm', Tue: '9am-5pm', Wed: '9am-5pm', Thu: '9am-5pm', Fri: '9am-5pm', Sat: 'Closed', Sun: 'Closed' }), 'the locator plugin default is recognised');

  // The town in the name is not the shop; a short word must stand alone.
  const den = { id: 4, name: 'Tobacco Den Brainerd', address: '603 Washington St', city: 'Brainerd' };
  d = decide(page('https://www.brainerdglass.net/', ['Custom glass shower doors', 'Business Hours', 'Mon - Thu', '7:30 am - 5:00 pm', 'Friday', '8:00 am - 12:00 pm', 'golden service']), den, 1);
  ok(d.skip === 'the site never names this shop', 'a glass company in the same town is not the shop', d);
  d = decide(page('https://tobaccoden.com/', ['Hours', 'Mon - Sat 9am - 9pm', 'Sun 10am - 6pm']), den, 1);
  ok(d.hours && d.hours.Mon === '9am-9pm', 'the shop name in the domain counts', d);
  // A blanket footer does not fill the specific block's Sunday.
  const cw = { id: 5, name: 'Cigar World', address: '735 NJ-17', city: 'Ramsey' };
  d = decide({ ok: true, url: 'https://njcigarworld.com/', jsonld: [], microdata: [], text: [
    { url: 'https://njcigarworld.com/', lines: ['Cigar World', 'Business Hours', 'Mon - Sat 10am - 9pm', 'Sun 10am - maybe'] },
    { url: 'https://njcigarworld.com/about/', lines: ['Open Daily', '10:00 am - 09:00 pm'] },
  ] }, cw, 1);
  ok(!d.hours || d.hours.Sun !== '10am-9pm', 'an open-daily footer does not fill a gap', d);

  ok(lineAddressKey('Call (201) 934-1142 or email us') === null && lineAddressKey('Open 365 days!') === null, 'a phone tail and a day count are not streets');
  ok(lineAddressKey('735 Rt 17 S, Ramsey NJ') !== null && lineAddressKey('1600 Broadway, Sacramento') === '1600 broadway', 'real streets still are');

  // ── does the site speak about this shop? ───────────────────────────────────
  const site = (url, lines) => ({ ok: true, url, jsonld: [], microdata: [], text: [{ url, lines }] });

  // The failure this rule exists for: a shop named after its town taking its
  // hours from a glass company in the same town.
  ok(!mentionsShop(site('https://brainerdglass.net/', ['Brainerd, MN', 'Mon-Fri 8-5']),
    { name: 'Tobacco Den Brainerd', city: 'Brainerd' }),
    'a glass company in the same town is not the shop');
  ok(!mentionsShop(site('https://groutmasters.com/', ['Livonia MI', 'Mon-Fri 9-5']),
    { name: 'Tobacco Master', city: 'Livonia' }),
    'and a grout company is not Tobacco Master');
  ok(!mentionsShop(site('https://oceandrivecigars.com/contact/', ['Miami Beach', 'Mon-Sun 10-10']),
    { name: 'Casillas Cigars', city: 'Miami Beach' }),
    "and another shop's site is not this shop's, however much cigar is in the domain");

  // Whole words: this is what "Ash" matching "cash" used to do.
  ok(!mentionsShop(site('https://example.com/', ['We take cash only', 'Mon-Fri 10-6']),
    { name: 'Ash Cigar Lounge', city: 'Dayton' }),
    '"Ash" does not match "cash"');
  ok(mentionsShop(site('https://example.com/', ['Welcome to Ash Cigar Lounge', 'Mon-Fri 10-6']),
    { name: 'Ash Cigar Lounge', city: 'Dayton' }),
    'but it does match "Ash"');

  // The eleven real shops the first, stricter version refused. Every one of
  // these is a shop on its own domain.
  for (const [name, city, url] of [
    ['Tampa Sweethearts Cigar Co', 'Tampa', 'https://www.tampasweethearts.com/location.aspx'],
    ['Prohibition - Private Cigar Lounge', 'Corpus Christi', 'https://prohibitioncorpus.com/'],
    ["GarVino's Cigars", 'The Villages', 'http://www.garvinos.com/'],
    ['The Cigar Room Guntersville', 'Guntersville', 'https://www.cigarroom.net/'],
    ['The Cigar Shop - Indian Trail', 'Indian Trail', 'https://www.thecigarshop.com/locations/x'],
    ['The Tobacco Shop of Ridgewood', 'Ridgewood', 'https://www.tobaccoshop.com/'],
    ['AP Cigar Co. Alton', 'Alton', 'https://www.apcigar.co/a/locations/hours'],
    ["Lefty's Tobacco East Hamilton #3", 'Hamilton', 'https://www.leftysplus.com/'],
    ['1865 Steak Seafood & Cigars', 'Washington', 'https://1865ssc.com/'],
  ]) {
    ok(mentionsShop(site(url, ['Hours', 'Mon-Fri 10-6']), { name, city }),
      `${name} is confirmed by its own domain`);
  }

  // ── a desk's week is not a shop's ─────────────────────────────────────────
  const deskWeek = { Mon: '8am-5pm', Tue: '8am-5pm', Wed: '8am-5pm', Thu: '8am-5pm', Fri: '8am-5pm' };
  const deskLines = ['+852 2652 4585', 'Our Working Hours:', 'Monday to Friday', '8:00 am - 17:00 pm (UTC -6)'];
  ok(officeHours(deskWeek, deskLines, 1, 3), 'a support desk\'s Monday-to-Friday eight-to-five is refused');
  ok(!officeHours(deskWeek, ['Store Hours', 'Monday to Friday', '8:00 am - 5:00 pm'], 0, 2),
    'but the same block under "Store Hours" is the shop\'s');
  ok(!officeHours({ ...deskWeek, Sat: '10am-4pm' }, deskLines, 1, 3),
    'and a block that includes Saturday is not a desk\'s week');
  ok(!officeHours({ Mon: '10am-7pm', Tue: '10am-7pm', Wed: '10am-7pm', Thu: '10am-7pm', Fri: '10am-7pm' }, deskLines, 1, 3),
    'nor is a ten-to-seven weekday shop');
  ok(officeHoursInMarkup(deskWeek, { text: [{ lines: deskLines }] }), 'markup stating a desk\'s week on a desk\'s page is refused too');
  ok(!officeHoursInMarkup(deskWeek, { text: [{ lines: ['Store Hours', 'Come and visit us'] }] }), 'and is not when the page talks about a shop');

  // ── the host building's hours ─────────────────────────────────────────────
  ok(hostVenueHours(['Grand Casino Hours', 'Open 24 hours', 'Mon-Sun 12am-12am'], 2, 2),
    "a casino's block is the building's hours, not the shop's");
  ok(!hostVenueHours(['We are inside the Grand Casino', 'Store Hours', 'Mon-Sat 10am-8pm'], 2, 2),
    'but a shop that says it is in a casino still has its own hours');

  // ── last season's block ───────────────────────────────────────────────────
  const july = new Date('2026-07-15T12:00:00Z'), december = new Date('2026-12-15T12:00:00Z');
  const summer = ['Summer Hours: May 1 - September 30', 'Mon-Sun 10am-9pm'];
  ok(seasonExcludesToday(summer, 1, 1, december), 'a summer schedule is refused in December');
  ok(!seasonExcludesToday(summer, 1, 1, july), 'and kept in July');
  const winter = ['Winter Hours: November - March', 'Mon-Sun 11am-6pm'];
  ok(!seasonExcludesToday(winter, 1, 1, december), 'a season that wraps the new year is inside it in December');
  ok(seasonExcludesToday(winter, 1, 1, july), 'and outside it in July');
  ok(!seasonExcludesToday(['Summer Hours', 'Mon-Sun 10am-9pm'], 1, 1, december),
    'but a season heading with no dates is left alone — plenty of shops never take it down');

  // ── another town's heading between the door and the times ─────────────────
  ok(otherTownHeading(['Palm Beach Gardens, FL', 'Hours', 'Mon-Fri 10am-9pm'], { city: 'Miami' }),
    "a sibling town's heading means the times are that town's");
  ok(!otherTownHeading(['Hours', 'Mon-Fri 10am-9pm'], { city: 'Miami' }), 'and a plain Hours heading means nothing of the kind');
  ok(!otherTownHeading(['Miami, FL', 'Hours', 'Mon-Fri 10am-9pm'], { city: 'Miami' }), 'nor does our own town');

  console.log(`hoursSweep self-test: ${pass} passed, ${fail} failed`);
  return fail === 0;
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const arg = name => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : null; };
  if (argv[0] === 'selftest') process.exit(selfTest() ? 0 : 1);
  const { initSchema, runMigrations } = require('../database/schema');
  (async () => {
    await initSchema();
    await runMigrations();
    if (argv[0] === 'collect') {
      await collect({ out: arg('--out'), limit: Number(arg('--limit')) || 0 });
    } else if (argv[0] === 'chains') {
      await collectChains({ out: arg('--out'), limitHosts: Number(arg('--limit')) || 0 });
    } else if (argv[0] === 'decide') {
      await decideAll({ from: arg('--from'), out: arg('--out'), chains: arg('--chains'), skipsOut: arg('--skips') });
    } else if (argv[0] === 'apply' && argv.includes('--confirm')) {
      await applyDecisions(arg('--from'));
    } else {
      console.error('usage: hoursSweep.js collect --out evidence.jsonl | chains --out chains.jsonl | decide --from a.jsonl[,b.jsonl] --out decisions.json [--chains chains.jsonl] [--skips skips.json] | apply --from decisions.json --confirm | selftest');
      process.exit(2);
    }
    process.exit(0);
  })().catch(err => { console.error(err); process.exit(1); });
}
