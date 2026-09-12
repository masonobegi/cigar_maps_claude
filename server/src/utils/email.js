const nodemailer = require('nodemailer');

let transporter = null;
try {
  if (process.env.SMTP_USER && process.env.SMTP_PASS) {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
} catch (_) {}

/**
 * Resolves with the transporter result on success and `false` when nothing was
 * sent (SMTP not configured, or the send failed). Never rejects, so callers
 * that do not care about delivery can fire and forget.
 */
async function sendMail({ to, subject, text, html }) {
  if (!transporter) return false;
  return transporter.sendMail({ from: process.env.SMTP_USER, to, subject, text, html })
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

module.exports = { sendMail, mailConfigured };
