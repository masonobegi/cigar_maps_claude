const fs = require('fs');
const db = require('C:/Users/mason/OneDrive/Desktop/cigarApp/server/src/database/db');
const OUT = 'C:/Users/mason/AppData/Local/Temp/claude/c--Users-mason-OneDrive-Desktop-cigarApp/a956c8ab-bec6-4085-b83b-7fcd97853bc4/scratchpad/audit';
module.exports = (async () => {
  const out = {};
  for (const t of ['cigars', 'vitolas', 'inventory', 'store_reports', 'seed_meta', 'catalog_pending']) {
    try {
      const rows = await db.all(`SELECT * FROM ${t}`);
      for (const r of rows) for (const k of Object.keys(r)) if (typeof r[k] === 'string' && r[k].length > 2000) r[k] = r[k].startsWith('data:') ? null : r[k].slice(0, 2000);
      out[t] = rows;
    } catch (e) { out[t] = { error: e.message }; }
  }
  fs.writeFileSync(`${OUT}/tables.json`, JSON.stringify(out));
  console.log(Object.entries(out).map(([t, r]) => `${t}: ${Array.isArray(r) ? r.length : r.error}`).join(', '));
  process.exit(0);
})();
