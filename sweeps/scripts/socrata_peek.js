const https = require('https');
const get = url => new Promise((res, rej) => {
  https.get(url, { headers: { 'User-Agent': 'CigarBuddy/1.0 (registry lookup)' } }, r => {
    let b = ''; r.setEncoding('utf8'); r.on('data', c => b += c); r.on('end', () => res({ status: r.statusCode, body: b }));
  }).on('error', rej);
});
(async () => {
  const r = await get(process.env.URL);
  console.log('status', r.status);
  try {
    const j = JSON.parse(r.body);
    console.log(Array.isArray(j) ? `${j.length} rows` : 'object');
    console.log(JSON.stringify(Array.isArray(j) ? j[0] : j, null, 1).slice(0, Number(process.env.CHARS || 1200)));
  } catch { console.log(r.body.slice(0, 600)); }
  process.exit(0);
})().catch(e => { console.error(String(e)); process.exit(1); });
