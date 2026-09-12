/**
 * The claim safety gate.
 *
 * Claiming a listing hands somebody the shop: they can rewrite its name,
 * phone, address, website and hours, it gets a verified check and a ranking
 * boost, and it leaves every sweep. Until now the only thing standing in the
 * way of the self-serve email code was "the mailbox domain matches the last
 * two labels of the stored website". That is not a lock. On today's data:
 *
 *   - 1,150 of the 4,533 listings eligible for instant claim have a DEAD site.
 *     RDAP says most of those .com roots are not registered at all, so about
 *     480 listings can be taken over by anyone willing to spend $10. #278
 *     Gulfport Cigars already has a stranger's domain on it, re-registered
 *     2026-08-17.
 *   - 314 working links redirect somewhere else entirely — 14 of them to
 *     gambling sites (#18628 Thicker Cloudz to vipbet88judibola.com), 10 to
 *     domain-for-sale pages (#23510 Senor Cigars to expireddomains.com).
 *   - Two labels is the wrong unit: any .com.au mailbox "owned" #3624 The Pipe
 *     King, any .co.uk mailbox #12092 Redzone, any *.wi.us mailbox #16333 S R
 *     Tobacco (a school district's website), any @yahoo.com address #21932.
 *   - 1,662 listings share 420 domains, so one wildbillstobacco.com mailbox
 *     could have claimed 203 shops and one hub.biz (a directory) 42.
 *
 * So the gate asks for all of this before the code is emailed, and hands
 * anything short of it to staff with the reasons attached. It never rejects a
 * claim: a real owner with a down, shared or brand-new site waits for a human
 * instead of being turned away.
 *
 *   1. the link works right now — a live linkCheck verdict of 'ok'
 *   2. listed URL, final URL and mailbox share one registrable domain, read
 *      from the vendored Public Suffix List (utils/publicSuffix.js)
 *   3. that domain is not free mail, an ISP, a directory, a link shortener, a
 *      site builder, .gov/.edu/.mil, a .us locality or a foreign ccTLD
 *   4. exactly one public listing uses the domain
 *   5. the page names the shop
 *   6. RDAP says the domain has been registered at least a year, and not
 *      after we imported the listing
 *   7. the address is the account's own, verified, email, and no other claim
 *      has already been verified with it
 *   8. the listing is public, and is not a duplicate or a closed row
 *
 * judge() is pure: everything it needs is gathered first by gatherFacts().
 * That is what lets the self-test replay all 25 of the audit's live examples.
 *
 * Self-test (no network, no database):  node src/utils/claimGate.js
 */
'use strict';

const https = require('https');
const http = require('http');
const { URL } = require('url');
const db = require('../database/db');
const { registrableDomain, publicSuffix, emailDomain, hostOf } = require('./publicSuffix');
const { checkWebsite, parseWebsite } = require('../jobs/linkCheck');
const { pageText } = require('../jobs/hoursSweep');
const rdap = require('./rdap');

const UA = 'CigarBuddy/1.0 (+https://cigarmapsclaude-production.up.railway.app; claim verification)';
const TIMEOUT_MS = 10000;
const MAX_BODY = 256 * 1024;
const MIN_DOMAIN_AGE_DAYS = 365;

// Mailboxes anyone can open in a minute. A message reaching one of these says
// nothing about who runs the shop, even when the listing's website is there
// too (#21932 Dutchess County Cigar Company lists yahoo.com as its site).
const FREE_MAIL = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'rocketmail.com', 'outlook.com', 'hotmail.com',
  'live.com', 'msn.com', 'aol.com', 'aim.com', 'icloud.com', 'me.com', 'mac.com', 'protonmail.com',
  'proton.me', 'pm.me', 'gmx.com', 'gmx.net', 'gmx.us', 'mail.com', 'email.com', 'usa.com', 'zoho.com',
  'yandex.com', 'yandex.ru', 'fastmail.com', 'hushmail.com', 'tutanota.com', 'tuta.io', 'inbox.com',
  'mail.ru', 'qq.com', '163.com', '126.com', 'naver.com', 'hanmail.net', 'daum.net', 'web.de', 't-online.de',
  'mailinator.com', 'guerrillamail.com', 'yopmail.com', '10minutemail.com', 'sharklasers.com', 'temp-mail.org',
]);

// Domains an internet provider hands its customers. An owner may well read
// mail there, but the shop's website is not theirs to control.
const ISP_MAIL = new Set([
  'comcast.net', 'xfinity.com', 'att.net', 'sbcglobal.net', 'bellsouth.net', 'ameritech.net', 'pacbell.net',
  'swbell.net', 'prodigy.net', 'verizon.net', 'frontier.com', 'frontiernet.net', 'cox.net', 'charter.net',
  'spectrum.net', 'twc.com', 'rr.com', 'roadrunner.com', 'optonline.net', 'optimum.net', 'earthlink.net',
  'juno.com', 'netzero.net', 'windstream.net', 'embarqmail.com', 'centurylink.net', 'centurytel.net',
  'q.com', 'cableone.net', 'suddenlink.net', 'mediacombb.net', 'wowway.com', 'zoominternet.net',
  'sympatico.ca', 'shaw.ca', 'telus.net', 'rogers.com', 'btinternet.com', 'ntlworld.com', 'virginmedia.com',
]);

// Somebody else's listing of the shop. The operator of one of these could
// otherwise claim every listing that points at it: hub.biz alone is the
// "website" of 42 unrelated shops, and local.yahoo.com of four more.
const DIRECTORY_HOSTS = new Set([
  'hub.biz', 'yelp.com', 'yellowpages.com', 'yp.com', 'superpages.com', 'whitepages.com', 'mapquest.com',
  'foursquare.com', 'tripadvisor.com', 'manta.com', 'bbb.org', 'chamberofcommerce.com', 'citysearch.com',
  'merchantcircle.com', 'cylex-usa.com', 'cylex.us.com', 'brownbook.net', 'opendi.us', 'elocal.com',
  'ezlocal.com', 'storeboard.com', 'n49.com', 'alignable.com', 'nextdoor.com', 'eventbrite.com',
  'facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'tiktok.com', 'linkedin.com', 'youtube.com',
  'pinterest.com', 'google.com', 'goo.gl', 'apple.com', 'doordash.com', 'ubereats.com', 'grubhub.com',
  'seamless.com', 'postmates.com', 'weedmaps.com', 'leafly.com', 'zomato.com', 'opentable.com',
]);

// One link that stands for many: whoever runs the shortener holds the mailbox.
const SHORTENERS = new Set([
  'bit.ly', 'tinyurl.com', 't.co', 'ow.ly', 'buff.ly', 'rebrand.ly', 'is.gd', 'cutt.ly', 'shorturl.at',
  'linktr.ee', 'beacons.ai', 'bio.link', 'lnk.bio', 'campsite.bio', 'allmylinks.com', 'msha.ke', 'many.link',
]);

// A page on somebody's platform. These are not public suffixes, so the list in
// publicSuffix.js reads e.g. tobaccoshack.tripod.com as a name under
// "tripod.com" — meaning any @tripod.com mailbox would have matched #6604 and
// #7044, two unrelated Tobacco Shacks in Mississippi and Texas.
const SHARED_PLATFORMS = new Set([
  'tripod.com', 'angelfire.com', 'geocities.com', 'webs.com', 'business.site', 'mybusiness.site',
  'wixsite.com', 'wix.com', 'weebly.com', 'squarespace.com', 'wordpress.com', 'blogspot.com',
  'godaddysites.com', 'jimdosite.com', 'jimdo.com', 'mystrikingly.com', 'strikingly.com', 'site123.me',
  'yolasite.com', 'webnode.com', 'webstarts.com', 'carrd.co', 'netlify.app', 'vercel.app', 'github.io',
  'glitch.me', 'square.site', 'myshopify.com', 'ecwid.com', 'bigcartel.com', 'shopsettings.com',
  'toasttab.com', 'clover.com', 'spotapps.co', 'businesscatalyst.com', 'wixstudio.com',
]);

/** Why a claim is not eligible for the instant email code. Shown to staff, verbatim. */
const REASONS = {
  no_website: 'the listing has no website to verify against',
  website_dead: 'the website does not answer right now',
  website_unreadable: 'the website is not a name anyone registered',
  redirect_off_domain: 'the website redirects to a different domain',
  email_domain_differs: 'the mailbox is not at the website\'s domain',
  free_mail: 'the domain is free mail',
  isp_mail: 'the domain belongs to an internet provider',
  directory: 'the website is somebody else\'s directory listing',
  shortener: 'the website is a link shortener',
  shared_platform: 'the website sits on a shared platform, not the shop\'s own domain',
  public_suffix: 'the website host is a public suffix, so nobody registered it',
  government: 'the domain is a government, school or military domain',
  us_locality: 'the domain is a .us locality domain, shared by a whole state',
  foreign_cctld: 'the domain is a foreign country domain',
  domain_shared: 'other public listings use the same domain',
  site_never_names_shop: 'the website never names this shop',
  domain_unregistered: 'the domain is not registered — anyone can buy it today',
  domain_too_new: 'the domain was registered less than a year ago',
  domain_after_import: 'the domain was registered after we imported this listing',
  registration_unknown: 'we could not read the domain\'s registration date',
  email_not_account: 'the contact address is not the account\'s own address',
  email_unverified: 'the account\'s email address has never been confirmed',
  email_already_used: 'this address has already verified a claim on another listing',
  listing_hidden: 'the listing is not on the public map',
  listing_duplicate: 'the listing is a duplicate of another one',
  listing_closed: 'the listing is recorded as closed',
};

function reason(code, detail) {
  return { code, label: REASONS[code] || code, detail: detail || null };
}

/** Is this registrable domain one nobody can prove ownership of by mailbox? */
function domainClass(domain) {
  if (!domain) return 'public_suffix';
  if (FREE_MAIL.has(domain)) return 'free_mail';
  if (ISP_MAIL.has(domain)) return 'isp_mail';
  if (DIRECTORY_HOSTS.has(domain)) return 'directory';
  if (SHORTENERS.has(domain)) return 'shortener';
  if (SHARED_PLATFORMS.has(domain)) return 'shared_platform';

  const { suffix } = publicSuffix(domain);
  const parts = String(suffix || '').split('.');
  const tld = parts[parts.length - 1];
  if (['gov', 'edu', 'mil', 'int'].includes(tld) || parts.includes('gov') || parts.includes('edu') || parts.includes('mil')) {
    return 'government';
  }
  // A plain "myshop.us" is a domain somebody bought. Anything under a state or
  // k12 suffix (tx.us, k12.wi.us) is not: #16333 S R Tobacco lists the
  // Sheboygan school district, #2445 Tobacco House a Texas state agency.
  if (tld === 'us' && suffix !== 'us') return 'us_locality';
  // Two letters and not .us is a country the directory does not cover. A US
  // shop on .co or .io waits for staff; that is the conservative side.
  if (tld && tld.length === 2 && tld !== 'us') return 'foreign_cctld';
  return null;
}

/**
 * Does this page name this shop?
 *
 * The same rule the hours sweep uses to decide a site is the shop's own
 * (jobs/hoursSweep.js mentionsShop), restated for a single page: drop the
 * trade words every shop shares, drop the town — "Tobacco Den Brainerd"
 * matched a glass company at brainerdglass.net — and look for what is left in
 * the host or the page text. A short word has to stand alone: "Den" inside
 * "garden" is only letters.
 */
const GENERIC_NAME = new Set(['cigar', 'cigars', 'tobacco', 'tobacconist', 'shop', 'shoppe', 'store', 'lounge', 'bar',
  'club', 'co', 'company', 'inc', 'llc', 'the', 'and', 'of', 'smoke', 'smokes', 'premium', 'fine', 'humidor', 'emporium',
  'house', 'room', 'cafe', 'at', 'by', 'de', 'la', 'el']);

function pageNamesShop(store, url, text) {
  const allWords = String(store && store.name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ')
    .filter(w => w.length > 2 && !GENERIC_NAME.has(w));
  if (!allWords.length) return true;             // "Cigar Shop" names nothing to look for
  const town = new Set(String(store.city || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' '));
  const own = allWords.filter(w => !town.has(w));
  const words = own.length ? own : allWords;
  // A domain built from the name's initials and a trade word: Tobacco Republic
  // at trcigar.com.
  const initials = String(store.name || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/)
    .filter(w => w && !['the', 'and', 'of', 'at', 'by'].includes(w)).map(w => w[0]).join('');
  const stem = String(hostOf(url) || '').replace(/\.[a-z.]+$/i, '').replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (initials.length >= 2 && stem.startsWith(initials) && /^(cigars?|tobacco|smokes?|lounge|shop|co)?$/.test(stem.slice(initials.length))) return true;
  const said = String(text || '').toLowerCase();
  const host = String(hostOf(url) || '').replace(/[^a-z0-9]+/g, '');
  const hay = host + said.replace(/[^a-z0-9]+/g, '');
  const spaced = ` ${said.replace(/[^a-z0-9]+/g, ' ')} `;
  return words.some(w => (w.length < 5 ? spaced.includes(` ${w} `) || host.includes(w) : hay.includes(w)));
}

// ── The decision ────────────────────────────────────────────────────────────

/**
 * Pure. Every fact is gathered first, so this can be replayed over fixtures.
 * Returns { instant, reasons: [{code,label,detail}], facts } and collects ALL
 * the reasons rather than stopping at the first, because staff reviewing the
 * claim need the whole picture.
 */
function judge(input) {
  const { store = {}, email = '', account = {}, link = {}, page = {}, sharedListings = [], rdapFact = {}, priorEmailClaims = 0, now = Date.now() } = input || {};
  const reasons = [];
  const add = (code, detail) => reasons.push(reason(code, detail));

  const siteDomain = registrableDomain(store.website);
  const finalDomain = registrableDomain(link.final_url || store.website);
  const mailDomain = emailDomain(email);

  // 1. The listing itself has to be one a claim can be honoured on.
  if (Number(store.visible) !== 1) add('listing_hidden', store.storefront_reason || store.closed_reason || null);
  if (store.storefront === 'duplicate') add('listing_duplicate', store.storefront_reason || null);
  if (store.storefront === 'closed' || store.operating_status === 'closed' || store.operating_status === 'permanently_closed') {
    add('listing_closed', store.closed_reason || store.storefront_reason || null);
  }

  // 2. A live link, not the one we recorded weeks ago.
  if (!store.website) {
    add('no_website');
  } else if (link.status !== 'ok') {
    add('website_dead', link.status ? `website_status is ${link.status}` : null);
  }

  // 3. One registrable domain across the listed URL, where it lands, and the
  //    mailbox. #18628 fails here: thickercloudz.com lands on a gambling site.
  if (store.website && !siteDomain) add('website_unreadable', store.website);
  if (siteDomain && finalDomain && siteDomain !== finalDomain) add('redirect_off_domain', `${siteDomain} to ${finalDomain}`);
  if (!mailDomain) add('email_domain_differs', 'the contact address is not an email address');
  else if (siteDomain && mailDomain !== siteDomain) add('email_domain_differs', `${mailDomain} is not ${siteDomain}`);

  // 4. The class of domain it is.
  const klass = siteDomain ? domainClass(siteDomain) : null;
  if (klass) add(klass, siteDomain);

  // 5. One listing, one domain. Wild Bill's 203 shops share one mailbox.
  const others = sharedListings.filter(id => Number(id) !== Number(store.id));
  if (others.length) {
    add('domain_shared', `${others.length + 1} public listings use ${siteDomain} (also #${others.slice(0, 4).join(', #')}${others.length > 4 ? ', …' : ''})`);
  }

  // 6. The page has to be about this shop. #1199 Cigar Band Man links to a CPA
  //    firm; #16333 S R Tobacco to a school district.
  if (link.status === 'ok' && page.text !== undefined && page.text !== null) {
    if (!pageNamesShop(store, link.final_url || store.website, page.text)) add('site_never_names_shop', hostOf(link.final_url || store.website));
  } else if (link.status === 'ok') {
    add('site_never_names_shop', 'the page could not be read');
  }

  // 7. Who has held the domain, and since when.
  if (rdapFact.status === 'unregistered') {
    add('domain_unregistered', siteDomain);
  } else if (rdapFact.status === 'registered') {
    const reg = rdapFact.registered_at ? new Date(rdapFact.registered_at).getTime() : NaN;
    if (!Number.isFinite(reg)) {
      add('registration_unknown', 'the registry returned no registration date');
    } else {
      const ageDays = Math.floor((now - reg) / 86400000);
      if (ageDays < MIN_DOMAIN_AGE_DAYS) add('domain_too_new', `registered ${rdapFact.registered_at.slice(0, 10)}, ${ageDays} days ago`);
      const imported = store.created_at ? new Date(store.created_at).getTime() : NaN;
      if (Number.isFinite(imported) && reg > imported) {
        add('domain_after_import', `registered ${rdapFact.registered_at.slice(0, 10)}, after the listing was imported ${new Date(imported).toISOString().slice(0, 10)}`);
      }
    }
  } else {
    add('registration_unknown', rdapFact.reason || null);
  }

  // 8. The mailbox has to be the account's own, confirmed, and unspent.
  const accountEmail = String(account.email || '').trim().toLowerCase();
  if (!accountEmail || accountEmail !== String(email || '').trim().toLowerCase()) {
    add('email_not_account', accountEmail ? `the account is ${accountEmail}` : null);
  }
  if (Number(account.email_verified) !== 1) add('email_unverified');
  if (priorEmailClaims > 0) add('email_already_used', `${priorEmailClaims} claim(s) already verified with this address`);

  return {
    instant: reasons.length === 0,
    reasons,
    facts: {
      site_domain: siteDomain,
      final_domain: finalDomain,
      email_domain: mailDomain,
      domain_class: klass,
      website_status: link.status || null,
      website_final_url: link.final_url || null,
      shared_listing_count: others.length + (siteDomain ? 1 : 0),
      shared_listing_ids: others.slice(0, 10),
      page_names_shop: link.status === 'ok' ? !reasons.some(r => r.code === 'site_never_names_shop') : null,
      rdap_status: rdapFact.status || 'unknown',
      domain_registered_at: rdapFact.registered_at || null,
      listing_imported_at: store.created_at || null,
      checked_at: new Date(now).toISOString(),
    },
  };
}

// ── Gathering the facts ─────────────────────────────────────────────────────

/** One capped GET, so the name check has something to read. Never throws. */
function readPage(urlStr) {
  return new Promise(resolve => {
    let url;
    try { url = new URL(urlStr); } catch { return resolve(null); }
    const lib = url.protocol === 'http:' ? http : https;
    const req = lib.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'http:' ? 80 : 443),
      path: (url.pathname || '/') + (url.search || ''),
      method: 'GET',
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
      timeout: TIMEOUT_MS,
    }, res => {
      const type = String(res.headers['content-type'] || '').toLowerCase();
      if (type && !type.includes('html') && !type.includes('text')) { res.resume(); return resolve(null); }
      let body = '';
      res.on('data', chunk => {
        if (body.length < MAX_BODY) body += chunk; else res.destroy();
      });
      res.on('end', () => resolve(body));
      res.on('close', () => resolve(body || null));
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
    req.end();
  });
}

/** Public listings whose website sits on the same registrable domain. */
async function listingsOnDomain(domain) {
  if (!domain) return [];
  // ILIKE narrows 40k rows to a handful; the list decides which of those
  // really are the same registrable name (shop.example.com and example.com
  // are; myexample.com is not).
  const rows = await db.all(
    "SELECT id, website FROM stores WHERE visible = 1 AND website IS NOT NULL AND website ILIKE ?",
    ['%' + domain + '%']);
  return rows.filter(r => registrableDomain(r.website) === domain).map(r => r.id);
}

/** How many claims this address has already carried through email verification. */
async function priorEmailVerifiedClaims(email, exceptStoreId) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return 0;
  const row = await db.get(`
    SELECT COUNT(*) as n FROM store_claims
    WHERE status = 'approved' AND method = 'email' AND LOWER(contact_email) = ? AND store_id <> ?
  `, [e, exceptStoreId || 0]);
  return Number(row && row.n) || 0;
}

/**
 * Run the live checks and judge. One link check, at most one page read and one
 * RDAP lookup (cached for 30 days), two small queries.
 */
async function gate(store, account, email, { now = Date.now() } = {}) {
  const link = store.website
    ? await checkWebsite(store.website).catch(() => ({ status: 'error', final_url: null }))
    : { status: null, final_url: null };

  const siteDomain = registrableDomain(store.website);
  const finalUrl = link.final_url || (store.website ? 'https://' + (parseWebsite(store.website) || { host: '' }).host : null);

  let page = {};
  if (link.status === 'ok' && finalUrl) {
    const html = await readPage(finalUrl);
    page = { text: html === null ? null : pageText(html).slice(0, 200000) };
  }

  const [sharedListings, rdapFact, priorEmailClaims] = await Promise.all([
    listingsOnDomain(siteDomain),
    siteDomain ? rdap.lookup(siteDomain) : Promise.resolve({ status: 'unknown', registered_at: null }),
    priorEmailVerifiedClaims(email, store.id),
  ]);

  return judge({ store, email, account, link, page, sharedListings, rdapFact, priorEmailClaims, now });
}

module.exports = {
  gate, judge, pageNamesShop, domainClass, listingsOnDomain, priorEmailVerifiedClaims,
  REASONS, MIN_DOMAIN_AGE_DAYS, FREE_MAIL, ISP_MAIL, DIRECTORY_HOSTS, SHORTENERS, SHARED_PLATFORMS,
};

// ── Self-test ───────────────────────────────────────────────────────────────
// Every listing named below is a real row from the 2026-09-10 snapshot, with
// the website, status, final URL and verdict it actually carries, and the RDAP
// answers the audit recorded. Run: node src/utils/claimGate.js
function selfTest() {
  let pass = 0, fail = 0;
  const ok = (cond, label, got) => {
    if (cond) pass++;
    else { fail++; console.log(`  FAIL ${label}${got !== undefined ? '\n       ' + JSON.stringify(got) : ''}`); }
  };
  const NOW = Date.parse('2026-09-11T00:00:00Z');
  const IMPORTED = '2026-09-10T18:17:17.000Z';

  // A claim with nothing wrong with it, which every case below varies from.
  const good = {
    store: { id: 9001, name: 'Tower Pipes and Cigars', city: 'Sacramento', website: 'towercigars.com', visible: 1, storefront: 'yes', operating_status: 'open', created_at: IMPORTED },
    email: 'owner@towercigars.com',
    account: { email: 'owner@towercigars.com', email_verified: 1 },
    link: { status: 'ok', final_url: 'https://www.towercigars.com/' },
    page: { text: 'Tower Pipes and Cigars, 1600 Broadway, Sacramento. Store hours Monday-Saturday 9am-6pm.' },
    sharedListings: [9001],
    rdapFact: { status: 'registered', registered_at: '2004-05-01T00:00:00Z' },
    priorEmailClaims: 0,
    now: NOW,
  };
  const codes = r => r.reasons.map(x => x.code);
  const vary = extra => judge({ ...good, ...extra });

  let r = judge(good);
  ok(r.instant, 'a live, single-listing, year-old, self-named domain passes', codes(r));

  // ── The 12 bad suffixes and shared hosts the audit listed ────────────────
  r = vary({ store: { ...good.store, id: 3624, name: 'The Pipe King', city: 'Orange', website: 'pipeking.com.au' },
    email: 'anyone@pipeking.com.au', account: { email: 'anyone@pipeking.com.au', email_verified: 1 },
    link: { status: 'ok', final_url: 'https://www.pipeking.com.au/' }, sharedListings: [3624],
    page: { text: 'Pipe King Australia. Polyethylene pipe and fittings, Caringbah NSW.' } });
  ok(!r.instant && codes(r).includes('foreign_cctld'), '#3624 pipeking.com.au is a foreign country domain', codes(r));

  r = vary({ store: { ...good.store, id: 12092, name: 'Redzone Casual Restaurant Sports & Cigar Bar', city: 'Memphis', website: 'redzone.co.uk' },
    email: 'anyone@redzone.co.uk', account: { email: 'anyone@redzone.co.uk', email_verified: 1 },
    link: { status: 'ok', final_url: 'http://redzone.co.uk/' }, sharedListings: [12092], page: { text: 'Redzone | London' } });
  ok(!r.instant && codes(r).includes('foreign_cctld'), '#12092 redzone.co.uk is a foreign country domain', codes(r));

  r = vary({ store: { ...good.store, id: 16333, name: 'S R Tobacco', city: 'Sheboygan', website: 'sheboygan.k12.wi.us' },
    email: 'anyone@sheboygan.k12.wi.us', account: { email: 'anyone@sheboygan.k12.wi.us', email_verified: 1 },
    link: { status: 'ok', final_url: 'https://www.sheboygan.k12.wi.us/' }, sharedListings: [16333],
    page: { text: 'School Health Services School Hours School Meals Sheboygan Area School District' } });
  ok(!r.instant && codes(r).includes('us_locality'), '#16333 the Sheboygan school district is a .us locality', codes(r));
  // The name check deliberately cannot fire here: "S R Tobacco" is two initials
  // and a trade word, so there is no distinctive word to look for, and a
  // blanket refusal for that would catch every shop called "Tobacco Shop". The
  // .us locality rule is what refuses this one, and that is enough.
  ok(!codes(r).includes('site_never_names_shop'),
    '#16333 is refused on its suffix, not on its name — there is no name to look for', codes(r));

  r = vary({ store: { ...good.store, id: 2445, name: 'Tobacco House', city: 'Kerrville', website: 'dars.state.tx.us' },
    email: 'anyone@dars.state.tx.us', account: { email: 'anyone@dars.state.tx.us', email_verified: 1 },
    link: { status: 'dns_fail', final_url: null }, sharedListings: [2445], page: {} });
  ok(!r.instant && codes(r).includes('us_locality') && codes(r).includes('website_dead'),
    '#2445 a dead Texas state agency domain', codes(r));

  r = vary({ store: { ...good.store, id: 21932, name: 'Dutchess County Cigar Company', city: 'Fishkill', website: 'yahoo.com' },
    email: 'anyone@yahoo.com', account: { email: 'anyone@yahoo.com', email_verified: 1 },
    link: { status: 'ok', final_url: 'https://www.yahoo.com/' }, sharedListings: [21932, 3889, 15090],
    page: { text: 'Yahoo news finance sports' } });
  ok(!r.instant && codes(r).includes('free_mail'), '#21932 yahoo.com is free mail', codes(r));

  r = vary({ store: { ...good.store, id: 3889, name: 'el Leon Cigars de Los Angeles', city: 'Los Angeles', website: 'local.yahoo.com/info-83693415-leon-cigars-los-angeles' },
    email: 'anyone@yahoo.com', account: { email: 'anyone@yahoo.com', email_verified: 1 },
    link: { status: 'ok', final_url: 'https://local.yahoo.com/info-83693415-leon-cigars-los-angeles/' },
    sharedListings: [3889], page: { text: 'el Leon Cigars de Los Angeles' } });
  ok(!r.instant && codes(r).includes('free_mail'), '#3889 a local.yahoo.com page is still yahoo.com', codes(r));

  r = vary({ store: { ...good.store, id: 6604, name: 'Tobacco Shack', city: 'Poplarville', website: 'tobaccoshack.tripod.com' },
    email: 'anyone@tripod.com', account: { email: 'anyone@tripod.com', email_verified: 1 },
    link: { status: 'dns_fail', final_url: null }, sharedListings: [6604, 7044], page: {} });
  ok(!r.instant && codes(r).includes('shared_platform'), '#6604 tripod.com is a shared platform', codes(r));
  ok(codes(r).includes('domain_shared'), '#6604 and #7044 share the host, and the list would read it as one domain', codes(r));

  r = vary({ store: { ...good.store, id: 640, name: 'Ryo Tobacco', city: 'Tampa', website: 'tobaccoblends.com.au' },
    email: 'anyone@tobaccoblends.com.au', account: { email: 'anyone@tobaccoblends.com.au', email_verified: 1 },
    link: { status: 'error', final_url: 'https://tobaccoblends.com.au/' }, sharedListings: [640], page: {} });
  ok(!r.instant && codes(r).includes('foreign_cctld') && codes(r).includes('website_dead'), '#640 tobaccoblends.com.au', codes(r));

  r = vary({ store: { ...good.store, id: 447, name: 'Straight Pipes & Vapes', city: 'Clearwater', website: 'straightpipesandvapes.business.site' },
    email: 'anyone@business.site', account: { email: 'anyone@business.site', email_verified: 1 },
    link: { status: 'ok', final_url: 'https://straightpipesandvapes.business.site/' }, sharedListings: [447],
    page: { text: 'Straight Pipes and Vapes' } });
  ok(!r.instant && codes(r).includes('shared_platform'), 'a business.site page is a shared platform', codes(r));

  // ── The dead domains anyone can buy today ────────────────────────────────
  for (const [id, name, city, domain] of [
    [13278, 'Tobacco King', 'Davenport', 'tobaccokingia.com'],
    [15724, 'Roosevelt Tobacco', 'Villa Park', 'roosevelttobacco.com'],
    [6162, 'Smoke Place Cigars & Smoke Shop', 'Jacksonville', 'ortegasmokeshop.com'],
    [29931, 'First Choice Pipe Tobacco', 'Post Falls', 'firstchoicepipetobacco.com'],
    [17918, 'River Ridge Tobacco Shop', 'Clemmons', 'riverridgetobacco.com'],
    [22492, 'Crawfords Cigar Shoppe', 'Vernon Rockville', 'haveacigarct.com'],
    [13588, 'Blaine Tobacco Store', 'Blaine', 'blainetobacco.com'],
    [21980, 'Mr & Ms Cigar Tobacconists', 'Milford', 'mrandmscigartobacconist.com'],
    [7558, 'Havana Night Cigars', 'Columbus', 'hncigars.com'],
  ]) {
    r = vary({ store: { ...good.store, id, name, city, website: domain },
      email: `anyone@${domain}`, account: { email: `anyone@${domain}`, email_verified: 1 },
      link: { status: 'dns_fail', final_url: null }, sharedListings: [id],
      rdapFact: { status: 'unregistered', registered_at: null }, page: {} });
    ok(!r.instant && codes(r).includes('website_dead') && codes(r).includes('domain_unregistered'),
      `#${id} ${name}: ${domain} is dead and unregistered`, codes(r));
  }

  // #278 Gulfport Cigars: the domain was bought three weeks before the
  // snapshot, by somebody who is not the shop.
  r = vary({ store: { ...good.store, id: 278, name: 'Gulfport Cigars', city: 'Gulfport', website: 'gulfportcigars.com' },
    email: 'anyone@gulfportcigars.com', account: { email: 'anyone@gulfportcigars.com', email_verified: 1 },
    link: { status: 'dns_fail', final_url: null }, sharedListings: [278],
    rdapFact: { status: 'registered', registered_at: '2026-08-17T18:39:42Z' }, page: {} });
  ok(!r.instant && codes(r).includes('domain_too_new'),
    '#278 gulfportcigars.com was re-registered three weeks before the snapshot', codes(r));
  // Not domain_after_import: 2026-08-17 is three weeks BEFORE the 2026-09-10
  // import, so that rule correctly stays quiet. It fires for a listing the
  // directory recorded before the domain changed hands, which is the case the
  // rule exists for.
  r = vary({ store: { ...good.store, id: 278, name: 'Gulfport Cigars', city: 'Gulfport', website: 'gulfportcigars.com', created_at: '2025-01-01T00:00:00Z' },
    email: 'anyone@gulfportcigars.com', account: { email: 'anyone@gulfportcigars.com', email_verified: 1 },
    link: { status: 'ok', final_url: 'https://gulfportcigars.com/' }, sharedListings: [278],
    rdapFact: { status: 'registered', registered_at: '2026-08-17T18:39:42Z' },
    page: { text: 'Gulfport Cigars' } });
  ok(!r.instant && codes(r).includes('domain_after_import'),
    'and a domain bought after the listing was imported is caught by its own rule', codes(r));

  // ── The redirects: gambling sites and for-sale pages ─────────────────────
  for (const [id, name, city, site, dest] of [
    [18628, 'Thicker Cloudz Arlington(Tobacco, Vape, Smoke, Cigar & Hookah)', 'Arlington', 'thickercloudz.com', 'https://www.vipbet88judibola.com/'],
    [18679, 'Thicker Cloudz Arlington , falls church (Tobacco, Vape, Smoke, Cigar & Hookah)', 'Arlington', 'thickercloudz.com', 'https://www.vipbet88judibola.com/'],
    [18765, 'Thicker Cloudz Clarendon(Tobacco, Vape, Smoke, Delta, Cigar & Hookah)', 'Arlington', 'thickercloudz.com', 'https://www.vipbet88judibola.com/'],
  ]) {
    r = vary({ store: { ...good.store, id, name, city, website: site },
      email: 'anyone@thickercloudz.com', account: { email: 'anyone@thickercloudz.com', email_verified: 1 },
      link: { status: 'blocked', final_url: dest }, sharedListings: [18628, 18679, 18765],
      rdapFact: { status: 'registered', registered_at: '2016-03-02T00:00:00Z' }, page: {} });
    ok(!r.instant && codes(r).includes('redirect_off_domain') && codes(r).includes('domain_shared'),
      `#${id} thickercloudz.com lands on a gambling site and is shared by three listings`, codes(r));
    ok(!codes(r).includes('domain_too_new'), `#${id} a 2016 registration date alone would have let it through`, codes(r));
  }

  r = vary({ store: { ...good.store, id: 8021, name: 'Puff n Stuff Cigars', city: 'Decatur', website: 'puffnstuffcigars.com' },
    email: 'anyone@puffnstuffcigars.com', account: { email: 'anyone@puffnstuffcigars.com', email_verified: 1 },
    link: { status: 'ok', final_url: 'https://gamebaidoithuong.property/' }, sharedListings: [8021, 8137],
    rdapFact: { status: 'registered', registered_at: '2026-05-18T00:00:00Z' }, page: { text: 'game bai doi thuong' } });
  ok(!r.instant && codes(r).includes('redirect_off_domain') && codes(r).includes('domain_too_new'),
    '#8021 puffnstuffcigars.com redirects to gambling and was re-registered in May', codes(r));

  r = vary({ store: { ...good.store, id: 21998, name: 'Central Cigar Lounge', city: 'Yonkers', website: 'centralcigarlounge.com' },
    email: 'anyone@centralcigarlounge.com', account: { email: 'anyone@centralcigarlounge.com', email_verified: 1 },
    link: { status: 'ok', final_url: 'https://maha4d2.org/' }, sharedListings: [21998],
    rdapFact: { status: 'registered', registered_at: '2012-01-01T00:00:00Z' }, page: { text: 'maha4d slot online' } });
  ok(!r.instant && codes(r).includes('redirect_off_domain'), '#21998 centralcigarlounge.com lands on maha4d2.org', codes(r));

  r = vary({ store: { ...good.store, id: 23510, name: 'Senor Cigars', city: 'Tampa', website: 'yborcitycigars.com' },
    email: 'anyone@yborcitycigars.com', account: { email: 'anyone@yborcitycigars.com', email_verified: 1 },
    link: { status: 'ok', final_url: 'https://expireddomains.com/domain/yborcitycigars.com?utm_source=redi' },
    sharedListings: [23510], page: { text: 'Buy this domain' } });
  ok(!r.instant && codes(r).includes('redirect_off_domain'), '#23510 yborcitycigars.com is on a for-sale page', codes(r));

  r = vary({ store: { ...good.store, id: 20861, name: 'Downtown News and Tobacco', city: 'Somerville', website: 'somervillesmokeshop.com' },
    email: 'anyone@somervillesmokeshop.com', account: { email: 'anyone@somervillesmokeshop.com', email_verified: 1 },
    link: { status: 'ok', final_url: 'https://expireddomains.com/domain/somervillesmokeshop.com?utm_source=redi' },
    sharedListings: [20861], page: { text: 'Buy this domain' } });
  ok(!r.instant && codes(r).includes('redirect_off_domain'), '#20861 somervillesmokeshop.com is on a for-sale page', codes(r));

  // ── Somebody else's business ─────────────────────────────────────────────
  r = vary({ store: { ...good.store, id: 1199, name: 'Cigar Band Man', city: 'Hialeah', website: 'innovativecpa.com' },
    email: 'anyone@innovativecpa.com', account: { email: 'anyone@innovativecpa.com', email_verified: 1 },
    link: { status: 'ok', final_url: 'https://www.innovativecpa.com/' }, sharedListings: [1199],
    page: { text: 'Innovative CPA Group. Tax planning, accounting and advisory services.' } });
  ok(!r.instant && codes(r).includes('site_never_names_shop'), '#1199 a CPA firm never names Cigar Band Man', codes(r));

  r = vary({ store: { ...good.store, id: 862, name: 'Miami Cigar Shop', city: 'Pinecrest', website: 'neptunecigar.com' },
    email: 'anyone@neptunecigar.com', account: { email: 'anyone@neptunecigar.com', email_verified: 1 },
    link: { status: 'ok', final_url: 'https://www.neptunecigar.com/' }, sharedListings: [862, 1488],
    page: { text: 'Neptune Cigar: buy cigars online, free shipping' } });
  ok(!r.instant && codes(r).includes('domain_shared'), '#862 an online retailer covers two listings', codes(r));

  // ── One mailbox, many shops ──────────────────────────────────────────────
  r = vary({ store: { ...good.store, id: 5001, name: "Wild Bill's Tobacco", city: 'Ravenna', website: 'wildbillstobacco.com' },
    email: 'anyone@wildbillstobacco.com', account: { email: 'anyone@wildbillstobacco.com', email_verified: 1 },
    link: { status: 'ok', final_url: 'https://wildbillstobacco.com/' },
    sharedListings: Array.from({ length: 203 }, (_, i) => 5001 + i),
    page: { text: "Wild Bill's Tobacco locations" } });
  ok(!r.instant && codes(r).includes('domain_shared'), "one wildbillstobacco.com mailbox cannot claim 203 shops", codes(r));
  ok(/203 public listings/.test(r.reasons.find(x => x.code === 'domain_shared').detail), 'the reason names the count', r.reasons);

  r = vary({ store: { ...good.store, id: 6001, name: 'Stix Cigar Lounge', city: 'Fair Oaks', website: 'hub.biz' },
    email: 'anyone@hub.biz', account: { email: 'anyone@hub.biz', email_verified: 1 },
    link: { status: 'ok', final_url: 'https://hub.biz/' }, sharedListings: [6001, 6002], page: { text: 'hub.biz business directory' } });
  ok(!r.instant && codes(r).includes('directory'), 'hub.biz is a directory', codes(r));

  // ── The account side ─────────────────────────────────────────────────────
  r = vary({ email: 'someone.else@towercigars.com' });
  ok(!r.instant && codes(r).includes('email_not_account'), 'a contact address that is not the account address', codes(r));
  r = vary({ account: { email: 'owner@towercigars.com', email_verified: 0 } });
  ok(!r.instant && codes(r).includes('email_unverified'), 'an account that never confirmed its address', codes(r));
  r = vary({ priorEmailClaims: 1 });
  ok(!r.instant && codes(r).includes('email_already_used'), 'one email-verified claim per address', codes(r));
  r = vary({ email: 'owner@gmail.com', account: { email: 'owner@gmail.com', email_verified: 1 } });
  ok(!r.instant && codes(r).includes('email_domain_differs'), 'a gmail address does not match the shop domain', codes(r));

  // ── The listing side ─────────────────────────────────────────────────────
  r = vary({ store: { ...good.store, id: 415, name: 'Mardo Cigars', city: 'Sarasota', website: 'mardocigars.com', visible: 0, storefront: 'duplicate', storefront_reason: 'Same shop as listing #414' },
    email: 'anyone@mardocigars.com', account: { email: 'anyone@mardocigars.com', email_verified: 1 },
    link: { status: 'ok', final_url: 'https://mardocigars.com/' }, sharedListings: [414], page: { text: 'Mardo Cigars Sarasota' } });
  ok(!r.instant && codes(r).includes('listing_duplicate') && codes(r).includes('listing_hidden'), '#415 is a duplicate of #414', codes(r));

  r = vary({ store: { ...good.store, id: 10022, name: 'Broadway Cigar Company', city: 'Camas', website: 'broadwaycigar.com', visible: 0, storefront: 'closed', storefront_reason: 'Reported permanently closed by the owner of this site', staff_edited: 1 },
    email: 'anyone@broadwaycigar.com', account: { email: 'anyone@broadwaycigar.com', email_verified: 1 },
    link: { status: 'ok', final_url: 'https://broadwaycigar.com/' }, sharedListings: [10022], page: { text: 'Broadway Cigar Company Camas' } });
  ok(!r.instant && codes(r).includes('listing_closed'), '#10022 is confirmed closed', codes(r));

  r = vary({ store: { ...good.store, id: 923, name: 'Cubanacan Cigars', city: 'Coral Gables', website: 'cubanacancigars.com', visible: 0, operating_status: 'permanently_closed', closed_reason: 'Marked permanently closed in the source data' },
    email: 'anyone@cubanacancigars.com', account: { email: 'anyone@cubanacancigars.com', email_verified: 1 },
    link: { status: 'ok', final_url: 'https://www.cubanacancigars.com/' }, sharedListings: [923], page: { text: 'Cubanacan Cigars Coral Gables' } });
  ok(!r.instant && codes(r).includes('listing_closed'), '#923 is permanently closed in the source', codes(r));

  // ── What must still pass: real owners the gate must not shut out ─────────
  // A long-held domain, one listing, a working site that names the shop.
  r = vary({ store: { ...good.store, id: 155, name: 'Cigar Society', city: 'Kansas City', website: 'cigarsociety.com' },
    email: 'owner@cigarsociety.com', account: { email: 'owner@cigarsociety.com', email_verified: 1 },
    link: { status: 'ok', final_url: 'https://cigarsociety.com/' }, sharedListings: [155],
    rdapFact: { status: 'registered', registered_at: '2015-02-10T00:00:00Z' },
    page: { text: 'Cigar Society Kansas City. Open until 2am on weekends.' } });
  ok(r.instant, 'a real owner on their own long-held domain still gets the instant code', codes(r));

  // A subdomain mailbox at the same registrable name is the same owner.
  r = vary({ email: 'owner@mail.towercigars.com', account: { email: 'owner@mail.towercigars.com', email_verified: 1 } });
  ok(r.instant, 'a mailbox on a subdomain of the shop domain still passes', codes(r));

  // A redirect that stays inside the same registrable name is not a takeover.
  r = vary({ link: { status: 'ok', final_url: 'https://shop.towercigars.com/home' } });
  ok(r.instant, 'a redirect within the shop\'s own domain is fine', codes(r));

  // A name made of nothing but trade words cannot be looked for, so the name
  // check must not become a blanket refusal.
  r = vary({ store: { ...good.store, id: 16, name: 'Tobacco Shop', city: 'Hilo', website: 'towercigars.com' },
    sharedListings: [16], page: { text: 'nothing in particular' } });
  ok(r.instant, 'a shop called only "Tobacco Shop" is not refused for not being named', codes(r));

  // Exactly a year old is old enough; a day short is not.
  r = vary({ rdapFact: { status: 'registered', registered_at: new Date(NOW - 366 * 86400000).toISOString() },
    store: { ...good.store, created_at: new Date(NOW - 1 * 86400000).toISOString() } });
  ok(r.instant, 'a domain registered 366 days ago passes', codes(r));
  r = vary({ rdapFact: { status: 'registered', registered_at: new Date(NOW - 364 * 86400000).toISOString() },
    store: { ...good.store, created_at: new Date(NOW - 1 * 86400000).toISOString() } });
  ok(!r.instant && codes(r).includes('domain_too_new'), 'a domain registered 364 days ago does not', codes(r));

  // RDAP is often simply unavailable. That is not evidence either way, so the
  // claim goes to staff rather than being refused or waved through.
  r = vary({ rdapFact: { status: 'unknown', registered_at: null, reason: 'rdap http 503' } });
  ok(!r.instant && codes(r).includes('registration_unknown'), 'an unreachable registry sends the claim to staff', codes(r));

  // 'blocked' is a working link for a shopper, but we cannot read the page, so
  // it is not enough for a self-serve takeover.
  r = vary({ link: { status: 'blocked', final_url: 'https://www.towercigars.com/' }, page: {} });
  ok(!r.instant && codes(r).includes('website_dead'), 'a Cloudflare wall is not proof of anything', codes(r));

  // The gate never rejects: every failure is a list of reasons, not a refusal.
  r = vary({ store: { ...good.store, website: null }, email: 'owner@gmail.com', account: { email: 'owner@gmail.com', email_verified: 0 } });
  ok(!r.instant && r.reasons.length >= 2 && r.reasons.every(x => x.label),
    'a listing with no website collects reasons, not a refusal', codes(r));
  ok(codes(r).includes('no_website') && codes(r).includes('email_unverified'),
    'and names both of them: there is no domain to judge, so the domain rules stay quiet', codes(r));

  // ── The name matcher on its own ──────────────────────────────────────────
  ok(pageNamesShop({ name: 'Tower Pipes and Cigars', city: 'Sacramento' }, 'https://towercigars.com/', 'Welcome to Tower'),
    'the host carries the name');
  ok(!pageNamesShop({ name: 'Tobacco Den', city: 'Brainerd' }, 'https://brainerdglass.net/', 'Brainerd Glass Company'),
    'a glass company in the same town is not the shop');
  ok(pageNamesShop({ name: 'Tobacco Republic', city: 'Nashville' }, 'https://trcigar.com/', 'hours'),
    'initials plus a trade word is the shop');
  ok(!pageNamesShop({ name: 'Tobacco Den', city: 'Erie' }, 'https://example.com/', 'the garden is golden'),
    'a short word inside another word is only letters');

  console.log(`claimGate self-test: ${pass} passed, ${fail} failed`);
  return fail === 0;
}

if (require.main === module) {
  process.exit(selfTest() ? 0 : 1);
}
