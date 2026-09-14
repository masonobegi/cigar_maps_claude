/**
 * Turn a research run's journal into a list somebody can read and approve.
 *
 * The workflow writes one `result` entry per agent into journal.jsonl. Two
 * shapes appear there: research results (status / isCigarShop / evidence) and
 * verify results (refuted / why). This merges them per listing, applies the
 * rule, and writes the decisions file that sweeps/scripts/apply_open_sweep.js
 * consumes.
 *
 * Read the journal rather than the workflow's return value: 672 records do not
 * survive being passed back through a tool result, and a truncated list is a
 * list somebody will approve without having seen all of.
 *
 * THE RULE, which is the owner's and not negotiable here:
 *
 *   keep        research says open AND a cigar shop, AND verification did not
 *               refute it
 *   closed      research found it shut
 *   not_retail  research found it is not a cigar shop under the scope rule
 *   unproven    everything else — including a listing nothing disproved
 *
 * That last line is the whole point. "Nothing says it closed" is not evidence
 * that a shop is open, and reading it as evidence is how a shop that had been
 * shut for six months stayed on the public map.
 *
 *   RUN=<run id>  node sweeps/scripts/build_open_decisions.js
 *   JOURNAL=<path to journal.jsonl>  node sweeps/scripts/build_open_decisions.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'decisions', 'open_sweep_decisions.json');
const INPUT = path.join(__dirname, '..', 'decisions', 'research_input.json');

function journalPath() {
  if (process.env.JOURNAL) return process.env.JOURNAL;
  const base = path.join(process.env.USERPROFILE || process.env.HOME, '.claude', 'projects');
  const run = process.env.RUN;
  if (!run) {
    console.error('set RUN=<run id> or JOURNAL=<path to journal.jsonl>');
    process.exit(1);
  }
  // Find it wherever the session directory happens to be.
  const stack = [base];
  while (stack.length) {
    const dir = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === run) {
          const j = path.join(full, 'journal.jsonl');
          if (fs.existsSync(j)) return j;
        }
        stack.push(full);
      }
    }
  }
  console.error(`could not find a journal for run ${run}`);
  process.exit(1);
}

function readJournal(file) {
  const research = new Map();
  const verify = new Map();
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let j;
    try { j = JSON.parse(line); } catch { continue; }
    if (j.type !== 'result' || !j.result || !Array.isArray(j.result.shops)) continue;
    for (const s of j.result.shops) {
      if (typeof s.id !== 'number') continue;
      if (s.status) research.set(s.id, s);
      else if (typeof s.refuted === 'boolean') verify.set(s.id, s);
    }
  }
  return { research, verify };
}

/**
 * The second, harder pass over the listings the first could not settle.
 *
 * Its verdicts beat the first pass's for one reason only: it opened the actual
 * listing pages instead of reading search snippets, so where it says 'open' it
 * has a date attached — the day of a review, a post or an event — and a date is
 * the thing the first pass never had.
 *
 * DEEPEN=<path to journal.jsonl> to point at it.
 */
function deepPass() {
  const f = process.env.DEEPEN;
  if (!f || !fs.existsSync(f)) return new Map();
  const out = new Map();
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let j;
    try { j = JSON.parse(line); } catch { continue; }
    if (j.type !== 'result' || !j.result || !Array.isArray(j.result.shops)) continue;
    for (const s of j.result.shops) if (typeof s.id === 'number' && s.status) out.set(s.id, s);
  }
  return out;
}

/** How old a YYYY-MM or YYYY-MM-DD signal is, in days. Null if unparseable. */
function ageOfDays(iso, now) {
  if (!iso) return null;
  const t = String(iso).trim();
  const d = /^\d{4}-\d{2}$/.test(t) ? new Date(`${t}-01T00:00:00Z`) : new Date(t);
  if (isNaN(d.getTime())) return null;
  return Math.round((now - d) / 86400000);
}

/** One listing's verdict, and the sentence explaining it. */
function decide(r, v) {
  if (!r) return { decision: 'unproven', reason: 'no research result for this listing' };
  if (r.status === 'closed') {
    return { decision: 'closed', reason: r.evidence || 'research found it closed' };
  }
  if (r.isCigarShop === 'no') {
    return { decision: 'not_retail', reason: `${r.shopKind || 'not a cigar shop'} — ${r.evidence || ''}`.trim() };
  }
  if (r.status !== 'open' || r.isCigarShop !== 'yes') {
    return {
      decision: 'unproven',
      reason: `status ${r.status}, cigar shop ${r.isCigarShop}: ${r.evidence || 'no positive evidence found'}`,
    };
  }
  if (v && v.refuted) {
    return { decision: 'unproven', reason: `refuted on a second look: ${v.why || ''}`.trim() };
  }
  if (!v) {
    // Research said open, nothing checked it. Under guilty-until-proven-innocent
    // an unverified claim is not a proven one — but it is worth separating from
    // a listing research itself could not settle, so it can be re-verified
    // rather than dropped on a technicality.
    return { decision: 'unproven', reason: `research says open but no verification ran: ${r.evidence || ''}`.trim(), needsVerify: true };
  }
  return { decision: 'keep', reason: v.why || r.evidence || 'confirmed open and in scope' };
}

/**
 * Decisions made by hand, which beat the researched verdict.
 *
 * Research answers one question — is this shop open and in scope — and there are
 * things it cannot see. Two listings can both be genuinely open and genuinely
 * cigar shops and still be the same shop entered twice, at which case both come
 * back 'keep' and the directory shows it twice. Those are settled by looking at
 * the rows, and recorded here so they ride in the same list for approval.
 */
function overrides() {
  const f = path.join(__dirname, '..', 'decisions', 'open_sweep_overrides.json');
  if (!fs.existsSync(f)) return new Map();
  const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
  const list = Array.isArray(raw) ? raw : raw.overrides || [];
  return new Map(list.map(o => [o.id, o]));
}

/**
 * What the state licence registries say about each listing, as a second,
 * independent source.
 *
 * It answers a different question from the research and is worth carrying
 * beside it rather than folded into it: a licence is issued to a door, not to a
 * shop. A match means a licensed tobacco retailer trades at that address — not
 * that this listing is the one doing it. So it corroborates, and it never
 * decides on its own.
 *
 * Where it earns its place is the `renamed` verdict: when the current licence
 * at a cigar lounge's door reads "Friendship Wine & Liquor" or "Toke Shack
 * LLC", that is the registry saying somebody else is in the building.
 */
function licences() {
  const f = path.join(__dirname, '..', 'decisions', 'licences_all.json');
  if (!fs.existsSync(f)) return new Map();
  const d = JSON.parse(fs.readFileSync(f, 'utf8'));
  const out = new Map();
  for (const kind of ['verified', 'renamed', 'moved', 'lapsed']) {
    for (const r of d[kind] || []) {
      out.set(r.id, {
        licenceVerdict: kind,
        licenceWhy: r.why,
        licenceName: r.licence ? r.licence.name : null,
        licenceRegistry: r.licence ? r.licence.registry : null,
      });
    }
  }
  return out;
}

(async () => {
  const file = journalPath();
  console.log(`reading ${file}\n`);
  const { research, verify } = readJournal(file);
  const all = JSON.parse(fs.readFileSync(INPUT, 'utf8'));
  const manual = overrides();
  const lic = licences();
  if (manual.size) console.log(`${manual.size} decisions made by hand will override research`);
  if (lic.size) console.log(`${lic.size} listings have something from a state licence registry`);
  if (manual.size || lic.size) console.log();

  const deep = deepPass();
  if (deep.size) console.log(`${deep.size} listings were put through the deeper second pass\n`);
  // Fixed rather than read from the clock, so rebuilding the file twice cannot
  // produce two different answers for the same evidence.
  const NOW = new Date(process.env.AS_OF || '2026-09-13T00:00:00Z');
  /** A dated signal this recent is a trading business, on its own. */
  const FRESH_DAYS = 250;
  /**
   * And this recent when a second, independent source agrees.
   *
   * 250 days is a reasonable bar and it decided 97 of the 104 unsettled
   * listings correctly. But it was deciding seven of them on a cliff edge —
   * Old Havana Cigar Shop failed it by a single day — and a one-day difference
   * is not a judgement, it is an artifact of where the line happens to sit.
   *
   * Widening the bar for everything would just move the cliff. What actually
   * distinguishes these cases is corroboration: a customer review is a person
   * who physically went to the shop, and a current state tobacco licence is the
   * state saying that door is licensed right now. Those are independent of each
   * other and of us. Where both agree, a signal up to a year old is enough.
   *
   * Where there is no second source — a lapsed licence, or a state with no
   * registry — the shorter bar stands, and a lone review eight months old does
   * not make a listing public.
   */
  const FRESH_DAYS_CORROBORATED = 365;

  const decisions = all.map(row => {
    const r = research.get(row.id);
    const v = verify.get(row.id);
    const m = manual.get(row.id);
    const dp = deep.get(row.id);
    let d = m ? { decision: m.decision, reason: m.reason, byHand: true } : decide(r, v);

    // The deeper pass only ever speaks about listings the first could not
    // settle, and only overrides an 'unproven' verdict — never a 'closed', a
    // 'not_retail' or a decision made by hand.
    if (dp && !m && d.decision === 'unproven') {
      const age = ageOfDays(dp.newestSignalDate, NOW);
      if (dp.status === 'closed') {
        d = { decision: 'closed', reason: `on a second look: ${dp.evidence || ''}`.trim(), fromDeepPass: true };
      } else if (dp.isCigarShop === 'no') {
        d = { decision: 'not_retail', reason: `on a second look: ${dp.shopKind || ''} — ${dp.evidence || ''}`.trim(), fromDeepPass: true };
      } else if (dp.status === 'open' && age !== null && dp.isCigarShop === 'yes'
        && (age <= FRESH_DAYS
          || (age <= FRESH_DAYS_CORROBORATED && (lic.get(row.id) || {}).licenceVerdict === 'verified'))) {
        // This is the only route by which a listing the first pass could not
        // settle becomes public again, and it requires a date.
        d = {
          decision: 'keep',
          reason: `${dp.newestSignalWhat || 'a dated signal'} dated ${dp.newestSignalDate} (${age} days old)${age > FRESH_DAYS ? ', and a current state licence at the same door' : ''}: ${dp.evidence || ''}`.trim(),
          fromDeepPass: true,
        };
      } else {
        d = {
          decision: 'unproven',
          reason: dp.status === 'open' && age === null
            ? `a second look found no datable evidence: ${dp.evidence || ''}`.trim()
            : `still unsettled after a second look${age !== null ? `, newest signal ${dp.newestSignalDate} is ${age} days old` : ''}: ${dp.evidence || ''}`.trim(),
          fromDeepPass: true,
        };
      }
    }
    return {
      ...(d.byHand ? { byHand: true } : {}),
      id: row.id,
      name: row.name,
      where: row.address,
      website: row.website,
      decision: d.decision,
      reason: d.reason,
      ...(d.needsVerify ? { needsVerify: true } : {}),
      status: r ? r.status : null,
      isCigarShop: r ? r.isCigarShop : null,
      shopKind: r ? r.shopKind : null,
      confidence: r ? r.confidence : null,
      evidence: r ? r.evidence : null,
      sources: r ? r.sources : null,
      refuted: v ? v.refuted : null,
      verifyWhy: v ? v.why : null,
      ...(lic.get(row.id) || {}),
      ...(dp ? {
        deepStatus: dp.status,
        deepIsCigarShop: dp.isCigarShop,
        deepSignalDate: dp.newestSignalDate || null,
        deepSignalWhat: dp.newestSignalWhat || null,
        deepEvidence: dp.evidence || null,
        deepSources: dp.sources || null,
      } : {}),
      ...(d.fromDeepPass ? { fromDeepPass: true } : {}),
    };
  });

  // Where the two sources disagree, say so out loud rather than letting one
  // quietly win. A listing the research could not settle but whose door holds a
  // current licence is the most useful row in the file: it is the one a second,
  // harder look is most likely to resolve.
  const corroborated = decisions.filter(d => d.decision !== 'keep' && d.licenceVerdict === 'verified');
  const contradicted = decisions.filter(d => d.decision === 'keep' && d.licenceVerdict === 'renamed');

  const by = k => decisions.filter(d => d.decision === k);
  const unresearched = decisions.filter(d => !d.status).length;
  const unverified = decisions.filter(d => d.needsVerify).length;

  console.log(`${all.length} listings`);
  console.log(`  researched      ${all.length - unresearched}`);
  console.log(`  not researched  ${unresearched}`);
  console.log(`  verified        ${verify.size}`);
  console.log(`\nverdicts:`);
  console.log(`  keep        ${String(by('keep').length).padStart(4)}`);
  console.log(`  closed      ${String(by('closed').length).padStart(4)}`);
  console.log(`  not_retail  ${String(by('not_retail').length).padStart(4)}`);
  console.log(`  duplicate   ${String(by('duplicate').length).padStart(4)}`);
  console.log(`  unproven    ${String(by('unproven').length).padStart(4)}   (of which ${unverified} are "research said open, nothing checked it")`);

  if (corroborated.length || contradicted.length) {
    console.log(`\nwhere the registry and the research disagree:`);
    console.log(`  would drop, but the door holds a current licence   ${corroborated.length}`);
    console.log(`  would keep, but the licence is in another name     ${contradicted.length}`);
    for (const d of contradicted.slice(0, 10)) {
      console.log(`    #${String(d.id).padEnd(6)} ${String(d.name).slice(0, 28).padEnd(28)} licence reads "${String(d.licenceName).slice(0, 30)}"`);
    }
  }

  fs.writeFileSync(OUT, JSON.stringify({
    approved: false,
    note: 'Set approved: true only after reading the drop list. apply_open_sweep.js refuses to write without it.',
    builtFrom: file,
    counts: {
      total: all.length,
      keep: by('keep').length,
      closed: by('closed').length,
      not_retail: by('not_retail').length,
      unproven: by('unproven').length,
      unresearched,
      unverified,
    },
    decisions,
  }, null, 2));

  console.log(`\nwritten to ${OUT} with approved: false`);
  if (unresearched) console.log(`NOTE: ${unresearched} listings have no research result — they would be dropped as unproven. Finish the run first.`);
  process.exit(0);
})();
