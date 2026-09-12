/**
 * Keep the public directory to the listings every fact of which is backed.
 *
 * Mason set the bar: "perfect meaning like your 100% sure of its contents."
 * That was applied once by hand, which would have been true for about a week —
 * a shop's domain lapses, a re-crawl finds hours where there were none, a
 * licence registry confirms a door. So the set has to recompute itself, or it
 * becomes a snapshot of one evening in September.
 *
 * Four things, all recorded on the row itself:
 *
 *   it is a cigar shop     storefront is not 'unproven', 'duplicate' or any
 *                          other ruling-out verdict
 *   the website is live    website_status ok or blocked, after the hijack,
 *                          parked and elsewhere checks
 *   the hours came from    hours_source = 'website'
 *   that website
 *   the door is backed     address_backed_by is set: a current tobacco licence,
 *                          the shop's own site printing that street, or both
 *                          geocoders landing on it
 *
 * It moves listings both ways, and only ever its own: a listing a person or an
 * owner touched is never moved, and a listing hidden for any other reason —
 * closed, not a shop, a duplicate — stays hidden whatever else becomes true.
 *
 *   node src/jobs/verifiedSet.js run [--dry]
 *   node src/jobs/verifiedSet.js selftest
 */
'use strict';

const db = require('../database/db');

/** Verdicts that mean the listing is out for a reason of its own. */
const RULED_OUT = ['not_retail', 'online_only', 'closed', 'duplicate', 'moved', 'unproven'];

/** The verdict this job writes, and the only one it will reverse. */
const HELD = 'unverified';

/**
 * Is every fact on this listing backed? Pure, so the rule can be read and
 * tested without a database.
 *
 * Returns { certain: true } or { certain: false, missing: [...] }.
 */
function certainty(row) {
  const missing = [];
  if (RULED_OUT.includes(row.storefront)) missing.push('it has not proved it is a cigar shop');
  if (!(row.website_status === 'ok' || row.website_status === 'blocked')) missing.push('no live website of its own');
  if (!(row.hours_source === 'website' && row.hours)) missing.push('no hours read from its own website');
  if (!row.address_backed_by) missing.push('nothing independently backs its address');
  return missing.length ? { certain: false, missing } : { certain: true, missing: [] };
}

/** A listing this job is allowed to move. */
function mayMove(row) {
  if (Number(row.claimed) === 1 || Number(row.staff_edited) === 1) return false;
  // Visible: only one we would have published ourselves.
  if (Number(row.visible) === 1) return !RULED_OUT.includes(row.storefront);
  // Hidden: only one this job hid. Everything else was hidden for its own
  // reason and is not ours to reverse.
  return row.storefront === HELD;
}

async function run({ dry = false, log = console.log } = {}) {
  const rows = await db.all(`
    SELECT id, name, visible, storefront, website_status, hours, hours_source, address_backed_by,
           claimed, staff_edited
    FROM stores
    WHERE visible = 1 OR storefront = '${HELD}'`);

  let shown = 0, held = 0, skipped = 0;
  const heldWhy = {};
  for (const row of rows) {
    if (!mayMove(row)) { skipped++; continue; }
    const { certain, missing } = certainty(row);
    const isPublic = Number(row.visible) === 1;

    if (certain && !isPublic) {
      if (!dry) {
        await db.run(`UPDATE stores SET visible = 1, storefront = 'yes',
          storefront_reason = 'every fact on this listing is backed: a cigar shop, a live site of its own, hours read from it, and an address something outside the directory agrees with',
          storefront_checked_at = NOW() WHERE id = ?`, [row.id]);
      }
      shown++;
    } else if (!certain && isPublic) {
      if (!dry) {
        await db.run(`UPDATE stores SET visible = 0, storefront = ?, storefront_reason = ?,
          storefront_checked_at = NOW() WHERE id = ?`,
        [HELD, `held back from the verified set: ${missing.join('; ')}`.slice(0, 300), row.id]);
      }
      held++;
      heldWhy[missing[0]] = (heldWhy[missing[0]] || 0) + 1;
    }
  }

  const n = await db.get(`SELECT COUNT(*) FILTER (WHERE visible = 1)::int AS public,
    COUNT(*) FILTER (WHERE visible = 0 AND storefront = '${HELD}')::int AS held FROM stores`);
  log(`[verified] ${dry ? 'would show' : 'showed'} ${shown}, ${dry ? 'would hold' : 'held'} ${held}`
    + `, left ${skipped} alone (claimed, staff-edited, or hidden for another reason)`);
  for (const [why, count] of Object.entries(heldWhy)) log(`[verified]   ${count} — ${why}`);
  log(`[verified] ${n.public} public, ${n.held} held back`);
  return { shown, held, skipped, publicCount: n.public };
}

/**
 * On boot, and daily after that. The crawls that feed it — hours, links,
 * licences — run on their own schedules, so this only has to be later than
 * they are.
 */
function runOnStartup({ log = console.log } = {}) {
  if (process.env.DISABLE_VERIFIED_SET === '1') return;
  const go = () => run({ log }).catch(err => log(`[verified] failed: ${err.message}`));
  setTimeout(go, 10 * 60 * 1000);          // well after the import and the crawls settle
  setInterval(go, 24 * 60 * 60 * 1000);
}

module.exports = { run, runOnStartup, certainty, mayMove, RULED_OUT, HELD, selftest };

// ── self-test ───────────────────────────────────────────────────────────────
function selftest() {
  let pass = 0, fail = 0;
  const ok = (cond, label, extra) => {
    if (cond) { pass++; console.log(`  ok   ${label}`); }
    else { fail++; console.log(`  FAIL ${label}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ''}`); }
  };

  const good = {
    id: 1, visible: 1, storefront: 'yes', website_status: 'ok', hours: '{"Mon":"10am-7pm"}',
    hours_source: 'website', address_backed_by: 'licence', claimed: 0, staff_edited: 0,
  };
  ok(certainty(good).certain, 'a listing with all four holds is certain');
  ok(!certainty({ ...good, website_status: 'dns_fail' }).certain, 'a dead domain is not');
  ok(!certainty({ ...good, website_status: 'hijacked' }).certain, 'nor a domain somebody else now owns');
  ok(certainty({ ...good, website_status: 'blocked' }).certain,
    'but a site behind a firewall is alive to a person with a browser');
  ok(!certainty({ ...good, hours_source: 'map' }).certain, 'map hours are not the shop telling us');
  ok(!certainty({ ...good, hours: null }).certain, 'and a source with no hours behind it is nothing');
  ok(!certainty({ ...good, address_backed_by: null }).certain, 'an address only the directory asserts is not backed');
  ok(!certainty({ ...good, storefront: 'unproven' }).certain, 'nor is a listing that never proved it is a cigar shop');
  ok(certainty({ ...good, website_status: 'dns_fail', hours_source: 'map' }).missing.length === 2,
    'and every missing piece is named, not just the first');

  // What it may touch. This is the half that matters: a job that hides listings
  // unattended must never reach past its own.
  ok(mayMove(good), 'a listing we published ourselves can be reconsidered');
  ok(!mayMove({ ...good, claimed: 1 }), 'a claimed listing is the shop’s, never ours');
  ok(!mayMove({ ...good, staff_edited: 1 }), 'nor one a person edited');
  ok(mayMove({ ...good, visible: 0, storefront: HELD }), 'a listing this job held can come back');
  ok(!mayMove({ ...good, visible: 0, storefront: 'closed' }), 'a shop that shut stays shut');
  ok(!mayMove({ ...good, visible: 0, storefront: 'duplicate' }), 'a duplicate stays merged');
  ok(!mayMove({ ...good, visible: 0, storefront: 'unproven' }),
    'and one the pure-cigar check hid is that check’s to reverse, not this one’s');
  ok(!mayMove({ ...good, visible: 1, storefront: 'not_retail' }),
    'a visible row carrying a ruling-out verdict is a contradiction this job does not resolve');

  ok(!RULED_OUT.includes(HELD), 'the verdict this job writes is not one it treats as final, or nothing would ever come back');

  console.log(`\nverifiedSet self-test: ${pass} passed, ${fail} failed`);
  return fail === 0;
}

if (require.main === module && process.argv[2] === 'selftest') process.exit(selftest() ? 0 : 1);

if (require.main === module && process.argv[2] !== 'selftest') {
  const { initSchema, runMigrations } = require('../database/schema');
  (async () => {
    await initSchema();
    await runMigrations();
    await run({ dry: process.argv.includes('--dry') });
    process.exit(0);
  })().catch(err => { console.error(err); process.exit(1); });
}
