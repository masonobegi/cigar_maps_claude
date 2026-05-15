/**
 * Google Maps Places API
 * Requires API key — get one free at console.cloud.google.com
 * $200/month free credit = ~10,000 place searches
 * Set GOOGLE_PLACES_KEY=your_key in environment or .env file
 */
const axios = require('axios');

const API_KEY = process.env.GOOGLE_PLACES_KEY;
const BASE = 'https://maps.googleapis.com/maps/api/place';

async function searchCity(city, state) {
  if (!API_KEY) {
    console.log('  [Google] No API key set — skipping. Set GOOGLE_PLACES_KEY env var to enable.');
    return [];
  }

  console.log(`  [Google] Searching "${city}, ${state}"...`);
  const results = [];

  try {
    // Text search for cigar shops in city
    const queries = [`cigar shop in ${city}, ${state}`, `tobacco shop in ${city}, ${state}`, `cigar lounge in ${city}, ${state}`];

    for (const query of queries) {
      let url = `${BASE}/textsearch/json?query=${encodeURIComponent(query)}&type=store&key=${API_KEY}`;

      while (url) {
        const { data } = await axios.get(url, { timeout: 15000 });

        for (const place of data.results || []) {
          // Get place details for phone/website
          const details = await getPlaceDetails(place.place_id);
          results.push({
            source: 'Google Places',
            name: place.name,
            address: place.formatted_address?.split(',')[0] || '',
            city,
            state,
            zip: extractZip(place.formatted_address || ''),
            phone: details.phone || '',
            website: details.website || '',
            email: '', // Google doesn't provide emails
            lat: place.geometry?.location?.lat || '',
            lng: place.geometry?.location?.lng || '',
            opening_hours: details.hours || '',
            google_rating: place.rating || '',
            google_reviews: place.user_ratings_total || '',
            google_place_id: place.place_id,
          });
          await sleep(100); // be gentle with the API
        }

        url = data.next_page_token
          ? `${BASE}/textsearch/json?pagetoken=${data.next_page_token}&key=${API_KEY}`
          : null;

        if (url) await sleep(2000); // next_page_token needs 2s delay
      }
    }

    console.log(`  [Google] Found ${results.length} results for "${city}, ${state}"`);
    return dedup(results);
  } catch (err) {
    console.error(`  [Google] Error: ${err.message}`);
    return [];
  }
}

async function getPlaceDetails(placeId) {
  if (!API_KEY) return {};
  try {
    const { data } = await axios.get(`${BASE}/details/json?place_id=${placeId}&fields=website,formatted_phone_number,opening_hours&key=${API_KEY}`, { timeout: 10000 });
    const r = data.result || {};
    return {
      phone: r.formatted_phone_number || '',
      website: r.website || '',
      hours: r.opening_hours?.weekday_text?.join(' | ') || '',
    };
  } catch { return {}; }
}

function extractZip(address) {
  const match = address.match(/\b\d{5}\b/);
  return match ? match[0] : '';
}

function dedup(arr) {
  const seen = new Set();
  return arr.filter(r => {
    const key = (r.name + r.city).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { searchCity };
