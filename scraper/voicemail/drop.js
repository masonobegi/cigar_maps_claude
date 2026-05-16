/**
 * CigarBuddy Voicemail Dropper
 * Uses Twilio to call cigar shops and play a pre-recorded message.
 *
 * Setup:
 *   1. Sign up at twilio.com (free trial gives $15 credit — enough for 200+ calls)
 *   2. Get a Twilio phone number (free on trial)
 *   3. Record your voicemail as an MP3 or WAV and host it somewhere public
 *      (easiest: upload to any file host, or use Twilio's built-in TTS below)
 *   4. Fill in .env with your credentials
 *   5. node drop.js
 *
 * Cost: ~$0.013/min per call. A 30s message = ~$0.007 per store.
 * 100 stores = about $0.70. Basically free.
 *
 * Legal note: TCPA requires calls between 8am-9pm LOCAL time.
 * This script only calls during that window and skips numbers outside it.
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const readline = require('readline');
const twilio = require('twilio');
const { parse } = require('csv-parse/sync');
const chalk = require('chalk');

// Load .env
try {
  const env = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  env.split('\n').forEach(line => {
    const [k, ...v] = line.split('=');
    if (k && v.length) process.env[k.trim()] = v.join('=').trim();
  });
} catch {}

const ACCOUNT_SID  = process.env.TWILIO_ACCOUNT_SID;
const AUTH_TOKEN   = process.env.TWILIO_AUTH_TOKEN;
const FROM_NUMBER  = process.env.TWILIO_PHONE_NUMBER;  // your Twilio number e.g. +15035550100
const MESSAGE_URL  = process.env.VOICEMAIL_URL;        // public URL to your MP3/WAV

const CSV_PATH = path.join(__dirname, '../results/stores_MASTER.csv');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function cleanPhone(raw) {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  // US numbers only for now
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits[0] === '1') return `+${digits}`;
  return null;
}

function isWithinCallHours() {
  const hour = new Date().getHours();
  return hour >= 8 && hour < 21; // 8am–9pm
}

function buildTwiML(messageUrl, storeName) {
  // If you have a hosted MP3/WAV:
  if (messageUrl) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Pause length="2"/>
  <Play>${messageUrl}</Play>
</Response>`;
  }

  // Fallback: text-to-speech (no audio file needed, costs the same)
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Pause length="2"/>
  <Say voice="Polly.Matthew" rate="95%">
    Hey, this is Mason from CigarBuddy.
    I built a free platform where cigar enthusiasts in your area
    search for specific cigars and find which local shops have them in stock.
    Think of it like Weedmaps, but for premium cigars.
    Listing your shop is completely free and takes about ten minutes to set up.
    Check us out at cigar buddy dot com, or reply to the email I sent you.
    Thanks, have a great day.
  </Say>
</Response>`;
}

async function callStore(client, store, twiml) {
  const phone = cleanPhone(store.Phone || store.phone || '');
  if (!phone) return { status: 'skipped', reason: 'no valid phone' };

  try {
    const call = await client.calls.create({
      to: phone,
      from: FROM_NUMBER,
      twiml,
      // Hang up after voicemail picks up — don't wait for a human
      machineDetection: 'DetectMessageEnd',
      asyncAmd: true,
      statusCallback: null,
      timeout: 30,
    });
    return { status: 'called', sid: call.sid };
  } catch (err) {
    return { status: 'error', reason: err.message };
  }
}

async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = q => new Promise(res => rl.question(q, res));

  console.log(chalk.bold.yellow('\n📞 CigarBuddy Voicemail Dropper'));
  console.log(chalk.gray('─'.repeat(45)));

  if (!ACCOUNT_SID || !AUTH_TOKEN || !FROM_NUMBER) {
    console.log(chalk.red('\nMissing Twilio credentials. Create a .env file:\n'));
    console.log(chalk.gray('TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'));
    console.log(chalk.gray('TWILIO_AUTH_TOKEN=your_auth_token'));
    console.log(chalk.gray('TWILIO_PHONE_NUMBER=+15035550100'));
    console.log(chalk.gray('VOICEMAIL_URL=https://yoursite.com/message.mp3  (optional)\n'));
    console.log(chalk.yellow('Get credentials at twilio.com → Console Dashboard\n'));
    rl.close();
    return;
  }

  // Load CSV
  if (!fs.existsSync(CSV_PATH)) {
    console.log(chalk.red('\nNo stores_MASTER.csv found. Run the scraper first.\n'));
    rl.close();
    return;
  }

  const rows = parse(fs.readFileSync(CSV_PATH, 'utf8'), { columns: true, skip_empty_lines: true });
  const withPhone = rows.filter(r => cleanPhone(r.Phone || r.phone));

  console.log(chalk.white(`\nStores with phone numbers: ${chalk.bold.yellow(withPhone.length)}`));

  // Time check
  if (!isWithinCallHours()) {
    const hour = new Date().getHours();
    console.log(chalk.yellow(`\nWarning: current time is ${hour}:00 — outside 8am-9pm call window.`));
    const proceed = await ask('Calls outside this window may violate TCPA. Proceed anyway? [y/N]: ');
    if (proceed.toLowerCase() !== 'y') {
      console.log(chalk.gray('Smart. Schedule this to run at 8am.\n'));
      rl.close();
      return;
    }
  }

  // Preview the message
  const twiml = buildTwiML(MESSAGE_URL, 'Test Store');
  console.log(chalk.bold('\nMessage preview (TwiML):'));
  console.log(chalk.gray(twiml.includes('<Play>') ? `Playing audio from: ${MESSAGE_URL}` : 'Using text-to-speech (see script for text)'));

  const batchInput = await ask(`\nHow many stores to call? (max ${withPhone.length}): `);
  const batchSize = Math.min(parseInt(batchInput) || 10, withPhone.length);
  const batch = withPhone.slice(0, batchSize);

  const dryRun = (await ask('\nDo a dry run first (no real calls)? [Y/n]: ')).toLowerCase() !== 'n';
  rl.close();

  if (dryRun) {
    console.log(chalk.bold.cyan('\n[DRY RUN] Would call:'));
    batch.forEach(s => {
      const phone = cleanPhone(s.Phone || s.phone);
      console.log(chalk.gray(`  ${(s['Store Name'] || '').padEnd(40)} ${phone}`));
    });
    console.log(chalk.bold.green(`\n${batch.length} stores would be called. Run again and choose no for dry run to send for real.\n`));
    return;
  }

  const client = twilio(ACCOUNT_SID, AUTH_TOKEN);
  const results = { called: 0, skipped: 0, error: 0 };

  console.log(chalk.bold.cyan(`\nCalling ${batch.length} stores...\n`));

  for (let i = 0; i < batch.length; i++) {
    const store = batch[i];
    const name = (store['Store Name'] || 'Store').slice(0, 38).padEnd(38);
    const phone = cleanPhone(store.Phone || store.phone);

    process.stdout.write(chalk.gray(`[${i + 1}/${batch.length}] ${name} ${phone} `));

    const result = await callStore(client, store, twiml);

    if (result.status === 'called') {
      results.called++;
      process.stdout.write(chalk.green(`✓\n`));
    } else if (result.status === 'skipped') {
      results.skipped++;
      process.stdout.write(chalk.gray(`— ${result.reason}\n`));
    } else {
      results.error++;
      process.stdout.write(chalk.red(`✗ ${result.reason}\n`));
    }

    // 3 second gap between calls — don't hammer Twilio
    if (i < batch.length - 1) await sleep(3000);
  }

  console.log(chalk.bold(`\n📊 Done: ${chalk.green(results.called)} called, ${chalk.gray(results.skipped)} skipped, ${chalk.red(results.error)} errors\n`));

  const cost = (results.called * 0.014).toFixed(2);
  console.log(chalk.gray(`Estimated cost: ~$${cost} (at $0.013/min for 30s messages)\n`));
}

main().catch(err => {
  console.error(chalk.red('Error:'), err.message);
  process.exit(1);
});
