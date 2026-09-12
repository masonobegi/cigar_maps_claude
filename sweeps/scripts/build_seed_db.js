// Build a local PGlite copy of production (from today's read-only snapshot)
// for dry runs. Usage: PGLITE_DIR=<empty dir> node build_seed_db.js
process.chdir('C:/Users/mason/OneDrive/Desktop/cigarApp/server');
const fs = require('fs');
const SRV = 'C:/Users/mason/OneDrive/Desktop/cigarApp/server/src';
const A = 'C:/Users/mason/AppData/Local/Temp/claude/c--Users-mason-OneDrive-Desktop-cigarApp/a956c8ab-bec6-4085-b83b-7fcd97853bc4/scratchpad/audit';
const db = require(`${SRV}/database/db`);
const { initSchema, runMigrations } = require(`${SRV}/database/schema`);
async function load(table, rows) {
  if (!rows.length) return 0;
  const cols = (await db.all(`SELECT column_name FROM information_schema.columns WHERE table_name = ?`, [table])).map(r => r.column_name);
  const use = cols.filter(c => c in rows[0]);
  const list = use.map(c => `"${c}"`).join(', ');
  let n = 0;
  for (let i = 0; i < rows.length; i += 2000) {
    const batch = rows.slice(i, i + 2000).map(r => { const o = {}; for (const c of use) o[c] = r[c]; return o; });
    await db.run(`INSERT INTO ${table} (${list}) SELECT ${list} FROM json_populate_recordset(NULL::${table}, ?::json)`, [JSON.stringify(batch)]);
    n += batch.length;
  }
  if (use.includes('id')) await db.run(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), (SELECT COALESCE(MAX(id), 1) FROM ${table}))`);
  return n;
}
(async () => {
  await initSchema();
  await runMigrations();
  // An empty copy: drop anything the seed step inserted.
  for (const t of ['inventory', 'vitolas', 'store_reports', 'catalog_pending', 'stores', 'cigars']) await db.run(`DELETE FROM ${t}`).catch(() => {});
  const stores = JSON.parse(fs.readFileSync(`${A}/stores.json`, 'utf8'));
  for (const s of stores) s.user_id = null;
  const t = JSON.parse(fs.readFileSync(`${A}/tables.json`, 'utf8'));
  console.log('stores', await load('stores', stores));
  console.log('cigars', await load('cigars', t.cigars));
  console.log('vitolas', await load('vitolas', t.vitolas));
  console.log('inventory', await load('inventory', t.inventory));
  console.log('store_reports', await load('store_reports', t.store_reports.map(r => ({ ...r, user_id: null }))));
  console.log('catalog_pending', await load('catalog_pending', t.catalog_pending));
  const c = await db.get('SELECT COUNT(*)::int AS n, SUM(visible)::int AS pub FROM stores');
  console.log(`seed database ready: ${c.n} listings, ${c.pub} public`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
