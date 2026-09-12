/**
 * Replace the staff passwords on production.
 *
 * admin@cigarbuddy.com / admin123 logs in to the live site as an admin. It is
 * the local-development default, and it survived into production because the
 * seed inserts staff accounts with ON CONFLICT (email) DO NOTHING — so the row
 * created on the first boot keeps whatever password it was born with, for ever,
 * whatever ADMIN_PASSWORD is later set to.
 *
 * This rewrites the hashes directly. It prints each new password exactly once,
 * because there is nowhere else to read it from afterwards.
 *
 *   railway run --service Postgres node sweeps/scripts/prod.js <this file>
 */
'use strict';

const crypto = require('crypto');
const bcrypt = require('../../server/node_modules/bcryptjs');
const db = require('../../server/src/database/db');

/** Readable at a glance, and still 96 bits of entropy. */
const strong = () => crypto.randomBytes(12).toString('base64url');

(async () => {
  const staff = await db.all(
    `SELECT id, email, name, account_type FROM users WHERE account_type IN ('admin', 'staff') ORDER BY id`);
  if (!staff.length) { console.log('no staff accounts found'); process.exit(0); }

  console.log('New passwords — copy these now, they are not stored anywhere else:\n');
  for (const u of staff) {
    const password = strong();
    const hash = await bcrypt.hash(password, 10);
    await db.run('UPDATE users SET password_hash = ? WHERE id = ?', [hash, u.id]);
    console.log(`  ${String(u.account_type).padEnd(6)} ${String(u.email).padEnd(34)} ${password}`);
  }
  console.log('\nEvery other session is unaffected; only these accounts changed.');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
