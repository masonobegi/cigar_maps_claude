// The visible text of a page, for judging a listing by its own site.
// Deliberately standalone: no database, no job imports.
const https = require('https');
const http = require('http');

const UA = 'CigarBuddy/1.0 (+https://cigarmapsclaude-production.up.railway.app; listing check)';

function get(url, depth = 0) {
  return new Promise(resolve => {
    if (depth > 4) return resolve({ status: 0, url, body: '' });
    const mod = url.startsWith('http://') ? http : https;
    const req = mod.get(url, { headers: { 'User-Agent': UA, Accept: 'text/html,*/*' }, timeout: 15000 }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        return resolve(get(new URL(res.headers.location, url).toString(), depth + 1));
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', c => { if (body.length < 400000) body += c; });
      res.on('end', () => resolve({ status: res.statusCode, url, body }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, url, body: '' }); });
    req.on('error', e => resolve({ status: 0, url, body: '', error: String(e.message || e) }));
  });
}

const text = html => String(html || '')
  .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, ' ')
  .replace(/<[^>]+>/g, '\n')
  .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  .split('\n').map(s => s.trim()).filter(Boolean).join('\n');

(async () => {
  const url = process.env.URL.startsWith('http') ? process.env.URL : `https://${process.env.URL}`;
  const r = await get(url);
  console.log(`status ${r.status} ${r.url}${r.error ? '  ' + r.error : ''}`);
  console.log(text(r.body).slice(0, Number(process.env.CHARS || 2000)));
})();
