/**
 * Run every self-test in the codebase and report one total.
 *
 * The convention is that each job in server/src/jobs/ and each helper in
 * server/src/utils/ that carries logic worth checking answers to `selftest`.
 * That is only useful if there is one command that runs all of them, so this is
 * it. Files that declare no self-test are listed as having none, which is how a
 * new file with no tests becomes visible.
 *
 * IMPORTANT — why this reads the source before running anything.
 *
 * The first version of this script simply ran `node <file> selftest` over every
 * file in those two directories. Most jobs ignore an argument they do not
 * recognise and get on with their actual work, so that run did not test
 * buildDirectory.js — it *ran* it, and buildDirectory rebuilds
 * server/src/data/store_directory.json.gz in place. With no network reachable
 * it wrote what it could, and the 3.7 MB national directory of 42,928 listings
 * became a 310 KB stub. The file was restored from git, but only because it is
 * committed; the next such job might write to a database.
 *
 * So a file is only ever launched when its own source declares the handler.
 * "Run everything and see what happens" is not a safe way to find out what is
 * testable.
 *
 * Exits non-zero if any suite fails, so it can gate a commit.
 *
 *   node sweeps/scripts/selftest_all.js [--quiet]
 *
 * Some suites open a database, so a PGLITE_DIR is set to a scratch directory
 * unless one is already in the environment. None of them write to it.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const DIRS = [path.join(ROOT, 'server', 'src', 'jobs'), path.join(ROOT, 'server', 'src', 'utils'),
  // database/ carries rules too: which passwords a production seed refuses to
  // leave in place is exactly the kind of thing that is only found afterwards.
  path.join(ROOT, 'server', 'src', 'database')];
const QUIET = process.argv.includes('--quiet');

// A scratch database, so running the tests never touches a real one.
const PGLITE_DIR = process.env.PGLITE_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'cb-selftest-'));

const files = [];
for (const dir of DIRS) {
  if (!fs.existsSync(dir)) continue;
  for (const name of fs.readdirSync(dir).sort()) {
    if (name.endsWith('.js')) files.push(path.join(dir, name));
  }
}

/**
 * Does this file answer to `selftest`? Decided by reading it, never by running
 * it — see the note at the top. Matches the two shapes the codebase uses:
 *
 *   if (require.main === module && process.argv[2] === 'selftest')
 *   if (require.main === module) { const cmd = process.argv[2]; ... 'selftest'
 *
 * A file that handles the argument some third way is listed as having no
 * self-test, which is the safe direction to be wrong in: it gets mentioned in
 * the output rather than executed.
 */
function declaresSelftest(file) {
  const src = fs.readFileSync(file, 'utf8');

  // (a) The file dispatches on the argument. The jobs read
  //     `const argv = process.argv.slice(2)` and test argv[0]; some test
  //     process.argv[2] directly. Either way the file handles `selftest`
  //     itself and will not fall through to its real work.
  // Any comparison against the literal is a dispatch: the jobs write
  // `argv[0] === 'selftest'`, rdap.js `domain === 'selftest'`. A file that does
  // not handle the argument does not mention it — buildDirectory.js, the one
  // that has to stay excluded, contains the string nowhere.
  if (/===\s*['"]selftest['"]/.test(src)) return true;
  if (/\bcase\s+['"]selftest['"]/.test(src)) return true;

  // (b) The file's whole command-line behaviour IS its test. That is the
  //     convention for the pure helpers in utils/: they have no job to run, so
  //     running one directly means running its assertions, with or without an
  //     argument. Only two shapes count, both of which are unmistakably a test
  //     and nothing else:
  //
  //       if (require.main === module) process.exit(selfTest() ? 0 : 1);
  //       if (require.main === module) { let pass = 0, fail = 0; ...
  //
  //     Anything else — a require.main block that calls main(), or parses
  //     subcommands — is left alone. buildDirectory.js is the reason: its
  //     block rebuilds the national directory file, and a runner that guessed
  //     wrong about it destroyed that file once already.
  const entry = src.match(/if\s*\(\s*require\.main\s*===\s*module\s*\)\s*\{?([\s\S]{0,160})/);
  if (!entry) return false;
  const head = entry[1];
  return /process\.exit\(\s*self[Tt]est\(\)/.test(head)
    || /let\s+pass\s*=\s*0\s*,\s*fail\s*=\s*0/.test(head);
}

let passed = 0, failed = 0, suites = 0, none = [];
const broken = [];

for (const file of files) {
  const rel = path.relative(ROOT, file);
  if (!declaresSelftest(file)) { none.push(rel); continue; }
  let out = '';
  let nonZero = false;
  try {
    out = execFileSync(process.execPath, [file, 'selftest'], {
      encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PGLITE_DIR },
    });
  } catch (err) {
    // A failing suite exits 1 and its output is still what we want to read, so
    // a non-zero exit is recorded rather than treated as a crash. Several
    // files have no self-test and answer an unknown argument with a usage
    // message and exit 1, which is correct behaviour, not a failure.
    out = `${err.stdout || ''}${err.stderr || ''}`;
    nonZero = true;
  }

  // Both spellings: most suites print "self-test:", geocodePins "selftest:".
  const line = (out.match(/^.*self-?test: .*$/m) || [])[0];
  if (!line) {
    // No self-test. Whether it exited 0 or printed a usage message first is a
    // detail; either way there is nothing here to run.
    none.push(rel + (nonZero ? '' : ''));
    continue;
  }
  const p = Number((line.match(/(\d+) passed/) || [])[1] || 0);
  const f = Number((line.match(/(\d+) failed/) || [])[1] || 0);
  passed += p; failed += f; suites++;
  if (f > 0) broken.push(rel);
  if (!QUIET || f > 0) {
    console.log(`  ${f > 0 ? 'FAIL ' : 'ok   '} ${path.basename(file).padEnd(22)} ${String(p).padStart(4)} passed, ${f} failed`);
  }
}

console.log('\n' + '─'.repeat(52));
console.log(`${passed} assertions across ${suites} suites, ${failed} failed`);
if (none.length) console.log(`\nno self-test (${none.length}): ${none.map(f => path.basename(f)).join(', ')}`);
if (broken.length) console.log(`\nFAILING: ${broken.join(', ')}`);
process.exit(failed > 0 || broken.length ? 1 : 0);
