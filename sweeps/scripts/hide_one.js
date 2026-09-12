const db = require('../../server/src/database/db');
(async () => {
  const id = Number(process.env.ID);
  const reason = process.env.REASON;
  const s = await db.get('SELECT id, name, visible, claimed, staff_edited FROM stores WHERE id = ?', [id]);
  if (!s) { console.log('gone'); process.exit(0); }
  if (Number(s.claimed) === 1 || Number(s.staff_edited) === 1) { console.log('claimed or staff-edited, left alone'); process.exit(0); }
  const r = await db.run(`UPDATE stores SET visible = 0, storefront = 'not_retail', storefront_reason = ?,
    storefront_checked_at = NOW() WHERE id = ? AND visible = 1`, [reason.slice(0, 300), id]);
  console.log(`#${s.id} ${s.name}: ${r.changes ? 'hidden' : 'already hidden'} — ${reason}`);
  const n = await db.get('SELECT COUNT(*) FILTER (WHERE visible = 1)::int AS n FROM stores');
  console.log(`${n.n} public listings`);
  process.exit(0);
})();
