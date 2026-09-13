/**
 * Outbound email.
 *
 * Two things had to be fixed here, and the second was invisible until the first
 * one was.
 *
 * It used to hardcode `service: 'gmail'`, so the only way to send anything was a
 * Gmail account. Anything that has to reach a stranger's inbox — a shop being
 * told its listing exists — wants a transactional provider on your own domain,
 * because Gmail rate-limits, rewrites the From header to the account's own
 * address, and treats a few hundred messages to strangers as what it looks like.
 * So the transport is now described by the environment:
 *
 *   SMTP_HOST + SMTP_PORT + SMTP_USER + SMTP_PASS   any provider: Resend,
 *                                                   Postmark, SES, Fastmail
 *   SMTP_SERVICE + SMTP_USER + SMTP_PASS            a name nodemailer knows
 *   SMTP_USER + SMTP_PASS alone                     Gmail, as before
 *
 * And then a boot check said what no log had ever said out loud:
 *
 *   [email] SMTP is configured but REFUSED the credentials:
 *   connect ENETUNREACH 2607:f8b0:4023:c0d::6c:465
 *
 * Not a password problem. The container has an IPv6 interface with no route to
 * the internet, nodemailer sees that interface and tries the AAAA record first,
 * and every send had been failing that way since the day credentials were set —
 * silently, into a console line nobody reads. So the host is resolved to an
 * IPv4 address before connecting, with the original hostname kept as the TLS
 * server name so certificate validation still works. SMTP_FAMILY=6 opts back
 * out, for a host that really is IPv6-only.
 *
 * And then that became ETIMEDOUT on 465, and on 587 as well — which is not a
 * provider problem and no provider will fix it. This host does not route
 * outbound SMTP at all, because a platform that does becomes a spam relay
 * within a week. So mail leaves over HTTPS instead (utils/mailHttp.js:
 * RESEND_API_KEY or POSTMARK_TOKEN), and the SMTP path below stays for
 * anywhere that does allow it.
 *
 *   node src/utils/email.js selftest
 */
'use strict';

const dns = require('dns').promises;
const nodemailer = require('nodemailer');
const { sendHttpMail, httpProvider } = require('./mailHttp');

/**
 * The transport this environment describes, or null when it describes none.
 * Pure, so the rules above can be checked without sending anything.
 */
function transportConfig(env = process.env) {
  const user = env.SMTP_USER, pass = env.SMTP_PASS;
  if (!user || !pass) return null;
  const auth = { user, pass };

  if (env.SMTP_HOST) {
    const port = Number(env.SMTP_PORT) || 587;
    return {
      host: env.SMTP_HOST,
      port,
      // 465 is implicit TLS; 587 and 25 start in the clear and upgrade. Getting
      // this the wrong way round is the usual reason a provider times out
      // rather than refusing, so it is derived from the port instead of asked
      // for — unless SMTP_SECURE says otherwise.
      secure: env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : port === 465,
      auth,
    };
  }
  if (env.SMTP_SERVICE) return { service: env.SMTP_SERVICE, auth };
  return { service: 'gmail', auth };
}

/** The hostname a named service connects to, so it can be pinned like any other. */
const SERVICE_HOSTS = { gmail: 'smtp.gmail.com', outlook: 'smtp-mail.outlook.com', zoho: 'smtp.zoho.com' };

/**
 * The same config with the host resolved to an IPv4 address.
 *
 * nodemailer decides which address family to try by looking at the machine's
 * own interfaces, so a container that has an IPv6 interface but no IPv6 route
 * fails every connection before it sends a byte. Connecting to a resolved A
 * record avoids the question; `servername` keeps TLS validating against the
 * name rather than the number.
 *
 * If resolution fails, the config is returned untouched: a hostname that might
 * work beats a certainty that will not.
 */
async function pinToIPv4(config, { resolve4 = dns.resolve4, env = process.env } = {}) {
  if (!config || env.SMTP_FAMILY === '6') return config;
  const host = config.host || SERVICE_HOSTS[config.service];
  if (!host || /^[0-9.]+$/.test(host)) return config;
  try {
    const [address] = await resolve4(host);
    if (!address) return config;
    const port = config.port || (config.service === 'gmail' ? 465 : 587);
    return {
      ...config,
      service: undefined,
      host: address,
      port,
      secure: config.secure !== undefined ? config.secure : port === 465,
      tls: { ...(config.tls || {}), servername: host },
    };
  } catch {
    return config;
  }
}

/**
 * The From header. A provider on your own domain honours a display name and a
 * real address; Gmail overwrites it with the account's own, which is why this
 * falls back to SMTP_USER rather than inventing something.
 */
function fromAddress(env = process.env) {
  return env.MAIL_FROM || env.SMTP_USER || null;
}

/** Built once, on first use, because pinning the address is asynchronous. */
let transporterPromise = null;
function getTransport() {
  if (!transporterPromise) {
    const config = transportConfig();
    transporterPromise = config
      ? pinToIPv4(config).then(c => nodemailer.createTransport(c)).catch(() => null)
      : Promise.resolve(null);
  }
  return transporterPromise;
}

/**
 * Resolves with the transporter result on success and `false` when nothing was
 * sent (SMTP not configured, or the send failed). Never rejects, so callers
 * that do not care about delivery can fire and forget.
 */
async function sendMail({ to, subject, text, html, replyTo }) {
  // HTTPS first, when a provider key is set. This host does not route outbound
  // SMTP at all, so on Railway the HTTP path is the only one that can work; the
  // SMTP path stays for anywhere that does.
  if (httpProvider()) {
    const r = await sendHttpMail({ from: fromAddress(), to, subject, text, html, replyTo });
    if (r.ok) return r;
    console.error(`[email] send failed: ${r.why}`);
    return false;
  }
  const transporter = await getTransport();
  if (!transporter) return false;
  return transporter.sendMail({ from: fromAddress(), to, subject, text, html, replyTo })
    .catch(err => { console.error(`[email] send failed: ${err.message}`); return false; });
}

/**
 * Can this deployment actually send mail?
 *
 * Without SMTP credentials sendMail is a no-op that resolves, which is right
 * for the caller — a claim must not fail because the mailer is not set up —
 * but it means every page promising "we will email you" was promising
 * something that could not happen. The routes pass this on so the copy can
 * tell a visitor to check back instead.
 */
/**
 * What the boot check found, so a status page can report whether mail WORKS
 * rather than whether it is configured. Those were the same question until this
 * host turned out not to route SMTP at all: the variables were set, the status
 * said yes, and not one message had ever left.
 */
let lastVerify = { checked: false, ok: false, detail: 'not checked yet' };
const mailStatus = () => ({ ...lastVerify });

const mailConfigured = () => !!(httpProvider() || (process.env.SMTP_USER && process.env.SMTP_PASS));

/** Network failures and credential failures need different answers. */
function describeSmtpError(err) {
  const code = err && (err.code || err.errno);
  if (['ENETUNREACH', 'EHOSTUNREACH', 'ECONNREFUSED', 'ETIMEDOUT', 'ECONNECTION', 'ESOCKET'].includes(code)) {
    return `cannot reach the mail server (${code}). This is the network, not the password`
      + `${/ENETUNREACH/.test(String(code)) ? ' — usually an IPv6 route the container does not have' : ''}.`;
  }
  if (['EAUTH', 'EENVELOPE'].includes(code)) return 'the server rejected the credentials.';
  return `${err && err.message}`;
}

/**
 * Ask the provider whether this works, once, at boot.
 *
 * Without it a broken mailer is invisible until somebody notices that no shop
 * has ever received anything: every send fails into a console line nobody
 * reads. This is the check that found the IPv6 problem.
 */
async function verifyTransport({ log = console.log } = {}) {
  const provider = httpProvider();
  if (provider) {
    lastVerify = { checked: true, ok: true, detail: `${provider} over HTTPS` };
    log(`[email] ready via ${provider} over HTTPS, sending as ${fromAddress()}`);
    return true;
  }
  const transporter = await getTransport();
  if (!transporter) {
    lastVerify = { checked: true, ok: false, detail: 'nothing is configured' };
    log('[email] no SMTP credentials: nothing can be sent, and the claim flow will say so');
    return false;
  }
  try {
    await transporter.verify();
    const c = transportConfig() || {};
    lastVerify = { checked: true, ok: true, detail: `SMTP via ${c.host || c.service}` };
    log(`[email] ready via ${c.host || c.service}, sending as ${fromAddress()}`);
    return true;
  } catch (err) {
    lastVerify = { checked: true, ok: false, detail: describeSmtpError(err) };
    log(`[email] SMTP is configured but not working: ${describeSmtpError(err)}`);
    return false;
  }
}

module.exports = { sendMail, mailConfigured, mailStatus, verifyTransport, transportConfig, pinToIPv4,
  fromAddress, describeSmtpError, selftest };

// ── self-test ───────────────────────────────────────────────────────────────
function selftest() {
  let pass = 0, fail = 0;
  const ok = (cond, label, extra) => {
    if (cond) { pass++; console.log(`  ok   ${label}`); }
    else { fail++; console.log(`  FAIL ${label}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ''}`); }
  };

  return (async () => {
    ok(transportConfig({}) === null, 'no credentials describes no transport');
    ok(transportConfig({ SMTP_USER: 'a' }) === null, 'and half of them describes none either');

    const resend = transportConfig({ SMTP_HOST: 'smtp.resend.com', SMTP_USER: 'resend', SMTP_PASS: 'k' });
    ok(resend.host === 'smtp.resend.com', 'a host is honoured, so any provider works', resend);
    ok(resend.port === 587 && resend.secure === false, 'port defaults to 587, which starts in the clear and upgrades', resend);
    ok(transportConfig({ SMTP_HOST: 'h', SMTP_PORT: '465', SMTP_USER: 'u', SMTP_PASS: 'p' }).secure === true,
      '465 is implicit TLS, derived rather than asked for');
    ok(transportConfig({ SMTP_HOST: 'h', SMTP_PORT: '2525', SMTP_SECURE: 'true', SMTP_USER: 'u', SMTP_PASS: 'p' }).secure === true,
      'and SMTP_SECURE overrides that when a provider is unusual');
    ok(transportConfig({ SMTP_SERVICE: 'outlook', SMTP_USER: 'u', SMTP_PASS: 'p' }).service === 'outlook',
      'a named service still works');
    ok(transportConfig({ SMTP_USER: 'u', SMTP_PASS: 'p' }).service === 'gmail',
      'credentials with nothing else stay Gmail, so a working deployment keeps working');

    // The bug this file exists for: every send failed on an IPv6 address the
    // container could not route to, and nothing said so.
    const resolve4 = async host => (host === 'smtp.gmail.com' ? ['142.250.1.109'] : ['203.0.113.7']);
    const gmail = await pinToIPv4(transportConfig({ SMTP_USER: 'u', SMTP_PASS: 'p' }), { resolve4, env: {} });
    ok(gmail.host === '142.250.1.109', 'a named service is resolved to an address before connecting', gmail);
    ok(gmail.tls.servername === 'smtp.gmail.com', 'and TLS still validates against the name, not the number', gmail.tls);
    ok(gmail.service === undefined, 'the service name is dropped, or nodemailer would ignore the host');
    ok(gmail.port === 465 && gmail.secure === true, 'Gmail keeps implicit TLS on 465', gmail);

    const pinned = await pinToIPv4(transportConfig({ SMTP_HOST: 'smtp.resend.com', SMTP_USER: 'r', SMTP_PASS: 'k' }),
      { resolve4, env: {} });
    ok(pinned.host === '203.0.113.7' && pinned.port === 587 && pinned.secure === false,
      'and a plain host is pinned without changing its port or its TLS', pinned);

    const optedOut = await pinToIPv4(transportConfig({ SMTP_HOST: 'smtp.example.com', SMTP_USER: 'u', SMTP_PASS: 'p' }),
      { resolve4, env: { SMTP_FAMILY: '6' } });
    ok(optedOut.host === 'smtp.example.com', 'SMTP_FAMILY=6 opts out, for a host that really is IPv6-only');

    const failed = await pinToIPv4(transportConfig({ SMTP_HOST: 'smtp.example.com', SMTP_USER: 'u', SMTP_PASS: 'p' }),
      { resolve4: async () => { throw new Error('no such host'); }, env: {} });
    ok(failed.host === 'smtp.example.com',
      'and a name that will not resolve is left alone: a host that might work beats a certainty that will not');

    // The message told somebody to check a password that was never the problem.
    ok(/network, not the password/.test(describeSmtpError({ code: 'ENETUNREACH' })),
      'a network failure says so rather than blaming the credentials');
    ok(/IPv6/.test(describeSmtpError({ code: 'ENETUNREACH' })), 'and names the usual cause');
    ok(/rejected the credentials/.test(describeSmtpError({ code: 'EAUTH' })), 'a real auth failure still says so');

    ok(fromAddress({ MAIL_FROM: 'CigarBuddy <hello@cigarbuddy.com>', SMTP_USER: 'x@gmail.com' })
      === 'CigarBuddy <hello@cigarbuddy.com>', 'MAIL_FROM is the From header when it is set');
    ok(fromAddress({ SMTP_USER: 'x@gmail.com' }) === 'x@gmail.com', 'and the account itself otherwise');

    console.log(`\nemail self-test: ${pass} passed, ${fail} failed`);
    return fail === 0;
  })();
}

if (require.main === module && process.argv[2] === 'selftest') {
  selftest().then(okAll => process.exit(okAll ? 0 : 1));
}
