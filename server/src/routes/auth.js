const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const db = require('../database/db');
const { requireAuth, JWT_SECRET } = require('../middleware/auth');
const { sendMail } = require('../utils/email');
const { asyncRoute } = db;

const { appUrl } = require('../utils/appUrl');
const APP_URL = appUrl();

// Sending mail to an address someone else typed is the abusable part, so the
// two endpoints that do it are limited harder than the rest of the API.
const mailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests. Try again in 15 minutes.' },
});

const RESET_TTL_MS = 60 * 60 * 1000;

function newToken() {
  const token = crypto.randomBytes(32).toString('hex');
  return { token, hash: bcrypt.hashSync(token, 8) };
}

/** Without SMTP configured the link is logged so local development still works. */
async function mailOrLog(label, to, subject, url, body) {
  const sent = await sendMail({
    to, subject,
    text: `${body}\n\n${url}\n\nIf you did not request this, you can ignore this email.`,
    html: `<p>${body}</p><p><a href="${url}">${url}</a></p><p style="color:#777">If you did not request this, you can ignore this email.</p>`,
  });
  if (sent === false) console.log(`[auth] ${label} for ${to}: ${url}`);
  return sent;
}

router.post('/register', asyncRoute(async (req, res) => {
  const { email, password, name, account_type } = req.body;
  if (!email || !password || !name) return res.status(400).json({ error: 'Missing required fields' });
  if (!['user', 'store'].includes(account_type)) return res.status(400).json({ error: 'Invalid account type' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const existing = await db.get('SELECT id FROM users WHERE email = ?', [email]);
  if (existing) return res.status(409).json({ error: 'Email already registered' });

  const password_hash = bcrypt.hashSync(password, 10);
  const result = await db.run(
    'INSERT INTO users (email, password_hash, name, account_type) VALUES (?, ?, ?, ?) RETURNING id',
    [email, password_hash, name, account_type || 'user']
  );

  const user = { id: result.lastInsertRowid, email, name, account_type: account_type || 'user' };
  const token = jwt.sign(user, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user });

  // Verification email is a side errand; never make the signup wait on it.
  sendVerificationEmail(user.id, email).catch(err => console.error('[auth] verification email failed:', err.message));
}));

async function sendVerificationEmail(userId, email) {
  const { token, hash } = newToken();
  await db.run('UPDATE users SET verify_token_hash = ?, verify_sent_at = NOW() WHERE id = ?', [hash, userId]);
  const url = `${APP_URL}/verify-email?uid=${userId}&token=${token}`;
  return mailOrLog('verify link', email, 'Confirm your CigarBuddy email',
    url, 'Confirm your email address to get in-stock alerts and claim updates from CigarBuddy.');
}

router.post('/forgot', mailLimiter, asyncRoute(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  // Always the same answer, so this cannot be used to discover who has an account.
  res.json({ ok: true });
  if (!email) return;

  const user = await db.get('SELECT id, email, name FROM users WHERE LOWER(email) = ?', [email]);
  if (!user) return;

  await db.run("UPDATE password_resets SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL", [user.id]);
  const { token, hash } = newToken();
  await db.run('INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
    [user.id, hash, new Date(Date.now() + RESET_TTL_MS).toISOString()]);

  const url = `${APP_URL}/reset-password?uid=${user.id}&token=${token}`;
  mailOrLog('reset link', user.email, 'Reset your CigarBuddy password',
    url, 'Use the link below to choose a new password. It works once and expires in an hour.')
    .catch(err => console.error('[auth] reset email failed:', err.message));
}));

router.post('/reset', asyncRoute(async (req, res) => {
  const { uid, token, password } = req.body || {};
  if (!uid || !token) return res.status(400).json({ error: 'This reset link is incomplete. Request a new one.' });
  if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const row = await db.get(
    'SELECT * FROM password_resets WHERE user_id = ? AND used_at IS NULL AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1',
    [uid]);
  if (!row || !bcrypt.compareSync(String(token), row.token_hash)) {
    return res.status(400).json({ error: 'This reset link has expired or already been used. Request a new one.' });
  }

  await db.run('UPDATE users SET password_hash = ? WHERE id = ?', [bcrypt.hashSync(password, 10), uid]);
  await db.run('UPDATE password_resets SET used_at = NOW() WHERE id = ?', [row.id]);
  res.json({ ok: true });
}));

router.post('/send-verification', requireAuth, mailLimiter, asyncRoute(async (req, res) => {
  const user = await db.get('SELECT id, email, email_verified FROM users WHERE id = ?', [req.user.id]);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.email_verified) return res.json({ ok: true, already_verified: true });
  await sendVerificationEmail(user.id, user.email);
  res.json({ ok: true, already_verified: false });
}));

router.post('/verify-email', asyncRoute(async (req, res) => {
  const { uid, token } = req.body || {};
  if (!uid || !token) return res.status(400).json({ error: 'This link is incomplete. Ask for a new one.' });
  const user = await db.get('SELECT id, verify_token_hash, email_verified FROM users WHERE id = ?', [uid]);
  if (!user) return res.status(400).json({ error: 'This link is no longer valid.' });
  if (user.email_verified) return res.json({ ok: true, already_verified: true });
  if (!user.verify_token_hash || !bcrypt.compareSync(String(token), user.verify_token_hash)) {
    return res.status(400).json({ error: 'This link is no longer valid. Send yourself a new one.' });
  }
  await db.run('UPDATE users SET email_verified = 1, verify_token_hash = NULL WHERE id = ?', [uid]);
  res.json({ ok: true });
}));

router.post('/login', asyncRoute(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Missing credentials' });

  const user = await db.get('SELECT * FROM users WHERE email = ?', [email]);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const payload = { id: user.id, email: user.email, name: user.name, account_type: user.account_type };
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user: payload });
}));

router.get('/me', requireAuth, asyncRoute(async (req, res) => {
  const user = await db.get('SELECT id, email, name, account_type, avatar_url, bio, location_city, location_state, home_lat, home_lng, home_label, humidor_sheet_url, email_verified, created_at FROM users WHERE id = ?', [req.user.id]);
  if (!user) return res.status(404).json({ error: 'User not found' });

  let store = null, pendingClaim = null;
  if (user.account_type === 'store') {
    store = (await db.get('SELECT * FROM stores WHERE user_id = ?', [user.id])) || null;
    if (!store) {
      pendingClaim = await db.get(`
        SELECT sc.id, sc.status, sc.method, sc.created_at, s.id as store_id, s.name as store_name, s.city, s.state
        FROM store_claims sc JOIN stores s ON s.id = sc.store_id
        WHERE sc.user_id = ? AND sc.status = 'pending' ORDER BY sc.created_at DESC LIMIT 1
      `, [user.id]);
    }
  }
  res.json({ user, store, pending_claim: pendingClaim });
}));

router.put('/me', requireAuth, asyncRoute(async (req, res) => {
  const { name, bio, avatar_url } = req.body;
  await db.run('UPDATE users SET name = ?, bio = ?, avatar_url = ? WHERE id = ?', [name, bio, avatar_url, req.user.id]);
  res.json({ success: true });
}));

module.exports = router;
