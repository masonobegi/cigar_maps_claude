const { checkStore } = require('../../server/src/jobs/linkCheck');
(async () => {
  for (const id of (process.env.IDS || '').split(',').map(Number).filter(Boolean)) {
    const r = await checkStore(id, { log: () => {} });
    console.log(`#${id} ${r.name} — ${r.website} -> ${r.status} ${r.final_url || ''}`);
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
