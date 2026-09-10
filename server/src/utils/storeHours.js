/**
 * Is a shop open right now — on the shop's own clock.
 *
 * Open or closed was worked out three ways: the store list on the visitor's
 * clock, the home page on the server's (UTC), and the profile on the visitor's
 * again. A Miami shop looked at from Camas was judged on Pacific time, and
 * every card rendered on the server was seven or eight hours off. This is the
 * one answer, given in the shop's time zone.
 *
 * Pure functions; the time zone comes from the shop's state and longitude.
 */
'use strict';

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

/**
 * States split between zones. The lines are drawn by longitude (and latitude
 * where a line runs east-west); close enough for a shop's door, which sits a
 * long way from most of these borders.
 */
function splitState(state, lat, lng) {
  const x = Number(lng), y = Number(lat);
  if (!Number.isFinite(x)) return null;
  switch (state) {
    case 'FL': return x < -85.0 ? CENTRAL : EASTERN;                 // the western panhandle
    case 'TN': return x < -85.1 ? CENTRAL : EASTERN;                 // East Tennessee is Eastern
    case 'KY': return x < -86.0 ? CENTRAL : EASTERN;                 // western Kentucky is Central
    case 'IN': return x < -86.9 && (y > 41.0 || y < 38.4) ? CENTRAL : EASTERN; // the Gary and Evansville corners
    case 'MI': return x < -87.6 && y > 45.0 ? CENTRAL : EASTERN;     // the western Upper Peninsula
    case 'TX': return x < -104.9 ? MOUNTAIN : CENTRAL;               // El Paso
    case 'KS': return x < -101.1 ? MOUNTAIN : CENTRAL;
    case 'NE': return x < -101.0 ? MOUNTAIN : CENTRAL;               // the panhandle
    case 'SD': return x < -100.5 ? MOUNTAIN : CENTRAL;               // west river
    case 'ND': return x < -100.8 && y < 47.3 ? MOUNTAIN : CENTRAL;   // the southwest
    case 'ID': return y > 45.5 ? PACIFIC : MOUNTAIN;                 // the panhandle
    case 'OR': return x > -117.6 ? MOUNTAIN : PACIFIC;               // Malheur County
    default: return null;
  }
}

function timeZoneFor(state, lat, lng) {
  const s = String(state || '').toUpperCase();
  return splitState(s, lat, lng) || BY_STATE[s] || splitState(s, lat, lng) || fallbackByLongitude(lng) || EASTERN;
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

/** "10am-7pm" → { open: 600, close: 1140 }. Only the first range of a split day. */
function parseRange(str) {
  const m = String(str || '').match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*[-–]\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  if (!m) return null;
  const toMin = (h, mm, ap) => {
    let hh = Number(h) % 12;
    if (ap.toLowerCase() === 'pm') hh += 12;
    return hh * 60 + Number(mm || 0);
  };
  return { open: toMin(m[1], m[2], m[3]), close: toMin(m[4], m[5], m[6]) };
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

  const r = parseRange(todayStr);
  if (!r) return { isOpen: null, label: null, today: todayStr };
  if (r.open === r.close) return { isOpen: true, label: 'Open 24 hours', today: todayStr };
  const overnight = r.close < r.open;
  if (minutes < r.open) {
    const wait = r.open - minutes;
    return { isOpen: false, label: wait <= 60 ? `Opens in ${wait}m` : `Opens at ${fmt(r.open)}`, today: todayStr };
  }
  if (overnight || minutes < r.close) {
    const left = overnight ? r.close + 1440 - minutes : r.close - minutes;
    return { isOpen: true, label: left <= 45 ? `Closes in ${left}m` : `Open until ${fmt(r.close)}`, today: todayStr };
  }
  return { isOpen: false, label: nextOpening() || 'Closed now', today: todayStr };
}

module.exports = { timeZoneFor, openStatus, nowIn, parseRange };

// ── Self-test ────────────────────────────────────────────────────────────────
if (require.main === module) {
  let pass = 0, fail = 0;
  const ok = (c, l, x) => { if (c) { pass++; console.log('  ok   ' + l); } else { fail++; console.log('  FAIL ' + l + (x !== undefined ? '  -> ' + JSON.stringify(x) : '')); } };

  console.log('time zones:');
  ok(timeZoneFor('AZ', 32.2, -110.9) === 'America/Phoenix', 'Tucson keeps Arizona time');
  ok(timeZoneFor('FL', 30.4, -87.2) === CENTRAL, 'Pensacola is Central');
  ok(timeZoneFor('FL', 25.8, -80.2) === EASTERN, 'Miami is Eastern');
  ok(timeZoneFor('TN', 36.2, -86.8) === CENTRAL && timeZoneFor('TN', 35.9, -83.9) === EASTERN, 'Nashville Central, Knoxville Eastern');
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

  console.log(`\nstoreHours self-test: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
