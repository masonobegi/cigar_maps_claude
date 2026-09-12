/**
 * Does a sweep's work survive the next import?
 *
 * Every correction this app makes — a shop found shut, a listing ruled not a
 * shop, a renamed branch, a pin moved to the right door, a phone fixed by
 * staff, a badge taken off after reading the shop's own site — is written on
 * top of a row the national directory refreshes on every deploy. A regression
 * here is invisible until a closed shop is back on the map: one already put
 * 519 hidden listings back, a brewery among them, and the storefront sweep
 * later undid a closure six minutes after the closure sweep made it.
 *
 * So: seed every kind of correction, force a re-import, and check each one is
 * still there. Runs on its own scratch database and touches nothing else.
 *
 *   node src/jobs/reimportTest.js
 */
'use strict';

const os = require('os');
const path = require('path');

if (!process.env.PGLITE_DIR) {
  process.env.PGLITE_DIR = path.join(os.tmpdir(), 'cigarbuddy-reimport-test');
}
process.env.DISABLE_DEMO_SEED = '1';

const db = require('../database/db');
const { initSchema, runMigrations } = require('../database/schema');
const { importStoresFromFile } = require('./importStores');
const { writeFields } = require('../utils/storeEdits');

let pass = 0, fail = 0;
const ok = (cond, label, got) => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${got !== undefined ? `  -> ${JSON.stringify(got)}` : ''}`); }
};

/** A public, unclaimed directory listing the classifier is happy with. */
async function pickPublic(offset) {
  return db.get(`
    SELECT * FROM stores
    WHERE visible = 1 AND claimed = 0 AND COALESCE(staff_edited, 0) = 0
      AND source IN ('osm', 'overture') AND confidence >= 0.7
    ORDER BY id OFFSET ? LIMIT 1`, [offset]);
}

async function main() {
  await initSchema();
  await runMigrations();
  console.log('first import...');
  const first = await importStoresFromFile(null, { force: true, log: () => {} });
  if (first.skipped) { console.log('no directory file to import; run npm run build:directory first'); process.exit(2); }

  const rows = [];
  for (let i = 0; i < 8; i++) rows.push(await pickPublic(i * 37));
  if (rows.some(r => !r)) { console.log('not enough public listings in this database'); process.exit(2); }
  const [ruledOut, ourClosure, chainClosure, renamed, movedPin, staffPhone, badgeOff, siteHours] = rows;

  // A sweep's verdict, without staff_edited: the importer must honour it.
  await db.run(`UPDATE stores SET visible = 0, storefront = 'not_retail', storefront_reason = 'test' WHERE id = ?`, [ruledOut.id]);
  // A closure read off the shop's own website.
  await db.run(`UPDATE stores SET visible = 0, storefront = 'closed', operating_status = 'permanently_closed',
      closed_reason = 'its own website says so' WHERE id = ?`, [ourClosure.id]);
  // A closure from the chain's own list of branches.
  await db.run(`UPDATE stores SET visible = 0, storefront = 'closed', operating_status = 'permanently_closed',
      closed_reason = 'the chain no longer lists this address' WHERE id = ?`, [chainClosure.id]);
  await writeFields(renamed.id, { name: 'Renamed By A Sweep' }, { source: 'registry', job: 'test', reason: 'licence holder trades under a new name' });
  await writeFields(movedPin.id, { lat: 40.1234, lng: -80.1234 }, { source: 'geocode', job: 'test', reason: 'pin was 4 km from its address' });
  await writeFields(staffPhone.id, { phone: '(555) 010-9999' }, { source: 'staff', job: 'test', reason: 'staff correction' });
  await db.run('UPDATE stores SET has_lounge = 1 WHERE id = ?', [badgeOff.id]);
  await writeFields(badgeOff.id, { has_lounge: 0 }, { source: 'website', job: 'test', reason: 'its own site describes no lounge' });
  await db.run(`UPDATE stores SET hours = ?, hours_source = 'website' WHERE id = ?`,
    [JSON.stringify({ Mon: '9am-9pm', Sun: 'Closed' }), siteHours.id]);

  console.log('re-import...');
  await importStoresFromFile(null, { force: true, log: () => {} });

  const after = async id => db.get('SELECT * FROM stores WHERE id = ?', [id]);
  const a = await after(ruledOut.id);
  ok(a.visible === 0 && a.storefront === 'not_retail', 'a storefront verdict still hides the listing', a.visible);
  const b = await after(ourClosure.id);
  ok(b.visible === 0 && b.operating_status === 'permanently_closed', 'a closure from the shop\'s own website survives', { visible: b.visible, status: b.operating_status });
  const c = await after(chainClosure.id);
  ok(c.visible === 0 && c.operating_status === 'permanently_closed', 'a closure from the chain\'s own list survives', { visible: c.visible, status: c.operating_status });
  const d = await after(renamed.id);
  ok(d.name === 'Renamed By A Sweep', 'a renamed listing keeps its new name', d.name);
  const e = await after(movedPin.id);
  ok(Number(e.lat) === 40.1234 && Number(e.lng) === -80.1234, 'a pin moved to the right door stays there', { lat: e.lat, lng: e.lng });
  const f = await after(staffPhone.id);
  ok(f.phone === '(555) 010-9999', 'a phone staff fixed is not overwritten', f.phone);
  const g = await after(badgeOff.id);
  ok(Number(g.has_lounge) === 0, 'a lounge badge taken off after reading the site stays off', g.has_lounge);
  const h = await after(siteHours.id);
  ok(h.hours_source === 'website' && JSON.parse(h.hours).Mon === '9am-9pm', 'hours read from the shop\'s website survive', h.hours);

  // And the directory still refreshes what nobody has corrected.
  const untouched = await db.get(`SELECT COUNT(*)::int AS n FROM stores WHERE field_sources IS NULL AND source IN ('osm', 'overture')`);
  ok(untouched.n > 1000, 'listings nobody corrected are still the directory\'s to refresh', untouched.n);
  const edits = await db.get('SELECT COUNT(*)::int AS n FROM store_edits');
  ok(edits.n >= 4, 'every correction is in the edit log', edits.n);

  console.log(`\nreimport test: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
