/**
 * Write what each thumbnail measured as, so the card is drawn from the picture
 * rather than from a guess about its filename.
 *
 * The measuring is done by sweeps/scripts/measure_store_images.js, which fetches
 * every picture the public directory shows and composites it onto the backdrop
 * the component would really use. The judgement is utils/imageTreatment.js,
 * which has the thresholds and the self-test. This only carries the answer into
 * the database.
 *
 * Two columns, both derived and both safe to recompute at any time:
 *   image_kind  logo | photo | dim | blank
 *   image_luma  0..1, how bright the square reads
 *
 * Nothing about the shop itself is touched, so this does not go through
 * writeFields: there is no provenance to record about a fact we computed
 * ourselves from a file we fetched.
 *
 *   DRY=1 railway run --service Postgres node sweeps/scripts/prod.js <abs path>
 *         railway run --service Postgres node sweeps/scripts/prod.js <abs path>
 */
'use strict';

const fs = require('fs');
const path = require('path');
const db = require('../../server/src/database/db');
const { treatmentFor } = require('../../server/src/utils/imageTreatment');

const DRY = process.env.DRY === '1';

(async () => {
  const file = path.join(__dirname, '..', 'decisions', 'store_images_measured.json');
  const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
  const measured = rows.filter(r => r.status === 'ok');

  const counts = { logo: 0, photo: 0, dim: 0, blank: 0, skipped: 0 };
  let wrote = 0;

  for (const r of rows) {
    if (r.status !== 'ok') { counts.skipped++; continue; }
    const kind = treatmentFor(r);
    if (!kind) { counts.skipped++; continue; }
    counts[kind]++;
    if (DRY) continue;
    const res = await db.run(
      'UPDATE stores SET image_kind = ?, image_luma = ? WHERE id = ?',
      [kind, Math.round(r.luma * 1000) / 1000, r.id]);
    wrote += res.changes || 0;
  }

  console.log(`${rows.length} pictures in the file, ${measured.length} of them measured\n`);
  console.log(`  logo   ${String(counts.logo).padStart(4)}  light backdrop, contained, padded`);
  console.log(`  dim    ${String(counts.dim).padStart(4)}  a real photograph, lifted`);
  console.log(`  blank  ${String(counts.blank).padStart(4)}  dark with nothing in it — the monogram instead`);
  console.log(`  photo  ${String(counts.photo).padStart(4)}  left alone`);
  console.log(`  ----   ${String(counts.skipped).padStart(4)}  unreachable or undecodable, left unmeasured`);
  console.log(`\n${DRY ? 'would write' : 'wrote'} ${DRY ? counts.logo + counts.photo + counts.dim + counts.blank : wrote} rows`);

  if (!DRY) {
    const n = await db.get(`SELECT
      COUNT(*) FILTER (WHERE image_kind = 'logo')::int  AS logo,
      COUNT(*) FILTER (WHERE image_kind = 'dim')::int   AS dim,
      COUNT(*) FILTER (WHERE image_kind = 'blank')::int AS blank,
      COUNT(*) FILTER (WHERE image_kind = 'photo')::int AS photo
      FROM stores WHERE visible = 1`);
    console.log(`\nin the database now: ${n.logo} logo, ${n.dim} dim, ${n.blank} blank, ${n.photo} photo`);
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
