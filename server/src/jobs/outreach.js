/**
 * Telling shops their page exists, without anybody typing forty emails a day.
 *
 * Every listing here already has a page, and the shop that page is about has
 * never been told. That is the whole of the onboarding problem, and it is
 * mechanical: find the address the shop publishes on its own website, write to
 * it once about its own page, record what happened, and follow up once if
 * nothing comes of it.
 *
 * What is deliberately NOT automated:
 *
 *   the reply. A shop that answers gets a person, always.
 *   the volume. A new domain sending six hundred messages in a day is a new
 *     domain in a spam folder, so `send` takes a daily cap and refuses to
 *     exceed it. Twenty a day for a month beats six hundred once.
 *   the guessing. No info@ invented from a domain, no addresses bought from a
 *     list: only what the shop itself published on a page we already read.
 *
 * Every message carries a one-click unsubscribe and a postal address, which is
 * what CAN-SPAM requires of a commercial email in the United States, and an
 * unsubscribe is honoured before anything else is considered.
 *
 *   node src/jobs/outreach.js find     [--limit N]        read sites for a contact address
 *   node src/jobs/outreach.js draft    --city tampa-fl    write the queue, for reading
 *   node src/jobs/outreach.js send     --limit 20         send what was drafted
 *   node src/jobs/outreach.js followup --limit 20         one nudge, 7 days later
 *   node src/jobs/outreach.js report                      what has happened so far
 *   node src/jobs/outreach.js selftest
 */
'use strict';

const crypto = require('crypto');
const db = require('../database/db');
const { fetchUrl } = require('./webMenu');
const { pageText, candidateLinks } = require('./hoursSweep');
const { sendMail, mailConfigured } = require('../utils/email');
const { citySlug, parsePlaceSlug, listPlaces } = require('../utils/places');

const WORKERS = 6;
const PAUSE_MS = 400;
const DAILY_CAP = 40;
const FOLLOWUP_DAYS = 7;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const APP_URL = () => (process.env.APP_URL || 'https://cigarbuddy.com').replace(/\/+$/, '');
const FROM_NAME = process.env.OUTREACH_FROM_NAME || 'Mason';
const POSTAL = process.env.OUTREACH_POSTAL_ADDRESS || '';

// ── finding an address the shop published itself ────────────────────────────

const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
// The same pattern without /g. A global regex carries a lastIndex and .test()
// advances it, so testing a list of addresses against EMAIL_RE itself matched
// every other one and silently dropped the rest — including the only address a
// shop had published.
const ONE_EMAIL = new RegExp(`^${EMAIL_RE.source}$`);

/**
 * Addresses that belong to somebody other than the shop: the agency that built
 * the site, the platform it runs on, an image file that happens to look like an
 * address. Writing to any of them is writing to a stranger.
 */
const NOT_THE_SHOP = /@(?:example|sentry|wix|squarespace|shopify|godaddy|wordpress|gmail-noreply|cloudflare|google|facebook|instagram)\.|noreply|no-reply|donotreply|@.*\.(?:png|jpg|jpeg|gif|webp|svg)$|^[0-9a-f]{16,}@|@2x\./i;

/** The addresses a page publishes, best first. */
function emailsFrom(text, html, host) {
  const found = new Set();
  for (const m of String(html || '').matchAll(/mailto:([^"'?>\s]+)/gi)) found.add(decodeURIComponent(m[1]));
  for (const m of String(text || '').matchAll(EMAIL_RE)) found.add(m[0]);
  const clean = [...found]
    .map(e => String(e).trim().toLowerCase().replace(/[.,;:)\]]+$/, ''))
    .filter(e => ONE_EMAIL.test(e) && !NOT_THE_SHOP.test(e));
  // An address on the shop's own domain is the shop's. Everything else is a
  // guess at best — a personal Gmail the owner also uses, most often — so it
  // ranks below and is still recorded rather than thrown away.
  const own = host ? clean.filter(e => e.endsWith(`@${host}`) || e.endsWith(`.${host}`)) : [];
  const rest = clean.filter(e => !own.includes(e));
  return [...new Set([...own, ...rest])];
}

/** Which of a site's pages is worth opening for a contact address. */
const CONTACT_HINT = /contact|about|reach|visit|hours|location|info/i;

async function findOne(store, { log = () => {} } = {}) {
  const site = /^https?:\/\//i.test(store.website) ? store.website : `https://${store.website}`;
  let host = '';
  try { host = new URL(site).hostname.replace(/^www\./, ''); } catch { return null; }

  const pages = [site];
  const first = await fetchUrl(site, { timeoutMs: 12000 }).catch(() => null);
  if (!first || !first.body) return { id: store.id, ok: false, why: 'the site did not answer' };

  let emails = emailsFrom(pageText(first.body), first.body, host);
  if (!emails.length) {
    // Nothing on the front page: the contact page is where a shop usually puts it.
    const links = candidateLinks(first.body, site).filter(u => CONTACT_HINT.test(u)).slice(0, 3);
    for (const url of links) {
      await sleep(PAUSE_MS);
      const page = await fetchUrl(url, { timeoutMs: 12000 }).catch(() => null);
      if (!page || !page.body) continue;
      pages.push(url);
      emails = emailsFrom(pageText(page.body), page.body, host);
      if (emails.length) break;
    }
  }
  return { id: store.id, ok: true, email: emails[0] || null, all: emails.slice(0, 4), pages, host };
}

async function find({ limit = 0, log = console.log } = {}) {
  const rows = await db.all(`
    SELECT s.id, s.name, s.website
    FROM stores s
    LEFT JOIN store_outreach o ON o.store_id = s.id
    WHERE s.visible = 1 AND s.website IS NOT NULL AND s.website <> ''
      AND COALESCE(s.website_status, 'ok') IN ('ok', 'blocked')
      AND COALESCE(s.claimed, 0) = 0
      AND (o.id IS NULL OR (o.email IS NULL AND o.looked_at < NOW() - INTERVAL '30 days'))
    ORDER BY s.id ${limit ? 'LIMIT ' + Number(limit) : ''}`);
  log(`reading ${rows.length} shop websites for a contact address`);

  let next = 0, found = 0, none = 0;
  const worker = async () => {
    while (next < rows.length) {
      const store = rows[next++];
      const r = await findOne(store).catch(() => null);
      await db.run(`
        INSERT INTO store_outreach (store_id, email, candidates, looked_at)
        VALUES (?, ?, ?, NOW())
        ON CONFLICT (store_id) DO UPDATE SET email = EXCLUDED.email,
          candidates = EXCLUDED.candidates, looked_at = NOW()`,
      [store.id, (r && r.email) || null, JSON.stringify((r && r.all) || [])]);
      if (r && r.email) found++; else none++;
      if ((found + none) % 50 === 0) log(`  ${found + none}/${rows.length} read, ${found} with an address`);
      await sleep(PAUSE_MS);
    }
  };
  await Promise.all(Array.from({ length: Math.min(WORKERS, rows.length || 1) }, worker));
  log(`done: ${found} shops publish an address we can write to, ${none} do not`);
  return { found, none };
}

// ── the message ─────────────────────────────────────────────────────────────

/**
 * What the shop is told. Short, about them, and asking a question they want to
 * answer — "is anything on this wrong" gets a reply where "sign up for my
 * directory" does not. The claim is free and is the only thing asked for.
 */
function compose(store, { url, unsubscribe, fromName = FROM_NAME, postal = POSTAL }) {
  const openLine = store.hours_source === 'website'
    ? 'I read your hours off your own site, so the page knows when you are open. Most directories get that wrong.'
    : 'Your hours are not on there yet, which is the main thing I would like to fix.';
  const lounge = Number(store.has_lounge) === 1 ? ' It is marked as having a lounge.' : '';

  const text = [
    `Hi,`,
    ``,
    `I built a directory of proper cigar shops — not vape stores, not petrol stations.`,
    `${store.name} is on it:`,
    ``,
    `  ${url}`,
    ``,
    `${openLine}${lounge}`,
    ``,
    `Two things:`,
    `  1. Is anything on there wrong? Reply and I will fix it today.`,
    `  2. You can claim the page for free and edit it yourself — hours, photos,`,
    `     what you have in stock. The link is on the page.`,
    ``,
    `— ${fromName}`,
    ``,
    `---`,
    `You are receiving this because ${store.name} is listed in the directory.`,
    `Never write to me again: ${unsubscribe}`,
    postal ? postal : '',
  ].filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n');

  return {
    subject: `Your shop's page on CigarBuddy — anything wrong with it?`,
    text,
  };
}

function composeFollowup(store, { url, unsubscribe, fromName = FROM_NAME, postal = POSTAL }) {
  const text = [
    `Hi,`,
    ``,
    `I wrote last week about ${store.name}'s page:`,
    ``,
    `  ${url}`,
    ``,
    `No reply needed if it all looks right — I only wanted to be sure somebody`,
    `there had seen it, since people use it to find you.`,
    ``,
    `— ${fromName}`,
    ``,
    `---`,
    `Never write to me again: ${unsubscribe}`,
    postal ? postal : '',
  ].filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n');
  return { subject: `Re: your shop's page on CigarBuddy`, text };
}

const unsubToken = storeId => crypto.createHash('sha256')
  .update(`unsub:${storeId}:${process.env.JWT_SECRET || 'cigarbuddy'}`).digest('hex').slice(0, 24);

// ── drafting, sending, following up ─────────────────────────────────────────

async function draft({ city = null, limit = 0, log = console.log } = {}) {
  let place = null;
  if (city) {
    place = parsePlaceSlug(city, await listPlaces(db, { force: true }));
    if (!place) { log(`no place called "${city}"`); return { queued: 0 }; }
  }
  const where = place
    ? (place.kind === 'city' ? 'AND LOWER(s.city) = LOWER(?) AND UPPER(s.state) = UPPER(?)' : 'AND UPPER(s.state) = UPPER(?)')
    : '';
  const params = place ? (place.kind === 'city' ? [place.city, place.state] : [place.state]) : [];

  const rows = await db.all(`
    SELECT s.id, s.name, s.city, s.state, s.hours_source, s.has_lounge, o.email
    FROM stores s
    JOIN store_outreach o ON o.store_id = s.id
    WHERE s.visible = 1 AND COALESCE(s.claimed, 0) = 0
      AND o.email IS NOT NULL AND o.unsubscribed_at IS NULL AND o.sent_at IS NULL
      ${where}
    ORDER BY (s.hours_source = 'website') DESC, s.id
    ${limit ? 'LIMIT ' + Number(limit) : ''}`, params);

  for (const r of rows) {
    await db.run(`UPDATE store_outreach SET queued_at = NOW() WHERE store_id = ? AND queued_at IS NULL`, [r.id]);
  }
  log(`${rows.length} shops queued${place ? ` in ${place.kind === 'city' ? `${place.city}, ${place.state}` : place.state}` : ''}`);
  for (const r of rows.slice(0, 10)) log(`   #${r.id} ${String(r.name).slice(0, 34).padEnd(36)} ${r.email}`);
  return { queued: rows.length, rows };
}

async function send({ limit = 20, dry = false, log = console.log } = {}) {
  if (!dry && !mailConfigured()) {
    log('SMTP is not configured, so nothing can be sent. Set SMTP_USER and SMTP_PASS, and APP_URL.');
    return { sent: 0, blocked: true };
  }
  const cap = Math.min(Number(limit) || 20, DAILY_CAP);
  const sentToday = await db.get(
    `SELECT COUNT(*)::int AS n FROM store_outreach WHERE sent_at > NOW() - INTERVAL '24 hours'`);
  const room = Math.max(0, DAILY_CAP - sentToday.n);
  if (!room) { log(`${sentToday.n} already sent in the last 24 hours, which is the cap. Nothing sent.`); return { sent: 0 }; }

  const rows = await db.all(`
    SELECT s.id, s.name, s.city, s.state, s.hours_source, s.has_lounge, o.email
    FROM stores s JOIN store_outreach o ON o.store_id = s.id
    WHERE s.visible = 1 AND COALESCE(s.claimed, 0) = 0
      AND o.email IS NOT NULL AND o.unsubscribed_at IS NULL AND o.sent_at IS NULL AND o.queued_at IS NOT NULL
    ORDER BY o.queued_at, s.id LIMIT ?`, [Math.min(cap, room)]);

  let sent = 0;
  for (const r of rows) {
    const url = `${APP_URL()}/stores/${r.id}`;
    const unsubscribe = `${APP_URL()}/api/outreach/unsubscribe?store=${r.id}&t=${unsubToken(r.id)}`;
    const mail = compose(r, { url, unsubscribe });
    if (dry) { log(`   would write to ${r.email} about #${r.id} ${r.name}`); sent++; continue; }
    const okSend = await sendMail({ to: r.email, subject: mail.subject, text: mail.text });
    if (okSend === false) { log(`   could not send to ${r.email}`); continue; }
    await db.run('UPDATE store_outreach SET sent_at = NOW() WHERE store_id = ?', [r.id]);
    sent++;
    await sleep(2000);        // a human pace, not a burst
  }
  log(`${dry ? 'would send' : 'sent'} ${sent}; ${sentToday.n + sent} of ${DAILY_CAP} used in this 24 hours`);
  return { sent };
}

async function followup({ limit = 20, dry = false, log = console.log } = {}) {
  if (!dry && !mailConfigured()) { log('SMTP is not configured.'); return { sent: 0, blocked: true }; }
  const rows = await db.all(`
    SELECT s.id, s.name, o.email
    FROM stores s JOIN store_outreach o ON o.store_id = s.id
    WHERE s.visible = 1 AND COALESCE(s.claimed, 0) = 0
      AND o.email IS NOT NULL AND o.unsubscribed_at IS NULL
      AND o.sent_at IS NOT NULL AND o.followed_up_at IS NULL
      AND o.sent_at < NOW() - INTERVAL '${FOLLOWUP_DAYS} days'
    ORDER BY o.sent_at LIMIT ?`, [Math.min(Number(limit) || 20, DAILY_CAP)]);

  let sent = 0;
  for (const r of rows) {
    const url = `${APP_URL()}/stores/${r.id}`;
    const unsubscribe = `${APP_URL()}/api/outreach/unsubscribe?store=${r.id}&t=${unsubToken(r.id)}`;
    const mail = composeFollowup(r, { url, unsubscribe });
    if (dry) { log(`   would nudge ${r.email} about #${r.id} ${r.name}`); sent++; continue; }
    const okSend = await sendMail({ to: r.email, subject: mail.subject, text: mail.text });
    if (okSend === false) continue;
    await db.run('UPDATE store_outreach SET followed_up_at = NOW() WHERE store_id = ?', [r.id]);
    sent++;
    await sleep(2000);
  }
  log(`${dry ? 'would nudge' : 'nudged'} ${sent}. One nudge only: a shop that has not answered twice is not interested.`);
  return { sent };
}

async function report({ log = console.log } = {}) {
  const r = await db.get(`SELECT
      COUNT(*)::int AS looked,
      COUNT(*) FILTER (WHERE email IS NOT NULL)::int AS with_email,
      COUNT(*) FILTER (WHERE queued_at IS NOT NULL)::int AS queued,
      COUNT(*) FILTER (WHERE sent_at IS NOT NULL)::int AS sent,
      COUNT(*) FILTER (WHERE followed_up_at IS NOT NULL)::int AS nudged,
      COUNT(*) FILTER (WHERE unsubscribed_at IS NOT NULL)::int AS unsubscribed
    FROM store_outreach`);
  const claimed = await db.get(`SELECT COUNT(*)::int AS n FROM stores s
    JOIN store_outreach o ON o.store_id = s.id WHERE s.claimed = 1 AND o.sent_at IS NOT NULL`);
  log(`sites read: ${r.looked}, of which ${r.with_email} publish an address`);
  log(`queued ${r.queued}, written to ${r.sent}, nudged ${r.nudged}, unsubscribed ${r.unsubscribed}`);
  log(`shops that claimed their page after being written to: ${claimed.n}`
    + (r.sent ? ` (${(100 * claimed.n / r.sent).toFixed(1)}%)` : ''));
  return { ...r, claimed: claimed.n };
}

module.exports = { find, findOne, draft, send, followup, report, compose, composeFollowup,
  emailsFrom, unsubToken, NOT_THE_SHOP, DAILY_CAP, selftest };

// ── self-test ───────────────────────────────────────────────────────────────
function selftest() {
  let pass = 0, fail = 0;
  const ok = (cond, label, extra) => {
    if (cond) { pass++; console.log(`  ok   ${label}`); }
    else { fail++; console.log(`  FAIL ${label}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ''}`); }
  };

  // Whose address is it? Writing to the agency that built the site, or to a
  // platform's noreply, is writing to a stranger about somebody else's shop.
  const html = '<a href="mailto:info@centralcigars.com">Email us</a> Built by hello@webagency.com. '
    + 'noreply@shopify.com. Questions: owner.gmail@gmail.com';
  const found = emailsFrom(html, html, 'centralcigars.com');
  ok(found[0] === 'info@centralcigars.com', 'the shop’s own domain comes first', found);
  ok(!found.includes('noreply@shopify.com'), 'a platform noreply is not a shop');
  ok(found.includes('owner.gmail@gmail.com'), 'a personal address is kept, ranked below the shop’s own', found);
  ok(!emailsFrom('logo@2x.png sprite@2x.png', '', 'x.com').length, 'a retina image filename is not an address');
  ok(NOT_THE_SHOP.test('no-reply@anything.com') && NOT_THE_SHOP.test('x@wix.com'), 'the exclusions hold');

  // The message. It has to be honest about what we know, and it has to carry
  // the two things a commercial email in the US is required to carry.
  const store = { id: 223, name: 'Central Cigars', city: 'St Petersburg', state: 'FL', hours_source: 'website', has_lounge: 1 };
  const mail = compose(store, { url: 'https://cigarbuddy.com/stores/223', unsubscribe: 'https://cigarbuddy.com/u/223', fromName: 'Mason', postal: '1 Example St' });
  ok(mail.text.includes('https://cigarbuddy.com/stores/223'), 'it links the shop’s own page');
  ok(mail.text.includes('read your hours off your own site'), 'it says what we did, when we did it');
  ok(compose({ ...store, hours_source: 'map' }, { url: 'u', unsubscribe: 'x' }).text.includes('not on there yet'),
    'and admits it when we have not');
  ok(mail.text.includes('https://cigarbuddy.com/u/223'), 'every message carries a way out');
  ok(mail.text.includes('1 Example St'), 'and a postal address, which the law asks for');
  ok(!/sign up|subscribe|upgrade|\$/i.test(mail.text), 'it sells nothing: the claim is free and is all that is asked');
  ok(mail.text.length < 900, 'and it is short enough to read', mail.text.length);

  // The unsubscribe link has to be unguessable, or anyone can unsubscribe anyone.
  const t = unsubToken(223);
  ok(t.length === 24 && t !== unsubToken(224), 'the unsubscribe token is per shop and not a store id');

  ok(DAILY_CAP <= 50, 'the daily cap stays small enough that a new domain survives it', DAILY_CAP);

  console.log(`\noutreach self-test: ${pass} passed, ${fail} failed`);
  return fail === 0;
}

if (require.main === module && process.argv[2] === 'selftest') process.exit(selftest() ? 0 : 1);

if (require.main === module && process.argv[2] !== 'selftest') {
  const argv = process.argv.slice(2);
  const arg = name => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : null; };
  const dry = argv.includes('--dry');
  const { initSchema, runMigrations } = require('../database/schema');
  (async () => {
    await initSchema();
    await runMigrations();
    const limit = Number(arg('--limit')) || 0;
    if (argv[0] === 'find') await find({ limit });
    else if (argv[0] === 'draft') await draft({ city: arg('--city'), limit });
    else if (argv[0] === 'send') await send({ limit: limit || 20, dry });
    else if (argv[0] === 'followup') await followup({ limit: limit || 20, dry });
    else if (argv[0] === 'report') await report();
    else {
      console.error('usage: outreach.js find | draft --city <slug> | send --limit N [--dry] | followup | report | selftest');
      process.exit(2);
    }
    process.exit(0);
  })().catch(err => { console.error(err); process.exit(1); });
}
