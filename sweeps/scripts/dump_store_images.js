/**
 * Every image a public listing would show, so the darkness complaint can be
 * measured rather than guessed at.
 *
 * StoreThumb picks its backdrop from the URL: a src matching /logo/i gets a
 * cream backdrop and object-fit: contain; everything else gets #2A2520 — a
 * near-black box — and object-fit: cover. So a logo whose URL does not happen
 * to contain the word "logo" lands on a dark box, and if it is a transparent
 * PNG drawn in dark ink, it is dark artwork on a dark square.
 *
 *   railway run --service Postgres node sweeps/scripts/prod.js <abs path to this>
 */
'use strict';

const fs = require('fs');
const path = require('path');
const db = require('../../server/src/database/db');

(async () => {
  const rows = await db.all(`
    SELECT id, name, city, state,
           logo_url, cover_url, web_image_url
    FROM stores
    WHERE visible = 1
      AND COALESCE(logo_url, cover_url, web_image_url) IS NOT NULL
      AND COALESCE(logo_url, cover_url, web_image_url) <> ''
    ORDER BY id`);

  const out = rows.map(r => {
    const src = r.logo_url || r.cover_url || r.web_image_url;
    return {
      id: r.id,
      name: r.name,
      where: [r.city, r.state].filter(Boolean).join(', '),
      src,
      field: r.logo_url ? 'logo_url' : r.cover_url ? 'cover_url' : 'web_image_url',
      // The exact test the component makes.
      treatedAsLogo: /logo/i.test(String(src || '')),
    };
  });

  const total = await db.get('SELECT COUNT(*) FILTER (WHERE visible = 1)::int AS n FROM stores');
  const dest = path.join(__dirname, '..', 'decisions', 'store_images.json');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(out, null, 2));

  console.log(`${out.length} of ${total.n} public listings show an image`);
  console.log(`  treated as a logo (cream backdrop): ${out.filter(x => x.treatedAsLogo).length}`);
  console.log(`  treated as a photo (near-black backdrop): ${out.filter(x => !x.treatedAsLogo).length}`);
  console.log(`written to ${dest}`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
