/**
 * California's licence file, turned into what licenceSync.match reads.
 *
 * CDTFA publishes every active cigarette and tobacco licence in the state as a
 * CSV on their ArcGIS open-data portal, refreshed monthly — the copy taken here
 * is current to 1 August 2026. It is a direct download and needs no key, which
 * means the "manual registry" note in the handoff is out of date for California:
 *
 *   https://data-cdtfa.opendata.arcgis.com/datasets/CDTFA::california-cigarette-and-tobacco-licensees.csv
 *
 * WHAT IT DOES NOT CONTAIN: the licensee's name. California withholds it under
 * taxpayer confidentiality, so every row is an address and a licence type and
 * nothing else. That costs us the `renamed` verdict, which needs a name to
 * compare — but not `verified`, which is the one that matters here: a current
 * retail tobacco licence at a listing's own front door is first-hand evidence
 * from the state that somebody is selling tobacco there.
 *
 * Only Retailer rows are kept. A distributor or wholesaler licence at an address
 * is not a shop you can walk into, and 952 of the 29,322 rows are those.
 *
 *   node sweeps/scripts/convert_ca_licences.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'decisions', 'licences');
const SRC = path.join(DIR, 'ca.csv');
const OUT = path.join(DIR, 'ca.json');

/** Split one CSV line, respecting quotes. The address fields contain commas. */
function splitCsv(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === ',' && !inQ) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

const titleCase = s => String(s || '').toLowerCase()
  .replace(/\b([a-z])/g, (m, c) => c.toUpperCase())
  .replace(/\b(Ne|Nw|Se|Sw|N|S|E|W)\b/g, m => m.toUpperCase());

(() => {
  const text = fs.readFileSync(SRC, 'utf8').replace(/^﻿/, '');
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  const hdr = splitCsv(lines[0]).map(h => h.trim());
  const col = name => hdr.indexOf(name);
  const iType = col('type'), iStreet = col('STREET'), iCity = col('CITY');
  const iZip = col('ZIPCODE'), iId = col('ID');
  if ([iType, iStreet, iCity, iZip].some(i => i < 0)) {
    console.error(`unexpected columns: ${hdr.join(', ')}`);
    process.exit(1);
  }

  const rows = [];
  let skipped = 0;
  for (let i = 1; i < lines.length; i++) {
    const c = splitCsv(lines[i]);
    if ((c[iType] || '').trim() !== 'Retailer') { skipped++; continue; }
    const address = titleCase((c[iStreet] || '').trim());
    if (!address) { skipped++; continue; }
    rows.push({
      name: null,                       // California does not publish it
      address,
      city: titleCase((c[iCity] || '').trim()),
      state: 'CA',
      zip: (c[iZip] || '').trim().slice(0, 5),
      phone: null,
      // The file is "active licensees as of" its publication date, so every row
      // in it is current by construction. There is no per-row status column.
      status: 'Active',
      expires: null,
      licence_no: (c[iId] || '').trim() || null,
    });
  }

  fs.writeFileSync(OUT, JSON.stringify(rows, null, 1));
  console.log(`${rows.length} retailer licences written to ${OUT}`);
  console.log(`${skipped} rows skipped (distributors, wholesalers, blank addresses)`);
  console.log(`\nsample:`);
  for (const r of rows.slice(0, 3)) console.log(`  ${r.address}, ${r.city} ${r.zip}`);
})();
