/**
 * The favicon and the link-preview card, drawn once and committed.
 *
 * The site shipped with neither. A browser tab showed the grey globe every
 * browser shows when a site has not bothered, and a link texted to somebody
 * arrived as a bare grey rectangle — which is what most people see first, since
 * a directory spreads by being sent to a friend.
 *
 * There were PWA icons from an old build, but they carry the words CIGAR BUDDY
 * across the middle, and at 16px that is four grey smudges. A favicon has to
 * work at 16px or it is not a favicon, so the mark here is the cigar alone:
 * a dark square, one bright diagonal, one lit ember. Three shapes survive the
 * shrink.
 *
 * Rendered rather than hand-drawn so the same source produces every size, and
 * so the card can be regenerated when the wording changes. The output is
 * committed, so nothing here runs in production and no image library ships.
 *
 *   node sweeps/scripts/make_brand_assets.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const { Resvg } = require('@resvg/resvg-js');

const OUT = path.join(__dirname, '..', '..', 'client', 'public');
const FONT_DIR = path.join(require('os').tmpdir(), 'cigarbuddy-fonts');

/** The palette, taken from the stylesheet rather than invented here. */
const C = {
  groundTop: '#241C14',
  groundBottom: '#120E0A',
  page: '#17130E',
  cream: '#F3E6D3',
  gold: '#C8963C',
  band: '#D4882A',
  muted: '#9C8B79',
  rule: '#453C2E',
};

const FONTS = {
  playfair: 'https://raw.githubusercontent.com/google/fonts/main/ofl/playfairdisplay/PlayfairDisplay%5Bwght%5D.ttf',
  inter: 'https://raw.githubusercontent.com/google/fonts/main/ofl/inter/Inter%5Bopsz%2Cwght%5D.ttf',
};

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const go = (u, depth = 0) => {
      if (depth > 5) return reject(new Error('too many redirects'));
      https.get(u, { headers: { 'User-Agent': 'CigarBuddy/1.0 (brand assets)' } }, res => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          return go(new URL(res.headers.location, u).toString(), depth + 1);
        }
        if (res.statusCode !== 200) { res.resume(); return reject(new Error(`${res.statusCode} for ${u}`)); }
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => { fs.writeFileSync(dest, Buffer.concat(chunks)); resolve(dest); });
      }).on('error', reject);
    };
    go(url);
  });
}

async function fonts() {
  fs.mkdirSync(FONT_DIR, { recursive: true });
  const paths = [];
  for (const [name, url] of Object.entries(FONTS)) {
    const dest = path.join(FONT_DIR, `${name}.ttf`);
    if (!fs.existsSync(dest) || fs.statSync(dest).size < 5000) {
      process.stdout.write(`  fetching ${name}… `);
      await download(url, dest);
      console.log(`${fs.statSync(dest).size} bytes`);
    }
    paths.push(dest);
  }
  return paths;
}

/**
 * The mark. `ground` false gives the cigar alone on transparency, for laying
 * over a background that is already dark.
 */
function markSvg(size, { ground = true, radius = 0.22 } = {}) {
  const r = Math.round(size * radius);
  // A cigar is a cylinder with one end cut flat and burning. The first attempt
  // put a ball on a stick and read as a match, so: the wrapper is shaded across
  // its axis rather than along it, the head end is domed, the foot is a flat
  // face of ash with the fire inside it, and the band sits a third of the way
  // up rather than hanging off the end.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${C.groundTop}"/><stop offset="1" stop-color="${C.groundBottom}"/>
    </linearGradient>
    <linearGradient id="b" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#6B4220"/><stop offset="0.30" stop-color="#C08B3E"/>
      <stop offset="0.62" stop-color="#96632C"/><stop offset="1" stop-color="#523118"/>
    </linearGradient>
    <linearGradient id="bd" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#E8A94C"/><stop offset="0.35" stop-color="${C.band}"/>
      <stop offset="1" stop-color="#9A6220"/>
    </linearGradient>
    <radialGradient id="e" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#FFF3D6"/><stop offset="0.42" stop-color="#FF9A2E"/>
      <stop offset="1" stop-color="#B3330A"/>
    </radialGradient>
    <radialGradient id="gl" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#FF9A2E" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#FF9A2E" stop-opacity="0"/>
    </radialGradient>
  </defs>
  ${ground ? `<rect width="64" height="64" rx="${(r / size) * 64}" fill="url(#g)"/>` : ''}
  <g transform="rotate(-38 32 32)">
    <circle cx="49.5" cy="32" r="11" fill="url(#gl)"/>
    <path d="M16.8 27.2 H49.2 V36.8 H16.8 A4.8 4.8 0 0 1 16.8 27.2 Z" fill="url(#b)"/>
    <rect x="21.5" y="27.2" width="6.4" height="9.6" fill="url(#bd)"/>
    <rect x="21.5" y="27.2" width="6.4" height="9.6" fill="none" stroke="#7A4E24" stroke-width="0.45"/>
    <ellipse cx="49.2" cy="32" rx="2.1" ry="4.8" fill="#7C7166"/>
    <ellipse cx="49.6" cy="32" rx="1.35" ry="3.4" fill="url(#e)"/>
  </g>
</svg>`;
}

/** The 1200x630 card a texted link turns into. */
function cardSvg() {
  // Inlined twice at very different sizes. The <svg> wrapper is kept rather
  // than stripped: it carries the viewBox, and without it the contents fall
  // back to the parent's coordinates and render at 64px whatever size was
  // asked for — which is exactly what the first draft did.
  //
  // Ids are namespaced per copy, because nesting does not give a copy its own
  // id space and two defs sharing an id is one silently wrong fill.
  const inline = (px, tag, opts) => markSvg(px, opts)
    .replace(/id="(g|b|bd|e|gl)"/g, `id="${tag}$1"`)
    .replace(/url\(#(g|b|bd|e|gl)\)/g, `url(#${tag}$1)`);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <radialGradient id="page" cx="0.22" cy="0.28" r="0.85">
      <stop offset="0" stop-color="#2C2118"/><stop offset="1" stop-color="${C.page}"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#page)"/>

  <!-- The mark again, oversized and bled off the right edge, so the empty half
       of the card is doing something without competing with the words. -->
  <g transform="translate(690, 20)" opacity="0.11">${inline(620, 'big', { ground: false })}</g>

  <rect x="0" y="0" width="1200" height="7" fill="${C.gold}"/>

  <g transform="translate(96, 96)">${inline(152, 'm', { ground: true, radius: 0.24 })}</g>

  <text x="94" y="382" font-family="Playfair Display" font-weight="700" font-size="96" fill="${C.cream}">CigarBuddy</text>
  <text x="99" y="444" font-family="Inter" font-weight="500" font-size="35" fill="${C.gold}">Find a proper cigar shop near you</text>

  <rect x="99" y="488" width="88" height="2" fill="#6A5A44"/>

  <text x="99" y="538" font-family="Inter" font-weight="400" font-size="25" fill="${C.muted}">Opening hours read from each shop&#8217;s own website.</text>
  <text x="99" y="574" font-family="Inter" font-weight="400" font-size="25" fill="${C.muted}">Real cigar shops only &#8212; no vape counters.</text>

  <text x="1104" y="574" text-anchor="end" font-family="Inter" font-weight="600" font-size="24" fill="#8A7862">cigar-buddy.com</text>
</svg>`;
}

function png(svg, fontFiles, width) {
  const r = new Resvg(svg, {
    font: { fontFiles, loadSystemFonts: false, defaultFontFamily: 'Inter' },
    ...(width ? { fitTo: { mode: 'width', value: width } } : {}),
  });
  return r.render().asPng();
}

(async () => {
  const fontFiles = await fonts();
  fs.mkdirSync(OUT, { recursive: true });

  // An SVG favicon is what a modern browser prefers, and it never blurs.
  const svgIcon = markSvg(64);
  fs.writeFileSync(path.join(OUT, 'favicon.svg'), svgIcon);
  console.log(`  favicon.svg           ${svgIcon.length} bytes`);

  // PNG fallbacks, because Safari and every link-scraper still want them.
  for (const size of [16, 32, 48, 180, 512]) {
    const name = size === 180 ? 'apple-touch-icon.png' : `favicon-${size}.png`;
    const buf = png(markSvg(size), fontFiles, size);
    fs.writeFileSync(path.join(OUT, name), buf);
    console.log(`  ${name.padEnd(22)}${buf.length} bytes`);
  }

  const card = png(cardSvg(), fontFiles, 1200);
  fs.writeFileSync(path.join(OUT, 'og.png'), card);
  console.log(`  og.png                ${card.length} bytes  (1200x630)`);

  console.log(`\nwritten to ${OUT}`);
})().catch(e => { console.error(e); process.exit(1); });
