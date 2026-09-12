/**
 * Load server/.env, wherever the process was started from.
 *
 * dotenv resolves against process.cwd(), and this repository is started three
 * different ways: `npm start` from the root (cwd = the root), `npm run dev` from
 * server/ (cwd = server), and a job run by hand. Only the middle one found
 * server/.env, so the same configuration worked in development and silently did
 * not in the production-shaped start — the worst possible split, because the app
 * boots anyway on the embedded database with the fallback signing key and looks
 * like it is working.
 *
 * Resolving against __dirname instead makes all three the same. On Railway
 * there is no .env at all and the platform injects the variables directly, so
 * this is a no-op there.
 *
 * Requiring it is the whole interface:  require('../utils/loadEnv');
 */
'use strict';

const path = require('path');

try {
  require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
} catch (err) {
  // dotenv missing, or no .env to read. Both are ordinary: the platform may be
  // supplying the environment itself.
}

module.exports = {};
