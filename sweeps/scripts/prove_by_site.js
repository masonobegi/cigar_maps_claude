/**
 * Put every public listing through the site test, including the ones that
 * never had to take it.
 *
 * The pure-cigar check clears a listing on the first thing that works, and the
 * name is checked first — so "Central Cigars" was cleared without a word of its
 * website being read. That was the right economy when 7,431 listings needed
 * sorting and most had no readable site.
 *
 * It is the wrong economy now. Every listing still public has a live website
 * that has already been crawled twice — once for hours, once for amenities —
 * and both crawls kept the page text. So the strongest test can be run on all
 * of them for nothing, and the question "is this really a cigar shop" can be
 * answered by the shop rather than by its signage.
 *
 * Reports only. Writes nothing.
 *
 *   node sweeps/scripts/prove_by_site.js     (through prod.js)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const db = require('../../server/src/database/db');
const { score, siteVerdict, nameVerdict } = require('../../server/src/jobs/pureCigarCheck');

const SWEEPS = path.join(__dirname, '..');

function* jsonl(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { yield JSON.parse(line); } catch {}
  }
}

/**
 * The most page text we hold per listing, from every crawl that kept any.
 *
 * The hours crawl kept the lines around each "Hours" heading and the amenity
 * crawl kept whole-page text; neither is the entire site, but together they are
 * what the shop chose to put on its front and contact pages.
 */
function textById() {
  const byId = new Map();
  const add = (id, text) => {
    if (!id || !text) return;
    const prev = byId.get(id) || '';
    if (String(text).length > prev.length) byId.set(id, String(text));
  };

  for (const file of ['hours_evidence.jsonl', 'hours_evidence_v2.jsonl', 'render_full.jsonl', 'render_full_b.jsonl']) {
    for (const e of jsonl(path.join(SWEEPS, 'evidence', file))) {
      if (!e.id) continue;
      const parts = [];
      for (const t of e.text || []) if (t && t.lines) parts.push(t.lines.join(' '));
      for (const b of e.jsonld || []) parts.push(String(b));
      if (e.title) parts.push(e.title);
      add(e.id, parts.join(' '));
    }
  }
  for (const f of jsonl(path.join(SWEEPS, 'decisions', 'site-facts', 'facts.jsonl'))) {
    if (!f.id) continue;
    const parts = [f.lounge, f.walk_in, f.members, f.drive_thru, f.brands && JSON.stringify(f.brands), f.text]
      .filter(Boolean).map(String);
    add(f.id, parts.join(' '));
  }
  return byId;
}

(async () => {
  const texts = textById();
  const rows = await db.all(`
    SELECT id, name, city, state, website, store_type,
      (SELECT COUNT(*) FROM inventory i JOIN cigars c ON c.id = i.cigar_id
        WHERE i.store_id = stores.id AND c.source IS DISTINCT FROM 'retired')::int AS cigar_lines
    FROM stores WHERE visible = 1 ORDER BY id`);

  const tier = { proven: [], stock: [], thin: [], another: [], unread: [] };
  for (const r of rows) {
    const text = texts.get(r.id);
    if (!text || text.length < 40) { tier.unread.push({ ...r, why: 'no page text saved for it' }); continue; }
    const counts = score(text);
    const v = siteVerdict(counts);
    const row = { ...r, ...counts, why: v.why };
    if (v.proven) tier.proven.push(row);
    else if (r.cigar_lines > 0) tier.stock.push({ ...row, why: `${r.cigar_lines} cigar lines on its own web shop` });
    else if (counts.other > counts.cigar) tier.another.push(row);
    else tier.thin.push(row);
  }

  const n = rows.length;
  const pct = x => `${((100 * x) / n).toFixed(1)}%`;
  console.log(`${n} public listings, judged on the text their own sites publish:\n`);
  console.log(`  its own site proves it:              ${String(tier.proven.length).padStart(4)}  ${pct(tier.proven.length)}`);
  console.log(`  cigar stock on its web shop:         ${String(tier.stock.length).padStart(4)}  ${pct(tier.stock.length)}`);
  console.log(`  says little either way:              ${String(tier.thin.length).padStart(4)}  ${pct(tier.thin.length)}`);
  console.log(`  says MORE about another trade:       ${String(tier.another.length).padStart(4)}  ${pct(tier.another.length)}`);
  console.log(`  no page text saved:                  ${String(tier.unread.length).padStart(4)}  ${pct(tier.unread.length)}`);

  const show = (label, list, k = 15) => {
    if (!list.length) return;
    console.log(`\n${label} (${list.length}):`);
    for (const r of list.slice(0, k)) {
      console.log(`   #${String(r.id).padEnd(6)}${String(r.name).slice(0, 32).padEnd(34)}${String(r.city || '').slice(0, 13).padEnd(14)}cigar ${String(r.cigar).padStart(3)}  other ${String(r.other).padStart(3)}`);
    }
    if (list.length > k) console.log(`   … and ${list.length - k} more`);
  };
  show('SAYS MORE ABOUT ANOTHER TRADE — the ones worth arguing about', tier.another, 25);
  show('says little either way', tier.thin, 15);
  show('no page text saved', tier.unread, 10);

  fs.writeFileSync(path.join(SWEEPS, 'decisions', 'proved_by_site.json'), JSON.stringify({
    note: 'Every public listing scored on the text its own website publishes.',
    counts: Object.fromEntries(Object.entries(tier).map(([k, v]) => [k, v.length])),
    another_trade: tier.another, thin: tier.thin, unread: tier.unread,
  }, null, 1));
  console.log('\nwritten to sweeps/decisions/proved_by_site.json');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
