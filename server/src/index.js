require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { initSchema, runMigrations } = require('./database/schema');
const { seed } = require('./database/seed');

const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
app.set('trust proxy', 1); // Railway sits behind a proxy; needed for correct client IPs in rate limiting
app.use(helmet({
  contentSecurityPolicy: false,          // the SPA loads map tiles, fonts, and geocoding from third parties
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(cors());
// Stripe signs the raw bytes, so this one route must not be JSON-parsed first.
app.use('/api/billing/webhook', express.raw({ type: '*/*', limit: '1mb' }));
app.use(express.json());

const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 400, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests, slow down a little.' } });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 40, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many sign-in attempts. Try again in 15 minutes.' } });
app.use('/api', apiLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

app.use('/api/auth', require('./routes/auth'));
app.use('/api/cigars', require('./routes/cigars'));
app.use('/api/stores', require('./routes/stores'));
app.use('/api/users', require('./routes/users'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/deals', require('./routes/deals'));
app.use('/api/smoke-list', require('./routes/smoke-list'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api', require('./routes/images'));
app.use('/api', require('./routes/import'));
app.use('/api', require('./routes/community'));
app.use('/api', require('./routes/menus'));
app.use('/api', require('./routes/links'));
app.use('/api', require('./routes/closures'));
app.use('/api/billing', require('./routes/billing'));
app.use('/api/places', require('./routes/places'));
app.use('/api/outreach', require('./routes/outreach'));

app.get('/api/health', (_, res) => res.json({ status: 'ok', app: 'CigarBuddy' }));

// Locally uploaded images (no object storage configured). Immutable filenames,
// so they can be cached hard.
const storage = require('./utils/storage');
app.use('/uploads', express.static(storage.LOCAL_DIR, {
  maxAge: '30d', immutable: true, fallthrough: true, index: false,
}));

// Serve React build in production
const clientDist = path.join(__dirname, '../../client/dist');
console.log(`[static] clientDist path: ${clientDist}`);
console.log(`[static] clientDist exists: ${fs.existsSync(clientDist)}`);
app.use(express.static(clientDist));

// robots.txt, the sitemaps, and an index.html whose head is true for the URL
// that asked for it. This replaces the catch-all that used to send one file for
// every route — which meant every shop page carried a canonical tag pointing at
// the homepage, telling crawlers not to index any of them. See utils/seo.js.
require('./utils/seo').mount(app, { clientDist, db: require('./database/db') });

// Global async error handler (catches errors thrown from asyncRoute-wrapped handlers)
app.use((err, req, res, next) => {
  console.error(err.stack || err.message || err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3001;

async function start() {
  await initSchema();      // CREATE TABLE IF NOT EXISTS — always safe
  await runMigrations();   // ALTER TABLE / new indexes — each runs exactly once
  await seed();            // upsert staff account; demo data only on empty DB
  const { seedCatalog } = require('./database/catalog');
  await seedCatalog(require('./database/db')).catch(err => console.error('[catalog] seed failed:', err.message));
  app.listen(PORT, () => console.log(`CigarBuddy API running on :${PORT}`));

  const { syncAllSheets } = require('./utils/sheetSync');
  setInterval(() => {
    syncAllSheets().catch(err => console.error('[sheet-sync] background error:', err.message));
  }, 15 * 60 * 1000);

  // Load / refresh the nationwide store directory in the background (no-op when already current)
  const { runStartupImport } = require('./jobs/importStores');
  runStartupImport().catch(err => console.error('[import] startup import failed:', err.message));

  // Read online menus from shops' own websites, so unclaimed listings can still
  // show what they carry. Skipped entirely when DISABLE_MENU_SCAN=1.
  try {
    require('./jobs/webMenu').runStartupMenuScan();
  } catch (err) {
    console.error('[menu] could not start the menu scanner:', err.message);
  }

  // Verify the websites on listings, so a dead domain is never shown as a link.
  try {
    require('./jobs/linkCheck').runStartupLinkCheck();
  } catch (err) {
    console.error('[links] could not start the link checker:', err.message);
  }

  // Find shops that have shut down, so the map only shows places still trading.
  try {
    require('./jobs/closureCheck').runStartupClosureCheck();
  } catch (err) {
    console.error('[closures] could not start the closure checker:', err.message);
  }
}

start().catch(err => { console.error('Failed to start:', err); process.exit(1); });
