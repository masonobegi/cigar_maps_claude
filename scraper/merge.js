/**
 * Merge multiple stores CSV files into one master list
 * Usage: node merge.js                    — merges all CSVs in results/
 *        node merge.js stores_wa.csv stores_us.csv   — merge specific files
 * Output: results/stores_MASTER.csv
 */
'use strict';

const fs = require('fs');
const path = require('path');
const chalk = require('chalk');

const OUT_DIR = path.join(__dirname, 'results');

function parseCSV(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf8').trim();
  if (!content) return [];

  const lines = content.split('\n');
  if (lines.length < 2) return [];

  const headers = parseRow(lines[0]);
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseRow(lines[i]);
    if (values.length === 0) continue;
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = values[idx] || ''; });
    rows.push(obj);
  }
  return rows;
}

function parseRow(line) {
  // Simple CSV parser that handles quoted fields
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function escapeCSV(val) {
  if (!val) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function writeCSV(rows, filePath) {
  if (rows.length === 0) { console.log(chalk.yellow('No rows to write.')); return; }

  const headers = [
    'Store Name', 'Email', 'Phone', 'Website', 'Address', 'City', 'State', 'ZIP',
    'Source', 'Yelp Rating', 'Yelp Reviews', 'Outreach Status', 'Notes'
  ];

  const lines = [headers.join(',')];
  for (const row of rows) {
    const values = headers.map(h => escapeCSV(row[h] || row[h.toLowerCase()] || ''));
    lines.push(values.join(','));
  }

  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
}

function dedup(rows) {
  const seen = new Set();
  return rows.filter(r => {
    const name = (r['Store Name'] || r.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const city = (r['City'] || r.city || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const key = name + city;
    if (!key || key.length < 3 || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function main() {
  const args = process.argv.slice(2);

  // Get list of CSV files to merge
  let files;
  if (args.length > 0) {
    files = args.map(f => path.isAbsolute(f) ? f : path.join(OUT_DIR, f));
  } else {
    // Auto-discover all CSVs in results/ except MASTER
    files = fs.readdirSync(OUT_DIR)
      .filter(f => f.endsWith('.csv') && !f.includes('MASTER'))
      .map(f => path.join(OUT_DIR, f));
  }

  if (files.length === 0) {
    console.log(chalk.red('No CSV files found in results/'));
    process.exit(1);
  }

  console.log(chalk.bold.yellow('\n🚬 CigarBuddy — Merge CSV Files'));
  console.log(chalk.gray('─'.repeat(40)));

  let all = [];
  for (const file of files) {
    const rows = parseCSV(file);
    const fname = path.basename(file);
    console.log(chalk.white(`  ${fname}: ${chalk.yellow(rows.length)} stores`));
    all.push(...rows);
  }

  console.log(chalk.gray(`\nTotal before dedup: ${all.length}`));
  all = dedup(all);
  console.log(chalk.green(`Total after dedup:  ${all.length}`));

  // Sort by state then city
  all.sort((a, b) => {
    const stateA = (a.State || a.state || '').toUpperCase();
    const stateB = (b.State || b.state || '').toUpperCase();
    if (stateA !== stateB) return stateA.localeCompare(stateB);
    return (a.City || a.city || '').localeCompare(b.City || b.city || '');
  });

  const masterPath = path.join(OUT_DIR, 'stores_MASTER.csv');
  writeCSV(all, masterPath);

  // Print breakdown
  const withEmail = all.filter(r => r.Email || r.email).length;
  const withPhone = all.filter(r => r.Phone || r.phone).length;
  const byState = {};
  all.forEach(r => {
    const s = r.State || r.state || 'Unknown';
    byState[s] = (byState[s] || 0) + 1;
  });

  console.log(chalk.bold('\n📊 Master List Stats:'));
  console.log(chalk.white(`  Total stores:  ${chalk.bold.yellow(all.length)}`));
  console.log(chalk.white(`  With email:    ${chalk.bold.green(withEmail)}`));
  console.log(chalk.white(`  With phone:    ${chalk.bold.cyan(withPhone)}`));
  console.log(chalk.bold('\n  By state:'));
  Object.entries(byState).sort((a,b) => b[1]-a[1]).forEach(([state, count]) => {
    console.log(chalk.gray(`    ${state.padEnd(4)} ${count} stores`));
  });

  console.log(chalk.bold.green(`\n✅ Saved: ${masterPath}\n`));
  console.log(chalk.gray('Open stores_MASTER.csv in Excel/Google Sheets for your outreach list.\n'));
}

main();
