/**
 * Opening hours, from whatever form a shop or a map writes them in, into the
 * app's { Mon: '10am-7pm', Sun: 'Closed' } shape.
 *
 * Three inputs:
 *   parseOpeningHoursString  OpenStreetMap / schema.org "Mo-Fr 10:00-19:00; Sa 10:00-18:00"
 *   parseSpecification       schema.org openingHoursSpecification objects
 *   parseTextHours           the text a shop prints: "Mon-Sat 10am-8pm, Sun 11am-6pm"
 *
 * A day we are not told about stays unknown. It is never "Closed": "Mon-Fri
 * 9-5" on a contact page says nothing about Saturday, and calling a shop closed
 * when it is open is the worst thing hours can do.
 *
 * Every range passes a sanity check. Overnight hours are real for lounges
 * ("5pm-2am"), so a close before the open is accepted up to 4am; beyond that
 * it is almost always a typo for the afternoon ("10:00-07:00" is 10am-7pm), and
 * anything that still does not make a plausible day is dropped.
 *
 * Pure functions. Self-test:  node src/utils/hoursParser.js
 */
'use strict';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Every way a day gets written, to its index in DAYS.
const DAY_WORDS = [
  ['monday', 0], ['mondays', 0], ['mon', 0], ['mo', 0],
  ['tuesday', 1], ['tuesdays', 1], ['tues', 1], ['tue', 1], ['tu', 1],
  ['wednesday', 2], ['wednesdays', 2], ['weds', 2], ['wed', 2], ['we', 2],
  ['thursday', 3], ['thursdays', 3], ['thurs', 3], ['thur', 3], ['thu', 3], ['th', 3],
  ['friday', 4], ['fridays', 4], ['fri', 4], ['fr', 4],
  ['saturday', 5], ['saturdays', 5], ['sat', 5], ['sa', 5],
  ['sunday', 6], ['sundays', 6], ['sun', 6], ['su', 6],
  // Misspellings shop sites really print ("Monday–thrusday").
  ['thrusday', 3], ['thursay', 3], ['thurday', 3], ['tuseday', 1], ['teusday', 1],
  ['wensday', 2], ['wendsday', 2], ['wednsday', 2], ['wedensday', 2], ['saterday', 5], ['firday', 4],
];
const DAY_INDEX = new Map(DAY_WORDS);
const DAY_ALT = DAY_WORDS.map(([w]) => w).sort((a, b) => b.length - a.length).join('|');
// "Monday through Saturday", "Sun to Wed": a range written in words.
const DAY_WORD_RANGE = new RegExp(`\\b(${DAY_ALT})\\.?\\s+(?:to|thru|through|until|till)\\s+(${DAY_ALT})\\b`, 'g');

// ── Time ───────────────────────────────────────────────────────────────────

/** Minutes since midnight → "10am", "10:30am", "12pm", "12am". */
function fmt(mins) {
  const m = ((mins % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60), mm = m % 60;
  const ap = h24 >= 12 ? 'pm' : 'am';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return mm ? `${h12}:${String(mm).padStart(2, '0')}${ap}` : `${h12}${ap}`;
}

/**
 * A single range, checked. Returns "10am-7pm", "Closed", or null when the
 * range is not a believable day of trading.
 */
function sane(open, close) {
  if (!Number.isFinite(open) || !Number.isFinite(close)) return null;
  if (open === close) return open === 0 ? '12am-12am' : null;           // 24 hours
  // "12 AM – 10 PM": nobody opens at midnight to close at ten at night; it is
  // noon written the way many people write it.
  if (open === 0 && close >= 13 * 60) open = 12 * 60;
  // "11:00 PM – 5:00 PM": an afternoon close after an evening open is the
  // opening hour flipped. Read it as the morning when that makes a real day.
  if (close < open && close >= 720 && open >= 720 && close - (open - 720) >= 120) open -= 720;
  let span = close > open ? close - open : close + 1440 - open;
  if (close < open && close > 240) {
    // Past 4am is not a lounge closing late. A morning close is the afternoon
    // written wrong — "10:00-07:00" means 7pm — but only a morning one: adding
    // twelve hours to "23:00-18:00" makes nothing believable, so it is dropped.
    if (close >= 720) return null;
    const pm = close + 720;
    if (pm > open && pm - open >= 120 && pm - open <= 16 * 60) return `${fmt(open)}-${fmt(pm)}`;
    return null;
  }
  if (span < 60 || span > 20 * 60) return null;
  return `${fmt(open)}-${fmt(close)}`;
}

/** "10:00", "10:00:00", "10:00:00-05:00", "24:00" → minutes. */
function isoMinutes(s) {
  const m = String(s || '').trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return NaN;
  const h = Number(m[1]), mm = Number(m[2]);
  if (h > 24 || mm > 59) return NaN;
  return h === 24 ? 0 : h * 60 + mm;
}

// ── OpenStreetMap / schema.org opening_hours strings ─────────────────────────

const OSM_DAY = '(?:Mo|Tu|We|Th|Fr|Sa|Su)';
const OSM_DAYSPEC = `${OSM_DAY}(?:\\s*-\\s*${OSM_DAY})?(?:\\s*,\\s*${OSM_DAY}(?:\\s*-\\s*${OSM_DAY})?)*`;
const OSM_TIME = '\\d{1,2}:\\d{2}\\s*-\\s*\\d{1,2}:\\d{2}(?:\\s*,\\s*\\d{1,2}:\\d{2}\\s*-\\s*\\d{1,2}:\\d{2})*';
const OSM_RULE = new RegExp(`(${OSM_DAYSPEC})\\s*:?\\s*(${OSM_TIME}|off|closed)`, 'gi');

function osmDays(spec) {
  const out = new Set();
  for (const part of spec.split(',')) {
    const [a, b] = part.split('-').map(s => s.trim().slice(0, 2).toLowerCase());
    const i = DAY_INDEX.get(a);
    if (i === undefined) continue;
    const j = b ? DAY_INDEX.get(b) : i;
    if (j === undefined) continue;
    for (let k = i; ; k = (k + 1) % 7) { out.add(k); if (k === j) break; }
  }
  return [...out];
}

/** Times in a rule; split shifts ("10:00-14:00,16:00-20:00") span first open to last close. */
function osmRange(times) {
  if (/^(off|closed)$/i.test(times.trim())) return 'Closed';
  const pairs = times.split(',').map(p => p.split('-').map(isoMinutes));
  const open = pairs[0][0], close = pairs[pairs.length - 1][1];
  return sane(open, close);
}

function parseOpeningHoursString(input) {
  const out = {};
  const strings = Array.isArray(input) ? input : [input];
  for (const raw of strings) {
    const s = String(raw || '').trim();
    if (!s) continue;
    if (/^24\s*\/\s*7$/.test(s)) { for (const d of DAYS) out[d] = '12am-12am'; continue; }
    // Rules are separated by ";" in the spec and by "," in the wild; the rule
    // pattern itself finds each day spec and its times either way.
    for (const m of s.matchAll(OSM_RULE)) {
      const range = osmRange(m[2]);
      if (!range) continue;
      for (const d of osmDays(m[1])) out[DAYS[d]] = range;
    }
  }
  return Object.keys(out).length ? order(out) : null;
}

// ── schema.org openingHoursSpecification ────────────────────────────────────

function parseSpecification(specs) {
  const out = {};
  const list = Array.isArray(specs) ? specs : [specs];
  for (const sp of list) {
    if (!sp || typeof sp !== 'object') continue;
    // A specification with validity dates is a holiday or a season, not the week.
    if (sp.validFrom || sp.validThrough) continue;
    const days = (Array.isArray(sp.dayOfWeek) ? sp.dayOfWeek : [sp.dayOfWeek])
      .map(d => String(d || '').replace(/^https?:\/\/schema\.org\//i, '').trim().toLowerCase())
      .map(d => DAY_INDEX.get(d.length > 3 ? d : d.slice(0, 2)))
      .filter(i => i !== undefined);
    if (!days.length) continue;
    const open = isoMinutes(sp.opens), close = isoMinutes(sp.closes);
    let range;
    // schema.org's own convention: opens = closes = 00:00 means closed that day.
    if (sp.opens && sp.closes && String(sp.opens).slice(0, 5) === '00:00' && String(sp.closes).slice(0, 5) === '00:00') range = 'Closed';
    else if (String(sp.closes || '').startsWith('23:59') && open === 0) range = '12am-12am';
    else range = sane(open, String(sp.closes || '').startsWith('23:59') ? 0 : close);
    if (!range) continue;
    for (const d of days) out[DAYS[d]] = range;
  }
  return Object.keys(out).length ? order(out) : null;
}

// ── Printed text ─────────────────────────────────────────────────────────────

/** Lowercase, one dash, am/pm spelled one way, words for noon and midnight. */
function normText(s) {
  return ` ${String(s || '')} `
    .toLowerCase()
    .replace(/[–—‒―−]/g, '-')
    .replace(/ /g, ' ')
    .replace(/(\d)\s*(a|p)\.\s*m\.?/g, '$1$2m')                      // "10a.m" -> "10am"
    .replace(/\b(a|p)\.\s*m\.?/g, '$1m')
    .replace(/\b(\d{1,2}):\s+(am|pm)\b/g, '$1$2')                    // "12: pm" → "12pm"
    .replace(/(\d\s*)(am|pm)m\b/g, '$1$2')                           // "12pmm" → "12pm"
    .replace(/\b(?:12\s*)?noon\b/g, '12pm')                          // "noon", "12noon"
    .replace(/\b(?:12\s*)?midnight\b/g, '12am')
    .replace(/\b(\d{1,2})(:\d{2})?\s*(a|p)\b(?!m)/g, '$1$2$3m')      // "12p" → "12pm"
    .replace(/(\d)\s+(am|pm)\b/g, '$1$2')
    .replace(/(\d)\s*-?ish\b/g, '$1')                                  // "5ish" -> "5"
    .replace(DAY_WORD_RANGE, '$1-$2')
    .replace(/\s+(to|thru|through|until|till|til)\s+(?=\d|12)/g, ' - ')
    // "10am/7pm", "10 am ~ 4 pm": other ways of writing a range between times.
    .replace(/(\d(?:am|pm)?)\s*[/~]\s*(?=\d)/g, '$1 - ')
    // Single-letter shorthand that is not ambiguous: "M-F", "M-Th", "M-Sat".
    .replace(/\bm\s*-\s*f\b/g, 'mon-fri')
    .replace(/\bm\s*-\s*th\b/g, 'mon-thu')
    .replace(/\bm\s*-\s*w\b/g, 'mon-wed')
    .replace(/\bf\s*-\s*sa(t)?\b/g, 'fri-sat')
    .replace(/\bf\s*-\s*su(n)?\b/g, 'fri-sun')
    .replace(/\bm\s*-\s*sa(t)?\b/g, 'mon-sat')
    .replace(/\bm\s*-\s*su(n)?\b/g, 'mon-sun')
    .replace(/\b(every\s*day|everyday|7 days a week|seven days a week|7 days|daily)\b/g, ' mon-sun ')
    .replace(/\bweekdays\b/g, ' mon-fri ')
    .replace(/\bweekends?\b/g, ' sat-sun ')
    .replace(/\s+/g, ' ');
}

const T = '(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)?';
// A time is a number standing on its own: not the tail of a phone number or a
// year ("813-621-8702", "10-2026"), and not a price ("$10-20").
const TIME_RANGE = new RegExp(`(?<![\\d$.,/:])${T}\\s*-\\s*${T}(?![\\d%])`, 'g');
const DAY_TOKEN = new RegExp(`\\b(${DAY_ALT})\\.?\\b`, 'g');
const DAY_TOKEN_AT_START = new RegExp(`^(${DAY_ALT})\\.?\\b`);
const HAS_RANGE = new RegExp(TIME_RANGE.source);

/** Turn "10" "7" with missing am/pm into a believable 10am-7pm. */
function inferRange(h1, m1, ap1, h2, m2, ap2) {
  const toMin = (h, m, ap) => {
    let hh = Number(h) % 12;
    if (ap === 'pm') hh += 12;
    return hh * 60 + Number(m || 0);
  };
  if (Number(h1) > 12 || Number(h2) > 12) {
    // A 24-hour clock: take the numbers as written, but only when written as
    // times ("10:00-20:00"). A bare "10-20" is as likely a date or a count.
    if (m1 === undefined || m2 === undefined) return null;
    return sane(Number(h1) * 60 + Number(m1 || 0), (Number(h2) % 24) * 60 + Number(m2 || 0));
  }
  if (!ap1 && !ap2) {
    // Shops open in the morning or at noon and close in the afternoon or evening.
    ap1 = Number(h1) >= 7 && Number(h1) <= 11 ? 'am' : 'pm';
    ap2 = 'pm';
    if (Number(h1) === 12) ap1 = 'pm';
  }
  if (!ap1) ap1 = (Number(h1) >= 7 && Number(h1) <= 11) ? 'am' : (ap2 === 'am' ? 'pm' : ap2);
  if (!ap2) ap2 = 'pm';
  return sane(toMin(h1, m1, ap1), toMin(h2, m2, ap2));
}

/** Day indexes a stretch of text names: "mon-fri", "tue, thu & sat", "sat-sun". */
function textDays(fragment) {
  const tokens = [];
  for (const m of fragment.matchAll(DAY_TOKEN)) {
    // "we" and "th" and "su" are only days in a run of other days.
    tokens.push({ i: DAY_INDEX.get(m[1]), at: m.index, end: m.index + m[0].length, word: m[1] });
  }
  if (!tokens.length) return [];
  const out = new Set();
  for (let k = 0; k < tokens.length; k++) {
    const a = tokens[k], b = tokens[k + 1];
    if (b && /^\s*-\s*$/.test(fragment.slice(a.end, b.at))) {
      for (let d = a.i; ; d = (d + 1) % 7) { out.add(d); if (d === b.i) break; }
      k++;
    } else out.add(a.i);
  }
  return [...out];
}

/**
 * A two-column hours table can arrive column by column: every day label, then
 * every time ("Mon - Sat" / "Sunday" / "10am - 6pm" / "Closed"). A run of
 * k lines that are only days followed by exactly k lines that are only times
 * or "closed" is that table; put each label back beside its value.
 */
function pairColumns(list) {
  const dayOnly = l => textDays(l).length > 0 && !HAS_RANGE.test(l) && !/\bclosed\b/.test(l);
  const valueOnly = l => (HAS_RANGE.test(l) || /^\s*closed\s*$/.test(l)) && textDays(l).length === 0;
  const out = [];
  for (let i = 0; i < list.length;) {
    let k = 0;
    while (i + k < list.length && dayOnly(list[i + k])) k++;
    let v = 0;
    while (k >= 2 && v < k && i + k + v < list.length && valueOnly(list[i + k + v])) v++;
    const nextIsValue = i + k + v < list.length && valueOnly(list[i + k + v]);
    if (k >= 2 && v === k && !nextIsValue) {
      for (let j = 0; j < k; j++) out.push(`${list[i + j]} ${list[i + k + j]}`);
      i += 2 * k;
    } else {
      out.push(list[i]);
      i++;
    }
  }
  return out;
}

/**
 * Hours from printed lines. Each time range is paired with the days written
 * just before it (on the same line, or alone on the line above); "closed"
 * after days marks them closed. Returns the hours and how many rules were read,
 * so a caller can tell one tidy block from a page full of stray times.
 */
function parseTextHours(lines) {
  const out = {};
  let rules = 0;
  // Two different answers for one day in one block means two blocks were read
  // as one (an old hidden block and the current one, a footer and a hours
  // page). Keep the first but report it, so a caller can refuse to guess.
  let conflicts = 0;
  // Not even "Everyday 12pm-2am" then "Fri - Sat 3pm-12am" is read as a
  // default and its exception: at Shaker's the second line was the kitchen's,
  // and at Leaf it was a second business at the same address. Both refused.
  const assign = (d, value) => {
    const k = DAYS[d];
    if (!out[k]) out[k] = value;
    else if (out[k] !== value) conflicts++;
  };
  const list = pairColumns((Array.isArray(lines) ? lines : String(lines || '').split('\n')).map(normText));
  let carriedDays = null;
  // A range with no days of its own, waiting for a days-only next line.
  let pendingValue = null;
  for (const line of list) {
    const pendingFromLastLine = pendingValue;
    pendingValue = null;
    // Split into "days ... time-or-closed" segments by walking the line.
    const events = [];
    for (const m of line.matchAll(TIME_RANGE)) events.push({ kind: 'range', at: m.index, end: m.index + m[0].length, m });
    for (const m of line.matchAll(/\bclosed\b/g)) events.push({ kind: 'closed', at: m.index, end: m.index + m[0].length });
    events.sort((a, b) => a.at - b.at);
    let cursor = 0;
    let lineHadDays = false;
    for (let e = 0; e < events.length; e++) {
      const ev = events[e];
      if (ev.at < cursor) continue;                  // consumed as another range's days
      const before = line.slice(cursor, ev.at);
      let days = textDays(before);
      if (days.length) lineHadDays = true;
      if (!days.length && carriedDays) days = carriedDays;
      // "9AM to 6PM Monday through Friday": the days come after the time.
      if (!days.length && ev.kind === 'range') {
        const next = events[e + 1];
        const after = line.slice(ev.end, next ? next.at : line.length);
        const trailing = textDays(after);
        if (trailing.length) {
          days = trailing;
          lineHadDays = true;
          const value = inferRange(ev.m[1], ev.m[2], ev.m[3], ev.m[4], ev.m[5], ev.m[6]);
          if (value) { for (const d of days) assign(d, value); rules++; }
          carriedDays = null;
          // Skip past the days just used so they are not handed on.
          const lastDay = [...after.matchAll(DAY_TOKEN)].pop();
          cursor = ev.end + (lastDay ? lastDay.index + lastDay[0].length : 0);
          continue;
        }
      }
      if (!days.length && ev.kind === 'closed') {
        // "closed on Sunday", "closed Sundays": the days follow the word.
        const next = events[e + 1];
        const after = line.slice(ev.end, next ? next.at : line.length);
        const lead = after.match(/^\s*(?:on\s+|:\s*|all day\s+)?/)[0].length;
        const trailing = DAY_TOKEN_AT_START.test(after.slice(lead)) ? textDays(after) : [];
        if (trailing.length) {
          for (const d of trailing) assign(d, 'Closed');
          rules++;
          carriedDays = null;
          const lastDay = [...after.matchAll(DAY_TOKEN)].pop();
          cursor = ev.end + (lastDay ? lastDay.index + lastDay[0].length : 0);
          continue;
        }
      }
      if (!days.length) {
        if (ev.kind === 'range') pendingValue = inferRange(ev.m[1], ev.m[2], ev.m[3], ev.m[4], ev.m[5], ev.m[6]);
        cursor = ev.end;
        continue;
      }
      pendingValue = null;
      const value = ev.kind === 'closed' ? 'Closed' : inferRange(ev.m[1], ev.m[2], ev.m[3], ev.m[4], ev.m[5], ev.m[6]);
      if (value) {
        for (const d of days) assign(d, value);
        rules++;
      }
      carriedDays = null;
      cursor = ev.end;
    }
    // A line that is only days ("Monday - Friday") hands them to the next line.
    const tail = textDays(line.slice(cursor));
    if (!events.length && tail.length && pendingFromLastLine) {
      for (const d of tail) assign(d, pendingFromLastLine);
      rules++;
      carriedDays = null;
      continue;
    }
    carriedDays = !events.length && tail.length ? tail : (tail.length && !lineHadDays ? tail : null);
  }
  return Object.keys(out).length ? { hours: order(out), rules, conflicts } : null;
}

// ── Shared ───────────────────────────────────────────────────────────────────

function order(h) {
  const out = {};
  for (const d of DAYS) if (h[d]) out[d] = h[d];
  return out;
}

/**
 * OpenStreetMap and schema.org both define an unlisted day as closed, so
 * "Mo-Sa 10:00-19:00" means shut on Sunday. But a single weekday missing
 * between open days ("Mo-Th …, Sa …, Su …") is nearly always a mapping slip,
 * not a shop that closes on Fridays, and calling it closed would turn people
 * away. So only the plausible closed days are filled in: Sunday, Monday, or a
 * whole weekend. Printed text never goes through this.
 */
function fillClosedPerSpec(hours) {
  if (!hours) return hours;
  const out = { ...hours };
  const missing = DAYS.filter(d => !out[d]);
  const weekendGone = !out.Sat && !out.Sun;
  for (const d of missing) {
    if (d === 'Sun' || d === 'Mon' || (weekendGone && d === 'Sat')) out[d] = 'Closed';
  }
  return order(out);
}

/** Days known, and whether any is open. A result with no open day is no result. */
function describe(hours) {
  if (!hours) return { days: 0, open: 0 };
  const vals = Object.values(hours);
  return { days: vals.length, open: vals.filter(v => v !== 'Closed').length };
}

module.exports = { parseOpeningHoursString, parseSpecification, parseTextHours, fillClosedPerSpec, normText, sane, fmt, describe, DAYS };

// ── Self-test ────────────────────────────────────────────────────────────────
if (require.main === module) {
  let pass = 0, fail = 0;
  const ok = (c, l, x) => { if (c) { pass++; console.log('  ok   ' + l); } else { fail++; console.log('  FAIL ' + l + (x !== undefined ? '  -> ' + JSON.stringify(x) : '')); } };
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  console.log('OpenStreetMap strings our old converter dropped:');
  let h = parseOpeningHoursString('Mo-Th 10:00-22:00, Sa 10:00-00:00, Su 12:00-20:00');
  ok(h && h.Mon === '10am-10pm' && h.Sat === '10am-12am' && h.Sun === '12pm-8pm' && !h.Fri, 'comma-separated rules; Friday left unknown', h);
  h = parseOpeningHoursString('Mo-We,Sa 11:30-17:30, Th-Fr 11:30-20:00');
  ok(h && h.Mon === '11:30am-5:30pm' && h.Sat === '11:30am-5:30pm' && h.Thu === '11:30am-8pm', 'day lists and ranges together', h);
  h = parseOpeningHoursString('Mo closed,Tu-Sa 11:00-19:00, Su 11:00-17:00');
  ok(h && h.Mon === 'Closed' && h.Tue === '11am-7pm', '"Mo closed"', h);
  h = parseOpeningHoursString('Mo-Th 11:00-24:00, Fr 11:00-01:00, Sa 11:00-01:00, Su 14:00-22:00');
  ok(h && h.Mon === '11am-12am' && h.Fri === '11am-1am', '24:00 and a 1am close', h);
  h = parseOpeningHoursString('Mo-Sa 17:00-03:00, Su 21:00-03:00');
  ok(h && h.Mon === '5pm-3am', 'a lounge open past midnight', h);
  h = parseOpeningHoursString('Mo-Sa 10:00-07:00, Su closed');
  ok(h && h.Mon === '10am-7pm' && h.Sun === 'Closed', '"10:00-07:00" is a typo for 7pm', h);
  h = parseOpeningHoursString('Mo-Sa 12:00-08:00, Su 12:00-18:00');
  ok(h && h.Mon === '12pm-8pm', '"12:00-08:00" is 8pm', h);
  h = parseOpeningHoursString('Mo-Th 09:00-21:00, Fr,Sa 09:00-22:00, Su 23:00-18:00');
  ok(h && h.Mon === '9am-9pm' && h.Sun === '11am-6pm', '"23:00-18:00" is an opening hour flipped: 11am-6pm', h);
  ok(sane(23 * 60, 3 * 60) === '11pm-3am', 'a real late night is still a late night');
  h = parseOpeningHoursString(['Mo-We 09:00-19:00', 'Th-Sa 09:00-21:00', 'Su 09:00-19:00']);
  ok(h && Object.keys(h).length === 7 && h.Thu === '9am-9pm', 'schema.org array (Anthony\'s Campbell)', h);
  ok(eq(parseOpeningHoursString('24/7'), { Mon: '12am-12am', Tue: '12am-12am', Wed: '12am-12am', Thu: '12am-12am', Fri: '12am-12am', Sat: '12am-12am', Sun: '12am-12am' }), '24/7');
  h = parseOpeningHoursString('Mo-Fr 10:00-14:00,16:00-20:00');
  ok(h && h.Mon === '10am-8pm', 'a split shift spans first open to last close', h);

  console.log('\nunlisted days, per the OpenStreetMap convention:');
  h = fillClosedPerSpec(parseOpeningHoursString('Mo-Sa 10:00-19:00'));
  ok(h && h.Sun === 'Closed' && h.Sat === '10am-7pm', 'an unlisted Sunday is closed', h);
  h = fillClosedPerSpec(parseOpeningHoursString('Mo-Th 10:00-22:00, Sa 10:00-00:00, Su 12:00-20:00'));
  ok(h && !h.Fri, 'a lone missing Friday stays unknown — a mapping slip, not a closed day', h);
  h = fillClosedPerSpec(parseOpeningHoursString('Mo-Fr 09:00-17:00'));
  ok(h && h.Sat === 'Closed' && h.Sun === 'Closed', 'a missing weekend is closed', h);
  h = fillClosedPerSpec(parseOpeningHoursString('Tu-Sa 11:00-19:00'));
  ok(h && h.Mon === 'Closed' && h.Sun === 'Closed', 'a Tuesday-to-Saturday shop is shut Sunday and Monday', h);

  console.log('\nschema.org openingHoursSpecification:');
  h = parseSpecification([
    { dayOfWeek: ['https://schema.org/Monday', 'Tuesday'], opens: '10:00', closes: '19:00' },
    { dayOfWeek: 'Sunday', opens: '00:00', closes: '00:00' },
    { dayOfWeek: 'Saturday', opens: '11:00:00', closes: '23:59:00' },
  ]);
  ok(h && h.Mon === '10am-7pm' && h.Tue === '10am-7pm' && h.Sun === 'Closed' && h.Sat === '11am-12am', 'URL days, 00:00 closed, 23:59', h);
  ok(parseSpecification([{ dayOfWeek: 'Monday', opens: '10:00', closes: '14:00', validFrom: '2025-12-24' }]) === null, 'a holiday specification is not the week');

  console.log('\nprinted text, from real shop pages:');
  let r = parseTextHours(['Mon-Sat 10am-8pm, Sun 11am-6pm']);
  ok(r && r.hours.Mon === '10am-8pm' && r.hours.Sat === '10am-8pm' && r.hours.Sun === '11am-6pm', 'Anthony\'s contact line', r);
  r = parseTextHours(['Lounge Hours', 'Monday: 11am-8pm', 'Tuesday : 11am-10pm', 'Wednesday : 11am-8pm', 'Thursday : 11am-8pm',
    'Friday: 11am-11pm', 'Saturday: 11am-11pm', 'Sunday : 12p-6pm']);
  ok(r && Object.keys(r.hours).length === 7 && r.hours.Sun === '12pm-6pm' && r.hours.Tue === '11am-10pm', 'Cattleman, one day per line, "12p"', r);
  r = parseTextHours(['Monday - Friday 9 am to 5 pm EST']);
  ok(r && r.hours.Mon === '9am-5pm' && r.hours.Fri === '9am-5pm' && !r.hours.Sat, '"9 am to 5 pm"; the weekend stays unknown, not closed', r);
  r = parseTextHours(['MON-FRI 9AM-5PM Easter Time']);
  ok(r && r.hours.Wed === '9am-5pm', 'capitals', r);
  r = parseTextHours(['Hours: Mon–Thu 10–8 | Fri–Sat 10–10 | Sun 12–6']);
  ok(r && r.hours.Mon === '10am-8pm' && r.hours.Fri === '10am-10pm' && r.hours.Sun === '12pm-6pm', 'no am/pm at all', r);
  r = parseTextHours(['Open Daily 10am - 9pm']);
  ok(r && Object.keys(r.hours).length === 7, '"daily"', r);
  r = parseTextHours(['Tues - Sat: 11:00 AM - 7:00 PM', 'Sunday Closed', 'Monday Closed']);
  ok(r && r.hours.Tue === '11am-7pm' && r.hours.Sun === 'Closed' && r.hours.Mon === 'Closed', 'closed days named', r);
  r = parseTextHours(['Mon - Sat 9:00am - 9:00pm Sun 10:00am - 6:00pm']);
  ok(r && r.hours.Sat === '9am-9pm' && r.hours.Sun === '10am-6pm', 'two rules on a line with no comma', r);
  r = parseTextHours(['Monday–Saturday: 10 a.m. – 8 p.m.']);
  ok(r && r.hours.Mon === '10am-8pm', '"a.m." and an en dash', r);
  r = parseTextHours(['Friday & Saturday: Noon - Midnight']);
  ok(r && r.hours.Fri === '12pm-12am' && r.hours.Sat === '12pm-12am', 'noon to midnight, "&"', r);
  r = parseTextHours(['Monday - Friday', '10am - 7pm', 'Saturday', '10am - 5pm']);
  ok(r && r.hours.Mon === '10am-7pm' && r.hours.Sat === '10am-5pm', 'days on one line, times on the next', r);
  r = parseTextHours(['Open 7 days a week 9am-10pm']);
  ok(r && r.hours.Sun === '9am-10pm', '"7 days a week"', r);
  r = parseTextHours(['Call us at (813) 621-8702']);
  ok(r === null, 'a phone number is not hours', r);

  console.log('\nformats the first sweep missed, from real pages:');
  r = parseTextHours(['9AM to 6PM Monday through Friday']);
  ok(r && r.hours.Mon === '9am-6pm' && r.hours.Fri === '9am-6pm', 'time before the days', r);
  r = parseTextHours(['12 P.M. - 6 P.M. Sunday']);
  ok(r && r.hours.Sun === '12pm-6pm', 'time before a single day', r);
  r = parseTextHours(['9:00 AM – 10:00 PM MON – SAT']);
  ok(r && r.hours.Mon === '9am-10pm' && r.hours.Sat === '9am-10pm', 'time before a day range, in capitals', r);
  r = parseTextHours(['8:00 a.m. - 3:00 p.m. - Monday, Tuesday, Thursday, Friday']);
  ok(r && r.hours.Tue === '8am-3pm' && !r.hours.Wed, 'time before a day list; the missing day stays unknown', r);
  r = parseTextHours(['Sunday 12noon - 7pm']);
  ok(r && r.hours.Sun === '12pm-7pm', '"12noon"', r);
  r = parseTextHours(['Monday through Friday : 10am/7pm']);
  ok(r && r.hours.Mon === '10am-7pm', '"10am/7pm"', r);
  r = parseTextHours(['Friday & Saturday 10 am ~ 4 pm']);
  ok(r && r.hours.Fri === '10am-4pm', '"~" between times', r);
  r = parseTextHours(['Fri - Sat 12: PM to 12AM']);
  ok(r && r.hours.Fri === '12pm-12am', '"12: PM" typo', r);
  r = parseTextHours(['Friday & Saturday: 12pmm – 12am']);
  ok(r && r.hours.Sat === '12pm-12am', '"12pmm" typo', r);
  r = parseTextHours(['Sunday 11:00 PM – 5:00 PM']);
  ok(r && r.hours.Sun === '11am-5pm', 'a flipped opening hour is read as the morning', r);
  r = parseTextHours(['Sunday – Thursday: 12 AM – 10 PM']);
  ok(r && r.hours.Sun === '12pm-10pm', '"12 AM" opening before a 10pm close is noon', r);
  r = parseTextHours(['Monday - Friday call 813-621-8702']);
  ok(r === null, 'a phone number beside days is still not hours', r);
  r = parseTextHours(['Monday–thrusday', '9am–10pm', 'Friday–Saturday', '9am–11pm']);
  ok(r && r.hours.Tue === '9am-10pm' && r.hours.Thu === '9am-10pm' && r.hours.Sat === '9am-11pm', '"thrusday" is Thursday (Puff Puff Tobacco)', r);
  r = parseTextHours(['9am to 9pm M-W', '9am to 10pm Th - Fr - Sat', '10am to 7pm Sun']);
  ok(r && r.hours.Mon === '9am-9pm' && r.hours.Wed === '9am-9pm' && r.hours.Thu === '9am-10pm' && r.hours.Sun === '10am-7pm', '"M-W" is Monday to Wednesday (The Cigar Shop)', r);
  r = parseTextHours(['Store Hours', 'Monday - Thursday', '10a.m - 8p.m', 'Friday & Saturday', '10a.m - 8p.m', 'Sunday', '12p.m - 6p.m']);
  ok(r && r.hours.Mon === '10am-8pm' && r.hours.Sat === '10am-8pm' && r.hours.Sun === '12pm-6pm', '"10a.m" is 10am (Heights Cigar Lounge)', r);
  r = parseTextHours(['Monday Closed, Members access', 'Tuesday Closed, Members access', 'Wednesday 12-8', 'Thursday 12-8', 'Friday 12-8', 'Saturday 12-7', 'Sunday 12-5', 'Members only access 10am-10pm Daily']);
  ok(r && r.conflicts > 0, 'a per-day table and an every-day line are a conflict (Top Gun)', r);
  r = parseTextHours(['Open daily 10am-9pm', 'Sunday 12pm-6pm']);
  ok(r && r.conflicts > 0, '"daily" then another Sunday is refused, not guessed', r);
  r = parseTextHours(['Hours', 'Everyday: 12:00 PM - 2:00 AM', 'Fri - Sat : 3:00 PM - 12:00 AM']);
  ok(r && r.conflicts > 0, 'kitchen hours under the bar hours are a conflict (Shakers)', r);
  r = parseTextHours(['Open Monday through Saturday from 10 a.m. to 6 p.m.; closed on Sunday.', 'Mon - Sat', 'Sunday', '10am - 6pm', 'Closed']);
  ok(r && !r.conflicts && r.hours.Mon === '10am-6pm' && r.hours.Sat === '10am-6pm' && r.hours.Sun === 'Closed', '"through", "closed on Sunday" and a table read by columns (King Street)', r);
  r = parseTextHours(['Store hours @ DC Ranch:', 'Open 10am to 10pm Sun to Wed', '10am to 11pm Thur to Sat', 'Store hours @ Terravita:', 'Open daily 10am to 8pm']);
  ok(r && r.conflicts > 0, 'two stores on one page are a conflict (Cedar Room)', r);
  r = parseTextHours(['Open 10am to 10pm Sun to Wed', '10am to 11pm Thur to Sat']);
  ok(r && r.hours.Sun === '10am-10pm' && r.hours.Tue === '10am-10pm' && r.hours.Fri === '10am-11pm', '"Sun to Wed" is a range', r);
  r = parseTextHours(['Monday', '9am-5pm', 'Tuesday', '9am-5pm', 'Wednesday', '9am-6pm']);
  ok(r && r.hours.Mon === '9am-5pm' && r.hours.Wed === '9am-6pm' && !r.conflicts, 'a table read row by row is untouched', r);
  r = parseTextHours(['Mon-Sat 10am-9pm', 'Mon-Fri 10am-8pm']);
  ok(r && r.conflicts > 0, 'two partial rules that disagree are still a conflict', r);
  r = parseTextHours(['Store Open 11:30 to 7:00', '(Mon-Sat)', '11:00-5:00 (Sun)']);
  ok(r && r.hours.Mon === '11:30am-7pm' && r.hours.Sat === '11:30am-7pm' && r.hours.Sun === '11am-5pm', 'days on the line after their time (Sequoia Cigar)', r);
  r = parseTextHours(['Mon - Sat 10am - 9pm', 'Sun 10am - 5ish']);
  ok(r && r.hours.Sun === '10am-5pm', '"5ish" is 5pm (Cigar World)', r);
  r = parseTextHours(['Hours', 'Mon - Fri', '9-5', 'Sat', '10-4']);
  ok(r && r.hours.Mon === '9am-5pm' && r.hours.Sat === '10am-4pm', 'days above their time still pair downward', r);
  r = parseTextHours(['M-F 11-6pm, Sat 12-6pm, Sun 12-6pm']);
  ok(r && r.hours.Mon === '11am-6pm' && r.hours.Fri === '11am-6pm' && r.hours.Sun === '12pm-6pm', '"M-F" is Monday to Friday (Freedom Fine Cigars)', r);
  r = parseTextHours(['9am-8pm Mon-Sat 10am-7pm Sun']);
  ok(r && r.hours.Sat === '9am-8pm' && r.hours.Sun === '10am-7pm' && !r.conflicts, 'times before days, two rules (Cigar Empire)', r);
  r = parseTextHours(['Mon-Wed 3p-10p', 'Mon-Wed 11a-11p']);
  ok(r && r.conflicts > 0, 'two answers for one day are reported as a conflict (Fuma\'s hidden block)', r);
  r = parseTextHours(['Friday Nov 10-2026 grand opening']);
  ok(r === null, 'a date is not hours', r);
  r = parseTextHours(['Saturday special: cigars $10-20 off']);
  ok(r === null, 'a price is not hours', r);
  r = parseTextHours(['Established 2008. Over 200 cigars in our walk-in humidor.']);
  ok(r === null, 'prose is not hours', r);

  console.log(`\nhoursParser self-test: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
