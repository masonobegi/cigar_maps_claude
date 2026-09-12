// Sites that gave no text to a plain download get one more chance in a real
// browser, so a shop is never hidden because its site is built in JavaScript.
const fs = require('fs');
const puppeteer = require('puppeteer-core');
const S = 'C:/Users/mason/AppData/Local/Temp/claude/c--Users-mason-OneDrive-Desktop-cigarApp/a956c8ab-bec6-4085-b83b-7fcd97853bc4/scratchpad';
const { score } = require('C:/Users/mason/OneDrive/Desktop/cigarApp/server/src/jobs/pureCigarCheck');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

const { toRead } = JSON.parse(fs.readFileSync(`${S}/decisions/pure_names.json`, 'utf8'));
const byId = new Map(toRead.map(r => [r.id, r]));
const weak = [];
for (const line of fs.readFileSync(`${S}/decisions/pure_evidence.jsonl`, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  let e; try { e = JSON.parse(line); } catch { continue; }
  // Nothing readable, or so little that a plain download plainly missed the page.
  if (!e.ok || (e.cigar < 5 && e.other < 5)) weak.push(e.id);
}
const out = `${S}/decisions/pure_evidence_rendered.jsonl`;
const done = new Set();
if (fs.existsSync(out)) for (const l of fs.readFileSync(out, 'utf8').split('\n')) { try { done.add(JSON.parse(l).id); } catch {} }
const queue = weak.filter(id => !done.has(id) && byId.has(id));

(async () => {
  console.log(`${weak.length} sites gave too little to a plain download; rendering ${queue.length}`);
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu', '--mute-audio'] });
  const stream = fs.createWriteStream(out, { flags: 'a' });
  let next = 0, n = 0, rescued = 0;
  async function worker() {
    while (next < queue.length) {
      const id = queue[next++];
      const r = byId.get(id);
      const site = /^https?:\/\//i.test(r.website) ? r.website : `https://${r.website}`;
      let text = '';
      const page = await browser.newPage();
      try {
        await page.setUserAgent(UA);
        await page.setViewport({ width: 1280, height: 1600 });
        await page.setRequestInterception(true);
        page.on('request', q => { const t = q.resourceType(); if (t === 'image' || t === 'media' || t === 'font') q.abort().catch(() => {}); else q.continue().catch(() => {}); });
        const res = await page.goto(site, { waitUntil: 'domcontentloaded', timeout: 25000 });
        if (res && res.status() < 400) {
          await page.waitForNetworkIdle({ idleTime: 800, timeout: 8000 }).catch(() => {});
          text = await page.evaluate(() => document.body ? document.body.innerText : '');
        }
      } catch {} finally { await page.close().catch(() => {}); }
      const counts = score(text);
      if (counts.cigar >= 5) rescued++;
      stream.write(JSON.stringify({ id, ok: !!text, ...counts, rendered: true }) + '\n');
      n++;
      if (n % 50 === 0) console.log(`  ${n}/${queue.length} rendered, ${rescued} now show a cigar shop`);
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));
  await new Promise(r => stream.end(r));
  await browser.close().catch(() => {});
  console.log(`done: ${n} rendered, ${rescued} show a cigar shop that the plain download missed`);
  process.exit(0);
})();
