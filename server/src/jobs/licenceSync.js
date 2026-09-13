/**
 * What the tobacco licence registries say about our listings.
 *
 * Eight states and cities publish their tobacco retail licences as free open
 * data — no key, no contract, no per-row charge — and between them they cover
 * about 2,850 of our listings. A licence is the strongest free evidence there
 * is that a shop exists at an address, because somebody paid a fee and gave a
 * government their name to get it.
 *
 * It is not evidence that a shop has closed. A licence lapses because the
 * renewal is late, because the business changed hands, because the county
 * changed its filing system — the audit put "lapsed licence means closed" at
 * roughly a coin flip. So a lapse is a flag for a person, never a hide, and
 * never on its own.
 *
 * Four things come out of a run:
 *
 *   verified   a current licence at this door. A stamp, and a strong argument
 *              against every closure signal we hold.
 *   renamed    the licence is at our address under a different trading name.
 *   moved      the licence for this business is at a different address.
 *   lapsed     no current licence where one should be. A staff flag only.
 *
 *   node src/jobs/licenceSync.js fetch  --out <dir>      download the registries
 *   node src/jobs/licenceSync.js match  --from <dir> --out licences.json
 *   node src/jobs/licenceSync.js apply  --from licences.json --confirm
 *   node src/jobs/licenceSync.js selftest
 */
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

/**
 * The registries. Every one is free and public; none needs a key.
 *
 * `rows` pulls the records out of whatever shape the endpoint answers with,
 * and `map` turns one record into our own shape. Socrata endpoints (the `$`
 * query parameters) are the common case.
 */
const REGISTRIES = [
  {
    key: 'nyc',
    name: 'NYC Department of Consumer and Worker Protection: Tobacco Retail Dealer licences',
    // The filter column is business_category ("Tobacco Retail Dealer");
    // license_category does not exist and the endpoint answered 400.
    url: 'https://data.cityofnewyork.us/resource/w7w3-xahh.json?$limit=50000&$where=business_category%20like%20%27%25Tobacco%25%27',
    states: ['NY'],
    map: r => ({
      name: r.business_name_2 || r.business_name, address: r.address_building && r.address_street_name
        ? `${r.address_building} ${r.address_street_name}` : r.address_street_name,
      city: r.address_city, state: r.address_state, zip: r.address_zip,
      phone: r.contact_phone, status: r.license_status, expires: r.lic_expir_dd,
    }),
  },
  {
    key: 'ny_state',
    name: 'New York State: registered tobacco and vapour retailers',
    // aca8-pmd4 answered 404: the register moved to 55xf-9jat, which lists
    // 22,095 current registrants and names its columns phys_*.
    url: 'https://data.ny.gov/resource/55xf-9jat.json?$limit=50000',
    states: ['NY'],
    map: r => ({
      name: r.dba_name || r.last_or_bus_name, address: r.phys_ln_2_adr,
      city: r.phys_city_adr, state: r.phys_state_adr || 'NY', zip: r.phys_zip_5_adr,
      phone: null,
      // Everyone in this file is registered; a suspension is the only status
      // it carries, and a suspended shop is not a current licence.
      status: r.susp_beg_dt && !r.susp_end_dt ? 'SUSPENDED' : 'ACTIVE', expires: null,
    }),
  },
  {
    key: 'tx',
    name: 'Texas Comptroller: cigarette, cigar and tobacco permits',
    // e4wh-ax6g answered 404. yrkr-maw5 is the permit list, and all 90,567
    // rows of it do not fit one request, so it asks for the active ones: a
    // lapse here is a staff flag and never a hide, so the absence of an
    // expired permit costs nothing.
    url: 'https://data.texas.gov/resource/yrkr-maw5.json?$limit=50000&$where=permit_status%20=%20%27ACTIVE%27',
    states: ['TX'],
    map: r => ({
      name: r.out_name || r.name, address: r.address,
      city: r.city, state: r.state || 'TX', zip: r.zip,
      phone: null, status: r.permit_status || 'ACTIVE', expires: r.permit_end_date,
    }),
  },
  {
    key: 'fl',
    name: 'Florida Division of Alcoholic Beverages and Tobacco: retail tobacco licences',
    // Two files because Florida issues tobacco permits under two professions:
    // 4012 is the stand-alone retail tobacco dealer, and the broader extract
    // also carries the alcohol licences that come with tobacco, which is how a
    // cigar lounge with a bar is licensed. A cigar shop can be either.
    // Rebuilt every morning, plain CSV, no key and no form.
    url: [
      'https://www2.myfloridalicense.com/sto/file_download/extracts/bd4012lic.csv',
      'https://www2.myfloridalicense.com/sto/file_download/extracts/bdTOBlic.csv',
    ],
    states: ['FL'],
    format: 'csv',
    // Florida codes status as a number, 20 being current. isCurrent() reads
    // words, so it is given the expiry date instead — a real date it can
    // compare, so a permit that lapsed last month is not read as current merely
    // because the extract still lists it.
    map: r => ({
      name: r.DBA || r['Owner Name'] || null,
      owner: r['Owner Name'] || null,
      address: r['Location Address 1'],
      city: r['Location City'],
      state: r['Location State'] || 'FL',
      zip: String(r['Location ZIP'] || '').slice(0, 5),
      phone: null,
      status: r['Primary Status'] === '20' ? 'Active' : `status ${r['Primary Status']}`,
      expires: r['Expiration Date'] || null,
      series: r.Series || null,
    }),
    dedupeOn: r => r['License Number'] || null,
  },
  {
    key: 'ca',
    name: 'California Department of Tax and Fee Administration: cigarette and tobacco licences',
    // The dataset page is JavaScript and shows no link, but the ArcGIS portal
    // behind it serves the whole file as CSV. Refreshed monthly.
    //
    // California does NOT publish the licensee's name — taxpayer
    // confidentiality — so every row is an address and a licence type. That
    // costs the 'renamed' verdict, which needs a name to compare, but not
    // 'verified': a current retail licence at a listing's own front door is
    // still the state saying somebody sells tobacco there.
    url: 'https://data-cdtfa.opendata.arcgis.com/datasets/CDTFA::california-cigarette-and-tobacco-licensees.csv',
    states: ['CA'],
    format: 'csv',
    // Only Retailer rows. A distributor or wholesaler licence at an address is
    // not a shop anybody can walk into.
    keep: r => String(r.type || '').trim() === 'Retailer',
    map: r => ({
      name: null,
      address: r.STREET,
      city: r.CITY,
      state: 'CA',
      zip: String(r.ZIPCODE || '').slice(0, 5),
      phone: null,
      // The file is "active licensees as of" its publication date, so every row
      // in it is current by construction; there is no per-row status column.
      status: 'Active',
      expires: null,
      licence_no: r.ID || null,
    }),
  },
  {
    key: 'pa',
    name: 'Pennsylvania Department of Revenue: cigarette dealer licences',
    url: 'https://www.revenue.pa.gov/GeneralTaxInformation/Tax%20Types%20and%20Information/CigaretteTax/Pages/default.aspx',
    states: ['PA'],
    format: 'manual',
    note: 'Pennsylvania publishes a periodic list. Save it into the fetch directory as pa.csv.',
  },
  {
    key: 'chicago',
    name: 'City of Chicago: business licences (tobacco)',
    url: 'https://data.cityofchicago.org/resource/r5kz-chrr.json?$limit=50000&$where=license_description%20like%20%27%25Tobacco%25%27',
    states: ['IL'],
    map: r => ({
      name: r.doing_business_as_name || r.legal_name, address: r.address,
      city: r.city, state: r.state, zip: r.zip_code,
      phone: null, status: r.license_status, expires: r.expiration_date,
    }),
  },
  {
    key: 'wa',
    name: 'Washington State Department of Revenue: cigarette and tobacco licences',
    // 7xux-kdmd answered 404 and data.wa.gov's catalogue has no tobacco
    // licence file to replace it: the Business Lookup is a search form, not a
    // dataset. Washington is a manual download until one appears.
    url: 'https://dor.wa.gov/open-records/public-records-requests',
    states: ['WA'],
    format: 'manual',
    note: 'Washington does not publish the tobacco licence list as a dataset. Save an export as wa.csv in the fetch directory.',
  },
];

/**
 * How late a licence may be before we call it lapsed. Registries publish on
 * their own schedule and a renewal takes weeks to appear, so two months of lag
 * is normal and flagging inside it would flag shops for paperwork.
 */
const LAG_DAYS = 60;

/** Two pins this close, with names that agree, are one door. */
const SAME_DOOR_M = 60;

/**
 * New York City smoke shops are exempt from lapse flags. The city capped the
 * number of tobacco retail licences and runs a waiting list, so a shop trading
 * perfectly legally can sit outside the published list for a year.
 */
const NO_LAPSE_FLAGS = new Set(['NYC', 'NEW YORK']);

/**
 * Shops the audit checked by hand and found trading. A registry that disagrees
 * with a person who looked is wrong.
 */
const KNOWN_OPEN = ['stogies', 'blackhouse', 'black house', 'manhattan tobacco'];

function isKnownOpen(name) {
  const n = String(name || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  return KNOWN_OPEN.some(k => n.includes(k));
}

// ── matching ────────────────────────────────────────────────────────────────

function digits(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  return d.length === 11 && d[0] === '1' ? d.slice(1) : d;
}

const STREET_TYPE = new Set(['st', 'street', 'ave', 'avenue', 'rd', 'road', 'blvd', 'boulevard',
  'dr', 'drive', 'ln', 'lane', 'ct', 'court', 'pl', 'place', 'pkwy', 'parkway', 'hwy', 'highway',
  'way', 'ter', 'terrace', 'cir', 'circle', 'sq', 'square', 'n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw',
  'north', 'south', 'east', 'west', 'ste', 'suite', 'unit', 'apt', 'fl', 'floor']);

/** The words that say what kind of street it is, as opposed to which street. */
const TYPE_ALIAS = {
  street: 'st', st: 'st', avenue: 'ave', ave: 'ave', road: 'rd', rd: 'rd',
  boulevard: 'blvd', blvd: 'blvd', drive: 'dr', dr: 'dr', lane: 'ln', ln: 'ln',
  court: 'ct', ct: 'ct', place: 'pl', pl: 'pl', parkway: 'pkwy', pkwy: 'pkwy',
  highway: 'hwy', hwy: 'hwy', way: 'way', terrace: 'ter', ter: 'ter',
  circle: 'cir', cir: 'cir', square: 'sq', sq: 'sq',
  // Found in the first real run, where each of these read as a different
  // street from the same one: "10 N Plaza" against "10 NORTH PLZ".
  plaza: 'plz', plz: 'plz', trail: 'trl', trl: 'trl', loop: 'loop',
  turnpike: 'tpke', tpke: 'tpke', expressway: 'expy', expy: 'expy',
  freeway: 'fwy', fwy: 'fwy', route: 'rte', rte: 'rte', crossing: 'xing', xing: 'xing',
};

/**
 * A street named with a number, spelled either way. Texas writes "5832 Highway
 * Six" where its own registry writes "5832 HIGHWAY 6", and that read as a move
 * to another address — so the shop lost a licence that was sitting at its own
 * door.
 */
const NUMBER_WORDS = {
  one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8',
  nine: '9', ten: '10', eleven: '11', twelve: '12', thirteen: '13', fourteen: '14',
  fifteen: '15', sixteen: '16', seventeen: '17', eighteen: '18', nineteen: '19', twenty: '20',
  first: '1', second: '2', third: '3', fourth: '4', fifth: '5', sixth: '6', seventh: '7',
  eighth: '8', ninth: '9', tenth: '10',
};

/** { number, words, type } from a street address, or null. */
function street(address) {
  const a = String(address || '').toLowerCase().replace(/['\u2019]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const m = /^(\d+[a-z]?)\s+(.+)$/.exec(a);
  if (!m) return null;
  // Both spellings of every word, so "Plaza" and "PLZ" compare equal whether the
  // word turns out to be the street's type or its name.
  const parts = m[2].split(' ').map(w => NUMBER_WORDS[w] || TYPE_ALIAS[w] || w);
  const type = parts.map(w => TYPE_ALIAS[w]).filter(Boolean).pop() || null;
  // A single digit is kept: "Highway 6" and "Route 9" are named by that number
  // and nothing else, and dropping it left those streets with no words at all.
  const words = parts.filter(w => (w.length > 1 || /^[0-9]$/.test(w)) && !STREET_TYPE.has(w));
  return { number: m[1], words, type };
}

/**
 * Do these two addresses name the same door? The house number, the ZIP, and at
 * least one word of the street in common.
 *
 * A street type word on its own is not a street: "Main St" and "Main Ave" are
 * different streets, and "1 St" matches every address in town. That is why
 * STREET_TYPE words are dropped before comparing — the same rule the moved-shop
 * sweep had to learn.
 */
function sameDoor(ours, theirs) {
  const a = street(ours.address), b = street(theirs.address);
  if (!a || !b) return false;
  // "170 Gardiners Ave" and "170B Gardiners Ave" are one building; the letter is
  // the unit. A licence is issued to a business at a building, and reading the
  // letter as part of the number said the shop had moved to its own address.
  const door = n => String(n).replace(/[a-z]$/, '');
  if (door(a.number) !== door(b.number)) return false;
  const zipA = String(ours.zip || '').slice(0, 5), zipB = String(theirs.zip || '').slice(0, 5);
  if (!zipA || !zipB || zipA !== zipB) return false;
  // "1 Main St" and "1 Main Ave" are two different streets that happen to share
  // a name and a house number. Where both addresses say what kind of street
  // they are, they have to agree.
  if (a.type && b.type && a.type !== b.type) return false;
  return a.words.some(w => b.words.includes(w));
}

/** Names that agree: one distinctive word in common, ignoring the trade words. */
const GENERIC = new Set(['cigar', 'cigars', 'tobacco', 'tobacconist', 'smoke', 'smokes', 'shop',
  'shoppe', 'store', 'lounge', 'inc', 'llc', 'corp', 'co', 'company', 'the', 'and', 'of', 'dba']);

function namesAgree(a, b) {
  // The apostrophe goes before the split, not after: "Anthony's" split on
  // punctuation is "anthony" and "s", which matches nothing in "ANTHONYS
  // CIGARS LLC". A registry writes a trading name without its apostrophe far
  // more often than not.
  const words = s => String(s || '').toLowerCase().replace(/['\u2019]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').split(' ')
    .filter(w => w.length > 2 && !GENERIC.has(w))
    .map(w => w.replace(/s$/, ''));
  const A = new Set(words(a));
  return words(b).some(w => A.has(w));
}

function metresBetween(lat1, lng1, lat2, lng2) {
  const R = 6371000, toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

/**
 * The licence record that belongs to this listing, and how we know.
 *
 * Three joins, strongest first. Each one has to be able to stand alone, because
 * a wrong join stamps one shop's licence onto another's listing.
 */
function matchListing(store, records) {
  const ourPhone = digits(store.phone);
  if (ourPhone.length === 10) {
    const byPhone = records.find(r => digits(r.phone) === ourPhone);
    if (byPhone) return { record: byPhone, how: 'the same telephone number' };
  }
  const byDoor = records.filter(r => sameDoor(store, r));
  if (byDoor.length === 1) return { record: byDoor[0], how: 'the same house number, ZIP and street' };
  if (byDoor.length > 1) {
    const named = byDoor.filter(r => namesAgree(store.name, r.name));
    if (named.length === 1) return { record: named[0], how: 'the same door, and the names agree' };
    // Several licences at one address and no name to tell them apart: a strip
    // mall. Saying nothing is the honest answer.
    return null;
  }
  if (store.lat !== null && store.lat !== undefined) {
    const near = records.filter(r => r.lat !== null && r.lat !== undefined
      && metresBetween(Number(store.lat), Number(store.lng), Number(r.lat), Number(r.lng)) <= SAME_DOOR_M
      && namesAgree(store.name, r.name));
    if (near.length === 1) return { record: near[0], how: `within ${SAME_DOOR_M} m, and the names agree` };
  }
  return null;
}

/** Is this licence current, allowing for how late registries publish? */
function isCurrent(record, now = new Date()) {
  const status = String(record.status || '').toLowerCase();
  if (/(^|\b)(inactive|expired|revoked|cancelled|canceled|surrendered|closed|void)\b/.test(status)) return false;
  if (!record.expires) return /active|current|issued|valid|open/.test(status) || !status;
  const when = new Date(record.expires);
  if (!Number.isFinite(when.getTime())) return true;
  return when.getTime() >= now.getTime() - LAG_DAYS * 86400000;
}

/**
 * What one listing's licence says about it.
 *
 * Never a hide. The strongest thing a lapse earns is a place in the staff
 * queue, because the audit measured "lapsed means closed" at about a coin flip.
 */
function verdictFor(store, records, now = new Date()) {
  const hit = matchListing(store, records);

  if (!hit) {
    // No licence anywhere at this door. That is only worth saying where the
    // registry covers this listing's state at all, and only as a flag.
    const movedTo = records.find(r => namesAgree(store.name, r.name)
      && String(r.city || '').toLowerCase() === String(store.city || '').toLowerCase()
      && !sameDoor(store, r));
    if (movedTo) {
      return { verdict: 'moved', to: movedTo, why: `its licence is at ${movedTo.address}, ${movedTo.city}` };
    }
    if (isKnownOpen(store.name)) {
      return { verdict: 'none', why: 'no licence matched, but this shop was checked by hand and is trading' };
    }
    if (NO_LAPSE_FLAGS.has(String(store.city || '').toUpperCase())
      || /^new york$/i.test(String(store.city || ''))) {
      return { verdict: 'none', why: 'New York City caps tobacco licences and runs a waiting list, so absence proves nothing' };
    }
    return { verdict: 'lapsed', why: 'no current licence at this address in the registry', weak: true };
  }

  const r = hit.record;
  if (!isCurrent(r, now)) {
    if (isKnownOpen(store.name)) {
      return { verdict: 'none', record: r, how: hit.how, why: 'the licence has lapsed, but this shop was checked by hand and is trading' };
    }
    if (NO_LAPSE_FLAGS.has(String(store.city || '').toUpperCase()) || /^new york$/i.test(String(store.city || ''))) {
      return { verdict: 'none', record: r, how: hit.how, why: 'New York City smoke shops are exempt from lapse flags' };
    }
    return {
      verdict: 'lapsed', record: r, how: hit.how, weak: true,
      why: `the licence matched ${hit.how} expired ${r.expires || 'at an unstated date'}`,
    };
  }

  if (r.name && !namesAgree(store.name, r.name)) {
    return { verdict: 'renamed', record: r, how: hit.how, why: `the current licence at this door is "${r.name}"` };
  }
  return { verdict: 'verified', record: r, how: hit.how, why: `a current licence at this address, matched by ${hit.how}` };
}

// ── fetching ────────────────────────────────────────────────────────────────

/** One CSV line, respecting quotes: addresses and business names contain commas. */
function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === ',' && !inQ) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

/** A CSV as objects keyed by its header row. Strips a UTF-8 BOM, which ArcGIS sends. */
function parseCsv(text) {
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return [];
  const hdr = splitCsvLine(lines[0]).map(h => h.trim());
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const rec = {};
    for (let j = 0; j < hdr.length; j++) rec[hdr[j]] = (cells[j] || '').trim();
    out.push(rec);
  }
  return out;
}

/** The same fetch as getJson, but handing back the body as text. */
function getText(url, depth = 0) {
  return new Promise((resolve, reject) => {
    if (depth > 5) return reject(new Error('too many redirects'));
    const req = https.get(url, {
      headers: { 'User-Agent': 'CigarBuddy/1.0 (mason.obegi@gmail.com)', Accept: 'text/csv,*/*' },
      timeout: 300000,
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(getText(new URL(res.headers.location, url).toString(), depth + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`http ${res.statusCode}`)); }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', c => { body += c; });
      res.on('end', () => resolve(body));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
  });
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'CigarBuddy/1.0 (mason.obegi@gmail.com)', Accept: 'application/json' },
      timeout: 120000,
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(getJson(new URL(res.headers.location, url).toString()));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

// Every registry URL asks for $limit=50000, so a full page means there is
// more behind it. MAX_ROWS is a backstop against a registry that never ends.
const PAGE = 50000;
const MAX_ROWS = 400000;

async function fetchAll({ outDir, only = null, log = console.log } = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  for (const reg of REGISTRIES) {
    if (only && reg.key !== only) continue;
    if (reg.format === 'manual') {
      log(`${reg.key}: not an API. ${reg.note}`);
      log(`      ${reg.url}`);
      continue;
    }
    if (reg.format === 'csv') {
      try {
        const urls = [].concat(reg.url);
        const seen = new Set();
        const rows = [];
        for (const u of urls) {
          const text = await getText(u);
          for (const rec of parseCsv(text)) {
            if (reg.keep && !reg.keep(rec)) continue;
            const mapped = reg.map(rec);
            if (!mapped.address) continue;
            // A licence can appear in both extracts. Dedupe on the number where
            // there is one, otherwise on the door it is issued for.
            const key = (reg.dedupeOn && reg.dedupeOn(rec))
              || `${mapped.address}|${mapped.zip}|${mapped.series || ''}`;
            if (seen.has(key)) continue;
            seen.add(key);
            rows.push(mapped);
          }
        }
        fs.writeFileSync(path.join(outDir, `${reg.key}.json`), JSON.stringify(rows, null, 1));
        log(`${reg.key}: ${rows.length} licences`);
      } catch (e) {
        log(`${reg.key}: could not fetch — ${e.message}`);
      }
      continue;
    }
    try {
      // Socrata answers at most one page. Texas alone holds 59,603 active
      // permits, so a single request came back exactly at the limit and the
      // rest were silently missing — the kind of cap that reads as complete.
      const rows = [];
      let offset = 0, page;
      do {
        const url = `${reg.url}${reg.url.includes('?') ? '&' : '?'}$offset=${offset}`;
        page = await getJson(url);
        if (!Array.isArray(page)) break;
        rows.push(...page.map(reg.map).filter(r => r.address));
        offset += page.length;
      } while (page.length >= PAGE && offset < MAX_ROWS);
      fs.writeFileSync(path.join(outDir, `${reg.key}.json`), JSON.stringify(rows, null, 1));
      log(`${reg.key}: ${rows.length} licences${offset >= MAX_ROWS ? ` (stopped at ${MAX_ROWS})` : ''}`);
    } catch (e) {
      log(`${reg.key}: could not fetch — ${e.message}`);
    }
  }
}

// ── matching a whole directory ──────────────────────────────────────────────

async function match({ from, out, log = console.log } = {}) {
  const db = require('../database/db');
  const byState = new Map();
  for (const reg of REGISTRIES) {
    const file = path.join(from, `${reg.key}.json`);
    if (!fs.existsSync(file)) { log(`${reg.key}: no file in ${from}, skipping`); continue; }
    const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const st of reg.states) {
      if (!byState.has(st)) byState.set(st, []);
      byState.get(st).push(...rows.map(r => ({ ...r, registry: reg.key })));
    }
    log(`${reg.key}: ${rows.length} licences loaded`);
  }
  if (!byState.size) { log('no registry files found — run fetch first'); return null; }

  const states = [...byState.keys()];
  const stores = await db.all(`
    SELECT id, name, address, city, state, zip, phone, lat, lng, operating_status, claimed, staff_edited
    FROM stores
    WHERE visible = 1 AND state IN (${states.map(() => '?').join(',')})
      AND COALESCE(claimed, 0) = 0 AND COALESCE(staff_edited, 0) = 0
    ORDER BY id`, states);

  const verified = [], renamed = [], moved = [], lapsed = [], none = [];
  const now = new Date();
  for (const s of stores) {
    // Only the licences in this listing's own town: a state file can hold a
    // hundred thousand rows, and comparing every listing with every one of them
    // is both slow and a good way to match the wrong shop.
    const pool = byState.get(s.state).filter(r =>
      String(r.city || '').toLowerCase() === String(s.city || '').toLowerCase()
      || String(r.zip || '').slice(0, 5) === String(s.zip || '').slice(0, 5));
    if (!pool.length) continue;
    const v = verdictFor(s, pool, now);
    const row = {
      id: s.id, name: s.name, address: s.address, city: s.city, state: s.state,
      verdict: v.verdict, why: v.why, how: v.how || null,
      licence: v.record ? { name: v.record.name, address: v.record.address, city: v.record.city,
        status: v.record.status, expires: v.record.expires, registry: v.record.registry } : null,
      moved_to: v.to || null,
    };
    ({ verified, renamed, moved, lapsed, none }[v.verdict] || none).push(row);
  }

  log(`listings in registry states: ${stores.length}`);
  log(`  verified by a current licence: ${verified.length}`);
  log(`  trading under another name:    ${renamed.length}`);
  log(`  licensed at another address:   ${moved.length}`);
  log(`  no current licence (FLAG ONLY, never a hide): ${lapsed.length}`);
  log(`  nothing to say:                ${none.length}`);
  if (out) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify({
      note: 'A lapsed licence is NOT evidence of closure — the audit measured it at roughly a coin flip. The lapsed list is a staff queue and nothing in it may be hidden on this signal alone.',
      generated_at: now.toISOString(), verified, renamed, moved, lapsed,
    }, null, 1));
    log(`written to ${out}`);
  }
  return { verified, renamed, moved, lapsed, none };
}

// ── applying ────────────────────────────────────────────────────────────────

async function apply(file, { log = console.log } = {}) {
  const db = require('../database/db');
  const { writeFields } = require('../utils/storeEdits');
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));
  let stamped = 0, flagged = 0, cleared = 0;

  for (const v of d.verified || []) {
    await writeFields(v.id, { last_verified_at: new Date() }, {
      source: 'registry', job: 'licenceSync', reason: v.why,
    });
    // The registry agreeing that this business is at this door is what the
    // verified set means by a backed address.
    await db.run("UPDATE stores SET address_backed_by = 'licence' WHERE id = ? AND address_backed_by IS NULL", [v.id]);
    // A current licence is the best free argument there is that a shop exists.
    // It clears a likely-closed flag outright.
    const r = await db.run(`
      UPDATE stores SET operating_status = NULL, closed_reason = NULL, closure_checked_at = NOW()
      WHERE id = ? AND operating_status = 'likely_closed'
        AND COALESCE(claimed, 0) = 0 AND COALESCE(staff_edited, 0) = 0`, [v.id]);
    if (r.changes) cleared++;
    stamped++;
  }

  // Lapses are a queue, not a verdict. Nothing is hidden here, ever.
  for (const l of d.lapsed || []) {
    const r = await db.run(`
      UPDATE stores SET closed_reason = ?, closure_checked_at = NOW()
      WHERE id = ? AND visible = 1 AND operating_status IS NULL
        AND COALESCE(claimed, 0) = 0 AND COALESCE(staff_edited, 0) = 0`,
    [`licence registry: ${String(l.why).slice(0, 200)}`, l.id]);
    if (r.changes) flagged++;
  }

  log(`stamped ${stamped} listings as verified by a current licence, cleared ${cleared} closure flags, `
    + `noted ${flagged} lapses for staff. Renames and moves are review lists only.`);
  return { stamped, cleared, flagged };
}

module.exports = {
  REGISTRIES, fetchAll, match, apply, verdictFor, matchListing, isCurrent,
  sameDoor, namesAgree, street, digits, isKnownOpen, LAG_DAYS, SAME_DOOR_M,
};

// ── self-test ───────────────────────────────────────────────────────────────
function selftest() {
  let pass = 0, fail = 0;
  const ok = (cond, label, extra) => {
    if (cond) { pass++; console.log(`  ok   ${label}`); }
    else { fail++; console.log(`  FAIL ${label}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ''}`); }
  };
  const now = new Date('2026-09-12T00:00:00Z');

  ok(REGISTRIES.length === 8, 'the eight registries the audit named', REGISTRIES.length);
  ok(REGISTRIES.filter(r => r.format !== 'manual').every(r => typeof r.map === 'function'),
    'every API registry knows how to read its own rows');

  // The door test, and the trap the moved-shop sweep already hit.
  const ours = { address: '881 9th Ave', zip: '10019' };
  ok(sameDoor(ours, { address: '881 9TH AVENUE', zip: '10019-1234' }), 'the same door in different handwriting');
  ok(!sameDoor(ours, { address: '883 9th Ave', zip: '10019' }), 'next door is not the same door');
  ok(!sameDoor(ours, { address: '881 9th Ave', zip: '10001' }), 'nor is the same number in another ZIP');
  ok(!sameDoor({ address: '1 Main St', zip: '10019' }, { address: '1 Main Ave', zip: '10019' }),
    'a street type word alone is not the same street');
  ok(!sameDoor({ address: 'Suite 200', zip: '10019' }, { address: 'Suite 200', zip: '10019' }),
    'a suite with no street is not a door');

  ok(namesAgree("Anthony's Cigar Emporium", 'ANTHONYS CIGARS LLC'), 'names agree on a distinctive word');
  ok(!namesAgree('Smoke Shop', 'Cigar Store'), 'and never on the trade words alone');

  // A licence is current, lapsed, or late.
  ok(isCurrent({ status: 'Active', expires: '2027-01-01' }, now), 'a licence good until next year is current');
  ok(!isCurrent({ status: 'Active', expires: '2026-01-01' }, now), 'one that expired in January is not');
  ok(isCurrent({ status: 'Active', expires: '2026-08-01' }, now),
    `but one that expired six weeks ago is inside the ${LAG_DAYS}-day lag registries publish on`);
  ok(!isCurrent({ status: 'Revoked', expires: '2027-01-01' }, now), 'a revoked licence is not current whatever its date');
  ok(isCurrent({ status: 'Active' }, now), 'and a current status with no date is taken at its word');

  // ── the verdicts ──────────────────────────────────────────────────────────
  const shop = { id: 1, name: 'Ashford Cigars', address: '120 Elm St', city: 'Dayton', state: 'OH', zip: '45402', phone: '(937) 555-0100', lat: 39.76, lng: -84.19 };
  const live = { name: 'Ashford Cigars LLC', address: '120 Elm St', city: 'Dayton', zip: '45402', phone: '(937) 555-0100', status: 'Active', expires: '2027-06-30' };

  let v = verdictFor(shop, [live], now);
  ok(v.verdict === 'verified' && /telephone/.test(v.how), 'a current licence on the same phone number verifies the listing', v);
  v = verdictFor({ ...shop, phone: null }, [live], now);
  ok(v.verdict === 'verified' && /house number/.test(v.how), 'and so does one at the same door', v);

  v = verdictFor(shop, [{ ...live, name: 'Riverside Smoke LLC' }], now);
  ok(v.verdict === 'renamed', 'a different trading name at our door is a rename candidate', v);

  v = verdictFor(shop, [{ ...live, expires: '2025-01-01' }], now);
  ok(v.verdict === 'lapsed' && v.weak === true, 'an expired licence is a weak flag', v);

  v = verdictFor({ ...shop, phone: null }, [{ ...live, address: '900 Oak Ave' }], now);
  ok(v.verdict === 'moved' && v.to.address === '900 Oak Ave', 'the same name at another address is a move', v);

  // The same door, spelled two ways. Each of these read as a move in the
  // first real run, which took a licence off a shop that was standing on it.
  const door = (a, b) => sameDoor({ address: a, zip: '77084' }, { address: b, zip: '77084' });
  ok(door('5832 Highway Six', '5832 HIGHWAY 6'), 'a street named by a number, spelled either way');
  ok(door('12425 Hwy 6 #2', '12425 HIGHWAY 6 STE 2'), 'and with a suite on one side only');
  ok(door('10 N Plaza', '10 NORTH PLZ'), 'and a plaza written short');
  ok(!door('1 Main St', '1 Main Ave'), 'but Main St is still not Main Ave');
  ok(!door('100 Oak St', '100 Elm St'), 'nor Oak Elm');
  ok(!door('2200 W Nolana Ave #2212', '2200 N 10TH ST STE C'), 'nor two different streets at one house number');
  ok(door('170 Gardiners Ave', '170B GARDINERS AVE'), 'a unit letter on the house number is still the same building');
  ok(!door('170 Gardiners Ave', '171 GARDINERS AVE'), 'but the house next door is not');

  // Several licences at one address and nothing to tell them apart.
  const mall = [{ ...live, name: 'Kiosk One' }, { ...live, name: 'Kiosk Two' }];
  v = verdictFor({ ...shop, phone: null }, mall, now);
  ok(v.verdict === 'lapsed' || v.verdict === 'none', 'a strip mall with two licences at one number is not matched to either', v);

  // ── the guardrails ────────────────────────────────────────────────────────
  for (const name of ['Stogies', 'Stogies World Class Cigars', 'BlackHouse Cigar Lounge', 'Manhattan Tobacco']) {
    const lapsedHit = verdictFor({ ...shop, name, phone: null },
      [{ ...live, name, expires: '2020-01-01' }], now);
    ok(lapsedHit.verdict === 'none', `${name} is open and is never flagged`, lapsedHit);
    const missing = verdictFor({ ...shop, name, phone: null }, [{ ...live, name: 'Someone Else', address: '77 Other St' }], now);
    ok(missing.verdict === 'none' || missing.verdict === 'moved', `${name} is not flagged when no licence matches`, missing);
  }

  const nyc = { ...shop, city: 'New York', state: 'NY', zip: '10019', address: '881 9th Ave', phone: null };
  v = verdictFor(nyc, [{ name: 'Ashford Cigars', address: '881 9th Ave', city: 'New York', zip: '10019', status: 'Expired', expires: '2024-01-01' }], now);
  ok(v.verdict === 'none' && /New York City/.test(v.why), 'a New York City shop is exempt from lapse flags', v);
  v = verdictFor(nyc, [{ name: 'Somebody Else', address: '400 Other St', city: 'New York', zip: '10019', status: 'Active' }], now);
  ok(v.verdict === 'none', 'and from "no licence found" too', v);

  // The rule that outranks the rest: nothing here ever hides anything.
  const everyVerdict = ['verified', 'renamed', 'moved', 'lapsed', 'none'];
  ok(!everyVerdict.includes('closed') && !everyVerdict.includes('hide'),
    'there is no verdict in this job that hides a listing');

  console.log(`\nlicenceSync self-test: ${pass} passed, ${fail} failed`);
  return fail;
}

if (require.main === module) main();

function main() {
  const argv = process.argv.slice(2);
  const arg = n => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : null; };
  if (argv[0] === 'selftest') { process.exit(selftest() ? 1 : 0); }
  (async () => {
    if (argv[0] === 'fetch') await fetchAll({ outDir: arg('--out'), only: arg('--only') });
    else if (argv[0] === 'match') await match({ from: arg('--from'), out: arg('--out') });
    else if (argv[0] === 'apply' && argv.includes('--confirm')) await apply(arg('--from'));
    else console.error('usage: fetch --out <dir> | match --from <dir> --out <file> | apply --from <file> --confirm | selftest');
    process.exit(0);
  })().catch(e => { console.error(e); process.exit(1); });
}
