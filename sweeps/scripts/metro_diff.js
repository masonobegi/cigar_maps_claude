/**
 * The guardrail on the search fix: removing the row cap surfaces low-confidence
 * listings the cap used to hide in dense metros. This prints the first 30 cards
 * a customer sees in each affected metro, before and after, and marks the rows
 * that are new, so a person can skim them rather than trust the recall number.
 *
 * Read-only.
 *   PGLITE_DIR=<db> node sweeps/scripts/metro_diff.js [--out <file>] [--cards 30]
 *
 * The metros are the eight the audit measured as losing rows at 50 miles.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const SRV = path.join(__dirname, '..', '..', 'server', 'src');
const db = require(path.join(SRV, 'database', 'db'));
const { openStatus, timeZoneFor } = require(path.join(SRV, 'utils', 'storeHours'));
const { listStores } = require(path.join(SRV, 'utils', 'storeList'));
const { buildFilters, haversine, boundingBox } = require(path.join(SRV, 'utils', 'storeSearch'));
const { METROS } = require(path.join(SRV, 'jobs', 'recallMonitor'));

const AFFECTED = ['New York (Midtown)', 'Brooklyn', 'Newark NJ', 'Long Island (Hempstead)',
  'Washington DC', 'Baltimore', 'Fort Lauderdale', 'Los Angeles'];

/** The list exactly as it was before this sweep: 300 rows, then the radius. */
async function before(lat, lng, radiusMi) {
  const { where, params } = buildFilters({});
  const box = boundingBox(lat, lng, radiusMi);
  where.push('s.lat BETWEEN ? AND ? AND s.lng BETWEEN ? AND ?');
  params.push(box.minLat, box.maxLat, box.minLng, box.maxLng);
  const rows = await db.all(`
    SELECT s.id, s.name, s.city, s.state, s.confidence, s.lat, s.lng,
           s.website_status, s.operating_status, s.hours_source, s.store_type,
           COUNT(DISTINCT i.id) as inventory_count, COUNT(DISTINCT sf.user_id) as follower_count
    FROM stores s
    LEFT JOIN inventory i ON i.store_id = s.id AND i.in_stock = 1
    LEFT JOIN store_follows sf ON sf.store_id = s.id
    WHERE ${where.join(' AND ')}
    GROUP BY s.id
    ORDER BY s.claimed DESC, s.verified DESC, follower_count DESC, inventory_count DESC,
             s.confidence DESC, s.name
    LIMIT 300`, params);
  return rows
    .filter(s => s.lat !== null && s.lng !== null)
    .map(s => ({ ...s, distance_mi: haversine(lat, lng, Number(s.lat), Number(s.lng)) }))
    .filter(s => s.distance_mi <= radiusMi)
    .sort((a, b) => a.distance_mi - b.distance_mi);
}

(async () => {
  const argv = process.argv.slice(2);
  const outIdx = argv.indexOf('--out');
  const cardsIdx = argv.indexOf('--cards');
  const cards = cardsIdx >= 0 ? parseInt(argv[cardsIdx + 1]) : 30;
  const report = { generated_at: new Date().toISOString(), cards, metros: [] };

  for (const name of AFFECTED) {
    const m = METROS.find(x => x[0] === name);
    if (!m) continue;
    const [, lat, lng] = m;
    const was = await before(lat, lng, 50);
    const nowList = [];
    let off = 0;
    for (;;) {
      const page = await listStores({ lat, lng, radius: '50', offset: String(off) });
      nowList.push(...page.stores);
      if (page.next_offset === null || nowList.length >= cards * 4) break;
      off = page.next_offset;
    }
    const wasIds = new Set(was.map(s => s.id));
    const firstNow = nowList.slice(0, cards);
    const entry = {
      metro: name,
      before_total: was.length,
      after_total: null,
      new_in_first_cards: firstNow.filter(s => !wasIds.has(s.id)).length,
      first_cards: firstNow.map(s => ({
        id: s.id, name: s.name, city: s.city, state: s.state,
        distance_mi: s.distance_mi, confidence: s.confidence,
        store_type: s.store_type, hours_source: s.hours_source,
        website_status: s.website_status, operating_status: s.operating_status,
        // The rows a person actually needs to look at.
        newly_surfaced: !wasIds.has(s.id),
      })),
    };
    const meta = await listStores({ lat, lng, radius: '50' });
    entry.after_total = meta.total;
    report.metros.push(entry);

    console.log(`\n${name}: ${was.length} before, ${meta.total} after (+${meta.total - was.length})`);
    console.log(`  new among the first ${cards} cards: ${entry.new_in_first_cards}`);
    for (const c of entry.first_cards) {
      if (!c.newly_surfaced) continue;
      console.log(`    NEW #${c.id} ${c.name} — ${c.city}, ${c.state} — ${c.distance_mi.toFixed(1)} mi`
        + ` — confidence ${c.confidence} — ${c.store_type}`
        + (c.website_status ? ` — site ${c.website_status}` : '')
        + (c.operating_status ? ` — ${c.operating_status}` : ''));
    }
  }

  if (outIdx >= 0) {
    fs.mkdirSync(path.dirname(argv[outIdx + 1]), { recursive: true });
    fs.writeFileSync(argv[outIdx + 1], JSON.stringify(report, null, 1));
    console.log(`\nwrote ${argv[outIdx + 1]}`);
  }
  console.log('\nRead every NEW row above. A listing the cap used to hide is not');
  console.log('automatically a listing that belongs on the map (rule 2).');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
