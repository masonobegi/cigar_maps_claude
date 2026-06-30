const https = require('https');
const http = require('http');
const db = require('../database/db');

function normalize(str) {
  return (str || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

function extractSheetId(url) {
  const m = (url || '').match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

function fetchUrl(url, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects === 0) return reject(new Error('Too many redirects'));
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        return resolve(fetchUrl(res.headers.location, maxRedirects - 1));
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    });
    req.on('error', reject);
  });
}

function parseCsv(text) {
  return text.split('\n').filter(l => l.trim()).map(line => {
    const cols = [];
    let col = '', inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') { col += '"'; i++; }
        else { inQuote = !inQuote; }
      } else if (ch === ',' && !inQuote) {
        cols.push(col.trim()); col = '';
      } else { col += ch; }
    }
    cols.push(col.trim());
    return cols;
  });
}

async function syncSheet(storeId, sheetUrl) {
  const sheetId = extractSheetId(sheetUrl);
  if (!sheetId) throw new Error('Invalid Google Sheets URL — must contain /spreadsheets/d/{id}');

  const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=0`;
  const csvText = await fetchUrl(csvUrl);
  const rows = parseCsv(csvText);

  if (rows.length < 2) return { synced: 0, unmatched: [] };

  const dataRows = rows.slice(1); // skip header
  const unmatched = [];
  let synced = 0;

  for (const row of dataRows) {
    const [brand = '', cigarName = '', vitolaName = '', priceStr = '', qtyStr = ''] = row;
    if (!normalize(brand) && !normalize(cigarName)) continue; // empty row

    const normBrand = normalize(brand);
    const normName = normalize(cigarName);
    const normVitola = normalize(vitolaName);

    if (!normBrand || !normName || !normVitola) {
      unmatched.push({ brand, cigar: cigarName, vitola: vitolaName, reason: 'Missing brand, cigar name, or size' });
      continue;
    }

    // Match cigar
    const { rows: cigarRows } = await db.pool.query(
      `SELECT id FROM cigars WHERE lower(regexp_replace(trim(brand), '\\s+', ' ', 'g')) = $1 AND lower(regexp_replace(trim(name), '\\s+', ' ', 'g')) = $2`,
      [normBrand, normName]
    );
    if (!cigarRows.length) {
      unmatched.push({ brand, cigar: cigarName, vitola: vitolaName, reason: 'Cigar not found in catalog' });
      continue;
    }

    const cigarId = cigarRows[0].id;

    // Match vitola
    const { rows: vitolaRows } = await db.pool.query(
      `SELECT id FROM vitolas WHERE cigar_id = $1 AND lower(regexp_replace(trim(name), '\\s+', ' ', 'g')) = $2`,
      [cigarId, normVitola]
    );
    if (!vitolaRows.length) {
      unmatched.push({ brand, cigar: cigarName, vitola: vitolaName, reason: `Size "${vitolaName}" not in catalog` });
      continue;
    }

    const vitolaId = vitolaRows[0].id;
    const price = parseFloat((priceStr || '').replace(/[^0-9.]/g, ''));
    if (!price || isNaN(price)) {
      unmatched.push({ brand, cigar: cigarName, vitola: vitolaName, reason: 'Missing or invalid price' });
      continue;
    }
    const quantity = (qtyStr || '').trim() !== '' ? parseInt(qtyStr, 10) : null;

    // Upsert inventory
    const existing = await db.get('SELECT id FROM inventory WHERE store_id = ? AND vitola_id = ?', [storeId, vitolaId]);
    if (existing) {
      await db.run(
        'UPDATE inventory SET price=?, quantity=?, in_stock=1, synced_from_sheet=true, updated_at=CURRENT_TIMESTAMP WHERE id=?',
        [price, quantity, existing.id]
      );
    } else {
      await db.run(
        'INSERT INTO inventory (store_id, cigar_id, vitola_id, price, quantity, in_stock, synced_from_sheet) VALUES (?, ?, ?, ?, ?, 1, true)',
        [storeId, cigarId, vitolaId, price, quantity]
      );
    }
    synced++;
  }

  await db.pool.query('UPDATE stores SET sheet_last_synced = NOW() WHERE id = $1', [storeId]);
  return { synced, unmatched };
}

async function syncAllSheets() {
  const { rows: stores } = await db.pool.query(
    `SELECT id, sheet_url FROM stores WHERE sheet_url IS NOT NULL AND sheet_url != ''`
  );
  for (const store of stores) {
    try {
      const result = await syncSheet(store.id, store.sheet_url);
      console.log(`[sheet-sync] Store ${store.id}: ${result.synced} synced, ${result.unmatched.length} unmatched`);
    } catch (err) {
      console.error(`[sheet-sync] Store ${store.id}:`, err.message);
    }
  }
}

module.exports = { syncSheet, syncAllSheets, extractSheetId };
