/**
 * Outbound email.
 *
 * This used to hardcode `service: 'gmail'`, which meant the only way to send
 * anything was a Gmail account — and Gmail rate-limits, rewrites the From
 * header to the account's own address, and treats a few hundred messages to
 * strangers as exactly what it looks like. Anything that has to reach a
 * stranger's inbox (a shop being told its listing exists, a password reset)
 * wants a transactional provider on your own domain instead.
 *
 * So the transport is now described by the environment, and the shape of that
 * description is the only thing this file decides:
 *
 *   SMTP_HOST + SMTP_PORT + SMTP_USER + SMTP_PASS   any provider: Resend,
 *                                                   Postmark, SES, Fastmail
 *   SMTP_SERVICE + SMTP_USER + SMTP_PASS            a name nodemailer knows
 *                                                   ("gmail", "outlook")
 *   SMTP_USER + SMTP_PASS alone                     Gmail, as before, so an
 *                                                   existing deployment keeps
 *                                                   working unchanged
 *
 * MAIL_FROM sets the From header — "CigarBuddy <hello@cigarbuddy.com>" — which
 * a provider on your own domain will honour and Gmail will not. It falls back
 * to SMTP_USER.
 *
 *   node src/utils/email.js selftest
 */
'use strict';

const nodemailer = require('nodemailer');

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

/**
 * The From header. A provider on your own domain honours a display name and a
 * real address; Gmail overwrites it with the account's own, which is why this
 * falls back to SMTP_USER rather than inventing something.
 */
function fromAddress(env = process.env) {
  return env.MAIL_FROM || env.SMTP_USER || null;
}

let transporter = null;
try {
  const config = transportConfig();
  if (config) transporter = nodemailer.createTransport(config);
} catch (err) {
  console.error('[email] could not build a transport:', err.message);
}

/**
 * Resolves with the transporter result on success and `false` when nothing was
 * sent (SMTP not configured, or the send failed). Never rejects, so callers
 * that do not care about delivery can fire and forget.
 */
async function sendMail({ to, subject, text, html, replyTo }) {
  if (!transporter) return false;
  return transporter.sendMail({ from: fromAddress(), to, subject, text, html, replyTo })
    .catch(err => { console.error('[email] send failed:', err.message); return false; });
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
const mailConfigured = () => !!(process.env.SMTP_USER && process.env.SMTP_PASS);

/**
 * Ask the provider whether the credentials work, once, at boot.
 *
 * Without this a wrong password is invisible until somebody notices that no
 * shop has ever received anything: every send fails into a console line nobody
 * reads. A line in the boot log either way is the difference between "email is
 * broken" and "email was never set up".
 */
async function verifyTransport({ log = console.log } = {}) {
  if (!transporter) {
    log('[email] no SMTP credentials: nothing can be sent, and the claim flow will say so');
    return false;
  }
  try {
    await transporter.verify();
    const c = transportConfig() || {};
    log(`[email] ready via ${c.host || c.service}, sending as ${fromAddress()}`);
    return true;
  } catch (err) {
    log(`[email] SMTP is configured but REFUSED the credentials: ${err.message}`);
    return false;
  }
}

module.exports = { sendMail, mailConfigured, verifyTransport, transportConfig, fromAddress, selftest };

// ── self-test ───────────────────────────────────────────────────────────────
function selftest() {
  let pass = 0, fail = 0;
  const ok = (cond, label, extra) => {
    if (cond) { pass++; console.log(`  ok   ${label}`); }
    else { fail++; console.log(`  FAIL ${label}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ''}`); }
  };

  ok(transportConfig({}) === null, 'no credentials describes no transport');
  ok(transportConfig({ SMTP_USER: 'a' }) === null, 'and half of them describes none either');

  // The case that mattered: a provider that is not Gmail.
  const resend = transportConfig({ SMTP_HOST: 'smtp.resend.com', SMTP_USER: 'resend', SMTP_PASS: 'k' });
  ok(resend.host === 'smtp.resend.com', 'a host is honoured, so any provider works', resend);
  ok(resend.port === 587 && resend.secure === false, 'port defaults to 587, which starts in the clear and upgrades', resend);
  const implicit = transportConfig({ SMTP_HOST: 'smtp.example.com', SMTP_PORT: '465', SMTP_USER: 'u', SMTP_PASS: 'p' });
  ok(implicit.secure === true, '465 is implicit TLS, derived rather than asked for', implicit);
  const forced = transportConfig({ SMTP_HOST: 'h', SMTP_PORT: '2525', SMTP_SECURE: 'true', SMTP_USER: 'u', SMTP_PASS: 'p' });
  ok(forced.secure === true, 'and SMTP_SECURE overrides that when a provider is unusual', forced);

  ok(transportConfig({ SMTP_SERVICE: 'outlook', SMTP_USER: 'u', SMTP_PASS: 'p' }).service === 'outlook',
    'a named service still works');
  // An existing deployment must not break: credentials alone still mean Gmail.
  ok(transportConfig({ SMTP_USER: 'u', SMTP_PASS: 'p' }).service === 'gmail',
    'credentials with nothing else stay Gmail, so a working deployment keeps working');
  ok(!transportConfig({ SMTP_USER: 'u', SMTP_PASS: 'p' }).host, 'and carry no host of their own');

  ok(fromAddress({ MAIL_FROM: 'CigarBuddy <hello@cigarbuddy.com>', SMTP_USER: 'x@gmail.com' })
    === 'CigarBuddy <hello@cigarbuddy.com>', 'MAIL_FROM is the From header when it is set');
  ok(fromAddress({ SMTP_USER: 'x@gmail.com' }) === 'x@gmail.com', 'and the account itself otherwise');
  ok(fromAddress({}) === null, 'with nothing set there is no From to give');

  console.log(`\nemail self-test: ${pass} passed, ${fail} failed`);
  return fail === 0;
}

if (require.main === module && process.argv[2] === 'selftest') process.exit(selftest() ? 0 : 1);
