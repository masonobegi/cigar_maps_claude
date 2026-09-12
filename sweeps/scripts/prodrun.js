/**
 * Run a job's own command line against production.
 *
 * prod.js requires its target, so a job's `require.main === module` block never
 * fires and its subcommands (collect / decide / apply) are unreachable. This
 * starts the job as a real child process instead, with the one change that
 * matters: DATABASE_URL pointed at the public proxy so it resolves from a
 * developer machine. Railway still injects the credentials; nothing is read out
 * of `railway variables`.
 *
 *   railway run --service Postgres node sweeps/scripts/prodrun.js src/jobs/linkCheck.js --limit 50
 */
const path = require('path');
const { spawn } = require('child_process');

const env = { ...process.env };
if (!env.DATABASE_URL || env.DATABASE_URL.includes('.railway.internal')) {
  if (env.DATABASE_PUBLIC_URL) env.DATABASE_URL = env.DATABASE_PUBLIC_URL;
}
if (!env.DATABASE_URL) { console.error('no database url in env'); process.exit(1); }

const server = path.join(__dirname, '..', '..', 'server');
const [job, ...args] = process.argv.slice(2);
if (!job) { console.error('usage: prodrun.js <job path, relative to server/> [args...]'); process.exit(2); }

const child = spawn(process.execPath, [path.resolve(server, job), ...args], { cwd: server, env, stdio: 'inherit' });
child.on('exit', code => process.exit(code == null ? 1 : code));
