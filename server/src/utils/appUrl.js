/**
 * Where this deployment lives, as it appears in a link somebody clicks.
 *
 * Six files had their own copy of this, five defaulting to the Railway
 * subdomain and one — the outreach job, which writes to strangers — defaulting
 * to a domain nobody owns yet. An email that went out before APP_URL was set
 * would have linked every shop to a page that does not exist.
 *
 * One definition, therefore, and one fallback. Set APP_URL the moment a real
 * domain exists: every verification email, password reset, Stripe return, share
 * link, canonical tag and outreach message is built from it.
 *
 *   node src/utils/appUrl.js selftest
 */
'use strict';

/** The deployment this repository shipped with, and what everything falls back to. */
const RAILWAY = 'https://cigarmapsclaude-production.up.railway.app';

/**
 * Read at call time, not at import time: a job that sets APP_URL in its own
 * process before requiring a route should still get the value it set.
 */
function appUrl(env = process.env) {
  const raw = String(env.APP_URL || RAILWAY).trim();
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return withScheme.replace(/\/+$/, '');
}

/** True while the deployment is still answering on the Railway subdomain. */
const onDefaultDomain = (env = process.env) => appUrl(env) === RAILWAY;

module.exports = { appUrl, onDefaultDomain, RAILWAY, selftest };

// ── self-test ───────────────────────────────────────────────────────────────
function selftest() {
  let pass = 0, fail = 0;
  const ok = (cond, label, extra) => {
    if (cond) { pass++; console.log(`  ok   ${label}`); }
    else { fail++; console.log(`  FAIL ${label}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ''}`); }
  };

  ok(appUrl({}) === RAILWAY, 'unset falls back to where it is actually deployed');
  ok(appUrl({ APP_URL: 'https://cigarbuddy.com' }) === 'https://cigarbuddy.com', 'a set value is used as given');
  ok(appUrl({ APP_URL: 'https://cigarbuddy.com/' }) === 'https://cigarbuddy.com',
    'a trailing slash is dropped, or every link gains a double one');
  ok(appUrl({ APP_URL: 'https://cigarbuddy.com///' }) === 'https://cigarbuddy.com', 'however many of them there are');
  ok(appUrl({ APP_URL: 'cigarbuddy.com' }) === 'https://cigarbuddy.com',
    'a bare domain gets a scheme: a link without one is not a link');
  ok(appUrl({ APP_URL: '  https://cigarbuddy.com  ' }) === 'https://cigarbuddy.com', 'and whitespace is not part of a URL');
  ok(appUrl({ APP_URL: 'http://localhost:3001' }) === 'http://localhost:3001', 'http is left alone for local work');
  ok(onDefaultDomain({}) && !onDefaultDomain({ APP_URL: 'https://cigarbuddy.com' }),
    'and a deployment knows whether it is still on the subdomain it shipped with');

  console.log(`\nappUrl self-test: ${pass} passed, ${fail} failed`);
  return fail === 0;
}

if (require.main === module && process.argv[2] === 'selftest') process.exit(selftest() ? 0 : 1);
