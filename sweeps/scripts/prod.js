// Runs a job against production. Railway injects the credentials; we only
// point DATABASE_URL at the public proxy so it resolves from this machine.
if (!process.env.DATABASE_URL || process.env.DATABASE_URL.includes('.railway.internal')) {
  if (process.env.DATABASE_PUBLIC_URL) process.env.DATABASE_URL = process.env.DATABASE_PUBLIC_URL;
}
if (!process.env.DATABASE_URL) { console.error('no database url in env'); process.exit(1); }
process.chdir('C:/Users/mason/OneDrive/Desktop/cigarApp/server');
const target = process.argv[2];
(async () => {
  const { initSchema, runMigrations } = require('C:/Users/mason/OneDrive/Desktop/cigarApp/server/src/database/schema');
  await initSchema();
  await runMigrations();
  await require(target);
})().catch(e => { console.error(e); process.exit(1); });
