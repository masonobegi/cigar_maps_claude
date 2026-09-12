/**
 * The 56 recoverable hours candidates, joined to the real listings so the two
 * checks that matter can be made by hand: does the page name this shop, and is
 * the street it prints this listing's own door?
 */
const fs = require('fs');
const path = require('path');
const db = require('../../server/src/database/db');
const { mentionsShop, pageKey } = require('../../server/src/jobs/hoursSweep');

const D = path.join(__dirname, '..', 'decisions', 'hours');
const rows = (JSON.parse(fs.readFileSync(path.join(D, 'hours_recoverable.json'), 'utf8')).rows || [])
  .filter(r => r.standing_refusal === false);
const skips = new Map(JSON.parse(fs.readFileSync(path.join(D, 'prod_skips.json'), 'utf8')).map(x => [x.id, x.skip]));

const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const houseNumber = a => (String(a || '').match(/^\s*(\d+)/) || [])[1] || null;

(async () => {
  // How many doors share the page these hours came from. decide() accepts a
  // plain text block only when one shop stands behind the page; this is the
  // same count, taken from the real table.
  const all = await db.all(`SELECT id, address, website FROM stores WHERE visible = 1 AND website IS NOT NULL AND website <> ''`);
  const doors = new Map();
  for (const s of all) {
    const k = pageKey(s.website);
    if (!doors.has(k)) doors.set(k, new Set());
    doors.get(k).add(norm(s.address) || `#${s.id}`);
  }

  const out = [];
  for (const r of rows) {
    const s = await db.get(`SELECT id, name, address, city, state, zip, website, hours, hours_source,
      claimed, staff_edited, visible FROM stores WHERE id = ?`, [r.id]);
    if (!s || Number(s.visible) !== 1) { out.push({ id: r.id, verdict: 'not public', name: s && s.name }); continue; }
    const text = (r.lines || []).join(' \n ');
    const t = norm(text);
    const num = houseNumber(s.address);
    const street = norm(s.address).split(' ').slice(1, 3).join(' ');
    out.push({
      id: s.id, name: s.name, address: s.address, city: s.city, state: s.state, website: s.website,
      has_hours_now: s.hours ? JSON.parse(s.hours) : null, source: s.hours_source,
      locked: Number(s.claimed) === 1 || Number(s.staff_edited) === 1,
      prod_skip: skips.get(s.id) || null,
      names_shop: mentionsShop({ text: [{ lines: r.lines || [] }], url: r.url, jsonld: [] }, s),
      house_number_on_page: !!(num && ` ${t} `.includes(` ${num} `)),
      street_on_page: !!(street && t.includes(street)),
      city_on_page: t.includes(norm(s.city)),
      doors_on_page: (doors.get(pageKey(s.website)) || new Set()).size,
      hours: r.hours, url: r.url, lines: r.lines,
    });
  }
  fs.writeFileSync(path.join(D, 'recoverable_joined.json'), JSON.stringify(out, null, 1));
  const n = f => out.filter(f).length;
  console.log(`${out.length} joined`);
  console.log(`  page names the shop: ${n(x => x.names_shop)}`);
  console.log(`  house number on the page: ${n(x => x.house_number_on_page)}`);
  console.log(`  street on the page: ${n(x => x.street_on_page)}`);
  console.log(`  name + number + street: ${n(x => x.names_shop && x.house_number_on_page && x.street_on_page)}`);
  console.log(`  already holds hours: ${n(x => x.has_hours_now)}   locked: ${n(x => x.locked)}`);
  console.log(`  names the shop and one door on the page: ${n(x => x.names_shop && x.doors_on_page === 1 && !x.has_hours_now)}`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
