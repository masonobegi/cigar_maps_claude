/**
 * Run the hours decision code against the saved crawl instead of production.
 *
 * This replaces the copy in this folder that pointed at absolute paths on the
 * machine that wrote it, and at a `stores_snapshot.json` that did not travel
 * with the handoff. The listing rows are rebuilt from two files that did:
 *
 *   evidence/hours_decisions_final.json  1,077 rows carrying name, address,
 *                                        city, state, url and the hours that
 *                                        were applied to production
 *   evidence/hours_verify*.json          174 more, the reviewed sample
 *
 * So this harness knows about roughly 1,250 of the ~4,000 listings with a
 * website, not all of them. That is enough to re-decide every listing whose
 * hours we publish, and to score against every reviewer verdict — which is what
 * task 5.5 asks for — but it is NOT enough to find listings that were skipped
 * before and would now be decided. Those need the real stores table.
 *
 *   node sweeps/scripts/hours_offline.js score      score against the verdicts
 *   node sweeps/scripts/hours_offline.js tally      what the rules decide now
 *   node sweeps/scripts/hours_offline.js diff --out <dir>   clear/replace files
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SRV = path.join(ROOT, 'server', 'src');
const EV = path.join(ROOT, 'sweeps', 'evidence');

// hoursSweep opens a database at require time. Nothing here queries one, so a
// stub keeps PGlite out of the way.
require.cache[require.resolve(path.join(SRV, 'database', 'db'))] = {
  id: require.resolve(path.join(SRV, 'database', 'db')),
  loaded: true,
  exports: {
    all: async () => [], get: async () => null, run: async () => ({ changes: 0 }),
    exec: async () => {}, pool: { query: async () => ({ rows: [] }) },
    asyncRoute: fn => fn,
  },
};

const sweep = require(path.join(SRV, 'jobs', 'hoursSweep'));
const { addressKey, hostOf } = require(path.join(SRV, 'jobs', 'chainCheck'));
const { parseTextHours } = require(path.join(SRV, 'utils', 'hoursParser'));

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  const out = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch {}
  }
  return out;
}

const j = f => JSON.parse(fs.readFileSync(path.join(EV, f), 'utf8'));

/** The listing rows, rebuilt. `applied` is what production was given. */
function storeRows() {
  const byId = new Map();
  const applied = new Map();
  for (const d of j('hours_decisions_final.json')) {
    if (!d.address) continue;
    byId.set(d.id, { id: d.id, name: d.name, address: d.address, city: d.city, state: d.state, website: d.url });
    applied.set(d.id, { hours: d.hours, kind: d.kind, lines: d.lines, url: d.url });
  }
  for (const f of ['hours_verify_compact.json', 'hours_verify2.json', 'hours_verify3.json']) {
    for (const s of j(f)) {
      if (!byId.has(s.id)) byId.set(s.id, { id: s.id, name: s.name, address: s.address, city: s.city, state: s.state, website: s.url });
    }
  }
  return { byId, applied };
}

/** The reviewed sample, as { id -> { verdict, correct_hours, sample } }. */
function verdicts() {
  const out = new Map();
  for (const [sampleFile, resultFile] of [
    ['hours_verify_compact.json', 'hours_verify_results.json'],
    ['hours_verify2.json', 'hours_verify2_results.json'],
    ['hours_verify3.json', 'hours_verify3_results.json'],
  ]) {
    const sample = new Map(j(sampleFile).map(s => [s.id, s]));
    for (const v of j(resultFile)) out.set(v.id, { ...v, sample: sample.get(v.id) });
  }
  return out;
}

/** Evidence per listing: the later read wins, unless it failed where the earlier worked. */
function evidence() {
  const ev = new Map();
  for (const f of ['hours_evidence.jsonl', 'hours_evidence_v2.jsonl', 'render_full.jsonl', 'render_full_b.jsonl']) {
    for (const e of readJsonl(path.join(EV, f))) {
      const prev = ev.get(e.id);
      if (!prev || e.ok || !prev.ok) ev.set(e.id, e);
    }
  }
  return ev;
}

/** Chain locator pages, keyed by host. */
function chainPages() {
  const out = new Map();
  for (const f of ['chain_evidence.jsonl', 'chain_evidence_wpsl.jsonl']) {
    for (const p of readJsonl(path.join(EV, f))) {
      if (p.marker || !p.host) continue;
      if (!out.has(p.host)) out.set(p.host, []);
      out.get(p.host).push(p);
    }
  }
  return out;
}

/** What the rules decide today, for every listing we have a row and evidence for. */
function decideAll() {
  const { byId, applied } = storeRows();
  const ev = evidence();
  const chains = chainPages();

  // How many distinct doors share each website. Only the rows this harness
  // knows about are counted, so a chain with listings outside the set looks
  // smaller than it is — noted here rather than papered over.
  const doors = new Map();
  for (const s of byId.values()) {
    if (!s.website) continue;
    const k = sweep.pageKey(s.website);
    if (!doors.has(k)) doors.set(k, new Set());
    doors.get(k).add(addressKey(s.address) || `#${s.id}`);
  }

  const out = new Map();
  for (const [id, s] of byId) {
    const e = ev.get(id);
    if (!s.website) { out.set(id, { skip: 'no website' }); continue; }
    if (sweep.NOT_THE_SHOPS_SITE.test(hostOf(s.website)) || (e && e.url && sweep.NOT_THE_SHOPS_SITE.test(hostOf(e.url)))) {
      out.set(id, { skip: 'social' }); continue;
    }
    if (!e) { out.set(id, { skip: 'no evidence saved' }); continue; }
    if (!e.ok && !chains.has(hostOf(s.website))) { out.set(id, { skip: 'site unreachable' }); continue; }
    let d = sweep.decide(e, s, doors.get(sweep.pageKey(s.website))?.size || 1);
    if (d.skip && chains.has(hostOf(s.website))) {
      const c = sweep.decideChainListing(s, chains.get(hostOf(s.website)));
      d = c.hours ? c : { skip: `${d.skip}; ${c.skip}` };
    }
    out.set(id, d);
  }
  return { out, byId, applied, ev };
}

/**
 * Score against every reviewer verdict.
 *
 * A decision is right when the reviewer called the old one correct and we still
 * say the same thing, or when the reviewer wrote out the true hours and every
 * day we state agrees with them. Declining to decide is not scored as right —
 * it is reported separately, because refusing everything would otherwise look
 * like perfect accuracy.
 */
function score(log = console.log) {
  const { out } = decideAll();
  const vs = verdicts();
  let decided = 0, right = 0, skippedRight = 0, skippedWrong = 0;
  const wrong = [];
  for (const [id, v] of vs) {
    if (v.verdict === 'cannot_verify') continue;
    const d = out.get(id);
    if (!d || !d.hours) {
      if (v.verdict === 'correct') skippedRight++; else skippedWrong++;
      continue;
    }
    decided++;
    let ok = v.verdict === 'correct' && v.sample && JSON.stringify(d.hours) === JSON.stringify(v.sample.hours);
    if (!ok && v.correct_hours) {
      const truth = (parseTextHours([v.correct_hours.replace(/\(.*?\)/g, '')]) || {}).hours || {};
      ok = Object.keys(truth).length > 0
        && Object.entries(d.hours).some(([day]) => truth[day])
        && Object.entries(d.hours).every(([day, h]) => !truth[day] || truth[day] === h);
    }
    if (ok) right++;
    else wrong.push(`#${id} [${v.verdict}] ${d.kind} ${JSON.stringify(d.hours)} | truth: ${v.correct_hours || '(none)'}`);
  }
  const accuracy = decided ? right / decided : 0;
  log(`verified listings we still decide: ${decided}; right ${right} (${(100 * accuracy).toFixed(1)}%)`);
  log(`now skipped: ${skippedWrong} that were wrong (good), ${skippedRight} that were right (coverage lost)`);
  for (const w of wrong) log('  ' + w);
  log(`${[...out.values()].filter(d => d.hours).length} listings with hours overall`);
  return { decided, right, accuracy, skippedRight, skippedWrong, wrong };
}

function tally(log = console.log) {
  const { out } = decideAll();
  const counts = {};
  for (const d of out.values()) {
    const k = d.hours ? `hours: ${d.kind}` : d.skip;
    counts[k] = (counts[k] || 0) + 1;
  }
  for (const [k, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) log(String(n).padStart(5), k);
  log(`${[...out.values()].filter(d => d.hours).length} with hours`);
  return counts;
}

/**
 * What the tightened rules would change about the hours production publishes.
 *
 * Two files, as the work order asks for:
 *   hours_clear.json    schedules to take down: the rules no longer stand
 *                       behind them, and nothing replaces them
 *   hours_replace.json  schedules to overwrite: the rules now read the same
 *                       evidence differently
 *
 * Both carry the lines the old and new readings rest on, because reading them
 * by hand is the work.
 */
function diff({ outDir, log = console.log } = {}) {
  const { out, byId, applied } = decideAll();
  const clear = [], replace = [], unchanged = [], hold = [], chainRows = [];

  // A site that did not answer on the day of the crawl says nothing about the
  // hours we already read off it. Clearing those would take schedules down for
  // a server hiccup, so they are held, not cleared.
  const NO_FRESH_READING = /^(site unreachable|no evidence saved)/;

  for (const [id, was] of applied) {
    const s = byId.get(id);
    const now = out.get(id);
    if (!was.hours) continue;
    const row = {
      id, name: s.name, city: s.city, state: s.state, website: s.website,
      was: was.hours, was_kind: was.kind, was_lines: was.lines || null,
    };
    if (!now || !now.hours) {
      const why = (now && now.skip) || 'no evidence saved for this listing';
      (NO_FRESH_READING.test(why) ? hold : clear).push({ ...row, why });
    } else if (JSON.stringify(now.hours) !== JSON.stringify(was.hours)) {
      const entry = { ...row, now: now.hours, now_kind: now.kind, now_lines: now.lines || null };
      // This harness only knows the ~1,250 listings the saved files name, so it
      // undercounts how many doors share a website. A chain listing therefore
      // looks like a single-shop site here, and decide() hands every branch the
      // same page's hours — six Spring Street Cigars branches came out
      // identical. That is the harness being wrong, not the rules, so these are
      // kept apart and must be re-run against the real stores table.
      (/chain/.test(was.kind || '') || /chain/.test(now.kind || '') ? chainRows : replace).push(entry);
    } else {
      unchanged.push(id);
    }
  }

  const byReason = {};
  for (const c of clear) byReason[c.why] = (byReason[c.why] || 0) + 1;
  log(`hours production publishes today (in this harness): ${applied.size}`);
  log(`  unchanged: ${unchanged.length}`);
  log(`  to clear:  ${clear.length}`);
  for (const [k, n] of Object.entries(byReason).sort((a, b) => b[1] - a[1])) log(`      ${String(n).padStart(4)}  ${k}`);
  log(`  to replace: ${replace.length}`);
  log(`  chain listings, needing the real sibling counts: ${chainRows.length}`);
  log(`  held (the site did not answer; the hours we hold still stand): ${hold.length}`);

  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'hours_clear.json'), JSON.stringify({
      note: 'Schedules the tightened rules no longer stand behind. Read every row: a cleared schedule means a listing shows no hours at all, which is better than wrong hours but worse than right ones.',
      generated_at: new Date().toISOString(), count: clear.length, rows: clear,
    }, null, 1));
    fs.writeFileSync(path.join(outDir, 'hours_replace.json'), JSON.stringify({
      note: 'Schedules the tightened rules read differently from the same saved evidence. was_lines and now_lines are what each reading rests on.',
      generated_at: new Date().toISOString(), count: replace.length, rows: replace,
    }, null, 1));
    fs.writeFileSync(path.join(outDir, 'hours_chain_rerun.json'), JSON.stringify({
      note: 'NOT a decision file. This harness undercounts how many listings share a website, so decide() treats a chain site as a single shop and hands every branch one page\'s hours. Re-run these against the real stores table before touching anything.',
      generated_at: new Date().toISOString(), count: chainRows.length, rows: chainRows,
    }, null, 1));
    fs.writeFileSync(path.join(outDir, 'hours_hold.json'), JSON.stringify({
      note: 'Listings whose site did not answer when the crawl ran. Nothing to do: the hours we already hold still stand. Here so that nobody mistakes them for refusals.',
      generated_at: new Date().toISOString(), count: hold.length, rows: hold,
    }, null, 1));
    log(`written to ${outDir}`);
  }
  return { clear, replace, unchanged, hold, chainRows };
}

/**
 * Listings we publish no hours for, whose saved evidence holds a readable
 * three-day block. The work order counts 405 of these.
 *
 * This is NOT a decision file and cannot be made into one here. The two checks
 * that matter — does the site name this shop, and are these hours printed
 * beside THIS listing's door — both need the listing's name, address and city,
 * and the handoff's saved files carry those only for listings that already have
 * hours. What this produces is the candidate list with the lines quoted, so the
 * next session can join it to the stores table and run decide() properly.
 */
function recover({ out: outFile, log = console.log } = {}) {
  const { describe } = require(path.join(SRV, 'utils', 'hoursParser'));
  const skips = new Map(j('hours_skips_final.json').map(r => [r.id, r.skip]));
  const { applied } = storeRows();
  const ev = evidence();
  const rows = [];

  for (const [id, skip] of skips) {
    if (applied.has(id)) continue;                    // already publishing hours
    const e = ev.get(id);
    if (!e || !e.ok) continue;
    let best = null;
    for (const block of e.text || []) {
      const lines = block.lines || [];
      if (!lines.length) continue;
      const r = parseTextHours(lines);
      if (!r || r.conflicts) continue;
      const d = describe(r.hours);
      if (d.days < 3 || !d.open) continue;
      if (!best || describe(best.hours).days < d.days) {
        best = { hours: r.hours, url: block.url, lines: lines.slice(0, 20) };
      }
    }
    if (best) {
      // Most of these were skipped for a reason that still stands. A chain page
      // whose hours are not tied to an address, or a site that never names this
      // shop, holds a perfectly readable block that belongs to somebody else —
      // reading it is exactly the mistake the sweep exists to prevent. Only a
      // listing skipped because nothing was found, on a site that is this
      // shop's, is a real recovery.
      const standingRefusal = /never names this shop|chain site|different hours in different places/.test(skip);
      rows.push({ id, skipped_because: skip, standing_refusal: standingRefusal, ...best });
    }
  }

  const byReason = {};
  for (const r of rows) byReason[r.skipped_because] = (byReason[r.skipped_because] || 0) + 1;
  const real = rows.filter(r => !r.standing_refusal);
  log(`listings with no hours whose saved pages hold a readable block: ${rows.length}`);
  log(`  of those, ${real.length} were skipped only because nothing was found — the rest were refused for reasons that still stand`);
  for (const [k, n] of Object.entries(byReason).sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    log(`  ${String(n).padStart(4)}  was skipped: ${k}`);
  }
  if (outFile) {
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, JSON.stringify({
      note: 'CANDIDATES, NOT DECISIONS. A readable three-day block was found on a page already in the evidence, but the two checks that matter — does the site name this shop, and are these hours printed beside this listing\'s own door — need the listing\'s name, address and city, which the saved files do not carry for listings that have no hours. Join to the stores table and run hoursSweep.decide() before applying anything.',
      warning: 'standing_refusal: true means the listing was skipped for a reason that still holds — a chain page whose hours are tied to no address, or a site that never names this shop. Those blocks are readable and belong to somebody else. Start with the standing_refusal: false rows.',
      generated_at: new Date().toISOString(), count: rows.length,
      recoverable: rows.filter(r => !r.standing_refusal).length, rows,
    }, null, 1));
    log(`written to ${outFile}`);
  }
  return rows;
}

module.exports = { decideAll, score, tally, diff, recover, storeRows, verdicts, evidence, chainPages, readJsonl };

if (require.main === module) {
  const cmd = process.argv[2] || 'score';
  const arg = n => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
  if (cmd === 'score') score();
  else if (cmd === 'tally') tally();
  else if (cmd === 'diff') diff({ outDir: arg('--out') });
  else if (cmd === 'recover') recover({ out: arg('--out') });
  else console.error('usage: score | tally | diff --out <dir> | recover --out <file>');
}
