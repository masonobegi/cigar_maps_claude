// Print the waiting hours decisions so they can be read before applying.
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'decisions', 'hours');
// Each file is a wrapper: a note, a count, and the rows themselves.
const read = name => {
  const doc = JSON.parse(fs.readFileSync(path.join(dir, name + '.json'), 'utf8'));
  return Array.isArray(doc) ? doc : (doc.rows || doc.items || doc.candidates || []);
};

const clear = read('hours_clear');
const replace = read('hours_replace');
const hold = read('hours_hold');
const chain = read('hours_chain_rerun');
const recoverable = read('hours_recoverable');

console.log(`CLEAR ${clear.length}, REPLACE ${replace.length}, HOLD ${hold.length}, CHAIN ${chain.length}, RECOVERABLE ${recoverable.length}`);

const why = {};
for (const x of clear) {
  const key = String(x.why || '').replace(/"[^"]*"/g, '"..."').replace(/\d+/g, 'N').slice(0, 70);
  why[key] = (why[key] || 0) + 1;
}
console.log('\nCLEAR, by reason:');
for (const [k, n] of Object.entries(why).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}  ${k}`);

console.log('\nCLEAR, every row:');
for (const x of clear) {
  console.log(`  #${String(x.id).padEnd(6)}${String(x.name || '').slice(0, 30).padEnd(32)}${String(x.city || '')}, ${x.state}`);
  console.log(`         was ${JSON.stringify(x.was).slice(0, 110)}`);
  console.log(`         why ${String(x.why).slice(0, 150)}`);
}

console.log('\nREPLACE, every row:');
for (const x of replace) {
  console.log(`  #${String(x.id).padEnd(6)}${String(x.name || '').slice(0, 30).padEnd(32)}${String(x.city || '')}, ${x.state}`);
  console.log(`         was ${JSON.stringify(x.was).slice(0, 130)}`);
  console.log(`         now ${JSON.stringify(x.now).slice(0, 130)}`);
  if (x.now_lines) console.log(`         from ${JSON.stringify(x.now_lines).slice(0, 160)}`);
}

const real = recoverable.filter(r => r.standing_refusal === false);
console.log(`\nRECOVERABLE without a standing refusal: ${real.length}`);
const byReason = {};
for (const r of recoverable) {
  const k = `${r.standing_refusal ? 'standing' : 'open'}: ${String(r.skipped_because).slice(0, 50)}`;
  byReason[k] = (byReason[k] || 0) + 1;
}
for (const [k, n] of Object.entries(byReason).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${k}`);

console.log('\nCHAIN rows to re-decide against production:');
for (const x of chain) console.log(`  #${String(x.id).padEnd(6)}${String(x.name || '').slice(0, 34).padEnd(36)}${x.website || ''}`);
