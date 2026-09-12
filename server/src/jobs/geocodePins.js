/**
 * Is the pin at the door the listing gives — and is the door in the state,
 * and the country, the listing claims?
 *
 * The map pin drives the marker, the distance shown on the card and the
 * near-me radius, so a pin in the wrong place hides a shop from the people
 * standing outside it and offers it to people hundreds of miles away. Tobacco
 * Junction of Marshall (1303 E Grand Ave, Marshall TX) is pinned 404 km away
 * near Comanche; Amsterdam Tobacco House on the Upper West Side is pinned on
 * Long Island. The address text is right in both; only the coordinates are
 * wrong. Black Jack's Cigar Lounge is worse: 10 Henry Trost Ct with an El Paso
 * ZIP and an El Paso phone, filed and pinned in New London, Connecticut.
 *
 * Two free geocoders have to agree before a pin moves. The Census batch
 * geocoder reads whole files at once; Nominatim gives the second opinion, one
 * request a second, only where the Census disagrees with our pin by more than
 * a kilometre. Neither is trustworthy on a highway address: the Census put
 * Wild Bill's of Negaunee, "400 US-41", 8.9 km from a pin that the chain's own
 * store locator says is right to within 50 m. So highway addresses never move
 * automatically.
 *
 * The state is decided by the record's own parts rather than by a geocoder:
 * the ZIP prefix has to say another state, and one more signal has to agree
 * with it, before the state changes. A row whose parts contradict each other
 * three ways over (Cigar Crafted: a Salt Lake City address, a Houston pin, a
 * toll-free number and a t-shirt shop for a website) is proposed hidden
 * instead of repaired, because there is no fact in it worth keeping.
 *
 * Every automatic move is reviewed before it is applied, and every decision
 * carries the coordinates it replaces.
 *
 *   node src/jobs/geocodePins.js geocode   --out geo.jsonl
 *   node src/jobs/geocodePins.js nominatim --geo geo.jsonl --out nomi.jsonl
 *   node src/jobs/geocodePins.js decide    --geo geo.jsonl --nomi nomi.jsonl --evidence <dir> --out <dir>
 *   node src/jobs/geocodePins.js apply     --from pins_auto.json --confirm
 *   node src/jobs/geocodePins.js selftest
 */
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const db = require('../database/db');
const { writeFields } = require('../utils/storeEdits');
const { timeZoneFor } = require('../utils/storeHours');
const { loadStates } = require('./geo');

const UA = 'CigarBuddy/1.0 (+https://cigarmapsclaude-production.up.railway.app; pin check)';
const CENSUS_URL = 'https://geocoding.geo.census.gov/geocoder/locations/addressbatch';
const CENSUS_BENCHMARK = 'Public_AR_Current';
const CENSUS_BATCH = 2500;              // the API takes 10k, but a smaller file comes back sooner
const NOMINATIM_PAUSE_MS = 1100;        // their usage policy: at most one request a second
const DEFAULT_CACHE = path.join(__dirname, '..', '..', 'data', 'geocode-cache');

// The gates, all of which a pin has to pass before it moves on its own.
const PIN_DISAGREE_KM = 1;              // below this the pin and the address agree well enough
const GEOCODERS_AGREE_KM = 0.25;        // Census and Nominatim must land on the same building
const MAX_MOVE_KM = 50;                 // a longer move means the record is wrong, not the pin
const DEEP_IN_STATE_KM = 25;            // how far inside another state a pin must sit to count

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Reference tables ───────────────────────────────────────────────────────

/**
 * ZIP prefix to state. The first three digits of a US ZIP are a sectional
 * centre, and every centre belongs to one state, so this is the one part of a
 * bad record that cannot be argued with: Black Jack's ZIP 79901 is El Paso,
 * whatever the row says about Connecticut.
 */
const ZIP_PREFIX_STATE = [
  [5, 5, 'NY'], [6, 7, 'PR'], [8, 8, 'VI'], [9, 9, 'PR'], [10, 27, 'MA'], [28, 29, 'RI'], [30, 38, 'NH'],
  [39, 49, 'ME'], [50, 54, 'VT'], [55, 55, 'MA'], [56, 59, 'VT'], [60, 69, 'CT'], [70, 89, 'NJ'],
  [100, 149, 'NY'], [150, 196, 'PA'], [197, 199, 'DE'], [200, 200, 'DC'], [201, 201, 'VA'], [202, 205, 'DC'],
  [206, 219, 'MD'], [220, 246, 'VA'], [247, 268, 'WV'], [270, 289, 'NC'], [290, 299, 'SC'], [300, 319, 'GA'],
  [320, 349, 'FL'], [350, 369, 'AL'], [370, 385, 'TN'], [386, 397, 'MS'], [398, 399, 'GA'], [400, 427, 'KY'],
  [430, 459, 'OH'], [460, 479, 'IN'], [480, 499, 'MI'], [500, 528, 'IA'], [530, 549, 'WI'], [550, 567, 'MN'],
  [569, 569, 'DC'], [570, 577, 'SD'], [580, 588, 'ND'], [590, 599, 'MT'], [600, 629, 'IL'], [630, 658, 'MO'],
  [660, 679, 'KS'], [680, 693, 'NE'], [700, 714, 'LA'], [716, 729, 'AR'], [730, 732, 'OK'], [733, 733, 'TX'],
  [734, 749, 'OK'], [750, 799, 'TX'], [800, 816, 'CO'], [820, 831, 'WY'], [832, 838, 'ID'], [840, 847, 'UT'],
  [850, 865, 'AZ'], [870, 884, 'NM'], [885, 885, 'TX'], [889, 898, 'NV'], [900, 961, 'CA'], [967, 968, 'HI'],
  [970, 979, 'OR'], [980, 994, 'WA'], [995, 999, 'AK'],
];

/** The state a ZIP belongs to, or null when it is not a US ZIP. */
function zipState(zip) {
  const m = String(zip || '').match(/^(\d{5})/);
  if (!m) return null;
  const prefix = Number(m[1].slice(0, 3));
  for (const [from, to, state] of ZIP_PREFIX_STATE) if (prefix >= from && prefix <= to) return state;
  return null;
}

/**
 * NANPA area codes by state, used only ever as a second signal confirming the
 * ZIP. Mobile numbers travel, so an area code on its own proves nothing, but
 * a (915) number beside a 79901 ZIP is two independent parts of the record
 * both saying El Paso.
 */
const AREA_CODES = {
  AL: [205, 251, 256, 334, 659, 938], AK: [907], AZ: [480, 520, 602, 623, 928], AR: [327, 479, 501, 870],
  CA: [209, 213, 279, 310, 323, 341, 350, 369, 408, 415, 424, 442, 510, 530, 559, 562, 619, 626, 628, 650,
    657, 661, 669, 707, 714, 747, 760, 805, 818, 820, 831, 840, 858, 909, 916, 925, 935, 949, 951],
  CO: [303, 719, 720, 970, 983], CT: [203, 475, 860, 959], DE: [302], DC: [202],
  FL: [239, 305, 321, 324, 352, 386, 407, 448, 561, 645, 656, 689, 727, 754, 772, 786, 813, 850, 863, 904, 941, 954],
  GA: [229, 404, 470, 478, 678, 706, 762, 770, 912, 943], HI: [808], ID: [208, 986],
  IL: [217, 224, 309, 312, 331, 447, 464, 618, 630, 708, 730, 773, 779, 815, 847, 861, 872],
  IN: [219, 260, 317, 463, 574, 765, 812, 930], IA: [319, 515, 563, 641, 712], KS: [316, 620, 785, 913],
  KY: [270, 364, 502, 606, 859], LA: [225, 318, 337, 504, 985], ME: [207], MD: [227, 240, 301, 410, 443, 667],
  MA: [339, 351, 413, 508, 617, 774, 781, 857, 978],
  MI: [231, 248, 269, 313, 517, 586, 616, 679, 734, 810, 906, 947, 989],
  MN: [218, 320, 507, 612, 651, 763, 952], MS: [228, 601, 662, 769],
  MO: [235, 314, 417, 557, 573, 636, 660, 816, 975], MT: [406], NE: [308, 402, 531], NV: [702, 725, 775],
  NH: [603], NJ: [201, 551, 609, 640, 732, 848, 856, 862, 908, 973], NM: [505, 575],
  NY: [212, 315, 329, 332, 347, 363, 516, 518, 585, 607, 631, 646, 680, 716, 718, 838, 845, 914, 917, 929, 934],
  NC: [252, 336, 472, 704, 743, 828, 910, 919, 980, 984], ND: [701],
  OH: [216, 220, 234, 283, 326, 330, 380, 419, 436, 440, 513, 567, 614, 740, 937],
  OK: [405, 539, 572, 580, 918], OR: [458, 503, 541, 971],
  PA: [215, 223, 267, 272, 412, 445, 484, 570, 582, 610, 717, 724, 814, 835, 878], RI: [401],
  SC: [803, 821, 839, 843, 854, 864], SD: [605], TN: [423, 615, 629, 731, 865, 901, 931],
  TX: [210, 214, 254, 281, 325, 346, 361, 409, 430, 432, 469, 512, 682, 713, 726, 737, 806, 817, 830, 832,
    903, 915, 936, 940, 945, 956, 972, 979],
  UT: [385, 435, 801], VT: [802], VA: [276, 434, 540, 571, 686, 703, 757, 804, 826, 948],
  WA: [206, 253, 360, 425, 509, 564], WV: [304, 681], WI: [262, 274, 353, 414, 534, 608, 715, 920],
  WY: [307], PR: [787, 939],
};

const AREA_CODE_STATE = new Map();
for (const [state, codes] of Object.entries(AREA_CODES)) for (const c of codes) AREA_CODE_STATE.set(c, state);

// A toll-free number belongs to no town, so it is never a signal about one.
const TOLL_FREE = new Set([800, 833, 844, 855, 866, 877, 888]);

// Canadian area codes, for telling a Windsor, Ontario record from a Michigan one.
const CANADA_AREA_CODES = new Set([204, 226, 236, 249, 250, 289, 306, 343, 354, 365, 367, 368, 382, 387, 403,
  416, 418, 428, 431, 437, 438, 450, 468, 474, 506, 514, 519, 548, 579, 581, 584, 587, 600, 604, 613, 639,
  647, 672, 683, 705, 709, 742, 753, 778, 780, 782, 807, 819, 825, 867, 873, 879, 902, 905]);

/** The three digits after any +1 and any punctuation: "(915) 534-3000" is 915. */
function areaCode(phone) {
  const digits = String(phone || '').replace(/\D+/g, '');
  if (!digits) return null;
  const national = digits.length === 11 && digits[0] === '1' ? digits.slice(1) : digits;
  if (national.length !== 10) return null;
  return Number(national.slice(0, 3));
}

/** The state an area code belongs to, or null for toll-free, Canadian and unknown codes. */
function areaCodeState(phone) {
  const code = areaCode(phone);
  if (!code || TOLL_FREE.has(code)) return null;
  return AREA_CODE_STATE.get(code) || null;
}

// ── Address shapes ─────────────────────────────────────────────────────────

/**
 * A highway address, where neither geocoder can be trusted.
 *
 * "400 US-41" in Negaunee is a real door on a numbered route that runs for
 * hundreds of miles, and the Census put it 8.9 km from the pin the chain's own
 * store locator confirms. Rural routes, state roads and frontage roads fail
 * the same way, so nothing on one ever moves automatically.
 */
function highwayAddress(address) {
  const s = String(address || '');
  return /\b(?:us|sr|fm|rr|hc|sh|pr|tr)[-\s]?\d/i.test(s)
    || /\b(?:hwy|highway|route|rte|state\s+(?:road|route|hwy)|county\s+(?:road|route|line)|business\s+spur|frontage|bypass|interstate|i-\d)\b/i.test(s)
    || /\bc(?:ounty)?\.?\s?r(?:oad|d)?[-\s]?\d/i.test(s)
    || /\b[a-z]{2}[-\s]\d{1,3}\b/i.test(s);   // "PA-328", "M-28": a state route wearing its state's initials
}

/** The house number an address starts with, or null when it does not start with one. */
function houseNumber(address) {
  const m = String(address || '').trim().match(/^(\d+)/);
  return m ? m[1] : null;
}

/** The street part, folded for comparison: "156 E Eastland St" -> "e eastland st". */
function streetKey(address) {
  return String(address || '')
    .replace(/^\s*\d+\s*/, '')
    .replace(/\b(?:ste|suite|unit|apt|bldg|building|#)\s*[\w-]*$/i, '')
    .toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Kilometres between two points. */
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371, rad = d => d * Math.PI / 180;
  const dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ── The Census batch geocoder ──────────────────────────────────────────────

/** The one line the batch file wants, and the key its answer comes back under. */
function censusQuery(row) {
  const clean = v => String(v ?? '').replace(/["\r\n]+/g, ' ').trim();
  return [clean(row.address), clean(row.city), clean(row.state), clean(row.zip)].join(', ');
}

/** One CSV line into fields, honouring the quotes around addresses with commas in them. */
function splitCsv(line) {
  const out = [];
  let field = '', inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQuotes = !inQuotes; continue; }
    if (c === ',' && !inQuotes) { out.push(field); field = ''; continue; }
    field += c;
  }
  out.push(field);
  return out;
}

/**
 * One answer line from the batch geocoder.
 * "id","input","Match","Exact","matched address","lng,lat","tigerline","side"
 */
function parseCensusLine(line) {
  const f = splitCsv(line);
  if (f.length < 3) return null;
  const answer = { id: Number(f[0]), query: f[1], match: f[2], type: f[3] || null, matched: f[4] || null, lat: null, lng: null, zip: null, state: null, city: null };
  if (answer.match !== 'Match' || !f[5]) return answer;
  const [lng, lat] = f[5].split(',').map(Number);
  answer.lat = Number.isFinite(lat) ? lat : null;
  answer.lng = Number.isFinite(lng) ? lng : null;
  // The matched address ends "STREET, CITY, ST, ZIP".
  const parts = String(answer.matched).split(',').map(s => s.trim());
  if (parts.length >= 4) {
    answer.zip = (parts[parts.length - 1].match(/\d{5}/) || [])[0] || null;
    answer.state = parts[parts.length - 2].toUpperCase();
    answer.city = parts[parts.length - 3];
  }
  return answer;
}

/** POST one batch file and return the raw CSV answer. */
function postCensusBatch(csv) {
  const boundary = '----cigarbuddy' + Math.random().toString(36).slice(2);
  const parts = [
    `--${boundary}\r\nContent-Disposition: form-data; name="benchmark"\r\n\r\n${CENSUS_BENCHMARK}\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="addressFile"; filename="addresses.csv"\r\nContent-Type: text/csv\r\n\r\n${csv}\r\n`,
    `--${boundary}--\r\n`,
  ];
  const body = Buffer.from(parts.join(''), 'utf8');
  const url = new URL(CENSUS_URL);
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: url.hostname, path: url.pathname, method: 'POST',
      headers: { 'User-Agent': UA, 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length },
      timeout: 300000,
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`census HTTP ${res.statusCode}`));
        resolve(Buffer.concat(chunks).toString('utf8'));
      });
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('census timeout')));
    req.on('error', reject);
    req.end(body);
  });
}

/** Answers already collected, so a re-run costs nobody another request. */
function loadCache(file) {
  const map = new Map();
  if (!fs.existsSync(file)) return map;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { const r = JSON.parse(line); if (r.query) map.set(r.query, r); } catch {}
  }
  return map;
}

function appendCache(file, records) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, records.map(r => JSON.stringify(r)).join('\n') + '\n');
}

/** Step 1: geocode every public address the directory holds. */
async function geocode({ out, cache = DEFAULT_CACHE, all = false, log = console.log } = {}) {
  const rows = await db.all(`
    SELECT id, name, address, city, state, zip, phone, website, lat, lng, timezone, visible,
           COALESCE(claimed, 0) AS claimed, COALESCE(staff_edited, 0) AS staff_edited
    FROM stores
    WHERE lat IS NOT NULL AND lng IS NOT NULL ${all ? '' : 'AND visible = 1'}
    ORDER BY id`);
  const usable = rows.filter(r => houseNumber(r.address));
  const cacheFile = path.join(cache, 'census.jsonl');
  const known = loadCache(cacheFile);
  const todo = usable.filter(r => !known.has(censusQuery(r)));
  log(`${rows.length} listings, ${usable.length} with a street address, ${known.size} already geocoded, ${todo.length} to send`);

  for (let i = 0; i < todo.length; i += CENSUS_BATCH) {
    const batch = todo.slice(i, i + CENSUS_BATCH);
    const csv = batch.map(r => `${r.id},"${censusQuery(r).split(', ').join('","')}"`).join('\n') + '\n';
    process.stdout.write(`  batch ${i / CENSUS_BATCH + 1} of ${Math.ceil(todo.length / CENSUS_BATCH)} (${batch.length} addresses)... `);
    let answer;
    try { answer = await postCensusBatch(csv); }
    catch (err) { log(`FAILED: ${err.message}`); continue; }
    const parsed = answer.split('\n').map(l => l.trim()).filter(Boolean).map(parseCensusLine).filter(Boolean);
    appendCache(cacheFile, parsed);
    for (const p of parsed) known.set(p.query, p);
    log(`${parsed.filter(p => p.match === 'Match').length} matched`);
  }

  const results = [];
  for (const r of usable) {
    const answer = known.get(censusQuery(r));
    if (!answer) continue;
    const km = answer.lat === null ? null : haversineKm(r.lat, r.lng, answer.lat, answer.lng);
    results.push({ ...r, census: answer, km });
  }
  const matched = results.filter(r => r.km !== null);
  const far = matched.filter(r => r.km > PIN_DISAGREE_KM);
  log(`${matched.length} addresses matched; ${far.length} pins more than ${PIN_DISAGREE_KM} km from their own address, ${matched.filter(r => r.km > 5).length} more than 5 km`);
  if (out) { fs.writeFileSync(out, results.map(r => JSON.stringify(r)).join('\n') + '\n'); log(`written to ${out}`); }
  return results;
}

// ── Nominatim, the second opinion ──────────────────────────────────────────

function getJson(url) {
  return new Promise(resolve => {
    https.get(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, timeout: 30000 }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve(null); } });
      res.on('error', () => resolve(null));
    }).on('error', () => resolve(null)).on('timeout', function () { this.destroy(); resolve(null); });
  });
}

/**
 * Ask Nominatim for the same address, structured so it cannot wander off into
 * a free-text guess. Only a result that carries a house number counts as an
 * independent confirmation: a road centroid is not a door.
 */
async function nominatimOne(row) {
  const street = String(row.address || '').replace(/\b(ste|suite|unit|apt|#)\s*[\w-]*$/i, '').trim();
  const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=1&countrycodes=us'
    + `&street=${encodeURIComponent(street)}&city=${encodeURIComponent(row.city || '')}`
    + `&state=${encodeURIComponent(row.state || '')}&postalcode=${encodeURIComponent(row.zip || '')}`;
  const answer = await getJson(url);
  const hit = Array.isArray(answer) ? answer[0] : null;
  if (!hit) return { id: row.id, found: false };
  const house = (hit.address || {}).house_number || null;
  return {
    id: row.id, found: true,
    lat: Number(hit.lat), lng: Number(hit.lon),
    house, level: house ? 'house' : (hit.addresstype || hit.type || 'area'),
    display: String(hit.display_name || '').slice(0, 140),
  };
}

/** Step 2: a second opinion, only where the Census and our pin disagree. */
async function nominatim({ geo, out, cache = DEFAULT_CACHE, log = console.log } = {}) {
  const rows = readJsonl(geo).filter(r => r.km !== null && r.km > PIN_DISAGREE_KM);
  const cacheFile = path.join(cache, 'nominatim.jsonl');
  const known = new Map();
  if (fs.existsSync(cacheFile)) {
    for (const line of fs.readFileSync(cacheFile, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { const r = JSON.parse(line); known.set(r.id, r); } catch {}
    }
  }
  log(`${rows.length} disagreements over ${PIN_DISAGREE_KM} km; ${rows.filter(r => known.has(r.id)).length} already asked`);
  for (const r of rows) {
    if (known.has(r.id)) continue;
    const answer = await nominatimOne(r);
    known.set(r.id, answer);
    appendCache(cacheFile, [answer]);
    await sleep(NOMINATIM_PAUSE_MS);
  }
  const answers = rows.map(r => known.get(r.id)).filter(Boolean);
  log(`${answers.filter(a => a.found).length} of ${answers.length} found, ${answers.filter(a => a.level === 'house').length} at house level`);
  if (out) { fs.writeFileSync(out, answers.map(a => JSON.stringify(a)).join('\n') + '\n'); log(`written to ${out}`); }
  return answers;
}

// ── The address, said by somebody other than the directory ─────────────────

function walkAddresses(node, out) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const n of node) walkAddresses(n, out); return; }
  const a = node.address;
  if (a && typeof a === 'object' && !Array.isArray(a) && a.streetAddress) {
    out.push({ street: String(a.streetAddress), city: String(a.addressLocality || ''), zip: String(a.postalCode || '') });
  }
  for (const k of Object.keys(node)) walkAddresses(node[k], out);
}

/**
 * The street addresses each shop's own site and each chain's store locator
 * publish, read out of evidence the hours sweep already downloaded. A door
 * the shop itself prints is the strongest backing a geocode can have.
 */
function loadSiteAddresses(dir, { log = console.log } = {}) {
  const byId = new Map();
  if (!dir || !fs.existsSync(dir)) return byId;
  const files = fs.readdirSync(dir).filter(f => /^(hours_evidence|render_full|render_unreachable|chain_evidence).*\.jsonl$/.test(f));
  for (const file of files) {
    for (const line of fs.readFileSync(path.join(dir, file), 'utf8').split('\n')) {
      if (!line.includes('streetAddress')) continue;
      let rec; try { rec = JSON.parse(line); } catch { continue; }
      if (!rec.id) continue;
      const found = [];
      for (const block of rec.jsonld || []) { try { walkAddresses(JSON.parse(block), found); } catch {} }
      for (const block of rec.microdata || []) walkAddresses(block, found);
      if (!found.length) continue;
      const list = byId.get(rec.id) || [];
      list.push(...found);
      byId.set(rec.id, list);
    }
  }
  log(`${byId.size} listings publish a street address in their own markup`);
  return byId;
}

/** Does the shop's own site print this door? Same house number, same street. */
function siteBacksAddress(address, published) {
  const number = houseNumber(address), street = streetKey(address);
  if (!number || !street) return false;
  return (published || []).some(p => houseNumber(p.street) === number && streetKey(p.street) === street);
}

// ── The verdicts ───────────────────────────────────────────────────────────

/**
 * Should this pin move on its own?
 *
 * All five gates have to pass: an ordinary street, an exact Census match, a
 * house-level Nominatim result on the same building, both geocoders more than
 * a kilometre from our pin, a move no longer than 50 km, and the address
 * backed by something other than the directory — the geocoder returning our
 * own ZIP, the shop's own website, or a chain's store list. Anything else is
 * described and handed to a person.
 */
function pinVerdict(row) {
  const { census, nominatim: nomi, km } = row;
  const holds = [];
  if (km === null || km === undefined) return { action: 'skip', holds: ['the geocoder could not find the address'] };
  if (km <= PIN_DISAGREE_KM) return { action: 'skip', holds: [] };

  const moveKm = km;
  if (highwayAddress(row.address)) holds.push(`"${row.address}" is a highway address, where the geocoder is wrong about as often as the pin`);
  if (census.type !== 'Exact') holds.push(`the Census match is ${census.type || 'not exact'} ("${census.matched}")`);
  if (!nomi || !nomi.found) holds.push('Nominatim found no second opinion');
  else if (nomi.level !== 'house') holds.push(`Nominatim answered at ${nomi.level} level, not a house number`);
  else {
    const apart = haversineKm(census.lat, census.lng, nomi.lat, nomi.lng);
    if (apart > GEOCODERS_AGREE_KM) holds.push(`the two geocoders are ${apart.toFixed(2)} km apart`);
    if (haversineKm(row.lat, row.lng, nomi.lat, nomi.lng) <= PIN_DISAGREE_KM) holds.push('Nominatim agrees with the pin we already have');
  }
  if (moveKm > MAX_MOVE_KM) holds.push(`the move is ${Math.round(moveKm)} km, past the ${MAX_MOVE_KM} km limit — a record that wrong is wrong about more than its pin`);
  if (census.state && row.state && census.state !== String(row.state).toUpperCase()) {
    holds.push(`the address geocodes into ${census.state}, not ${row.state}: the state is the problem, not the pin`);
  }

  const backing = [];
  if (census.zip && row.zip && census.zip === String(row.zip).slice(0, 5)) backing.push("the geocoder's ZIP");
  if (row.site_backed) backing.push('its own website');
  if (row.chain_backed) backing.push("its chain's store list");
  if (!backing.length) holds.push('nothing outside the directory backs the address: the geocoder returned a different ZIP and no site or chain feed prints this door');

  return {
    action: holds.length ? 'review' : 'move',
    holds,
    backed_by: backing.join(' and ') || null,
    move_km: Math.round(moveKm * 100) / 100,
  };
}

/**
 * Should this listing's state change?
 *
 * The ZIP prefix leads, because a sectional centre belongs to exactly one
 * state, and one more independent signal has to agree with it: the area code,
 * a pin sitting deep inside that state, or the geocoder finding the street in
 * that state at our own ZIP. One signal alone is never enough — Puro Estilo
 * Cigars answers an Israeli mobile from a real shop in Bethlehem, PA.
 */
function stateVerdict(row) {
  const listed = String(row.state || '').toUpperCase();
  const byZip = zipState(row.zip);
  if (!byZip || !listed || byZip === listed) return null;

  const signals = [`its ZIP ${String(row.zip).slice(0, 5)} is a ${byZip} sectional centre`];
  const byArea = areaCodeState(row.phone);
  if (byArea === byZip) signals.push(`its ${areaCode(row.phone)} area code is ${byZip}`);
  if (row.pin_state === byZip && row.km_from_listed_state > DEEP_IN_STATE_KM) {
    signals.push(`its pin is ${Math.round(row.km_from_listed_state)} km inside ${byZip}`);
  }
  const census = row.census || {};
  if (census.state === byZip && census.zip && row.zip && census.zip === String(row.zip).slice(0, 5)) {
    signals.push(`the geocoder found "${census.matched}" at our own ZIP`);
  }
  if (signals.length < 2) return null;
  return { to: byZip, signals };
}

/**
 * Every part of the record that disagrees with every other part. Three or more
 * and there is nothing left to repair: Cigar Crafted gives a Salt Lake City
 * address with a Houston pin, a toll-free number and a t-shirt shop for a
 * website, and no single edit makes it a cigar shop anybody can visit.
 */
function contradictions(row) {
  const listed = String(row.state || '').toUpperCase();
  const out = [];
  const byZip = zipState(row.zip);
  const byArea = areaCodeState(row.phone);
  if (byZip && listed && byZip !== listed) out.push(`its ZIP is ${byZip} but it is filed in ${listed}`);
  if (byArea && listed && byArea !== listed) out.push(`its area code is ${byArea} but it is filed in ${listed}`);
  if (byZip && byArea && byZip !== byArea) out.push(`its ZIP says ${byZip} and its phone says ${byArea}`);
  if (row.pin_state && listed && row.pin_state !== listed && row.km_from_listed_state > DEEP_IN_STATE_KM) {
    out.push(`its pin is ${Math.round(row.km_from_listed_state)} km inside ${row.pin_state}, not ${listed}`);
  }
  if (byZip && row.pin_state && byZip !== row.pin_state && row.km_from_zip_state > DEEP_IN_STATE_KM) {
    out.push(`its pin is in ${row.pin_state} and its ZIP is in ${byZip}`);
  }
  if (row.km !== null && row.km !== undefined && row.km > 100) out.push(`its pin is ${Math.round(row.km)} km from the address it gives`);
  if (!houseNumber(row.address)) out.push(`"${row.address || 'no address'}" is not a street address`);
  if (row.site_km > 500) out.push(`the website on the record publishes an address ${Math.round(row.site_km)} km away`);
  return out;
}

/**
 * A record from another country. Never on a phone number alone: Puro Estilo
 * Cigars sells from 518 Bradley St, Bethlehem PA and answers a +972 mobile.
 * Two signals, and La Casa del Habano on Ouellette Avenue turns out to be in
 * Windsor, Ontario — postcode N9A, area code 519, and a pin in a Canadian
 * time zone.
 */
function foreignVerdict(row) {
  const signals = [];
  const zip = String(row.zip || '').trim();
  if (/^[A-Za-z]\d[A-Za-z]/.test(zip)) signals.push(`"${zip}" is a Canadian postcode, not a ZIP`);
  const code = areaCode(row.phone);
  if (code && CANADA_AREA_CODES.has(code)) signals.push(`${code} is a Canadian area code`);
  const digits = String(row.phone || '').replace(/[^\d+]/g, '');
  const intl = digits.match(/^\+(\d{1,3})/);
  if (intl && intl[1] !== '1') signals.push(`its phone is a +${intl[1]} number`);
  if (row.pin_zone && !/^(America|Pacific)\//.test(row.pin_zone)) signals.push(`its pin stands in ${row.pin_zone}`);
  else if (row.pin_foreign) signals.push(`its pin is outside every US state, in ${row.pin_zone}`);
  return { foreign: signals.length >= 2, signals };
}

// ── The dry run ────────────────────────────────────────────────────────────

function readJsonl(file) {
  const out = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch {}
  }
  return out;
}

/** Degrees to kilometres, near enough for a "is this pin nowhere near" test. */
function bboxKm(lat, lng, box) {
  const dLat = Math.max(box.minLat - lat, 0, lat - box.maxLat);
  const dLng = Math.max(box.minLng - lng, 0, lng - box.maxLng) * Math.cos(lat * Math.PI / 180);
  return Math.hypot(dLat, dLng) * 111.32;
}

/** Step 3: turn the geocodes into decisions a person can read. */
async function decide({ geo, nomi, evidence, out, log = console.log } = {}) {
  const rows = readJsonl(geo);
  const second = new Map(nomi && fs.existsSync(nomi) ? readJsonl(nomi).map(a => [a.id, a]) : []);
  const sites = loadSiteAddresses(evidence, { log });
  const states = await loadStates();
  const { find: zonesAtPoint } = require('geo-tz');

  // Every listing, geocodable or not, so a record with no address at all can
  // still be judged on its ZIP, its phone and its pin.
  const all = await db.all(`
    SELECT id, name, address, city, state, zip, phone, website, lat, lng, timezone, visible,
           COALESCE(claimed, 0) AS claimed, COALESCE(staff_edited, 0) AS staff_edited
    FROM stores WHERE visible = 1 AND lat IS NOT NULL AND lng IS NOT NULL ORDER BY id`);
  const geoById = new Map(rows.map(r => [r.id, r]));

  const enriched = [];
  for (const s of all) {
    const g = geoById.get(s.id) || {};
    const listedBox = states.find(x => x.code === String(s.state || '').toUpperCase());
    const zipBox = states.find(x => x.code === zipState(s.zip));
    let pinState = null, best = Infinity;
    for (const st of states) {
      const d = bboxKm(s.lat, s.lng, st.bbox);
      if (d < best) { best = d; pinState = st.code; }
    }
    if (best > DEEP_IN_STATE_KM) pinState = null;   // out at sea, or in another country
    const zones = (() => { try { return zonesAtPoint(s.lat, s.lng) || []; } catch { return []; } })();
    enriched.push({
      ...s,
      census: g.census || null,
      km: g.km === undefined ? null : g.km,
      nominatim: second.get(s.id) || null,
      site_backed: siteBacksAddress(s.address, sites.get(s.id)),
      chain_backed: false,
      pin_state: pinState,
      pin_zone: zones[0] || null,
      pin_foreign: best > DEEP_IN_STATE_KM,
      km_from_listed_state: listedBox ? bboxKm(s.lat, s.lng, listedBox.bbox) : 0,
      km_from_zip_state: zipBox ? bboxKm(s.lat, s.lng, zipBox.bbox) : 0,
    });
  }

  const pinsAuto = [], pinsReview = [], stateFixes = [], hides = [];
  for (const r of enriched) {
    if (r.claimed || r.staff_edited) continue;   // the shop speaks for itself

    const foreign = foreignVerdict(r);
    const clashes = contradictions(r);
    if (foreign.foreign || clashes.length >= 3) {
      hides.push({
        id: r.id, name: r.name, address: r.address, city: r.city, state: r.state, zip: r.zip,
        phone: r.phone, website: r.website, lat: r.lat, lng: r.lng,
        kind: foreign.foreign ? 'foreign' : 'contradicts_itself',
        signals: foreign.foreign ? foreign.signals : clashes,
        reason: foreign.foreign
          ? `this listing is not in the United States: ${foreign.signals.join('; ')}`
          : `the record contradicts itself: ${clashes.join('; ')}`,
        verdict: null,
      });
      continue;   // nothing to repair on a record we are proposing to hide
    }

    const state = stateVerdict(r);
    if (state) {
      const pinIsGood = r.km !== null && r.km <= PIN_DISAGREE_KM;
      const zone = pinIsGood ? timeZoneFor(state.to, r.lat, r.lng) : null;
      stateFixes.push({
        id: r.id, name: r.name, address: r.address, city: r.city, state: r.state, zip: r.zip, phone: r.phone,
        to_state: state.to,
        to_city: r.census && r.census.city && r.census.state === state.to ? titleCase(r.census.city) : null,
        signals: state.signals,
        pin: { lat: r.lat, lng: r.lng, km_from_address: r.km === null ? null : Math.round(r.km * 100) / 100 },
        timezone: { from: r.timezone, to: zone },
        // A state written without a pin to go with it leaves the row on the
        // wrong clock: Black Jack's would be a Texas shop still pinned in
        // Connecticut, and timeZoneFor would read Eastern off that pin. So a
        // state only moves on its own when the pin is already at the door.
        action: pinIsGood ? 'fix' : 'review',
        hold: pinIsGood ? null
          : (r.km === null
            ? 'the address could not be geocoded, so the pin cannot be checked or moved with the state'
            : `the pin is ${Math.round(r.km)} km from the address; the state and the pin have to move together, and the row then needs its time zone recomputed with utils/storeHours.timeZoneFor`),
        verdict: null,
        reason: `filed in ${r.state}, but ${state.signals.join(', and ')}`,
      });
      continue;
    }

    const pin = pinVerdict(r);
    if (pin.action === 'skip') continue;
    const decision = {
      id: r.id, name: r.name, address: r.address, city: r.city, state: r.state, zip: r.zip,
      phone: r.phone, website: r.website,
      from: { lat: r.lat, lng: r.lng },
      to: { lat: r.census.lat, lng: r.census.lng },
      move_km: pin.move_km,
      census: { type: r.census.type, matched: r.census.matched, zip: r.census.zip },
      nominatim: r.nominatim && r.nominatim.found
        ? { lat: r.nominatim.lat, lng: r.nominatim.lng, level: r.nominatim.level, display: r.nominatim.display }
        : null,
      backed_by: pin.backed_by,
      timezone: { from: r.timezone, to: timeZoneFor(r.state, r.census.lat, r.census.lng) },
      reason: `the pin is ${pin.move_km} km from ${r.address}, ${r.city} ${r.state}`,
    };
    if (pin.action === 'move') pinsAuto.push(decision);
    else pinsReview.push({ ...decision, holds: pin.holds, verdict: null });
  }

  log('');
  log(`${pinsAuto.length} pins move on their own; ${pinsReview.length} wait for a person`);
  log(`${stateFixes.filter(s => s.action === 'fix').length} states change on their own; ${stateFixes.filter(s => s.action === 'review').length} wait for a person`);
  log(`${hides.filter(h => h.kind === 'foreign').length} listings are not in the United States; ${hides.filter(h => h.kind !== 'foreign').length} contradict themselves`);
  for (const d of pinsAuto.slice(0, 20)) log(`  move  #${d.id} ${d.name} — ${d.move_km} km, backed by ${d.backed_by}`);
  for (const d of stateFixes) log(`  state #${d.id} ${d.name} — ${d.state} -> ${d.to_state} (${d.action})`);
  for (const d of hides) log(`  hide  #${d.id} ${d.name} — ${d.reason}`);

  if (out) {
    fs.mkdirSync(out, { recursive: true });
    const write = (file, data) => fs.writeFileSync(path.join(out, file), JSON.stringify(data, null, 1));
    write('pins_auto.json', pinsAuto);
    write('pins_review.json', pinsReview);
    write('states.json', stateFixes);
    write('hides.json', hides);
    log(`\nwritten to ${out}`);
  }
  return { pinsAuto, pinsReview, stateFixes, hides };
}

function titleCase(s) {
  return String(s || '').toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());
}

// ── Applying a reviewed file ───────────────────────────────────────────────

/**
 * Write a pin, and put the row back on the clock that pin keeps. The
 * coordinates are written as 'geocode', which outranks the directory, so the
 * next import refreshes the rest of the row and leaves the pin alone.
 */
async function movePin(d, { job = 'geocodePins' } = {}) {
  const row = await db.get('SELECT state, lat, lng, timezone FROM stores WHERE id = ?', [d.id]);
  if (!row) return [];
  const state = d.to_state || row.state;
  const zone = timeZoneFor(state, d.to.lat, d.to.lng);
  const changes = { lat: d.to.lat, lng: d.to.lng };
  if (zone && zone !== row.timezone) changes.timezone = zone;
  return writeFields(d.id, changes, { source: 'geocode', job, reason: d.reason });
}

async function apply(file, { log = console.log } = {}) {
  const decisions = JSON.parse(fs.readFileSync(file, 'utf8'));
  let pins = 0, statesChanged = 0, hidden = 0, skipped = 0;
  for (const d of decisions) {
    // A review file is only ever applied where a person has written a verdict.
    if ('verdict' in d && d.verdict !== 'move' && d.verdict !== 'fix' && d.verdict !== 'hide') { skipped++; continue; }

    if (d.kind) {
      const res = await db.run(`
        UPDATE stores SET visible = 0, storefront = 'unproven', storefront_reason = ?, storefront_checked_at = NOW()
        WHERE id = ? AND COALESCE(claimed, 0) = 0 AND COALESCE(staff_edited, 0) = 0`,
        [String(d.reason).slice(0, 300), d.id]);
      hidden += res.changes;
      continue;
    }

    if (d.to_state) {
      const changes = { state: d.to_state };
      if (d.to_city) changes.city = d.to_city;
      const row = await db.get('SELECT lat, lng, timezone FROM stores WHERE id = ?', [d.id]);
      const lat = d.to ? d.to.lat : row.lat, lng = d.to ? d.to.lng : row.lng;
      if (d.to) { changes.lat = lat; changes.lng = lng; }
      const zone = timeZoneFor(d.to_state, lat, lng);
      if (zone && zone !== row.timezone) changes.timezone = zone;
      const written = await writeFields(d.id, changes, { source: 'geocode', job: 'geocodePins', reason: d.reason });
      statesChanged += written.length ? 1 : 0;
      continue;
    }

    const written = await movePin(d);
    pins += written.includes('lat') || written.includes('lng') ? 1 : 0;
  }
  const left = await db.get('SELECT COUNT(*)::int AS n FROM stores WHERE visible = 1');
  log(`${pins} pins moved to the door the address gives, ${statesChanged} states corrected, ${hidden} listings hidden, ${skipped} left for a person. ${left.n} listings remain public.`);
  return { pins, states: statesChanged, hidden, skipped, remaining: left.n };
}

// ── Self-test ──────────────────────────────────────────────────────────────

function selfTest() {
  let pass = 0, fail = 0;
  const ok = (name, got, want) => {
    const good = JSON.stringify(got) === JSON.stringify(want);
    if (good) pass++; else { fail++; console.log(`  FAIL ${name}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`); }
  };

  // ZIP prefixes: the one part of a broken record that cannot be argued with.
  ok('zip 79901 is El Paso', zipState('79901'), 'TX');
  ok('zip 86303 is Prescott', zipState('86303'), 'AZ');
  ok('zip 71033 is Greenwood LA', zipState('71033'), 'LA');
  ok('zip 03865 is Plaistow NH', zipState('03865'), 'NH');
  ok('zip 19703 is Claymont DE', zipState('19703'), 'DE');
  ok('zip 18015 is Bethlehem PA', zipState('18015'), 'PA');
  ok('a Canadian postcode is not a ZIP', zipState('N9A'), null);

  ok('915 is El Paso', areaCodeState('(915) 534-3000'), 'TX');
  ok('928 is northern Arizona', areaCodeState('(928) 778-7600'), 'AZ');
  ok('318 is north Louisiana', areaCodeState('(318) 938-8008'), 'LA');
  ok('toll-free belongs to no town', areaCodeState('(855) 999-7840'), null);
  ok('519 is Ontario, so no US state', areaCodeState('(519) 254-0017'), null);

  // Highway addresses, where the geocoder is no better than the pin.
  ok('400 US-41 is a highway address', highwayAddress('400 US-41'), true);
  ok('7384 PA-328 is a highway address', highwayAddress('7384 PA-328'), true);
  ok('11650 US Highway 80 is a highway address', highwayAddress('11650 US Highway 80'), true);
  ok('156 E Eastland St is an ordinary street', highwayAddress('156 E Eastland St'), false);
  ok('273 Amsterdam Ave is an ordinary street', highwayAddress('273 Amsterdam Ave'), false);
  ok('1303 E Grand Ave is an ordinary street', highwayAddress('1303 E Grand Ave'), false);

  // Greystone Cigars: 156 E Eastland St, Gallatin TN, pinned 40 km away in
  // Springfield. Exact match, ordinary street, our own ZIP back from the
  // geocoder, and Nominatim on the same building. This one moves.
  const greystone = {
    id: 32256, address: '156 E Eastland St', city: 'Gallatin', state: 'TN', zip: '37066',
    lat: 36.490887, lng: -86.881615, km: 40.5,
    census: { type: 'Exact', matched: '156 E EASTLAND ST, GALLATIN, TN, 37066', state: 'TN', zip: '37066', lat: 36.38874, lng: -86.43196 },
    nominatim: { found: true, level: 'house', lat: 36.38881, lng: -86.43201 },
  };
  ok('Greystone Cigars moves', pinVerdict(greystone).action, 'move');
  ok('Greystone is backed by the ZIP', pinVerdict(greystone).backed_by, "the geocoder's ZIP");

  // Tobacco Junction of Marshall: the address is right, the pin is 404 km away
  // near Comanche. Too far to move without a person looking at it.
  const marshall = {
    id: 2979, address: '1303 E Grand Ave', city: 'Marshall', state: 'TX', zip: '75670',
    lat: 31.898838, lng: -98.587921, km: 404.6,
    census: { type: 'Exact', matched: '1303 E GRAND AVE, MARSHALL, TX, 75670', state: 'TX', zip: '75670', lat: 32.5449, lng: -94.3444 },
    nominatim: { found: true, level: 'house', lat: 32.5449, lng: -94.3445 },
  };
  ok('Tobacco Junction of Marshall waits for a person', pinVerdict(marshall).action, 'review');
  ok('and it waits because of the 50 km limit',
    pinVerdict(marshall).holds.some(h => h.includes('50 km limit')), true);

  // Amsterdam Tobacco House: 273 Amsterdam Ave, pinned on Long Island, 54 km
  // away. Everything else passes, but 54 km is past the limit, so it is
  // reviewed rather than moved silently.
  const amsterdam = {
    id: 37553, address: '273 Amsterdam Ave', city: 'New York', state: 'NY', zip: '10023',
    lat: 40.720585, lng: -73.343727, km: 54.1,
    census: { type: 'Exact', matched: '273 AMSTERDAM AVE, NEW YORK, NY, 10023', state: 'NY', zip: '10023', lat: 40.78163, lng: -73.98151 },
    nominatim: { found: true, level: 'house', lat: 40.78166, lng: -73.98155 },
  };
  ok('Amsterdam Tobacco House waits for a person', pinVerdict(amsterdam).action, 'review');
  ok('Amsterdam Tobacco House has no other hold',
    pinVerdict(amsterdam).holds.filter(h => !h.includes('50 km limit')).length, 0);

  // Wild Bill's of Negaunee, "400 US-41": the Census is 8.9 km out and the
  // chain's own store locator says our pin is right to 50 m. Must not move.
  const negaunee = {
    id: 16747, address: '400 US-41', city: 'Negaunee', state: 'MI', zip: '49866',
    lat: 46.508274, lng: -87.609795, km: 8.9,
    census: { type: 'Exact', matched: '400 US HWY 41, NEGAUNEE, MI, 49866', state: 'MI', zip: '49866', lat: 46.4936, lng: -87.7168 },
    nominatim: { found: true, level: 'house', lat: 46.4936, lng: -87.7169 },
  };
  ok("Wild Bill's of Negaunee does not move", pinVerdict(negaunee).action, 'review');
  ok('and it is held because it is a highway address',
    pinVerdict(negaunee).holds.some(h => h.includes('highway address')), true);

  // Bright fire cigars, 2015 Main St, Liberty Hill TX: the geocoder answered
  // with Liberty, TX — a different town, a different ZIP. Never move on that.
  const liberty = {
    id: 3032, address: '2015 Main St', city: 'Liberty Hill', state: 'TX', zip: '78642',
    lat: 30.66, lng: -97.92, km: 309.1,
    census: { type: 'Non_Exact', matched: '2015 N MAIN ST, LIBERTY, TX, 77575', state: 'TX', zip: '77575', lat: 30.06, lng: -94.79 },
    nominatim: { found: false },
  };
  ok('a geocode into another town does not move the pin', pinVerdict(liberty).action, 'review');
  ok('and the ZIP it came back with is called out',
    pinVerdict(liberty).holds.some(h => h.includes('nothing outside the directory backs the address')), true);

  // States. Black Jack's Cigar Lounge: 10 Henry Trost Ct with an El Paso ZIP
  // and an El Paso phone, filed and pinned in New London, Connecticut.
  const blackJacks = {
    id: 22498, name: "Black Jacks Cigar Lounge", address: ' 10 Henry Trost Ct', city: 'New London',
    state: 'CT', zip: '79901', phone: '(915) 534-3000', lat: 41.336464, lng: -72.107033,
    km: null, census: null, pin_state: 'CT', km_from_listed_state: 0, km_from_zip_state: 2600,
  };
  ok("Black Jack's moves to Texas", stateVerdict(blackJacks).to, 'TX');
  ok("Black Jack's is proved by the ZIP and the phone", stateVerdict(blackJacks).signals.length, 2);

  // Sam Hill's Cigars: really 202 S Montezuma St, Prescott AZ, filed in Gallup NM.
  const samHills = {
    id: 10839, address: '202 S Montezuma St', city: 'Gallup', state: 'NM', zip: '86303',
    phone: '(928) 778-7600', lat: 35.527813, lng: -108.74218, km: 356.7,
    census: { type: 'Non_Exact', matched: '202 S MONTEZUMA ST, PRESCOTT, AZ, 86303', state: 'AZ', zip: '86303' },
    pin_state: 'NM', km_from_listed_state: 0, km_from_zip_state: 300,
  };
  ok("Sam Hill's moves to Arizona", stateVerdict(samHills).to, 'AZ');

  // Tobacco Country, 11650 US Hwy 80, Greenwood LA, filed as Texas. The ZIP
  // and the 318 number both say Louisiana.
  const tobaccoCountry = {
    id: 42371, address: '11650 US Highway 80', city: 'Greenwood', state: 'TX', zip: '71033',
    phone: '(318) 938-8008', lat: 32.470602, lng: -94.042489, km: 0.1,
    census: { type: 'Non_Exact', matched: '11650 US HWY 80, GREENWOOD, LA, 71033', state: 'LA', zip: '71033' },
    pin_state: 'LA', km_from_listed_state: 0, km_from_zip_state: 0,
  };
  ok('Tobacco Country moves to Louisiana', stateVerdict(tobaccoCountry).to, 'LA');

  // Cigar Mafia, 440 Louisiana St, Houston, filed in New York. The pin is
  // already at the door, so the state and the clock can both be set at once.
  const cigarMafia = {
    id: 5577, address: '440 Louisiana St', city: 'Houston', state: 'NY', zip: '77002',
    phone: '(281) 536-4997', lat: 29.762873, lng: -95.364677, km: 0.02,
    census: { type: 'Non_Exact', matched: '440 LOUISIANA ST, HOUSTON, TX, 77002', state: 'TX', zip: '77002' },
    pin_state: 'TX', km_from_listed_state: 1900, km_from_zip_state: 0,
  };
  ok('Cigar Mafia moves to Texas', stateVerdict(cigarMafia).to, 'TX');
  ok('and Houston keeps Central time', timeZoneFor('TX', 29.762873, -95.364677), 'America/Chicago');
  // El Paso is the reason a state never sets a clock on its own: Texas is
  // Central everywhere except there.
  ok('El Paso keeps Mountain time', timeZoneFor('TX', 31.76188, -106.48502), 'America/Denver');

  // One signal is never enough.
  ok('a ZIP on its own does not move a state',
    stateVerdict({ state: 'NY', zip: '77002', phone: null, lat: 40, lng: -74, pin_state: 'NY', km_from_listed_state: 0, km_from_zip_state: 2000, census: null }), null);

  // Foreign records. La Casa del Habano on Ouellette Avenue is in Windsor,
  // Ontario: a Canadian postcode, a Canadian area code, and a Canadian clock.
  const windsor = { zip: 'N9A', phone: '(519) 254-0017', pin_zone: 'America/Toronto', pin_foreign: false };
  ok('Windsor, Ontario is foreign', foreignVerdict(windsor).foreign, true);
  ok('and it is proved three ways', foreignVerdict(windsor).signals.length, 3);

  // Puro Estilo Cigars answers an Israeli mobile from a real shop at 518
  // Bradley St, Bethlehem PA. A foreign phone alone never hides a listing.
  const puroEstilo = { zip: '18015', phone: '+972524711911', pin_zone: 'America/New_York', pin_foreign: false };
  ok('Puro Estilo is not foreign', foreignVerdict(puroEstilo).foreign, false);
  ok('Puro Estilo has one foreign signal and no more', foreignVerdict(puroEstilo).signals.length, 1);
  ok('Puro Estilo contradicts itself nowhere',
    contradictions({ state: 'PA', zip: '18015', phone: '+972524711911', address: '518 Bradley St', lat: 40.607384, lng: -75.386063, km: 0.0, pin_state: 'PA', km_from_listed_state: 0, km_from_zip_state: 0 }).length, 0);

  // Cigar Crafted: a Salt Lake City address, a Houston pin, a toll-free
  // number and a t-shirt shop for a website. Nothing left to repair.
  const cigarCrafted = {
    state: 'UT', zip: '84104', phone: '(855) 999-7840', address: '570 West 1730 South Suite 900',
    lat: 29.9821, lng: -95.296501, km: null, pin_state: 'TX', km_from_listed_state: 900,
    km_from_zip_state: 1100, site_km: 2000,
  };
  ok('Cigar Crafted contradicts itself three ways over', contradictions(cigarCrafted).length >= 3, true);

  // The parts of an address the comparisons rest on.
  ok('house number', houseNumber('156 E Eastland St'), '156');
  ok('a landmark is not a house number', houseNumber('Behind Outback Steakhouse, 6396 Lockwood Ridge Rd'), null);
  ok('street key drops the suite', streetKey('570 West 1730 South Suite 900'), 'west 1730 south');
  ok('a site that prints our door backs it',
    siteBacksAddress('518 Bradley St', [{ street: '518 Bradley Street' }]), true);
  ok('a site that prints another door does not',
    siteBacksAddress('518 Bradley St', [{ street: '2233 6th Ave S' }]), false);

  // The Census answer, read back off the wire.
  const line = '"2793","122 N LBJ Dr, San Marcos, TX, 78666","Match","Exact","122 N L B J DR, SAN MARCOS, TX, 78666","-97.939984780991,29.882547104262","63843373","R"';
  const parsed = parseCensusLine(line);
  ok('census id', parsed.id, 2793);
  ok('census state', parsed.state, 'TX');
  ok('census zip', parsed.zip, '78666');
  ok('census latitude', Math.round(parsed.lat * 1000) / 1000, 29.883);
  ok('a no-match line still parses', parseCensusLine('"91","1 Nowhere St, Nowhere, XX, 00000","No_Match"').match, 'No_Match');

  console.log(`geocodePins selftest: ${pass} passed, ${fail} failed`);
  return fail === 0;
}

module.exports = {
  geocode, nominatim, decide, apply, selfTest,
  zipState, areaCode, areaCodeState, highwayAddress, houseNumber, streetKey, haversineKm,
  pinVerdict, stateVerdict, contradictions, foreignVerdict, parseCensusLine, siteBacksAddress,
};

if (require.main === module) {
  const argv = process.argv.slice(2);
  const arg = name => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : null; };
  if (argv[0] === 'selftest') process.exit(selfTest() ? 0 : 1);
  (async () => {
    const cache = arg('--cache') || DEFAULT_CACHE;
    if (argv[0] === 'geocode') await geocode({ out: arg('--out'), cache, all: argv.includes('--all') });
    else if (argv[0] === 'nominatim') await nominatim({ geo: arg('--geo'), out: arg('--out'), cache });
    else if (argv[0] === 'decide') await decide({ geo: arg('--geo'), nomi: arg('--nomi'), evidence: arg('--evidence'), out: arg('--out') });
    else if (argv[0] === 'apply' && argv.includes('--confirm')) await apply(arg('--from'));
    else console.error('usage: geocode | nominatim | decide | apply --from <file> --confirm | selftest');
    process.exit(0);
  })().catch(err => { console.error(err); process.exit(1); });
}
