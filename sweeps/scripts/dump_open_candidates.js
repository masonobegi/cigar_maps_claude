/**
 * Every public listing and the evidence we currently hold for it, so the
 * question "is this shop actually open?" can be asked of all of them at once.
 *
 * Asked because #10184, Cascade Cigar & Tobacco in Happy Valley OR, was on the
 * public map with full opening hours while the shop had been shut for six
 * months. It passed every gate we had: a live website of its own, an address
 * something outside the directory agreed with, and hours read off that website.
 *
 * cascadecigar.com still answers 200 with 85KB and publishes "11am to 7pm -
 * Everyday". The most recent year anywhere on the page is 2020. It is an
 * abandoned website nobody took down, and it will go on publishing those hours
 * until somebody stops paying for the hosting.
 *
 * So the existing gates prove a *website* exists. They do not prove a *shop*
 * does, and those are not the same question.
 *
 *   railway run --service Postgres node sweeps/scripts/prod.js <abs path to this>
 */
'use strict';

const fs = require('fs');
const path = require('path');
const db = require('../../server/src/database/db');

(async () => {
  const rows = await db.all(`
    SELECT id, name, address, city, state, zip, phone, website, website_status,
           hours, hours_source, hours_checked_at,
           operating_status, source, source_name, confidence,
           storefront, storefront_checked_at, address_backed_by,
           claimed, staff_edited, web_image_url, lat, lng
    FROM stores
    WHERE visible = 1
    ORDER BY state, city, name`);

  const dest = path.join(__dirname, '..', 'decisions', 'open_candidates.json');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(rows, null, 2));

  const n = k => rows.filter(k).length;
  console.log(`${rows.length} public listings\n`);
  console.log(`  with a website of their own        ${n(r => r.website)}`);
  console.log(`  hours read off that website        ${n(r => r.hours_source === 'website')}`);
  console.log(`  a phone number                     ${n(r => r.phone)}`);
  console.log(`  claimed by an owner                ${n(r => Number(r.claimed) === 1)}`);
  console.log(`  a human has ruled on them          ${n(r => Number(r.staff_edited) === 1)}`);
  console.log(`\n  operating_status values seen:`);
  const byStatus = {};
  for (const r of rows) byStatus[r.operating_status || '(null)'] = (byStatus[r.operating_status || '(null)'] || 0) + 1;
  for (const [k, v] of Object.entries(byStatus).sort((a, b) => b[1] - a[1])) console.log(`    ${String(k).padEnd(22)}${v}`);
  console.log(`\n  how recently anything was checked:`);
  const ages = rows.map(r => r.hours_checked_at).filter(Boolean).map(d => new Date(d)).sort((a, b) => b - a);
  if (ages.length) console.log(`    newest ${ages[0].toISOString().slice(0, 10)}, oldest ${ages[ages.length - 1].toISOString().slice(0, 10)}`);

  console.log(`\nwritten to ${dest}`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
