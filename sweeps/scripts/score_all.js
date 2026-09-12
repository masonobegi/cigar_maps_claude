// Score the offline decisions against every reviewer verdict so far.
const fs = require('fs');
const { outcomes } = require('./offline');
const { parseTextHours } = require('C:/Users/mason/OneDrive/Desktop/cigarApp/server/src/utils/hoursParser');
const files = process.argv.slice(2);
const { out } = outcomes(files, 'chain_all.jsonl');
const sets = [
  [require('./hours_verify_compact.json'), require('./hours_verify_results.json')],
  [require('./hours_verify2.json'), require('./hours_verify2_results.json')],
  [require('./hours_verify3.json'), require('./hours_verify3_results.json')],
];
let decided = 0, right = 0, skippedRight = 0, skippedWrong = 0;
const wrong = [];
for (const [sample, results] of sets) {
  const byId = new Map(sample.map(s => [s.id, s]));
  for (const v of results) {
    if (v.verdict === 'cannot_verify') continue;
    const d = out.get(v.id), old = byId.get(v.id);
    if (!d || !d.hours) { if (v.verdict === 'correct') skippedRight++; else skippedWrong++; continue; }
    decided++;
    let ok = v.verdict === 'correct' && JSON.stringify(d.hours) === JSON.stringify(old.hours);
    if (!ok && v.correct_hours) {
      const truth = (parseTextHours([v.correct_hours.replace(/\(.*?\)/g, '')]) || {}).hours || {};
      ok = Object.keys(truth).length > 0 && Object.entries(d.hours).some(([day]) => truth[day])
        && Object.entries(d.hours).every(([day, h]) => !truth[day] || truth[day] === h);
    }
    if (ok) right++; else wrong.push(`#${v.id} [${v.verdict}] ${d.kind} ${JSON.stringify(d.hours)} | truth: ${v.correct_hours || '(none)'}`);
  }
}
console.log(`verified listings we still decide: ${decided}; right ${right} (${(100 * right / decided).toFixed(1)}%)`);
console.log(`now skipped: ${skippedWrong} that were wrong (good), ${skippedRight} that were right (coverage lost)`);
for (const w of wrong) console.log('  ' + w);
console.log([...out.values()].filter(d => d.hours).length, 'listings with hours overall');
