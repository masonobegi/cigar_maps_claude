/**
 * Re-check every public listing's website (handoff task 2).
 *
 * The four verdicts that matter here - elsewhere, hijacked, parked,
 * store_unavailable - did not exist when the current statuses were written, so
 * every 'ok' in the table predates them. recheckDays: 0 makes the sweep take
 * them all again rather than only the stale ones.
 */
const { checkStores } = require('../../server/src/jobs/linkCheck');
(async () => {
  const r = await checkStores({ limit: 5000, recheckDays: 0 });
  console.log(JSON.stringify(r, null, 1));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
