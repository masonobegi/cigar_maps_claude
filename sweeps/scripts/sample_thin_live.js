/**
 * Score the "says little either way" shops on their real front pages.
 *
 * The stored counts came from the hours crawl, which kept only the lines around
 * each "Hours" heading — so a low count may be our sample rather than the shop.
 * Tampa Sweethearts stored cigar=1 and its front page says cigar 72. This
 * measures how general that is instead of arguing from four examples.
 */
process.env.PGLITE_DIR = process.env.PGLITE_DIR || require('os').tmpdir() + '/cb-score';
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { score, siteVerdict } = require('../../server/src/jobs/pureCigarCheck');

const get = (url, d = 0) => new Promise(res => {
  if (d > 4) return res('');
  const lib = url.startsWith('http://') ? http : https;
  const req = lib.get(url, { headers: { 'User-Agent': 'CigarBuddy/1.0 (self check)' }, timeout: 20000 }, r => {
    if ([301, 302, 303, 307, 308].includes(r.statusCode) && r.headers.location) {
      r.resume();
      let next; try { next = new URL(r.headers.location, url).toString(); } catch { return res(''); }
      return res(get(next, d + 1));
    }
    let b = ''; r.setEncoding('utf8');
    r.on('data', c => { if (b.length < 600000) b += c; });
    r.on('end', () => res(b));
  });
  req.on('error', () => res(''));
  req.on('timeout', () => { req.destroy(); res(''); });
});

const text = html => String(html).replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ');

(async () => {
  const doc = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'decisions', 'proved_by_site.json'), 'utf8'));
  const pool = (doc.thin || []).filter(r => r.website);
  const n = Number(process.env.N || 40);
  const step = Math.max(1, Math.floor(pool.length / n));
  const sample = pool.filter((_, i) => i % step === 0).slice(0, n);

  console.log(`scoring ${sample.length} of ${pool.length} "says little either way" shops on their real front pages\n`);
  let proven = 0, another = 0, stillThin = 0, dead = 0;
  const failures = [];
  for (const r of sample) {
    const url = /^https?:\/\//i.test(r.website) ? r.website : `https://${r.website}`;
    const body = await get(url);
    if (!body) { dead++; continue; }
    const c = score(text(body));
    const v = siteVerdict(c);
    if (v.proven) proven++;
    else if (c.other > c.cigar) { another++; failures.push({ ...r, ...c, verdict: 'another trade' }); }
    else { stillThin++; failures.push({ ...r, ...c, verdict: 'still thin' }); }
  }
  const read = sample.length - dead;
  console.log(`of ${read} that answered:`);
  console.log(`  their own page proves them:   ${proven}  (${((100 * proven) / read).toFixed(0)}%)`);
  console.log(`  still says little:            ${stillThin}`);
  console.log(`  says more about another trade:${another}`);
  console.log(`  did not answer:               ${dead}`);
  if (failures.length) {
    console.log('\nthe ones that did not clear:');
    for (const f of failures) console.log(`   #${String(f.id).padEnd(6)}${String(f.name).slice(0, 30).padEnd(32)}cigar ${String(f.cigar).padStart(3)} other ${String(f.other).padStart(3)}  ${f.website}`);
  }
  process.exit(0);
})();
