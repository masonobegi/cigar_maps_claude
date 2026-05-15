/**
 * Yellow Pages scraper — no API key, public listings
 * YP often has phone + website which we then use to find emails
 */
const axios = require('axios');
const cheerio = require('cheerio');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'max-age=0',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function searchYellowPages(query, city, state) {
  const results = [];
  const location = `${city}+${state}`.replace(/\s+/g, '+');
  const searchQ = query.replace(/\s+/g, '+');

  let page = 1;
  let hasMore = true;

  while (hasMore && page <= 3) {
    const url = `https://www.yellowpages.com/search?search_terms=${searchQ}&geo_location_terms=${location}&page=${page}`;
    try {
      const { data } = await axios.get(url, { headers: HEADERS, timeout: 15000 });
      const $ = cheerio.load(data);

      const cards = $('.result');
      if (cards.length === 0) { hasMore = false; break; }

      cards.each((_, el) => {
        const name = $(el).find('.business-name span').text().trim() ||
                     $(el).find('h2.n a').text().trim();
        if (!name) return;

        const street = $(el).find('.street-address').text().trim();
        const locality = $(el).find('.locality').text().trim();
        const cityParsed = locality.split(',')[0]?.trim() || city;
        const stateParsed = locality.split(',')[1]?.trim()?.split(' ')[0] || state;
        const zipParsed = locality.match(/\d{5}/)?.[0] || '';
        const phone = $(el).find('.phone').text().trim();
        const website = $(el).find('a.track-visit-website').attr('href') || '';

        results.push({
          source: 'Yellow Pages',
          name,
          address: street,
          city: cityParsed,
          state: stateParsed,
          zip: zipParsed,
          phone,
          website: website.startsWith('http') ? website.split('?')[0] : '',
          email: '',
        });
      });

      // Check if there's a next page
      hasMore = $('a.next').length > 0;
      page++;
      await sleep(2500 + Math.random() * 1500);
    } catch (err) {
      console.log(`  [YellowPages] Error (page ${page}): ${err.message}`);
      hasMore = false;
    }
  }

  return results;
}

async function searchCigarStores(city, state) {
  console.log(`  [YP] Searching "${city}, ${state}"...`);
  const queries = ['cigar shops', 'tobacco shops', 'cigar lounge'];
  const all = [];
  for (const q of queries) {
    const res = await searchYellowPages(q, city, state);
    all.push(...res);
    await sleep(1000);
  }

  const deduped = dedup(all);
  console.log(`  [YP] Found ${deduped.length} results`);
  return deduped;
}

function dedup(arr) {
  const seen = new Set();
  return arr.filter(r => {
    const key = r.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

module.exports = { searchCigarStores };
