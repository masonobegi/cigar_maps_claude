/**
 * Is a shop open right now — on the shop's own clock.
 *
 * Open or closed was worked out three ways: the store list on the visitor's
 * clock, the home page on the server's (UTC), and the profile on the visitor's
 * again. A Miami shop looked at from Camas was judged on Pacific time, and
 * every card rendered on the server was seven or eight hours off. This is the
 * one answer, given in the shop's time zone.
 *
 * Pure functions; the time zone comes from the shop's own coordinates.
 */
'use strict';

const { find: zonesAtPoint } = require('geo-tz');

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const EASTERN = 'America/New_York', CENTRAL = 'America/Chicago', MOUNTAIN = 'America/Denver', PACIFIC = 'America/Los_Angeles';

const BY_STATE = {
  CT: EASTERN, DC: EASTERN, DE: EASTERN, GA: EASTERN, MA: EASTERN, MD: EASTERN, ME: EASTERN, NC: EASTERN,
  NH: EASTERN, NJ: EASTERN, NY: EASTERN, OH: EASTERN, PA: EASTERN, RI: EASTERN, SC: EASTERN, VA: EASTERN,
  VT: EASTERN, WV: EASTERN,
  AL: CENTRAL, AR: CENTRAL, IA: CENTRAL, IL: CENTRAL, LA: CENTRAL, MN: CENTRAL, MO: CENTRAL, MS: CENTRAL,
  OK: CENTRAL, WI: CENTRAL,
  CO: MOUNTAIN, MT: MOUNTAIN, NM: MOUNTAIN, UT: MOUNTAIN, WY: MOUNTAIN,
  CA: PACIFIC, NV: PACIFIC, WA: PACIFIC,
  AZ: 'America/Phoenix', AK: 'America/Anchorage', HI: 'Pacific/Honolulu', PR: 'America/Puerto_Rico',
};

// Every zone the United States keeps, including the ones a state shares.
// A pin just over a border returns its neighbour's zone (Houlton, Maine sits
// in America/Moncton), so only these count; anything else falls back to the
// state.
const US_ZONES = new Set([
  EASTERN, CENTRAL, MOUNTAIN, PACIFIC, 'America/Phoenix', 'America/Detroit', 'America/Menominee',
  'America/Kentucky/Louisville', 'America/Kentucky/Monticello', 'America/Boise',
  'America/Indiana/Indianapolis', 'America/Indiana/Vincennes', 'America/Indiana/Winamac',
  'America/Indiana/Marengo', 'America/Indiana/Petersburg', 'America/Indiana/Vevay',
  'America/Indiana/Tell_City', 'America/Indiana/Knox',
  'America/North_Dakota/Center', 'America/North_Dakota/New_Salem', 'America/North_Dakota/Beulah',
  'America/Anchorage', 'America/Juneau', 'America/Sitka', 'America/Yakutat', 'America/Nome',
  'America/Adak', 'America/Metlakatla', 'Pacific/Honolulu', 'America/Puerto_Rico',
]);

/**
 * The zone a pin actually stands in, from the published zone boundaries.
 *
 * This used to be drawn by longitude, a state at a time, and the lines are not
 * straight: Chattanooga is Eastern while Crossville, half a degree east of it,
 * is Central; Houghton in the Upper Peninsula is Eastern while Menominee is
 * Central. Every shop in the Chattanooga area was therefore an hour out, and
 * its card said "Open until 7pm" while the door was locked.
 */
function zoneAt(lat, lng) {
  const y = Number(lat), x = Number(lng);
  if (!Number.isFinite(y) || !Number.isFinite(x)) return null;
  let zones = [];
  try { zones = zonesAtPoint(y, x) || []; } catch { return null; }
  return zones.find(z => US_ZONES.has(z)) || null;
}

function timeZoneFor(state, lat, lng) {
  const s = String(state || '').toUpperCase();
  return zoneAt(lat, lng) || BY_STATE[s] || fallbackByLongitude(lng) || EASTERN;
}

/**
 * The zones each state keeps, so a pin can be checked against the address it
 * claims. A Georgia listing whose pin lands in Central time is a pin sitting in
 * Alabama, not a Georgia shop on Central time. Alabama carries Eastern because
 * Phenix City works to Columbus, Georgia's clock.
 */
const INDIANA = ['America/Indiana/Indianapolis', 'America/Indiana/Vincennes', 'America/Indiana/Winamac',
  'America/Indiana/Marengo', 'America/Indiana/Petersburg', 'America/Indiana/Vevay',
  'America/Indiana/Tell_City', 'America/Indiana/Knox'];
const DAKOTA = ['America/North_Dakota/Center', 'America/North_Dakota/New_Salem', 'America/North_Dakota/Beulah'];
const ZONES_IN_STATE = {
  CT: [EASTERN], DC: [EASTERN], DE: [EASTERN], GA: [EASTERN], MA: [EASTERN], MD: [EASTERN], ME: [EASTERN],
  NC: [EASTERN], NH: [EASTERN], NJ: [EASTERN], NY: [EASTERN], OH: [EASTERN], PA: [EASTERN], RI: [EASTERN],
  SC: [EASTERN], VA: [EASTERN], VT: [EASTERN], WV: [EASTERN],
  AR: [CENTRAL], IA: [CENTRAL], IL: [CENTRAL], LA: [CENTRAL], MN: [CENTRAL], MO: [CENTRAL], MS: [CENTRAL],
  OK: [CENTRAL], WI: [CENTRAL],
  AL: [CENTRAL, EASTERN], FL: [EASTERN, CENTRAL], TN: [EASTERN, CENTRAL],
  KY: [EASTERN, CENTRAL, 'America/Kentucky/Louisville', 'America/Kentucky/Monticello'],
  MI: [EASTERN, 'America/Detroit', CENTRAL, 'America/Menominee'],
  IN: [EASTERN, CENTRAL, ...INDIANA],
  KS: [CENTRAL, MOUNTAIN], NE: [CENTRAL, MOUNTAIN], SD: [CENTRAL, MOUNTAIN], TX: [CENTRAL, MOUNTAIN],
  ND: [CENTRAL, MOUNTAIN, ...DAKOTA],
  CO: [MOUNTAIN], MT: [MOUNTAIN], NM: [MOUNTAIN], UT: [MOUNTAIN], WY: [MOUNTAIN],
  ID: [MOUNTAIN, 'America/Boise', PACIFIC], OR: [PACIFIC, MOUNTAIN, 'America/Boise'],
  NV: [PACIFIC, MOUNTAIN], AZ: ['America/Phoenix', MOUNTAIN],
  CA: [PACIFIC], WA: [PACIFIC],
  AK: ['America/Anchorage', 'America/Juneau', 'America/Sitka', 'America/Yakutat', 'America/Nome', 'America/Adak', 'America/Metlakatla'],
  HI: ['Pacific/Honolulu'], PR: ['America/Puerto_Rico'],
};

/** Could a shop at this address really keep this zone? */
function zoneFitsState(state, zone) {
  const list = ZONES_IN_STATE[String(state || '').toUpperCase()];
  return !list || list.includes(zone);
}

/** When the state is missing or odd, longitude alone is a decent guess. */
function fallbackByLongitude(lng) {
  const x = Number(lng);
  if (!Number.isFinite(x)) return null;
  if (x < -114.5) return PACIFIC;
  if (x < -102) return MOUNTAIN;
  if (x < -86) return CENTRAL;
  return EASTERN;
}

/** The day and minute of the day it is now in a zone. */
function nowIn(timeZone, at = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(at);
  const get = t => (parts.find(p => p.type === t) || {}).value;
  return { day: DAY_NAMES.indexOf(get('weekday')), minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

const RANGE = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*[-–]\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)/ig;

/**
 * Every range in a day, in the order written.
 * "12pm-6pm, 7pm-10pm" → [{open: 720, close: 1080}, {open: 1140, close: 1320}].
 *
 * Shops that shut between a day trade and an evening lounge write both. Reading
 * only the first says they are closed all evening; reading first-open to
 * last-close says they are open through a locked hour. So keep them apart.
 */
function parseRanges(str) {
  const toMin = (h, mm, ap) => {
    let hh = Number(h) % 12;
    if (ap.toLowerCase() === 'pm') hh += 12;
    return hh * 60 + Number(mm || 0);
  };
  const out = [];
  for (const m of String(str || '').matchAll(RANGE)) {
    out.push({ open: toMin(m[1], m[2], m[3]), close: toMin(m[4], m[5], m[6]) });
  }
  return out;
}

/** "10am-7pm" → { open: 600, close: 1140 }. The first range of a split day. */
function parseRange(str) {
  return parseRanges(str)[0] || null;
}

const fmt = mins => {
  const m = ((mins % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60), mm = m % 60;
  const ap = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return mm ? `${h12}:${String(mm).padStart(2, '0')}${ap}` : `${h12}${ap}`;
};

function parseHours(hours) {
  if (!hours) return null;
  if (typeof hours === 'string') { try { hours = JSON.parse(hours); } catch { return null; } }
  if (typeof hours !== 'object') return null;
  return Object.values(hours).some(v => v && String(v).trim()) ? hours : null;
}

/**
 * { isOpen, label, today } for a shop right now.
 *   isOpen  true / false, or null when we do not know its hours
 *   label   "Open until 7pm", "Opens at 10am", "Opens tomorrow at 11am", …
 *   today   today's hours as written ("10am-7pm", "Closed"), or null
 *
 * Unknown hours give null throughout. Never "Closed" for a day we were not
 * told about.
 */
function openStatus(hoursInput, timeZone, at = new Date()) {
  const hours = parseHours(hoursInput);
  if (!hours) return { isOpen: null, label: null, today: null };
  const { day, minutes } = nowIn(timeZone || EASTERN, at);
  const todayKey = DAY_NAMES[day];
  const yesterdayKey = DAY_NAMES[(day + 6) % 7];
  const todayStr = hours[todayKey] || null;

  // Still inside last night's late close ("5pm-2am", and it is 1am).
  const y = parseRange(hours[yesterdayKey]);
  if (y && y.close < y.open && minutes < y.close) {
    return { isOpen: true, label: `Open until ${fmt(y.close)}`, today: todayStr };
  }

  if (!todayStr) return { isOpen: null, label: null, today: null };

  const nextOpening = () => {
    for (let d = 1; d <= 7; d++) {
      const key = DAY_NAMES[(day + d) % 7];
      const r = parseRange(hours[key]);
      if (r) return `Opens ${d === 1 ? 'tomorrow' : key} at ${fmt(r.open)}`;
      if (!hours[key]) return null;          // an unknown day: say no more than we know
    }
    return null;
  };

  if (/^closed$/i.test(todayStr.trim())) return { isOpen: false, label: nextOpening() || 'Closed today', today: todayStr };

  const ranges = parseRanges(todayStr);
  if (!ranges.length) return { isOpen: null, label: null, today: todayStr };
  if (ranges[0].open === ranges[0].close) return { isOpen: true, label: 'Open 24 hours', today: todayStr };

  // Open now, in any of today's shifts.
  for (const r of ranges) {
    const overnight = r.close < r.open;
    if (minutes < r.open) continue;
    if (overnight || minutes < r.close) {
      const left = overnight ? r.close + 1440 - minutes : r.close - minutes;
      return { isOpen: true, label: left <= 45 ? `Closes in ${left}m` : `Open until ${fmt(r.close)}`, today: todayStr };
    }
  }
  // Shut for now, but a later shift today still opens.
  const later = ranges.find(r => minutes < r.open);
  if (later) {
    const wait = later.open - minutes;
    return { isOpen: false, label: wait <= 60 ? `Opens in ${wait}m` : `Opens at ${fmt(later.open)}`, today: todayStr };
  }
  return { isOpen: false, label: nextOpening() || 'Closed now', today: todayStr };
}

module.exports = { timeZoneFor, zoneFitsState, openStatus, nowIn, parseRange };

// ── Self-test ────────────────────────────────────────────────────────────────
if (require.main === module) {
  let pass = 0, fail = 0;
  const ok = (c, l, x) => { if (c) { pass++; console.log('  ok   ' + l); } else { fail++; console.log('  FAIL ' + l + (x !== undefined ? '  -> ' + JSON.stringify(x) : '')); } };

  console.log('time zones:');
  ok(timeZoneFor('AZ', 32.2, -110.9) === 'America/Phoenix', 'Tucson keeps Arizona time');
  ok(timeZoneFor('FL', 30.4, -87.2) === CENTRAL, 'Pensacola is Central');
  ok(timeZoneFor('FL', 25.8, -80.2) === EASTERN, 'Miami is Eastern');
  ok(timeZoneFor('TN', 36.2, -86.8) === CENTRAL && timeZoneFor('TN', 35.9, -83.9) === EASTERN, 'Nashville Central, Knoxville Eastern');
  // The lines the old longitude rules cut through, town by town.
  ok(timeZoneFor('TN', 35.0456, -85.3097) === EASTERN, 'Chattanooga is Eastern');
  ok(timeZoneFor('TN', 35.9487, -85.0269) === CENTRAL, 'Crossville is Central, though it lies east of Chattanooga');
  ok(timeZoneFor('MI', 47.1211, -88.5694) === 'America/Detroit', 'Houghton keeps Eastern in the Upper Peninsula');
  ok(timeZoneFor('MI', 45.1077, -87.6142) === 'America/Menominee', 'Menominee is Central');
  ok(timeZoneFor('MI', 46.4953, -84.3453) === 'America/Detroit', 'Sault Ste. Marie is Eastern, not Canadian');
  ok(timeZoneFor('IN', 41.7075, -86.8950) === CENTRAL, 'Michigan City is Central');
  ok(timeZoneFor('KY', 36.9959, -85.9119) === CENTRAL, 'Glasgow is Central');
  ok(timeZoneFor('ND', 46.8267, -100.8896) === 'America/North_Dakota/New_Salem', 'Mandan keeps Central time');
  // McKenzie County keeps Central with the rest of the oil patch, and the
  // Idaho panhandle keeps Pacific well east of Coeur d'Alene. A rounded grid
  // got both wrong, so the boundaries themselves are read.
  ok(timeZoneFor('ND', 47.8022, -103.2832) === CENTRAL, 'Watford City is Central');
  ok(timeZoneFor('ND', 48.1557, -103.6264) === CENTRAL, 'Williston is Central');
  ok(timeZoneFor('ID', 47.5397, -116.1214) === PACIFIC, 'Kellogg is Pacific');
  ok(timeZoneFor('ID', 48.6380, -116.0575) === PACIFIC, 'Moyie Springs is Pacific');
  ok(timeZoneFor('TN', 35.7032, -84.8509) === EASTERN, 'Spring City is Eastern');
  ok(timeZoneFor('AL', 32.4710, -85.0008) === EASTERN, 'Phenix City keeps Columbus, Georgia time');
  ok(timeZoneFor('ME', 46.1262, -67.8403) === EASTERN, 'Houlton falls back to its state, not America/Moncton');
  ok(timeZoneFor('TX', 31.7619, -106.4850) === MOUNTAIN && timeZoneFor('TX', 29.76, -95.37) === CENTRAL, 'El Paso Mountain, Houston Central');
  // Malheur County keeps Mountain time under Idaho's zone name.
  ok(timeZoneFor('OR', 44.05, -117.0) === 'America/Boise' && timeZoneFor('OR', 45.52, -122.68) === PACIFIC, 'Malheur County Mountain, Portland Pacific');
  ok(timeZoneFor('ID', 47.68, -116.78) === PACIFIC && timeZoneFor('ID', 43.61, -116.20) === 'America/Boise', 'the Idaho panhandle is Pacific, Boise is Mountain');
  ok(timeZoneFor('FL', 30.4213, -87.2169) === CENTRAL && timeZoneFor('FL', 25.77, -80.19) === EASTERN, 'Pensacola Central, Miami Eastern');
  ok(timeZoneFor('XX', null, null) === EASTERN && timeZoneFor('CA', null, null) === PACIFIC, 'no pin: the state, then the coast');
  ok(timeZoneFor('TX', 31.8, -106.4) === MOUNTAIN && timeZoneFor('TX', 29.8, -95.4) === CENTRAL, 'El Paso Mountain, Houston Central');
  ok(timeZoneFor('WA', 45.6, -122.4) === PACIFIC, 'Camas is Pacific');
  ok(timeZoneFor('', null, -122.4) === PACIFIC, 'no state: longitude decides');

  // Thursday 10 September 2026, 21:30 UTC = 2:30pm in Tucson, 5:30pm in Miami.
  const at = new Date('2026-09-10T21:30:00Z');
  const hours = { Mon: '10am-7pm', Tue: '10am-7pm', Wed: '10am-7pm', Thu: '10am-7pm', Fri: '10am-7pm', Sat: '10am-7pm', Sun: 'Closed' };

  console.log('\nopen or closed, on the shop\'s clock:');
  let s = openStatus(hours, 'America/Phoenix', at);
  ok(s.isOpen === true && s.label === 'Open until 7pm', 'Tucson at 2:30pm is open', s);
  s = openStatus({ ...hours, Thu: '10am-5pm' }, 'America/New_York', at);
  ok(s.isOpen === false && s.label === 'Opens tomorrow at 10am', 'Miami at 5:30pm, after a 5pm close, is closed', s);
  s = openStatus({}, 'America/Phoenix', at);
  ok(s.isOpen === null && s.label === null, 'no hours is unknown, never "Closed today"', s);
  s = openStatus({ Mon: '10am-7pm' }, 'America/Phoenix', at);
  ok(s.isOpen === null, 'hours for other days only: today is unknown', s);
  s = openStatus({ Wed: '5pm-2am', Thu: '5pm-2am' }, 'America/New_York', new Date('2026-09-11T05:30:00Z'));
  ok(s.isOpen === true && s.label === 'Open until 2am', 'a lounge at 1:30am, still inside last night', s);
  s = openStatus({ Thu: 'Closed', Fri: '11am-8pm' }, 'America/Phoenix', at);
  ok(s.isOpen === false && s.label === 'Opens tomorrow at 11am', 'closed today, opens tomorrow', s);
  s = openStatus({ Thu: '12am-12am' }, 'America/Phoenix', at);
  ok(s.isOpen === true && s.label === 'Open 24 hours', 'open 24 hours', s);
  s = openStatus('{"Thu":"10am-7pm"}', 'America/Phoenix', at);
  ok(s.isOpen === true, 'hours as stored JSON text', s);

  // A split shift: a day trade, a break, an evening lounge. 2:30pm Tucson.
  const split = { Thu: '12pm-2pm, 5pm-10pm' };
  s = openStatus(split, 'America/Phoenix', at);
  ok(s.isOpen === false && s.label === 'Opens at 5pm', 'inside the break, the evening shift is what opens next', s);
  s = openStatus({ Thu: '12pm-3pm, 5pm-10pm' }, 'America/Phoenix', at);
  ok(s.isOpen === true && s.label === 'Closes in 30m', 'the first shift is still running', s);
  s = openStatus({ Thu: '9am-11am, 1pm-9pm' }, 'America/Phoenix', at);
  ok(s.isOpen === true && s.label === 'Open until 9pm', 'the second shift has started', s);
  s = openStatus({ Thu: '9am-11am, 12pm-1pm', Fri: '10am-6pm' }, 'America/Phoenix', at);
  ok(s.isOpen === false && s.label === 'Opens tomorrow at 10am', 'both shifts done for the day', s);
  ok(parseRange('12pm-6pm, 7pm-10pm').close === 1080, 'parseRange still reads only the first shift', parseRange('12pm-6pm, 7pm-10pm'));

  console.log(`\nstoreHours self-test: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
