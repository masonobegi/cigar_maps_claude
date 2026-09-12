// Offline harness: run the sweep's decision code against the saved listing
// snapshot instead of production. Exports outcomes per listing id.
const S = 'C:/Users/mason/AppData/Local/Temp/claude/c--Users-mason-OneDrive-Desktop-cigarApp/a956c8ab-bec6-4085-b83b-7fcd97853bc4/scratchpad';
const SRV = 'C:/Users/mason/OneDrive/Desktop/cigarApp/server/src';
const fs = require('fs');
const rows = JSON.parse(fs.readFileSync(`${S}/stores_snapshot.json`, 'utf8'));
require.cache[require.resolve(`${SRV}/database/db`)] = { exports: {
  all: async () => rows.filter(r => r.website), get: async () => null, run: async () => ({ changes: 0 }),
}, loaded: true };
const sweep = require(`${SRV}/jobs/hoursSweep`);
const { hostOf } = require(`${SRV}/jobs/chainCheck`);

function readJsonl(file) {
  const out = [];
  for (const line of fs.readFileSync(file, 'utf8').split(String.fromCharCode(10))) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch {}
  }
  return out;
}

/** Outcome per listing for one or more evidence files (later files win per id). */
function outcomes(evidenceFiles, chainFile) {
  const byId = new Map(rows.map(r => [r.id, r]));
  const perPage = new Map();
  const { addressKey } = require(`${SRV}/jobs/chainCheck`);
  const doors = new Map();
  for (const s of rows) if (s.website) { const k = sweep.pageKey(s.website); if (!doors.has(k)) doors.set(k, new Set()); doors.get(k).add(addressKey(s.address) || '#' + s.id); }
  for (const [k, d] of doors) perPage.set(k, d.size);
  const chainPages = new Map();
  if (chainFile) for (const p of readJsonl(chainFile)) {
    if (p.marker || !p.host) continue;
    if (!chainPages.has(p.host)) chainPages.set(p.host, []);
    chainPages.get(p.host).push(p);
  }
  const ev = new Map();
  for (const f of evidenceFiles) for (const e of readJsonl(f)) {
    const prev = ev.get(e.id);
    // A later read replaces an earlier one unless it failed where the earlier worked.
    if (!prev || e.ok || !prev.ok) ev.set(e.id, e);
  }
  const out = new Map();
  for (const [id, e] of ev) {
    const s = byId.get(id);
    if (!s || !s.website) continue;
    if (sweep.NOT_THE_SHOPS_SITE.test(hostOf(s.website)) || (e.url && sweep.NOT_THE_SHOPS_SITE.test(hostOf(e.url)))) { out.set(id, { skip: 'social' }); continue; }
    if (!e.ok && !chainPages.has(hostOf(s.website))) { out.set(id, { skip: 'site unreachable' }); continue; }
    let d = sweep.decide(e, s, perPage.get(sweep.pageKey(s.website)) || 1);
    if (d.skip && chainPages.has(hostOf(s.website))) {
      const c = sweep.decideChainListing(s, chainPages.get(hostOf(s.website)));
      d = c.hours ? c : { skip: `${d.skip}; ${c.skip}` };
    }
    out.set(id, d);
  }
  return { out, byId, ev };
}
module.exports = { rows, sweep, outcomes, readJsonl, S };
if (require.main === module) {
  const files = process.argv.slice(2).filter(a => !a.startsWith('--chains=')).map(f => `${S}/${f}`);
  const ch = process.argv.find(a => a.startsWith('--chains='));
  const { out } = outcomes(files, ch ? `${S}/${ch.slice(9)}` : null);
  const tally = {};
  for (const d of out.values()) { const k = d.hours ? `hours: ${d.kind}` : d.skip; tally[k] = (tally[k] || 0) + 1; }
  for (const [k, n] of Object.entries(tally).sort((a, b) => b[1] - a[1])) console.log(String(n).padStart(5), k);
  console.log([...out.values()].filter(d => d.hours).length, 'with hours');
}
