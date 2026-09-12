/**
 * Sending mail over HTTPS, because this host does not allow SMTP at all.
 *
 * The boot check found ENETUNREACH on IPv6; pinning to IPv4 turned it into
 * ETIMEDOUT on port 465, and then on 587 as well. That is not a provider
 * problem and no provider will fix it: Railway, like most platforms that run
 * other people's code, does not route outbound SMTP, because a platform that
 * does becomes a spam relay within a week.
 *
 * Every transactional provider offers the same thing over an ordinary HTTPS
 * request on 443, which is never blocked. So that is how mail leaves here.
 *
 *   RESEND_API_KEY     resend.com — 3,000 a month free
 *   POSTMARK_TOKEN     postmarkapp.com
 *
 * No SDK: both are one POST with a JSON body, and a dependency that wraps one
 * POST is a dependency to keep up to date for no reason.
 *
 *   node src/utils/mailHttp.js selftest
 */
'use strict';

const https = require('https');

const TIMEOUT_MS = 20000;

/** One JSON POST. Resolves with { status, body }, and never rejects. */
function postJson(url, { headers = {}, body }) {
  return new Promise(resolve => {
    let u;
    try { u = new URL(url); } catch { return resolve({ status: 0, error: 'bad url' }); }
    const payload = Buffer.from(JSON.stringify(body), 'utf8');
    const req = https.request({
      method: 'POST',
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': payload.length,
        'User-Agent': 'CigarBuddy/1.0',
        ...headers,
      },
      timeout: TIMEOUT_MS,
    }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', c => { if (text.length < 64 * 1024) text += c; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(text); } catch { /* a provider may answer with prose */ }
        resolve({ status: res.statusCode, body: parsed, text });
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, error: 'timeout' }); });
    req.on('error', e => resolve({ status: 0, error: e.message }));
    req.write(payload);
    req.end();
  });
}

/** Which HTTP provider this environment describes, or null. */
function httpProvider(env = process.env) {
  if (env.RESEND_API_KEY) return 'resend';
  if (env.POSTMARK_TOKEN) return 'postmark';
  return null;
}

/**
 * The request each provider wants. Separated from the sending so the shape can
 * be checked without a network — a wrong field name here is a 422 nobody sees
 * until the first real message.
 */
function buildRequest(provider, mail, env = process.env) {
  const { from, to, subject, text, html, replyTo } = mail;
  if (provider === 'resend') {
    return {
      url: 'https://api.resend.com/emails',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` },
      body: {
        from,
        to: Array.isArray(to) ? to : [to],
        subject,
        ...(text ? { text } : {}),
        ...(html ? { html } : {}),
        ...(replyTo ? { reply_to: replyTo } : {}),
      },
    };
  }
  if (provider === 'postmark') {
    return {
      url: 'https://api.postmarkapp.com/email',
      headers: { 'X-Postmark-Server-Token': env.POSTMARK_TOKEN, Accept: 'application/json' },
      body: {
        From: from,
        To: Array.isArray(to) ? to.join(',') : to,
        Subject: subject,
        ...(text ? { TextBody: text } : {}),
        ...(html ? { HtmlBody: html } : {}),
        ...(replyTo ? { ReplyTo: replyTo } : {}),
        MessageStream: env.POSTMARK_STREAM || 'outbound',
      },
    };
  }
  return null;
}

/** What went wrong, in words that name the fix. */
function describeFailure(provider, res) {
  if (!res || res.status === 0) return `could not reach ${provider} (${(res && res.error) || 'no response'})`;
  if (res.status === 401 || res.status === 403) return `${provider} rejected the API key`;
  if (res.status === 422 || res.status === 400) {
    const detail = (res.body && (res.body.message || res.body.Message || res.body.error)) || res.text;
    // The one a first send always hits: sending from a domain the provider has
    // not verified yet.
    return `${provider} refused the message: ${String(detail).slice(0, 160)}`;
  }
  if (res.status === 429) return `${provider} is rate-limiting: slow the send down`;
  return `${provider} answered ${res.status}`;
}

/**
 * Send one message. Returns { ok: true, id } or { ok: false, why }.
 * Never throws: a caller that does not care about delivery must not be broken
 * by a mail provider having a bad afternoon.
 */
async function sendHttpMail(mail, { env = process.env, post = postJson } = {}) {
  const provider = httpProvider(env);
  if (!provider) return { ok: false, why: 'no HTTP mail provider configured' };
  const req = buildRequest(provider, mail, env);
  const res = await post(req.url, { headers: req.headers, body: req.body });
  if (res && res.status >= 200 && res.status < 300) {
    const id = (res.body && (res.body.id || res.body.MessageID)) || null;
    return { ok: true, id, provider };
  }
  return { ok: false, why: describeFailure(provider, res), provider };
}

module.exports = { sendHttpMail, httpProvider, buildRequest, describeFailure, postJson, selftest };

// ── self-test ───────────────────────────────────────────────────────────────
function selftest() {
  let pass = 0, fail = 0;
  const ok = (cond, label, extra) => {
    if (cond) { pass++; console.log(`  ok   ${label}`); }
    else { fail++; console.log(`  FAIL ${label}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ''}`); }
  };

  const mail = { from: 'CigarBuddy <hi@cigarbuddy.com>', to: 'shop@example.com', subject: 'Hello', text: 'Body' };

  return (async () => {
    ok(httpProvider({}) === null, 'no key, no provider');
    ok(httpProvider({ RESEND_API_KEY: 'k' }) === 'resend', 'a Resend key picks Resend');
    ok(httpProvider({ POSTMARK_TOKEN: 't' }) === 'postmark', 'a Postmark token picks Postmark');
    ok(httpProvider({ RESEND_API_KEY: 'k', POSTMARK_TOKEN: 't' }) === 'resend', 'and one of them wins deterministically');

    // The field names are the whole risk: a wrong one is a 422 nobody sees
    // until the first real message goes out.
    const r = buildRequest('resend', mail, { RESEND_API_KEY: 'k' });
    ok(r.url === 'https://api.resend.com/emails', 'Resend endpoint');
    ok(r.headers.Authorization === 'Bearer k', 'Resend authenticates with a bearer token');
    ok(Array.isArray(r.body.to) && r.body.to[0] === 'shop@example.com', 'Resend wants `to` as an array', r.body.to);
    ok(r.body.from === mail.from && r.body.text === 'Body', 'and from and text as they are');
    ok(!('html' in r.body), 'a field we have nothing for is left out rather than sent empty');

    const pm = buildRequest('postmark', mail, { POSTMARK_TOKEN: 't' });
    ok(pm.headers['X-Postmark-Server-Token'] === 't', 'Postmark authenticates with its own header');
    ok(pm.body.From === mail.from && pm.body.TextBody === 'Body', 'and capitalises every field differently', pm.body);
    ok(pm.body.MessageStream === 'outbound', 'with a stream, which it requires');

    // Sending, against a stand-in.
    const sent = await sendHttpMail(mail, { env: { RESEND_API_KEY: 'k' },
      post: async () => ({ status: 200, body: { id: 'abc-123' } }) });
    ok(sent.ok && sent.id === 'abc-123', 'a success returns the provider’s message id', sent);

    const badKey = await sendHttpMail(mail, { env: { RESEND_API_KEY: 'k' }, post: async () => ({ status: 401 }) });
    ok(!badKey.ok && /rejected the API key/.test(badKey.why), 'a bad key says so', badKey);

    const unverified = await sendHttpMail(mail, { env: { RESEND_API_KEY: 'k' },
      post: async () => ({ status: 422, body: { message: 'The cigarbuddy.com domain is not verified' } }) });
    ok(!unverified.ok && /not verified/.test(unverified.why),
      'and the first-send mistake — an unverified domain — is passed through in the provider’s own words', unverified);

    const down = await sendHttpMail(mail, { env: { RESEND_API_KEY: 'k' },
      post: async () => ({ status: 0, error: 'timeout' }) });
    ok(!down.ok && /could not reach/.test(down.why), 'a provider having a bad afternoon is not a crash');

    const none = await sendHttpMail(mail, { env: {}, post: async () => { throw new Error('should not be called'); } });
    ok(!none.ok && /no HTTP mail provider/.test(none.why), 'and with nothing configured it does not even try');

    console.log(`\nmailHttp self-test: ${pass} passed, ${fail} failed`);
    return fail === 0;
  })();
}

if (require.main === module && process.argv[2] === 'selftest') {
  selftest().then(okAll => process.exit(okAll ? 0 : 1));
}
