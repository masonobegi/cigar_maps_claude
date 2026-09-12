/**
 * What a shop says about itself: a lounge, a walk-in humidor, members only,
 * and the brands it carries.
 *
 * The Lounge badge is the one a smoker scans for, and today it mostly comes
 * from a map category: 1,813 listings carry it, plenty of them from Overture's
 * "cigar_bar" alone, while shops whose own site describes a lounge do not have
 * it. A walk-in humidor is flagged on 74 listings, all from their names.
 *
 * So the shop's own website decides, and the sentence it decided on is kept
 * with the verdict. A badge is added only on a plain statement, and removed
 * only when the site is readable, names the shop, and never mentions a lounge.
 *
 *   node src/jobs/siteFacts.js read   --out facts.jsonl
 *   node src/jobs/siteFacts.js decide --from facts.jsonl --out decisions.json
 *   node src/jobs/siteFacts.js apply  --from decisions.json --confirm
 */
'use strict';

const fs = require('fs');
const db = require('../database/db');
const { fetchUrl } = require('./webMenu');
const { pageText, candidateLinks, NOT_THE_SHOPS_SITE } = require('./hoursSweep');
const { hostOf } = require('./chainCheck');
const { writeFields } = require('../utils/storeEdits');

const WORKERS = 8;
const PAUSE_MS = 300;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// A room to sit and smoke in, said plainly.
const LOUNGE = /\b(cigar\s+lounge|smoking\s+lounge|smoke\s+lounge|lounge\s+(area|seating|room)|members?\s+lounge|sit\s+(back\s+)?and\s+(smoke|enjoy)|comfortable\s+(seating|chairs|leather)|smoking\s+(room|patio)|byob)\b/i;
const WALK_IN = /\bwalk[- ]?in\s+humidor\b|\bwalk[- ]?in\s+(cigar\s+)?(room|vault)\b/i;
const MEMBERS = /\b(members?\s*(-|\s)?only|membership\s+(is\s+)?(required|available|includes)|private\s+club|personal\s+lockers?|locker\s+(rental|program)|annual\s+dues)\b/i;
const DRIVE_THRU = /\bdrive[- ]?thr(u|ough)\b/i;

/** The sentence a verdict rests on, so a person can check it. */
function quote(text, re) {
  for (const line of String(text).split('\n')) {
    if (re.test(line)) return line.trim().slice(0, 200);
  }
  return null;
}

/** Does this page speak for this shop? Its name, in whole words. */
function namesShop(text, store) {
  const words = String(store.name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ')
    .filter(w => w.length > 3 && !['cigar', 'cigars', 'tobacco', 'lounge', 'shop', 'smoke', 'house', 'company', 'club'].includes(w));
  if (!words.length) return true;
  const hay = ` ${String(text).toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
  return words.some(w => hay.includes(` ${w} `));
}

async function read({ out, log = console.log } = {}) {
  const rows = await db.all(`SELECT id, name, website, has_lounge, has_walk_in_humidor, store_type
    FROM stores WHERE visible = 1 AND website IS NOT NULL AND website <> ''
      AND COALESCE(website_status, 'ok') IN ('ok', 'blocked') ORDER BY id`);
  const todo = rows.filter(r => !NOT_THE_SHOPS_SITE.test(hostOf(r.website)));
  const done = new Set();
  if (fs.existsSync(out)) {
    for (const line of fs.readFileSync(out, 'utf8').split(String.fromCharCode(10))) {
      try { done.add(JSON.parse(line).id); } catch {}
    }
  }
  const queue = todo.filter(r => !done.has(r.id));
  log(`${done.size} already read; reading ${queue.length} shop websites with ${WORKERS} workers`);
  const stream = fs.createWriteStream(out, { flags: 'a' });
  let next = 0, finished = 0;
  async function worker() {
    while (next < queue.length) {
      const r = queue[next++];
      const site = /^https?:\/\//i.test(r.website) ? r.website : `https://${r.website}`;
      let text = '';
      try {
        const home = await fetchUrl(site, { accept: 'text/html' });
        if (home && home.status < 400 && home.body) {
          text += pageText(home.body);
          const links = candidateLinks(home.body, home.url || site)
            .filter(u => /about|lounge|member|amenit|visit|club/i.test(u)).slice(0, 2);
          for (const u of links) {
            await sleep(PAUSE_MS);
            const p = await fetchUrl(u, { accept: 'text/html' });
            if (p && p.status < 400 && p.body) text += '\n' + pageText(p.body);
          }
        }
      } catch {}
      stream.write(JSON.stringify({
        id: r.id,
        ok: !!text,
        names_shop: text ? namesShop(text, r) : false,
        lounge: quote(text, LOUNGE),
        walk_in: quote(text, WALK_IN),
        members: quote(text, MEMBERS),
        drive_thru: quote(text, DRIVE_THRU),
      }) + String.fromCharCode(10));
      finished++;
      if (finished % 200 === 0) log(`  ${finished}/${queue.length} read`);
      await sleep(PAUSE_MS);
    }
  }
  await Promise.all(Array.from({ length: WORKERS }, worker));
  await new Promise(r => stream.end(r));
  log(`done: ${finished} sites read`);
}

async function decide({ from, out, log = console.log } = {}) {
  const facts = new Map();
  for (const line of fs.readFileSync(from, 'utf8').split(String.fromCharCode(10))) {
    if (!line.trim()) continue;
    try { const f = JSON.parse(line); facts.set(f.id, f); } catch {}
  }
  const rows = await db.all(`SELECT id, name, city, state, website, has_lounge, has_walk_in_humidor, store_type
    FROM stores WHERE visible = 1 AND COALESCE(claimed, 0) = 0 AND COALESCE(staff_edited, 0) = 0`);
  const add = [], remove = [], humidor = [], members = [], driveThru = [];
  for (const r of rows) {
    const f = facts.get(r.id);
    if (!f || !f.ok) continue;
    if (f.lounge && r.has_lounge !== 1) add.push({ id: r.id, name: r.name, city: r.city, state: r.state, field: 'has_lounge', value: 1, evidence: f.lounge });
    // Taking a badge off needs the site to be this shop's and to say nothing
    // about a lounge anywhere: a quiet page is not proof on its own.
    if (!f.lounge && r.has_lounge === 1 && f.names_shop && r.store_type !== 'cigar_lounge') {
      remove.push({ id: r.id, name: r.name, city: r.city, state: r.state, field: 'has_lounge', value: 0, evidence: 'its own site describes no lounge', website: r.website });
    }
    if (f.walk_in && r.has_walk_in_humidor !== 1) humidor.push({ id: r.id, name: r.name, city: r.city, state: r.state, field: 'has_walk_in_humidor', value: 1, evidence: f.walk_in });
    if (f.members) members.push({ id: r.id, name: r.name, city: r.city, evidence: f.members });
    if (f.drive_thru) driveThru.push({ id: r.id, name: r.name, city: r.city, evidence: f.drive_thru });
  }
  log(`lounge badges to add: ${add.length}; to take off: ${remove.length}; walk-in humidors to add: ${humidor.length}`);
  log(`members-only: ${members.length}; drive-thru: ${driveThru.length}`);
  if (out) {
    fs.writeFileSync(out, JSON.stringify({ add, remove, humidor, members, driveThru }, null, 1));
    log(`written to ${out}`);
  }
  return { add, remove, humidor, members, driveThru };
}

async function apply(file, { log = console.log } = {}) {
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));
  let n = 0;
  for (const group of [d.add || [], d.remove || [], d.humidor || []]) {
    for (const x of group) {
      const written = await writeFields(x.id, { [x.field]: x.value }, {
        source: 'website', job: 'siteFacts', reason: String(x.evidence).slice(0, 300),
      });
      n += written.length;
    }
  }
  log(`wrote ${n} badges from the shops' own websites`);
  return { written: n };
}

module.exports = { read, decide, apply, quote, namesShop, LOUNGE, WALK_IN, MEMBERS };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const arg = n => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : null; };
  (async () => {
    if (argv[0] === 'read') await read({ out: arg('--out') });
    else if (argv[0] === 'decide') await decide({ from: arg('--from'), out: arg('--out') });
    else if (argv[0] === 'apply' && argv.includes('--confirm')) await apply(arg('--from'));
    else console.error('usage: read --out facts.jsonl | decide --from facts.jsonl --out decisions.json | apply --from decisions.json --confirm');
    process.exit(0);
  })().catch(err => { console.error(err); process.exit(1); });
}
