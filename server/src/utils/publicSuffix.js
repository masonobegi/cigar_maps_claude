/**
 * Registrable domains, read from a vendored Public Suffix List.
 *
 * The claim gate has to answer one question exactly: "is this mailbox at the
 * same domain somebody had to buy to put the shop's website there?" Counting
 * labels cannot answer it. The old two-label rule in utils/claims.js said yes
 * to every one of these, all of them live in the directory today:
 *
 *   pipeking.com.au        (#3624) — "com.au" is a suffix, not a domain. Any
 *                          .com.au mailbox in Australia matched.
 *   redzone.co.uk          (#12092) — same, and a .co.uk costs a few dollars.
 *   sheboygan.k12.wi.us    (#16333) — a school district. Any *.wi.us mailbox
 *                          matched, because "wi.us" reads as two labels.
 *   yahoo.com              (#21932) — free mail is a different problem, but a
 *                          two-label rule cannot even see local.yahoo.com.
 *
 * Under the list, pipeking.com.au is its own registrable name, and so is
 * sheboygan.k12.wi.us; what changes is that the *suffix* is now known, so the
 * gate can also refuse the suffix classes the owner ruled out (see claimGate).
 *
 * The list's PRIVATE section is loaded too, and deliberately: it makes
 * ashopname.wixsite.com a registrable name of its own instead of a mailbox at
 * a host thousands of businesses share.
 *
 * Algorithm: https://publicsuffix.org/list/ — longest matching rule wins, an
 * exception rule (!) beats a wildcard, and a name that is exactly a public
 * suffix has no registrable domain at all.
 *
 * Self-test:  node src/utils/publicSuffix.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const LIST_PATH = path.join(__dirname, '..', 'data', 'public_suffix_list.dat');

let rules = null;     // suffix -> { wildcard, exception, private }
let listVersion = null;

function load() {
  if (rules) return rules;
  rules = new Map();
  const raw = fs.readFileSync(LIST_PATH, 'utf8');
  let isPrivate = false;
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith('//')) {
      if (t === '// ===BEGIN PRIVATE DOMAINS===') isPrivate = true;
      const v = t.match(/^\/\/ VERSION: (.+)$/);
      if (v) listVersion = v[1];
      continue;
    }
    const exception = t.startsWith('!');
    const body = (exception ? t.slice(1) : t).toLowerCase();
    const wildcard = body.startsWith('*.');
    const key = wildcard ? body.slice(2) : body;
    // An exception and a plain rule can name the same suffix (e.g. "!city.kawasaki.jp"
    // alongside "*.kawasaki.jp"); keep both flags on the one entry.
    const prev = rules.get(key) || { wildcard: false, exception: false, private: isPrivate };
    rules.set(key, {
      wildcard: prev.wildcard || wildcard,
      exception: prev.exception || exception,
      private: prev.private || isPrivate,
    });
  }
  return rules;
}

/** The hostname out of anything a website field might hold, lowercased, no www. */
function hostOf(value) {
  if (!value) return null;
  let h = String(value).trim().toLowerCase();
  h = h.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');   // scheme
  h = h.split('@').pop();                          // user info, or an email's local part
  h = h.split(/[/?#]/)[0];                         // path, query, fragment
  h = h.split(':')[0];                             // port
  h = h.replace(/\.+$/, '').replace(/^www\./, '');
  if (!h || !/^[a-z0-9.-]+$/.test(h) || !h.includes('.')) return null;
  // A bare IP is not a name anybody registered, and the list would happily
  // read "192.168.1.1" as a domain under the TLD "1".
  if (/^[0-9.]+$/.test(h)) return null;
  return h;
}

/**
 * The public suffix of a hostname, plus which section of the list it came from.
 * Returns { suffix, private, wildcard } — suffix is null for a name under no
 * known rule, which the list says to treat as if the rule were "*".
 */
function publicSuffix(hostname) {
  const host = hostOf(hostname);
  if (!host) return { suffix: null, private: false, wildcard: false };
  const map = load();
  const labels = host.split('.');

  // Longest match first: walk from the whole name down to the last label.
  for (let i = 0; i < labels.length; i++) {
    const candidate = labels.slice(i).join('.');
    const rule = map.get(candidate);
    if (!rule) continue;
    // "!city.kawasaki.jp" means city.kawasaki.jp is registrable, so the suffix
    // is one label shorter than the rule.
    if (rule.exception) {
      return { suffix: labels.slice(i + 1).join('.') || null, private: rule.private, wildcard: false };
    }
    if (rule.wildcard) {
      // "*.ck" makes any <label>.ck a suffix, so the suffix is one label longer.
      if (i === 0) return { suffix: host, private: rule.private, wildcard: true };
      return { suffix: labels.slice(i - 1).join('.'), private: rule.private, wildcard: true };
    }
    return { suffix: candidate, private: rule.private, wildcard: false };
  }
  // No rule at all: the list's default is "*", so the last label is the suffix.
  return { suffix: labels[labels.length - 1], private: false, wildcard: false };
}

/**
 * The name somebody had to register: one label more than the public suffix.
 * null when the host IS a public suffix (com.au, k12.wi.us, wixsite.com), which
 * is the case a mailbox can never prove ownership of.
 */
function registrableDomain(value) {
  const host = hostOf(value);
  if (!host) return null;
  const { suffix } = publicSuffix(host);
  if (!suffix) return host;                 // e.g. an unknown single-label TLD
  if (host === suffix) return null;         // the host is the suffix itself
  if (!host.endsWith('.' + suffix)) return null;
  const head = host.slice(0, -(suffix.length + 1)).split('.');
  return head[head.length - 1] + '.' + suffix;
}

/** The domain part of an email address, as a registrable domain. */
function emailDomain(email) {
  const at = String(email || '').trim().toLowerCase().split('@');
  if (at.length !== 2 || !at[1]) return null;
  return registrableDomain(at[1]);
}

/** Which list section the suffix came from, for the reasons shown to staff. */
function suffixInfo(value) {
  const host = hostOf(value);
  if (!host) return { host: null, suffix: null, registrable: null, private: false };
  const { suffix, private: isPrivate } = publicSuffix(host);
  return { host, suffix, registrable: registrableDomain(host), private: isPrivate };
}

function version() {
  load();
  return listVersion;
}

module.exports = { registrableDomain, publicSuffix, emailDomain, suffixInfo, hostOf, version };

// ── Self-test ───────────────────────────────────────────────────────────────
// Every case below is a real listing from the directory or a rule the gate
// leans on. Run: node src/utils/publicSuffix.js
function selfTest() {
  let pass = 0, fail = 0;
  const eq = (got, want, label) => {
    if (got === want) pass++;
    else { fail++; console.log(`  FAIL ${label}\n       got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
  };

  // The four two-label mistakes the audit found, all still public listings.
  eq(registrableDomain('pipeking.com.au'), 'pipeking.com.au', '#3624 pipeking.com.au is one name, not "com.au"');
  eq(registrableDomain('anything.com.au'), 'anything.com.au', 'a second .com.au is a different name');
  eq(registrableDomain('redzone.co.uk'), 'redzone.co.uk', '#12092 redzone.co.uk');
  eq(registrableDomain('sheboygan.k12.wi.us'), 'sheboygan.k12.wi.us', '#16333 the school district is its own name');
  // The list stops at "tx.us", so dars.state.tx.us reads as a name under
  // state.tx.us. That is correct list behaviour and still useless as proof, so
  // the gate refuses .us locality names outright (see claimGate US_LOCALITY).
  eq(registrableDomain('dars.state.tx.us'), 'state.tx.us', '#2445 the list stops at tx.us');

  // The old rule said these were the same domain. They are not.
  eq(registrableDomain('pipeking.com.au') === registrableDomain('otherfirm.com.au'), false, 'two .com.au names are not one domain');
  eq(registrableDomain('sheboygan.k12.wi.us') === registrableDomain('kiel.k12.wi.us'), false, 'two wi.us schools are not one domain');

  // Ordinary shop domains keep working.
  eq(registrableDomain('https://www.towercigars.com/contact'), 'towercigars.com', 'a URL with scheme and path');
  eq(registrableDomain('shop.towercigars.com'), 'towercigars.com', 'a subdomain belongs to the same buyer');
  eq(registrableDomain('gulfportcigars.com'), 'gulfportcigars.com', '#278 gulfportcigars.com');
  eq(registrableDomain('MADUROSTIX.COM'), 'madurostix.com', 'case does not matter');
  eq(registrableDomain('havanahousecigars.com.'), 'havanahousecigars.com', 'a trailing dot is still the same name');

  // A host that IS a public suffix proves nothing: nobody buys it.
  eq(registrableDomain('com.au'), null, 'com.au on its own is not registrable');
  eq(registrableDomain('k12.wi.us'), null, 'k12.wi.us on its own is not registrable');
  eq(registrableDomain('co.uk'), null, 'co.uk on its own is not registrable');

  // The private section: two shops on the same builder are two names.
  eq(registrableDomain('acmecigars.wixsite.com'), 'acmecigars.wixsite.com', 'a wixsite shop is its own name');
  eq(registrableDomain('wixsite.com'), null, 'wixsite.com itself is a private suffix');
  eq(publicSuffix('acmecigars.wixsite.com').private, true, 'wixsite.com comes from the private section');
  eq(publicSuffix('towercigars.com').private, false, 'com comes from the ICANN section');
  // Two hosts the list does NOT cover, which is why the gate keeps its own
  // list of shared hosts: without it #6604 would "prove" ownership of
  // tobaccoshack.tripod.com with any @tripod.com mailbox.
  eq(registrableDomain('tobaccoshack.tripod.com'), 'tripod.com', '#6604 tripod.com is not in the list');
  eq(registrableDomain('straightpipesandvapes.business.site'), 'business.site', 'business.site is not in the list');

  // Wildcard and exception rules.
  eq(registrableDomain('foo.bar.ck'), 'foo.bar.ck', '*.ck makes bar.ck a suffix');
  eq(registrableDomain('city.kawasaki.jp'), 'city.kawasaki.jp', '!city.kawasaki.jp is registrable');
  eq(registrableDomain('foo.kawasaki.jp'), null, '*.kawasaki.jp makes foo.kawasaki.jp a suffix');
  eq(registrableDomain('shop.foo.kawasaki.jp'), 'shop.foo.kawasaki.jp', 'one label under a wildcard suffix is registrable');

  // Email addresses, including the free-mail shapes that used to pass.
  eq(emailDomain('owner@towercigars.com'), 'towercigars.com', 'a mailbox at the shop');
  eq(emailDomain('owner@mail.towercigars.com'), 'towercigars.com', 'a mailbox on a mail subdomain');
  eq(emailDomain('someone@yahoo.com'), 'yahoo.com', '#21932 yahoo.com is a real registrable name (the free-mail list refuses it, not this)');
  eq(emailDomain('not an email'), null, 'junk is not an address');
  eq(emailDomain('two@at@signs.com'), null, 'two @ signs is not an address');

  // Nonsense in, null out — website fields hold all of it.
  eq(registrableDomain(''), null, 'empty');
  eq(registrableDomain(null), null, 'null');
  eq(registrableDomain('localhost'), null, 'a single label is not a domain');
  eq(registrableDomain('192.168.1.1'), null, 'an IP is not a name anybody registered');
  eq(registrableDomain('http://'), null, 'a scheme with no host');

  console.log(`publicSuffix self-test: ${pass} passed, ${fail} failed (list ${version()})`);
  return fail === 0;
}

if (require.main === module) {
  process.exit(selfTest() ? 0 : 1);
}
