/**
 * OpenStreetMap helpers shared by the fetcher and the importer.
 * No database access here — pure functions plus one Overpass HTTP call.
 */
'use strict';

const { parseOpeningHoursString } = require('../utils/hoursParser');

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
  // A vape, glass, hookah or kava shop is another trade, however many cigars it
  // keeps by the till: this directory is for cigar and pipe shops. When that
  // trade leads the name, no category or website rescues it.
  const otherTrade = n.search(/\b(vape|vapes|vapor|e-?cigs?|e-?liquid|hookah|shisha|kava|kratom|cbd|delta[- ]?8|dispensary|weed|420|710|dab|bong|glass|head\s?shop|hydro)\b/i);
  const cigarWord = n.search(/\b(cigars?|tobacconist|humidor|stogies?|habanos?|pipe\s+tobacco)\b/i);
  if (otherTrade >= 0 && (cigarWord < 0 || otherTrade < cigarWord)) return { confidence: 0, store_type: 'smoke_shop' };
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
  // The shared parser reads the grammar mappers actually write (commas for
  // semicolons, "24:00", "Mo-We,Sa", typos like "10:00-07:00") where the old
  // code below gave up on 24 real shops. The old path stays as a fallback.
  // A day the mapper left out is a day nobody recorded, not a day the shop
  // shuts: Merced showed "Sunday Closed" while the shop opens 9 to 7. The
  // spec reads an unlisted day as closed, and mappers do not write to spec.
  const parsed = parseOpeningHoursString(raw);
  if (parsed && Object.values(parsed).some(v => v !== 'Closed')) return parsed;
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

/**
 * The comparable form of a shop's name.
 *
 * Two rows are the same shop far more often than their names are the same
 * string. The measured misses this handles, each one a real pair in the
 * directory standing as two pins on one door:
 *
 *   Cole's Tobacco / Coles Tobacco   an apostrophe used to split "cole" from
 *                                    a stray "s", so the two never matched
 *   E & E Cigars / E&E Cigars        "&" became the word "and" in one and part
 *                                    of a token in the other
 *   Smoke Stack / Smokestack         a space nobody agrees about
 *   Stogies / Stogie's               a plural
 *   JR Cigars - Clayton / JR Cigars  the only distinguishing token is two
 *                                    letters long, and short tokens were
 *                                    thrown away
 *
 * @param {string} name
 * @param {object} [opts]
 * @param {string} [opts.town] - The town this record sits in. Dropped from the
 *   name, because a town name is the one word two unrelated shops on the same
 *   street are most likely to share: "Bellevue Cigar" at 565 Lincoln Ave and
 *   "Tobacco Bellevue" at 553 are 42 m apart and are two different businesses
 *   with two different phone numbers. Without this they merge.
 */
function nameKey(name, { town } = {}) {
  let out = String(name || '')
    // Accents folded, so a name typed with them matches one typed without.
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    // Apostrophes of every shape vanish rather than becoming a break: this is
    // the difference between "coles" and "cole s".
    .replace(/['\u2019\u2018\u02bb\u02bc\u0060\u00b4]/g, '')
    // "&" goes entirely. Joining the initials it sat between is done below,
    // once the name is in tokens.
    .replace(/&/g, ' ')
    .replace(/\b(the|inc|llc|ltd|co|company|corp|shop|store|of)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

  let words = out.split(' ').filter(Boolean);

  // A run of single letters is one initialism: "e e" is "ee", which is what
  // "E&E" and "E & E" both have to come to.
  const joined = [];
  for (const w of words) {
    if (w.length === 1 && joined.length && joined[joined.length - 1].isInitial) {
      joined[joined.length - 1].text += w;
    } else {
      joined.push({ text: w, isInitial: w.length === 1 });
    }
  }
  words = joined.map(j => j.text);

  // A plural is not a different shop. Only "-s", and only on a word long
  // enough that dropping a letter still leaves a word: "gas" must not become
  // "ga", and "cigars" and "cigar" must come to the same thing.
  words = words.map(w => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w));

  if (town) {
    const townWords = new Set(nameKey(town).split(' ').filter(Boolean));
    // Only when something is left. A shop actually called "Bellevue" in
    // Bellevue would otherwise lose its whole name.
    const kept = words.filter(w => !townWords.has(w));
    if (kept.length) words = kept;
  }

  return words.join(' ');
}

/**
 * A two-letter token that is really an initialism, not a small word.
 *
 * "JR Cigars" and "JR Cigars - Clayton" are one shop and "JR" is the only
 * thing naming it, so short tokens cannot simply be discarded. But treating
 * every two-letter token as distinctive merges "Mr Tobacco" with "Mr Cigars",
 * which are two shops. The signal is the capitals in the name we were given:
 * an initialism is written JR, DL, EZ, 3D, while a small word is written Mr,
 * St, El, La. A name that is entirely in capitals carries no such signal, so
 * for those the question is left unanswered.
 */
function looksLikeInitials(original, token) {
  const name = String(original || '');
  if (/\d/.test(token)) return true;
  if (name === name.toUpperCase()) return false;
  // Compared against the name with its separators removed, because the token
  // may have been assembled from letters that were apart: "jj" comes from
  // "J&J", and "ee" from "E & E". Looking for "JJ" in "J&J Cigar Co." finds
  // nothing, while looking for it in "JJCigarCo" finds it.
  const letters = name.replace(/[^A-Za-z]/g, '');
  return letters.includes(token.toUpperCase());
}

// Words that say what the business sells, not which business it is. Two shops
// on the same block can both be "Tobacco Outlet" and "Tobacco Barn".
const GENERIC_TOKENS = new Set(['cigar', 'cigars', 'cigarette', 'cigarettes', 'tobacco', 'tobacconist', 'smoke',
  'smokes', 'smoking', 'shop', 'store', 'outlet', 'house', 'lounge', 'bar', 'club', 'city', 'land', 'plus',
  'discount', 'express', 'mart', 'market', 'center', 'centre', 'depot', 'world', 'zone', 'stop', 'place', 'humidor']);

function namesMatch(a, b, { town } = {}) {
  const ka = nameKey(a, { town }), kb = nameKey(b, { town });
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  // The same words with the spaces in different places: "Smoke Stack" and
  // "Smokestack", "Cigar Box" and "Cigarbox".
  if (ka.replace(/ /g, '') === kb.replace(/ /g, '')) return true;

  const wa = new Set(ka.split(' ')), wb = new Set(kb.split(' '));
  // A token counts if it is long enough to mean something, or is an
  // initialism, which is often the only thing naming the shop.
  const counts = w => w.length > 2 || looksLikeInitials(a, w) || looksLikeInitials(b, w);
  const shared = [...wa].filter(w => wb.has(w) && counts(w));
  const distinctive = shared.filter(w => !GENERIC_TOKENS.has(w));

  // Nothing matches on trade vocabulary alone. Two shared words used to be
  // enough on their own, which is how "Cigar City Brewing" matched "Cigar City
  // Cigars": both words are generic, and a brewery was merged into the cigar
  // directory. At least one of the shared words has to actually name the
  // business.
  if (!distinctive.length) return false;

  // Two shared words, one of which names the business: "Carmel Cigar Vault"
  // and "The Carmel Cigar Vault", "Tobacco Junction" and "Tobacco Junction Of
  // Marshall".
  if (shared.length >= 2) return true;

  // One name is the other with words added, and they share a word that names
  // the business: "The Tobacconist" inside "The Tobacconist of Greenwich",
  // "The Pipe" inside "The Pipe Rack", "Holt's" inside "Holt's Cigar Company".
  //
  // Safe only because of where this function is called from. Every caller has
  // already established that the two rows stand at the same door — within
  // 120 m in the directory build, 150 m in the importer, the same street
  // number in dedupeListings. Two branches of one chain would match this rule
  // on their names, and never reach it, because they are in different towns.
  const subset = [...wa].every(w => wb.has(w)) || [...wb].every(w => wa.has(w));
  if (subset) return true;

  // Otherwise: one shared business-naming word, and everything the two names
  // do not share is trade vocabulary ("Padron Cigars" / "Padron Cigar Shop"),
  // never a second business name.
  const restGeneric = set => [...set].every(w => !counts(w) || (wa.has(w) && wb.has(w)) || GENERIC_TOKENS.has(w));
  return restGeneric(wa) && restGeneric(wb);
}

/** Collapse duplicates (node + building way, or two mappers) within ~120 m. */
function dedupe(records) {
  const kept = [];
  const sorted = [...records].sort((a, b) => tagRichness(b) - tagRichness(a));
  for (const r of sorted) {
    const dup = kept.find(k =>
      Math.abs(k.lat - r.lat) < 0.01 && Math.abs(k.lng - r.lng) < 0.01 &&
      haversineMeters(k.lat, k.lng, r.lat, r.lng) < 120
      && namesMatch(k.name, r.name, { town: r.city || k.city }));
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

// ── Self-test ───────────────────────────────────────────────────────────────

/**
 * The name matcher, against the pairs the duplicates audit measured.
 *
 * This function decides whether two rows are one shop, in three places: the
 * directory build's dedupe(), the importer's twin matching, and
 * dedupeListings. Getting it wrong in either direction is expensive — too
 * loose merges two businesses into one listing and hides a real shop, too
 * tight leaves two pins on one door disagreeing with each other about the
 * hours. So both directions are checked, and the negatives are as important
 * as the positives.
 */
function selfTest() {
  let pass = 0, fail = 0;
  const ok = (cond, msg, got) => {
    if (cond) { pass++; console.log('  ok   ' + msg); }
    else { fail++; console.log('  FAIL ' + msg + (got !== undefined ? '  -> ' + JSON.stringify(got) : '')); }
  };
  const same = (a, b, msg, opts) => ok(namesMatch(a, b, opts), msg, [nameKey(a, opts), nameKey(b, opts)]);
  const diff = (a, b, msg, opts) => ok(!namesMatch(a, b, opts), msg, [nameKey(a, opts), nameKey(b, opts)]);

  // ── nameKey, on its own ──────────────────────────────────────────────────
  ok(nameKey("Cole's Tobacco") === 'cole tobacco', 'an apostrophe closes up rather than splitting the word', nameKey("Cole's Tobacco"));
  ok(nameKey('Coles Tobacco') === nameKey("Cole's Tobacco"), 'so the two spellings agree');
  ok(nameKey('E & E Cigars') === nameKey('E&E Cigars'), 'initials either side of an ampersand join up', [nameKey('E & E Cigars'), nameKey('E&E Cigars')]);
  ok(nameKey('J & J Cigars') === 'jj cigar', 'and come to one token', nameKey('J & J Cigars'));
  ok(nameKey('Stogies') === nameKey("Stogie's"), 'a plural and a possessive are the same shop');
  ok(nameKey('Cigars') === nameKey('Cigar'), 'and so is a plural on its own');
  ok(nameKey('Gas Depot') === 'gas depot', 'a three-letter word ending in s is not a plural', nameKey('Gas Depot'));
  ok(nameKey('Class Act') === 'class act', 'nor is a double s', nameKey('Class Act'));
  ok(nameKey('The Tobacconist of Greenwich, LLC') === 'tobacconist greenwich',
    'legal and filler words are dropped', nameKey('The Tobacconist of Greenwich, LLC'));
  ok(nameKey('Vel\u00e1zquez Cigars') === nameKey('Velazquez Cigars'), 'accents fold');
  ok(nameKey('Bellevue Cigar', { town: 'Bellevue' }) === 'cigar',
    'the town name is dropped', nameKey('Bellevue Cigar', { town: 'Bellevue' }));
  ok(nameKey('Bellevue', { town: 'Bellevue' }) === 'bellevue',
    'unless it is the whole name, which would leave nothing to compare');
  ok(nameKey('') === '' && nameKey(null) === '' && nameKey(undefined) === '', 'an absent name is empty, not a crash');

  // ── looksLikeInitials ────────────────────────────────────────────────────
  ok(looksLikeInitials('JR Cigars', 'jr'), 'JR in a mixed-case name is an initialism');
  ok(looksLikeInitials('3D Smoke Shop', '3d'), 'so is anything with a digit');
  ok(!looksLikeInitials('Mr Tobacco', 'mr'), 'Mr is a small word, not an initialism');
  ok(!looksLikeInitials('St James Cigars', 'st'), 'and so is St');
  ok(!looksLikeInitials('JR CIGARS', 'jr'),
    'a name entirely in capitals carries no signal either way, so it claims none');
  ok(looksLikeInitials('J&J Cigar Co.', 'jj'), 'initials read across the separator that was between them');
  ok(looksLikeInitials('E & E Cigars', 'ee'), 'and across spaces too');
  ok(!looksLikeInitials('Ye Ole Tobacco Shop', 'ye'), 'a capitalised small word is still a small word');
  ok(!looksLikeInitials('La Casa del Habano', 'la'), 'and so is an article');

  // ── The pairs the audit measured as one shop ─────────────────────────────
  same("Cole's Tobacco", 'Coles Tobacco', "#20760/#42064 Cole's Tobacco");
  same('E & E Cigars', 'E&E Cigars', '#4314/#40001 E & E Cigars');
  same('JR Cigars - Clayton', 'JR Cigars', '#12541/#41319 JR Cigars');
  same('The Tobacconist of Greenwich', 'The Tobacconist', '#22099/#40490 The Tobacconist',
    { town: 'Greenwich' });
  // Not without the town. "The Tobacconist" inside "The Tobacconist of
  // Greenwich" is the same shape as "Tobacco" inside "Tobacco Town", which is
  // two shops, and the only shared word in both cases is trade vocabulary.
  // The audit did not settle this pair on its names either — it dropped the
  // town, and then confirmed the pair by its shared phone and website. So the
  // matcher says it cannot tell, which is the true answer.
  diff('The Tobacconist of Greenwich', 'The Tobacconist',
    'but not when nothing says Greenwich is the town: the names alone cannot tell');
  same('Stogies', "Stogie's", '#13015/#41331 Stogies');
  same('Smoke Stack', 'Smokestack', 'a space nobody agrees about');
  same('The Pipe Rack', 'The Pipe', '#19175/#41895 The Pipe Rack');
  same('Carmel Cigar Vault', 'The Carmel Cigar Vault', '#22080/#22082 Carmel Cigar Vault');
  same('Tobacco Junction Of Marshall', 'Tobacco Junction', '#2979/#7224 Tobacco Junction');
  same("Roz's Cigar Emporium", 'Roz Cigar Emporium', '#6081/#6082 Roz\u2019s Cigar Emporium');
  same("Wild Bill's Tobacco", 'Wild Bills Tobacco', 'Wild Bill\u2019s, with and without the apostrophe');
  same('Padron Cigars', 'Padron Cigar Shop', 'a trade word added to a shop name');
  same('J & J Cigars', 'J&J Cigar Co.', 'initials, an ampersand and a legal suffix at once');

  // ── And the pairs that must stay apart ───────────────────────────────────
  diff('Tobacco Town', 'Tobacco Row', 'two shops that share only a trade word');
  diff('Taylor Tobacco', 'River Tobacco', 'and two more');
  diff('Bellevue Cigar', 'Tobacco Bellevue', 'a shared town name is not a shared shop name',
    { town: 'Bellevue' });
  diff("Holt's", 'Ashton', 'a shop and a brand it stocks');
  diff('Mr Tobacco', 'Mr Cigars', 'two small words that happen to match');
  diff('Cigar City Brewing', 'Cigar City Cigars', 'a brewery and a cigar shop');
  diff('Smoke Shop', 'Tobacco Outlet', 'two names made entirely of trade words');
  diff('El Rey Cigars', 'El Toro Cigars', 'a shared article is not a shared name');
  diff('Tobacco Outlet', 'Tobacco Barn', 'the pair named in the code comment above');
  diff('Cigar City Cigars', 'Cigar City Brewing', 'and the other way round, since order must not matter');
  diff('Smoke Shop', 'Smoke Shop Plus', 'a subset made only of trade words still decides nothing');
  diff('Tobacco', 'Tobacco Town', 'nor does a generic word inside a longer name');
  diff('', 'Anything', 'an empty name matches nothing');

  console.log(`\nosm self-test: ${pass} passed, ${fail} failed`);
  return fail > 0;
}

if (require.main === module && process.argv[2] === 'selftest') {
  process.exit(selfTest() ? 1 : 0);
}

module.exports = {
  US_STATES, fetchBbox, buildBboxQuery, normalizeElement, classify, convertOpeningHours,
  normalizePhone, normalizeWebsite, dedupe, haversineMeters, namesMatch, nameKey,
  looksLikeInitials, GENERIC_TOKENS, selfTest, sleep,
};
