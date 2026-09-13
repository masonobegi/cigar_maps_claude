/**
 * Is the picture on a listing's card actually that shop's?
 *
 * 968 listings show a thumbnail taken from the shop's own website (its
 * og:image). Fourteen of them come from domains that are no longer the shop's:
 * Mike's Cigar Room showed a gambling banner on its card. Others are a spacer
 * gif, a 1200x200 slice of a page header cropped into an unreadable smear, or
 * one stock photo repeated across shops that have nothing to do with each
 * other.
 *
 * This reads each image and answers with a verdict and the measurement behind
 * it. What it can measure honestly, with no image library:
 *
 *   - the HTTP status and content type (an og:image that 404s, or answers with
 *     an HTML error page, is not a picture);
 *   - byte size, and pixel size read out of the PNG/JPEG/GIF/WebP header;
 *   - hot-link behaviour: whether the host serves it to us at all, or swaps in
 *     a "no hotlinking" placeholder;
 *   - near-blank, inferred from bytes per pixel — a solid colour or a spacer
 *     compresses to almost nothing, and that is a measurement, not a guess;
 *   - a banner shape, which crops to an unreadable smear in a card;
 *   - the same image on unrelated shops, by comparing the bytes.
 *
 * What it cannot do is look at the picture. A photograph of the wrong shop
 * reads as a perfectly good image here, and only a person can catch that.
 *
 *   node src/jobs/thumbCheck.js read   --out thumbs.jsonl
 *   node src/jobs/thumbCheck.js decide --from thumbs.jsonl --out thumbs.json
 *   node src/jobs/thumbCheck.js apply  --from thumbs.json --confirm
 *   node src/jobs/thumbCheck.js selftest
 */
'use strict';

const fs = require('fs');
const crypto = require('crypto');
const https = require('https');
const http = require('http');

const { parseWebsite, registrableDomain, TAKEN_OVER_STATUSES } = require('./linkCheck');
const { appUrl } = require('../utils/appUrl');

const TIMEOUT_MS = 12000;
const MAX_BYTES = 3 * 1024 * 1024;
const WORKERS = 6;
const UA = `CigarBuddy/1.0 (+${appUrl()}; thumbnail check)`;

/** Under this, a card shows a blurred stamp rather than a picture. */
const MIN_EDGE_PX = 200;
const MIN_BYTES = 1500;

/**
 * Wider than this and a square card crop throws away most of the picture. A
 * page header at 1600x200 becomes a stripe of somebody's logo.
 */
const MAX_ASPECT = 3.0;

/**
 * Bytes per pixel below this and there is almost nothing in the image: a solid
 * colour, a gradient, or a spacer. A photograph of a shop front, even heavily
 * compressed, sits far above it.
 */
const NEAR_BLANK_BPP = 0.02;

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── reading an image header ─────────────────────────────────────────────────

/**
 * Width and height out of the file header, for the four formats the web
 * actually serves. Returns { format, width, height } or null.
 *
 * Only the header is needed, so this never decodes a pixel.
 */
function imageSize(buf) {
  if (!buf || buf.length < 16) return null;

  // PNG: 8-byte signature, then an IHDR chunk whose first two 32-bit fields
  // are the dimensions.
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47 && buf.readUInt32BE(4) === 0x0d0a1a0a) {
    return { format: 'png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }

  // GIF: "GIF87a" or "GIF89a", then width and height as little-endian 16-bit.
  if (buf.length > 10 && buf.slice(0, 3).toString('latin1') === 'GIF') {
    return { format: 'gif', width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  }

  // WebP: "RIFF" .... "WEBP", then one of three chunk layouts.
  if (buf.length > 30 && buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') {
    const kind = buf.slice(12, 16).toString('latin1');
    if (kind === 'VP8 ' && buf.length > 30) {
      return { format: 'webp', width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    }
    if (kind === 'VP8L' && buf.length > 25) {
      const bits = buf.readUInt32LE(21);
      return { format: 'webp', width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (kind === 'VP8X' && buf.length > 30) {
      const w = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
      const h = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
      return { format: 'webp', width: w, height: h };
    }
    return { format: 'webp', width: 0, height: 0 };
  }

  // JPEG: walk the marker segments to the start-of-frame, which carries the
  // dimensions. Anything else is a segment to skip over.
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const len = buf.readUInt16BE(i + 2);
      // SOF0..SOF15, excluding the four that are not start-of-frame markers.
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { format: 'jpeg', height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      if (len < 2) break;
      i += 2 + len;
    }
    return { format: 'jpeg', width: 0, height: 0 };
  }

  if (buf.slice(0, 5).toString('latin1').toLowerCase().includes('<svg')
    || buf.slice(0, 200).toString('latin1').toLowerCase().includes('<svg')) {
    return { format: 'svg', width: 0, height: 0 };
  }
  return null;
}

/** Does this look like a web page rather than a picture? */
function looksLikeHtml(buf) {
  const head = String(buf && buf.slice(0, 400).toString('latin1') || '').toLowerCase().trimStart();
  return head.startsWith('<!doctype html') || head.startsWith('<html') || head.includes('<head>');
}

function fetchImage(url, { referer = null } = {}) {
  return new Promise(resolve => {
    let u;
    try { u = new URL(url); } catch { return resolve({ error: 'bad url' }); }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return resolve({ error: 'bad scheme' });
    // The same private-host guard the link checker uses.
    if (!parseWebsite(u.hostname)) return resolve({ error: 'unsafe host' });

    const lib = u.protocol === 'https:' ? https : http;
    const headers = { 'User-Agent': UA, Accept: 'image/*,*/*;q=0.8' };
    // A hot-link check needs the request to look like the one a browser makes
    // from our page, which carries our referer and not the shop's.
    if (referer) headers.Referer = referer;

    const req = lib.get(u, { headers, timeout: TIMEOUT_MS }, res => {
      const code = res.statusCode || 0;
      if (code >= 300 && code < 400 && res.headers.location) {
        res.resume();
        let next;
        try { next = new URL(res.headers.location, u).toString(); } catch { return resolve({ error: 'bad redirect' }); }
        return resolve(fetchImage(next, { referer }));
      }
      const chunks = [];
      let size = 0;
      res.on('data', d => {
        size += d.length;
        if (size > MAX_BYTES) { res.destroy(); return; }
        chunks.push(d);
      });
      const done = () => resolve({
        code, type: String(res.headers['content-type'] || '').toLowerCase(),
        buf: Buffer.concat(chunks), url: u.toString(),
      });
      res.on('end', done);
      res.on('close', done);
      res.on('error', () => resolve({ error: 'stream error', code }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ error: 'timeout' }); });
    req.on('error', e => resolve({ error: e.code || e.message }));
  });
}

// ── read ────────────────────────────────────────────────────────────────────

async function read({ out, limit = 0, log = console.log } = {}) {
  const db = require('../database/db');
  const rows = await db.all(`
    SELECT id, name, city, state, website, website_status, web_image_url
    FROM stores
    WHERE visible = 1 AND web_image_url IS NOT NULL AND web_image_url <> ''
    ORDER BY id`);

  const done = new Set();
  if (out && fs.existsSync(out)) {
    for (const line of fs.readFileSync(out, 'utf8').split('\n')) {
      try { done.add(JSON.parse(line).id); } catch {}
    }
  }
  let queue = rows.filter(r => !done.has(r.id));
  if (limit) queue = queue.slice(0, limit);
  log(`${done.size} already read; reading ${queue.length} thumbnails with ${WORKERS} workers`);

  const stream = fs.createWriteStream(out, { flags: 'a' });
  let next = 0, finished = 0;
  async function worker() {
    while (next < queue.length) {
      const r = queue[next++];
      // Once with our own referer, the way a customer's browser would ask.
      const got = await fetchImage(r.web_image_url, { referer: `${appUrl()}/` });
      const rec = {
        id: r.id, name: r.name, city: r.city, state: r.state,
        website: r.website, website_status: r.website_status, url: r.web_image_url,
        error: got.error || null, code: got.code ?? null, type: got.type || null,
        bytes: got.buf ? got.buf.length : 0,
        html: got.buf ? looksLikeHtml(got.buf) : false,
        sha256: got.buf && got.buf.length ? crypto.createHash('sha256').update(got.buf).digest('hex') : null,
        size: got.buf ? imageSize(got.buf) : null,
        hotlink_blocked: false,
      };
      // If it failed with our referer, ask again with none. A host that serves
      // the image only without a referer is blocking hot-links, which is the
      // shop's right — the picture is simply not ours to show.
      if (!rec.error && (rec.code >= 400 || rec.html)) {
        const bare = await fetchImage(r.web_image_url);
        if (bare.buf && bare.code < 400 && !looksLikeHtml(bare.buf) && imageSize(bare.buf)) {
          rec.hotlink_blocked = true;
        }
      }
      stream.write(JSON.stringify(rec) + '\n');
      finished++;
      if (finished % 100 === 0) log(`  ${finished}/${queue.length} read`);
      await sleep(120);
    }
  }
  await Promise.all(Array.from({ length: WORKERS }, worker));
  await new Promise(r => stream.end(r));
  log(`done: ${finished} thumbnails read`);
  return finished;
}

// ── decide ──────────────────────────────────────────────────────────────────

/**
 * One thumbnail's verdict, pure, so the self-test can put every shape through
 * it. `shared` is how many OTHER listings serve the identical bytes.
 *
 * Returns { keep: true } or { keep: false, why }.
 */
function judgeThumb(rec, shared = 0) {
  const why = [];

  // A picture on a domain that is no longer the shop's is the whole reason this
  // job exists: Mike's Cigar Room's card carried a gambling banner.
  if (rec.website_status && TAKEN_OVER_STATUSES.includes(rec.website_status)) {
    why.push(`its website is ${rec.website_status}, so the picture is not the shop's`);
  }
  const imageDomain = registrableDomain(rec.url || '');
  const siteDomain = rec.website ? registrableDomain(parseWebsite(rec.website)?.host || '') : null;

  if (rec.error) why.push(`the image could not be fetched (${rec.error})`);
  else if (rec.code >= 400) why.push(`the image answers ${rec.code}`);
  if (rec.hotlink_blocked) why.push('the host will not serve the image to another site');
  if (rec.html) why.push('the URL answers with a web page, not a picture');
  if (!rec.error && rec.code < 400 && rec.type && !/^image\//.test(rec.type) && !/svg/.test(rec.type)) {
    why.push(`its content type is ${rec.type}, not an image`);
  }
  if (!rec.error && rec.code < 400 && !rec.size && !rec.html) why.push('the bytes are not an image in any format we can read');

  const size = rec.size;
  if (size && size.width && size.height) {
    if (size.width < MIN_EDGE_PX || size.height < MIN_EDGE_PX) {
      why.push(`it is ${size.width}x${size.height}, too small for a card`);
    }
    const aspect = Math.max(size.width / size.height, size.height / size.width);
    if (aspect > MAX_ASPECT) {
      why.push(`it is ${size.width}x${size.height} — a banner, which crops to a smear`);
    }
    const bpp = rec.bytes / (size.width * size.height);
    if (rec.bytes > 0 && bpp < NEAR_BLANK_BPP) {
      why.push(`${rec.bytes} bytes over ${size.width}x${size.height} is near-blank`);
    }
  }
  if (rec.bytes > 0 && rec.bytes < MIN_BYTES && !why.length) {
    why.push(`${rec.bytes} bytes is a spacer, not a photograph`);
  }
  if (shared >= 2) {
    why.push(`the same image is on ${shared} other listings that are not branches of each other`);
  }
  // A picture hosted somewhere other than the shop's own site is not wrong —
  // plenty of shops use a CDN — so it is noted, never a reason on its own.
  const offSite = !!(imageDomain && siteDomain && imageDomain !== siteDomain);
  return why.length ? { keep: false, why, off_site: offSite } : { keep: true, off_site: offSite };
}

/**
 * Do these listings look like branches of one business? The same picture across
 * three branches of Anthony's is right; the same stock photo across three
 * unrelated shops is not.
 */
/**
 * Words that say what the shop sells, not which shop it is. Without these
 * struck out, "Premium Cigars of Georgia" and "Windy City Cigars" shared the
 * word "cigars" and were read as branches of one business — which made the
 * whole shared-image check inert, because almost every listing here has
 * "cigars" or "tobacco" in its name.
 */
const TRADE_WORDS = new Set(['cigar', 'cigars', 'cigarette', 'cigarettes', 'tobacco', 'tobaccos', 'tobacconist',
  'smoke', 'smokes', 'smoking', 'shop', 'shops', 'shoppe', 'store', 'stores', 'lounge', 'lounges', 'bar',
  'company', 'humidor', 'humidors', 'emporium', 'outlet', 'vape', 'vapes', 'vapor', 'pipe', 'pipes', 'club',
  'room', 'premium', 'fine', 'quality', 'discount', 'house', 'depot', 'world', 'city', 'town']);

function sameBusiness(a, b) {
  const domA = a.website ? registrableDomain(parseWebsite(a.website)?.host || '') : null;
  const domB = b.website ? registrableDomain(parseWebsite(b.website)?.host || '') : null;
  if (domA && domB && domA === domB) return true;
  const key = s => String(s.name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const own = n => key(n).split(' ').filter(w => w.length > 3 && !TRADE_WORDS.has(w));
  const wordsA = new Set(own(a));
  const wordsB = own(b);
  if (!wordsA.size || !wordsB.length) return false;
  return wordsB.some(w => wordsA.has(w));
}

async function decide({ from, out, log = console.log } = {}) {
  const recs = [];
  for (const line of fs.readFileSync(from, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { recs.push(JSON.parse(line)); } catch {}
  }

  // Group by the bytes, so one stock photo on unrelated shops is visible.
  const byHash = new Map();
  for (const r of recs) {
    if (!r.sha256) continue;
    if (!byHash.has(r.sha256)) byHash.set(r.sha256, []);
    byHash.get(r.sha256).push(r);
  }
  const unrelatedCount = new Map();
  const sharedGroups = [];
  for (const [hash, group] of byHash) {
    if (group.length < 2) continue;
    // Counted per listing, against the others: how many of the shops serving
    // these exact bytes are not this one's own branches.
    //
    // This used to mark every member of a group in which ANY pair was
    // unrelated, so one odd shop tainted the rest — twenty-three Cigaret
    // Shopper branches lost their own logo because a twenty-fourth listing
    // shared it. A chain's logo across its own branches is the right picture
    // on every one of them.
    const strangers = a => group.filter(b => b.id !== a.id && !sameBusiness(a, b)).length;
    const unrelated = group.filter(a => strangers(a) >= 2);
    for (const r of unrelated) unrelatedCount.set(r.id, strangers(r));
    if (unrelated.length >= 2) {
      sharedGroups.push({ sha256: hash, count: group.length,
        listings: group.map(r => ({ id: r.id, name: r.name, city: r.city, state: r.state, website: r.website })) });
    }
  }

  const drop = [], keep = [];
  for (const r of recs) {
    const verdict = judgeThumb(r, unrelatedCount.get(r.id) || 0);
    const row = {
      id: r.id, name: r.name, city: r.city, state: r.state, url: r.url,
      website: r.website, website_status: r.website_status,
      bytes: r.bytes, size: r.size, off_site: verdict.off_site,
    };
    if (verdict.keep) keep.push(row);
    else drop.push({ ...row, why: verdict.why });
  }

  const byReason = {};
  for (const d of drop) for (const w of d.why) {
    const k = w.replace(/\d+/g, 'N');
    byReason[k] = (byReason[k] || 0) + 1;
  }
  log(`thumbnails read: ${recs.length}; to take down: ${drop.length}; kept: ${keep.length}`);
  for (const [k, v] of Object.entries(byReason).sort((a, b) => b[1] - a[1])) log(`  ${v.toString().padStart(4)}  ${k}`);
  log(`the same image on unrelated shops: ${sharedGroups.length} groups`);
  if (out) {
    fs.writeFileSync(out, JSON.stringify({ drop, keep, sharedGroups }, null, 1));
    log(`written to ${out}`);
  }
  return { drop, keep, sharedGroups };
}

// ── apply ───────────────────────────────────────────────────────────────────

async function apply(file, { log = console.log } = {}) {
  const db = require('../database/db');
  const { writeFields } = require('../utils/storeEdits');
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));
  let n = 0;
  for (const x of d.drop || []) {
    // The URL goes into the edit log before it is cleared, so a thumbnail taken
    // down by mistake can be put back.
    const written = await writeFields(x.id, { web_image_url: null }, {
      source: 'rule', job: 'thumbCheck', reason: (x.why || []).join('; ').slice(0, 400),
    });
    if (written.length) n++;
  }
  log(`took down ${n} thumbnails`);
  return { removed: n };
}

module.exports = { read, decide, apply, imageSize, looksLikeHtml, judgeThumb, sameBusiness,
  MIN_EDGE_PX, MAX_ASPECT, NEAR_BLANK_BPP };

// ── self-test ───────────────────────────────────────────────────────────────
function selftest() {
  let pass = 0, fail = 0;
  const ok = (cond, label, extra) => {
    if (cond) { pass++; console.log(`  ok   ${label}`); }
    else { fail++; console.log(`  FAIL ${label}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ''}`); }
  };

  // Headers, built by hand so the parser is checked against the spec and not
  // against whatever a library happens to produce.
  const png = Buffer.alloc(30);
  png.writeUInt32BE(0x89504e47, 0); png.writeUInt32BE(0x0d0a1a0a, 4);
  png.write('IHDR', 12, 'latin1'); png.writeUInt32BE(1200, 16); png.writeUInt32BE(630, 20);
  ok(JSON.stringify(imageSize(png)) === '{"format":"png","width":1200,"height":630}', 'a PNG header reads', imageSize(png));

  const gif = Buffer.alloc(16);
  gif.write('GIF89a', 0, 'latin1'); gif.writeUInt16LE(1, 6); gif.writeUInt16LE(1, 8);
  ok(imageSize(gif).width === 1 && imageSize(gif).format === 'gif', 'a 1x1 spacer gif reads', imageSize(gif));

  // JPEG: SOI, an APP0 segment to skip, then SOF0 carrying 800x600.
  const jpeg = Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    Buffer.from([0xff, 0xe0, 0x00, 0x10]), Buffer.alloc(14),
    Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08]),
    Buffer.from([0x02, 0x58, 0x03, 0x20]),
    Buffer.alloc(10),
  ]);
  ok(JSON.stringify(imageSize(jpeg)) === '{"format":"jpeg","height":600,"width":800}',
    'a JPEG start-of-frame reads, past the segment before it', imageSize(jpeg));

  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8X'),
    Buffer.alloc(8), Buffer.from([0x4f, 0x02, 0x00, 0x75, 0x01, 0x00]), Buffer.alloc(8)]);
  const wsz = imageSize(webp);
  ok(wsz && wsz.format === 'webp' && wsz.width === 592 && wsz.height === 374, 'a WebP VP8X header reads', wsz);

  ok(imageSize(Buffer.from('<!DOCTYPE html><html><head>')) === null, 'a web page is not an image');
  ok(looksLikeHtml(Buffer.from('<!DOCTYPE html><html>')), 'and is recognised as one');
  ok(!looksLikeHtml(png), 'a PNG is not a web page');

  // ── the verdicts ──────────────────────────────────────────────────────────
  const good = {
    id: 1, name: 'Casa Fuente', website: 'casafuente.com', website_status: 'ok',
    url: 'https://casafuente.com/og.jpg', error: null, code: 200, type: 'image/jpeg',
    bytes: 140000, html: false, hotlink_blocked: false, size: { format: 'jpeg', width: 1200, height: 630 },
  };
  ok(judgeThumb(good).keep, 'an ordinary og:image is kept');

  // The case this job was written for.
  const mikes = { ...good, id: 2, name: "Mike's Cigar Room", website: 'mikescigarroom.com', website_status: 'hijacked' };
  const mv = judgeThumb(mikes);
  ok(!mv.keep && /hijacked/.test(mv.why.join(' ')), "a picture from a hijacked domain comes down", mv.why);
  ok(!judgeThumb({ ...good, website_status: 'parked' }).keep, 'so does one from a parked domain');
  ok(!judgeThumb({ ...good, website_status: 'elsewhere' }).keep, 'and one from a domain that now lands elsewhere');
  ok(judgeThumb({ ...good, website_status: 'blocked' }).keep, 'but a site behind a firewall keeps its picture');

  ok(!judgeThumb({ ...good, code: 404, bytes: 0, size: null }).keep, 'a 404 image comes down');
  ok(!judgeThumb({ ...good, error: 'timeout', code: null, bytes: 0, size: null }).keep, 'so does one that never answers');
  ok(!judgeThumb({ ...good, hotlink_blocked: true }).keep, 'so does one the host will not serve to us');
  ok(!judgeThumb({ ...good, html: true }).keep, 'so does a URL that answers with a page');
  ok(!judgeThumb({ ...good, type: 'text/html' }).keep, 'so does one whose content type is not an image');

  ok(!judgeThumb({ ...good, size: { format: 'png', width: 64, height: 64 }, bytes: 4000 }).keep, 'a 64x64 icon is too small for a card');
  const banner = judgeThumb({ ...good, size: { format: 'jpeg', width: 1600, height: 200 }, bytes: 90000 });
  ok(!banner.keep && /banner/.test(banner.why.join(' ')), 'a 1600x200 page header is a banner, not a thumbnail', banner.why);
  const blank = judgeThumb({ ...good, size: { format: 'png', width: 1200, height: 630 }, bytes: 900 });
  ok(!blank.keep && /near-blank/.test(blank.why.join(' ')), 'a near-empty image is caught by bytes per pixel', blank.why);
  // A heavily compressed but real photograph must survive that same test.
  ok(judgeThumb({ ...good, size: { format: 'jpeg', width: 1200, height: 630 }, bytes: 40000 }).keep,
    'a heavily compressed photograph is still a photograph');

  ok(!judgeThumb(good, 3).keep, 'the same picture on three unrelated shops comes down');
  ok(judgeThumb(good, 0).keep, 'and a picture that is only its own shop\'s stays');

  // Branches of one chain sharing a picture is right, and must not be counted.
  const a = { id: 1, name: "Anthony's Cigar Emporium", website: 'anthonyscigars.com' };
  const b = { id: 2, name: "Anthony's Cigar Emporium - Oro Valley", website: 'anthonyscigars.com' };
  const c = { id: 3, name: 'Smoke City', website: 'smokecity.example' };
  ok(sameBusiness(a, b), 'two branches on one domain are one business');
  ok(sameBusiness({ ...a, website: null }, { ...b, website: null }), 'and so are two branches by name alone');
  ok(!sameBusiness(a, c), 'but two different shops are not');

  // A chain's own logo across its own branches is the right picture on every
  // one of them. The count is per listing, against the others: twenty-three
  // Cigaret Shopper branches shared one logo with a twenty-fourth listing,
  // and the old rule dropped the logo from all twenty-four.
  const branch = n => ({ id: n, name: 'Cigaret Shopper', website: 'cigaretshopper.com' });
  const chain = [branch(1), branch(2), branch(3), { id: 4, name: 'Somebody Else', website: 'elsewhere.com' }];
  const strangers = x => chain.filter(y => y.id !== x.id && !sameBusiness(x, y)).length;
  ok(strangers(chain[0]) === 1, 'a branch counts only the shops that are not its own', strangers(chain[0]));
  ok(strangers(chain[3]) === 3, 'and the stranger counts all three branches', strangers(chain[3]));
  ok(!sameBusiness({ name: 'Premium Cigars of Georgia' }, { name: 'Windy City Cigars' }),
    'two shops are not one business because both say "cigars"');
  ok(!sameBusiness({ name: 'The Tobacco Shop' }, { name: 'Smoke Shop Lounge' }),
    'nor because both are made of trade words');
  ok(sameBusiness({ name: "Anthony's Cigar Emporium Tucson" }, { name: "Anthony's Cigar Emporium Oro Valley" }),
    'but two branches sharing the name that identifies them still are');

  // A CDN is noted, never a reason on its own.
  const cdn = judgeThumb({ ...good, url: 'https://cdn.shopify.com/x/og.jpg' });
  ok(cdn.keep && cdn.off_site === true, 'a picture on a CDN is kept, and the fact is recorded', cdn);

  console.log(`\nthumbCheck self-test: ${pass} passed, ${fail} failed`);
  return fail;
}

if (require.main === module) main();

function main() {
  const argv = process.argv.slice(2);
  const arg = n => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : null; };
  if (argv[0] === 'selftest') { process.exit(selftest() ? 1 : 0); }
  (async () => {
    if (argv[0] === 'read') await read({ out: arg('--out'), limit: parseInt(arg('--limit')) || 0 });
    else if (argv[0] === 'decide') await decide({ from: arg('--from'), out: arg('--out') });
    else if (argv[0] === 'apply' && argv.includes('--confirm')) await apply(arg('--from'));
    else console.error('usage: read --out f.jsonl | decide --from f.jsonl --out d.json | apply --from d.json --confirm | selftest');
    process.exit(0);
  })().catch(err => { console.error(err); process.exit(1); });
}
