const router = require('express').Router();
const db = require('../database/db');
const { requireAuth } = require('../middleware/auth');
const { asyncRoute } = db;
const multer = require('multer');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

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

  const imageData = req.file.buffer.toString('base64');
  const imageType = req.file.mimetype;

  // Check if this cigar already has a default image
  const hasDefault = await db.get('SELECT id FROM cigar_images WHERE cigar_id = ? AND is_default = 1', [req.params.cigarId]);
  const isDefault = hasDefault ? 0 : 1;

  const result = await db.run(
    'INSERT INTO cigar_images (cigar_id, store_id, image_data, image_type, is_default) VALUES (?, ?, ?, ?, ?) RETURNING id',
    [req.params.cigarId, store.id, imageData, imageType, isDefault]
  );

  res.json({ id: result.lastInsertRowid, is_default: isDefault });
}));

// Get images for a cigar
router.get('/cigars/:cigarId/images', asyncRoute(async (req, res) => {
  const images = await db.all(
    'SELECT id, cigar_id, store_id, image_type, is_default, uploaded_at FROM cigar_images WHERE cigar_id = ? ORDER BY is_default DESC, uploaded_at ASC',
    [req.params.cigarId]
  );
  res.json(images);
}));

// Serve image binary by ID
router.get('/images/:id', asyncRoute(async (req, res) => {
  const image = await db.get('SELECT image_data, image_type FROM cigar_images WHERE id = ?', [req.params.id]);
  if (!image) return res.status(404).json({ error: 'Image not found' });

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

  // If deleted image was default, promote the next oldest
  if (image.is_default) {
    const next = await db.get('SELECT id FROM cigar_images WHERE cigar_id = ? ORDER BY uploaded_at ASC LIMIT 1', [image.cigar_id]);
    if (next) await db.run('UPDATE cigar_images SET is_default = 1 WHERE id = ?', [next.id]);
  }

  res.json({ success: true });
}));

module.exports = router;
