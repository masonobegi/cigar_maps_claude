/**
 * Yelp scraper — no API key, scrapes public search results
 * Gets: name, address, phone, website, rating, review count
 * Then email-finder.js visits each website to extract emails
 */
const axios = require('axios');
const cheerio = require('cheerio');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Referer': 'https://www.yelp.com/',
};

const SEARCH_TERMS = ['cigar shops', 'cigar lounge', 'tobacco shop', 'tobacconist'];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function searchYelp(city, state) {
  const results = [];

  for (const term of SEARCH_TERMS) {
    const location = state ? `${city}, ${state}` : city;
    const url = `https://www.yelp.com/search?find_desc=${encodeURIComponent(term)}&find_loc=${encodeURIComponent(location)}&start=0`;

    try {
      console.log(`  [Yelp] "${term}" in "${location}"...`);
      const { data } = await axios.get(url, { headers: HEADERS, timeout: 15000 });
      const $ = cheerio.load(data);

      // Yelp embeds JSON data in a script tag
      const scripts = $('script[type="application/json"]');
      scripts.each((_, el) => {
        try {
          const json = JSON.parse($(el).html() || '{}');
          extractFromYelpJson(json, results, city, state);
        } catch {}
      });

      // Fallback: scrape visible cards
      $('[data-testid="serp-ia-card"], .businessName, [class*="businessName"]').each((_, el) => {
        const name = $(el).text().trim();
        if (name && name.length > 2 && name.length < 80) {
          if (!results.find(r => r.name === name)) {
            results.push({ source: 'Yelp', name, city, state, address: '', phone: '', website: '', email: '' });
          }
        }
      });

      await sleep(2000 + Math.random() * 2000);
    } catch (err) {
      if (err.response?.status === 429) {
        console.log('  [Yelp] Rate limited — waiting 30s...');
        await sleep(30000);
      } else {
        console.log(`  [Yelp] Error: ${err.message}`);
      }
    }
  }

  return dedup(results);
}

function extractFromYelpJson(obj, results, city, state) {
  if (!obj || typeof obj !== 'object') return;

  // Look for business arrays in the JSON
  const str = JSON.stringify(obj);
  const businessMatches = str.match(/"businessName":"([^"]+)"/g) || [];

  // Try to find structured business data
  traverse(obj, results, city, state);
}

function traverse(obj, results, city, state, depth = 0) {
  if (depth > 8 || !obj || typeof obj !== 'object') return;

  // Look for objects that look like business listings
  if (obj.name && obj.businessUrl) {
    const phone = obj.phone || obj.phoneNumber || obj.formattedPhone || '';
    const website = obj.website || obj.websiteUrl || '';
    const address = obj.address || obj.formattedAddress || '';

    if (obj.name.length > 2 && obj.name.length < 80) {
      results.push({
        source: 'Yelp',
        name: obj.name,
        address: typeof address === 'string' ? address.split('\n')[0] : '',
        city: obj.city || city,
        state: obj.state || state,
        zip: obj.zip || obj.postalCode || '',
        phone: typeof phone === 'string' ? phone : '',
        website: typeof website === 'string' ? website.replace(/\?.*$/, '') : '',
        email: '',
        yelp_rating: obj.rating || obj.businessRating || '',
        yelp_reviews: obj.reviewCount || '',
      });
    }
  }

  for (const val of Object.values(obj)) {
    if (Array.isArray(val)) val.forEach(item => traverse(item, results, city, state, depth + 1));
    else if (typeof val === 'object') traverse(val, results, city, state, depth + 1);
  }
}

function dedup(arr) {
  const seen = new Set();
  return arr.filter(r => {
    const key = r.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

module.exports = { searchYelp };
