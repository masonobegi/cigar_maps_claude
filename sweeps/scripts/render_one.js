// Print what a visitor sees on a page: headless Chrome, visible text only
// (document.body.innerText skips hidden blocks). Usage: node render_one.js <url>
const puppeteer = require('puppeteer-core');
(async () => {
  const url = process.argv[2];
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-sandbox', '--disable-gpu'] });
  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1280, height: 1800 });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForNetworkIdle({ idleTime: 800, timeout: 10000 }).catch(() => {});
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
    await new Promise(r => setTimeout(r, 1500));
    let text = await page.evaluate(() => document.body.innerText);
    for (const f of page.frames()) {
      if (f === page.mainFrame()) continue;
      try { const t = await f.evaluate(() => document.body && document.body.innerText); if (t && /hour|monday|mon\b/i.test(t)) text += '\n[iframe ' + f.url() + ']\n' + t; } catch {}
    }
    console.log('URL: ' + page.url());
    console.log(text.replace(/\n{3,}/g, '\n\n').slice(0, 20000));
  } catch (e) { console.log('ERROR ' + e.message); } finally { await browser.close(); }
})();
