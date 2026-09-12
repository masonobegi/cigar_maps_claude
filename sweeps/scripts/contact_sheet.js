/**
 * Every public shop and how to reach it, as a spreadsheet.
 * Read-only; nothing here contacts anybody.
 */
const fs = require('fs');
const path = require('path');
const db = require('../../server/src/database/db');

const csv = v => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

(async () => {
  const rows = await db.all(`
    SELECT s.id, s.name, s.city, s.state, s.phone, s.website, s.hours_source, s.has_lounge,
           o.email, o.contact_url, o.facebook, o.instagram, o.sent_at
    FROM stores s LEFT JOIN store_outreach o ON o.store_id = s.id
    WHERE s.visible = 1
    ORDER BY s.state, s.city, s.name`);

  const best = r => r.email ? 'email' : r.contact_url ? 'contact form'
    : r.facebook ? 'facebook' : r.instagram ? 'instagram' : r.phone ? 'phone' : 'none';

  const header = ['id', 'name', 'city', 'state', 'best_route', 'email', 'contact_form', 'facebook',
    'instagram', 'phone', 'website', 'hours_verified', 'lounge', 'already_written_to'];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push([r.id, r.name, r.city, r.state, best(r), r.email, r.contact_url, r.facebook,
      r.instagram, r.phone, r.website, r.hours_source === 'website' ? 'yes' : '',
      Number(r.has_lounge) === 1 ? 'yes' : '', r.sent_at ? 'yes' : ''].map(csv).join(','));
  }

  const out = path.join(__dirname, '..', 'decisions', 'contact_sheet.csv');
  fs.writeFileSync(out, lines.join('\n'));
  console.log(`${rows.length} shops written to sweeps/decisions/contact_sheet.csv`);

  const by = {};
  for (const r of rows) by[best(r)] = (by[best(r)] || 0) + 1;
  console.log('best route per shop: ' + Object.entries(by).sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k} ${n}`).join(', '));

  const state = {};
  for (const r of rows.filter(r => r.email)) state[r.state] = (state[r.state] || 0) + 1;
  console.log('shops with an email, by state: ' + Object.entries(state).sort((a, b) => b[1] - a[1])
    .slice(0, 10).map(([k, n]) => `${k} ${n}`).join(', '));

  const tampa = rows.filter(r => /^tampa$/i.test(r.city || '') && r.state === 'FL');
  console.log(`\nTampa (${tampa.length} shops):`);
  for (const r of tampa) console.log(`   #${r.id} ${String(r.name).slice(0, 30).padEnd(32)} ${best(r).padEnd(13)} ${r.email || r.contact_url || r.facebook || r.phone || ''}`);
  process.exit(0);
})();
