/**
 * Move base64 images out of Postgres and into object storage.
 *
 * Safe to run against a live database: each row is copied to storage first,
 * then the row is updated to point at the new URL and the blob is cleared.
 * A row is only cleared after its upload succeeds, so an interrupted run just
 * leaves the rest for next time. Re-running only picks up what is left.
 *
 * Usage:
 *   node src/jobs/migrateImages.js            # migrate everything it can
 *   node src/jobs/migrateImages.js --dry-run  # report sizes and stop
 *   node src/jobs/migrateImages.js --limit 200
 */
'use strict';

const db = require('../database/db');
const storage = require('../utils/storage');

async function tableSizes() {
  const cigar = await db.get(`
    SELECT COUNT(*) AS rows, COALESCE(SUM(LENGTH(image_data)), 0) AS bytes
    FROM cigar_images WHERE image_data IS NOT NULL
  `);
  const review = await db.get(`
    SELECT COUNT(*) AS rows, COALESCE(SUM(LENGTH(photo_data)), 0) AS bytes
    FROM reviews WHERE photo_data IS NOT NULL
  `);
  return { cigar, review };
}

const mb = n => `${(Number(n || 0) / 1048576).toFixed(1)} MB`;

async function migrate({ limit = 100000, dryRun = false, log = console.log } = {}) {
  const mode = storage.backend();
  log(`[migrate-images] storage backend: ${storage.describe()}`);
  const before = await tableSizes();
  log(`[migrate-images] cigar images: ${before.cigar.rows} rows, ${mb(before.cigar.bytes)}`);
  log(`[migrate-images] review photos: ${before.review.rows} rows, ${mb(before.review.bytes)}`);

  if (dryRun) return { dryRun: true, before };
  if (mode === 'none') {
    log('[migrate-images] no storage backend configured, nothing to do');
    return { skipped: true };
  }

  let moved = 0, failed = 0;

  const cigarRows = await db.all(
    'SELECT id, image_data, image_type FROM cigar_images WHERE image_data IS NOT NULL AND image_url IS NULL ORDER BY id LIMIT ?',
    [limit]);
  for (const row of cigarRows) {
    try {
      const url = await storage.putImage(Buffer.from(row.image_data, 'base64'), row.image_type, 'cigars');
      if (!url) { failed++; continue; }
      await db.run('UPDATE cigar_images SET image_url = ?, image_data = NULL WHERE id = ?', [url, row.id]);
      moved++;
    } catch (err) {
      failed++;
      log(`[migrate-images] cigar image ${row.id} failed: ${err.message}`);
    }
  }

  const reviewRows = await db.all(
    'SELECT id, photo_data, photo_type FROM reviews WHERE photo_data IS NOT NULL AND photo_url IS NULL ORDER BY id LIMIT ?',
    [limit]);
  for (const row of reviewRows) {
    try {
      const url = await storage.putImage(Buffer.from(row.photo_data, 'base64'), row.photo_type, 'reviews');
      if (!url) { failed++; continue; }
      await db.run('UPDATE reviews SET photo_url = ?, photo_data = NULL WHERE id = ?', [url, row.id]);
      moved++;
    } catch (err) {
      failed++;
      log(`[migrate-images] review photo ${row.id} failed: ${err.message}`);
    }
  }

  const after = await tableSizes();
  const reclaimed = (Number(before.cigar.bytes) + Number(before.review.bytes)) - (Number(after.cigar.bytes) + Number(after.review.bytes));
  log(`[migrate-images] moved ${moved}, failed ${failed}, reclaimed ${mb(reclaimed)} of database space`);
  log('[migrate-images] run VACUUM FULL on the two tables during a quiet moment to return the space to disk');
  return { moved, failed, reclaimed };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const limitArg = args.indexOf('--limit');
  (async () => {
    const { initSchema, runMigrations } = require('../database/schema');
    await initSchema();
    await runMigrations();
    await migrate({
      dryRun: args.includes('--dry-run'),
      limit: limitArg >= 0 ? parseInt(args[limitArg + 1]) || 100000 : 100000,
    });
    process.exit(0);
  })().catch(err => { console.error(err); process.exit(1); });
}

module.exports = { migrate, tableSizes };
