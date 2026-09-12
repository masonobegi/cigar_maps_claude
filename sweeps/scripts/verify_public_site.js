/**
 * Crawl the live site the way a search engine would, and complain about
 * anything a search engine would complain about.
 *
 * Everything the SEO work produces is invisible from the code: a canonical is
 * only right if the deployed page carries it, JSON-LD is only useful if it
 * parses, and a sitemap entry that 404s is worse than no sitemap. So this
 * fetches the real thing and checks it.
 *
 *   BASE=https://cigarbuddy.com node sweeps/scripts/verify_public_site.js
 */
'use strict';

const https = require('https');
const http = require('http');

const BASE = (process.env.BASE || 'https://cigarmapsclaude-production.up.railway.app').replace(/\/+$/, '');
const SAMPLE = Number(process.env.SAMPLE || 25);

const get = (url, depth = 0) => new Promise(resolve => {
  if (depth > 4) return resolve({ status: 0, body: '', url });
  const mod = url.startsWith('http://') ? http : https;
  const req = mod.get(url, { headers: { 'User-Agent': 'CigarBuddy/1.0 (self check)' }, timeout: 20000 }, res => {
    if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
      res.resume();
      return resolve(get(new URL(res.headers.location, url).toString(), depth + 1));
    }
    let body = '';
    res.setEncoding('utf8');
    res.on('data', c => { if (body.length < 800000) body += c; });
    res.on('end', () => resolve({ status: res.statusCode, body, url, type: res.headers['content-type'] || '' }));
  });
  req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: '', url }); });
  req.on('error', () => resolve({ status: 0, body: '', url }));
});

let problems = 0;
const bad = (what, detail) => { problems++; console.log(`  PROBLEM  ${what}${detail ? ` — ${detail}` : ''}`); };
const good = what => console.log(`  ok       ${what}`);

/** Every <loc> in a sitemap. */
const locs = xml => [...String(xml).matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);

function checkHead(page, { url, expectCanonical, wantJsonLd }) {
  const head = page.body.split('</head>')[0] || '';
  const canon = (head.match(/<link rel="canonical" href="([^"]+)"/) || [])[1];
  const titles = (head.match(/<title>/g) || []).length;
  const canons = (head.match(/rel="canonical"/g) || []).length;
  const title = (head.match(/<title>([^<]*)<\/title>/) || [])[1] || '';

  if (titles !== 1) bad(`${url}: ${titles} <title> tags`);
  if (canons !== 1) bad(`${url}: ${canons} canonical tags`);
  if (canon !== expectCanonical) bad(`${url}: canonical is ${canon}`, `expected ${expectCanonical}`);
  if (!title || title.length < 15) bad(`${url}: title is "${title}"`);

  const blocks = [...head.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => m[1]);
  if (wantJsonLd && !blocks.length) bad(`${url}: no structured data`);
  for (const b of blocks) {
    try {
      const parsed = JSON.parse(b);
      if (!parsed['@context'] || !parsed['@type']) bad(`${url}: a JSON-LD block has no @type`);
    } catch (e) { bad(`${url}: JSON-LD does not parse`, e.message); }
  }
  return { title, blocks: blocks.length };
}

(async () => {
  console.log(`checking ${BASE}\n`);

  // ── robots and the sitemaps ────────────────────────────────────────────────
  const robots = await get(`${BASE}/robots.txt`);
  if (robots.status !== 200 || /<html/i.test(robots.body)) bad('robots.txt is not plain text');
  else if (!robots.body.includes(`Sitemap: ${BASE}/sitemap.xml`)) bad('robots.txt does not name the sitemap');
  else good('robots.txt names the sitemap');

  const index = await get(`${BASE}/sitemap.xml`);
  if (index.status !== 200 || !index.body.includes('<sitemapindex')) { bad('sitemap.xml is not a sitemap index'); }
  const children = locs(index.body);
  good(`sitemap index lists ${children.length} files`);

  let all = [];
  for (const child of children) {
    const page = await get(child);
    if (page.status !== 200) { bad(`${child} returned ${page.status}`); continue; }
    const urls = locs(page.body);
    if (!urls.length) bad(`${child} lists no URLs`, 'an empty sitemap asserts the site has no pages');
    all = all.concat(urls);
  }
  good(`${all.length} URLs across every sitemap`);
  const dupes = all.length - new Set(all).size;
  if (dupes) bad(`${dupes} duplicate URLs in the sitemaps`);
  const offSite = all.filter(u => !u.startsWith(BASE));
  if (offSite.length) bad(`${offSite.length} sitemap URLs are not on this domain`, offSite[0]);
  else good('every sitemap URL is on this domain');

  // ── the homepage, which is the one a crawler fetches first ────────────────
  const home = await get(`${BASE}/`);
  if (home.status !== 200) bad(`the homepage returned ${home.status}`);
  else checkHead(home, { url: '/', expectCanonical: `${BASE}/`, wantJsonLd: false });
  if (home.body.includes('<div id="root"')) good('the homepage still has an app to hydrate');
  else bad('the homepage lost its React root');

  // ── a sample of every kind of page in the sitemap ─────────────────────────
  const places = all.filter(u => u.includes('/cigar-shops/'));
  const shops = all.filter(u => u.includes('/stores/'));
  const pick = (list, n) => {
    const step = Math.max(1, Math.floor(list.length / n));
    return list.filter((_, i) => i % step === 0).slice(0, n);
  };

  console.log(`\nplace pages (${places.length} in the sitemap, checking ${Math.min(SAMPLE, places.length)}):`);
  let placeProblems = 0;
  for (const url of pick(places, SAMPLE)) {
    const page = await get(url);
    if (page.status !== 200) { bad(`${url} returned ${page.status}`); placeProblems++; continue; }
    const before = problems;
    checkHead(page, { url: url.replace(BASE, ''), expectCanonical: url, wantJsonLd: true });
    if (problems > before) placeProblems++;
  }
  if (!placeProblems) good(`every place page checked is sound`);

  console.log(`\nshop pages (${shops.length} in the sitemap, checking ${Math.min(SAMPLE, shops.length)}):`);
  let shopProblems = 0;
  for (const url of pick(shops, SAMPLE)) {
    const page = await get(url);
    if (page.status !== 200) { bad(`${url} returned ${page.status}`); shopProblems++; continue; }
    const before = problems;
    const seen = checkHead(page, { url: url.replace(BASE, ''), expectCanonical: url, wantJsonLd: true });
    if (!/TobaccoShop/.test(page.body)) { bad(`${url}: structured data is not a TobaccoShop`); }
    if (problems > before) shopProblems++;
    void seen;
  }
  if (!shopProblems) good(`every shop page checked is sound`);

  // ── pages that must NOT be indexed ────────────────────────────────────────
  console.log('\npages that should stay out of the index:');
  for (const path of ['/store-dashboard', '/admin', '/login']) {
    const page = await get(`${BASE}${path}`);
    if (!/name="robots" content="noindex/.test(page.body)) bad(`${path} is missing its noindex`);
  }
  good('dashboards and sign-in carry noindex');

  console.log(`\n${problems ? problems + ' problem(s) found' : 'no problems found'}`);
  process.exit(problems ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
