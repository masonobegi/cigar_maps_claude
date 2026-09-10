const router = require('express').Router();
const db = require('../database/db');
const { requireAuth } = require('../middleware/auth');
const { asyncRoute } = db;
const multer = require('multer');
const storage = require('../utils/storage');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

/**
 * Put the bytes in object storage and return a URL. When no storage backend is
 * configured this returns null and the caller keeps the base64 in Postgres, so
 * an unconfigured deployment behaves exactly as it did before.
 */
async function store(buffer, mimetype, prefix) {
  try {
    return await storage.putImage(buffer, mimetype, prefix);
  } catch (err) {
    console.error('[images] upload failed, falling back to the database:', err.message);
    return null;
  }
}

// Upload image for a cigar (verified store owners only)
router.post('/cigars/:cigarId/images', requireAuth, upload.single('image'), asyncRoute(async (req, res) => {
  const store = await db.get('SELECT s.id, s.verified FROM stores s WHERE s.user_id = ?', [req.user.id]);
  if (!store) return res.status(403).json({ error: 'Store account required' });
  if (!store.verified) return res.status(403).json({ error: 'Your store must be verified to upload cigar images' });

  const cigar = await db.get('SELECT id FROM cigars WHERE id = ?', [req.params.cigarId]);
  if (!cigar) return res.status(404).json({ error: 'Cigar not found' });

  if (!req.file) return res.status(400).json({ error: 'No image file provided' });

  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowedTypes.includes(req.file.mimetype)) return res.status(400).json({ error: 'Only JPEG, PNG, and WebP images are allowed' });

  const imageType = req.file.mimetype;
  const url = await store(req.file.buffer, imageType, 'cigars');
  const imageData = url ? null : req.file.buffer.toString('base64');

  // Check if this cigar already has a default image
  const hasDefault = await db.get('SELECT id FROM cigar_images WHERE cigar_id = ? AND is_default = 1', [req.params.cigarId]);
  const isDefault = hasDefault ? 0 : 1;

  const result = await db.run(
    'INSERT INTO cigar_images (cigar_id, store_id, image_data, image_url, image_type, is_default) VALUES (?, ?, ?, ?, ?, ?) RETURNING id',
    [req.params.cigarId, store.id, imageData, url, imageType, isDefault]
  );

  res.json({ id: result.lastInsertRowid, is_default: isDefault, url });
}));

// Get images for a cigar
router.get('/cigars/:cigarId/images', asyncRoute(async (req, res) => {
  const images = await db.all(
    'SELECT id, cigar_id, store_id, image_type, image_url, is_default, uploaded_at FROM cigar_images WHERE cigar_id = ? ORDER BY is_default DESC, uploaded_at ASC',
    [req.params.cigarId]
  );
  res.json(images);
}));

// Serve image binary by ID
router.get('/images/:id', asyncRoute(async (req, res) => {
  const image = await db.get('SELECT image_data, image_url, image_type FROM cigar_images WHERE id = ?', [req.params.id]);
  if (!image) return res.status(404).json({ error: 'Image not found' });
  // Stored in a bucket: send the reader there instead of proxying the bytes.
  if (image.image_url) return res.redirect(302, image.image_url);
  if (!image.image_data) return res.status(404).json({ error: 'Image not found' });

  const buf = Buffer.from(image.image_data, 'base64');
  res.set('Content-Type', image.image_type);
  res.set('Cache-Control', 'public, max-age=86400');
  res.send(buf);
}));

// Set an image as the default for a cigar (verified store owner who uploaded it)
router.patch('/images/:id/set-default', requireAuth, asyncRoute(async (req, res) => {
  const store = await db.get('SELECT id FROM stores WHERE user_id = ?', [req.user.id]);
  if (!store) return res.status(403).json({ error: 'Store account required' });

  const image = await db.get('SELECT * FROM cigar_images WHERE id = ? AND store_id = ?', [req.params.id, store.id]);
  if (!image) return res.status(404).json({ error: 'Image not found or not yours' });

  await db.run('UPDATE cigar_images SET is_default = 0 WHERE cigar_id = ?', [image.cigar_id]);
  await db.run('UPDATE cigar_images SET is_default = 1 WHERE id = ?', [req.params.id]);

  res.json({ success: true });
}));

// Delete an image (verified store owner who uploaded it)
router.delete('/images/:id', requireAuth, asyncRoute(async (req, res) => {
  const store = await db.get('SELECT id FROM stores WHERE user_id = ?', [req.user.id]);
  if (!store) return res.status(403).json({ error: 'Store account required' });

  const image = await db.get('SELECT * FROM cigar_images WHERE id = ? AND store_id = ?', [req.params.id, store.id]);
  if (!image) return res.status(404).json({ error: 'Image not found or not yours' });

  await db.run('DELETE FROM cigar_images WHERE id = ?', [req.params.id]);
  storage.deleteImage(image.image_url);

  // If deleted image was default, promote the next oldest
  if (image.is_default) {
    const next = await db.get('SELECT id FROM cigar_images WHERE cigar_id = ? ORDER BY uploaded_at ASC LIMIT 1', [image.cigar_id]);
    if (next) await db.run('UPDATE cigar_images SET is_default = 1 WHERE id = ?', [next.id]);
  }

  res.json({ success: true });
}));

// Upload a photo for a review (owner only)
router.patch('/reviews/:id/photo', requireAuth, upload.single('photo'), asyncRoute(async (req, res) => {
  const review = await db.get('SELECT id FROM reviews WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!review) return res.status(404).json({ error: 'Review not found' });
  if (!req.file) return res.status(400).json({ error: 'No photo provided' });

  const allowed = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowed.includes(req.file.mimetype)) return res.status(400).json({ error: 'Only JPEG, PNG, and WebP allowed' });

  const url = await store(req.file.buffer, req.file.mimetype, 'reviews');
  const photoData = url ? null : req.file.buffer.toString('base64');
  await db.run('UPDATE reviews SET photo_data = ?, photo_url = ?, photo_type = ? WHERE id = ?',
    [photoData, url, req.file.mimetype, req.params.id]);
  res.json({ success: true, url });
}));

// Serve review photo binary
router.get('/review-images/:id', asyncRoute(async (req, res) => {
  const row = await db.get('SELECT photo_data, photo_url, photo_type FROM reviews WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Photo not found' });
  if (row.photo_url) return res.redirect(302, row.photo_url);
  if (!row.photo_data) return res.status(404).json({ error: 'Photo not found' });

  const buf = Buffer.from(row.photo_data, 'base64');
  res.set('Content-Type', row.photo_type || 'image/jpeg');
  res.set('Cache-Control', 'public, max-age=86400');
  res.send(buf);
}));

module.exports = router;
