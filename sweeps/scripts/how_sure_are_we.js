/**
 * Of the shops now public, how many does their own website actually prove?
 *
 * They survived the pure-cigar check, but that check clears a listing on any of
 * three things: a name that can only be a cigar shop, cigar stock read from its
 * own web shop, or the word counts on its site. A name is the weakest of the
 * three — "Smoke Shop" clears nothing, but "Ye Olde Cigar Shoppe" clears on the
 * name alone without anybody reading a word of the site.
 *
 * Every one of these listings now has a readable website, which is what makes
 * this worth asking: the evidence exists for all of them, so the question is
 * only whether it was ever consulted.
 *
 *   node sweeps/scripts/how_sure_are_we.js     (through prod.js)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const db = require('../../server/src/database/db');
const { siteVerdict, nameVerdict } = require('../../server/src/jobs/pureCigarCheck');

const SWEEPS = path.join(__dirname, '..');

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  const out = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch {}
  }
  return out;
}

/** Word counts per listing from whichever pass read its site last. */
function siteCounts() {
  const byId = new Map();
  for (const f of ['pure_evidence.jsonl', 'pure_evidence_all.jsonl', 'pure_evidence_rendered.jsonl']) {
    for (const e of readJsonl(path.join(SWEEPS, 'decisions', f))) {
      const prev = byId.get(e.id);
      if (!prev || (e.ok && !prev.ok) || e.ok === prev.ok) byId.set(e.id, e);
    }
  }
  return byId;
}

(async () => {
  const counts = siteCounts();
  const rows = await db.all(`
    SELECT s.id, s.name, s.city, s.state, s.website, s.storefront, s.storefront_reason, s.store_type,
      (SELECT COUNT(*) FROM inventory i JOIN cigars c ON c.id = i.cigar_id
        WHERE i.store_id = s.id AND c.source IS DISTINCT FROM 'retired')::int AS cigar_lines
    FROM stores s WHERE s.visible = 1 ORDER BY s.id`);

  const groups = { site: [], stock: [], name: [], nothing: [], contradicted: [] };
  for (const r of rows) {
    const e = counts.get(r.id);
    const v = e && e.ok ? siteVerdict({ cigar: Number(e.cigar) || 0, other: Number(e.other) || 0 }) : null;
    if (v && v.proven) { groups.site.push({ ...r, why: v.why }); continue; }
    if (r.cigar_lines > 0) { groups.stock.push({ ...r, why: `${r.cigar_lines} cigar lines on its own web shop` }); continue; }
    // Its site was read and did NOT clear the bar — the weakest position of all,
    // because the evidence exists and says no.
    if (v && !v.proven) { groups.contradicted.push({ ...r, why: v.why }); continue; }
    if (nameVerdict(r.name)) { groups.name.push({ ...r, why: `its name: ${nameVerdict(r.name)}` }); continue; }
    groups.nothing.push(r);
  }

  console.log(`${rows.length} public listings\n`);
  console.log(`  its own site proves it:        ${groups.site.length}`);
  console.log(`  cigar stock on its web shop:   ${groups.stock.length}`);
  console.log(`  only its name says so:         ${groups.name.length}`);
  console.log(`  its site was read and did not: ${groups.contradicted.length}`);
  console.log(`  nothing either way:            ${groups.nothing.length}`);

  const show = (label, list, n = 12) => {
    if (!list.length) return;
    console.log(`\n${label}:`);
    for (const r of list.slice(0, n)) {
      console.log(`   #${String(r.id).padEnd(6)}${String(r.name).slice(0, 34).padEnd(36)}${String(r.city || '').slice(0, 14).padEnd(15)}${String(r.why || '').slice(0, 62)}`);
    }
    if (list.length > n) console.log(`   … and ${list.length - n} more`);
  };
  show('read and NOT cleared by its own site', groups.contradicted, 20);
  show('cleared on the name alone', groups.name, 15);
  show('nothing either way', groups.nothing, 10);

  fs.writeFileSync(path.join(SWEEPS, 'decisions', 'certainty_tiers.json'),
    JSON.stringify({
      note: 'How each public listing proves it is a cigar shop.',
      counts: Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.length])),
      contradicted: groups.contradicted, name_only: groups.name, nothing: groups.nothing,
    }, null, 1));
  console.log('\nwritten to sweeps/decisions/certainty_tiers.json');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
