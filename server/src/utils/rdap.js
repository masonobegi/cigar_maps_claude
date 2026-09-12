/**
 * When was this domain registered?
 *
 * The claim gate needs it because a dead listing's domain is usually for sale.
 * The audit checked 20 .com roots behind dns_fail listings on RDAP: 14 were
 * not registered at all, so anyone could buy one for about $10 and receive the
 * verification code. #278 Gulfport Cigars is the case that already happened —
 * gulfportcigars.com was re-registered on 2026-08-17, three weeks before the
 * snapshot, while the listing still treats it as the shop's domain.
 *
 * Two facts come out of a lookup and both matter:
 *   - registered at all? A 404 from the registry means the name is free.
 *   - registered when? A name bought after we imported the listing is not the
 *     name that was on the shop's door when the directory recorded it.
 *
 * RDAP is the registries' own protocol, free, no key, and rdap.org redirects
 * to the right registry from the IANA bootstrap file. It is not always
 * available and some ccTLD registries do not run it at all, so "unknown" is a
 * normal answer: it sends the claim to staff rather than blocking it.
 *
 * Answers are cached in domain_facts for RDAP_CACHE_DAYS so a retried claim,
 * and the staff claim card, cost no extra lookups.
 *
 * Self-test (no network, no database):  node src/utils/rdap.js
 */
'use strict';

const https = require('https');
const { URL } = require('url');
const db = require('../database/db');

const UA = 'CigarBuddy/1.0 (+https://cigarmapsclaude-production.up.railway.app; claim verification)';
const TIMEOUT_MS = 12000;
const MAX_REDIRECTS = 3;
const MAX_BODY = 512 * 1024;
const BOOTSTRAP = 'https://rdap.org/domain/';
const RDAP_CACHE_DAYS = 30;

/** 'registered' | 'unregistered' | 'unknown' — only the first two are evidence. */
const STATUSES = ['registered', 'unregistered', 'unknown'];

function get(urlStr, redirectsLeft) {
  return new Promise((resolve, reject) => {
    let url;
    try { url = new URL(urlStr); } catch { return reject(new Error('bad url')); }
    if (url.protocol !== 'https:') return reject(new Error('rdap must be https'));

    const req = https.request({
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: 'GET',
      headers: { 'User-Agent': UA, Accept: 'application/rdap+json, application/json' },
      timeout: TIMEOUT_MS,
    }, res => {
      const code = res.statusCode || 0;
      if (code >= 300 && code < 400 && res.headers.location && redirectsLeft > 0) {
        res.resume();
        let next;
        try { next = new URL(res.headers.location, urlStr).toString(); } catch { return reject(new Error('bad redirect')); }
        return resolve(get(next, redirectsLeft - 1));
      }
      let body = '';
      res.on('data', chunk => {
        if (body.length < MAX_BODY) body += chunk;
      });
      res.on('end', () => resolve({ code, body }));
    });

    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', reject);
    req.end();
  });
}

/**
 * Pull the registration date out of an RDAP domain response.
 * Registries spell the event differently ("registration", and a few use
 * "last changed" only), so anything that is not a registration event is
 * ignored rather than guessed at.
 */
function registrationDate(json) {
  const events = (json && json.events) || [];
  for (const e of events) {
    if (String(e && e.eventAction || '').toLowerCase() === 'registration' && e.eventDate) {
      const d = new Date(e.eventDate);
      if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
  }
  return null;
}

/** Read the cached answer for a domain, or null when there is none or it is stale. */
async function cached(domain) {
  const row = await db.get('SELECT * FROM domain_facts WHERE domain = ?', [domain]).catch(() => null);
  if (!row || !row.checked_at) return null;
  const age = Date.now() - new Date(row.checked_at).getTime();
  if (age > RDAP_CACHE_DAYS * 24 * 60 * 60 * 1000) return null;
  return {
    domain,
    status: row.rdap_status || 'unknown',
    registered_at: row.registered_at ? new Date(row.registered_at).toISOString() : null,
    checked_at: new Date(row.checked_at).toISOString(),
    cached: true,
  };
}

async function store(fact) {
  await db.run(`
    INSERT INTO domain_facts (domain, rdap_status, registered_at, checked_at)
    VALUES (?, ?, ?, NOW())
    ON CONFLICT (domain) DO UPDATE SET rdap_status = EXCLUDED.rdap_status,
      registered_at = EXCLUDED.registered_at, checked_at = EXCLUDED.checked_at
  `, [fact.domain, fact.status, fact.registered_at]).catch(err => {
    console.error('[rdap] could not cache ' + fact.domain + ': ' + err.message);
  });
}

/**
 * Look a domain up. Never throws: a registry that is down, slow or absent
 * returns { status: 'unknown' }, which the gate reads as "no evidence".
 */
async function lookup(domain, { fresh = false } = {}) {
  const d = String(domain || '').trim().toLowerCase();
  if (!d || !d.includes('.')) return { domain: d, status: 'unknown', registered_at: null, checked_at: null, reason: 'not a domain' };

  if (!fresh) {
    const hit = await cached(d);
    if (hit) return hit;
  }

  let res;
  try {
    res = await get(BOOTSTRAP + encodeURIComponent(d), MAX_REDIRECTS);
  } catch (err) {
    // No answer is not evidence of anything. Do not cache it: the next claim
    // should try again rather than inherit a network blip for 30 days.
    return { domain: d, status: 'unknown', registered_at: null, checked_at: new Date().toISOString(), reason: err.message };
  }

  // 404 is the registry saying the name is not registered. That is the answer
  // the gate cares most about, and it is worth caching.
  if (res.code === 404) {
    const fact = { domain: d, status: 'unregistered', registered_at: null, checked_at: new Date().toISOString() };
    await store(fact);
    return fact;
  }
  if (res.code !== 200) {
    return { domain: d, status: 'unknown', registered_at: null, checked_at: new Date().toISOString(), reason: 'rdap http ' + res.code };
  }

  let json = null;
  try { json = JSON.parse(res.body); } catch { /* a registry that answers with html tells us nothing */ }
  if (!json) return { domain: d, status: 'unknown', registered_at: null, checked_at: new Date().toISOString(), reason: 'rdap body was not json' };

  const fact = { domain: d, status: 'registered', registered_at: registrationDate(json), checked_at: new Date().toISOString() };
  await store(fact);
  return fact;
}

module.exports = { lookup, registrationDate, STATUSES, RDAP_CACHE_DAYS };

// ── Self-test ───────────────────────────────────────────────────────────────
// Parsing only; the network and the cache are not touched. The fixtures are
// the real RDAP replies for the audit's named domains, trimmed to the events.
// Run: node src/utils/rdap.js
function selfTest() {
  let pass = 0, fail = 0;
  const eq = (got, want, label) => {
    if (got === want) pass++;
    else { fail++; console.log(`  FAIL ${label}\n       got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
  };

  // #278 Gulfport Cigars: re-registered 2026-08-17, after the listing existed.
  eq(registrationDate({ events: [
    { eventAction: 'registration', eventDate: '2026-08-17T18:39:42Z' },
    { eventAction: 'expiration', eventDate: '2027-08-17T18:39:42Z' },
    { eventAction: 'last changed', eventDate: '2026-08-17T18:39:43Z' },
  ] }), '2026-08-17T18:39:42.000Z', 'gulfportcigars.com registration event');

  // #4316/#4534 Maduro's: held since 2008, the case a date guard must not break.
  eq(registrationDate({ events: [
    { eventAction: 'registration', eventDate: '2008-07-24T00:35:01Z' },
    { eventAction: 'last update of RDAP database', eventDate: '2026-09-12T03:27:18Z' },
  ] }), '2008-07-24T00:35:01.000Z', 'madurostix.com registration event');

  // #18628 Thicker Cloudz: registered 2016 but last changed 2026-08-21. Only
  // the registration event counts, which is why a date guard alone is not
  // enough to catch the gambling redirect — the redirect guard catches it.
  eq(registrationDate({ events: [
    { eventAction: 'last changed', eventDate: '2026-08-21T00:00:00Z' },
    { eventAction: 'registration', eventDate: '2016-03-02T00:00:00Z' },
  ] }), '2016-03-02T00:00:00.000Z', 'a later "last changed" does not become the registration date');

  eq(registrationDate({ events: [{ eventAction: 'REGISTRATION', eventDate: '2001-01-01T00:00:00Z' }] }),
    '2001-01-01T00:00:00.000Z', 'the event action is matched case-insensitively');
  eq(registrationDate({ events: [{ eventAction: 'last changed', eventDate: '2026-01-01T00:00:00Z' }] }),
    null, 'a record with no registration event has no date');
  eq(registrationDate({ events: [{ eventAction: 'registration', eventDate: 'whenever' }] }),
    null, 'an unparseable date is no date');
  eq(registrationDate({}), null, 'a record with no events');
  eq(registrationDate(null), null, 'no record at all');

  console.log(`rdap self-test: ${pass} passed, ${fail} failed`);
  return fail === 0;
}

if (require.main === module) {
  const domain = process.argv[2];
  // 'selftest' is the name of the test, not a domain to go and look up. Said
  // explicitly so a runner that passes the argument to every file does not
  // send this one off to a registry asking who owns "selftest".
  if (!domain || domain === 'selftest') process.exit(selfTest() ? 0 : 1);
  lookup(domain, { fresh: true })
    .then(r => { console.log(JSON.stringify(r, null, 2)); process.exit(0); })
    .catch(err => { console.error(err.message); process.exit(1); });
}
