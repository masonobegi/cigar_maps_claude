/**
 * CigarBuddy Store Outreach Scraper
 * 100% free — no paid APIs or services needed
 *
 * Sources:
 *   1. OpenStreetMap (Overpass API) — most reliable, global
 *   2. Yelp search results — good for US stores
 *   3. Yellow Pages — US stores with phone/website
 *   4. Website email extraction — visits each store website to find emails
 *
 * Usage:
 *   node index.js
 *   node index.js --cities "New Orleans,Atlanta,Miami Beach,Chicago"
 *   node index.js --us   (broad US search)
 *
 * Output: results/stores.csv (open in Excel or Google Sheets)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { createObjectCsvWriter } = require('csv-writer');
const chalk = require('chalk');

const overpass = require('./sources/overpass');
const yelp = require('./sources/yelp-scraper');
const yellowpages = require('./sources/yellowpages-scraper');
const { findEmailsForWebsite } = require('./email-finder');

const OUT_DIR = path.join(__dirname, 'results');
const CSV_PATH = path.join(OUT_DIR, 'stores.csv');

const TARGET_CITIES = [
  { city: 'New Orleans', state: 'LA' },
  { city: 'Atlanta', state: 'GA' },
  { city: 'Miami', state: 'FL' },
  { city: 'Miami Beach', state: 'FL' },
  { city: 'Tampa', state: 'FL' },
  { city: 'Chicago', state: 'IL' },
  { city: 'Houston', state: 'TX' },
  { city: 'Dallas', state: 'TX' },
  { city: 'Las Vegas', state: 'NV' },
  { city: 'Nashville', state: 'TN' },
  { city: 'Charlotte', state: 'NC' },
  { city: 'Phoenix', state: 'AZ' },
  { city: 'Denver', state: 'CO' },
  { city: 'Austin', state: 'TX' },
  { city: 'San Antonio', state: 'TX' },
  { city: 'Jacksonville', state: 'FL' },
  { city: 'Orlando', state: 'FL' },
  { city: 'Indianapolis', state: 'IN' },
  { city: 'Columbus', state: 'OH' },
  { city: 'Fort Lauderdale', state: 'FL' },
  { city: 'Scottsdale', state: 'AZ' },
  { city: 'New York', state: 'NY' },
  { city: 'Los Angeles', state: 'CA' },
  { city: 'San Diego', state: 'CA' },
  { city: 'Richmond', state: 'VA' },
  { city: 'Raleigh', state: 'NC' },
  { city: 'Kansas City', state: 'MO' },
  { city: 'St Louis', state: 'MO' },
  { city: 'Memphis', state: 'TN' },
  { city: 'Louisville', state: 'KY' },
];

const CSV_HEADER = [
  { id: 'name', title: 'Store Name' },
  { id: 'email', title: 'Email' },
  { id: 'phone', title: 'Phone' },
  { id: 'website', title: 'Website' },
  { id: 'address', title: 'Address' },
  { id: 'city', title: 'City' },
  { id: 'state', title: 'State' },
  { id: 'zip', title: 'ZIP' },
  { id: 'source', title: 'Source' },
  { id: 'yelp_rating', title: 'Yelp Rating' },
  { id: 'yelp_reviews', title: 'Yelp Reviews' },
  { id: 'outreach_status', title: 'Outreach Status' },
  { id: 'notes', title: 'Notes' },
];

const US_STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];

function parseCityState(input) {
  // Handles: "New Orleans LA", "New Orleans, LA", "New Orleans"
  const parts = input.trim().replace(',', '').split(/\s+/);
  const last = parts[parts.length - 1].toUpperCase();
  if (US_STATES.includes(last) && parts.length > 1) {
    return { city: parts.slice(0, -1).join(' '), state: last };
  }
  return { city: input.trim(), state: '' };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function dedup(stores) {
  const seen = new Set();
  return stores.filter(s => {
    if (!s.name || s.name.length < 3) return false;
    const key = (s.name + (s.city || '')).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function findEmails(stores) {
  const withSites = stores.filter(s => s.website);
  if (withSites.length === 0) {
    console.log(chalk.yellow('\nNo stores have websites to scrape for emails.'));
    return stores;
  }

  console.log(chalk.cyan(`\n📧 Finding emails for ${withSites.length} stores with websites...`));
  console.log(chalk.gray('(Visiting each website — ~10-30 seconds per store)\n'));

  let found = 0;
  for (let i = 0; i < stores.length; i++) {
    const store = stores[i];
    if (!store.website) continue;

    const nameDisplay = (store.name || '').slice(0, 38).padEnd(38);
    process.stdout.write(chalk.gray(`[${i + 1}/${stores.length}] ${nameDisplay} `));

    const emails = await findEmailsForWebsite(store.website);
    if (emails.length > 0) {
      store.email = emails[0];
      found++;
      process.stdout.write(chalk.green(`✓ ${store.email}\n`));
    } else {
      process.stdout.write(chalk.gray('— not found\n'));
    }

    await sleep(1000 + Math.random() * 500);
  }

  const pct = withSites.length > 0 ? Math.round((found / withSites.length) * 100) : 0;
  console.log(chalk.green(`\n✓ Emails found: ${found}/${withSites.length} (${pct}%)`));
  return stores;
}

async function searchCity(city, state) {
  const label = state ? `${city}, ${state}` : city;
  console.log(chalk.bold.cyan(`\n🔍 ${label}`));

  // Run sources sequentially — parallel triggers rate limits on Yelp/YP
  const osmResults = await overpass.searchByCity(city).catch(() => []);

  // Yellow Pages and Yelp may be blocked by Cloudflare — try but don't fail
  const ypResults = await yellowpages.searchCigarStores(city, state).catch(() => []);
  const yelpResults = await yelp.searchYelp(city, state).catch(() => []);

  const combined = dedup([...osmResults, ...ypResults, ...yelpResults]);
  const blocked = (ypResults.length === 0 && yelpResults.length === 0) ? chalk.gray(' (YP/Yelp blocked — OSM only)') : '';
  console.log(chalk.green(`  → ${combined.length} unique stores`) + blocked);
  return combined;
}

async function writeCsv(stores, outputPath) {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const filePath = outputPath || CSV_PATH;
  const writer = createObjectCsvWriter({ path: filePath, header: CSV_HEADER });
  await writer.writeRecords(stores.map(s => ({
    name: s.name || '',
    email: s.email || '',
    phone: s.phone || '',
    website: s.website || '',
    address: s.address || '',
    city: s.city || '',
    state: s.state || '',
    zip: s.zip || '',
    source: s.source || '',
    yelp_rating: s.yelp_rating || '',
    yelp_reviews: s.yelp_reviews || '',
    outreach_status: 'Not Started',
    notes: '',
  })));
  return filePath;
}

function printStats(stores) {
  const withEmail = stores.filter(s => s.email).length;
  const withPhone = stores.filter(s => s.phone).length;
  const withWebsite = stores.filter(s => s.website).length;
  const withoutContact = stores.filter(s => !s.email && !s.phone && !s.website).length;
  const byState = {};
  stores.forEach(s => { if (s.state) byState[s.state] = (byState[s.state] || 0) + 1; });

  const topStates = Object.entries(byState).sort((a, b) => b[1] - a[1]).slice(0, 5);

  console.log(chalk.bold('\n📊 Results:'));
  console.log(chalk.gray('─'.repeat(40)));
  console.log(chalk.white(`  Total stores:       ${chalk.bold.yellow(stores.length)}`));
  console.log(chalk.white(`  With email:         ${chalk.bold.green(withEmail)} ${chalk.gray(`(${Math.round(withEmail/(stores.length||1)*100)}%)`)}`));
  console.log(chalk.white(`  With phone:         ${chalk.bold.cyan(withPhone)}`));
  console.log(chalk.white(`  With website:       ${chalk.bold.blue(withWebsite)}`));
  console.log(chalk.white(`  No contact info:    ${chalk.gray(withoutContact)} (phone/call them)`));
  if (topStates.length > 0) {
    console.log(chalk.white(`  Top states:         ${topStates.map(([s, n]) => `${s}(${n})`).join(', ')}`));
  }
}

function printTips(stores) {
  const withEmail = stores.filter(s => s.email).length;
  const withPhone = stores.filter(s => s.phone).length;

  console.log(chalk.bold.yellow('\n💡 What to do with this list:'));
  console.log(chalk.gray('─'.repeat(40)));

  console.log(chalk.bold('\n  Option 1 — Cold email (easiest to scale)'));
  console.log(chalk.gray(`  ${withEmail} stores have emails`));
  console.log(chalk.gray('  Free: node email-sender.js (uses your Gmail)'));
  console.log(chalk.gray('  Scale: Instantly.ai $97/mo → send 1000s/day'));
  console.log(chalk.gray('  Expected: 5-15% reply rate for this niche'));

  console.log(chalk.bold('\n  Option 2 — Phone calls'));
  console.log(chalk.gray(`  ${withPhone} stores have phone numbers`));
  console.log(chalk.gray('  Script: "Hi, I\'m building a free Weedmaps for'));
  console.log(chalk.gray('  cigars and want to list your shop..."'));
  console.log(chalk.gray('  Best: Tue-Thu 2-4pm, aim for 20 calls/hour'));

  console.log(chalk.bold('\n  Option 3 — Instagram DMs (best conversion)'));
  console.log(chalk.gray('  Search each store name + find their @handle'));
  console.log(chalk.gray('  Instagram business accounts can be DM\'d easily'));
  console.log(chalk.gray('  Message: "Hey [name], I built a free Weedmaps for'));
  console.log(chalk.gray('  cigars and think [Store] would be a perfect fit..."'));
  console.log(chalk.gray('  Do 20-30/day manually to avoid IG limits'));

  console.log(chalk.bold('\n  Option 4 — Facebook Business Pages'));
  console.log(chalk.gray('  Search store name on Facebook → Message button'));
  console.log(chalk.gray('  Slower but high visibility for local businesses\n'));
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  // --output flag — custom CSV filename
  const outIdx = args.indexOf('--output');
  const customOutput = outIdx !== -1
    ? path.join(OUT_DIR, args[outIdx + 1])
    : null;

  // --cities "City1 ST,City2 ST" mode
  if (args.includes('--cities')) {
    const idx = args.indexOf('--cities');
    const cityList = (args[idx + 1] || '').split(',').map(c => c.trim()).filter(Boolean);
    const wantEmails = !args.includes('--no-emails');

    console.log(chalk.bold.yellow('\n🚬 CigarBuddy Store Scraper'));
    console.log(chalk.gray(`Searching: ${cityList.join(', ')}\n`));

    let all = [];
    for (const entry of cityList) {
      const { city, state } = parseCityState(entry);
      const stores = await searchCity(city, state);
      all.push(...stores);
    }
    all = dedup(all);

    if (wantEmails) all = await findEmails(all);

    printStats(all);
    const csv = await writeCsv(all, customOutput);
    printTips(all);
    console.log(chalk.bold.green(`\n✅ Saved: ${csv}\n`));
    return;
  }

  // --us mode (all top US cities)
  if (args.includes('--us')) {
    console.log(chalk.bold.yellow('\n🚬 CigarBuddy Store Scraper — US'));
    console.log(chalk.gray(`Searching ${TARGET_CITIES.length} cities...\n`));

    let all = [];
    for (const { city, state } of TARGET_CITIES) {
      const stores = await searchCity(city, state);
      all.push(...stores);
      await sleep(2000);
    }
    all = dedup(all);
    all = await findEmails(all);

    printStats(all);
    const csv = await writeCsv(all, customOutput);
    printTips(all);
    console.log(chalk.bold.green(`\n✅ Saved: ${csv}\n`));
    return;
  }

  // Interactive mode
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise(res => rl.question(q, res));

  console.log(chalk.bold.yellow('\n🚬 CigarBuddy Store Scraper'));
  console.log(chalk.gray('Find cigar stores + contacts — 100% free\n'));
  console.log('  1) Search specific cities');
  console.log(`  2) Search all ${TARGET_CITIES.length} top US cigar markets (recommended)`);
  console.log('  3) Find emails for existing results/stores.csv\n');

  const choice = (await ask('Choice [1/2/3]: ')).trim();

  if (choice === '1') {
    const input = await ask('Cities (e.g. "New Orleans LA, Atlanta GA, Miami FL"): ');
    const wantEmails = (await ask('Find emails by visiting their websites? [Y/n]: ')).toLowerCase() !== 'n';
    rl.close();

    const cityList = input.split(',').map(c => c.trim()).filter(Boolean);
    let all = [];
    for (const entry of cityList) {
      const { city, state } = parseCityState(entry);
      const stores = await searchCity(city, state);
      all.push(...stores);
    }
    all = dedup(all);
    if (wantEmails) all = await findEmails(all);
    printStats(all);
    const csv = await writeCsv(all);
    printTips(all);
    console.log(chalk.bold.green(`\n✅ Saved: ${csv}\n`));
  }
  else if (choice === '2') {
    rl.close();
    console.log(chalk.gray(`\nSearching ${TARGET_CITIES.length} cities — grab a coffee ☕\n`));
    let all = [];
    for (const { city, state } of TARGET_CITIES) {
      const stores = await searchCity(city, state);
      all.push(...stores);
      await sleep(1500);
    }
    all = dedup(all);

    console.log(chalk.bold(`\nFound ${all.length} total stores. Finding emails now...`));
    all = await findEmails(all);
    printStats(all);
    const csv = await writeCsv(all);
    printTips(all);
    console.log(chalk.bold.green(`\n✅ Saved: ${csv}\n`));
  }
  else if (choice === '3') {
    rl.close();
    const { parse } = require('csv-parse/sync');
    if (!fs.existsSync(CSV_PATH)) {
      console.log(chalk.red('\nNo results/stores.csv found. Run a search first.\n'));
      return;
    }
    const existing = parse(fs.readFileSync(CSV_PATH, 'utf8'), { columns: true, skip_empty_lines: true });
    const needEmail = existing.filter(s => s.Website && !s.Email).map(s => ({
      name: s['Store Name'], email: '', phone: s.Phone, website: s.Website,
      address: s.Address, city: s.City, state: s.State, zip: s.ZIP, source: s.Source,
    }));
    console.log(chalk.cyan(`\nFinding emails for ${needEmail.length} stores that have websites...\n`));
    await findEmails(needEmail);

    // Merge back
    needEmail.forEach(n => {
      const row = existing.find(r => r['Store Name'] === n.name && r.City === n.city);
      if (row && n.email) row.Email = n.email;
    });

    const { stringify } = require('csv-stringify/sync');
    fs.writeFileSync(CSV_PATH, stringify(existing, { header: true }));
    const withEmail = existing.filter(s => s.Email).length;
    console.log(chalk.green(`\n✅ Done. ${withEmail} stores now have emails. CSV updated.\n`));
  }
  else {
    rl.close();
    console.log(chalk.red('\nInvalid choice\n'));
  }
}

main().catch(err => {
  console.error(chalk.red('\nError:'), err.message);
  console.error(err.stack);
  process.exit(1);
});
