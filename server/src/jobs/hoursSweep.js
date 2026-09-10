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
 *       node src/jobs/hoursSweep.js decide  --from evidence.jsonl --out decisions.json   # review this
 *       node src/jobs/hoursSweep.js apply   --from decisions.json --confirm
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
    const heading = /\b(hours|store hours|opening hours|business hours|hours of operation|lounge hours)\b/i.test(l) && l.length < 80;
    if (dayAndTime || heading) for (let j = Math.max(0, i - 1); j <= Math.min(lines.length - 1, i + (heading ? 9 : 1)); j++) keep.add(j);
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
const PHONE_CONTEXT = /\b(call(s|ing)?( us)?|phone|customer (service|care|support)|support|whatsapp|office hours|order(s|ing)?|shipping|ships?|online|live chat|chat with|e-?mail|text us|representatives?|mail order|warehouse|pick-?up)\b/i;
const TIME_ZONE = /\b(e[sd]t|c[sd]t|m[sd]t|p[sd]t|eastern|central|pacific|mountain|easter time)\b/i;
const STORE_CONTEXT = /\b(store|shop|lounge|showroom|walk-?in|retail) hours\b|\bhours of operation\b|\bvisit us\b/i;
const ADDRESS_IN_LINE = /\b(\d{2,6})\s+((?:[NSEW]\.?\s+)?[A-Za-z0-9'.]+(?:\s+[A-Za-z0-9'.]+){0,4})/;

function lineAddressKey(line) {
  const m = String(line || '').match(ADDRESS_IN_LINE);
  return m ? addressKey(m[0]) : null;
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

/** Every opening-hours statement in the site's markup, with the address it belongs to. */
function structuredCandidates(ev) {
  const out = [];
  const seen = new Set();
  const push = (hours, street, kind) => {
    if (!hours || !describe(hours).open) return;
    const key = street ? addressKey(street) : null;
    const sig = JSON.stringify(hours) + '|' + key;
    if (seen.has(sig)) return;
    seen.add(sig);
    out.push({ hours, addressKey: key, street: street || null, kind });
  };
  for (const raw of ev.jsonld || []) {
    const data = parseLd(raw);
    const visit = node => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) return node.forEach(visit);
      let hours = null;
      if (node.openingHoursSpecification) hours = parseSpecification(node.openingHoursSpecification);
      if (!hours && node.openingHours) hours = fillClosedPerSpec(parseOpeningHoursString(node.openingHours));
      if (hours) {
        const a = node.address;
        push(hours, a ? (typeof a === 'string' ? a : a.streetAddress) : null, 'markup');
      }
      for (const [k, v] of Object.entries(node)) if (k !== 'openingHoursSpecification' && v && typeof v === 'object') visit(v);
    };
    visit(data);
  }
  for (const m of ev.microdata || []) push(fillClosedPerSpec(parseOpeningHoursString(m)), null, 'microdata');
  return out;
}

/** Does the text around these lines say they are phone or web-shop hours? */
function phoneHours(lines, from, to) {
  const window = lines.slice(Math.max(0, from - 2), Math.min(lines.length, to + 2)).join(' ');
  if (STORE_CONTEXT.test(window)) return false;
  return PHONE_CONTEXT.test(window) || TIME_ZONE.test(window);
}

/** Hours printed on the site's pages, anchored to this listing where possible. */
function textCandidates(ev, store) {
  const anchored = [], loose = [];
  const key = addressKey(store.address);
  for (const block of ev.text || []) {
    const lines = block.lines || [];
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
        if (r && describe(r.hours).days >= 3 && describe(r.hours).open && !phoneHours(lines, at + 1, at + 1 + seg.length)) {
          anchored.push({ hours: r.hours, kind: 'text-at-address', url: block.url, lines: [lines[at], ...seg] });
        }
      }
    }
    // 2. A page with one shop's hours on it.
    const addresses = new Set(lines.map(lineAddressKey).filter(Boolean));
    if (addresses.size > 1) continue;              // a locations page: only an anchor can be trusted
    const hoursLines = lines.map((l, i) => (parseTextHours([l]) ? i : -1)).filter(i => i >= 0);
    if (!hoursLines.length) continue;
    const from = hoursLines[0], to = hoursLines[hoursLines.length - 1];
    const r = parseTextHours(lines.slice(Math.max(0, from - 1), to + 1));
    if (!r || describe(r.hours).days < 3 || !describe(r.hours).open) continue;
    if (phoneHours(lines, from, to)) continue;
    loose.push({ hours: r.hours, kind: 'text', url: block.url, lines: lines.slice(Math.max(0, from - 2), to + 2) });
  }
  return { anchored, loose };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The hours to believe for one listing, or why none are.
 * `siblings` is how many public listings share this website: on a chain's
 * site, only hours tied to this listing's address count.
 */
function decide(ev, store, siblings) {
  if (!ev || !ev.ok) return { skip: 'site unreachable' };
  const structured = structuredCandidates(ev);
  const key = addressKey(store.address);

  const atAddress = structured.filter(c => c.addressKey && key && c.addressKey === key);
  if (atAddress.length) return { hours: atAddress[0].hours, kind: 'markup-at-address', detail: atAddress[0].street };

  const unaddressed = structured.filter(c => !c.addressKey);
  const addressedElsewhere = structured.filter(c => c.addressKey && c.addressKey !== key);
  if (siblings <= 1 && structured.length) {
    const distinct = structured.filter((c, i, a) => a.findIndex(x => same(x.hours, c.hours)) === i);
    if (distinct.length === 1) return { hours: distinct[0].hours, kind: structured[0].kind };
    if (unaddressed.length === 1 && !addressedElsewhere.length) return { hours: unaddressed[0].hours, kind: unaddressed[0].kind };
  }

  const { anchored, loose } = textCandidates(ev, store);
  if (anchored.length) return { hours: anchored[0].hours, kind: anchored[0].kind, url: anchored[0].url, lines: anchored[0].lines };
  if (siblings > 1) return { skip: addressedElsewhere.length ? 'chain site: no hours for this address' : 'chain site: hours not tied to an address' };
  if (!loose.length) return { skip: structured.length ? 'markup disagrees with itself' : 'no hours found' };
  const distinct = loose.filter((c, i, a) => a.findIndex(x => same(x.hours, c.hours)) === i);
  if (distinct.length > 1) return { skip: 'the site prints different hours in different places' };
  return { hours: distinct[0].hours, kind: 'text', url: distinct[0].url, lines: distinct[0].lines };
}

// Not the shop's own site: a profile or listing on someone else's platform.
// Nothing there is the shop speaking for itself, and most of it sits behind a
// login or terms that forbid reading it.
const NOT_THE_SHOPS_SITE = /(^|\.)(facebook\.com|fb\.me|instagram\.com|linktr\.ee|yelp\.[a-z.]+|google\.[a-z.]+|business\.site|tripadvisor\.[a-z.]+|foursquare\.com|mapquest\.com|yellowpages\.com|bbb\.org|twitter\.com|x\.com|tiktok\.com|youtube\.com|eventbrite\.[a-z.]+|nextdoor\.com|findsmokeshop\.com|cigarplaces\.com)$/i;

/** A website as a place: host and path, so a chain's location page is its own. */
function pageKey(website) {
  return String(website || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '')
    .replace(/[?#].*$/, '').replace(/\/+$/, '');
}

/** Read saved evidence and write the decisions a person reviews before applying. */
async function decideAll({ from, out, log = console.log } = {}) {
  if (!from || !fs.existsSync(from)) throw new Error('decide needs --from evidence.jsonl');
  const stores = await db.all(`
    SELECT id, name, address, city, state, website, claimed, staff_edited, hours, hours_source,
           logo_url, cover_url, web_image_url
    FROM stores WHERE visible = 1 AND website IS NOT NULL AND website <> ''`);
  const byId = new Map(stores.map(s => [s.id, s]));
  // Listings that point at the very same page share it; a chain listing that
  // links its own location page (".../locations/boca-raton") stands alone.
  const perPage = new Map();
  for (const s of stores) { const k = pageKey(s.website); perPage.set(k, (perPage.get(k) || 0) + 1); }

  const decisions = [];
  const why = {};
  for (const line of fs.readFileSync(from, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let ev; try { ev = JSON.parse(line); } catch { continue; }
    const s = byId.get(ev.id);
    if (!s) continue;
    if (NOT_THE_SHOPS_SITE.test(hostOf(s.website)) || (ev.url && NOT_THE_SHOPS_SITE.test(hostOf(ev.url)))) {
      why['a social or listing page, not the shop\'s own site'] = (why['a social or listing page, not the shop\'s own site'] || 0) + 1;
      continue;
    }
    const d = decide(ev, s, perPage.get(pageKey(s.website)) || 1);
    const locked = s.claimed || s.staff_edited || s.hours_source === 'owner';
    const image = ev.image && !s.logo_url && !s.cover_url && !NOT_THE_SHOPS_SITE.test(hostOf(ev.image)) ? ev.image : null;
    if (d.skip || locked) {
      why[locked ? 'owner or staff set these hours' : d.skip] = (why[locked ? 'owner or staff set these hours' : d.skip] || 0) + 1;
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

module.exports = {
  collect, collectOne, pageText, hoursSnippets, jsonLdBlocks, microdataHours, metaImage, candidateLinks,
  decide, decideAll, applyDecisions, structuredCandidates, textCandidates, phoneHours,
};

if (require.main === module) {
  const argv = process.argv.slice(2);
  const arg = name => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : null; };
  const { initSchema, runMigrations } = require('../database/schema');
  (async () => {
    await initSchema();
    await runMigrations();
    if (argv[0] === 'collect') {
      await collect({ out: arg('--out'), limit: Number(arg('--limit')) || 0 });
    } else if (argv[0] === 'decide') {
      await decideAll({ from: arg('--from'), out: arg('--out') });
    } else if (argv[0] === 'apply' && argv.includes('--confirm')) {
      await applyDecisions(arg('--from'));
    } else {
      console.error('usage: hoursSweep.js collect --out evidence.jsonl | decide --from evidence.jsonl --out decisions.json | apply --from decisions.json --confirm');
      process.exit(2);
    }
    process.exit(0);
  })().catch(err => { console.error(err); process.exit(1); });
}
