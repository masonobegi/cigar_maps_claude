/**
 * What a search engine and a shared link see.
 *
 * The client is a single-page React app: one index.html for every URL. So every
 * one of the shop pages served the same <title>, the same description, and —
 * worst of all — the same `<link rel="canonical" href="https://…/">`, which is
 * an instruction to a crawler saying "this page is a copy of the homepage, do
 * not index it". Nothing could rank, and a link pasted into a message showed
 * the site's name rather than the shop's.
 *
 * This rewrites the head per route before the HTML is sent. No server-side
 * rendering and no build step: the React app hydrates over the same markup it
 * always did, and only the tags a crawler reads before running JavaScript
 * change. A shop page also carries LocalBusiness JSON-LD, which is what puts
 * hours and a telephone number into a search result — and hours read off the
 * shop's own website are the thing this directory has that the map data does
 * not.
 *
 * Pure functions below the fetch, so:  node src/utils/seo.js selftest
 */
'use strict';

const fs = require('fs');
const path = require('path');

const DAYS = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' };

const SITE_NAME = 'CigarBuddy';
const DEFAULT_TITLE = 'CigarBuddy — find a proper cigar shop near you';
const DEFAULT_DESC = 'A directory of real cigar shops: opening hours read from each shop\'s own website, '
  + 'walk-in humidors, lounges you can sit and smoke in, and what they have in stock.';

/** Text going into an attribute or an element. */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Text going inside a <script type="application/ld+json"> block. */
function escJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

/** "10am-7pm" → { opens: '10:00', closes: '19:00' }, or null. */
function hoursSpec(range) {
  const m = /^(\d{1,2})(?::(\d{2}))?(am|pm)-(\d{1,2})(?::(\d{2}))?(am|pm)/i.exec(String(range || '').trim());
  if (!m) return null;
  const to24 = (h, mm, ap) => {
    let hh = Number(h) % 12;
    if (ap.toLowerCase() === 'pm') hh += 12;
    return `${String(hh).padStart(2, '0')}:${mm || '00'}`;
  };
  return { opens: to24(m[1], m[2], m[3]), closes: to24(m[4], m[5], m[6]) };
}

/**
 * schema.org LocalBusiness for one shop. Only facts we hold are emitted: a
 * field we are unsure of is left out rather than guessed, because structured
 * data that disagrees with the page is worse than none.
 */
function storeJsonLd(store, url) {
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'TobaccoShop',
    name: store.name,
    '@id': url,
    url,
  };
  if (store.address) {
    ld.address = {
      '@type': 'PostalAddress',
      streetAddress: store.address,
      addressLocality: store.city || undefined,
      addressRegion: store.state || undefined,
      postalCode: store.zip || undefined,
      addressCountry: 'US',
    };
  }
  if (store.lat && store.lng) {
    ld.geo = { '@type': 'GeoCoordinates', latitude: Number(store.lat), longitude: Number(store.lng) };
  }
  if (store.phone) ld.telephone = store.phone;
  if (store.website) ld.sameAs = [/^https?:\/\//i.test(store.website) ? store.website : `https://${store.website}`];
  if (store.web_image_url) ld.image = store.web_image_url;

  // Hours only when they came from the shop's own site. Map hours are shown on
  // the page as unconfirmed, and a search result has no room for that caveat.
  let hours = null;
  try { hours = store.hours_source === 'website' && store.hours ? JSON.parse(store.hours) : null; } catch { hours = null; }
  if (hours) {
    const spec = [];
    for (const [short, full] of Object.entries(DAYS)) {
      const value = hours[short];
      if (!value) continue;
      if (/^closed$/i.test(String(value).trim())) continue;
      // A day written as two shifts becomes two specifications, which is what
      // schema.org expects and what keeps the break out of the opening hours.
      for (const part of String(value).split(',')) {
        const r = hoursSpec(part);
        if (r) spec.push({ '@type': 'OpeningHoursSpecification', dayOfWeek: `https://schema.org/${full}`, opens: r.opens, closes: r.closes });
      }
    }
    if (spec.length) ld.openingHoursSpecification = spec;
  }
  return ld;
}

/** The sentence under the shop's name in a search result. */
function storeDescription(store) {
  const where = [store.city, store.state].filter(Boolean).join(', ');
  const bits = [];
  if (Number(store.has_lounge) === 1) bits.push('a lounge to sit and smoke in');
  if (Number(store.has_walk_in_humidor) === 1) bits.push('a walk-in humidor');
  const has = bits.length ? ` with ${bits.join(' and ')}` : '';
  const hours = store.hours_source === 'website' ? ' Opening hours read from the shop\'s own website.' : '';
  return `${store.name} is a cigar shop${where ? ` in ${where}` : ''}${has}.${hours} Address, phone and directions on CigarBuddy.`;
}

/** Everything the head needs for one page. */
function metaFor({ pathname, store = null, base }) {
  const url = `${base}${pathname}`;
  if (store) {
    const where = [store.city, store.state].filter(Boolean).join(', ');
    return {
      title: `${store.name}${where ? ` — ${where}` : ''} | ${SITE_NAME}`,
      description: storeDescription(store),
      canonical: url,
      image: store.web_image_url || null,
      jsonld: storeJsonLd(store, url),
      robots: null,
    };
  }
  if (pathname === '/stores') {
    return {
      title: `Cigar shops near you | ${SITE_NAME}`,
      description: 'Every cigar shop in the directory, with opening hours, lounges and walk-in humidors.',
      canonical: `${base}/stores`, image: null, jsonld: null, robots: null,
    };
  }
  if (pathname === '/' || pathname === '') {
    return { title: DEFAULT_TITLE, description: DEFAULT_DESC, canonical: `${base}/`, image: null, jsonld: null, robots: null };
  }
  // A page behind a login, or one with nothing to say to a crawler: keep it out
  // of the index rather than letting it compete with the pages that matter.
  const private_ = /^\/(dashboard|store-dashboard|admin|passport|login|register|reset-password|verify-email|forgot-password|calendar)\b/.test(pathname);
  return {
    title: DEFAULT_TITLE, description: DEFAULT_DESC, canonical: `${base}${pathname}`,
    image: null, jsonld: null, robots: private_ ? 'noindex, follow' : null,
  };
}

/**
 * Put the meta into the built index.html.
 *
 * The tags the build ships are removed rather than added to: two canonicals or
 * two titles is worse than the one wrong tag we started with.
 */
function render(template, meta) {
  let html = String(template);
  html = html
    .replace(/<title>[\s\S]*?<\/title>/i, '')
    .replace(/<meta\s+name="description"[^>]*>/i, '')
    .replace(/<meta\s+property="og:[^"]*"[^>]*>/gi, '')
    .replace(/<meta\s+name="twitter:[^"]*"[^>]*>/gi, '')
    .replace(/<link\s+rel="canonical"[^>]*>/i, '');

  const tags = [
    `<title>${esc(meta.title)}</title>`,
    `<meta name="description" content="${esc(meta.description)}">`,
    `<link rel="canonical" href="${esc(meta.canonical)}">`,
    `<meta property="og:site_name" content="${esc(SITE_NAME)}">`,
    `<meta property="og:title" content="${esc(meta.title)}">`,
    `<meta property="og:description" content="${esc(meta.description)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:url" content="${esc(meta.canonical)}">`,
    `<meta name="twitter:card" content="${meta.image ? 'summary_large_image' : 'summary'}">`,
    `<meta name="twitter:title" content="${esc(meta.title)}">`,
    `<meta name="twitter:description" content="${esc(meta.description)}">`,
  ];
  if (meta.image) {
    tags.push(`<meta property="og:image" content="${esc(meta.image)}">`);
    tags.push(`<meta name="twitter:image" content="${esc(meta.image)}">`);
  }
  if (meta.robots) tags.push(`<meta name="robots" content="${esc(meta.robots)}">`);
  if (meta.jsonld) tags.push(`<script type="application/ld+json">${escJson(meta.jsonld)}</script>`);

  return html.replace(/<\/head>/i, `${tags.join('\n    ')}\n  </head>`);
}

/** One <url> block. */
function urlEntry(loc, lastmod, priority) {
  return `  <url><loc>${esc(loc)}</loc>${lastmod ? `<lastmod>${esc(lastmod)}</lastmod>` : ''}`
    + `${priority ? `<priority>${priority}</priority>` : ''}</url>`;
}

function sitemapXml(entries) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join('\n')}\n</urlset>\n`;
}

function sitemapIndexXml(locs) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
    + locs.map(l => `  <sitemap><loc>${esc(l)}</loc></sitemap>`).join('\n') + `\n</sitemapindex>\n`;
}

function robotsTxt(base) {
  return [
    'User-agent: *',
    'Allow: /',
    'Disallow: /admin',
    'Disallow: /dashboard',
    'Disallow: /store-dashboard',
    'Disallow: /api/',
    '',
    `Sitemap: ${base}/sitemap.xml`,
    '',
  ].join('\n');
}

// ── wiring ──────────────────────────────────────────────────────────────────

const PAGE_SIZE = 5000;
const SITEMAP_TTL_MS = 60 * 60 * 1000;

/**
 * Mounts the crawler's half of the site: robots, sitemaps, and an index.html
 * whose head is true for the URL that asked for it. Call it after the API
 * routes and the static middleware, in place of the catch-all.
 */
function mount(app, { clientDist, db, log = console.log } = {}) {
  const indexPath = path.join(clientDist, 'index.html');
  let template = null;
  const readTemplate = () => {
    if (template === null && fs.existsSync(indexPath)) template = fs.readFileSync(indexPath, 'utf8');
    return template;
  };
  const baseOf = req => (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');

  app.get('/robots.txt', (req, res) => {
    res.type('text/plain').send(robotsTxt(baseOf(req)));
  });

  let cache = { at: 0, base: null, index: null, pages: new Map() };
  const buildSitemaps = async base => {
    if (cache.base === base && Date.now() - cache.at < SITEMAP_TTL_MS) return cache;
    const rows = await db.all(
      'SELECT id, updated_at FROM stores WHERE visible = 1 ORDER BY id').catch(() => []);
    const pages = new Map();
    for (let i = 0; i < Math.max(1, Math.ceil(rows.length / PAGE_SIZE)); i++) {
      const slice = rows.slice(i * PAGE_SIZE, (i + 1) * PAGE_SIZE);
      pages.set(i + 1, sitemapXml(slice.map(r => urlEntry(`${base}/stores/${r.id}`,
        r.updated_at ? new Date(r.updated_at).toISOString().slice(0, 10) : null, '0.8'))));
    }
    const index = sitemapIndexXml([`${base}/sitemap-main.xml`, ...[...pages.keys()].map(p => `${base}/sitemap-stores-${p}.xml`)]);
    cache = { at: Date.now(), base, index, pages };
    log(`[seo] sitemap built: ${rows.length} shop pages in ${pages.size} file${pages.size === 1 ? '' : 's'}`);
    return cache;
  };

  app.get('/sitemap.xml', async (req, res) => {
    const base = baseOf(req);
    res.type('application/xml').send((await buildSitemaps(base)).index);
  });
  app.get('/sitemap-main.xml', (req, res) => {
    const base = baseOf(req);
    res.type('application/xml').send(sitemapXml([
      urlEntry(`${base}/`, null, '1.0'),
      urlEntry(`${base}/stores`, null, '0.9'),
      urlEntry(`${base}/deals`, null, '0.5'),
    ]));
  });
  app.get('/sitemap-stores-:page.xml', async (req, res) => {
    const base = baseOf(req);
    const built = await buildSitemaps(base);
    const body = built.pages.get(Number(req.params.page));
    if (!body) return res.status(404).type('text/plain').send('no such sitemap page');
    res.type('application/xml').send(body);
  });

  app.get('*', async (req, res) => {
    const html = readTemplate();
    if (html === null) return res.status(404).send(`index.html not found at: ${indexPath}`);

    const base = baseOf(req);
    let store = null;
    const m = /^\/stores\/(\d+)\b/.exec(req.path);
    if (m) {
      store = await db.get(`SELECT id, name, address, city, state, zip, phone, website, lat, lng,
        hours, hours_source, has_lounge, has_walk_in_humidor, web_image_url
        FROM stores WHERE id = ? AND visible = 1`, [Number(m[1])]).catch(() => null);
    }
    res.type('html').send(render(html, metaFor({ pathname: req.path, store, base })));
  });
}

module.exports = { mount, metaFor, render, storeJsonLd, storeDescription, hoursSpec, esc, escJson,
  sitemapXml, sitemapIndexXml, robotsTxt, urlEntry, selftest };

// ── self-test ───────────────────────────────────────────────────────────────
function selftest() {
  let pass = 0, fail = 0;
  const ok = (cond, label, extra) => {
    if (cond) { pass++; console.log(`  ok   ${label}`); }
    else { fail++; console.log(`  FAIL ${label}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ''}`); }
  };

  const base = 'https://cigarbuddy.com';
  const shop = {
    id: 223, name: 'Central Cigars', address: '273 Central Ave', city: 'St Petersburg', state: 'FL',
    zip: '33701', phone: '(727) 222-2226', website: 'centralcigarsdtsp.com', lat: 27.77, lng: -82.64,
    hours: JSON.stringify({ Mon: '10am-12am', Fri: '10am-3am', Sun: 'Closed' }), hours_source: 'website',
    has_lounge: 1, has_walk_in_humidor: 0, web_image_url: null,
  };

  // The bug this file exists for: every page claimed to be the homepage.
  const template = '<html><head><title>CigarBuddy — Find Your Next Smoke</title>'
    + '<meta name="description" content="old">'
    + '<link rel="canonical" href="https://cigarbuddy.com" />'
    + '<meta property="og:title" content="old" /></head><body><div id="root"></div></body></html>';
  const page = render(template, metaFor({ pathname: '/stores/223', store: shop, base }));
  ok((page.match(/<link rel="canonical"/g) || []).length === 1, 'exactly one canonical survives',
    (page.match(/<link rel="canonical"[^>]*>/g) || []));
  ok(page.includes('<link rel="canonical" href="https://cigarbuddy.com/stores/223">'),
    'and it points at this page, not the homepage');
  ok((page.match(/<title>/g) || []).length === 1 && page.includes('<title>Central Cigars — St Petersburg, FL | CigarBuddy</title>'),
    'one title, naming the shop and its town');
  ok(!page.includes('content="old"'), 'the build\u2019s placeholder tags are gone, not merely outranked');
  ok(page.includes('<div id="root">'), 'and the app still has something to hydrate into');

  // Structured data.
  const ld = storeJsonLd(shop, `${base}/stores/223`);
  ok(ld['@type'] === 'TobaccoShop' && ld.address.addressLocality === 'St Petersburg', 'a shop is a TobaccoShop with an address', ld['@type']);
  ok(ld.openingHoursSpecification.length === 2, 'only the days it is open become specifications',
    ld.openingHoursSpecification);
  ok(ld.openingHoursSpecification[0].opens === '10:00' && ld.openingHoursSpecification[0].closes === '00:00',
    'and midnight closes come out as 00:00', ld.openingHoursSpecification[0]);
  const split = storeJsonLd({ ...shop, hours: JSON.stringify({ Fri: '12pm-6pm, 7pm-10pm' }) }, base);
  ok(split.openingHoursSpecification.length === 2
    && split.openingHoursSpecification[1].opens === '19:00',
    'a day written as two shifts becomes two specifications, so the break is not published as open',
    split.openingHoursSpecification);
  const mapHours = storeJsonLd({ ...shop, hours_source: 'map' }, base);
  ok(!mapHours.openingHoursSpecification,
    'hours we only have from map data never reach a search result, where the "unconfirmed" label cannot follow them');
  ok(!storeJsonLd({ name: 'X' }, base).telephone, 'a field we do not hold is left out, not guessed');

  // Escaping: a shop name with an ampersand or a quote must not break the head.
  const tricky = render(template, metaFor({ pathname: '/stores/1', base,
    store: { ...shop, name: 'Smith & Sons "Fine" Cigars <b>', hours: null, hours_source: null } }));
  ok(tricky.includes('Smith &amp; Sons &quot;Fine&quot; Cigars &lt;b&gt;'), 'a name with markup in it is escaped');
  ok(!/<b>/.test(tricky.split('</head>')[0]), 'and cannot inject a tag into the head');

  // Pages that should stay out of the index.
  ok(metaFor({ pathname: '/store-dashboard', base }).robots === 'noindex, follow', 'a dashboard is noindex');
  ok(metaFor({ pathname: '/stores', base }).robots === null, 'the directory itself is indexable');
  ok(metaFor({ pathname: '/', base }).canonical === 'https://cigarbuddy.com/', 'the homepage canonical keeps its slash');

  // robots.txt and the sitemaps.
  const robots = robotsTxt(base);
  ok(robots.includes('Sitemap: https://cigarbuddy.com/sitemap.xml'), 'robots.txt names the sitemap');
  ok(robots.includes('Disallow: /admin') && !robots.includes('Disallow: /stores'), 'it hides the admin and nothing a customer reads');
  const xml = sitemapXml([urlEntry(`${base}/stores/223`, '2026-09-12', '0.8')]);
  ok(xml.startsWith('<?xml') && xml.includes('<loc>https://cigarbuddy.com/stores/223</loc>'), 'a sitemap is well formed');
  ok(sitemapIndexXml([`${base}/sitemap-stores-1.xml`]).includes('<sitemapindex'), 'and the index points at its pages');

  console.log(`\nseo self-test: ${pass} passed, ${fail} failed`);
  return fail === 0;
}

if (require.main === module && process.argv[2] === 'selftest') process.exit(selftest() ? 0 : 1);
