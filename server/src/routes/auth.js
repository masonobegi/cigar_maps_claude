const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../database/db');
const { requireAuth, JWT_SECRET } = require('../middleware/auth');
const { asyncRoute } = db;

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
  const user = await db.get('SELECT id, email, name, account_type, avatar_url, bio, created_at FROM users WHERE id = ?', [req.user.id]);
  if (!user) return res.status(404).json({ error: 'User not found' });

  let store = null;
  if (user.account_type === 'store') {
    store = await db.get('SELECT * FROM stores WHERE user_id = ?', [user.id]);
  }
  res.json({ user, store });
}));

router.put('/me', requireAuth, asyncRoute(async (req, res) => {
  const { name, bio, avatar_url } = req.body;
  await db.run('UPDATE users SET name = ?, bio = ?, avatar_url = ? WHERE id = ?', [name, bio, avatar_url, req.user.id]);
  res.json({ success: true });
}));

module.exports = router;
