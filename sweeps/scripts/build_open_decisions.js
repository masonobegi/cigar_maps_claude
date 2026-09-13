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

(async () => {
  const file = journalPath();
  console.log(`reading ${file}\n`);
  const { research, verify } = readJournal(file);
  const all = JSON.parse(fs.readFileSync(INPUT, 'utf8'));

  const decisions = all.map(row => {
    const r = research.get(row.id);
    const v = verify.get(row.id);
    const d = decide(r, v);
    return {
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
    };
  });

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
  console.log(`  unproven    ${String(by('unproven').length).padStart(4)}   (of which ${unverified} are "research said open, nothing checked it")`);

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
