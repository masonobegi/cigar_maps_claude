/**
 * Is the pin at the address we publish?
 *
 * 153 public pins sit more than a kilometre from the Census geocode of their
 * own address, and about 100-130 of those are real errors: Tobacco Junction of
 * Marshall is 404 km off, Amsterdam Tobacco House is pinned on Long Island,
 * Black Jack's Cigar Lounge is in El Paso and listed in New London,
 * Connecticut. A wrong pin is worse than a missing one — it sends a customer to
 * a door that is not there and makes every distance in the list a lie.
 *
 * Two free geocoders, and a pin is only moved automatically when both agree
 * with each other and disagree with us:
 *
 *   - the Census batch geocoder, which is free and has no rate limit worth the
 *     name, over every public address;
 *   - Nominatim, one request a second, as a second opinion and ONLY where the
 *     Census result is more than a kilometre from our pin. Asking it about
 *     every listing would take a day and would be rude.
 *
 * Everything the automatic tier will not take goes to a review list with its
 * evidence attached, because a geocoder is confidently wrong often enough that
 * a rule alone cannot be trusted — on highway-style addresses, about 40% of the
 * time, which is why those are excluded outright.
 *
 *   node src/jobs/geocodePins.js read    --out pins_evidence.jsonl
 *   node src/jobs/geocodePins.js decide  --from pins_evidence.jsonl --out pins.json
 *   node src/jobs/geocodePins.js apply   --from pins.json --confirm
 *   node src/jobs/geocodePins.js selftest
 *
 * `read` is resumable: it skips ids already in the output file.
 */
'use strict';

const fs = require('fs');
const https = require('https');
const querystring = require('querystring');

const AUTO_AGREE_M = 250;      // how close the two geocoders must be to each other
const MIN_MOVE_M = 1000;       // below this the pin is close enough; leave it alone
const MAX_MOVE_M = 50000;      // a move further than this is a data error, not a fix
const CENSUS_BATCH = 5000;     // the batch endpoint's limit is 10,000; half is kinder
const NOMINATIM_PAUSE_MS = 1100;

const UA = 'CigarBuddy/1.0 (mason.obegi@gmail.com)';
const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * A highway address. The geocoders interpolate along a route for these and land
 * anywhere along it, so a disagreement between them and us says nothing. The
 * audit measured them wrong about 40% of the time.
 */
const HIGHWAY_ADDRESS = /\b(us[- ]?\d+|u\.?s\.?\s*(hwy|highway|route|rt)\b|state\s+(hwy|highway|route|rt)\b|sr[- ]?\d+|fm[- ]?\d+|hwy\.?\b|highway\b|(^|\s)route\s+\d+|(^|\s)rt\.?\s*\d+|county\s+(road|rd|route)\b|cr[- ]?\d+\b)/i;

/**
 * A post office box or a suite with no street is not a door a geocoder can
 * find, and a pin moved onto the middle of a ZIP code is worse than the one we
 * have.
 */
const NOT_A_DOOR = /^\s*(p\.?\s*o\.?\s*box|post\s+office\s+box|general\s+delivery|rural\s+route|rr\s*\d)/i;

/** Canada, by postcode or by area code. */
const CANADIAN_POSTCODE = /\b[ABCEGHJKLMNPRSTVXY]\d[ABCEGHJKLMNPRSTVWXYZ]\s*\d[ABCEGHJKLMNPRSTVWXYZ]\d\b/i;
const CANADIAN_AREA_CODES = new Set(['204', '226', '236', '249', '250', '263', '289', '306', '343', '354',
  '365', '367', '368', '382', '387', '403', '416', '418', '428', '431', '437', '438', '450', '468', '474',
  '506', '514', '519', '548', '579', '581', '584', '587', '600', '604', '613', '639', '647', '672', '683',
  '705', '709', '742', '753', '778', '780', '782', '807', '819', '825', '867', '873', '879', '902', '905']);

/**
 * A country calling code written into a phone number. +961 is Lebanon, which is
 * the one the audit actually found. The trap here is a shop whose NAME sounds
 * foreign: Puro Estilo in Bethlehem, Pennsylvania is a Pennsylvania shop, and
 * Amsterdam Tobacco House is in Amsterdam, New York. A name is never evidence.
 */
const FOREIGN_DIAL = /\+\s*(961|44|33|34|49|52|53|39|971)\b/;

const US_STATES = new Set(['AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID',
  'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH',
  'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA',
  'WA', 'WV', 'WI', 'WY', 'PR', 'VI', 'GU', 'AS', 'MP']);

/**
 * The first three digits of a ZIP code name a sectional centre, and a sectional
 * centre sits in exactly one state. This is the ranges table, which is why a
 * ZIP is the strongest cheap signal about which state a listing is in.
 */
const ZIP3_STATE = (() => {
  const ranges = [
    [['005', '005'], 'NY'], [['006', '009'], 'PR'], [['010', '027'], 'MA'], [['028', '029'], 'RI'],
    [['030', '038'], 'NH'], [['039', '049'], 'ME'], [['050', '059'], 'VT'], [['060', '069'], 'CT'],
    [['070', '089'], 'NJ'], [['090', '098'], 'AE'], [['100', '149'], 'NY'], [['150', '196'], 'PA'],
    [['197', '199'], 'DE'], [['200', '205'], 'DC'], [['206', '219'], 'MD'], [['220', '246'], 'VA'],
    [['247', '268'], 'WV'], [['270', '289'], 'NC'], [['290', '299'], 'SC'], [['300', '319'], 'GA'],
    [['320', '349'], 'FL'], [['350', '369'], 'AL'], [['370', '385'], 'TN'], [['386', '397'], 'MS'],
    [['398', '399'], 'GA'], [['400', '427'], 'KY'], [['430', '459'], 'OH'], [['460', '479'], 'IN'],
    [['480', '499'], 'MI'], [['500', '528'], 'IA'], [['530', '549'], 'WI'], [['550', '567'], 'MN'],
    [['570', '577'], 'SD'], [['580', '588'], 'ND'], [['590', '599'], 'MT'], [['600', '629'], 'IL'],
    [['630', '658'], 'MO'], [['660', '679'], 'KS'], [['680', '693'], 'NE'], [['700', '714'], 'LA'],
    [['716', '729'], 'AR'], [['730', '749'], 'OK'], [['750', '799'], 'TX'], [['800', '816'], 'CO'],
    [['820', '831'], 'WY'], [['832', '838'], 'ID'], [['840', '847'], 'UT'], [['850', '865'], 'AZ'],
    [['870', '884'], 'NM'], [['889', '898'], 'NV'], [['900', '961'], 'CA'], [['967', '968'], 'HI'],
    [['970', '979'], 'OR'], [['980', '994'], 'WA'], [['995', '999'], 'AK'],
  ];
  const map = {};
  for (const [[lo, hi], st] of ranges) {
    for (let n = parseInt(lo, 10); n <= parseInt(hi, 10); n++) map[String(n).padStart(3, '0')] = st;
  }
  // El Paso is 798-799 and sits in Texas even though it keeps Mountain time;
  // 885 is Texas too, tucked inside the New Mexico block.
  map['885'] = 'TX';
  return map;
})();

/** The state a ZIP code says the listing is in, or null. */
function stateFromZip(zip) {
  const m = /(\d{5})/.exec(String(zip || ''));
  return m ? (ZIP3_STATE[m[1].slice(0, 3)] || null) : null;
}

/** The state an area code says the listing is in. Canada answers 'CA-xx'. */
function areaCode(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  const ten = digits.length === 11 && digits[0] === '1' ? digits.slice(1) : digits;
  return ten.length === 10 ? ten.slice(0, 3) : null;
}

function metresBetween(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Is this an address a geocoder can be trusted about at all? */
function addressIsOrdinary(address) {
  const a = String(address || '').trim();
  if (!a || a.length < 5) return false;
  if (NOT_A_DOOR.test(a)) return false;
  if (HIGHWAY_ADDRESS.test(a)) return false;
  // A street number is what an interpolating geocoder needs to be precise.
  if (!/^\s*\d+[a-z]?\s+\S/i.test(a)) return false;
  return true;
}

// ── the two geocoders ────────────────────────────────────────────────────────

function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, timeout: 30000 }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', reject);
  });
}

/** One CSV line per listing, quoted, as the batch endpoint wants it. */
function censusCsv(rows) {
  const cell = v => `"${String(v ?? '').replace(/"/g, "'").replace(/[\r\n]+/g, ' ')}"`;
  return rows.map(r => [r.id, r.address, r.city, r.state, r.zip].map(cell).join(',')).join('\n');
}

/**
 * The batch endpoint answers CSV:
 *   id,"input address","Match"|"No_Match","Exact"|"Non_Exact","matched address","lng,lat",tigerline,side
 * Quoted fields contain commas, so this is parsed properly rather than split.
 */
function parseCensusCsv(text) {
  const out = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells = [];
    let cur = '', inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQuotes = !inQuotes; continue; }
      if (ch === ',' && !inQuotes) { cells.push(cur); cur = ''; continue; }
      cur += ch;
    }
    cells.push(cur);
    const id = parseInt(cells[0], 10);
    if (!Number.isFinite(id)) continue;
    if (cells[2] !== 'Match') { out.set(id, null); continue; }
    const coords = String(cells[5] || '').split(',');
    const lng = parseFloat(coords[0]), lat = parseFloat(coords[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) { out.set(id, null); continue; }
    out.set(id, { lat, lng, exact: cells[3] === 'Exact', matched: cells[4] || null });
  }
  return out;
}

async function censusBatch(rows) {
  const csv = censusCsv(rows);
  const boundary = `----cigarbuddy${Date.now()}`;
  const parts = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="addressFile"; filename="a.csv"\r\n`
      + 'Content-Type: text/csv\r\n\r\n'),
    Buffer.from(csv + '\r\n'),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="benchmark"\r\n\r\nPublic_AR_Current\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="returntype"\r\n\r\nlocations\r\n`),
    Buffer.from(`--${boundary}--\r\n`),
  ]);
  const body = await new Promise((resolve, reject) => {
    const req = https.request('https://geocoding.geo.census.gov/geocoder/locations/addressbatch', {
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': parts.length, 'User-Agent': UA },
      timeout: 600000,
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(parts);
  });
  return parseCensusCsv(body);
}

async function nominatimOne(row) {
  const q = [row.address, row.city, row.state, row.zip].filter(Boolean).join(', ');
  const url = 'https://nominatim.openstreetmap.org/search?'
    + querystring.stringify({ q, format: 'json', limit: 1, countrycodes: 'us', addressdetails: 1 });
  const r = await getJson(url);
  if (!Array.isArray(r) || !r[0]) return null;
  const lat = parseFloat(r[0].lat), lng = parseFloat(r[0].lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng, type: r[0].type || null, state: r[0].address?.state || null };
}

// ── read ─────────────────────────────────────────────────────────────────────

async function read({ out, limit = 0, log = console.log } = {}) {
  const db = require('../database/db');
  const rows = await db.all(`
    SELECT id, name, address, city, state, zip, phone, lat, lng, website, claimed, staff_edited
    FROM stores WHERE visible = 1 AND address IS NOT NULL AND address <> '' ORDER BY id`);

  const done = new Set();
  if (out && fs.existsSync(out)) {
    for (const line of fs.readFileSync(out, 'utf8').split('\n')) {
      try { done.add(JSON.parse(line).id); } catch {}
    }
  }
  let queue = rows.filter(r => !done.has(r.id));
  if (limit) queue = queue.slice(0, limit);
  log(`${done.size} already read; asking the Census geocoder about ${queue.length} addresses`);

  const stream = fs.createWriteStream(out, { flags: 'a' });
  const records = [];
  for (let i = 0; i < queue.length; i += CENSUS_BATCH) {
    const batch = queue.slice(i, i + CENSUS_BATCH);
    let census = new Map();
    try { census = await censusBatch(batch); }
    catch (e) { log(`  batch at ${i} failed: ${e.message}`); }
    for (const r of batch) {
      records.push({
        id: r.id, name: r.name, address: r.address, city: r.city, state: r.state, zip: r.zip,
        phone: r.phone, website: r.website, lat: r.lat === null ? null : Number(r.lat),
        lng: r.lng === null ? null : Number(r.lng),
        census: census.get(r.id) || null, nominatim: null, nominatim_asked: false,
      });
    }
    log(`  census ${Math.min(i + CENSUS_BATCH, queue.length)}/${queue.length}`);
  }

  // Nominatim only where the Census disagrees with us by more than a kilometre.
  // Asking it about every listing would take a day and would be rude.
  const needSecond = records.filter(r =>
    r.census && r.lat !== null && r.lng !== null
    && metresBetween(r.lat, r.lng, r.census.lat, r.census.lng) > MIN_MOVE_M);
  log(`asking Nominatim about ${needSecond.length} disagreements, one a second`);
  let n = 0;
  for (const r of needSecond) {
    try { r.nominatim = await nominatimOne(r); } catch {}
    r.nominatim_asked = true;
    if (++n % 50 === 0) log(`  nominatim ${n}/${needSecond.length}`);
    await sleep(NOMINATIM_PAUSE_MS);
  }

  for (const r of records) stream.write(JSON.stringify(r) + '\n');
  await new Promise(r => stream.end(r));
  log(`done: ${records.length} addresses written to ${out}`);
  return records.length;
}

// ── decide ───────────────────────────────────────────────────────────────────

/**
 * The rule for one listing, kept pure so the self-test can put the named cases
 * through it without a database or a network.
 *
 * Returns one of:
 *   { verdict: 'leave' }                      the pin is close enough, or we cannot tell
 *   { verdict: 'move', lat, lng, ... }        every condition below holds
 *   { verdict: 'review', why, ... }           a person decides
 */
function decidePin(rec) {
  const base = {
    id: rec.id, name: rec.name, address: rec.address, city: rec.city, state: rec.state,
    zip: rec.zip, from: { lat: rec.lat, lng: rec.lng },
  };
  if (rec.lat === null || rec.lng === null) {
    return rec.census
      ? { ...base, verdict: 'review', why: 'the listing has no pin at all', to: { lat: rec.census.lat, lng: rec.census.lng } }
      : { ...base, verdict: 'leave', why: 'no pin and no geocode' };
  }
  if (!rec.census) return { ...base, verdict: 'leave', why: 'the Census geocoder could not find the address' };

  const censusM = metresBetween(rec.lat, rec.lng, rec.census.lat, rec.census.lng);
  if (censusM <= MIN_MOVE_M) return { ...base, verdict: 'leave', why: `the pin is ${Math.round(censusM)} m from its address`, metres: censusM };

  const to = { lat: rec.census.lat, lng: rec.census.lng };
  const evidence = { census_m: Math.round(censusM), census_exact: !!rec.census.exact, matched: rec.census.matched };

  // Highway addresses are excluded outright: the geocoders interpolate along a
  // route and land anywhere on it, and the audit measured them wrong about 40%
  // of the time. A disagreement there is not evidence of anything.
  if (!addressIsOrdinary(rec.address)) {
    return { ...base, verdict: 'review', why: 'a highway, box or incomplete address — the geocoders cannot be trusted here', to, evidence };
  }

  if (!rec.nominatim) {
    return { ...base, verdict: 'review', why: 'only one geocoder answered', to, evidence };
  }
  const agreeM = metresBetween(rec.census.lat, rec.census.lng, rec.nominatim.lat, rec.nominatim.lng);
  evidence.geocoders_apart_m = Math.round(agreeM);
  if (agreeM > AUTO_AGREE_M) {
    return { ...base, verdict: 'review', why: `the two geocoders are ${Math.round(agreeM)} m apart`, to, evidence };
  }
  const nomM = metresBetween(rec.lat, rec.lng, rec.nominatim.lat, rec.nominatim.lng);
  evidence.nominatim_m = Math.round(nomM);
  if (nomM <= MIN_MOVE_M) {
    return { ...base, verdict: 'review', why: 'the second geocoder puts the shop near our pin after all', to, evidence };
  }
  if (censusM > MAX_MOVE_M) {
    // Tobacco Junction of Marshall is 404 km out. A move that big is a
    // different shop or a different town, and a person has to look.
    return { ...base, verdict: 'review', why: `the move is ${Math.round(censusM / 1000)} km — too far to take on a geocoder's word`, to, evidence };
  }
  // The last condition: the address has to be backed by something that is not
  // the directory we are correcting.
  if (!rec.address_confirmed_by) {
    return { ...base, verdict: 'review', why: "the address is not backed by the shop's own site or a chain feed", to, evidence };
  }
  evidence.address_confirmed_by = rec.address_confirmed_by;
  return { ...base, verdict: 'move', to, evidence, metres: censusM };
}

/**
 * Which state a listing is really in. A state changes only when the ZIP prefix
 * and one more independent signal agree on the same answer.
 */
function decideState(rec) {
  const stated = String(rec.state || '').toUpperCase();
  const byZip = stateFromZip(rec.zip);
  if (!byZip || byZip === stated) return null;

  const seconds = [];
  if (rec.census) {
    // The Census pin, read back through the ZIP of the address it matched.
    const m = /\b(\d{5})(-\d{4})?\s*$/.exec(String(rec.census.matched || ''));
    const matchedState = m ? stateFromZip(m[1]) : null;
    if (matchedState) seconds.push({ signal: 'the address the Census geocoder matched', state: matchedState });
  }
  if (rec.nominatim && rec.nominatim.state) {
    seconds.push({ signal: 'Nominatim', state: rec.nominatim.state });
  }
  const code = areaCode(rec.phone);
  if (code && AREA_CODE_STATE[code]) seconds.push({ signal: `area code ${code}`, state: AREA_CODE_STATE[code] });

  const agreeing = seconds.filter(s => String(s.state).toUpperCase() === byZip
    || String(s.state).toLowerCase() === STATE_NAMES[byZip]);
  if (!agreeing.length) {
    return { id: rec.id, name: rec.name, city: rec.city, from: stated, to: byZip, verdict: 'review',
      why: 'the ZIP disagrees with the state, and nothing else backs it up', signals: seconds };
  }
  return { id: rec.id, name: rec.name, city: rec.city, from: stated, to: byZip, verdict: 'change',
    why: `the ZIP says ${byZip} and so does ${agreeing[0].signal}`, signals: seconds };
}

/** Full state names, for reading Nominatim's answer. */
const STATE_NAMES = {
  AL: 'alabama', AK: 'alaska', AZ: 'arizona', AR: 'arkansas', CA: 'california', CO: 'colorado',
  CT: 'connecticut', DE: 'delaware', DC: 'district of columbia', FL: 'florida', GA: 'georgia',
  HI: 'hawaii', ID: 'idaho', IL: 'illinois', IN: 'indiana', IA: 'iowa', KS: 'kansas', KY: 'kentucky',
  LA: 'louisiana', ME: 'maine', MD: 'maryland', MA: 'massachusetts', MI: 'michigan', MN: 'minnesota',
  MS: 'mississippi', MO: 'missouri', MT: 'montana', NE: 'nebraska', NV: 'nevada', NH: 'new hampshire',
  NJ: 'new jersey', NM: 'new mexico', NY: 'new york', NC: 'north carolina', ND: 'north dakota',
  OH: 'ohio', OK: 'oklahoma', OR: 'oregon', PA: 'pennsylvania', RI: 'rhode island', SC: 'south carolina',
  SD: 'south dakota', TN: 'tennessee', TX: 'texas', UT: 'utah', VT: 'vermont', VA: 'virginia',
  WA: 'washington', WV: 'west virginia', WI: 'wisconsin', WY: 'wyoming', PR: 'puerto rico',
};

/** Just enough area codes to act as a second opinion on a state. */
const AREA_CODE_STATE = (() => {
  const byState = {
    NY: ['212', '315', '332', '347', '363', '516', '518', '585', '607', '631', '646', '680', '716', '718', '838', '845', '914', '917', '929', '934'],
    PA: ['215', '223', '267', '272', '412', '445', '484', '570', '582', '610', '717', '724', '814', '835', '878'],
    TX: ['210', '214', '254', '281', '325', '346', '361', '409', '430', '432', '469', '512', '682', '713', '726', '737', '806', '817', '830', '832', '903', '915', '936', '940', '945', '956', '972', '979'],
    CT: ['203', '475', '860', '959'],
    UT: ['385', '435', '801'],
    NM: ['505', '575'],
    AZ: ['480', '520', '602', '623', '928'],
    IL: ['217', '224', '309', '312', '331', '447', '464', '618', '630', '708', '730', '773', '779', '815', '847', '872'],
    NV: ['702', '725', '775'],
    AR: ['479', '501', '870'],
    CO: ['303', '719', '720', '970', '983'],
    CA: ['209', '213', '279', '310', '323', '341', '350', '408', '415', '424', '442', '510', '530', '559', '562', '619', '626', '628', '650', '657', '661', '669', '707', '714', '747', '760', '805', '818', '820', '831', '840', '858', '909', '916', '925', '949', '951'],
    FL: ['239', '305', '321', '324', '352', '386', '407', '448', '561', '645', '656', '689', '727', '728', '754', '772', '786', '813', '850', '863', '904', '941', '954'],
    MA: ['339', '351', '413', '508', '617', '774', '781', '857', '978'],
    NJ: ['201', '551', '609', '640', '732', '848', '856', '862', '908', '973'],
  };
  const map = {};
  for (const [st, codes] of Object.entries(byState)) for (const c of codes) map[c] = st;
  return map;
})();

/**
 * Is this listing outside the United States? Only hard evidence counts: a
 * foreign dialling code, a Canadian postcode, a Canadian area code, or a pin
 * outside the country. A foreign-sounding NAME is never evidence — Puro Estilo
 * is in Bethlehem, Pennsylvania and Amsterdam Tobacco House is in Amsterdam,
 * New York.
 */
function decideForeign(rec) {
  const reasons = [];
  if (FOREIGN_DIAL.test(String(rec.phone || ''))) reasons.push(`the phone number carries a foreign dialling code (${String(rec.phone).trim()})`);
  const postcodeIn = `${rec.address || ''} ${rec.zip || ''}`;
  if (CANADIAN_POSTCODE.test(postcodeIn) && !/\b\d{5}\b/.test(String(rec.zip || ''))) {
    reasons.push('the postcode is Canadian');
  }
  const code = areaCode(rec.phone);
  if (code && CANADIAN_AREA_CODES.has(code)) reasons.push(`area code ${code} is Canadian`);
  const stated = String(rec.state || '').toUpperCase();
  if (stated && !US_STATES.has(stated)) reasons.push(`"${rec.state}" is not a US state or territory`);
  // A pin well outside the country, north of the border or across an ocean.
  if (rec.lat !== null && rec.lng !== null) {
    const inUs = (rec.lat > 24 && rec.lat < 50 && rec.lng < -66 && rec.lng > -125)      // lower 48
      || (rec.lat > 51 && rec.lat < 72 && rec.lng < -129 && rec.lng > -173)             // Alaska
      || (rec.lat > 18 && rec.lat < 23 && rec.lng < -154 && rec.lng > -161)             // Hawaii
      || (rec.lat > 17 && rec.lat < 19 && rec.lng < -65 && rec.lng > -68);              // Puerto Rico
    if (!inUs) reasons.push(`the pin (${rec.lat.toFixed(3)}, ${rec.lng.toFixed(3)}) is outside the United States`);
  }
  if (!reasons.length) return null;
  return {
    id: rec.id, name: rec.name, address: rec.address, city: rec.city, state: rec.state,
    zip: rec.zip, phone: rec.phone, reasons,
    // Two independent signals before a listing is even proposed for hiding: one
    // stray digit in a phone number must not take a real shop off the map.
    verdict: reasons.length >= 2 ? 'hide' : 'review',
  };
}

async function decide({ from, out, log = console.log } = {}) {
  const db = require('../database/db');
  const recs = [];
  for (const line of fs.readFileSync(from, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { recs.push(JSON.parse(line)); } catch {}
  }

  // Claimed and staff-edited listings are never touched by a sweep.
  const locked = new Set((await db.all(
    'SELECT id FROM stores WHERE COALESCE(claimed, 0) = 1 OR COALESCE(staff_edited, 0) = 1')).map(r => r.id));

  const moves = [], review = [], states = [], stateReview = [], foreign = [], foreignReview = [];
  for (const rec of recs) {
    if (locked.has(rec.id)) continue;
    const pin = decidePin(rec);
    if (pin.verdict === 'move') moves.push(pin);
    else if (pin.verdict === 'review') review.push(pin);

    const st = decideState(rec);
    if (st && st.verdict === 'change') states.push(st);
    else if (st) stateReview.push(st);

    const fg = decideForeign(rec);
    if (fg && fg.verdict === 'hide') foreign.push(fg);
    else if (fg) foreignReview.push(fg);
  }

  // The time zone follows the pin and the state, never the other way round.
  const { timeZoneFor } = require('../utils/storeHours');
  for (const m of moves) m.timezone = timeZoneFor(m.state, m.to.lat, m.to.lng);
  for (const s of states) {
    const rec = recs.find(r => r.id === s.id);
    s.timezone = timeZoneFor(s.to, rec && rec.lat, rec && rec.lng);
  }

  const held = settleHeldTimezones(recs, log);

  log(`pins to move automatically: ${moves.length}`);
  log(`pins for review:            ${review.length}`);
  log(`states to change:           ${states.length} (${stateReview.length} for review)`);
  log(`foreign rows to hide:       ${foreign.length} (${foreignReview.length} for review)`);
  log(`held time zones settled:    ${held.filter(h => h.verdict !== 'review').length} of ${held.length}`);
  if (out) {
    fs.writeFileSync(out, JSON.stringify({ moves, review, states, stateReview, foreign, foreignReview, held }, null, 1));
    log(`written to ${out}`);
  }
  return { moves, review, states, stateReview, foreign, foreignReview, held };
}

/**
 * The eight listings whose pin does not fit the state they claim, left alone
 * when the time zones were recomputed (sweeps/decisions/timezones_held.json).
 * Each one is a pin/state disagreement, so it is this sweep's to settle: fix
 * whichever of the two is wrong, and the zone follows.
 */
function settleHeldTimezones(recs, log = console.log) {
  const path = require('path');
  const file = path.join(__dirname, '..', '..', '..', 'sweeps', 'decisions', 'timezones_held.json');
  if (!fs.existsSync(file)) { log('timezones_held.json not found — nothing held to settle'); return []; }
  const held = JSON.parse(fs.readFileSync(file, 'utf8'));
  const byId = new Map(recs.map(r => [r.id, r]));
  return held.map(h => {
    const rec = byId.get(h.id);
    const out = { ...h, settled_by: null, verdict: 'review' };
    if (!rec) {
      // Hidden listings are not in the read set, which only covers public rows.
      out.why = 'not in the geocode read (it is hidden, so no customer sees its clock)';
      out.verdict = h.visible ? 'review' : 'leave';
      return out;
    }
    const st = decideState(rec);
    const pin = decidePin(rec);
    const { timeZoneFor } = require('../utils/storeHours');
    if (st && st.verdict === 'change') {
      // The state was wrong: keep the pin, take the state, and the zone follows.
      out.settled_by = 'state';
      out.verdict = 'change_state';
      out.state_to = st.to;
      out.timezone = timeZoneFor(st.to, rec.lat, rec.lng);
      out.why = st.why;
    } else if (pin.verdict === 'move') {
      out.settled_by = 'pin';
      out.verdict = 'move_pin';
      out.to = pin.to;
      out.timezone = timeZoneFor(rec.state, pin.to.lat, pin.to.lng);
      out.why = pin.why || 'both geocoders put the shop somewhere else';
    } else {
      out.why = `pin: ${pin.why || pin.verdict}; state: ${st ? st.why : 'the ZIP agrees with the state'}`;
    }
    return out;
  });
}

// ── apply ────────────────────────────────────────────────────────────────────

async function apply(file, { log = console.log } = {}) {
  const { writeFields } = require('../utils/storeEdits');
  const db = require('../database/db');
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));
  let pins = 0, states = 0, hidden = 0, zones = 0;

  for (const m of d.moves || []) {
    const written = await writeFields(m.id, { lat: m.to.lat, lng: m.to.lng, timezone: m.timezone }, {
      source: 'geocode', job: 'geocodePins',
      reason: `both geocoders put ${m.address}, ${m.city} ${Math.round(m.metres)} m from our pin`,
    });
    if (written.includes('lat')) pins++;
    if (written.includes('timezone')) zones++;
  }
  for (const s of d.states || []) {
    const written = await writeFields(s.id, { state: s.to, timezone: s.timezone }, {
      source: 'geocode', job: 'geocodePins', reason: s.why,
    });
    if (written.includes('state')) states++;
  }
  for (const f of d.foreign || []) {
    // Hidden, never deleted, and always with its reason: rule 2.
    await db.run(
      `UPDATE stores SET visible = 0, storefront = 'not_retail', storefront_reason = ?, storefront_checked_at = NOW()
       WHERE id = ? AND COALESCE(claimed, 0) = 0 AND COALESCE(staff_edited, 0) = 0`,
      [`outside the United States: ${f.reasons.join('; ')}`.slice(0, 500), f.id]);
    hidden++;
  }
  for (const h of d.held || []) {
    if (h.verdict === 'change_state') {
      await writeFields(h.id, { state: h.state_to, timezone: h.timezone }, {
        source: 'geocode', job: 'geocodePins', reason: h.why,
      });
      zones++;
    } else if (h.verdict === 'move_pin') {
      await writeFields(h.id, { lat: h.to.lat, lng: h.to.lng, timezone: h.timezone }, {
        source: 'geocode', job: 'geocodePins', reason: h.why,
      });
      zones++;
    }
  }
  log(`moved ${pins} pins, changed ${states} states, hid ${hidden} foreign rows, settled ${zones} clocks`);
  return { pins, states, hidden, zones };
}

module.exports = {
  read, decide, apply, applytest, decidePin, decideState, decideForeign, settleHeldTimezones,
  addressIsOrdinary, stateFromZip, areaCode, metresBetween, parseCensusCsv, censusCsv,
  HIGHWAY_ADDRESS, AUTO_AGREE_M, MIN_MOVE_M, MAX_MOVE_M,
};

// ── self-test ────────────────────────────────────────────────────────────────
function selftest() {
  let pass = 0, fail = 0;
  const ok = (cond, label, extra) => {
    if (cond) { pass++; console.log(`  ok   ${label}`); }
    else { fail++; console.log(`  FAIL ${label}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ''}`); }
  };

  // Distances, against numbers anyone can check.
  ok(Math.round(metresBetween(40.7549, -73.9840, 40.7549, -73.9740)) === 842,
    'a hundredth of a degree of longitude in Midtown is about 840 m', Math.round(metresBetween(40.7549, -73.9840, 40.7549, -73.9740)));

  // Highway addresses are the ones the geocoders get wrong 40% of the time.
  for (const a of ['1234 US-1', '55 US Hwy 19 N', '900 SR-54', '10 FM 1960 Rd', '1 State Route 17',
    '400 Highway 80 W', '77 County Road 12', 'PO Box 44', 'Suite 200']) {
    ok(!addressIsOrdinary(a), `"${a}" is not an address a geocoder can be trusted about`);
  }
  for (const a of ['881 9th Ave', '515 Madison Ave', '2240 Wilton Dr', '11 Division St', '1385 Broadway']) {
    ok(addressIsOrdinary(a), `"${a}" is an ordinary street address`);
  }
  // "Highway" inside a real street name is still a highway address; the review
  // list is where it goes, so nothing is lost.
  ok(!addressIsOrdinary('123 Old Highway Rd'), 'a street named for a highway still goes to review');

  // ZIP prefixes.
  ok(stateFromZip('18018') === 'PA', 'Bethlehem 18018 is Pennsylvania');
  ok(stateFromZip('79901') === 'TX', 'El Paso 79901 is Texas');
  ok(stateFromZip('06320') === 'CT', 'New London 06320 is Connecticut');
  ok(stateFromZip('12010') === 'NY', 'Amsterdam 12010 is New York');
  ok(stateFromZip('') === null && stateFromZip(null) === null, 'no ZIP says nothing');

  // ── the pin rule ───────────────────────────────────────────────────────────
  const rec = (o) => ({
    id: 1, name: 'Test Cigars', address: '881 9th Ave', city: 'New York', state: 'NY', zip: '10019',
    phone: '(212) 555-0100', lat: 40.7660, lng: -73.9870, census: null, nominatim: null, ...o,
  });

  // A pin already at its address is left alone, and never asks a second geocoder.
  ok(decidePin(rec({ census: { lat: 40.7661, lng: -73.9871, exact: true } })).verdict === 'leave',
    'a pin at its own address is left alone');

  // The full automatic tier: both geocoders agree with each other, both
  // disagree with us, the move is sane, and the address is backed.
  const auto = decidePin(rec({
    lat: 40.8500, lng: -73.9000,
    census: { lat: 40.7660, lng: -73.9870, exact: true, matched: '881 9TH AVE, NEW YORK, NY, 10019' },
    nominatim: { lat: 40.7661, lng: -73.9869 },
    address_confirmed_by: 'the shop\'s own website',
  }));
  ok(auto.verdict === 'move', 'both geocoders agreeing, against us, on a backed address, moves the pin', auto.why);

  // Each condition, removed one at a time, must drop it to review.
  ok(decidePin(rec({ lat: 40.85, lng: -73.90, census: { lat: 40.7660, lng: -73.9870 }, nominatim: { lat: 40.7660, lng: -73.9870 } })).verdict === 'review',
    'without a backed address it goes to review, not onto the map');
  ok(decidePin(rec({ lat: 40.85, lng: -73.90, census: { lat: 40.7660, lng: -73.9870 }, address_confirmed_by: 'site' })).verdict === 'review',
    'one geocoder alone goes to review');
  ok(decidePin(rec({ lat: 40.85, lng: -73.90, census: { lat: 40.7660, lng: -73.9870 }, nominatim: { lat: 40.7760, lng: -73.9870 }, address_confirmed_by: 'site' })).verdict === 'review',
    'two geocoders a kilometre apart go to review');
  ok(decidePin(rec({ address: '900 SR-54', lat: 40.85, lng: -73.90, census: { lat: 40.7660, lng: -73.9870 }, nominatim: { lat: 40.7660, lng: -73.9870 }, address_confirmed_by: 'site' })).verdict === 'review',
    'a highway address goes to review however well the geocoders agree');

  // Tobacco Junction of Marshall: 404 km off. Too far to take on a geocoder's
  // word, even when everything else lines up.
  const marshall = decidePin(rec({
    name: 'Tobacco Junction of Marshall', address: '1102 E End Blvd N', city: 'Marshall', state: 'TX', zip: '75670',
    lat: 32.5449, lng: -94.3674,
    census: { lat: 36.0000, lng: -93.0000, exact: true }, nominatim: { lat: 36.0001, lng: -93.0001 },
    address_confirmed_by: 'site',
  }));
  ok(marshall.verdict === 'review' && /km/.test(marshall.why), 'a 400 km move goes to a person, never to the map', marshall.why);

  // Amsterdam Tobacco House: in Amsterdam, New York, wrongly pinned on Long
  // Island. The name is Dutch; the shop is not.
  const amsterdam = { id: 2, name: 'Amsterdam Tobacco House', address: '10 Market St', city: 'Amsterdam', state: 'NY', zip: '12010', phone: '(518) 555-0110', lat: 40.7500, lng: -73.4000 };
  ok(decideForeign(amsterdam) === null, 'Amsterdam Tobacco House is not foreign');
  // Its pin is 252 km from its address, which is past the 50 km ceiling: the
  // right answer is a review entry carrying the destination, not a silent
  // 252 km jump on a geocoder's say-so. The pin still gets fixed — by a person
  // reading this row, which is the point of the review list.
  const amsterdamPin = decidePin({ ...amsterdam, census: { lat: 42.9387, lng: -74.1882, exact: true }, nominatim: { lat: 42.9388, lng: -74.1883 }, address_confirmed_by: 'site' });
  ok(amsterdamPin.verdict === 'review' && /252 km/.test(amsterdamPin.why),
    'and its pin goes to review with the distance named, not onto the map automatically', amsterdamPin.why);
  ok(Math.abs(amsterdamPin.to.lat - 42.9387) < 1e-4 && Math.abs(amsterdamPin.to.lng + 74.1882) < 1e-4,
    'carrying the upstate address the geocoders agree on, so the reviewer has the answer in hand', amsterdamPin.to);

  // Puro Estilo, Bethlehem PA. The guardrail: not foreign, whatever the name.
  ok(decideForeign({ id: 3, name: 'Puro Estilo', address: '25 E Third St', city: 'Bethlehem', state: 'PA', zip: '18018', phone: '(610) 555-0125', lat: 40.6259, lng: -75.3705 }) === null,
    'Puro Estilo in Bethlehem, Pennsylvania is not foreign');
  ok(decideState({ id: 3, name: 'Puro Estilo', city: 'Bethlehem', state: 'PA', zip: '18018', phone: '(610) 555-0125' }) === null,
    'and its state is not touched');

  // Black Jack's Cigar Lounge: an El Paso shop listed in New London, Connecticut.
  const blackjack = { id: 4, name: "Black Jack's Cigar Lounge", address: '1201 Airway Blvd', city: 'El Paso', state: 'CT', zip: '79925', phone: '(915) 555-0140', lat: 41.3557, lng: -72.0995, census: { lat: 31.7900, lng: -106.3800, exact: true, matched: '1201 AIRWAY BLVD, EL PASO, TX, 79925' }, nominatim: { lat: 31.7901, lng: -106.3801, state: 'Texas' } };
  const bjState = decideState(blackjack);
  ok(bjState && bjState.verdict === 'change' && bjState.to === 'TX',
    "Black Jack's moves from Connecticut to Texas: the ZIP and the geocoders agree", bjState);
  ok(decideForeign(blackjack) === null, "and it is not proposed as foreign");

  // A state changes only with a second signal.
  ok(decideState({ id: 5, state: 'NY', zip: '79925', phone: null, census: null, nominatim: null }).verdict === 'review',
    'a ZIP alone is not enough to change a state');

  // ── foreign rows ───────────────────────────────────────────────────────────
  const lebanon = decideForeign({ id: 6, name: 'Beirut Cigars', address: 'Hamra St', city: 'Beirut', state: 'XX', zip: '', phone: '+961 1 234567', lat: 33.89, lng: 35.50 });
  ok(lebanon && lebanon.verdict === 'hide' && lebanon.reasons.length >= 2, 'a Lebanese shop is proposed as hidden', lebanon && lebanon.reasons);
  const toronto = decideForeign({ id: 7, name: 'Queen St Cigars', address: '123 Queen St W', city: 'Toronto', state: 'ON', zip: 'M5H 2M9', phone: '(416) 555-0170', lat: 43.65, lng: -79.38 });
  ok(toronto && toronto.verdict === 'hide', 'a Toronto shop is proposed as hidden', toronto && toronto.reasons);
  ok(toronto.reasons.some(r => /Canadian/.test(r)), 'and says why');
  // One signal alone only proposes a review: a stray digit must not hide a shop.
  const oneSignal = decideForeign({ id: 8, name: 'Border Cigars', address: '1 Main St', city: 'Detroit', state: 'MI', zip: '48226', phone: '(519) 555-0180', lat: 42.33, lng: -83.05 });
  ok(oneSignal && oneSignal.verdict === 'review', 'a Canadian area code alone only asks for a look', oneSignal && oneSignal.reasons);
  ok(decideForeign({ id: 9, name: 'Honolulu Cigars', address: '1 Kalakaua Ave', city: 'Honolulu', state: 'HI', zip: '96815', phone: '(808) 555-0190', lat: 21.28, lng: -157.83 }) === null,
    'Hawaii is in the United States');
  ok(decideForeign({ id: 10, name: 'Anchorage Cigars', address: '1 4th Ave', city: 'Anchorage', state: 'AK', zip: '99501', phone: '(907) 555-0191', lat: 61.21, lng: -149.90 }) === null,
    'so is Alaska');
  ok(decideForeign({ id: 11, name: 'San Juan Cigars', address: '1 Calle Fortaleza', city: 'San Juan', state: 'PR', zip: '00901', phone: '(787) 555-0192', lat: 18.46, lng: -66.11 }) === null,
    'so is Puerto Rico');

  // ── the Census CSV ─────────────────────────────────────────────────────────
  const csv = censusCsv([{ id: 7, address: '881 9th Ave, Apt "B"', city: 'New York', state: 'NY', zip: '10019' }]);
  ok(csv === '"7","881 9th Ave, Apt \'B\'","New York","NY","10019"', 'a comma or a quote in an address cannot break the batch file', csv);
  const parsed = parseCensusCsv([
    '"1","881 9TH AVE, NEW YORK, NY, 10019","Match","Exact","881 9TH AVE, NEW YORK, NY, 10019","-73.98701,40.76601","123","L"',
    '"2","NOWHERE","No_Match"',
  ].join('\n'));
  ok(parsed.get(1) && Math.abs(parsed.get(1).lat - 40.76601) < 1e-6 && Math.abs(parsed.get(1).lng + 73.98701) < 1e-6,
    'the batch answer is read longitude-first, as it is written', parsed.get(1));
  ok(parsed.get(1).exact === true, 'and an exact match is marked exact');
  ok(parsed.get(2) === null, 'and a no-match is a no-match, not a pin at zero,zero');

  console.log(`\ngeocodePins self-test: ${pass} passed, ${fail} failed`);
  return fail;
}

/**
 * The writing half, against a real database: provenance, the claimed and
 * staff-edited guard, the reversibility of a hide, and the edit log. Needs
 * PGLITE_DIR pointing at a scratch database it is free to write to.
 */
async function applytest() {
  const db = require('../database/db');
  const { initSchema, runMigrations } = require('../database/schema');
  const { fieldSource } = require('../utils/storeEdits');
  await initSchema();
  await runMigrations();
  let pass = 0, fail = 0;
  const ok = (cond, label, extra) => {
    if (cond) { pass++; console.log(`  ok   ${label}`); }
    else { fail++; console.log(`  FAIL ${label}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ''}`); }
  };

  const mk = async (o) => (await db.get(
    `INSERT INTO stores (name, address, city, state, zip, phone, lat, lng, visible, claimed, staff_edited, timezone)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    [o.name, o.address || '1 Main St', o.city || 'Town', o.state || 'NY', o.zip || '10019',
      o.phone || null, o.lat ?? 40.0, o.lng ?? -73.0, o.visible ?? 1, o.claimed ?? 0,
      o.staff_edited ?? 0, o.timezone || 'America/New_York'])).id;

  const plain = await mk({ name: 'Movable Cigars' });
  const owned = await mk({ name: 'Claimed Cigars', claimed: 1 });
  const staffed = await mk({ name: 'Staff Edited Cigars', staff_edited: 1 });
  const abroad = await mk({ name: 'Toronto Cigars', city: 'Toronto', state: 'ON', zip: 'M5H 2M9', phone: '(416) 555-0170', lat: 43.65, lng: -79.38 });
  const abroadOwned = await mk({ name: 'Claimed Abroad', city: 'Toronto', state: 'ON', zip: 'M5H 2M9', phone: '(416) 555-0170', lat: 43.65, lng: -79.38, claimed: 1 });

  const move = (id) => ({
    id, name: 'x', address: '881 9th Ave', city: 'New York', state: 'NY', zip: '10019',
    from: { lat: 40.0, lng: -73.0 }, to: { lat: 40.7660, lng: -73.9870 },
    metres: 90000, timezone: 'America/New_York',
  });
  const file = require('path').join(require('os').tmpdir(), `geopins_applytest_${process.pid}.json`);
  fs.writeFileSync(file, JSON.stringify({
    moves: [move(plain), move(owned), move(staffed)],
    states: [], foreign: [
      { id: abroad, reasons: ['area code 416 is Canadian', 'the postcode is Canadian'] },
      { id: abroadOwned, reasons: ['area code 416 is Canadian', 'the postcode is Canadian'] },
    ], held: [],
  }));
  await apply(file, { log: () => {} });
  fs.unlinkSync(file);

  const after = async id => db.get('SELECT * FROM stores WHERE id = ?', [id]);
  const a = await after(plain);
  ok(Math.abs(Number(a.lat) - 40.7660) < 1e-6, 'an ordinary listing has its pin moved', a.lat);
  ok(fieldSource(a, 'lat') === 'geocode', "and the pin is stamped as the geocoder's", fieldSource(a, 'lat'));
  const log = await db.all('SELECT * FROM store_edits WHERE store_id = ? ORDER BY id', [plain]);
  ok(log.some(e => e.field === 'lat' && Number(e.before) === 40 && e.job === 'geocodePins'),
    'and the old coordinates are in the edit log, so the move can be undone', log.map(e => e.field));

  const c = await after(owned);
  ok(Number(c.lat) === 40, 'a claimed listing is not touched by the sweep', c.lat);
  const st = await after(staffed);
  ok(Number(st.lat) === 40, 'nor is a staff-edited one', st.lat);

  const f = await after(abroad);
  ok(f.visible === 0 && f.storefront === 'not_retail', 'a foreign row is hidden', { visible: f.visible, storefront: f.storefront });
  ok(/Canadian/.test(f.storefront_reason || ''), 'and carries the reason it was hidden', f.storefront_reason);
  ok(f.name === 'Toronto Cigars', 'and is hidden, never deleted');
  const fo = await after(abroadOwned);
  ok(fo.visible === 1, 'a claimed listing is not hidden even when it looks foreign', fo.visible);

  for (const id of [plain, owned, staffed, abroad, abroadOwned]) await db.run('DELETE FROM stores WHERE id = ?', [id]);
  console.log(`\ngeocodePins apply-test: ${pass} passed, ${fail} failed`);
  return fail;
}

if (require.main === module) main();

function main() {
  const argv = process.argv.slice(2);
  const arg = n => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : null; };
  if (argv[0] === 'selftest') { process.exit(selftest() ? 1 : 0); }
  if (argv[0] === 'applytest') {
    applytest().then(f => process.exit(f ? 1 : 0)).catch(e => { console.error(e); process.exit(1); });
    return;
  }
  (async () => {
    if (argv[0] === 'read') await read({ out: arg('--out'), limit: parseInt(arg('--limit')) || 0 });
    else if (argv[0] === 'decide') await decide({ from: arg('--from'), out: arg('--out') });
    else if (argv[0] === 'apply' && argv.includes('--confirm')) await apply(arg('--from'));
    else console.error('usage: read --out f.jsonl | decide --from f.jsonl --out d.json | apply --from d.json --confirm | selftest');
    process.exit(0);
  })().catch(err => { console.error(err); process.exit(1); });
}
