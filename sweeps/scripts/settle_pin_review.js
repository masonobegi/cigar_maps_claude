/**
 * The 59 held pin rows, read and settled.
 *
 * Each was held because one of the five gates failed. Read by hand on
 * 2026-09-12; these are the four groups they fall into, and the verdict each
 * group gets:
 *
 *   agrees      Nominatim backs the pin we already have. The Census was the one
 *               that was wrong: no move, nothing to do. (16 rows)
 *   named       Nominatim answered at house level and names this shop or its
 *               exact street. Held only because the address is a highway, and
 *               the whole point of that rule is that the geocoders disagree
 *               there — here they do not. Move, to Nominatim's own point.
 *   census      the Census matched this address exactly, in this ZIP, on an
 *               ordinary street, and Nominatim had nothing to add. One
 *               geocoder that found the door beats a pin kilometres from it.
 *   leave       everything else: a Non_Exact Census match is a DIFFERENT
 *               address ("8608 Preston Rd" matched "8608 PRESTON MEADOW DR"),
 *               and a highway address with no second opinion is the case the
 *               40%-wrong rule was written for.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'decisions', 'pins');
const rows = JSON.parse(fs.readFileSync(path.join(dir, 'pins_review.json'), 'utf8'));

const held = r => (r.holds || []).join(' | ');
const km = (a, b, c, d) => {
  const R = 6371, rad = x => x * Math.PI / 180;
  const dLat = rad(c - a), dLng = rad(d - b);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

/**
 * The ZIP Nominatim printed, if it printed one. A destination in another
 * postcode is another door: Cigar N Vape is listed at 452 5th Ave in ZIP
 * 11215, which is Park Slope, Brooklyn, and both geocoders answered with 452
 * 5th Avenue in Manhattan, 10018 — nine kilometres away and a different shop's
 * address that happens to be spelled the same.
 */
const zipOfDisplay = d => {
  const m = String(d || '').match(/\b([0-9]{5})\b/g);
  return m ? m[m.length - 1] : null;
};
const zipConflicts = (r, n) => {
  const listed = String(r.zip || '').slice(0, 5);
  const found = zipOfDisplay(n && n.display);
  return !!(listed && found && listed !== found);
};

const out = { agrees: [], named: [], census: [], leave: [] };
for (const r of rows) {
  const h = held(r);
  const n = r.nominatim;
  const exact = r.census && r.census.type === 'Exact';
  const zipOk = r.census && r.zip && String(r.census.zip) === String(r.zip).slice(0, 5);
  const highway = /is a highway address/.test(h);

  if (/Nominatim agrees with the pin/.test(h)) { out.agrees.push(r); continue; }

  // Both geocoders found the same house. The highway rule exists because the
  // two usually disagree there; where they agree to within 250 m they are not
  // guessing, and "330 US-54" is as findable as any other door.
  if (n && n.found !== false && n.level === 'house' && !zipConflicts(r, n) && r.to
      && km(r.to.lat, r.to.lng, n.lat, n.lng) <= 0.25 && r.move_km <= 50) {
    out.named.push({ ...r, verdict: 'move',
      reason: `read on 2026-09-12: both geocoders put this door within `
        + `${Math.round(km(r.to.lat, r.to.lng, n.lat, n.lng) * 1000)} m of each other `
        + `("${String(n.display).slice(0, 70)}"), ${r.move_km} km from the pin we held. `
        + 'Held only because the address is a highway, where the two usually disagree.' });
    continue;
  }

  // Nominatim found the house, and it is this shop's street or its name.
  if (n && n.found !== false && n.level === 'house' && !zipConflicts(r, n)) {
    const street = String(r.address || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(w => w.length > 3)[0];
    const names = String(r.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    const display = String(n.display || '').toLowerCase();
    const shown = display.replace(/[^a-z0-9]+/g, '');
    if ((street && display.includes(street)) || (names.length > 5 && shown.includes(names.slice(0, 8)))) {
      out.named.push({ ...r, verdict: 'move', to: { lat: n.lat, lng: n.lng },
        reason: `read on 2026-09-12: Nominatim puts this door at house level as "${String(n.display).slice(0, 90)}", `
          + `${km(r.from.lat, r.from.lng, n.lat, n.lng).toFixed(1)} km from the pin we held. `
          + (highway ? 'Held only because the address is a highway, where the two geocoders usually disagree — here they do not.' : '') });
      continue;
    }
  }

  // The Census found this exact address in this ZIP, on an ordinary street.
  if (exact && zipOk && !highway && r.move_km <= 50) {
    out.census.push({ ...r, verdict: 'move',
      reason: `read on 2026-09-12: the Census matched "${r.census.matched}" exactly, in this listing's own ZIP, `
        + `${r.move_km} km from the pin we held. Nominatim had nothing to add, and one geocoder that found the door `
        + 'beats a pin kilometres away from it.' });
    continue;
  }

  out.leave.push({ ...r, verdict: 'leave',
    reason: exact ? 'held: ' + h : `the Census matched a different address ("${r.census && r.census.matched}")` });
}

fs.writeFileSync(path.join(dir, 'pins_reviewed.json'), JSON.stringify([...out.named, ...out.census], null, 1));
fs.writeFileSync(path.join(dir, 'pins_left.json'), JSON.stringify([...out.agrees.map(r => ({ ...r, verdict: 'leave',
  reason: 'Nominatim backs the pin we already have: the Census was the one that was wrong' })), ...out.leave], null, 1));

console.log(`no move needed (Nominatim backs our pin): ${out.agrees.length}`);
console.log(`move, Nominatim found the door: ${out.named.length}`);
for (const r of out.named) console.log(`   #${r.id} ${r.name} — ${String(r.nominatim.display).slice(0, 70)}`);
console.log(`move, the Census found the address: ${out.census.length}`);
for (const r of out.census) console.log(`   #${r.id} ${String(r.name).slice(0, 30).padEnd(32)} ${r.move_km} km  ${r.census.matched}`);
console.log(`left for a person: ${out.leave.length}`);
for (const r of out.leave) console.log(`   #${r.id} ${String(r.name).slice(0, 30).padEnd(32)} ${r.reason.slice(0, 90)}`);
