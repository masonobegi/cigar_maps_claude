// Score a shop's actual front page, to test whether a low stored count is the
// shop being thin or our sample being thin.
process.env.PGLITE_DIR = process.env.PGLITE_DIR || require('os').tmpdir() + '/cb-score';
const https = require('https');
const http = require('http');
const { score, siteVerdict } = require('../../server/src/jobs/pureCigarCheck');

const get = (url, d = 0) => new Promise(res => {
  if (d > 4) return res('');
  (url.startsWith('http://') ? http : https).get(url, { headers: { 'User-Agent': 'CigarBuddy/1.0 (self check)' }, timeout: 20000 }, r => {
    if ([301, 302, 303, 307, 308].includes(r.statusCode) && r.headers.location) {
      r.resume(); return res(get(new URL(r.headers.location, url).toString(), d + 1));
    }
    let b = ''; r.setEncoding('utf8');
    r.on('data', c => { if (b.length < 600000) b += c; });
    r.on('end', () => res(b));
  }).on('error', () => res('')).on('timeout', function () { this.destroy(); res(''); });
});

const text = html => String(html).replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ');

(async () => {
  for (const site of (process.env.SITES || '').split(',').filter(Boolean)) {
    const url = site.startsWith('http') ? site : `https://${site}`;
    const body = await get(url);
    const c = score(text(body));
    const v = siteVerdict(c);
    console.log(`${site.padEnd(34)} cigar ${String(c.cigar).padStart(3)}  other ${String(c.other).padStart(3)}  ${v.proven ? 'PROVEN' : 'not proven'}`);
  }
  process.exit(0);
})();
