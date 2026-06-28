require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { initSchema } = require('./database/schema');
const { seed } = require('./database/seed');

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/auth', require('./routes/auth'));
app.use('/api/cigars', require('./routes/cigars'));
app.use('/api/stores', require('./routes/stores'));
app.use('/api/users', require('./routes/users'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/deals', require('./routes/deals'));
app.use('/api/smoke-list', require('./routes/smoke-list'));
app.use('/api/admin', require('./routes/admin'));

app.get('/api/health', (_, res) => res.json({ status: 'ok', app: 'CigarBuddy' }));

// Serve React build in production
const clientDist = path.join(__dirname, '../../client/dist');
console.log(`[static] clientDist path: ${clientDist}`);
console.log(`[static] clientDist exists: ${fs.existsSync(clientDist)}`);
app.use(express.static(clientDist));
app.get('*', (req, res) => {
  const indexPath = path.join(clientDist, 'index.html');
  if (!fs.existsSync(indexPath)) {
    console.error(`[static] index.html not found at: ${indexPath}`);
    return res.status(404).send(`index.html not found. clientDist resolved to: ${clientDist}`);
  }
  res.sendFile(indexPath);
});

// Global async error handler (catches errors thrown from asyncRoute-wrapped handlers)
app.use((err, req, res, next) => {
  console.error(err.stack || err.message || err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3001;

async function start() {
  await initSchema();
  await seed();
  app.listen(PORT, () => console.log(`CigarBuddy API running on :${PORT}`));
}

start().catch(err => { console.error('Failed to start:', err); process.exit(1); });
