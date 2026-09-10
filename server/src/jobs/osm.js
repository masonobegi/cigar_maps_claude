/**
 * OpenStreetMap helpers shared by the fetcher and the importer.
 * No database access here — pure functions plus one Overpass HTTP call.
 */
'use strict';

const https = require('https');

const OVERPASS_HOSTS = ['overpass-api.de', 'overpass.kumi.systems', 'lz4.overpass-api.de', 'overpass.private.coffee'];
const USER_AGENT = 'CigarBuddy/1.0 (store directory import; mason.obegi@gmail.com)';

const US_STATES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
  CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky',
  LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire',
  NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota',
  OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
  WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', PR: 'Puerto Rico',
};

const STATE_BY_NAME = Object.fromEntries(Object.entries(US_STATES).map(([k, v]) => [v.toLowerCase(), k]));

// ── Overpass ────────────────────────────────────────────────────────────────

function overpassPost(query, hostIndex = 0) {
  const host = OVERPASS_HOSTS[hostIndex % OVERPASS_HOSTS.length];
  return new Promise((resolve, reject) => {
    const postData = 'data=' + encodeURIComponent(query);
    const req = https.request({
      hostname: host,
      path: '/api/interpreter',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
        'User-Agent': USER_AGENT,
      },
      timeout: 240000,
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} from ${host}`));
        try { resolve(JSON.parse(d)); } catch { reject(new Error(`Bad JSON from ${host}`)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout from ${host}`)); });
    req.write(postData);
    req.end();
  });
}

/**
 * Bounding-box queries are dramatically faster on the public Overpass servers
 * than area lookups, and case-sensitive name regexes are ~50x faster than
 * case-insensitive ones (Delaware: 4 s vs a 250 s timeout). `nwr` covers
 * nodes, ways, and relations; `out center` gives one coordinate per object.
 * Bboxes overlap neighbouring states, so callers assign the state afterwards.
 */
function buildBboxQuery({ minLat, minLng, maxLat, maxLng }, timeout = 180) {
  const b = `(${minLat.toFixed(3)},${minLng.toFixed(3)},${maxLat.toFixed(3)},${maxLng.toFixed(3)})`;
  return `
[out:json][timeout:${timeout}];
(
  nwr["shop"="tobacco"]${b};
  nwr["shop"="cigar"]${b};
  nwr["club"="cigar"]${b};
  nwr["shop"]["name"~"[Cc]igar|CIGAR|[Tt]obacconist|[Hh]umidor|[Ss]togie"]${b};
  nwr["amenity"~"^(bar|pub|cafe|nightclub|restaurant|lounge)$"]["name"~"[Cc]igar|CIGAR"]${b};
);
out center tags;
`.trim();
}

/**
 * Fetch one bbox with polite retry: 429 (too many requests) waits a minute,
 * 504 / timeouts rotate to the next mirror.
 */
async function fetchBbox(bbox, { retries = 5, log = s => process.stdout.write(s) } = {}) {
  let lastErr, host = 0;
  for (let attempt = 0; attempt < retries; attempt++) {
    const t0 = Date.now();
    try {
      const data = await overpassPost(buildBboxQuery(bbox), host);
      const secs = Math.round((Date.now() - t0) / 1000);
      if (data.remark && /timed out|error/i.test(data.remark)) throw new Error(`Overpass remark: ${data.remark}`);
      log(`[${secs}s] `);
      return (data.elements || []);
    } catch (err) {
      lastErr = err;
      const secs = Math.round((Date.now() - t0) / 1000);
      log(`(attempt ${attempt + 1} failed after ${secs}s: ${err.message}) `);
      if (/HTTP 429/.test(err.message)) await sleep(75000);
      else { host++; await sleep(10000 * (attempt + 1)); }
    }
  }
  throw lastErr;
}

// ── Normalization ───────────────────────────────────────────────────────────

const CIGAR_RE   = /\b(cigars?|cigar\s*(bar|lounge|shop|club|house|room|emporium)|humidor|tobacconist|stogies?|habanos?|puros?)\b/i;
const BRAND_RE   = /\b(tinder\s*box|davidoff|casa\s*de\s*montecristo|montecristo|holt'?s|nat\s*sherman|iwan\s*ries|rocky\s*patel|padr[oó]n|fuente|cohiba|romeo\s*y\s*julieta|cigars?\s*international|jr\s*cigar|corona\s*cigar|smoke\s*inn|cuban\s*crafters|burn\s*by)\b/i;
const LOUNGE_RE  = /\b(lounge|cigar\s*bar|club|speakeasy|parlor|parlour|social)\b/i;
const TOBACCO_RE = /\b(tobacco|tobacconist|pipe|pipes|snuff)\b/i;
const SMOKE_RE   = /\b(smoke\s*\w+|smokes|smoker'?s?\s*(choice|friendly|haven|paradise|outlet|world))\b/i;
const NEG_STRONG = /\b(vape|vapor|vapors|vaping|e-?cigs?|e-?liquid|hookah|shisha|kratom|cbd|hemp|dispensary|cannabis|marijuana|glass|head\s*shop|420|gas|fuel|liquor|convenience|grocery|deli|lottery|wireless|cellular|cigarettes?|news\s*stand|newsstand|7-?eleven|circle\s*k|wawa|sheetz|speedway|exxon|chevron|sunoco|citgo|shell)\b/i;
const NEG_MILD   = /\b(discount|outlet|superstore|mart|market|express|quick|stop|land|city|world|zone|plus|dollar|beer|wine)\b/i;

function classify(name, tags, website) {
  const n = name || '';
  let score = 0;

  if (tags.shop === 'cigar' || tags.club === 'cigar') score += 0.8;
  else if (tags.shop === 'tobacco') score += 0.45;
  else if (tags.amenity) score += 0.2;
  else score += 0.1;

  const cigarName = CIGAR_RE.test(n) || BRAND_RE.test(n);
  if (cigarName) score += 0.45;
  if (LOUNGE_RE.test(n) && cigarName) score += 0.05;
  if (TOBACCO_RE.test(n)) score += 0.1;
  if (website && /cigar|humidor|tobacconist|stogie|habano|lounge/i.test(website)) score += 0.25;
  if (SMOKE_RE.test(n)) score -= 0.15;
  if (NEG_MILD.test(n)) score -= 0.2;
  if (NEG_STRONG.test(n)) score -= 0.45;
  if (tags.shop === 'e-cigarette' || tags.shop === 'cannabis' || tags.shop === 'convenience') score -= 0.6;
  if ((tags.brand || '').match(/smoker friendly|wild bill|tobacco superstore|cigarette|discount/i)) score -= 0.25;

  score = Math.max(0, Math.min(1, score));

  let type = 'tobacco_shop';
  if ((LOUNGE_RE.test(n) && cigarName) || tags.amenity === 'bar' || tags.amenity === 'lounge' || tags.club === 'cigar') type = 'cigar_lounge';
  else if (cigarName || tags.shop === 'cigar') type = 'cigar_shop';
  else if (SMOKE_RE.test(n)) type = 'smoke_shop';
  else if (tags.shop === 'tobacco') type = 'tobacco_shop';

  return { confidence: Math.round(score * 100) / 100, store_type: type };
}

function normalizePhone(raw) {
  if (!raw) return null;
  const first = String(raw).split(';')[0].replace(/^tel:/i, '').trim();
  const digits = first.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return fmtUS(digits.slice(1));
  if (digits.length === 10) return fmtUS(digits);
  return first || null;
}
function fmtUS(d) { return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`; }

function normalizeWebsite(raw) {
  if (!raw) return null;
  let w = String(raw).split(';')[0].trim();
  if (!w) return null;
  w = w.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '');
  if (!/^[a-z0-9.-]+\.[a-z]{2,}/i.test(w)) return null;
  return w.length > 200 ? null : w;
}

function normalizeState(raw, fallback) {
  if (!raw) return fallback;
  const s = String(raw).trim();
  if (/^[A-Za-z]{2}$/.test(s) && US_STATES[s.toUpperCase()]) return s.toUpperCase();
  const byName = STATE_BY_NAME[s.toLowerCase()];
  return byName || fallback;
}

function titleCase(s) {
  if (!s) return s;
  return s.replace(/\w\S*/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase());
}

/**
 * Convert an OSM opening_hours string into the app's {Mon: '10am-8pm'} format.
 * Handles the common simple grammar. Returns null when the string is too
 * exotic to trust; the raw string is kept separately.
 */
const DAY_KEYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const DAY_OUT  = { Mo: 'Mon', Tu: 'Tue', We: 'Wed', Th: 'Thu', Fr: 'Fri', Sa: 'Sat', Su: 'Sun' };

function convertOpeningHours(raw) {
  if (!raw) return null;
  const s = raw.trim();
  if (/^24\s*\/\s*7$/.test(s)) {
    return Object.fromEntries(Object.values(DAY_OUT).map(d => [d, '12am-11:59pm']));
  }
  const out = {};
  // Rules are separated by ";" but mappers very often use a comma instead
  // ("Mo-Th 11:00-23:00, Fr-Sa 11:00-01:00"). Split on a comma only when a day
  // name follows it, so comma-separated time ranges stay in one rule.
  const rules = s.split(/\s*;\s*|\s*,\s*(?=(?:Mo|Tu|We|Th|Fr|Sa|Su|PH|SH)\b)/);
  for (const rule of rules) {
    if (!rule || /^PH|^SH/i.test(rule)) continue;
    const m = rule.match(/^([A-Za-z,\- ]*?)\s*(off|closed|[\d:,\- ]+)$/i);
    if (!m) return null;
    const dayPart = m[1].trim();
    const timePart = m[2].trim();
    const days = expandDays(dayPart);
    if (!days) return null;
    let value;
    if (/^(off|closed)$/i.test(timePart)) value = 'Closed';
    else {
      const ranges = timePart.split(/\s*,\s*/).map(convertRange);
      if (ranges.some(r => !r)) return null;
      value = ranges.join(', ');
    }
    for (const d of days) out[DAY_OUT[d]] = value;
  }
  if (!Object.keys(out).length) return null;
  for (const d of Object.values(DAY_OUT)) if (!(d in out)) out[d] = 'Closed';
  return out;
}

function expandDays(part) {
  if (!part) return DAY_KEYS.slice();
  const days = new Set();
  for (const chunk of part.split(/\s*,\s*/)) {
    const r = chunk.match(/^([A-Z][a-z])(?:\s*-\s*([A-Z][a-z]))?$/);
    if (!r) return null;
    const a = DAY_KEYS.indexOf(r[1]);
    const b = r[2] ? DAY_KEYS.indexOf(r[2]) : a;
    if (a < 0 || b < 0) return null;
    if (b >= a) for (let i = a; i <= b; i++) days.add(DAY_KEYS[i]);
    else { for (let i = a; i < 7; i++) days.add(DAY_KEYS[i]); for (let i = 0; i <= b; i++) days.add(DAY_KEYS[i]); }
  }
  return [...days];
}

function convertRange(r) {
  const m = r.match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\+?$/);
  if (!m) return null;
  const openH = +m[1], openM = +m[2];
  let closeH = +m[3], closeM = +m[4];
  // "24:00" means the end of the day. Folding it to 12am would read as a close
  // time before the open time, which every is-open check treats as closed.
  if (closeH === 24 && closeM === 0) return `${to12(openH, openM)}-11:59pm`;
  return `${to12(openH, openM)}-${to12(closeH, closeM)}`;
}
function to12(h, min) {
  if (h >= 24) h -= 24;
  const ap = h >= 12 ? 'pm' : 'am';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return min ? `${hh}:${String(min).padStart(2, '0')}${ap}` : `${hh}${ap}`;
}

function normalizeElement(el, stateCode) {
  const t = el.tags || {};
  const name = (t.name || t['name:en'] || t.brand || '').trim();
  if (!name || name.length < 3) return null;
  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;

  const website = normalizeWebsite(t.website || t['contact:website'] || t.url);
  const { confidence, store_type } = classify(name, t, website);
  const hours = convertOpeningHours(t.opening_hours);
  const tagsOut = [];
  if (store_type === 'cigar_lounge' || /lounge/i.test(name) || t.lounge === 'yes') tagsOut.push('Lounge');
  if (t.humidor === 'yes' || /humidor/i.test(name)) tagsOut.push('Walk-in Humidor');
  if (/pipe/i.test(name)) tagsOut.push('Pipes');

  return {
    source: 'osm',
    source_id: `${el.type[0]}${el.id}`,
    name,
    address: [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ') || null,
    city: t['addr:city'] ? titleCase(t['addr:city']) : null,
    state: normalizeState(t['addr:state'], stateCode),
    zip: (t['addr:postcode'] || '').split(/[-\s;]/)[0] || null,
    phone: normalizePhone(t.phone || t['contact:phone']),
    website,
    instagram: (t['contact:instagram'] || '').replace(/^.*instagram\.com\//i, '').replace(/\/$/, '') || null,
    lat: Math.round(lat * 1e6) / 1e6,
    lng: Math.round(lng * 1e6) / 1e6,
    hours,
    hours_raw: t.opening_hours || null,
    store_type,
    confidence,
    has_lounge: tagsOut.includes('Lounge') ? 1 : 0,
    has_walk_in_humidor: tagsOut.includes('Walk-in Humidor') ? 1 : 0,
    tags: tagsOut,
    osm_tags: { shop: t.shop, amenity: t.amenity, brand: t.brand, club: t.club },
  };
}

// ── Dedup ───────────────────────────────────────────────────────────────────

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000, toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function nameKey(name) {
  return (name || '').toLowerCase()
    .replace(/&/g, 'and')
    .replace(/\b(the|inc|llc|co|company|shop|store|of)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Words that say what the business sells, not which business it is. Two shops
// on the same block can both be "Tobacco Outlet" and "Tobacco Barn".
const GENERIC_TOKENS = new Set(['cigar', 'cigars', 'cigarette', 'cigarettes', 'tobacco', 'tobacconist', 'smoke',
  'smokes', 'smoking', 'shop', 'store', 'outlet', 'house', 'lounge', 'bar', 'club', 'city', 'land', 'plus',
  'discount', 'express', 'mart', 'market', 'center', 'centre', 'depot', 'world', 'zone', 'stop', 'place', 'humidor']);

function namesMatch(a, b) {
  const ka = nameKey(a), kb = nameKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  const wa = new Set(ka.split(' ')), wb = new Set(kb.split(' '));
  const shared = [...wa].filter(w => wb.has(w) && w.length > 2);
  const distinctive = shared.filter(w => !GENERIC_TOKENS.has(w));
  // Two shared words is a match. One shared word only counts when it actually
  // names the business ("Padron" yes, "Tobacco" no) and everything the two
  // names do not share is just trade vocabulary ("Padron Cigars" / "Padron
  // Cigar Shop"), never a second business name.
  if (shared.length >= 2) return true;
  if (!distinctive.length) return false;
  const restGeneric = set => [...set].every(w => w.length <= 2 || wa.has(w) && wb.has(w) || GENERIC_TOKENS.has(w));
  return restGeneric(wa) && restGeneric(wb);
}

/** Collapse duplicates (node + building way, or two mappers) within ~120 m. */
function dedupe(records) {
  const kept = [];
  const sorted = [...records].sort((a, b) => tagRichness(b) - tagRichness(a));
  for (const r of sorted) {
    const dup = kept.find(k =>
      Math.abs(k.lat - r.lat) < 0.01 && Math.abs(k.lng - r.lng) < 0.01 &&
      haversineMeters(k.lat, k.lng, r.lat, r.lng) < 120 && namesMatch(k.name, r.name));
    if (dup) {
      for (const f of ['address', 'city', 'zip', 'phone', 'website', 'hours', 'hours_raw']) if (!dup[f] && r[f]) dup[f] = r[f];
      dup.confidence = Math.max(dup.confidence, r.confidence);
      continue;
    }
    kept.push(r);
  }
  return kept;
}

function tagRichness(r) {
  return ['address', 'city', 'zip', 'phone', 'website', 'hours'].filter(f => r[f]).length;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = {
  US_STATES, fetchBbox, buildBboxQuery, normalizeElement, classify, convertOpeningHours,
  normalizePhone, normalizeWebsite, dedupe, haversineMeters, namesMatch, nameKey, sleep,
};
