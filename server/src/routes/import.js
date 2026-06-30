const router = require('express').Router();
const db = require('../database/db');
const { requireAuth } = require('../middleware/auth');
const { asyncRoute } = db;
const multer = require('multer');
const XLSX = require('xlsx');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

function normalize(str) {
  return (str || '').toString().toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function similarity(a, b) {
  const na = normalize(a), nb = normalize(b);
  if (!na || !nb) return 0;
  const dist = levenshtein(na, nb);
  return 1 - dist / Math.max(na.length, nb.length);
}

// Parse CSV/XLSX and preview matches against known cigars
router.post('/stores/:id/import/preview', requireAuth, upload.single('file'), asyncRoute(async (req, res) => {
  const store = await db.get('SELECT id FROM stores WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!store) return res.status(403).json({ error: 'Forbidden' });
  if (!req.file) return res.status(400).json({ error: 'No file provided' });

  const ext = (req.file.originalname || '').split('.').pop().toLowerCase();
  if (!['csv', 'xlsx', 'xls'].includes(ext)) return res.status(400).json({ error: 'Only CSV and XLSX files are supported' });

  let rows;
  try {
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
  } catch (e) {
    return res.status(400).json({ error: 'Could not parse file. Ensure it is a valid CSV or XLSX.' });
  }

  if (rows.length === 0) return res.status(400).json({ error: 'File is empty or has no data rows' });
  if (rows.length > 500) return res.status(400).json({ error: 'File too large — max 500 rows per import' });

  // Normalize column names
  const colMap = {};
  const keys = Object.keys(rows[0]);
  for (const k of keys) {
    const nk = normalize(k);
    if (/brand/.test(nk)) colMap.brand = k;
    else if (/name|cigar/.test(nk)) colMap.name = k;
    else if (/vitola|size|format/.test(nk)) colMap.vitola = k;
    else if (/price/.test(nk)) colMap.price = k;
    else if (/qty|quantity|stock|count/.test(nk)) colMap.quantity = k;
  }

  // Load all cigars for matching
  const cigars = await db.all('SELECT c.id, c.brand, c.name, v.id as vitola_id, v.name as vitola_name FROM cigars c LEFT JOIN vitolas v ON v.cigar_id = c.id', []);

  const preview = [];
  for (const row of rows) {
    const rawBrand = (row[colMap.brand] || '').toString().trim();
    const rawName = (row[colMap.name] || '').toString().trim();
    const rawVitola = colMap.vitola ? (row[colMap.vitola] || '').toString().trim() : '';
    const rawPrice = parseFloat((row[colMap.price] || '0').toString().replace(/[^0-9.]/g, '')) || null;
    const rawQty = parseInt((row[colMap.quantity] || '0').toString()) || 0;

    if (!rawName && !rawBrand) continue;

    const searchStr = [rawBrand, rawName].filter(Boolean).join(' ');
    let bestCigar = null, bestScore = 0;
    for (const c of cigars) {
      const cigarStr = `${c.brand} ${c.name}`;
      const score = similarity(searchStr, cigarStr);
      if (score > bestScore) { bestScore = score; bestCigar = c; }
    }

    let bestVitola = null, bestVitolaScore = 0;
    if (bestCigar && rawVitola) {
      const vitolas = cigars.filter(c => c.id === bestCigar.id && c.vitola_id);
      for (const v of vitolas) {
        const score = similarity(rawVitola, v.vitola_name);
        if (score > bestVitolaScore) { bestVitolaScore = score; bestVitola = v; }
      }
    }

    preview.push({
      row_index: preview.length,
      raw: { brand: rawBrand, name: rawName, vitola: rawVitola, price: rawPrice, quantity: rawQty },
      match: bestCigar ? {
        cigar_id: bestCigar.id,
        brand: bestCigar.brand,
        name: bestCigar.name,
        vitola_id: bestVitola?.vitola_id || null,
        vitola_name: bestVitola?.vitola_name || null,
        confidence: Math.round(bestScore * 100),
        vitola_confidence: bestVitola ? Math.round(bestVitolaScore * 100) : null,
      } : null,
      price: rawPrice,
      quantity: rawQty,
    });
  }

  res.json({ preview, columns_detected: colMap });
}));

// Confirm import — bulk upsert into inventory
router.post('/stores/:id/import/confirm', requireAuth, asyncRoute(async (req, res) => {
  const store = await db.get('SELECT id FROM stores WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!store) return res.status(403).json({ error: 'Forbidden' });

  const { rows } = req.body;
  if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ error: 'No rows to import' });

  let added = 0, updated = 0, skipped = 0;
  for (const row of rows) {
    if (!row.cigar_id || !row.price) { skipped++; continue; }

    const existing = await db.get(
      'SELECT id FROM inventory WHERE store_id = ? AND cigar_id = ? AND (vitola_id = ? OR (vitola_id IS NULL AND ? IS NULL))',
      [store.id, row.cigar_id, row.vitola_id || null, row.vitola_id || null]
    );

    if (existing) {
      await db.run(
        'UPDATE inventory SET price = ?, quantity = ?, in_stock = ?, updated_at = NOW() WHERE id = ?',
        [row.price, row.quantity || 0, row.quantity > 0 ? 1 : 0, existing.id]
      );
      updated++;
    } else {
      await db.run(
        'INSERT INTO inventory (store_id, cigar_id, vitola_id, price, quantity, in_stock) VALUES (?, ?, ?, ?, ?, ?)',
        [store.id, row.cigar_id, row.vitola_id || null, row.price, row.quantity || 0, row.quantity > 0 ? 1 : 0]
      );
      added++;
    }
  }

  res.json({ added, updated, skipped });
}));

module.exports = router;
