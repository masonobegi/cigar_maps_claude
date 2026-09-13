/**
 * Positive evidence that a shop is still trading, gathered from its own site.
 *
 * The rule for this sweep is the one the owner set: guilty until proven
 * innocent. A listing stays public only if something says it is open *now*.
 * "Nothing says it closed" is not evidence and never was — Cascade Cigar's site
 * has never said it closed, and the shop has been shut for six months.
 *
 * What actually separates a trading shop from an abandoned website is dated
 * traces. A site somebody maintains leaves them constantly and cannot help it:
 *
 *   lastmod in sitemap.xml   A CMS rewrites this whenever anything changes.
 *                            Strongest signal here by a distance, because it is
 *                            machine-written and nobody edits it by hand.
 *   Last-Modified header     Free, though many hosts fake it with "now".
 *   copyright year           Usually a template variable, so it tracks the
 *                            current year on a live site and freezes on a dead
 *                            one. Cascade's stops at 2020.
 *   dated content            <time datetime>, article:modified_time, JSON-LD
 *                            dateModified, ISO dates in the markup.
 *
 * Read only, writes nothing. Produces the evidence file the decision is made
 * from, so the decision can be reviewed before anything is hidden.
 *
 *   node sweeps/scripts/probe_open_evidence.js
 *   LIMIT=40 node sweeps/scripts/probe_open_evidence.js      # a taste first
 */
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { readClosureText, visibleText } = require('../../server/src/jobs/closureCheck');

const D = path.join(__dirname, '..', 'decisions');
const WORKERS = Number(process.env.WORKERS || 10);
const LIMIT = Number(process.env.LIMIT || 0);
const TIMEOUT_MS = 20000;
const MAX_BYTES = 2.5 * 1024 * 1024;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** Today, as the sweep sees it. Passed around so the arithmetic is testable. */
const NOW = new Date();
const YEAR = NOW.getUTCFullYear();

function get(url, depth = 0) {
  return new Promise(resolve => {
    if (depth > 5) return resolve({ ok: false, why: 'too many redirects' });
    let u;
    try { u = new URL(url); } catch { return resolve({ ok: false, why: 'bad url' }); }
    if (!/^https?:$/.test(u.protocol)) return resolve({ ok: false, why: 'bad scheme' });
    const mod = u.protocol === 'http:' ? http : https;
    const req = mod.get(u, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
      timeout: TIMEOUT_MS,
    }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        let next;
        try { next = new URL(res.headers.location, url).toString(); } catch { return resolve({ ok: false, why: 'bad redirect' }); }
        return resolve(get(next, depth + 1));
      }
      let body = '';
      let n = 0;
      res.setEncoding('utf8');
      res.on('data', c => { n += c.length; if (n <= MAX_BYTES) body += c; });
      res.on('end', () => resolve({
        ok: res.statusCode >= 200 && res.statusCode < 300,
        status: res.statusCode,
        url: u.toString(),
        lastModified: res.headers['last-modified'] || null,
        type: res.headers['content-type'] || '',
        body,
      }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, why: 'timeout' }); });
    req.on('error', e => resolve({ ok: false, why: e.code || e.message }));
  });
}

/** A year only counts if it is plausible: not the future, not the last century. */
const plausible = y => Number.isFinite(y) && y >= 2005 && y <= YEAR;

/**
 * The copyright year. Written as a template variable on most sites, so on one
 * anybody maintains it equals the current year, and on an abandoned one it is
 * frozen at whatever year the lights went out. Ranges ("© 2011-2024") count as
 * their end.
 */
function copyrightYear(text) {
  let best = null;
  const re = /(?:©|\(c\)|copyright)[^0-9]{0,24}((?:19|20)\d{2})(?:\s*[-–—]\s*((?:19|20)\d{2}))?/gi;
  let m;
  while ((m = re.exec(text))) {
    for (const y of [Number(m[2]), Number(m[1])]) if (plausible(y) && (best === null || y > best)) best = y;
  }
  return best;
}

/** Any machine-written date in the markup, as an ISO day, newest first. */
function datesInMarkup(html) {
  const out = [];
  const push = s => {
    const d = new Date(s);
    if (!isNaN(d) && d.getUTCFullYear() >= 2005 && d <= NOW) out.push(d.toISOString().slice(0, 10));
  };
  for (const re of [
    /<time[^>]+datetime=["']([^"']+)["']/gi,
    /<meta[^>]+property=["'](?:article:modified_time|article:published_time|og:updated_time)["'][^>]+content=["']([^"']+)["']/gi,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["'](?:article:modified_time|article:published_time|og:updated_time)["']/gi,
    /"date(?:Modified|Published)"\s*:\s*"([^"]+)"/gi,
    /\b(20\d{2}-\d{2}-\d{2})(?:T[\d:]+)?/g,
  ]) {
    let m;
    while ((m = re.exec(html))) push(m[1]);
  }
  return [...new Set(out)].sort().reverse();
}

/** The newest <lastmod> across the sitemap and, if it is an index, its children. */
async function sitemapNewest(origin) {
  const seen = new Set();
  let newest = null;
  const readOne = async (url, depth = 0) => {
    if (depth > 1 || seen.has(url) || seen.size > 6) return;
    seen.add(url);
    const r = await get(url);
    if (!r.ok || !/xml|text/i.test(r.type || '')) return;
    for (const m of r.body.matchAll(/<lastmod>\s*([^<]+?)\s*<\/lastmod>/gi)) {
      const d = new Date(m[1]);
      if (!isNaN(d) && d <= NOW && (!newest || d > newest)) newest = d;
    }
    // A sitemap index points at the real ones; follow a few.
    if (/<sitemapindex/i.test(r.body)) {
      const kids = [...r.body.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map(m => m[1]).slice(0, 4);
      for (const k of kids) await readOne(k, depth + 1);
    }
  };
  for (const p of ['/sitemap.xml', '/sitemap_index.xml', '/wp-sitemap.xml']) {
    await readOne(`${origin}${p}`);
    if (newest) break;
  }
  return newest ? newest.toISOString().slice(0, 10) : null;
}

/** What the site is built with — it changes how much a missing signal means. */
function platform(html) {
  if (/cdn\.shopify\.com|Shopify\.theme/i.test(html)) return 'shopify';
  if (/wp-content|wp-includes/i.test(html)) return 'wordpress';
  if (/squarespace/i.test(html)) return 'squarespace';
  if (/wix\.com|wixstatic/i.test(html)) return 'wix';
  if (/website-files\.com/i.test(html)) return 'webflow';
  if (/godaddy|starfield|wsimg\.com/i.test(html)) return 'godaddy';
  if (/spotapps\.co/i.test(html)) return 'spot';
  return null;
}

/** Signals that somebody is transacting, not just hosting. */
function commerce(html) {
  const bits = [];
  if (/add to cart|add-to-cart|addtocart/i.test(html)) bits.push('cart');
  if (/book (?:a|your) |reserve (?:a|your) |eventbrite|calendly/i.test(html)) bits.push('booking');
  if (/in stock|sold out|out of stock/i.test(html)) bits.push('stock');
  if (/instagram\.com\/[a-z0-9_.]+/i.test(html)) bits.push('instagram');
  if (/facebook\.com\/[a-z0-9_.\-]+/i.test(html)) bits.push('facebook');
  return bits;
}

/** Days between an ISO day and today. */
function ageDays(iso) {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  if (isNaN(d)) return null;
  return Math.round((NOW - d) / 86400000);
}

async function probe(row) {
  const site = /^https?:\/\//i.test(row.website) ? row.website : `https://${row.website}`;
  const r = await get(site);
  const out = {
    id: row.id, name: row.name, where: [row.city, row.state].filter(Boolean).join(', '),
    website: row.website, phone: row.phone || null,
  };
  if (!r.ok) {
    out.reachable = false;
    out.why = r.why || `http ${r.status}`;
    out.status = r.status || 0;
    return out;
  }
  const html = r.body;
  const text = visibleText(html);
  let origin = null;
  try { origin = new URL(r.url).origin; } catch { /* keep null */ }

  out.reachable = true;
  out.status = r.status;
  out.finalUrl = r.url;
  out.bytes = html.length;
  out.platform = platform(html);
  out.copyrightYear = copyrightYear(text) ?? copyrightYear(html);
  const dates = datesInMarkup(html);
  out.newestMarkupDate = dates[0] || null;
  out.sitemapNewest = origin ? await sitemapNewest(origin) : null;
  out.lastModifiedHeader = r.lastModified ? new Date(r.lastModified).toISOString().slice(0, 10) : null;
  out.commerce = commerce(html);

  // Whatever the shop's own page says about closing, read by the job that
  // already knows "closed Sundays" is not a closed shop.
  // readClosureText returns { closed, phrase } — an object either way, so a
  // plain truthiness check marks every site on the internet as closed. It did,
  // for one run: 37 of 37.
  let closure = null;
  try { closure = readClosureText(text); } catch { closure = null; }
  out.saysClosed = closure && closure.closed ? String(closure.phrase || '').slice(0, 180) : null;

  // The freshest dated trace of any kind, and how old it is.
  //
  // A copyright year is a year, not a day. Reading it as 31 December dated the
  // current year in the future and produced ages like -109 days, which would
  // have made every site with "© 2026" look freshest of all. It counts as
  // 1 January, which understates freshness — the right direction to be wrong in
  // when the rule is that a listing must prove itself.
  const candidates = [out.sitemapNewest, out.newestMarkupDate,
    out.copyrightYear ? `${out.copyrightYear}-01-01` : null].filter(Boolean).sort().reverse();
  out.freshest = candidates[0] || null;
  out.freshestAgeDays = ageDays(out.freshest);
  return out;
}

(async () => {
  const rows = JSON.parse(fs.readFileSync(path.join(D, 'open_candidates.json'), 'utf8'))
    .filter(r => r.website);
  // IDS=10184,223 probes named listings, which is how the rule gets checked
  // against a shop somebody has actually stood outside of.
  const only = (process.env.IDS || '').split(',').map(s => Number(s.trim())).filter(Boolean);
  const work = only.length ? rows.filter(r => only.includes(r.id)) : (LIMIT ? rows.slice(0, LIMIT) : rows);
  console.log(`probing ${work.length} shop websites for signs of life\n`);

  const results = [];
  const queue = work.slice();
  let done = 0;
  await Promise.all(Array.from({ length: WORKERS }, async () => {
    while (queue.length) {
      const row = queue.shift();
      let r;
      try { r = await probe(row); } catch (e) { r = { id: row.id, name: row.name, reachable: false, why: `threw: ${e.message}` }; }
      results.push(r);
      done++;
      if (done % 25 === 0) process.stdout.write(`  ${done}/${work.length}\r`);
    }
  }));
  results.sort((a, b) => a.id - b.id);

  const dest = path.join(D, 'open_evidence.json');
  fs.writeFileSync(dest, JSON.stringify(results, null, 2));

  const live = results.filter(r => r.reachable);
  const within = d => live.filter(r => r.freshestAgeDays !== null && r.freshestAgeDays <= d).length;
  console.log(`\n${'='.repeat(64)}`);
  console.log(`unreachable site            ${results.length - live.length}`);
  console.log(`site answers                ${live.length}`);
  console.log(`  says it closed            ${live.filter(r => r.saysClosed).length}`);
  console.log(`\nnewest dated trace on the site:`);
  console.log(`  within 180 days           ${within(180)}`);
  console.log(`  within 1 year             ${within(365)}`);
  console.log(`  within 2 years            ${within(730)}`);
  console.log(`  older than 2 years        ${live.filter(r => r.freshestAgeDays !== null && r.freshestAgeDays > 730).length}`);
  console.log(`  no dated trace at all     ${live.filter(r => r.freshestAgeDays === null).length}`);
  // Which signal is doing the work, because "freshest" hides whether it came
  // from a machine-written sitemap or from a copyright line a theme printed.
  console.log(`\nwhere the freshest trace came from:`);
  const has = k => live.filter(r => r[k]).length;
  console.log(`  sitemap lastmod           ${has('sitemapNewest')}`);
  console.log(`  dated markup              ${has('newestMarkupDate')}`);
  console.log(`  copyright year            ${has('copyrightYear')}`);
  console.log(`  none of the three         ${live.filter(r => !r.sitemapNewest && !r.newestMarkupDate && !r.copyrightYear).length}`);

  console.log(`\ncopyright year:`);
  const years = {};
  for (const r of live) years[r.copyrightYear || 'none'] = (years[r.copyrightYear || 'none'] || 0) + 1;
  for (const [k, v] of Object.entries(years).sort((a, b) => String(b[0]).localeCompare(String(a[0])))) {
    console.log(`  ${String(k).padEnd(24)}${v}`);
  }

  console.log(`\nplatform:`);
  const plats = {};
  for (const r of live) plats[r.platform || '(plain)'] = (plats[r.platform || '(plain)'] || 0) + 1;
  for (const [k, v] of Object.entries(plats).sort((a, b) => b[1] - a[1])) console.log(`  ${String(k).padEnd(24)}${v}`);
  console.log(`\nwritten to ${dest}`);
  process.exit(0);
})();
