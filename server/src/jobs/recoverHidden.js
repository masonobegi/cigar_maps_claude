/**
 * Real cigar shops the classifier hid.
 *
 * The pure-cigar check hid 2,480 listings as "unproven" — not because anything
 * said they were not cigar shops, but because nothing said they were. That is
 * the right rule (rule 2: when in doubt, off the map), and it will have caught
 * real shops along with the rest. The audit put the number at "at least 75".
 *
 * This job goes looking for them, and the bar is the same one that hid them,
 * pointed the other way: a listing comes back only when something we can quote
 * says it is a cigar shop. Never a name, never a map category, never a hunch.
 * Four things count:
 *
 *   its own website says cigars, plainly and mostly (the pure-cigar check's own
 *     threshold, applied to evidence read after it ran, or to a page it could
 *     not read at the time and can now);
 *   its own website describes a walk-in humidor or a cigar lounge, in a
 *     sentence (the amenity crawl already keeps those sentences);
 *   a tobacco licence registry lists it, trading, at this address;
 *   it carries stock read from its own web shop.
 *
 * A listing that comes back keeps the note saying why, and the hide stays in
 * the edit log, so the decision can be read and undone.
 *
 *   node src/jobs/recoverHidden.js propose --out recover.json
 *   node src/jobs/recoverHidden.js apply   --from recover.json --confirm
 *   node src/jobs/recoverHidden.js selftest
 */
'use strict';

const fs = require('fs');
const path = require('path');

const { siteVerdict, nameVerdict } = require('./pureCigarCheck');

const SWEEPS = path.join(__dirname, '..', '..', '..', 'sweeps');

/** The verdicts this job is allowed to reverse. */
const RECOVERABLE = ['unproven'];

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  const out = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch {}
  }
  return out;
}

function readJson(file, fallback) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback;
}

/**
 * Everything we hold that could speak for a hidden listing, keyed by id.
 *
 * All of it was gathered by earlier sweeps and is sitting in the repository.
 * Nothing here fetches anything: a listing is recovered on evidence we already
 * paid for, or not at all.
 */
function gatherEvidence({ root = SWEEPS } = {}) {
  const byId = new Map();
  const put = (id, key, value) => {
    if (!byId.has(id)) byId.set(id, {});
    byId.get(id)[key] = value;
  };

  // The pure-cigar check's own word counts, including the browser-rendered pass
  // that ran afterwards and could read sites the first pass could not.
  for (const file of ['pure_evidence.jsonl', 'pure_evidence_all.jsonl', 'pure_evidence_rendered.jsonl']) {
    for (const e of readJsonl(path.join(root, 'decisions', file))) {
      const prev = byId.get(e.id)?.site;
      // A later read replaces an earlier one unless it failed where the earlier
      // worked: a rendered pass that timed out says nothing.
      if (!prev || (e.ok && !prev.ok) || (e.ok === prev.ok)) put(e.id, 'site', e);
    }
  }

  // The amenity crawl's sentences. A site that describes its own walk-in
  // humidor is a cigar shop, whatever its name says.
  for (const f of readJsonl(path.join(root, 'decisions', 'site-facts', 'facts.jsonl'))) {
    if (f.ok) put(f.id, 'facts', f);
  }

  return byId;
}

/**
 * Should this hidden listing come back? Pure, so the self-test can put the
 * cases through it without a database.
 *
 * Returns { recover: true, why, strength } or { recover: false, why }.
 */
function recoveryVerdict(listing, evidence = {}, { licence = null, stockLines = 0 } = {}) {
  // Only the classifier's own "unproven" verdict is reversible here. A listing
  // hidden as not_retail, online_only, closed, duplicate or moved was hidden
  // for a different reason, and this job has nothing to say about it.
  if (!RECOVERABLE.includes(listing.storefront)) {
    return { recover: false, why: `hidden as ${listing.storefront || 'nothing this job may reverse'}` };
  }
  if (Number(listing.claimed) === 1 || Number(listing.staff_edited) === 1) {
    return { recover: false, why: 'claimed or staff-edited: a sweep never argues with the shop or with staff' };
  }

  // 1. Stock read from its own web shop. Somebody is selling cigars there.
  if (stockLines > 0) {
    return { recover: true, strength: 'stock', why: `${stockLines} cigar lines read from its own web shop` };
  }

  // 2. A licence registry lists it, trading, at this address.
  if (licence && licence.verdict === 'verified') {
    return { recover: true, strength: 'licence', why: `a current tobacco licence at this address (${licence.how})` };
  }

  // 3. Its own site, by the pure-cigar check's own threshold. The check hid
  //    these listings on this same function; where the evidence now says
  //    "proven", the hide was simply premature.
  const site = evidence.site;
  if (site && site.ok) {
    const v = siteVerdict({ cigar: Number(site.cigar) || 0, other: Number(site.other) || 0 });
    if (v.proven) {
      return { recover: true, strength: 'website', why: v.why, rendered: !!site.rendered };
    }
  }

  // 4. A sentence on its own site describing a walk-in humidor or a lounge.
  //    Weaker than the word counts, because one sentence is one sentence — so
  //    it only counts when the site is readable and names the shop.
  const facts = evidence.facts;
  if (facts && facts.ok && facts.names_shop) {
    if (facts.walk_in) {
      return { recover: true, strength: 'humidor', why: `its own site describes a walk-in humidor: "${String(facts.walk_in).slice(0, 140)}"` };
    }
    if (facts.lounge && /cigar/i.test(facts.lounge)) {
      return { recover: true, strength: 'lounge', why: `its own site describes a cigar lounge: "${String(facts.lounge).slice(0, 140)}"` };
    }
  }

  // The name is deliberately last and deliberately not enough on its own — a
  // name is what put 2,480 listings in this pile in the first place. It is
  // recorded so a reviewer can see it, and nothing more.
  const byName = nameVerdict(listing.name);
  return {
    recover: false,
    why: site && !site.ok ? 'its site still cannot be read, and nothing else speaks for it'
      : site ? siteVerdict({ cigar: Number(site.cigar) || 0, other: Number(site.other) || 0 }).why
        : 'no evidence was ever gathered for this listing',
    name_would_say: byName || null,
  };
}

// ── propose ─────────────────────────────────────────────────────────────────

async function propose({ out, licences = null, log = console.log } = {}) {
  const db = require('../database/db');
  const evidence = gatherEvidence();

  const licenceByIndex = new Map();
  if (licences) {
    const l = readJson(licences, null);
    for (const v of (l && l.verified) || []) licenceByIndex.set(v.id, { verdict: 'verified', how: v.how });
  }

  const rows = await db.all(`
    SELECT s.id, s.name, s.city, s.state, s.website, s.website_status, s.store_type,
           s.storefront, s.storefront_reason, s.claimed, s.staff_edited, s.confidence,
      (SELECT COUNT(*) FROM inventory i JOIN cigars c ON c.id = i.cigar_id
        WHERE i.store_id = s.id AND c.source IS DISTINCT FROM 'retired')::int AS cigar_lines
    FROM stores s
    WHERE s.visible = 0 AND s.storefront = 'unproven'
    ORDER BY s.id`);

  const recover = [], leave = [];
  for (const r of rows) {
    const v = recoveryVerdict(r, evidence.get(r.id) || {}, {
      licence: licenceByIndex.get(r.id) || null,
      stockLines: Number(r.cigar_lines) || 0,
    });
    const row = {
      id: r.id, name: r.name, city: r.city, state: r.state, website: r.website,
      store_type: r.store_type, hidden_because: r.storefront_reason, why: v.why,
    };
    if (v.recover) recover.push({ ...row, strength: v.strength });
    else leave.push({ ...row, name_would_say: v.name_would_say || null });
  }

  const byStrength = {};
  for (const r of recover) byStrength[r.strength] = (byStrength[r.strength] || 0) + 1;
  log(`hidden as unproven: ${rows.length}`);
  log(`  would come back:  ${recover.length}`);
  for (const [k, n] of Object.entries(byStrength).sort((a, b) => b[1] - a[1])) log(`      ${String(n).padStart(4)}  on its ${k}`);
  log(`  stay hidden:      ${leave.length}`);
  const nameOnly = leave.filter(l => l.name_would_say).length;
  log(`      of those, ${nameOnly} have a name that sounds like a cigar shop and nothing behind it`);

  if (out) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify({
      note: 'Read every row. A listing here comes back onto the public map, and rule 2 says a listing we cannot show is a cigar shop stays off it. The "why" is what will be quoted if anyone asks.',
      generated_at: new Date().toISOString(),
      recover, leave_count: leave.length,
      // The ones a reviewer is most likely to want to argue about.
      name_only_examples: leave.filter(l => l.name_would_say).slice(0, 50),
    }, null, 1));
    log(`written to ${out}`);
  }
  return { recover, leave };
}

// ── apply ───────────────────────────────────────────────────────────────────

async function apply(file, { log = console.log } = {}) {
  const db = require('../database/db');
  const d = readJson(file, null);
  if (!d) { log(`no such file: ${file}`); return { restored: 0 }; }
  let restored = 0;
  for (const r of d.recover || []) {
    const res = await db.run(`
      UPDATE stores
      SET visible = 1, storefront = NULL,
          storefront_reason = ?, storefront_checked_at = NOW()
      WHERE id = ? AND visible = 0 AND storefront = 'unproven'
        AND COALESCE(claimed, 0) = 0 AND COALESCE(staff_edited, 0) = 0`,
    [`back on the map: ${String(r.why).slice(0, 400)}`, r.id]);
    if (res.changes) {
      await db.run(
        'INSERT INTO store_edits (store_id, field, before, after, source, job, reason) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [r.id, 'visible', '0', '1', 'rule', 'recoverHidden', String(r.why).slice(0, 500)]);
      restored++;
    }
  }
  log(`${restored} listings back on the public map, each with the reason recorded`);
  return { restored };
}

module.exports = { propose, apply, recoveryVerdict, gatherEvidence, RECOVERABLE };

// ── self-test ───────────────────────────────────────────────────────────────
function selftest() {
  let pass = 0, fail = 0;
  const ok = (cond, label, extra) => {
    if (cond) { pass++; console.log(`  ok   ${label}`); }
    else { fail++; console.log(`  FAIL ${label}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ''}`); }
  };

  const hidden = { id: 1, name: 'Tobacco Shop', storefront: 'unproven', claimed: 0, staff_edited: 0 };

  // Nothing speaks for it: it stays hidden. This is the default and it has to be.
  ok(!recoveryVerdict(hidden, {}).recover, 'a listing with no evidence stays hidden');
  ok(!recoveryVerdict(hidden, { site: { ok: false, cigar: 0, other: 0 } }).recover,
    'and so does one whose site still cannot be read');
  ok(!recoveryVerdict(hidden, { site: { ok: true, cigar: 0, other: 26 } }).recover,
    'and one whose site is mostly another trade');
  ok(!recoveryVerdict(hidden, { site: { ok: true, cigar: 2, other: 0 } }).recover,
    'two cigar words is not "plainly and mostly"');

  // The pure-cigar check's own threshold, pointed the other way.
  let v = recoveryVerdict(hidden, { site: { ok: true, cigar: 19, other: 0 } });
  ok(v.recover && v.strength === 'website', 'a site that is nearly all cigars brings it back', v);
  v = recoveryVerdict(hidden, { site: { ok: true, cigar: 5, other: 3 } });
  ok(v.recover, 'and so does the check\'s own five-against-three line', v);
  ok(!recoveryVerdict(hidden, { site: { ok: true, cigar: 5, other: 4 } }).recover,
    'but not one word past it — the bar is the same one that hid them');

  // Stock, licences and sentences.
  v = recoveryVerdict(hidden, {}, { stockLines: 12 });
  ok(v.recover && v.strength === 'stock', 'twelve cigar lines on its own web shop bring it back', v);
  v = recoveryVerdict(hidden, {}, { licence: { verdict: 'verified', how: 'the same telephone number' } });
  ok(v.recover && v.strength === 'licence', 'so does a current tobacco licence at the address', v);
  v = recoveryVerdict(hidden, { facts: { ok: true, names_shop: true, walk_in: 'Step into our walk-in humidor' } });
  ok(v.recover && v.strength === 'humidor' && /walk-in humidor/.test(v.why),
    'so does a site describing its own walk-in humidor, quoted', v);
  v = recoveryVerdict(hidden, { facts: { ok: true, names_shop: true, lounge: 'Our cigar lounge seats twenty' } });
  ok(v.recover && v.strength === 'lounge', 'and one describing a cigar lounge', v);
  ok(!recoveryVerdict(hidden, { facts: { ok: true, names_shop: false, walk_in: 'walk-in humidor' } }).recover,
    'but not when the site never names the shop — that sentence could be anyone\'s');
  ok(!recoveryVerdict(hidden, { facts: { ok: true, names_shop: true, lounge: 'comfortable seating throughout' } }).recover,
    'and not a lounge with no cigar in it: a lounge alone is not a cigar shop');

  // A name is never enough. It is what put 2,480 listings in the pile.
  const named = { ...hidden, name: 'Havana Cigar Emporium' };
  const nv = recoveryVerdict(named, {});
  ok(!nv.recover, 'a cigar-sounding name alone does not bring a listing back');
  ok(nv.name_would_say, 'though the reviewer is told the name would have said yes', nv.name_would_say);

  // Only the classifier's own verdict is reversible.
  for (const verdict of ['not_retail', 'online_only', 'closed', 'duplicate', 'moved']) {
    ok(!recoveryVerdict({ ...hidden, storefront: verdict }, { site: { ok: true, cigar: 40, other: 0 } }).recover,
      `a listing hidden as ${verdict} is not this job's to reverse`);
  }
  ok(recoveryVerdict({ ...hidden, storefront: 'unproven' }, { site: { ok: true, cigar: 40, other: 0 } }).recover,
    'only "unproven" is');

  // Claimed and staff-edited are untouchable, however good the evidence.
  ok(!recoveryVerdict({ ...hidden, claimed: 1 }, {}, { stockLines: 99 }).recover, 'a claimed listing is never touched');
  ok(!recoveryVerdict({ ...hidden, staff_edited: 1 }, {}, { stockLines: 99 }).recover, 'nor a staff-edited one');

  // The evidence reader, against the files that actually shipped.
  const ev = gatherEvidence();
  ok(ev.size > 1000, `the saved evidence covers ${ev.size} listings`, ev.size);
  const withSite = [...ev.values()].filter(e => e.site && e.site.ok).length;
  ok(withSite > 500, `${withSite} of them have a site that was read`, withSite);
  const proven = [...ev.entries()].filter(([, e]) => e.site && e.site.ok
    && siteVerdict({ cigar: Number(e.site.cigar) || 0, other: Number(e.site.other) || 0 }).proven).length;
  ok(proven > 0, `${proven} of the saved readings would prove a cigar shop on their own`, proven);

  console.log(`\nrecoverHidden self-test: ${pass} passed, ${fail} failed`);
  return fail;
}

if (require.main === module) main();

function main() {
  const argv = process.argv.slice(2);
  const arg = n => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : null; };
  if (argv[0] === 'selftest') { process.exit(selftest() ? 1 : 0); }
  (async () => {
    if (argv[0] === 'propose') await propose({ out: arg('--out'), licences: arg('--licences') });
    else if (argv[0] === 'apply' && argv.includes('--confirm')) await apply(arg('--from'));
    else console.error('usage: propose --out <file> [--licences <file>] | apply --from <file> --confirm | selftest');
    process.exit(0);
  })().catch(e => { console.error(e); process.exit(1); });
}
