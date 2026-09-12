/**
 * May this listing be claimed by anyone who can read email at its domain?
 *
 * The instant-claim path sends a code to an address at the listed website's
 * domain, and trusts whoever answers it. Today that is the only check, and it
 * rests on a field the national directory supplied and nobody has verified:
 *
 *   - 1,150 of the 4,533 eligible listings have a dead website, and RDAP says
 *     about seventy per cent of those .com roots are not registered at all. A
 *     stranger can buy the domain for ten dollars and claim the shop.
 *   - 314 redirect to a different domain. Fourteen land on gambling sites, ten
 *     on domain-for-sale pages.
 *   - 1,662 listings sit on 420 shared domains. wildbillstobacco.com covers 203
 *     listings; hub.biz, a directory, covers 42 unrelated shops, so the
 *     directory's operator could claim all of them.
 *   - Twelve listings have a root that is a public suffix, a free-mail host or
 *     a government one: a .com.au or .co.uk mailbox costs a few dollars, and
 *     anyone at sheboygan.k12.wi.us is a school district.
 *
 * Nothing here rejects a claim. It decides only whether the self-serve
 * shortcut is available; everything else goes to a person, with the reasons
 * attached so the claimant can be told what proof to send.
 *
 *   node src/utils/claimProof.js selftest
 */
'use strict';

const { rootDomain } = require('./claims');

/**
 * The multi-label public suffixes this directory actually meets, including the
 * PRIVATE section entries that matter here: a mailbox at wixsite.com or
 * myshopify.com proves nothing about who runs a shop, because the label in
 * front of it is handed out to anybody.
 *
 * A full Public Suffix List is thousands of lines and changes weekly. This is
 * the working subset, and `isPublicSuffix` treats any unknown two-label foreign
 * root conservatively rather than guessing.
 */
const PUBLIC_SUFFIXES = new Set([
  // ICANN section: country second-level domains.
  'co.uk', 'org.uk', 'me.uk', 'ac.uk', 'gov.uk', 'ltd.uk', 'plc.uk', 'net.uk', 'sch.uk',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au', 'id.au', 'asn.au',
  'co.nz', 'net.nz', 'org.nz', 'govt.nz', 'ac.nz',
  'co.za', 'org.za', 'net.za', 'gov.za', 'ac.za',
  'com.br', 'net.br', 'org.br', 'com.mx', 'org.mx', 'com.ar', 'com.co', 'com.pe',
  'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp', 'co.kr', 'or.kr',
  'co.in', 'net.in', 'org.in', 'gov.in', 'com.sg', 'com.hk', 'com.tw', 'com.ph',
  'com.my', 'com.tr', 'co.il', 'org.il', 'com.cn', 'net.cn', 'org.cn', 'gov.cn',
  'com.ua', 'com.pl', 'com.es', 'co.id', 'com.vn', 'com.pk', 'com.ng',
  // United States localities: every one of these is handed out per town or
  // school district. sheboygan.k12.wi.us is a school district's home page.
  'k12.ak.us', 'k12.al.us', 'k12.ar.us', 'k12.az.us', 'k12.ca.us', 'k12.co.us',
  'k12.ct.us', 'k12.de.us', 'k12.fl.us', 'k12.ga.us', 'k12.ia.us', 'k12.id.us',
  'k12.il.us', 'k12.in.us', 'k12.ks.us', 'k12.ky.us', 'k12.la.us', 'k12.ma.us',
  'k12.md.us', 'k12.me.us', 'k12.mi.us', 'k12.mn.us', 'k12.mo.us', 'k12.ms.us',
  'k12.mt.us', 'k12.nc.us', 'k12.nd.us', 'k12.ne.us', 'k12.nh.us', 'k12.nj.us',
  'k12.nm.us', 'k12.nv.us', 'k12.ny.us', 'k12.oh.us', 'k12.ok.us', 'k12.or.us',
  'k12.pa.us', 'k12.ri.us', 'k12.sc.us', 'k12.sd.us', 'k12.tn.us', 'k12.tx.us',
  'k12.ut.us', 'k12.va.us', 'k12.vi.us', 'k12.vt.us', 'k12.wa.us', 'k12.wi.us',
  'k12.wv.us', 'k12.wy.us', 'cc.ak.us', 'lib.wi.us', 'nsn.us',
]);

/**
 * The Public Suffix List's PRIVATE section: hosting platforms that hand out a
 * label to anyone who signs up. "tobaccoshack.tripod.com" is a registrable
 * domain in the strict sense, but nobody receives email at it and the shop does
 * not control it, so it can never carry a claim.
 */
const PLATFORM_SUFFIXES = new Set([
  'wixsite.com', 'myshopify.com', 'github.io', 'blogspot.com', 'wordpress.com',
  'weebly.com', 'squarespace.com', 'square.site', 'business.site', 'mybusiness.site',
  'godaddysites.com', 'tripod.com', 'webs.com', 'netlify.app', 'vercel.app',
  'pages.dev', 'web.app', 'firebaseapp.com', 'herokuapp.com', 'glitch.me',
  'sites.google.com', 'notion.site', 'carrd.co', 'beacons.ai', 'bio.link',
]);
for (const p of PLATFORM_SUFFIXES) PUBLIC_SUFFIXES.add(p);

/** *.state.xx.us and *.xx.us localities, which the list above cannot enumerate. */
const US_LOCALITY = /\.(?:state\.)?[a-z]{2}\.us$/i;

/**
 * Free mailboxes, internet providers, shorteners and directories. A mailbox at
 * any of these says nothing about who runs a shop.
 */
const NEVER_PROVES_OWNERSHIP = new Set([
  // Free mail and internet providers.
  'yahoo.com', 'aol.com', 'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com',
  'live.com', 'msn.com', 'icloud.com', 'me.com', 'mac.com', 'protonmail.com', 'proton.me',
  'gmx.com', 'mail.com', 'zoho.com', 'yandex.com', 'comcast.net', 'att.net',
  'sbcglobal.net', 'verizon.net', 'bellsouth.net', 'earthlink.net', 'charter.net',
  'cox.net', 'rr.com', 'frontier.com', 'juno.com', 'optonline.net', 'windstream.net',
  'roadrunner.com', 'netzero.net', 'ymail.com', 'rocketmail.com',
  // Shorteners.
  'goo.gl', 'g.co', 'share.google', 'tinyurl.com', 'bit.ly', 'fb.me', 'l.ink', 'lnk.to',
  // Directories and listing platforms: the operator could claim every shop on them.
  'hub.biz', 'hubbiz.net', 'mapquest.com', 'eventbrite.com', 'yellowpages.com',
  'cigarplaces.com', 'cigarsocialnetwork.com', 'placeweb.site', 'company.site',
  'findsmokeshop.com', 'yelp.com', 'facebook.com', 'instagram.com', 'linktr.ee',
  'google.com', 'twitter.com', 'x.com', 'tiktok.com', 'youtube.com', 'linkedin.com',
  'foursquare.com', 'tripadvisor.com', 'bbb.org', 'nextdoor.com', 'patch.com',
  // Online retailers and manufacturers whose sites several listings point at.
  'cigarsinternational.com', 'neptunecigar.com', 'jcnewman.com',
]);

/** A domain that belongs to a government, a school or the armed forces. */
const INSTITUTIONAL_TLD = /\.(?:gov|mil|edu)$/i;

/** The only country code a US directory's listings should be claimed from. */
const US_TLDS = new Set(['com', 'net', 'org', 'biz', 'info', 'us', 'co', 'shop', 'store', 'cigars', 'club']);

/** How long a domain must have been registered before it can prove ownership. */
const MIN_REGISTRATION_DAYS = 365;

/**
 * The registrable domain under the suffix list: "example.co.uk" from
 * "shop.example.co.uk", and null when the host IS a suffix and nothing sits in
 * front of it.
 */
function registrableDomain(hostOrUrl) {
  let host = String(hostOrUrl || '').toLowerCase().trim();
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').split(/[/?#]/)[0].replace(/^www\./, '')
    .split(':')[0].replace(/\.+$/, '');
  if (!host || !host.includes('.')) return null;
  const parts = host.split('.');
  for (let i = 1; i < parts.length - 1; i++) {
    const candidate = parts.slice(i).join('.');
    if (PUBLIC_SUFFIXES.has(candidate)) {
      return i === 0 ? null : parts.slice(i - 1).join('.');
    }
  }
  // *.xx.us and *.state.xx.us: the locality is the suffix, so a two-label root
  // under it is a town or a school, not a business.
  if (US_LOCALITY.test(host) && parts.length >= 3) return parts.slice(-4).join('.');
  return parts.slice(-2).join('.');
}

/** The hosting platform this domain sits on, or null. */
function platformSuffixOf(hostOrUrl) {
  const host = String(hostOrUrl || '').toLowerCase().replace(/^[a-z]+:\/\//, '')
    .split(/[/?#]/)[0].replace(/^www\./, '');
  const parts = host.split('.');
  for (let i = 1; i < parts.length; i++) {
    const candidate = parts.slice(i).join('.');
    if (PLATFORM_SUFFIXES.has(candidate)) return candidate;
  }
  return null;
}

/** Is this host itself a public suffix, with nothing of its own in front? */
function isPublicSuffix(hostOrUrl) {
  const host = String(hostOrUrl || '').toLowerCase().replace(/^[a-z]+:\/\//, '')
    .split(/[/?#]/)[0].replace(/^www\./, '');
  return PUBLIC_SUFFIXES.has(host);
}

function tldOf(domain) {
  const parts = String(domain || '').split('.');
  return parts.length ? parts[parts.length - 1] : '';
}

/**
 * Every reason this listing cannot be claimed by email code alone.
 *
 * An empty list means the shortcut is available. Anything else is a list of
 * plain sentences a claimant can be shown.
 *
 * @param {object} listing   the stores row: website, website_status,
 *                           website_final_url, visible, storefront, name,
 *                           phone, address, created_at
 * @param {object} context   { email, emailVerified, siblingsOnDomain,
 *                             liveStatus, pageText, rdap, now }
 */
function claimProofReasons(listing = {}, context = {}) {
  const reasons = [];
  const now = context.now || new Date();

  // (0) A listing staff have hidden, or that is a duplicate of another, is
  //     never self-served: approving it would put a closed shop back on the map
  //     with a green check, or add a second pin for one shop.
  if (Number(listing.visible) === 0) reasons.push('this listing is not on the public map');
  if (listing.storefront === 'duplicate') {
    reasons.push(`this listing is a duplicate of another${listing.storefront_reason ? ` (${listing.storefront_reason})` : ''}`);
  }
  if (['closed', 'not_retail', 'online_only'].includes(listing.storefront)
    || listing.operating_status === 'permanently_closed') {
    reasons.push('this listing is marked closed or not a retail shop');
  }

  const website = listing.website;
  if (!website) {
    reasons.push('this listing has no website, so there is no domain to send a code to');
    return reasons;
  }

  const listed = registrableDomain(website);
  if (!listed) {
    reasons.push(`"${website}" has no registrable domain of its own`);
    return reasons;
  }

  // (a) A live re-check has to say the site answers. 'blocked' goes to a
  //     person, because a page we cannot read is a page we cannot check.
  const status = context.liveStatus || listing.website_status;
  if (status !== 'ok') {
    reasons.push(status === 'blocked'
      ? 'the site would not serve our checker, so we cannot read it'
      : `the website is ${status || 'unchecked'}, and a domain that does not answer can be bought by anyone`);
  }

  // (b) The listed URL, the final URL after redirects, and the email all have
  //     to be the same registrable domain.
  const finalUrl = context.finalUrl || listing.website_final_url;
  if (finalUrl) {
    const landed = registrableDomain(finalUrl);
    if (landed && landed !== listed) {
      reasons.push(`the listed website now lands on ${landed}, which is a different domain`);
    }
  }
  if (context.email) {
    const emailDomain = registrableDomain(String(context.email).split('@')[1] || '');
    if (!emailDomain || emailDomain !== listed) {
      reasons.push(`the email address is not at ${listed}`);
    }
  }

  // (c) The deny lists.
  if (isPublicSuffix(website) || isPublicSuffix(listed)) {
    reasons.push(`${listed} is a public suffix — anyone can take a name under it`);
  }
  const platform = platformSuffixOf(listed);
  if (platform) {
    reasons.push(`${listed} is a page on ${platform}, which hands out names to anyone who signs up`);
  }
  if (NEVER_PROVES_OWNERSHIP.has(listed)) {
    reasons.push(`a mailbox at ${listed} says nothing about who runs this shop`);
  }
  if (INSTITUTIONAL_TLD.test(listed)) {
    reasons.push(`${listed} belongs to a government, a school or the armed forces`);
  }
  if (US_LOCALITY.test(listed)) {
    reasons.push(`${listed} is a United States locality domain, handed out per town or school district`);
  }
  const tld = tldOf(listed);
  if (tld.length === 2 && tld !== 'us' && tld !== 'co') {
    reasons.push(`.${tld} is a foreign country domain, and this is a United States directory`);
  } else if (!US_TLDS.has(tld) && tld.length <= 3 && !/^[a-z]{4,}$/.test(tld)) {
    reasons.push(`.${tld} is not a domain this directory expects`);
  }

  // (d) Exactly one public listing on the domain. wildbillstobacco.com covers
  //     203 of them; whoever answers that mailbox is a chain's head office, or
  //     a directory operator, not this shop.
  const siblings = context.siblingsOnDomain;
  if (Number.isFinite(siblings) && siblings > 1) {
    reasons.push(`${siblings} listings share ${listed}, so a mailbox there does not identify this shop`);
  }

  // (e) The page has to name the shop. 429 eligible sites are ones the hours
  //     sweep already refused because they never do.
  if (context.pageText !== undefined && context.pageText !== null) {
    if (!pageNamesShop(context.pageText, listing)) {
      reasons.push('the site never names this shop, its telephone number or its address');
    }
  }

  // (f) RDAP: registered long enough ago, and not after we imported the
  //     listing. thickercloudz.com was registered in 2016 and still redirects
  //     to a gambling site, which is why (b) and (e) are required as well.
  const rdap = context.rdap;
  if (rdap) {
    if (rdap.registered === false) {
      reasons.push(`${listed} is not registered — anyone could buy it today and claim this shop`);
    } else if (rdap.registeredAt) {
      const at = new Date(rdap.registeredAt);
      if (Number.isFinite(at.getTime())) {
        const ageDays = (now - at) / 86400000;
        if (ageDays < MIN_REGISTRATION_DAYS) {
          reasons.push(`${listed} was registered ${Math.round(ageDays)} days ago, too recently to prove anything`);
        }
        const imported = listing.created_at ? new Date(listing.created_at) : null;
        if (imported && Number.isFinite(imported.getTime()) && at > imported) {
          reasons.push(`${listed} changed hands after this listing was imported`);
        }
      }
    }
  }

  // (g) The claimant's own address has to be the one on the claim, and verified.
  if (context.contactEmail !== undefined && context.email !== undefined
    && String(context.contactEmail || '').toLowerCase() !== String(context.email || '').toLowerCase()) {
    reasons.push('the claim gives a different email address from the account it was made with');
  }
  if (context.emailVerified === false) {
    reasons.push('the account\'s email address has not been verified');
  }

  return [...new Set(reasons)];
}

/**
 * Does this page name this shop? The hours sweep's test, in one place: the
 * telephone number, the street address, or a distinctive word of the name.
 */
const GENERIC_NAME_WORD = new Set(['cigar', 'cigars', 'tobacco', 'tobacconist', 'shop', 'shoppe',
  'store', 'lounge', 'bar', 'club', 'co', 'company', 'inc', 'llc', 'the', 'and', 'of', 'smoke',
  'smokes', 'premium', 'fine', 'humidor', 'emporium', 'house', 'room', 'cafe']);

function pageNamesShop(text, listing) {
  const page = String(text || '').toLowerCase();
  if (!page) return false;
  const digitsOnly = page.replace(/[^0-9]/g, '');

  const phone = String(listing.phone || '').replace(/\D/g, '');
  const ten = phone.length === 11 && phone[0] === '1' ? phone.slice(1) : phone;
  if (ten.length === 10 && digitsOnly.includes(ten)) return true;

  const addr = String(listing.address || '').toLowerCase();
  const m = /^\s*(\d+[a-z]?)\s+(.+)$/.exec(addr);
  if (m) {
    const word = m[2].split(/\s+/).find(w => w.length > 2 && !/^(n|s|e|w|ne|nw|se|sw|north|south|east|west|ste|suite|unit)$/.test(w));
    if (word && page.includes(m[1]) && page.includes(word)) return true;
  }

  const spaced = ` ${page.replace(/[^a-z0-9]+/g, ' ')} `;
  const words = String(listing.name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ')
    .filter(w => w.length > 2 && !GENERIC_NAME_WORD.has(w));
  // A name made of nothing but trade words cannot be looked for, and refusing
  // every shop called "The Cigar Shop" is not what this check is for.
  if (!words.length) return true;
  return words.some(w => spaced.includes(` ${w} `));
}

/** 'instant' when the shortcut is available, 'manual' otherwise. */
function claimVerdict(listing, context) {
  const reasons = claimProofReasons(listing, context);
  return { verdict: reasons.length ? 'manual' : 'instant', reasons };
}

module.exports = {
  claimProofReasons, claimVerdict, registrableDomain, isPublicSuffix, platformSuffixOf, pageNamesShop,
  PUBLIC_SUFFIXES, NEVER_PROVES_OWNERSHIP, MIN_REGISTRATION_DAYS, rootDomain,
};

// ── self-test ───────────────────────────────────────────────────────────────
// Every listing below is one of the 25 live examples in the audit.
function selftest() {
  let pass = 0, fail = 0;
  const ok = (cond, label, extra) => {
    if (cond) { pass++; console.log(`  ok   ${label}`); }
    else { fail++; console.log(`  FAIL ${label}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ''}`); }
  };

  // A listing that should pass everything, to show the gate is not just "no".
  const good = {
    id: 1, name: "Jen's Cigar Bar", website: 'jenscigarbar.com', website_status: 'ok',
    website_final_url: 'https://jenscigarbar.com/', visible: 1, storefront: null,
    phone: '(555) 010-1234', address: '120 Elm St', created_at: '2026-01-01',
  };
  const goodContext = {
    email: 'owner@jenscigarbar.com', contactEmail: 'owner@jenscigarbar.com', emailVerified: true,
    siblingsOnDomain: 1, liveStatus: 'ok', pageText: "Welcome to Jen's Cigar Bar, 120 Elm St",
    rdap: { registered: true, registeredAt: '2002-05-01' }, now: new Date('2026-09-12'),
  };
  ok(claimVerdict(good, goodContext).verdict === 'instant',
    "jenscigarbar.com, registered 2002, passes", claimProofReasons(good, goodContext));

  // The five sampled good domains from the audit must all pass.
  for (const [domain, registered] of [['villigercigars.com', '2001-03-02'], ['cheapcigars4me.com', '2006-07-11'],
    ['smokeshopbaltimore.com', '2015-09-20'], ['bebestobacco.com', '2023-04-04']]) {
    const l = { ...good, name: 'Test Shop', website: domain, website_final_url: `https://${domain}/` };
    const c = { ...goodContext, email: `owner@${domain}`, contactEmail: `owner@${domain}`,
      pageText: 'Test Shop, 120 Elm St', rdap: { registered: true, registeredAt: registered } };
    ok(claimVerdict(l, c).verdict === 'instant', `${domain}, registered ${registered.slice(0, 4)}, passes`,
      claimProofReasons(l, c));
  }

  const refused = (listing, context, label, needle) => {
    // The fixture's own final URL must not leak into a case that names a
    // different website, or every refusal picks up a spurious redirect reason.
    const base = { ...good, website_final_url: null, ...listing };
    if (!('website_final_url' in listing) && base.website === good.website) base.website_final_url = good.website_final_url;
    const r = claimProofReasons(base, { ...goodContext, finalUrl: undefined, ...context });
    const hit = !needle || r.some(x => x.includes(needle));
    ok(r.length > 0 && hit, label, r);
  };

  // ── the four named dead domains ───────────────────────────────────────────
  refused({ name: 'Tobacco King', website: 'tobaccokingia.com', website_status: 'dns_fail' },
    { liveStatus: 'dns_fail', rdap: { registered: false }, email: 'a@tobaccokingia.com', contactEmail: 'a@tobaccokingia.com' },
    'Tobacco King: tobaccokingia.com is unregistered and is refused', 'not registered');
  refused({ name: 'Roosevelt Tobacco', website: 'roosevelttobacco.com', website_status: 'dns_fail' },
    { liveStatus: 'dns_fail', rdap: { registered: false }, email: 'a@roosevelttobacco.com', contactEmail: 'a@roosevelttobacco.com' },
    'Roosevelt Tobacco is refused');
  refused({ name: 'Smoke Place Cigars', website: 'ortegasmokeshop.com', website_status: 'dns_fail' },
    { liveStatus: 'dns_fail', rdap: { registered: false }, email: 'a@ortegasmokeshop.com', contactEmail: 'a@ortegasmokeshop.com' },
    'Smoke Place Cigars is refused');
  // Gulfport: registered three weeks before the snapshot, and after the import.
  refused({ name: 'Gulfport Cigars', website: 'gulfportcigars.com', created_at: '2025-06-01' },
    { email: 'a@gulfportcigars.com', contactEmail: 'a@gulfportcigars.com',
      pageText: 'Gulfport Cigars', rdap: { registered: true, registeredAt: '2026-08-17' } },
    'Gulfport Cigars: a domain registered three weeks ago is refused', 'too recently');

  // ── the gambling and for-sale redirects ───────────────────────────────────
  refused({ name: 'Thicker Cloudz', website: 'thickercloudz.com', website_final_url: 'https://vipbet88judibola.com/' },
    { email: 'a@thickercloudz.com', contactEmail: 'a@thickercloudz.com', pageText: 'Thicker Cloudz',
      rdap: { registered: true, registeredAt: '2016-04-02' } },
    'Thicker Cloudz: registered in 2016, but it lands on a gambling site', 'different domain');
  refused({ name: 'Puff n Stuff Cigars', website: 'puffnstuffcigars.com', website_final_url: 'https://gamebaidoithuong.property/' },
    { email: 'a@puffnstuffcigars.com', contactEmail: 'a@puffnstuffcigars.com', pageText: 'Puff n Stuff',
      rdap: { registered: true, registeredAt: '2026-05-18' } },
    'Puff n Stuff: re-registered this year and lands elsewhere');
  refused({ name: 'Central Cigar Lounge', website: 'centralcigarlounge.com', website_final_url: 'https://maha4d2.org/' },
    { email: 'a@centralcigarlounge.com', contactEmail: 'a@centralcigarlounge.com', pageText: 'Central Cigar Lounge' },
    'Central Cigar Lounge lands on maha4d2.org');
  refused({ name: 'Senor Cigars', website: 'yborcitycigars.com', website_final_url: 'https://expireddomains.com/sale' },
    { email: 'a@yborcitycigars.com', contactEmail: 'a@yborcitycigars.com', pageText: 'Senor Cigars' },
    'Senor Cigars lands on a sale page');

  // ── the twelve two-label and institutional cases ──────────────────────────
  refused({ name: 'The Pipe King', website: 'pipeking.com.au' },
    { email: 'a@pipeking.com.au', contactEmail: 'a@pipeking.com.au', pageText: 'The Pipe King' },
    'The Pipe King: pipeking.com.au is an Australian plumbing company', 'foreign country');
  refused({ name: 'Redzone Cigar Bar', website: 'redzone.co.uk' },
    { email: 'a@redzone.co.uk', contactEmail: 'a@redzone.co.uk', pageText: 'Redzone' },
    'Redzone: a .co.uk domain costs a few dollars', 'foreign country');
  refused({ name: 'S R Tobacco', website: 'sheboygan.k12.wi.us' },
    { email: 'a@sheboygan.k12.wi.us', contactEmail: 'a@sheboygan.k12.wi.us', pageText: 'S R Tobacco' },
    'S R Tobacco: sheboygan.k12.wi.us is a school district');
  refused({ name: 'Tobacco House', website: 'dars.state.tx.us', website_status: 'dns_fail' },
    { liveStatus: 'dns_fail', email: 'a@dars.state.tx.us', contactEmail: 'a@dars.state.tx.us', pageText: 'Tobacco House' },
    'Tobacco House: a *.tx.us mailbox is a Texas state agency');
  refused({ name: 'Dutchess County Cigar Company', website: 'yahoo.com' },
    { email: 'a@yahoo.com', contactEmail: 'a@yahoo.com', pageText: 'Dutchess County Cigar' },
    'a yahoo.com mailbox proves nothing', 'says nothing about who runs');
  refused({ name: 'Ryo Tobacco', website: 'tobaccoblends.com.au' },
    { email: 'a@tobaccoblends.com.au', contactEmail: 'a@tobaccoblends.com.au', pageText: 'Ryo Tobacco' },
    'tobaccoblends.com.au is refused');
  refused({ name: 'Tobacco Shack', website: 'tobaccoshack.tripod.com' },
    { email: 'a@tobaccoshack.tripod.com', contactEmail: 'a@tobaccoshack.tripod.com', pageText: 'Tobacco Shack' },
    'a tripod.com subdomain is refused');
  refused({ name: 'A Shop', website: 'someshop.gov' },
    { email: 'a@someshop.gov', contactEmail: 'a@someshop.gov', pageText: 'A Shop' },
    'a .gov domain is refused', 'government');

  // ── the shared domains ────────────────────────────────────────────────────
  refused({ name: "Wild Bill's Tobacco", website: 'wildbillstobacco.com' },
    { siblingsOnDomain: 203, email: "a@wildbillstobacco.com", contactEmail: 'a@wildbillstobacco.com', pageText: "Wild Bill's" },
    "Wild Bill's: 203 listings share the domain", '203 listings share');
  refused({ name: 'Stix Cigar Lounge', website: 'hub.biz' },
    { siblingsOnDomain: 42, email: 'a@hub.biz', contactEmail: 'a@hub.biz', pageText: 'Stix Cigar Lounge' },
    'hub.biz is a directory covering 42 unrelated shops');
  refused({ name: "Che'root Cigar Lounge", website: 'cigarsinternational.com' },
    { siblingsOnDomain: 2, email: 'a@cigarsinternational.com', contactEmail: 'a@cigarsinternational.com', pageText: "Che'root" },
    'an online retailer\'s domain is refused');
  refused({ name: 'Miami Cigar Shop', website: 'neptunecigar.com' },
    { siblingsOnDomain: 2, email: 'a@neptunecigar.com', contactEmail: 'a@neptunecigar.com', pageText: 'Miami Cigar Shop' },
    'neptunecigar.com is refused');
  refused({ name: 'Cigar Band Man', website: 'innovativecpa.com' },
    { email: 'a@innovativecpa.com', contactEmail: 'a@innovativecpa.com', pageText: 'Innovative CPA, tax and accounting' },
    "Cigar Band Man's site is a CPA firm and never names the shop", 'never names this shop');

  // ── hidden, duplicate and closed listings ─────────────────────────────────
  refused({ name: 'Broadway Cigar Company', visible: 0, storefront: 'closed' }, {},
    'a listing staff hid is never self-served', 'not on the public map');
  refused({ name: 'Mardo Cigars', storefront: 'duplicate', storefront_reason: 'Same shop as listing #414' }, {},
    'a duplicate is refused and says which listing it duplicates', 'duplicate of another');
  refused({ name: 'Cubanacan Cigars', operating_status: 'permanently_closed' }, {},
    'a listing the source marks permanently closed is refused');

  // ── the guardrails on the other side ──────────────────────────────────────
  // A real owner whose site is merely down still goes to staff, not away.
  const down = claimVerdict({ ...good, website_status: 'timeout' }, { ...goodContext, liveStatus: 'timeout' });
  ok(down.verdict === 'manual' && down.reasons.length >= 1, 'a site that is down goes to a person, not to nobody');
  ok(!JSON.stringify(down).includes('reject'), 'and nothing here rejects a claim');

  // madurostix.com and havanahousecigars.com are long-held registrations whose
  // DNS merely fails. They go to staff — and the reason says why, so a person
  // can approve them rather than guess.
  const maduro = claimProofReasons({ ...good, name: 'Maduro Stix', website: 'madurostix.com', website_status: 'dns_fail', website_final_url: null },
    { ...goodContext, liveStatus: 'dns_fail', finalUrl: undefined, email: 'a@madurostix.com', contactEmail: 'a@madurostix.com',
      pageText: 'Maduro Stix', rdap: { registered: true, registeredAt: '2008-01-01' } });
  ok(maduro.length === 1 && /dns_fail/.test(maduro[0]),
    'a 2008 registration whose DNS fails has exactly one reason against it, and it is the DNS', maduro);

  // ── the pieces ────────────────────────────────────────────────────────────
  ok(registrableDomain('shop.example.co.uk') === 'example.co.uk', 'a registrable domain under a two-label suffix');
  ok(registrableDomain('www.example.com') === 'example.com', 'and under .com');
  ok(registrableDomain('myshop.wixsite.com') === 'myshop.wixsite.com', 'a Wix subdomain is its own registrable domain');
  ok(isPublicSuffix('wixsite.com') && isPublicSuffix('co.uk'), 'a bare suffix is recognised');
  ok(!isPublicSuffix('example.com'), 'and an ordinary domain is not');

  // The bug this module exists to close: claims.rootDomain takes the last two
  // labels, so "pipeking.com.au" has the root "com.au" and ANY .com.au mailbox
  // in the world matched it.
  ok(rootDomain('pipeking.com.au') === 'com.au' && registrableDomain('pipeking.com.au') === 'pipeking.com.au',
    'the old two-label root said "com.au"; the suffix list says "pipeking.com.au"',
    [rootDomain('pipeking.com.au'), registrableDomain('pipeking.com.au')]);
  ok(rootDomain('sheboygan.k12.wi.us') === 'wi.us' && registrableDomain('sheboygan.k12.wi.us') === 'sheboygan.k12.wi.us',
    'and the same for a school district',
    [rootDomain('sheboygan.k12.wi.us'), registrableDomain('sheboygan.k12.wi.us')]);

  ok(pageNamesShop('Call 305-866-2277', { phone: '(305) 866-2277' }), 'a phone number names the shop');
  ok(pageNamesShop('Find us at 120 Elm Street', { address: '120 Elm St' }), 'so does the street address');
  ok(pageNamesShop('Welcome to Ashford Cigars', { name: 'Ashford Cigars' }), 'so does a distinctive name word');
  ok(!pageNamesShop('Premium cigars and lounge', { name: 'Ashford Cigars' }), 'but not the trade words alone');
  ok(pageNamesShop('anything', { name: 'The Cigar Shop' }), 'and a name of nothing but trade words is not held against it');

  console.log(`\nclaimProof self-test: ${pass} passed, ${fail} failed`);
  return fail;
}

if (require.main === module) process.exit(selftest() ? 1 : 0);
