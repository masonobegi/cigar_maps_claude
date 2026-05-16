/**
 * CigarBuddy — Ringless Voicemail Drop
 * Uses Slybroadcast to deliver directly to voicemail without ringing.
 * Phone never rings. They just see a missed voicemail notification.
 *
 * Pricing: ~$0.045/drop. 224 stores = ~$10.
 *
 * Setup:
 *   1. Sign up at slybroadcast.com (free account includes 5 test drops)
 *   2. Record your message as MP3 and host it somewhere public:
 *      - Upload to Google Drive → Share → get direct link
 *      - Or use any file host (Dropbox, etc.)
 *   3. Fill in .env with your credentials
 *   4. node ringless.js
 *
 * Easiest no-code option: just go to slybroadcast.com, upload your CSV
 * and MP3 through their website — no script needed at all.
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const readline = require('readline');
const https = require('https');
const { parse } = require('csv-parse/sync');
const chalk = require('chalk');
const crypto = require('crypto');

// Load .env
try {
  fs.readFileSync(path.join(__dirname, '.env'), 'utf8')
    .split('\n').forEach(line => {
      const [k, ...v] = line.split('=');
      if (k?.trim()) process.env[k.trim()] = v.join('=').trim();
    });
} catch {}

const SLY_EMAIL    = process.env.SLYBROADCAST_EMAIL;
const SLY_PASSWORD = process.env.SLYBROADCAST_PASSWORD;
const AUDIO_URL    = process.env.VOICEMAIL_AUDIO_URL; // public MP3/WAV URL
const CALLER_ID    = process.env.CALLER_ID;           // number that shows up as missed call

const CSV_PATH = path.join(__dirname, '../results/stores_MASTER.csv');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function md5(str) {
  return crypto.createHash('md5').update(str).digest('hex');
}

function cleanPhone(raw) {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `1${digits}`;
  if (digits.length === 11 && digits[0] === '1') return digits;
  return null;
}

function postForm(params) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(params).toString();
    const options = {
      hostname: 'www.slybroadcast.com',
      path: '/gateway/service.php',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'CigarBuddy/1.0',
      },
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ status: res.statusCode, raw: data }); }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function sendDrop(phone, audioUrl, callerId) {
  const result = await postForm({
    c_uid: SLY_EMAIL,
    c_password: md5(SLY_PASSWORD),
    c_phone: phone,
    c_record_audio: audioUrl,
    c_callerid: callerId || phone,
    c_date: 'now',
    c_audio_ext: audioUrl.toLowerCase().endsWith('.wav') ? 'wav' : 'mp3',
  });

  if (result.status === 'Error') return { ok: false, reason: result.message };
  if (result.status === 200 || result.status === 'OK') return { ok: true };
  return { ok: false, reason: JSON.stringify(result) };
}

async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = q => new Promise(res => rl.question(q, res));

  console.log(chalk.bold.yellow('\n📱 CigarBuddy Ringless Voicemail Drop'));
  console.log(chalk.gray('Powered by Slybroadcast — goes straight to voicemail, no ringing'));
  console.log(chalk.gray('─'.repeat(48)));

  // Credential check
  if (!SLY_EMAIL || !SLY_PASSWORD) {
    console.log(chalk.red('\nMissing Slybroadcast credentials. Create a .env file:\n'));
    console.log(chalk.gray('SLYBROADCAST_EMAIL=you@gmail.com'));
    console.log(chalk.gray('SLYBROADCAST_PASSWORD=yourpassword'));
    console.log(chalk.gray('VOICEMAIL_AUDIO_URL=https://yoursite.com/message.mp3'));
    console.log(chalk.gray('CALLER_ID=5035550100  (number that shows as the missed call)\n'));
    console.log(chalk.yellow('Sign up at slybroadcast.com — free account includes 5 test drops\n'));
    rl.close();
    return;
  }

  if (!AUDIO_URL) {
    console.log(chalk.red('\nNo VOICEMAIL_AUDIO_URL set.'));
    console.log(chalk.gray('Record your message as an MP3, host it publicly, add the URL to .env\n'));
    console.log(chalk.yellow('Quick way to host: upload to Google Drive → right-click → Share → Copy link'));
    console.log(chalk.yellow('Then convert to direct link at gdirect.sian.com.au\n'));
    rl.close();
    return;
  }

  // Load numbers
  if (!fs.existsSync(CSV_PATH)) {
    console.log(chalk.red('\nNo stores_MASTER.csv found. Run the scraper first.\n'));
    rl.close();
    return;
  }

  const rows = parse(fs.readFileSync(CSV_PATH, 'utf8'), { columns: true, skip_empty_lines: true });
  const withPhone = rows
    .filter(r => cleanPhone(r.Phone || r.phone))
    .map(r => ({ ...r, cleanedPhone: cleanPhone(r.Phone || r.phone) }));

  console.log(chalk.white(`\nStores with phone numbers: ${chalk.bold.yellow(withPhone.length)}`));
  console.log(chalk.white(`Audio URL: ${chalk.gray(AUDIO_URL)}`));
  console.log(chalk.white(`Caller ID: ${chalk.gray(CALLER_ID || 'not set')}\n`));

  const batchInput = await ask(`How many to send? (available: ${withPhone.length}, ~$${(withPhone.length * 0.045).toFixed(2)} for all): `);
  const batchSize  = Math.min(parseInt(batchInput) || 10, withPhone.length);
  const batch      = withPhone.slice(0, batchSize);

  console.log(chalk.gray(`\nEstimated cost: ~$${(batchSize * 0.045).toFixed(2)}\n`));

  const dryRun = (await ask('Dry run first (shows who would get it, no actual sends)? [Y/n]: ')).toLowerCase() !== 'n';

  if (dryRun) {
    console.log(chalk.bold.cyan('\n[DRY RUN] Would send to:'));
    batch.forEach((s, i) => {
      const name = (s['Store Name'] || '').slice(0, 40).padEnd(40);
      console.log(chalk.gray(`  ${i + 1}. ${name} +${s.cleanedPhone}`));
    });
    console.log(chalk.bold.green(`\n${batch.length} drops ready. Run again, choose no for dry run to send.\n`));
    rl.close();
    return;
  }

  const confirm = await ask(`Send ${batch.length} ringless voicemails for ~$${(batchSize * 0.045).toFixed(2)}? [y/N]: `);
  rl.close();
  if (confirm.toLowerCase() !== 'y') { console.log(chalk.gray('Cancelled.\n')); return; }

  console.log(chalk.bold.cyan(`\nSending ${batch.length} drops...\n`));

  let sent = 0, failed = 0;

  for (let i = 0; i < batch.length; i++) {
    const store = batch[i];
    const name  = (store['Store Name'] || '').slice(0, 38).padEnd(38);

    process.stdout.write(chalk.gray(`[${i + 1}/${batch.length}] ${name} `));

    const result = await sendDrop(store.cleanedPhone, AUDIO_URL, CALLER_ID);

    if (result.ok) {
      sent++;
      process.stdout.write(chalk.green('✓\n'));
    } else {
      failed++;
      process.stdout.write(chalk.red(`✗ ${result.reason || 'failed'}\n`));
    }

    // Polite delay — don't slam the API
    if (i < batch.length - 1) await sleep(1500);
  }

  console.log(chalk.bold(`\n✅ Done: ${chalk.green(sent)} sent, ${chalk.red(failed)} failed`));
  console.log(chalk.gray(`Total cost: ~$${(sent * 0.045).toFixed(2)}\n`));
}

main().catch(err => {
  console.error(chalk.red('Error:'), err.message);
  process.exit(1);
});
