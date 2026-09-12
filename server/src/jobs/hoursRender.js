/**
 * Read shop websites in a real browser, for the hours the plain reader misses.
 *
 * Many shop sites draw their hours with JavaScript (hours widgets, Wix and
 * GoDaddy builders, store-locator apps), so the HTML the sweep downloads has
 * none. Opening the same page in headless Chrome shows what a visitor sees.
 * Run it on the listings the sweep's `decide` step found no hours for; it
 * writes evidence in the sweep's own format, so `decide` reads it unchanged.
 *
 * Local tool, not part of the deploy: it needs Chrome and puppeteer-core,
 * which the server does not depend on.
 *   npm i --no-save puppeteer-core
 *   node src/jobs/hoursRender.js --skips skips.json --out rendered.jsonl [--tabs 8]
 *   node src/jobs/hoursSweep.js decide --from evidence.jsonl,rendered.jsonl --out decisions.json
 *
 * CHROME_PATH overrides where Chrome is found.
 */
'use strict';

const fs = require('fs');
const db = require('../database/db');
const { candidateLinks, jsonLdBlocks, microdataHours, hoursSnippets, pageText, metaImage } = require('./hoursSweep');

const RETRY_REASONS = ['no hours found', 'site unreachable'];
const CHROME = process.env.CHROME_PATH || (process.platform === 'win32'
  ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
  : '/usr/bin/google-chrome');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const SITE_TIMEOUT_MS = 90000;

async function render(browser, url) {
  const page = await browser.newPage();
  try {
    await page.setUserAgent(UA);
    await page.setViewport({ width: 1280, height: 1800 });
    // Pictures, video and fonts never carry hours; skipping them halves the wait.
    await page.setRequestInterception(true);
    page.on('request', r => {
      const t = r.resourceType();
      if (t === 'image' || t === 'media' || t === 'font') r.abort().catch(() => {}); else r.continue().catch(() => {});
    });
    const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    if (!res || res.status() >= 400) return null;
    await page.waitForNetworkIdle({ idleTime: 800, timeout: 8000 }).catch(() => {});
    // Lazy footers draw on scroll.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
    await new Promise(r => setTimeout(r, 1200));
    let html = await page.content();
    // Hours widgets that live in a frame are folded into the page.
    for (const f of page.frames()) {
      if (f === page.mainFrame()) continue;
      try { const inner = await f.content(); if (/hour|monday|mon\b/i.test(inner)) html += `\n<div>${inner}</div>`; } catch {}
    }
    return { url: page.url(), body: html };
  } catch { return null; } finally { await page.close().catch(() => {}); }
}

async function renderOne(browser, store) {
  const site = /^https?:\/\//i.test(store.website) ? store.website : `https://${store.website}`;
  const home = await render(browser, site);
  if (!home) return { id: store.id, ok: false, rendered: true };
  const pages = [home];
  for (const link of candidateLinks(home.body, home.url)) {
    const p = await render(browser, link);
    if (p) pages.push(p);
  }
  const ev = { id: store.id, ok: true, rendered: true, url: home.url, jsonld: [], microdata: [], text: [], image: null };
  for (const p of pages) {
    ev.jsonld.push(...jsonLdBlocks(p.body));
    ev.microdata.push(...microdataHours(p.body));
    const snip = hoursSnippets(pageText(p.body));
    if (snip.length) ev.text.push({ url: p.url, lines: snip });
    if (!ev.image) ev.image = metaImage(p.body, p.url);
  }
  ev.jsonld = ev.jsonld.filter(b => /openingHours|dayOfWeek|streetAddress|"image"|"logo"/i.test(b)).slice(0, 8);
  return ev;
}

async function renderAll({ skips, out, tabs = 8, includeHidden = false, log = console.log } = {}) {
  if (!skips || !out) throw new Error('usage: --skips skips.json --out rendered.jsonl');
  let puppeteer;
  try { puppeteer = require('puppeteer-core'); } catch {
    throw new Error('puppeteer-core is not installed. Run: npm i --no-save puppeteer-core');
  }
  const wanted = new Set(JSON.parse(fs.readFileSync(skips, 'utf8'))
    .filter(s => RETRY_REASONS.includes(s.skip)).map(s => s.id));
  const done = new Set();
  if (fs.existsSync(out)) {
    for (const line of fs.readFileSync(out, 'utf8').split('\n')) { try { done.add(JSON.parse(line).id); } catch {} }
  }
  // A listing held back for want of hours is exactly the one worth opening in a
  // browser: its site is alive, its address is backed, and the only thing
  // missing is a page the plain reader could not see.
  const stores = (await db.all(`SELECT id, website FROM stores
    WHERE (visible = 1${includeHidden ? " OR storefront = 'unverified'" : ''})
      AND website IS NOT NULL AND website <> ''`))
    .filter(s => wanted.has(s.id) && !done.has(s.id));
  log(`${done.size} already rendered; opening ${stores.length} sites in ${tabs} tabs`);

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu', '--mute-audio'] });
  const stream = fs.createWriteStream(out, { flags: 'a' });
  let next = 0, finished = 0, withText = 0;
  async function worker() {
    while (next < stores.length) {
      const s = stores[next++];
      let ev;
      try {
        ev = await Promise.race([renderOne(browser, s),
          new Promise(r => setTimeout(() => r({ id: s.id, ok: false, rendered: true, error: 'timeout' }), SITE_TIMEOUT_MS))]);
      } catch (e) { ev = { id: s.id, ok: false, rendered: true, error: String(e.message || e).slice(0, 80) }; }
      stream.write(JSON.stringify(ev) + '\n');
      finished++;
      if (ev.ok && ev.text.length) withText++;
      if (finished % 50 === 0) log(`  ${finished}/${stores.length} — ${withText} with hours-like text`);
    }
  }
  await Promise.all(Array.from({ length: tabs }, worker));
  await new Promise(r => stream.end(r));
  await browser.close().catch(() => {});
  log(`done: ${finished} rendered, ${withText} with hours-like text`);
  return { rendered: finished, withText };
}

module.exports = { renderAll, renderOne };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const arg = name => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : null; };
  renderAll({ skips: arg('--skips'), out: arg('--out'), tabs: Number(arg('--tabs')) || 8,
    includeHidden: argv.includes('--include-hidden') })
    .then(() => process.exit(0))
    .catch(err => { console.error(err.message || err); process.exit(1); });
}
