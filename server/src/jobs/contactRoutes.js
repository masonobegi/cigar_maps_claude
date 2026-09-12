/**
 * How to reach each shop, from what the shop itself publishes.
 *
 * The first pass found an address for 360 of 656 and gave up on the rest, which
 * was the finder's fault rather than theirs: Central Cigars, Corona Cigar
 * Company and Mr G's all publish one. Three things hide an address from a naive
 * reader:
 *
 *   Cloudflare's email protection replaces it with
 *     <a href="/cdn-cgi/l/email-protection#d9b0b7bf...">, hex bytes XOR'd
 *     against the first one. It is obfuscation against a scraper, not
 *     encryption, and it decodes in four lines.
 *   HTML entities: shop&#64;example&#46;com renders as an address and matches no
 *     pattern.
 *   The written-out form: "shop (at) example (dot) com".
 *
 * And a shop that publishes no address at all still has a way in — a contact
 * form, a Facebook page, an Instagram account, a phone. Those are recorded too,
 * because "no email" and "no way to reach them" are different facts and only
 * the second one is a dead end.
 *
 * Reads only. Nothing here sends anything.
 *
 *   node src/jobs/contactRoutes.js find [--limit N] [--all]
 *   node src/jobs/contactRoutes.js report
 *   node src/jobs/contactRoutes.js selftest
 */
'use strict';

const db = require('../database/db');
const { fetchUrl } = require('./webMenu');
const { pageText, candidateLinks } = require('./hoursSweep');

const WORKERS = 6;
const PAUSE_MS = 350;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const EMAIL_G = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const ONE_EMAIL = new RegExp(`^${EMAIL_G.source}$`);

const NOT_THE_SHOP = /@(?:example|sentry|wix|squarespace|shopify|godaddy|wordpress|cloudflare|google|facebook|instagram|yourdomain|domain)\.|noreply|no-reply|donotreply|@.*\.(?:png|jpg|jpeg|gif|webp|svg)$|^[0-9a-f]{16,}@|@2x\.|\.(?:png|jpg|gif|webp)$/i;

/**
 * Cloudflare's "email protection": the address is hex, each byte XOR'd with the
 * first. Present as data-cfemail="…" and as the fragment of a
 * /cdn-cgi/l/email-protection# link.
 */
function decodeCfEmail(hex) {
  const s = String(hex || '').trim();
  if (!/^[0-9a-f]+$/i.test(s) || s.length < 4 || s.length % 2) return null;
  const key = parseInt(s.slice(0, 2), 16);
  let out = '';
  for (let i = 2; i < s.length; i += 2) out += String.fromCharCode(parseInt(s.slice(i, i + 2), 16) ^ key);
  return ONE_EMAIL.test(out) ? out.toLowerCase() : null;
}

/** &#64; and &#x40; render as an address and match no pattern until decoded. */
function decodeEntities(html) {
  return String(html || '')
    .replace(/&#(\d{1,5});/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]{1,4});/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

/** "shop (at) example (dot) com", which a person reads and a regex does not. */
function deobfuscate(text) {
  return String(text || '')
    .replace(/\s*[([{]\s*(?:at|@)\s*[)\]}]\s*/gi, '@')
    .replace(/\s+(?:at)\s+(?=[a-z0-9-]+\s*(?:[([{]\s*dot|\.))/gi, '@')
    .replace(/\s*[([{]\s*dot\s*[)\]}]\s*/gi, '.')
    .replace(/\s+dot\s+/gi, '.');
}

/** Every address a page publishes, however it publishes it, best first. */
function emailsFrom(html, host) {
  const found = new Set();
  const raw = String(html || '');

  for (const m of raw.matchAll(/data-cfemail="([0-9a-fA-F]+)"/g)) {
    const e = decodeCfEmail(m[1]);
    if (e) found.add(e);
  }
  for (const m of raw.matchAll(/\/cdn-cgi\/l\/email-protection#([0-9a-fA-F]+)/g)) {
    const e = decodeCfEmail(m[1]);
    if (e) found.add(e);
  }

  const decoded = decodeEntities(raw);
  for (const m of decoded.matchAll(/mailto:([^"'?>\s]+)/gi)) {
    try { found.add(decodeURIComponent(m[1])); } catch { found.add(m[1]); }
  }
  const text = deobfuscate(pageText(decoded));
  for (const m of text.matchAll(EMAIL_G)) found.add(m[0]);

  const clean = [...found]
    .map(e => String(e).trim().toLowerCase().replace(/[.,;:)\]]+$/, ''))
    .filter(e => ONE_EMAIL.test(e) && !NOT_THE_SHOP.test(e));

  // The shop's own domain first; a personal address kept but ranked below.
  const own = host ? clean.filter(e => e.endsWith(`@${host}`) || e.endsWith(`.${host}`)) : [];
  return [...new Set([...own, ...clean.filter(e => !own.includes(e))])];
}

/** The other ways in, when there is no address to write to. */
function routesFrom(html, baseUrl) {
  const raw = String(html || '');
  const abs = href => { try { return new URL(href, baseUrl).toString(); } catch { return null; } };
  const hrefs = [...raw.matchAll(/href=["']([^"']+)["']/gi)].map(m => m[1]);

  const social = (re) => {
    for (const h of hrefs) {
      if (!re.test(h)) continue;
      const url = abs(h);
      // A share button links to the network with our own page as a parameter.
      if (url && !/sharer|share\?|intent\/|\/share/i.test(url)) return url;
    }
    return null;
  };

  const contact = hrefs
    .map(abs)
    .filter(Boolean)
    .find(u => /\/(contact|contact-us|contactus|get-in-touch|reach-us)\b/i.test(u));

  return {
    contact_url: contact || null,
    facebook: social(/facebook\.com\//i),
    instagram: social(/instagram\.com\//i),
  };
}

/** Pages worth opening when the front page gave nothing. */
const CONTACT_HINT = /contact|about|reach|visit|hours|location|info|team|staff/i;
const COMMON_PATHS = ['/contact', '/contact-us', '/contactus', '/about', '/about-us',
  '/pages/contact', '/pages/contact-us', '/contact.html', '/contact.php', '/visit', '/locations'];

async function findOne(store, { fetch = fetchUrl } = {}) {
  const site = /^https?:\/\//i.test(store.website) ? store.website : `https://${store.website}`;
  let host = '';
  try { host = new URL(site).hostname.replace(/^www\./, ''); } catch { return null; }

  const first = await fetch(site, { timeoutMs: 12000 }).catch(() => null);
  if (!first || !first.body) return { id: store.id, ok: false, why: 'the site did not answer' };

  let emails = emailsFrom(first.body, host);
  const routes = routesFrom(first.body, first.url || site);
  const looked = [site];

  if (!emails.length) {
    // Its own contact link first, then the paths shops usually use anyway.
    const linked = candidateLinks(first.body, site).filter(u => CONTACT_HINT.test(u)).slice(0, 3);
    const guessed = COMMON_PATHS.map(p => { try { return new URL(p, site).toString(); } catch { return null; } })
      .filter(Boolean);
    const tried = new Set(looked);
    for (const url of [routes.contact_url, ...linked, ...guessed].filter(Boolean)) {
      if (tried.has(url) || tried.size > 6) continue;
      tried.add(url);
      await sleep(PAUSE_MS);
      const page = await fetch(url, { timeoutMs: 12000 }).catch(() => null);
      if (!page || !page.body) continue;
      looked.push(url);
      emails = emailsFrom(page.body, host);
      const more = routesFrom(page.body, page.url || url);
      routes.facebook = routes.facebook || more.facebook;
      routes.instagram = routes.instagram || more.instagram;
      routes.contact_url = routes.contact_url || more.contact_url;
      if (emails.length) break;
    }
  }
  return { id: store.id, ok: true, email: emails[0] || null, all: emails.slice(0, 4), ...routes, looked };
}

async function find({ limit = 0, all = false, log = console.log } = {}) {
  const rows = await db.all(`
    SELECT s.id, s.name, s.website
    FROM stores s
    LEFT JOIN store_outreach o ON o.store_id = s.id
    WHERE s.visible = 1 AND s.website IS NOT NULL AND s.website <> ''
      AND COALESCE(s.website_status, 'ok') IN ('ok', 'blocked')
      AND COALESCE(s.claimed, 0) = 0
      ${all ? '' : 'AND (o.id IS NULL OR o.email IS NULL)'}
    ORDER BY s.id ${limit ? 'LIMIT ' + Number(limit) : ''}`);
  log(`reading ${rows.length} shop websites for a way to reach them`);

  let next = 0, done = 0, emails = 0, routes = 0;
  const worker = async () => {
    while (next < rows.length) {
      const store = rows[next++];
      const r = await findOne(store).catch(() => null);
      if (r) {
        await db.run(`
          INSERT INTO store_outreach (store_id, email, candidates, contact_url, facebook, instagram, looked_at)
          VALUES (?, ?, ?, ?, ?, ?, NOW())
          ON CONFLICT (store_id) DO UPDATE SET
            email = COALESCE(EXCLUDED.email, store_outreach.email),
            candidates = EXCLUDED.candidates,
            contact_url = COALESCE(EXCLUDED.contact_url, store_outreach.contact_url),
            facebook = COALESCE(EXCLUDED.facebook, store_outreach.facebook),
            instagram = COALESCE(EXCLUDED.instagram, store_outreach.instagram),
            looked_at = NOW()`,
        [store.id, r.email || null, JSON.stringify(r.all || []), r.contact_url || null,
          r.facebook || null, r.instagram || null]);
        if (r.email) emails++;
        else if (r.contact_url || r.facebook || r.instagram) routes++;
      }
      done++;
      if (done % 50 === 0) log(`  ${done}/${rows.length} — ${emails} addresses, ${routes} other ways in`);
      await sleep(PAUSE_MS);
    }
  };
  await Promise.all(Array.from({ length: Math.min(WORKERS, rows.length || 1) }, worker));
  log(`done: ${emails} addresses found, ${routes} more shops reachable some other way`);
  return { emails, routes };
}

async function report({ log = console.log } = {}) {
  const r = await db.get(`SELECT
      COUNT(*)::int AS looked,
      COUNT(*) FILTER (WHERE email IS NOT NULL)::int AS email,
      COUNT(*) FILTER (WHERE email IS NULL AND contact_url IS NOT NULL)::int AS form,
      COUNT(*) FILTER (WHERE email IS NULL AND contact_url IS NULL AND facebook IS NOT NULL)::int AS facebook,
      COUNT(*) FILTER (WHERE email IS NULL AND contact_url IS NULL AND facebook IS NULL AND instagram IS NOT NULL)::int AS instagram
    FROM store_outreach`);
  const totals = await db.get(`SELECT
      COUNT(*) FILTER (WHERE visible = 1)::int AS shops,
      COUNT(*) FILTER (WHERE visible = 1 AND phone IS NOT NULL AND phone <> '')::int AS phone
    FROM stores`);
  const unreachable = await db.get(`SELECT COUNT(*)::int AS n FROM stores s
    LEFT JOIN store_outreach o ON o.store_id = s.id
    WHERE s.visible = 1 AND (s.phone IS NULL OR s.phone = '')
      AND (o.id IS NULL OR (o.email IS NULL AND o.contact_url IS NULL AND o.facebook IS NULL AND o.instagram IS NULL))`);

  log(`${totals.shops} public shops, ${r.looked} sites read`);
  log(`  an email address:        ${r.email}`);
  log(`  a contact form only:     ${r.form}`);
  log(`  a Facebook page only:    ${r.facebook}`);
  log(`  an Instagram only:       ${r.instagram}`);
  log(`  a phone number:          ${totals.phone}`);
  log(`  no way in at all:        ${unreachable.n}`);
  return { ...r, ...totals, unreachable: unreachable.n };
}

module.exports = { find, findOne, report, emailsFrom, routesFrom, decodeCfEmail, decodeEntities,
  deobfuscate, selftest };

// ── self-test ───────────────────────────────────────────────────────────────
function selftest() {
  let pass = 0, fail = 0;
  const ok = (cond, label, extra) => {
    if (cond) { pass++; console.log(`  ok   ${label}`); }
    else { fail++; console.log(`  FAIL ${label}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ''}`); }
  };

  // The real string from mrgscigars.com, which the first finder read as nothing.
  const cf = 'd9b0b7bfb699b4abbeaabab0beb8abaaf7bab6b4';
  ok(decodeCfEmail(cf) === 'info@mrgscigars.com', 'a Cloudflare-protected address decodes', decodeCfEmail(cf));
  ok(decodeCfEmail('zz') === null && decodeCfEmail('') === null && decodeCfEmail('d9b0b') === null,
    'and junk decodes to nothing rather than to a wrong address');
  ok(emailsFrom(`<a class="__cf_email__" data-cfemail="${cf}">[email&#160;protected]</a>`, 'mrgscigars.com')[0]
    === 'info@mrgscigars.com', 'found through the attribute a page actually carries');
  ok(emailsFrom(`<a href="/cdn-cgi/l/email-protection#${cf}">email us</a>`, 'mrgscigars.com').length === 1,
    'and through the link form of the same thing');

  // Not example.com: that is on the exclusion list precisely because a page
  // carrying it is showing a placeholder rather than an address.
  ok(emailsFrom('<p>shop&#64;cigarcastle&#46;com</p>', 'cigarcastle.com')[0] === 'shop@cigarcastle.com',
    'an address written in HTML entities is still an address',
    emailsFrom('<p>shop&#64;cigarcastle&#46;com</p>', 'cigarcastle.com'));
  ok(!emailsFrom('<p>you@example.com</p>', 'shop.com').length,
    'and a placeholder address on a template page is not one to write to');
  ok(deobfuscate('shop (at) example (dot) com') === 'shop@example.com', 'and one written out in words',
    deobfuscate('shop (at) example (dot) com'));
  ok(emailsFrom('<p>hello [at] cigarshop [dot] com</p>', 'cigarshop.com')[0] === 'hello@cigarshop.com',
    'through the reader, in square brackets too');

  // Whose address it is.
  const mixed = '<a href="mailto:info@shop.com">us</a> built by hi@agency.com noreply@shopify.com';
  const got = emailsFrom(mixed, 'shop.com');
  ok(got[0] === 'info@shop.com', 'the shop’s own domain still ranks first', got);
  ok(!got.includes('noreply@shopify.com'), 'and a platform noreply is still not a shop');
  ok(!emailsFrom('<img src="logo@2x.png">', 'shop.com').length, 'a retina filename is still not an address');

  // The other ways in.
  const page = `<a href="/contact-us">Contact</a>
    <a href="https://facebook.com/thecigarshop">fb</a>
    <a href="https://instagram.com/thecigarshop">ig</a>`;
  const routes = routesFrom(page, 'https://shop.com/');
  ok(routes.contact_url === 'https://shop.com/contact-us', 'a contact page is a way in', routes);
  ok(routes.facebook === 'https://facebook.com/thecigarshop', 'so is a Facebook page');
  ok(routes.instagram === 'https://instagram.com/thecigarshop', 'and an Instagram');
  const shareOnly = routesFrom('<a href="https://facebook.com/sharer.php?u=https://shop.com">share</a>', 'https://shop.com/');
  ok(shareOnly.facebook === null, 'but a share button is not the shop’s page');

  console.log(`\ncontactRoutes self-test: ${pass} passed, ${fail} failed`);
  return fail === 0;
}

if (require.main === module && process.argv[2] === 'selftest') process.exit(selftest() ? 0 : 1);

if (require.main === module && process.argv[2] !== 'selftest') {
  require('../utils/loadEnv');
  const argv = process.argv.slice(2);
  const arg = n => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : null; };
  const { initSchema, runMigrations } = require('../database/schema');
  (async () => {
    await initSchema();
    await runMigrations();
    if (argv[0] === 'find') await find({ limit: Number(arg('--limit')) || 0, all: argv.includes('--all') });
    else if (argv[0] === 'report') await report();
    else { console.error('usage: contactRoutes.js find [--limit N] [--all] | report | selftest'); process.exit(2); }
    process.exit(0);
  })().catch(err => { console.error(err); process.exit(1); });
}
