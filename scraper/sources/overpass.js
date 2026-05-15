/**
 * OpenStreetMap Overpass API — completely free, no API key
 * Uses Node's native https to avoid header issues with axios
 */
const https = require('https');

const OVERPASS_URL = 'overpass-api.de';

function post(query) {
  return new Promise((resolve, reject) => {
    const postData = 'data=' + encodeURIComponent(query);
    const options = {
      hostname: OVERPASS_URL,
      path: '/api/interpreter',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
        'User-Agent': 'CigarBuddy-Scraper/1.0',
      },
      timeout: 90000,
    };

    const req = https.request(options, res => {
      let d = '';
      res.on('data', chunk => d += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try { resolve(JSON.parse(d)); }
          catch (e) { reject(new Error('JSON parse error')); }
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(postData);
    req.end();
  });
}

function buildCityQuery(city) {
  return `
[out:json][timeout:60];
area["name"="${city}"]["boundary"="administrative"]->.a;
(
  node["shop"="tobacco"](area.a);
  node["shop"="cigar"](area.a);
  node["name"~"cigar",i]["shop"](area.a);
  node["name"~"tobacconist",i](area.a);
  node["name"~"smoke shop",i](area.a);
  way["shop"="tobacco"](area.a);
  way["shop"="cigar"](area.a);
  way["name"~"cigar",i]["shop"](area.a);
);
out center tags;
`.trim();
}

function buildUSQuery() {
  return `
[out:json][timeout:120];
(
  node["shop"="tobacco"]["name"~"cigar|tobacco|smoke|stogie|lounge",i](24.0,-125.0,50.0,-66.0);
  node["shop"="cigar"](24.0,-125.0,50.0,-66.0);
  way["shop"="tobacco"]["name"~"cigar|tobacco",i](24.0,-125.0,50.0,-66.0);
  way["shop"="cigar"](24.0,-125.0,50.0,-66.0);
);
out center tags;
`.trim();
}

function parseElements(data) {
  const results = [];
  for (const el of data.elements || []) {
    const t = el.tags || {};
    const name = t.name;
    if (!name || name.length < 3) continue;

    results.push({
      source: 'OpenStreetMap',
      name,
      address: [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ') || '',
      city: t['addr:city'] || '',
      state: t['addr:state'] || '',
      zip: t['addr:postcode'] || '',
      phone: (t.phone || t['contact:phone'] || '').replace(/^tel:/, ''),
      website: (t.website || t['contact:website'] || t.url || '').replace(/\/$/, ''),
      email: t.email || t['contact:email'] || '',
      lat: el.lat || el.center?.lat || '',
      lng: el.lon || el.center?.lon || '',
      opening_hours: t.opening_hours || '',
    });
  }
  return results;
}

async function searchByCity(city) {
  console.log(`  [OSM] "${city}"...`);
  try {
    const data = await post(buildCityQuery(city));
    const results = parseElements(data);
    console.log(`  [OSM] ${results.length} results`);
    return results;
  } catch (err) {
    console.log(`  [OSM] Failed (${err.message}) — skipping`);
    return [];
  }
}

async function searchAllUS() {
  console.log('  [OSM] US-wide search (30-60s)...');
  try {
    const data = await post(buildUSQuery());
    const results = parseElements(data);
    console.log(`  [OSM] ${results.length} US results`);
    return results;
  } catch (err) {
    console.log(`  [OSM] Failed: ${err.message}`);
    return [];
  }
}

module.exports = { searchByCity, searchAllUS };
