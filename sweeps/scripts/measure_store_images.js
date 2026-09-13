/**
 * How dark is each store thumbnail, as a person actually sees it?
 *
 * Not the image's own brightness — the brightness of the square on screen.
 * StoreThumb draws the image over a backdrop it picks from the URL:
 *
 *     const isLogo = /logo/i.test(src)
 *     backgroundColor: isLogo ? '#F4EEE6' : '#2A2520'
 *     objectFit:       isLogo ? 'contain' : 'cover'
 *
 * So a transparent PNG is composited onto one of those two colours, and a logo
 * drawn in dark ink whose URL does not happen to contain the word "logo" is
 * dark ink on a near-black square. That is the thing to measure, so every pixel
 * here is composited onto the backdrop the component would really use.
 *
 *   node sweeps/scripts/measure_store_images.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { PNG } = require('pngjs');
const jpeg = require('jpeg-js');

const D = path.join(__dirname, '..', 'decisions');
const WORKERS = 8;
const TIMEOUT_MS = 15000;
const MAX_BYTES = 4 * 1024 * 1024;
const REFERER = 'https://cigar-buddy.com/';

/** The two backdrops StoreThumb uses, as RGB. */
const DARK_BACKDROP = [0x2A, 0x25, 0x20];
const CREAM_BACKDROP = [0xF4, 0xEE, 0xE6];

/** Below this, a square reads as "dark" rather than as a picture. */
const DARK_AT = 0.20;
/** And below this it is closer to a black tile than to an image. */
const VERY_DARK_AT = 0.10;

function fetchBuf(url, depth = 0) {
  return new Promise(resolve => {
    if (depth > 4) return resolve(null);
    let u;
    try { u = new URL(url); } catch { return resolve(null); }
    const mod = u.protocol === 'http:' ? http : https;
    const req = mod.get(u, {
      headers: {
        'User-Agent': 'CigarBuddy/1.0 (thumbnail brightness check)',
        Referer: REFERER,
        Accept: 'image/*,*/*',
      },
      timeout: TIMEOUT_MS,
    }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        return resolve(fetchBuf(new URL(res.headers.location, url).toString(), depth + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return resolve(null); }
      const chunks = [];
      let n = 0;
      res.on('data', c => {
        n += c.length;
        if (n <= MAX_BYTES) chunks.push(c);
        else { req.destroy(); resolve(null); }
      });
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

function formatOf(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') return 'png';
  if (buf[0] === 0xFF && buf[1] === 0xD8) return 'jpeg';
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  if (buf.toString('latin1', 0, 3) === 'GIF') return 'gif';
  if (/^\s*(<\?xml|<svg)/i.test(buf.toString('latin1', 0, 200))) return 'svg';
  return null;
}

/**
 * Mean brightness of the square, 0..1, with every pixel composited onto the
 * backdrop first. Gamma-encoded rather than linearised on purpose: the question
 * is how dark it *looks*, and sRGB values track that more closely than linear
 * light does.
 */
function measure(buf, format, backdrop) {
  let w, h, data;
  if (format === 'png') {
    const png = PNG.sync.read(buf);
    ({ width: w, height: h, data } = png);
  } else if (format === 'jpeg') {
    const img = jpeg.decode(buf, { useTArray: true, maxMemoryUsageInMB: 256 });
    ({ width: w, height: h, data } = img);
  } else return null;
  if (!w || !h) return null;

  // Sample rather than read every pixel: ~10k samples is plenty.
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 10000)));
  const samples = [];
  let transparent = 0, inkSum = 0, inkCount = 0;

  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * 4;
      const a = data[i + 3] / 255;
      if (a < 0.5) transparent++;
      // Composite: what the eye receives is the image over the backdrop.
      const r = data[i] * a + backdrop[0] * (1 - a);
      const g = data[i + 1] * a + backdrop[1] * (1 - a);
      const b = data[i + 2] * a + backdrop[2] * (1 - a);
      samples.push((0.2126 * r + 0.7152 * g + 0.0722 * b) / 255);
      // The artwork alone, ignoring whatever shows through it.
      if (a >= 0.5) {
        inkSum += (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
        inkCount++;
      }
    }
  }
  const count = samples.length;
  if (!count) return null;

  const luma = samples.reduce((s, v) => s + v, 0) / count;
  // Spread matters more than the mean. A dim room with a lit sign in it is a
  // photograph; a dim room without one is a black square, and only the spread
  // tells those two apart.
  const variance = samples.reduce((s, v) => s + (v - luma) ** 2, 0) / count;
  const sorted = samples.slice().sort((a, b) => a - b);
  const at = q => sorted[Math.min(count - 1, Math.floor(q * count))];

  return {
    width: w,
    height: h,
    luma,
    contrast: Math.sqrt(variance),
    p05: at(0.05),
    p50: at(0.50),
    p95: at(0.95),
    inkLuma: inkCount ? inkSum / inkCount : null,
    transparentFraction: transparent / count,
  };
}

(async () => {
  const rows = JSON.parse(fs.readFileSync(path.join(D, 'store_images.json'), 'utf8'));
  console.log(`measuring ${rows.length} thumbnails\n`);

  const results = [];
  let done = 0;
  const queue = rows.slice();

  await Promise.all(Array.from({ length: WORKERS }, async () => {
    while (queue.length) {
      const r = queue.shift();
      const buf = await fetchBuf(r.src);
      done++;
      if (done % 50 === 0) process.stdout.write(`  ${done}/${rows.length}\r`);
      if (!buf) { results.push({ ...r, status: 'unreachable' }); continue; }
      const format = formatOf(buf);
      if (!format) { results.push({ ...r, status: 'not an image' }); continue; }
      if (format !== 'png' && format !== 'jpeg') {
        results.push({ ...r, status: 'undecodable', format, bytes: buf.length });
        continue;
      }
      const backdrop = r.treatedAsLogo ? CREAM_BACKDROP : DARK_BACKDROP;
      let m = null;
      try { m = measure(buf, format, backdrop); } catch (e) { /* truncated or odd file */ }
      if (!m) { results.push({ ...r, status: 'undecodable', format, bytes: buf.length }); continue; }
      results.push({ ...r, status: 'ok', format, bytes: buf.length, ...m });
    }
  }));

  fs.writeFileSync(path.join(D, 'store_images_measured.json'), JSON.stringify(results, null, 2));

  const ok = results.filter(r => r.status === 'ok');
  const dark = ok.filter(r => r.luma < DARK_AT).sort((a, b) => a.luma - b.luma);
  const veryDark = ok.filter(r => r.luma < VERY_DARK_AT);
  const clearOnDark = ok.filter(r => !r.treatedAsLogo && r.transparentFraction > 0.25);

  console.log(`\n${'='.repeat(70)}`);
  console.log(`measured            ${ok.length}`);
  for (const s of ['unreachable', 'not an image', 'undecodable']) {
    const n = results.filter(r => r.status === s).length;
    if (n) console.log(`${s.padEnd(20)}${n}`);
  }
  const pct = n => Math.round((100 * n) / (ok.length || 1));
  console.log(`\ndarker than ${DARK_AT}     ${dark.length}  (${pct(dark.length)}% of what was measured)`);
  console.log(`darker than ${VERY_DARK_AT}     ${veryDark.length}  (${pct(veryDark.length)}%)`);
  console.log(`\nsee-through images on the NEAR-BLACK backdrop: ${clearOnDark.length}`);
  console.log(`  of those, darker than ${DARK_AT}: ${clearOnDark.filter(r => r.luma < DARK_AT).length}`);

  // The distinction that decides what to do about each one.
  //   dim but legible  — dark overall, but something in it is bright
  //   featureless      — dark with nothing in it; at 72px, a black square
  const FEATURELESS = r => r.luma < DARK_AT && r.p95 < 0.35 && r.contrast < 0.12;
  const DIM_LEGIBLE = r => r.luma < DARK_AT && !FEATURELESS(r);
  const featureless = ok.filter(FEATURELESS).sort((a, b) => a.luma - b.luma);
  const dimLegible = ok.filter(DIM_LEGIBLE);

  console.log(`\n${'-'.repeat(70)}`);
  console.log(`of the ${dark.length} dark ones:`);
  console.log(`  dim but legible (a lit sign, a face, a bottle)  ${dimLegible.length}`);
  console.log(`  featureless — a black square at thumbnail size  ${featureless.length}`);

  const show = (label, list) => {
    console.log(`\n${label}`);
    for (const r of list) {
      console.log(`  luma ${r.luma.toFixed(3)}  p95 ${r.p95.toFixed(3)}  sd ${r.contrast.toFixed(3)}`
        + `  clear ${String(Math.round(r.transparentFraction * 100)).padStart(3)}%`
        + `  ${r.treatedAsLogo ? 'cream' : 'DARK '}`
        + `  #${String(r.id).padEnd(6)} ${String(r.name).slice(0, 30).padEnd(30)}`);
    }
  };
  show('featureless (these are the black squares):', featureless.slice(0, 25));
  show('dim but legible, darkest first (a lift would help these):',
    dimLegible.sort((a, b) => a.luma - b.luma).slice(0, 12));

  console.log('\nwritten to sweeps/decisions/store_images_measured.json');
  process.exit(0);
})();
