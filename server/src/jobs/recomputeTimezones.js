/**
 * Put every listing back on the clock its door keeps.
 *
 * The zone used to be worked out by longitude, a state at a time, and those
 * lines are not straight: every shop around Chattanooga was filed as Central
 * when the city is Eastern, so its card read "Open until 7pm" an hour after
 * closing. utils/storeHours.js now reads the published zone boundaries, but
 * the stored zones were written by the old rules and are only filled in when
 * empty, so they have to be recomputed once.
 *
 * Only listings whose clock actually moves are listed: a zone renamed without
 * changing its offsets (America/Detroit for America/New_York) is left alone.
 *
 *   node src/jobs/recomputeTimezones.js --out tz.json     # dry run, writes the list
 *   node src/jobs/recomputeTimezones.js --from tz.json --confirm
 */
'use strict';

const fs = require('fs');
const db = require('../database/db');
const { timeZoneFor, zoneFitsState } = require('../utils/storeHours');

/** Minutes east of UTC in a zone at one instant. */
function offsetAt(zone, at) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(at).reduce((o, p) => (o[p.type] = p.value, o), {});
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour) % 24, Number(parts.minute));
  return Math.round((asUtc - at.getTime()) / 60000);
}

/** Does the clock differ at any point in the year? Summer and winter both. */
function clockMoves(a, b) {
  if (a === b) return false;
  const summer = new Date(Date.UTC(2026, 6, 1, 12));
  const winter = new Date(Date.UTC(2026, 0, 15, 12));
  try {
    return offsetAt(a, summer) !== offsetAt(b, summer) || offsetAt(a, winter) !== offsetAt(b, winter);
  } catch { return true; }
}

async function plan({ out, log = console.log } = {}) {
  const rows = await db.all(`
    SELECT id, name, city, state, zip, lat, lng, timezone, visible, hours, hours_source
    FROM stores WHERE lat IS NOT NULL AND lng IS NOT NULL ORDER BY id`);
  const moves = [];
  const suspect = [];
  let renamed = 0;
  for (const s of rows) {
    const zone = timeZoneFor(s.state, s.lat, s.lng);
    if (zone === s.timezone) continue;
    if (!clockMoves(s.timezone || 'America/New_York', zone)) { renamed++; continue; }
    // A zone the state does not keep means the pin is wrong, not the clock.
    // Those wait for the pin sweep rather than taking a zone from a pin nobody
    // trusts yet.
    if (!zoneFitsState(s.state, zone)) {
      suspect.push({ id: s.id, name: s.name, city: s.city, state: s.state, lat: s.lat, lng: s.lng, from: s.timezone, to: zone, visible: s.visible });
      continue;
    }
    let hours = null;
    try { hours = s.hours ? JSON.parse(s.hours) : null; } catch {}
    moves.push({
      id: s.id, name: s.name, city: s.city, state: s.state, lat: s.lat, lng: s.lng,
      from: s.timezone, to: zone, visible: s.visible,
      shows_hours: !!(hours && Object.keys(hours).length), hours_source: s.hours_source,
    });
  }
  log(`${rows.length} listings read; ${moves.length} change clock, ${renamed} only change zone name, ${suspect.length} held back: the pin does not fit the state`);
  for (const m of suspect.filter(m => m.visible === 1)) log(`  held: #${m.id} ${m.name} (${m.city}, ${m.state}) would be ${m.to}`);
  const byState = {};
  for (const m of moves) byState[`${m.state} ${m.from} -> ${m.to}`] = (byState[`${m.state} ${m.from} -> ${m.to}`] || 0) + 1;
  for (const [k, n] of Object.entries(byState).sort((a, b) => b[1] - a[1])) log(`  ${String(n).padStart(4)}  ${k}`);
  const showing = moves.filter(m => m.visible === 1 && m.shows_hours);
  log(`${moves.filter(m => m.visible === 1).length} of them are public, and ${showing.length} of those show hours today`);
  for (const m of showing.slice(0, 25)) log(`  #${m.id} ${m.name} (${m.city}, ${m.state}) ${m.from} -> ${m.to}`);
  if (out) {
    fs.writeFileSync(out, JSON.stringify(moves, null, 1));
    fs.writeFileSync(out.replace(/\.json$/, '_held.json'), JSON.stringify(suspect, null, 1));
    log(`\nwritten to ${out}, with the held-back pins beside it`);
  }
  return moves;
}

async function apply(file, { log = console.log } = {}) {
  const moves = JSON.parse(fs.readFileSync(file, 'utf8'));
  let n = 0;
  for (const m of moves) {
    // Only if the row still holds the zone that was reviewed.
    const r = await db.run(`UPDATE stores SET timezone = ? WHERE id = ? AND timezone IS NOT DISTINCT FROM ?`, [m.to, m.id, m.from]);
    n += r.changes;
  }
  log(`${n} of ${moves.length} listings moved to the clock their door keeps`);
  return { moved: n };
}

module.exports = { plan, apply, clockMoves };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const arg = name => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : null; };
  const { initSchema, runMigrations } = require('../database/schema');
  (async () => {
    await initSchema();
    await runMigrations();
    if (argv.includes('--confirm') && arg('--from')) await apply(arg('--from'));
    else await plan({ out: arg('--out') });
    process.exit(0);
  })().catch(err => { console.error(err); process.exit(1); });
}
