/**
 * Florida's tobacco permits, turned into what licenceSync.match reads.
 *
 * DBPR publishes daily extracts as plain CSV with no key and no form, so the
 * "manual registry" note in the handoff is out of date for Florida too:
 *
 *   https://www2.myfloridalicense.com/sto/file_download/extracts/bd4012lic.csv
 *   https://www2.myfloridalicense.com/sto/file_download/extracts/bdTOBlic.csv
 *
 * Unlike California's file, these carry the business name — both the licensee
 * and the DBA it trades under — so the `renamed` verdict works here, and a
 * match is a name AND an address agreeing rather than an address alone.
 *
 * Two files because Florida issues tobacco permits under two professions:
 * 4012 is the stand-alone retail tobacco dealer, and 4006 is an alcohol licence
 * that carries tobacco with it, which is how a cigar lounge with a bar is
 * licensed. A cigar shop can be either, so both are read and deduplicated on
 * the licence number.
 *
 *   node sweeps/scripts/convert_fl_licences.js
 *   FL_DIR=/tmp node sweeps/scripts/convert_fl_licences.js   # where the csvs are
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SRC_DIR = process.env.FL_DIR || '/tmp';
const OUT = path.join(__dirname, '..', 'decisions', 'licences', 'fl.json');
const QUOTE = String.fromCharCode(34);

/** Split one CSV line, respecting quotes. Addresses and names contain commas. */
function splitCsv(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === QUOTE) {
      if (inQ && line[i + 1] === QUOTE) { cur += QUOTE; i++; }
      else inQ = !inQ;
    } else if (c === ',' && !inQ) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

const clean = s => String(s == null ? '' : s).replace(/^"|"$/g, '').trim();
const titleCase = s => clean(s).toLowerCase()
  .replace(/\b([a-z])/g, (m, c) => c.toUpperCase())
  .replace(/\b(Ne|Nw|Se|Sw|Ii|Iii|Llc|Inc|Co)\b/g, m => m.toUpperCase());

function read(file) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  const hdr = splitCsv(lines[0]).map(clean);
  const at = name => hdr.indexOf(name);
  return { hdr, at, rows: lines.slice(1).map(l => splitCsv(l).map(clean)) };
}

(() => {
  const all = new Map();               // licence number -> record
  const seenStatus = {};
  const seenSeries = {};

  for (const f of ['bd4012lic', 'bdTOBlic']) {
    const file = path.join(SRC_DIR, `${f}.csv`);
    if (!fs.existsSync(file)) { console.log(`${f}: not found at ${file}, skipping`); continue; }
    const { hdr, at, rows } = read(file);
    console.log(`${f}: ${rows.length} rows`);
    if (all.size === 0) console.log(`  columns: ${hdr.join(' | ')}\n`);

    const iDba = at('DBA'), iOwner = at('Owner Name');
    const iAddr = at('Location Address 1'), iCity = at('Location City');
    const iState = at('Location State'), iZip = at('Location ZIP');
    const iSeries = at('Series');
    // The column naming varies between the two files; find the status and
    // number columns by pattern rather than by an exact name that may not exist.
    const iStatus = hdr.findIndex(h => /primary status/i.test(h));
    const iExpires = at("Expiration Date");
    const iNum = hdr.findIndex(h => /license.*number|number.*license|^License$/i.test(h));

    for (const c of rows) {
      const address = titleCase(c[iAddr]);
      if (!address) continue;
      const status = iStatus >= 0 ? clean(c[iStatus]) : '';
      const series = clean(c[iSeries]);
      seenStatus[status || '(none)'] = (seenStatus[status || '(none)'] || 0) + 1;
      seenSeries[series || '(none)'] = (seenSeries[series || '(none)'] || 0) + 1;

      const key = (iNum >= 0 && clean(c[iNum])) || `${address}|${clean(c[iZip])}|${series}`;
      if (all.has(key)) continue;
      all.set(key, {
        name: titleCase(c[iDba]) || titleCase(c[iOwner]) || null,
        owner: titleCase(c[iOwner]) || null,
        address,
        city: titleCase(c[iCity]),
        state: clean(c[iState]) || 'FL',
        zip: clean(c[iZip]).slice(0, 5),
        phone: null,
        // Florida codes status as a number — 20 is current, and 39,077 of the
        // 39,335 rows are that. isCurrent() reads words, not codes, so the
        // expiry date is what it is given: that is a real date it can compare,
        // and it means a permit that lapsed last month is not read as current
        // merely because the extract still lists it.
        status: status === '20' ? 'Active' : `status ${status}`,
        expires: iExpires >= 0 ? (clean(c[iExpires]) || null) : null,
        series,
      });
    }
  }

  const rows = [...all.values()];
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(rows, null, 1));

  console.log(`\nstatus values seen: ${Object.entries(seenStatus).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  console.log(`series values seen: ${Object.entries(seenSeries).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  console.log(`\n${rows.length} unique permits written to ${OUT}`);
  console.log('sample:');
  for (const r of rows.slice(0, 4)) console.log(`  ${String(r.name).slice(0, 34).padEnd(34)} ${r.address}, ${r.city} ${r.zip}  [${r.status}]`);
})();
