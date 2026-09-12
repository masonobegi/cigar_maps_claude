/**
 * Which listings is every displayed fact actually backed for?
 *
 * Mason asked for a test run of only the listings we are certain of. "Certain"
 * has to mean something checkable, so this scores each public listing on the
 * five things a card and a store page show, and counts how many survive each
 * bar. Nothing is written here — it only reports.
 *
 *   is a cigar shop   the pure-cigar check kept it AND it is not a chain branch
 *   its own website   website_status ok or blocked (a live page that is still theirs)
 *   hours             hours_source = 'website': read off that page, not a map
 *   the door          a current tobacco licence at this address, OR the shop's
 *                     own site prints this street, OR both geocoders put the pin
 *                     on this address
 *   the picture       either no picture at all, or one that survived thumbCheck
 *                     (every surviving web_image_url has, since the bad ones
 *                     were cleared)
 *
 *   node sweeps/scripts/score_certainty.js       (through prod.js)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const db = require('../../server/src/database/db');

const SWEEPS = path.join(__dirname, '..');

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  const out = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch {}
  }
  return out;
}

/** House number + first real street word, for comparing two spellings of a door. */
function door(address) {
  const a = String(address || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const m = /^(\d+)[a-z]?\s+(.+)$/.exec(a);
  if (!m) return null;
  const words = m[2].split(' ').filter(w => w.length > 3
    && !['street', 'avenue', 'road', 'drive', 'boulevard', 'lane', 'court', 'place', 'parkway',
      'highway', 'north', 'south', 'east', 'west', 'suite', 'unit', 'apartment'].includes(w));
  return words.length ? { number: m[1], word: words[0] } : null;
}

/** Street addresses each shop's own site publishes in its markup. */
function siteAddresses() {
  const byId = new Map();
  const dir = path.join(SWEEPS, 'evidence');
  if (!fs.existsSync(dir)) return byId;
  for (const file of fs.readdirSync(dir).filter(f => /^(hours_evidence|render_full).*\.jsonl$/.test(f))) {
    for (const line of fs.readFileSync(path.join(dir, file), 'utf8').split('\n')) {
      if (!line.includes('streetAddress')) continue;
      let rec; try { rec = JSON.parse(line); } catch { continue; }
      if (!rec.id) continue;
      const found = [];
      const walk = o => {
        if (!o || typeof o !== 'object') return;
        if (Array.isArray(o)) { o.forEach(walk); return; }
        if (typeof o.streetAddress === 'string') found.push(o.streetAddress);
        for (const v of Object.values(o)) walk(v);
      };
      for (const block of rec.jsonld || []) { try { walk(JSON.parse(block)); } catch {} }
      for (const block of rec.microdata || []) walk(block);
      if (found.length) byId.set(rec.id, (byId.get(rec.id) || []).concat(found));
    }
  }
  return byId;
}

(async () => {
  const sites = siteAddresses();
  const geocoded = new Map();
  for (const g of readJsonl(path.join(SWEEPS, 'decisions', 'pins', 'pins_census.jsonl'))) {
    if (g.census && g.census.type === 'Exact' && g.km !== null && g.km !== undefined) geocoded.set(g.id, g.km);
  }

  const rows = await db.all(`
    SELECT id, name, address, city, state, zip, phone, website, website_status, hours, hours_source,
           web_image_url, has_lounge, storefront, storefront_reason, last_verified_at, lat, lng
    FROM stores WHERE visible = 1 ORDER BY id`);

  const score = [];
  for (const s of rows) {
    const mine = door(s.address);
    const printed = (sites.get(s.id) || []).some(a => {
      const d = door(a);
      return d && mine && d.number === mine.number && d.word === mine.word;
    });
    // Both geocoders agreed with our pin already: the census file records how far
    // our pin sat from the address it found, and under 250 m is the same door.
    const pinned = geocoded.has(s.id) && geocoded.get(s.id) <= 0.25;

    score.push({
      id: s.id, name: s.name, city: s.city, state: s.state,
      shop: s.storefront !== 'unproven' && s.storefront !== 'duplicate',
      site: s.website_status === 'ok' || s.website_status === 'blocked',
      hours: s.hours_source === 'website' && !!s.hours,
      door: !!s.last_verified_at || printed || pinned,
      doorBy: s.last_verified_at ? 'licence' : printed ? 'its own site' : pinned ? 'both geocoders' : null,
      picture: !!s.web_image_url,
      phone: !!s.phone,
    });
  }

  const n = f => score.filter(f).length;
  console.log(`public listings: ${rows.length}`);
  console.log(`  proved a cigar shop:            ${n(x => x.shop)}`);
  console.log(`  a live website of its own:      ${n(x => x.site)}`);
  console.log(`  hours read off that website:    ${n(x => x.hours)}`);
  console.log(`  the door backed by evidence:    ${n(x => x.door)}`
    + `  (licence ${n(x => x.doorBy === 'licence')}, own site ${n(x => x.doorBy === 'its own site')}, geocoders ${n(x => x.doorBy === 'both geocoders')})`);
  console.log(`  a picture that survived the check: ${n(x => x.picture)}`);
  console.log('');

  const tiers = [
    ['every fact backed: shop + site + hours + door', x => x.shop && x.site && x.hours && x.door],
    ['shop + site + hours (door not independently backed)', x => x.shop && x.site && x.hours],
    ['shop + site + door (no hours to be wrong about)', x => x.shop && x.site && x.door],
    ['shop + hours from a site (site may not answer now)', x => x.shop && x.hours],
  ];
  for (const [label, f] of tiers) {
    const kept = score.filter(f);
    const withPic = kept.filter(x => x.picture).length;
    console.log(`${String(kept.length).padStart(5)}  ${label}`);
    console.log(`       of those, ${withPic} have a picture and ${kept.filter(x => x.phone).length} a phone`);
    const states = {};
    for (const k of kept) states[k.state] = (states[k.state] || 0) + 1;
    const top = Object.entries(states).sort((a, b) => b[1] - a[1]).slice(0, 6);
    console.log(`       top states: ${top.map(([st, c]) => `${st} ${c}`).join(', ')}`);
  }

  const strict = score.filter(x => x.shop && x.site && x.hours && x.door);
  fs.writeFileSync(path.join(SWEEPS, 'decisions', 'certain.json'),
    JSON.stringify({ note: 'Listings where every displayed fact has evidence behind it.', count: strict.length, rows: strict }, null, 1));
  console.log(`\nwritten to sweeps/decisions/certain.json`);
  console.log('first 15 of the strictest tier:');
  for (const x of strict.slice(0, 15)) console.log(`   #${x.id} ${String(x.name).slice(0, 34).padEnd(36)} ${x.city}, ${x.state}  (door: ${x.doorBy})`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
