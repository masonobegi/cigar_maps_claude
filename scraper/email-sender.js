/**
 * CigarBuddy Cold Email Sender
 *
 * Sends personalized cold emails to cigar stores from your own Gmail/Outlook.
 * Uses Gmail App Password (free) — no third-party service needed.
 *
 * Setup:
 *   1. Go to myaccount.google.com → Security → App Passwords
 *   2. Create a password for "Mail"
 *   3. Set in .env: GMAIL_USER=you@gmail.com  GMAIL_PASS=xxxx xxxx xxxx xxxx
 *   4. node email-sender.js
 *
 * Rate limiting: sends 1 email every 30-60 seconds to avoid Gmail spam flags.
 * Gmail free limit: 500/day. Google Workspace: 2000/day.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const nodemailer = require('nodemailer');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');
const chalk = require('chalk');

// Load .env if present
try {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
      const [key, ...val] = line.split('=');
      if (key && val.length) process.env[key.trim()] = val.join('=').trim();
    });
  }
} catch {}

const CSV_PATH = path.join(__dirname, 'results', 'stores.csv');

// ─── Email templates ────────────────────────────────────────────────────────

const TEMPLATES = {
  // The shop is already on the map. Every template below leads with that fact,
  // because "claim what already exists" converts far better than "sign up for
  // a new thing" -- it is how Yelp and Weedmaps built their retailer networks.
  claim: {
    name: 'Email 1 - Your shop is already listed',
    subject: (store) => `${store.name || 'Your shop'} is on CigarBuddy`,
    body: (store) => `Hi,

Quick heads up: ${store.name || 'your shop'} is already listed on CigarBuddy, a search site for people looking for a specific cigar near them.

The listing is live right now with your address and hours. Nobody at ${store.name || 'the shop'} put it there, so some of it is probably wrong.

If you claim it (free, about two minutes) you can fix the details and add what you actually carry. Then when someone searches "Padron 1964 near me" in ${store.city || 'your area'}, you come up with your price and your stock, and they walk in already knowing what they want.

Claim it here: cigarbuddy.com/stores

No fee, no commission, no contract. I am signing up the first shops in ${store.city || 'the area'} now.

Worth two minutes?

[YOUR NAME]
cigarbuddy.com`,
  },

  claim_v2: {
    name: 'Email 1 (alt) - Lead with what is wrong on the listing',
    subject: (store) => `Are these hours right for ${store.name || 'your shop'}?`,
    body: (store) => `Hi,

I run CigarBuddy, a site where people search for a specific cigar and find which nearby shop has it.

${store.name || 'Your shop'} is already on it. The problem is that the hours and details came from public map data, not from you, so I would not bet on them being current.

You can claim the listing for free and fix it yourself, plus add the cigars you carry so you turn up when someone searches for them by name.

Here is the page: cigarbuddy.com/stores

Takes a couple of minutes. No cost either way, I would just rather the information about your shop be right.

[YOUR NAME]
cigarbuddy.com`,
  },

  followup1: {
    name: 'Email 2 - Follow-up (3 days later)',
    subject: (store) => `Re: ${store.name || 'Your shop'} on CigarBuddy`,
    body: (store) => `Hi,

Following up on the note about your CigarBuddy listing.

Short version: ${store.name || 'your shop'} is already on the map there, and claiming it is free. Once you do, you can correct the details and list what you stock, so people searching for a specific cigar in ${store.city || 'your area'} find you instead of driving to three shops.

If you would rather I just fix something on the listing for you, reply and tell me what is wrong and I will do it.

[YOUR NAME]`,
  },

  followup2: {
    name: 'Email 3 - Last touch',
    subject: (store) => `Last one from me`,
    body: (store) => `Hi,

Won't bug you again after this.

${store.name || 'Your shop'} is listed on CigarBuddy either way. Claiming it is free and lets you control what it says and show what you carry: cigarbuddy.com/stores

If you would rather not be listed at all, reply and I will take it down, no hard feelings.

Good luck out there.

[YOUR NAME]`,
  },
};

// ─── Core functions ──────────────────────────────────────────────────────────

function createTransporter() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_PASS;

  if (!user || !pass) {
    console.log(chalk.red('\nGmail credentials not set.'));
    console.log(chalk.yellow('Create a .env file in the scraper folder with:'));
    console.log(chalk.gray('GMAIL_USER=your@gmail.com'));
    console.log(chalk.gray('GMAIL_PASS=your_app_password\n'));
    console.log(chalk.gray('Get an App Password at: myaccount.google.com → Security → App Passwords\n'));
    process.exit(1);
  }

  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  });
}

function loadStores() {
  if (!fs.existsSync(CSV_PATH)) {
    console.log(chalk.red('\nNo results/stores.csv found. Run the scraper first (node index.js)\n'));
    process.exit(1);
  }
  const csv = fs.readFileSync(CSV_PATH, 'utf8');
  return parse(csv, { columns: true, skip_empty_lines: true });
}

function saveStores(stores) {
  const headers = Object.keys(stores[0]);
  const csv = stringify(stores, { header: true, columns: headers });
  fs.writeFileSync(CSV_PATH, csv);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function randomDelay(minMs, maxMs) {
  return sleep(minMs + Math.floor(Math.random() * (maxMs - minMs)));
}

function renderTemplate(template, store) {
  return {
    subject: typeof template.subject === 'function' ? template.subject(store) : template.subject,
    body: typeof template.body === 'function' ? template.body(store) : template.body,
  };
}

async function sendOne(transporter, store, template, fromName, dryRun) {
  const { subject, body } = renderTemplate(template, store);
  const fromEmail = process.env.GMAIL_USER;

  if (dryRun) {
    console.log(chalk.gray(`  [DRY RUN] To: ${store.Email} | Subject: ${subject}`));
    return true;
  }

  try {
    await transporter.sendMail({
      from: `${fromName} <${fromEmail}>`,
      to: store.Email,
      subject,
      text: body,
    });
    return true;
  } catch (err) {
    console.error(chalk.red(`  Error sending to ${store.Email}: ${err.message}`));
    return false;
  }
}

// ─── Main interactive flow ───────────────────────────────────────────────────

async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise(res => rl.question(q, res));

  console.log(chalk.bold.yellow('\n📧 CigarBuddy Email Sender'));
  console.log(chalk.gray('─'.repeat(45)));

  const stores = loadStores();
  const withEmail = stores.filter(s => s.Email && s.Email.trim());
  const notStarted = withEmail.filter(s => !s['Outreach Status'] || s['Outreach Status'] === 'Not Started');
  const emailed = withEmail.filter(s => s['Outreach Status'] === 'Emailed');

  console.log(chalk.white(`\nTotal stores in CSV:       ${stores.length}`));
  console.log(chalk.white(`With email address:        ${chalk.bold.green(withEmail.length)}`));
  console.log(chalk.white(`Not yet contacted:         ${chalk.bold.yellow(notStarted.length)}`));
  console.log(chalk.white(`Already emailed:           ${emailed.length}\n`));

  if (notStarted.length === 0) {
    console.log(chalk.yellow('All stores with emails have already been contacted!\n'));
    rl.close();
    return;
  }

  // Choose template
  const templateKeys = Object.keys(TEMPLATES);
  console.log('Which email sequence?\n');
  templateKeys.forEach((k, i) => {
    console.log(`  ${i + 1}) ${TEMPLATES[k].name}`);
  });
  const tChoice = parseInt(await ask('\nChoice: ')) - 1;
  const templateKey = templateKeys[Math.max(0, Math.min(tChoice, templateKeys.length - 1))];
  const template = TEMPLATES[templateKey];

  // From name
  const fromName = await ask('\nYour name (shown as sender): ');
  if (!fromName.trim()) { rl.close(); return; }

  // Batch size
  const batchInput = await ask(`\nHow many emails to send today? (available: ${notStarted.length}, recommended: 50-100): `);
  const batchSize = Math.min(parseInt(batchInput) || 50, notStarted.length);
  const batch = notStarted.slice(0, batchSize);

  // Dry run?
  const dryRun = (await ask('\nSend a test run first (no real emails)? [Y/n]: ')).toLowerCase() !== 'n';

  // Preview
  const preview = renderTemplate(template, batch[0]);
  console.log(chalk.bold('\n📨 Email Preview:'));
  console.log(chalk.gray('─'.repeat(45)));
  console.log(chalk.cyan(`To: ${batch[0].Email} (${batch[0]['Store Name']})`));
  console.log(chalk.cyan(`Subject: ${preview.subject}`));
  console.log(chalk.gray('\n' + preview.body));
  console.log(chalk.gray('─'.repeat(45)));

  const confirm = await ask(`\n${dryRun ? '[DRY RUN] ' : ''}Send to ${batch.length} stores? [Y/n]: `);
  if (confirm.toLowerCase() === 'n') {
    rl.close();
    console.log(chalk.gray('\nCancelled.\n'));
    return;
  }

  rl.close();

  const transporter = dryRun ? null : createTransporter();
  let sent = 0;
  let failed = 0;

  console.log(chalk.bold.cyan(`\nSending${dryRun ? ' (DRY RUN)' : ''}...\n`));

  for (let i = 0; i < batch.length; i++) {
    const store = batch[i];
    const storeName = store['Store Name'] || 'Store';
    const email = store.Email;

    process.stdout.write(chalk.gray(`[${i + 1}/${batch.length}] ${storeName.slice(0, 35).padEnd(35)} `));

    const storeData = {
      name: store['Store Name'],
      city: store.City,
      state: store.State,
      email,
    };

    const success = await sendOne(transporter, storeData, template, fromName, dryRun);

    if (success) {
      sent++;
      process.stdout.write(chalk.green(`✓\n`));
      // Update CSV status
      const csvStore = stores.find(s => s.Email === email);
      if (csvStore) {
        csvStore['Outreach Status'] = dryRun ? 'Not Started' : 'Emailed';
        if (!dryRun) csvStore.Notes = `${template.name} sent ${new Date().toLocaleDateString()}`;
      }
    } else {
      failed++;
      process.stdout.write(chalk.red(`✗\n`));
    }

    // Delay between emails — mimics human behavior, avoids spam flags
    if (!dryRun && i < batch.length - 1) {
      const delay = 30000 + Math.random() * 30000; // 30-60 seconds
      process.stdout.write(chalk.gray(`  (waiting ${Math.round(delay/1000)}s...)\r`));
      await randomDelay(30000, 60000);
    }
  }

  // Save updated CSV
  if (!dryRun) saveStores(stores);

  console.log(chalk.bold(`\n📊 Done: ${chalk.green(sent)} sent, ${chalk.red(failed)} failed`));

  if (!dryRun) {
    console.log(chalk.gray(`\nCSV updated with outreach status.`));
    console.log(chalk.yellow('\n💡 Follow-up tips:'));
    console.log(chalk.gray('  • Wait 3 days before sending Follow-up #1'));
    console.log(chalk.gray('  • Wait 3 more days before Follow-up #2'));
    console.log(chalk.gray('  • After 3 touches with no reply, move on'));
    console.log(chalk.gray('  • Expected reply rate: 5-15% for this niche\n'));
  }
}

main().catch(err => {
  console.error(chalk.red('\nError:'), err.message);
  process.exit(1);
});
