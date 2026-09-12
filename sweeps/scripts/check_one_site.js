// What verdict does linkCheck give one address? No database needed.
process.env.PGLITE_DIR = process.env.PGLITE_DIR || require('os').tmpdir() + '/cigarbuddy-linkcheck-probe';
const { checkWebsite } = require('../../server/src/jobs/linkCheck');
(async () => {
  for (const url of (process.env.URLS || '').split(',').filter(Boolean)) {
    const r = await checkWebsite(url, { name: process.env.NAME || '', city: process.env.CITY || '' });
    console.log(url, '->', JSON.stringify(r));
  }
  process.exit(0);
})();
