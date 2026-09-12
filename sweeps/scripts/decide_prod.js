// Re-decide hours against the production stores table, where the count of
// doors sharing a website is real. The offline harness knows a third of the
// listings, so it called six Spring Street branches one shop.
const path = require('path');
const { decideAll } = require('../../server/src/jobs/hoursSweep');
const E = path.join(__dirname, '..', 'evidence');
const D = path.join(__dirname, '..', 'decisions', 'hours');
(async () => {
  await decideAll({
    from: [path.join(E, 'hours_evidence.jsonl'), path.join(E, 'hours_evidence_v2.jsonl'),
           path.join(E, 'render_full.jsonl'), path.join(E, 'render_full_b.jsonl')].join(','),
    chains: path.join(E, 'chain_evidence.jsonl'),
    out: path.join(D, 'prod_decisions.json'),
    skipsOut: path.join(D, 'prod_skips.json'),
  });
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
