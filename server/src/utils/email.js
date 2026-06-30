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

async function sendMail({ to, subject, text, html }) {
  if (!transporter) return;
  return transporter.sendMail({ from: process.env.SMTP_USER, to, subject, text, html })
    .catch(err => console.error('[email] send failed:', err.message));
}

module.exports = { sendMail };
