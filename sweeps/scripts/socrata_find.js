// Find a Socrata dataset by keyword, so a stale dataset id can be replaced.
const https = require('https');
const get = url => new Promise((res, rej) => {
  https.get(url, { headers: { 'User-Agent': 'CigarBuddy/1.0 (registry lookup)' } }, r => {
    let b = ''; r.setEncoding('utf8'); r.on('data', c => b += c); r.on('end', () => res({ status: r.statusCode, body: b }));
  }).on('error', rej);
});
(async () => {
  const domain = process.env.DOMAIN, q = encodeURIComponent(process.env.Q || 'tobacco');
  const r = await get(`https://api.us.socrata.com/api/catalog/v1?q=${q}&domains=${domain}&limit=8`);
  if (r.status !== 200) { console.log('catalog', r.status, r.body.slice(0, 200)); process.exit(0); }
  const j = JSON.parse(r.body);
  for (const x of j.results || []) {
    console.log(`${x.resource.id}  ${x.resource.name}`);
    console.log(`    rows ${x.resource.columns_field_name ? x.resource.columns_field_name.length + ' cols' : ''}  updated ${String(x.resource.updatedAt).slice(0,10)}`);
    console.log(`    ${(x.resource.columns_field_name || []).slice(0, 16).join(', ')}`);
  }
  process.exit(0);
})().catch(e => { console.error(String(e)); process.exit(1); });
