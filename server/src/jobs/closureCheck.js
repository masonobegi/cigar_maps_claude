/**
 * Closure detection for directory listings.
 *
 * Shops close. The map data does not notice for months, so a listing can sit on
 * the public map long after the doors were locked — "Broadway Cigar Company" in
 * Camas WA was still there after it shut, and a customer who drives to a dead
 * shop does not come back to us. No single signal is trustworthy on its own, so
 * three independent ones run here and each one records its own reason in plain
 * words, so staff can see why a listing was pulled and put it back in one click.
 *
 *   a) SOURCE STATUS — Overture carries operating_status per record and marks a
 *      few hundred US cigar places 'permanently_closed'. It lags, but when it
 *      does fire it is right far more often than not. Strongest free signal.
 *   b) THE SHOP'S OWN WEBSITE SAYS SO — the home page of a shop that closed
 *      usually says so in so many words. This is the only signal that is
 *      first-hand evidence, so it is worth the network cost. It is also the
 *      easiest one to get wrong: "closed Sundays" is not a closed shop, so a
 *      phrase only counts when nothing next to it turns it into an opening
 *      hours line, and an unclear page produces no verdict at all.
 *   c) NOTHING LEFT TO CONTACT — a dead website, no phone and no hours means
 *      there is no way for a customer to reach this place. Suggestive, not
 *      proof, so this one only ever produces 'likely_closed' and never hides a
 *      listing by itself.
 *
 * Rules of the road, same as the rest of the sweeps:
 *  - node built-ins only; no new dependencies
 *  - the HTTP side reuses linkCheck's hostname guard (parseWebsite rejects
 *    private/loopback/malformed hosts) and re-validates every redirect hop, so
 *    a stored "website" can never point the fetcher at our own network
 *  - a claimed listing, or one a human already ruled on (staff_edited = 1), is
 *    never touched: the owner of the shop knows better than the data does
 *  - dry run by default; nothing is written without --confirm
 *
 * CLI:
 *   node src/jobs/closureCheck.js                    # dry run, source + contact signals
 *   node src/jobs/closureCheck.js --web              # dry run, also read shop websites
 *   node src/jobs/closureCheck.js --web --confirm    # apply
 *   node src/jobs/closureCheck.js --store 10022      # explain one listing
 */
'use strict';

const https = require('https');
const http = require('http');
const { URL } = require('url');
const db = require('../database/db');
const { parseWebsite } = require('./linkCheck');

const UA = 'CigarBuddy/1.0 (+https://cigarbuddy.com; closure check)';
const TIMEOUT_MS = 10000;
const MAX_REDIRECTS = 4;
const MAX_BODY = 256 * 1024;
const OVERALL_BUDGET_MS = 25000;
const CONCURRENCY = 5;

/** website_status values that mean a customer can still reach the page. */
const LIVE_STATUSES = new Set(['ok', 'blocked']);
/** website_status values that mean the link is dead. 'blocked' is not one. */
const DEAD_STATUSES = ['dns_fail', 'not_found', 'parked', 'refused', 'timeout', 'error', 'removed'];

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Fetching a home page safely ─────────────────────────────────────────────

/**
 * Validate a URL we are about to open, including every redirect target.
 * parseWebsite is linkCheck's guard: it rejects loopback, RFC1918, CGNAT,
 * link-local, .local/.internal and anything that is not a plausible hostname.
 * Returns the URL string to fetch, or null if it must not be opened.
 */
function safeUrl(candidate) {
  let u;
  try { u = new URL(candidate); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (!parseWebsite(u.hostname)) return null;
  return u.toString();
}

/**
 * GET a page's HTML, following redirects, with a body cap and a hard deadline.
 * Returns { url, html } or null — never throws. Only text/html is returned; a
 * PDF or an image tells us nothing about whether the shop is trading.
 */
function getText(startUrl, deadline) {
  return new Promise(resolve => {
    let url = safeUrl(startUrl);
    if (!url) return resolve(null);
    let hops = 0;

    const step = () => {
      const left = deadline - Date.now();
      if (left <= 500) return resolve(null);

      let u;
      try { u = new URL(url); } catch { return resolve(null); }
      const lib = u.protocol === 'https:' ? https : http;
      let settled = false;
      const done = v => { if (!settled) { settled = true; resolve(v); } };

      const req = lib.request(u, {
        method: 'GET',
        timeout: Math.max(1000, Math.min(TIMEOUT_MS, left)),
        headers: {
          'User-Agent': UA,
          Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
          'Accept-Language': 'en-US,en;q=0.9',
          Connection: 'close',
        },
      }, res => {
        const code = res.statusCode || 0;

        if (code >= 300 && code < 400 && res.headers.location) {
          res.resume();
          if (hops++ >= MAX_REDIRECTS) return done(null);
          let next = null;
          try { next = safeUrl(new URL(res.headers.location, url).toString()); } catch { next = null; }
          if (!next) return done(null);
          url = next;
          // Retire this request's handlers before moving on, so a late error or
          // close event from the socket we just abandoned cannot resolve the
          // promise out from under the hop we are about to make.
          settled = true;
          return step();
        }
        if (code < 200 || code >= 300) { res.resume(); return done(null); }

        const type = String(res.headers['content-type'] || '').toLowerCase();
        if (type && !type.includes('html') && !type.includes('text/plain') && !type.includes('xml')) {
          res.resume();
          return done(null);
        }

        let size = 0;
        const chunks = [];
        const finish = () => done({ url, html: Buffer.concat(chunks).toString('utf8') });
        res.on('data', d => {
          size += d.length;
          if (size > MAX_BODY) {
            chunks.push(d.slice(0, Math.max(0, MAX_BODY - (size - d.length))));
            res.destroy();
            finish();
            return;
          }
          chunks.push(d);
        });
        res.on('end', finish);
        res.on('close', () => { if (chunks.length) finish(); else done(null); });
        res.on('error', () => done(null));
      });

      req.on('timeout', () => req.destroy());
      req.on('error', () => done(null));
      req.end();
    };

    step();
  });
}

// ── HTML → the words a visitor actually sees ────────────────────────────────

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"', mdash: '-', ndash: '-',
  hellip: '...', reg: '', copy: '', trade: '', deg: '', eacute: 'e',
};

function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return ' '; } })
    .replace(/&#(\d+);/g, (_, d) => { try { return String.fromCodePoint(Number(d)); } catch { return ' '; } })
    .replace(/&([a-z]+);/gi, (m, name) => {
      const v = ENTITIES[name.toLowerCase()];
      return v === undefined ? ' ' : v;
    });
}

/**
 * Strip a page down to its visible text, lower-cased and flattened. Scripts and
 * styles go: a JSON-LD block carries openingHours and would poison every check
 * below. Curly quotes are straightened so "we've" matches whichever apostrophe
 * the shop's web designer happened to use.
 */
function visibleText(html) {
  let t = String(html || '');
  t = t.replace(/<!--[\s\S]*?-->/g, ' ');
  t = t.replace(/<(script|style|svg|iframe|canvas|template)\b[\s\S]*?<\/\1\s*>/gi, ' ');
  t = t.replace(/<(script|style|svg|iframe)\b[^>]*\/?>/gi, ' ');
  t = t.replace(/<\/?(br|p|div|li|tr|td|h[1-6]|section|header|footer|span)\b[^>]*>/gi, ' \n ');
  t = t.replace(/<[^>]+>/g, ' ');
  t = decodeEntities(t);
  t = t.replace(/[‘’ʼ′]/g, "'").replace(/[“”]/g, '"');
  t = t.replace(/[–—]/g, '-').replace(/ /g, ' ');
  return t.replace(/\s+/g, ' ').trim().toLowerCase();
}

// ── Closure language ────────────────────────────────────────────────────────

// Phrases that mean the shop is gone. dayProof marks the ones that survive a
// day name sitting next to them: "permanently closed" never means Tuesday,
// while "now closed" very often does ("now closed Mondays").
const STRONG = [
  { re: /\bpermanently\s+closed\b/, dayProof: true },
  { re: /\bclosed\s+permanently\b/, dayProof: true },
  { re: /\bclos(?:ing|ed)\s+(?:our|its|their|the)\s+doors\b/, dayProof: true },
  { re: /\b(?:last|final)\s+day\s+of\s+(?:business|operation|operations|trading|service)\b/, dayProof: true },
  { re: /\bno\s+longer\s+(?:in\s+business|operating|open\s+for\s+business|open\s+to\s+the\s+public)\b/, dayProof: true },
  { re: /\bceas(?:ed|ing)\s+(?:all\s+)?(?:operations?|trading|business)\b/, dayProof: true },
  { re: /\bclosed\s+for\s+good\b/, dayProof: true },
  { re: /\b(?:going|went|gone)\s+out\s+of\s+business\b/, dayProof: true },
  { re: /\bout\s+of\s+business\b/, dayProof: true },
  { re: /\bhas\s+shut\s+(?:down|its\s+doors)\b/, dayProof: true },
  { re: /\bwill\s+not\s+be\s+re-?open(?:ing)?\b/, dayProof: true },
  { re: /\bafter\s+\d+\+?\s+(?:\w+\s+){0,2}years\b[^.!?]{0,80}\bclos(?:e|ed|ing)\b/, dayProof: true },
  { re: /\bthank\s+you\s+(?:all\s+)?for\s+(?:the\s+)?\d+\+?\s+(?:wonderful|amazing|great|incredible|fantastic|memorable|beautiful|good)\s+years\b/, dayProof: true },
  // Real closure language, but also how a shop announces dropping a weekday.
  { re: /\bwe\s+have\s+closed\b/, dayProof: false },
  { re: /\bwe've\s+closed\b/, dayProof: false },
  { re: /\b(?:is|are|we're|we\s+are)\s+now\s+closed\b/, dayProof: false },
  { re: /\bnow\s+closed\b/, dayProof: false },
  { re: /\b(?:store|shop|lounge|location|business)\s+(?:has|have)\s+closed\b/, dayProof: false },
  { re: /\bfinal\s+day\b[^.!?]{0,40}\bclos/, dayProof: false },
];

// Phrases that only mean closure with corroboration next to them. "we are
// closed" on its own is almost always about a Tuesday.
const WEAK = [
  { re: /\bwe\s+are\s+closed\b/, dayProof: false },
  { re: /\bwe're\s+closed\b/, dayProof: false },
  { re: /\b(?:final|last)\s+day\b/, dayProof: false },
  { re: /\bthis\s+(?:location|store|shop)\s+is\s+closed\b/, dayProof: false },
];

const STRENGTHENER = /\b(?:permanent(?:ly)?|for\s+good|forever|out\s+of\s+business|no\s+longer|our\s+doors|its\s+doors|retir(?:ing|ement|ed)|final\s+day|last\s+day|after\s+\d+\+?\s+years|thank\s+you\s+for\s+(?:the\s+)?\d+|ceased|liquidat(?:ion|ing)|going\s+out)\b/;

// Anything here inside the window turns the match into an opening-hours line, a
// holiday note or a temporary shutter — none of which is a closed business.
const DAY_WORDS = /\b(?:mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?|sundays?|weekends?|weekdays?|holidays?|christmas|thanksgiving|new\s+year|easter|memorial\s+day|labor\s+day|independence\s+day|veterans\s+day|4th\s+of\s+july|july\s+4)\b/;
const TEMPORARY = /\b(?:temporar(?:y|ily)|until\s+further\s+notice|for\s+the\s+(?:day|evening|night|season|holidays?|week|weekend|time\s+being)|for\s+(?:renovation|remodel(?:ing)?|maintenance|repairs?|lunch|inventory|vacation|a\s+private\s+event|the\s+winter|the\s+summer)|be\s+closed|will\s+be\s+closed|are\s+closed\s+today|closed\s+today|re-?open(?:s|ing|ed)?\s+(?:on|at|tomorrow|monday|soon)|back\s+(?:on|at|soon)|see\s+you\s+(?:tomorrow|soon))\b/;
// An hours table: "sun 12 - 5", "10:00 am - 7:00 pm", "mon-fri".
const HOURS_SHAPE = /\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\b|\b(?:mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat|sun)\.?\s*[-–:]\s*|\bopening\s+hours\b|\bhours\s+of\s+operation\b|\bbusiness\s+hours\b/;
// The shop denying it, or talking about someone else's closure.
const NEGATION = /\b(?:not\s+(?:permanently\s+)?clos(?:ed|ing)|never\s+closed|are\s+we\s+closed|is\s+not\s+closed|no\s+longer\s+closed|not\s+out\s+of\s+business)\b/;
// A page whose subject is somebody else. "cigar shops that have closed" is a
// blog post, not this shop's obituary.
const THIRD_PARTY = /\b(?:report(?:ed|s)?\s+(?:as\s+)?closed|marked\s+(?:as\s+)?(?:permanently\s+)?closed|has\s+this\s+(?:place|business)\s+closed|suggest\s+an\s+edit|claim\s+this\s+business)\b/;

// Hosts that are somebody else's page. A listing's "website" is often an
// Eventbrite link, a Facebook page or a directory entry, and a closure notice
// there is about that page, not about the shop. OC Cigar Lounge in Woodbridge
// VA is listed with an Eventbrite URL reading "online ticket sales are now
// closed" while the lounge trades happily; believing that would delete it.
const NOT_THE_SHOPS_OWN_SITE = /(?:^|\.)(?:eventbrite\.[a-z.]+|facebook\.com|fb\.me|instagram\.com|twitter\.com|x\.com|tiktok\.com|yelp\.[a-z.]+|yahoo\.com|google\.[a-z.]+|business\.site|mapquest\.com|foursquare\.com|tripadvisor\.[a-z.]+|linktr\.ee|linkedin\.com|youtube\.com|opentable\.com|square\.site|toasttab\.com|doordash\.com|ubereats\.com|grubhub\.com|cigarplaces\.com|yellowpages\.com|bbb\.org|proxibid\.com|eventful\.com|meetup\.com|patch\.com)$/i;

/** True when the URL belongs to a platform rather than to the shop itself. */
function isThirdPartyHost(host) {
  return NOT_THE_SHOPS_OWN_SITE.test(String(host || '').replace(/^www\./, ''));
}

// A closure sentence about something other than the business: ticket sales,
// registration, a waitlist, submissions. Common on event pages.
const CLOSED_THING_IS_NOT_THE_SHOP = /\b(?:ticket|tickets|ticketing|sales|registration|registrations|sign-?ups?|entries|submissions|applications|rsvps?|waitlist|voting|nominations|bookings?|reservations|the\s+raffle|the\s+contest|the\s+giveaway|comments)\b/;

const WINDOW_BEFORE = 90;
const WINDOW_AFTER = 110;

function windowAround(text, index, length) {
  return text.slice(Math.max(0, index - WINDOW_BEFORE), Math.min(text.length, index + length + WINDOW_AFTER));
}

/**
 * Is this particular occurrence explained away by what surrounds it?
 *
 * Two tiers. A negation, a third-party listing widget or temporary language
 * ("closed for renovation", "reopens Monday") kills any match. A day name or an
 * hours table only kills the phrases that a shop also uses to announce dropping
 * a weekday — "permanently closed" next to a Sunday still means closed.
 */
function disqualified(win, dayProof) {
  if (NEGATION.test(win) || THIRD_PARTY.test(win) || TEMPORARY.test(win)) return true;
  // "Online ticket sales are now closed" says nothing about the shop.
  if (CLOSED_THING_IS_NOT_THE_SHOP.test(win)) return true;
  if (!dayProof && (DAY_WORDS.test(win) || HOURS_SHAPE.test(win))) return true;
  return false;
}

/** Every occurrence of a phrase, not just the first: the first one is often in
 *  the hours block and the real announcement is further down the page. */
function eachMatch(re, text, fn) {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  let m;
  while ((m = g.exec(text)) !== null) {
    if (fn(m) === true) return true;
    if (m.index === g.lastIndex) g.lastIndex++;    // zero-width safety
  }
  return false;
}

/**
 * Read closure language out of a page's visible text.
 * Returns { closed, phrase } — or null when the page says too little to judge.
 */
function readClosureText(text) {
  const t = String(text || '');
  // A JavaScript shell with no words in it is not evidence of anything.
  if (t.replace(/[^a-z]/g, '').length < 120) return null;

  let hit = null;
  const scan = (list, needsStrengthener) => {
    for (const { re, dayProof } of list) {
      const found = eachMatch(re, t, m => {
        const win = windowAround(t, m.index, m[0].length);
        if (disqualified(win, dayProof)) return false;
        if (needsStrengthener && !STRENGTHENER.test(win)) return false;
        hit = m[0].trim().slice(0, 120);
        return true;
      });
      if (found) return true;
    }
    return false;
  };

  if (scan(STRONG, false) || scan(WEAK, true)) return { closed: true, phrase: hit };
  return { closed: false, phrase: null };
}

/**
 * Fetch a shop's home page and decide whether it announces a closure.
 *
 * Returns { closed: boolean, phrase: string|null } when the page could be read,
 * and null when it could not — an unreachable host, a redirect we refused to
 * follow, a non-HTML body, or a page with too little text to mean anything.
 * Null is "no opinion", never "still open".
 */
async function checkWebsiteForClosure(website) {
  const parsed = parseWebsite(website);
  if (!parsed) return null;
  // Only the shop's own site can testify about the shop.
  if (isThirdPartyHost(parsed.host)) return null;

  const deadline = Date.now() + OVERALL_BUDGET_MS;
  let page = await getText('https://' + parsed.host + parsed.path, deadline);
  if (!page && Date.now() < deadline - 1000) {
    page = await getText('http://' + parsed.host + parsed.path, deadline);
  }
  if (!page || !page.html) return null;

  return readClosureText(visibleText(page.html));
}

// ── Reasons, in plain words ─────────────────────────────────────────────────

const REASON_SOURCE = 'map data marks this place permanently closed';
const reasonWeb = phrase => `the shop's own website says so: "${phrase}"`;
const reasonUnreachable = status => `no way left to contact it: website is ${status}, no phone, no opening hours`;

/** The stable half of a reason, for grouping in the admin queue. */
function reasonKey(reason) {
  const r = String(reason || '').trim();
  if (!r) return 'no reason recorded';
  return r.split(':')[0].trim().slice(0, 80);
}

// ── Which listings are we allowed to touch ──────────────────────────────────

// Claimed shops and rows a human already ruled on are off limits, always.
const TOUCHABLE = 'claimed = 0 AND COALESCE(staff_edited, 0) = 0';
const NO_HOURS = "(hours IS NULL OR hours = '' OR hours = '{}' OR hours = '[]' OR hours = 'null') " +
                 "AND (hours_raw IS NULL OR hours_raw = '')";
const NO_PHONE = "(phone IS NULL OR phone = '')";
const HAS_SITE = "(website IS NOT NULL AND website <> '')";

const SELECT_COLS = `id, name, city, state, website, website_status, phone, hours, hours_raw,
                     visible, claimed, operating_status, closed_reason, storefront, confidence`;

function toItem(row, signal, reason, extra = {}) {
  return {
    id: row.id,
    name: row.name,
    city: row.city || null,
    state: row.state || null,
    website: row.website || null,
    website_status: row.website_status || null,
    phone: row.phone || null,
    visible: row.visible,
    signal,
    reason,
    ...extra,
  };
}

// ── The sweep ───────────────────────────────────────────────────────────────

/**
 * Look for closed shops. Reads only — nothing is written here.
 *
 * limit  caps each signal's candidate list independently, so a run with
 *        limit 300 looks at up to 300 rows per signal.
 * useWeb turns on signal (b), the only one that touches the network.
 *
 * Returns { closed, likely, counts, checkedIds }. 'closed' is safe to hide;
 * 'likely' is a flag for staff and never hides anything on its own; checkedIds
 * is every listing whose website was actually read this run.
 */
async function findClosures({ limit = 500, useWeb = false, log = console.log } = {}) {
  const take = Math.max(1, Math.min(Math.floor(Number(limit)) || 500, 5000));
  const t0 = Date.now();

  const closed = [];
  const likely = [];
  let checkedIds = [];
  const counts = {
    examined: 0,
    source_closed: 0,
    source_closed_total: 0,
    web_checked: 0,
    web_closed: 0,
    web_unreadable: 0,
    likely_unreachable: 0,
    closed: 0,
    likely: 0,
  };

  // (a) SOURCE STATUS — the cheapest and strongest. Only rows still on the map
  // need acting on, but the total is reported so staff can see the whole pile.
  const srcTotal = await db.get(
    `SELECT COUNT(*)::int AS n FROM stores WHERE operating_status = 'permanently_closed' AND ${TOUCHABLE}`);
  counts.source_closed_total = Number(srcTotal?.n) || 0;

  const srcRows = await db.all(`
    SELECT ${SELECT_COLS} FROM stores
    WHERE operating_status = 'permanently_closed' AND visible = 1 AND ${TOUCHABLE}
    ORDER BY confidence DESC, id
    LIMIT ?
  `, [take]);
  counts.examined += srcRows.length;
  counts.source_closed = srcRows.length;
  const flagged = new Set();
  for (const row of srcRows) {
    closed.push(toItem(row, 'source', REASON_SOURCE));
    flagged.add(row.id);
  }

  // (c) NOTHING LEFT TO CONTACT — weak, so it only ever produces 'likely'.
  const deadList = DEAD_STATUSES.map(() => '?').join(', ');
  const contactRows = await db.all(`
    SELECT ${SELECT_COLS} FROM stores
    WHERE visible = 1 AND ${TOUCHABLE}
      AND ${HAS_SITE} AND website_status IN (${deadList})
      AND ${NO_PHONE} AND ${NO_HOURS}
      AND (operating_status IS NULL OR operating_status <> 'permanently_closed')
    ORDER BY confidence DESC, id
    LIMIT ?
  `, [...DEAD_STATUSES, take]);
  counts.examined += contactRows.length;
  for (const row of contactRows) {
    if (flagged.has(row.id)) continue;
    likely.push(toItem(row, 'unreachable', reasonUnreachable(row.website_status)));
    flagged.add(row.id);
  }
  counts.likely_unreachable = likely.length;

  // (b) THE SHOP'S OWN WEBSITE — the expensive one, so it is opt-in and it
  // works oldest-check-first so repeated runs walk the whole directory.
  if (useWeb) {
    const liveList = [...LIVE_STATUSES];
    const webRows = await db.all(`
      SELECT ${SELECT_COLS} FROM stores
      WHERE visible = 1 AND ${TOUCHABLE}
        AND ${HAS_SITE} AND website_status IN (${liveList.map(() => '?').join(', ')})
        AND (operating_status IS NULL OR operating_status <> 'permanently_closed')
      ORDER BY closure_checked_at ASC NULLS FIRST, confidence DESC, id
      LIMIT ?
    `, [...liveList, take]);
    counts.examined += webRows.length;

    // One worker per host at a time: several listings can share a website.
    let next = 0;
    const worker = async () => {
      for (;;) {
        const row = webRows[next++];
        if (!row) return;
        let verdict = null;
        try {
          verdict = await checkWebsiteForClosure(row.website);
        } catch {
          verdict = null;                                  // never let one bad page stop the sweep
        }
        counts.web_checked++;
        row._webChecked = true;
        if (!verdict) { counts.web_unreadable++; continue; }
        if (!verdict.closed) continue;
        counts.web_closed++;
        if (flagged.has(row.id)) continue;
        closed.push(toItem(row, 'website', reasonWeb(verdict.phrase), { phrase: verdict.phrase }));
        flagged.add(row.id);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, webRows.length || 1) }, worker));
    // Which rows were actually read, so applyClosures can stamp them as checked
    // and the next run moves on to different listings. Kept out of counts: that
    // object is handed straight to API callers.
    checkedIds = webRows.filter(r => r._webChecked).map(r => r.id);
  }

  counts.closed = closed.length;
  counts.likely = likely.length;
  counts.seconds = Math.round((Date.now() - t0) / 1000);

  log(`[closures] examined ${counts.examined} listings in ${counts.seconds}s — ` +
      `${counts.closed} closed (${counts.source_closed} source, ${counts.web_closed} website), ` +
      `${counts.likely} likely (no contact route)`);
  return { closed, likely, counts, checkedIds };
}

// ── Writing it down ─────────────────────────────────────────────────────────

let running = false;

/**
 * Run findClosures and, with confirm, record the verdicts.
 *
 * Confirmed closures are hidden from the public map (visible = 0,
 * storefront = 'closed'). 'likely' rows are flagged only — they stay visible
 * until a human agrees, because a shop with a lapsed domain and an unlisted
 * number is often still trading.
 *
 * staff_edited is deliberately NOT set here: this is the machine's opinion, and
 * the admin queue's confirm/reopen buttons are what make a decision final.
 */
async function applyClosures({ confirm = false, limit = 500, useWeb = false, log = console.log, found = null } = {}) {
  if (running) { log('[closures] a sweep is already running, skipping'); return { skipped: true }; }
  running = true;
  try {
    const result = found || await findClosures({ limit, useWeb, log });
    const { closed, likely, counts, checkedIds } = result;

    if (!confirm) {
      log(`\nwould hide ${closed.length}:`);
      const byReason = {};
      for (const c of closed) byReason[reasonKey(c.reason)] = (byReason[reasonKey(c.reason)] || 0) + 1;
      for (const [k, v] of Object.entries(byReason).sort((a, b) => b[1] - a[1])) log(`  ${String(v).padStart(4)}  ${k}`);
      for (const c of closed.slice(0, 20)) {
        log(`  #${c.id} ${c.name} (${c.city || '?'}, ${c.state || '?'}) — ${c.reason}`);
      }
      log(`\nwould flag ${likely.length} as likely closed (still visible):`);
      for (const l of likely.slice(0, 10)) {
        log(`  #${l.id} ${l.name} (${l.city || '?'}, ${l.state || '?'}) — ${l.reason}`);
      }
      log('\nDry run. Nothing changed. Re-run with --confirm to apply.');
      return { dryRun: true, counts, would_hide: closed.length, would_flag: likely.length };
    }

    let hidden = 0, flagged = 0;
    for (const c of closed) {
      const r = await db.run(`
        UPDATE stores
        SET operating_status = 'permanently_closed',
            closed_reason = ?, closed_at = COALESCE(closed_at, NOW()), closure_checked_at = NOW(),
            storefront = 'closed', storefront_reason = ?, storefront_checked_at = NOW(),
            visible = 0
        WHERE id = ? AND ${TOUCHABLE}
      `, [c.reason.slice(0, 300), c.reason.slice(0, 300), c.id]);
      if (r.changes) hidden++;
    }
    for (const l of likely) {
      const r = await db.run(`
        UPDATE stores
        SET operating_status = 'likely_closed', closed_reason = ?, closure_checked_at = NOW()
        WHERE id = ? AND ${TOUCHABLE}
      `, [l.reason.slice(0, 300), l.id]);
      if (r.changes) flagged++;
    }
    // Stamp every website we actually read, closed or not, so the next web pass
    // starts on listings this one never got to.
    const readIds = checkedIds || [];
    for (let i = 0; i < readIds.length; i += 200) {
      const chunk = readIds.slice(i, i + 200);
      await db.run(
        `UPDATE stores SET closure_checked_at = NOW() WHERE id IN (${chunk.map(() => '?').join(', ')}) AND ${TOUCHABLE}`,
        chunk);
    }

    const left = await db.get('SELECT COUNT(*)::int AS n FROM stores WHERE visible = 1');
    log(`[closures] hid ${hidden}, flagged ${flagged} as likely. ${left.n} listings remain on the public map.`);
    return { counts, hidden, flagged, remaining: Number(left.n) || 0 };
  } finally {
    running = false;
  }
}

/** Explain one listing: every signal, whether or not it fires. */
async function checkStore(id, { confirm = false, log = console.log } = {}) {
  const row = await db.get(`SELECT ${SELECT_COLS}, staff_edited FROM stores WHERE id = ?`, [id]);
  if (!row) return { error: 'store not found' };

  const signals = [];
  if (row.operating_status === 'permanently_closed') signals.push({ signal: 'source', reason: REASON_SOURCE });

  let web = null;
  if (row.website) {
    web = await checkWebsiteForClosure(row.website);
    if (web && web.closed) signals.push({ signal: 'website', reason: reasonWeb(web.phrase) });
  }

  const noPhone = !row.phone;
  const noHours = !row.hours || ['{}', '[]', 'null'].includes(String(row.hours).trim());
  const deadSite = !!row.website && DEAD_STATUSES.includes(row.website_status);
  if (deadSite && noPhone && noHours) signals.push({ signal: 'unreachable', reason: reasonUnreachable(row.website_status), weak: true });

  const out = {
    id: row.id, name: row.name, city: row.city, state: row.state,
    website: row.website, website_status: row.website_status, phone: row.phone || null,
    visible: row.visible, claimed: row.claimed, staff_edited: row.staff_edited || 0,
    operating_status: row.operating_status || null,
    website_verdict: web,
    signals,
    verdict: signals.some(s => !s.weak) ? 'closed' : (signals.length ? 'likely_closed' : 'no evidence of closure'),
  };

  if (confirm && signals.length && !row.claimed && !row.staff_edited) {
    const strong = signals.find(s => !s.weak);
    await applyClosures({
      confirm: true, log,
      found: {
        closed: strong ? [toItem(row, strong.signal, strong.reason)] : [],
        likely: strong ? [] : [toItem(row, signals[0].signal, signals[0].reason)],
        counts: {},
      },
    });
    out.applied = true;
  }
  return out;
}

// ── Boot hook ───────────────────────────────────────────────────────────────

/**
 * Called from index.js on boot. Quiet in dev with DISABLE_CLOSURE_CHECK=1.
 *
 * Ten minutes in, the free pass runs: source status plus the no-contact flag,
 * no network at all. After that a small website pass every 24 hours, which over
 * weeks walks the whole directory without ever hammering anyone's server.
 */
function runStartupClosureCheck({ log = console.log } = {}) {
  if (process.env.DISABLE_CLOSURE_CHECK === '1') return;
  setTimeout(() => {
    applyClosures({ confirm: true, limit: 1000, useWeb: false, log })
      .catch(err => log('[closures] startup sweep failed: ' + err.message));
    setInterval(() => {
      applyClosures({ confirm: true, limit: 200, useWeb: true, log })
        .catch(err => log('[closures] web sweep failed: ' + err.message));
    }, 24 * 60 * 60 * 1000);
  }, 10 * 60 * 1000);
}

module.exports = {
  checkWebsiteForClosure, readClosureText, visibleText,
  findClosures, applyClosures, checkStore, runStartupClosureCheck,
  reasonKey, DEAD_STATUSES, LIVE_STATUSES,
};

// ── CLI ─────────────────────────────────────────────────────────────────────

if (require.main === module) {
  const argv = process.argv.slice(2);
  const arg = name => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
  };
  const confirm = argv.includes('--confirm');
  const useWeb = argv.includes('--web');
  const limit = Number(arg('--limit')) || 500;
  const storeId = arg('--store');
  const url = arg('--url');
  const { initSchema, runMigrations } = require('../database/schema');

  (async () => {
    // --url needs no database at all: it is the phrase detector on one page.
    if (url) {
      console.log(JSON.stringify({ url, verdict: await checkWebsiteForClosure(url) }, null, 2));
      process.exit(0);
    }
    await initSchema();
    await runMigrations();
    if (storeId) {
      console.log(JSON.stringify(await checkStore(Number(storeId), { confirm }), null, 2));
    } else {
      await applyClosures({ confirm, limit, useWeb });
    }
    process.exit(0);
  })().catch(err => { console.error(err); process.exit(1); });
}
