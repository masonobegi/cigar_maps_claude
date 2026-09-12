/**
 * Show a shop only when we can tell it is a cigar shop.
 *
 * The directory was built from map data that files a vape counter, a corner
 * store and a tobacconist under the same category, so the map filled up with
 * places that sell cigars the way a petrol station sells sandwiches. Mason's
 * rule: pure cigar and pipe-tobacco shops. Cigarettes on the side are fine,
 * everything else is somebody else's trade — and where we are not sure, the
 * listing stays off the map rather than making the site look like a junk
 * directory.
 *
 * So every public listing has to earn its place, from one of:
 *   - its name (X Cigars, Cigar Lounge, tobacconist, humidor, pipe shop, or a
 *     cigar chain we know);
 *   - its own website, read here, where cigars and pipe tobacco outweigh the
 *     vape, kratom, hookah and grocery words;
 *   - cigars already read off its own online shop (the menu scanner).
 *
 * Anything else is hidden as 'unproven', with the reason recorded, and comes
 * back the moment evidence arrives. Nothing is deleted.
 *
 *   node src/jobs/pureCigarCheck.js names --out names.json      # no network
 *   node src/jobs/pureCigarCheck.js read --from names.json --out evidence.jsonl
 *   node src/jobs/pureCigarCheck.js decide --from evidence.jsonl --out decisions.json
 *   node src/jobs/pureCigarCheck.js apply --from decisions.json --confirm
 */
'use strict';

const fs = require('fs');
const db = require('../database/db');
const { fetchUrl } = require('./webMenu');
const { pageText, candidateLinks } = require('./hoursSweep');

const WORKERS = 8;
const PAUSE_MS = 300;

// A name that says cigars on its own.
const CIGAR_NAME = /\b(cigars?|cigarr?os?|tobacconist|humidors?|stogies?|habanos?|habana|havana|puros?|cohiba|montecristo|tabac|tabaco|maduro|torpedo|robusto)\b/i;
// A pipe shop is in scope; a "pipe" on its own is a head shop or a plumber.
const PIPE_NAME = /\bpipe\s*(shop|shoppe|&|and)\s*(tobacco|cigar|smoke)?\b|\bpipes?\s+(and|&)\s+tobacco\b|\btobacco\s+(and|&)\s+pipes?\b/i;
// Shops whose own name is the trade, whatever the sign says.
const KNOWN_CHAIN = /\b(davidoff|casa\s+de\s+montecristo|jr\s+cigar|tinder\s?box|smoke\s+inn|corona\s+cigar|holt'?s|iwan\s+ries|nat\s+sherman|famous\s+smoke|cigars?\s+international|burn\s+by\s+rocky\s+patel|w\.?\s?curtis\s+draper|fox\s+cigar|anthony'?s\s+cigar|outland\s+cigar|maduro\s+cigar)\b/i;

// What a cigar shop's website is full of: the trade's own words and the brands
// it stocks.
const CIGAR_WORDS = /\b(cigars?|humidor|tobacconist|robusto|torpedo|belicoso|figurado|churchill|corona\s+gorda|maduro|connecticut\s+shade|habano|nicaraguan|dominican|pipe\s+tobacco|briar|latakia|perique|cutter|hygrometer|boveda|walk-?in\s+humidor|padr[oó]n|arturo\s+fuente|oliva|rocky\s+patel|my\s+father|drew\s+estate|ashton|montecristo|romeo\s+y\s+julieta|cohiba|perdomo|alec\s+bradley|macanudo|undercrown|liga\s+privada|opus\s?x|tatuaje|crowned\s+heads|foundation\s+cigar|plasencia|aganorsa|espinosa|caldwell|warped)\b/gi;
// What another trade's website is full of.
const OTHER_WORDS = /\b(vapes?|vaping|vapor|e-?liquid|e-?juice|salt\s?nic|disposable\s+vape|puff\s+bar|elf\s?bar|geek\s?bar|kratom|delta[- ]?8|delta[- ]?9|thca?|cbd|hemp|hookah|shisha|bongs?|water\s+pipes?|dab\s+rigs?|glass\s+pipes?|grinders?|rolling\s+papers?|lottery|money\s+order|western\s+union|check\s+cashing|groceries|deli|phone\s+repair|car\s+wash|ice\s+cream)\b/gi;

/** Does the name alone settle it? */
function nameVerdict(name) {
  const n = String(name || '');
  if (KNOWN_CHAIN.test(n)) return 'chain';
  if (CIGAR_NAME.test(n)) return 'name';
  if (PIPE_NAME.test(n)) return 'pipe';
  return null;
}

/** Count the trade words on a page. */
function score(text) {
  const cigar = (String(text).match(CIGAR_WORDS) || []).length;
  const other = (String(text).match(OTHER_WORDS) || []).length;
  return { cigar, other };
}

/**
 * Is this site a cigar shop's? Conservative on purpose: a handful of cigar
 * words is not a cigar shop, and a site that talks as much about vapes and
 * kratom is somebody else's trade.
 */
function siteVerdict({ cigar, other }) {
  if (cigar >= 5 && cigar >= other * 1.5) return { proven: true, why: `its site says cigars ${cigar} times against ${other} words from other trades` };
  if (cigar >= 12 && cigar > other) return { proven: true, why: `its site is mostly cigars (${cigar} against ${other})` };
  if (other > cigar) return { proven: false, why: `its site is mostly another trade (${other} such words against ${cigar} cigar words)` };
  return { proven: false, why: `its site says too little about cigars (${cigar} cigar words, ${other} from other trades)` };
}

/** Step 1: who is already proven, and who needs their website read. */
async function names({ out, log = console.log } = {}) {
  const rows = await db.all(`
    SELECT s.id, s.name, s.city, s.state, s.website, s.website_status, s.store_type, s.claimed, s.staff_edited,
      (SELECT COUNT(*) FROM inventory i JOIN cigars c ON c.id = i.cigar_id
        WHERE i.store_id = s.id AND c.source IS DISTINCT FROM 'retired')::int AS cigar_lines
    FROM stores s WHERE s.visible = 1 ORDER BY s.id`);
  const proven = [], toRead = [], noEvidence = [];
  for (const r of rows) {
    const why = nameVerdict(r.name);
    if (why) { proven.push({ ...r, how: why }); continue; }
    if (r.cigar_lines > 0) { proven.push({ ...r, how: 'stock' }); continue; }
    if (r.claimed || r.staff_edited) { proven.push({ ...r, how: 'claimed' }); continue; }
    if (r.website && ['ok', 'blocked'].includes(r.website_status || 'ok')) toRead.push(r);
    else noEvidence.push(r);
  }
  log(`${rows.length} public listings: ${proven.length} already prove themselves, ${toRead.length} have a site to read, ${noEvidence.length} have nothing to go on`);
  const byName = {};
  for (const p of proven) byName[p.how] = (byName[p.how] || 0) + 1;
  log(`  proven by: ${Object.entries(byName).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  if (out) fs.writeFileSync(out, JSON.stringify({ proven: proven.map(p => ({ id: p.id, how: p.how })), toRead, noEvidence }, null, 1));
  return { proven, toRead, noEvidence };
}

/** Step 2: read the sites of everyone who has one. Resumable. */
async function read({ from, out, log = console.log } = {}) {
  const { toRead } = JSON.parse(fs.readFileSync(from, 'utf8'));
  const done = new Set();
  if (fs.existsSync(out)) {
    for (const line of fs.readFileSync(out, 'utf8').split(String.fromCharCode(10))) {
      try { done.add(JSON.parse(line).id); } catch {}
    }
  }
  const queue = toRead.filter(r => !done.has(r.id));
  log(`${done.size} sites already read; reading ${queue.length} more with ${WORKERS} workers`);
  const stream = fs.createWriteStream(out, { flags: 'a' });
  let next = 0, finished = 0;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function worker() {
    while (next < queue.length) {
      const r = queue[next++];
      const site = /^https?:\/\//i.test(r.website) ? r.website : `https://${r.website}`;
      let text = '';
      try {
        const home = await fetchUrl(site, { accept: 'text/html' });
        if (home && home.status < 400 && home.body) {
          text += pageText(home.body);
          // One more page, where a shop lists what it carries.
          const links = candidateLinks(home.body, home.url || site)
            .filter(u => /brand|cigar|product|shop|about|humidor/i.test(u)).slice(0, 2);
          for (const u of links) {
            await sleep(PAUSE_MS);
            const p = await fetchUrl(u, { accept: 'text/html' });
            if (p && p.status < 400 && p.body) text += '\n' + pageText(p.body);
          }
        }
      } catch {}
      const counts = score(text.slice(0, 400000));
      stream.write(JSON.stringify({ id: r.id, ok: !!text, ...counts }) + String.fromCharCode(10));
      finished++;
      if (finished % 100 === 0) log(`  ${finished}/${queue.length} read`);
      await sleep(PAUSE_MS);
    }
  }
  await Promise.all(Array.from({ length: WORKERS }, worker));
  await new Promise(r => stream.end(r));
  log(`done: ${finished} sites read`);
}

/** Step 3: the verdicts, for review. */
async function decide({ from, names: namesFile, out, log = console.log } = {}) {
  const { toRead, noEvidence } = JSON.parse(fs.readFileSync(namesFile, 'utf8'));
  const byId = new Map([...toRead, ...noEvidence].map(r => [r.id, r]));
  const evidence = new Map();
  for (const line of fs.readFileSync(from, 'utf8').split(String.fromCharCode(10))) {
    if (!line.trim()) continue;
    try { const e = JSON.parse(line); evidence.set(e.id, e); } catch {}
  }
  const keep = [], hide = [];
  for (const r of toRead) {
    const e = evidence.get(r.id);
    if (!e || !e.ok) { hide.push({ ...r, reason: 'its website could not be read, and nothing else says it is a cigar shop' }); continue; }
    const v = siteVerdict(e);
    if (v.proven) keep.push({ id: r.id, name: r.name, why: v.why });
    else hide.push({ ...r, reason: v.why, cigar: e.cigar, other: e.other });
  }
  for (const r of noEvidence) hide.push({ ...r, reason: 'nothing on this listing says it is a cigar shop: no cigar name, no website to read, no stock' });
  log(`${keep.length} sites prove a cigar shop; ${hide.length} do not and would come off the map`);
  const why = {};
  for (const h of hide) { const k = h.reason.replace(/\d+/g, 'N').slice(0, 60); why[k] = (why[k] || 0) + 1; }
  for (const [k, n] of Object.entries(why).sort((a, b) => b[1] - a[1])) log(`  ${String(n).padStart(5)}  ${k}`);
  if (out) {
    fs.writeFileSync(out, JSON.stringify(hide.map(h => ({
      id: h.id, name: h.name, city: h.city, state: h.state, website: h.website,
      store_type: h.store_type, cigar: h.cigar ?? null, other: h.other ?? null, reason: h.reason,
    })), null, 1));
    fs.writeFileSync(out.replace(/\.json$/, '_keep.json'), JSON.stringify(keep, null, 1));
    log(`\nwritten to ${out}`);
  }
  return { keep, hide };
}

/** Step 4: hide the reviewed ones. Reversible: the verdict says why. */
async function apply(file, { log = console.log } = {}) {
  const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
  let hidden = 0;
  for (const r of rows) {
    const res = await db.run(`UPDATE stores SET visible = 0, storefront = 'unproven', storefront_reason = ?,
        storefront_checked_at = NOW()
      WHERE id = ? AND COALESCE(claimed, 0) = 0 AND COALESCE(staff_edited, 0) = 0`,
      [String(r.reason).slice(0, 300), r.id]);
    hidden += res.changes;
  }
  const left = await db.get('SELECT COUNT(*)::int AS n FROM stores WHERE visible = 1');
  log(`hid ${hidden} of ${rows.length} listings we cannot show to be cigar shops. ${left.n} remain public.`);
  return { hidden, remaining: left.n };
}

function selfTest() {
  let pass = 0, fail = 0;
  const ok = (c, l) => { if (c) pass++; else { fail++; console.log(`  FAIL ${l}`); } };
  ok(nameVerdict("Anthony's Cigar Emporium") === 'chain' || nameVerdict("Anthony's Cigar Emporium") === 'name', 'a cigar name proves itself');
  ok(nameVerdict('Havana House Cigars') === 'name', 'cigars in the name');
  ok(nameVerdict('Barclay-Rex Pipe Shop') === 'pipe', 'a pipe shop is in scope');
  ok(nameVerdict('Tobacco Outlet') === null, 'a tobacco outlet has to prove itself');
  ok(nameVerdict('Smoke Shop') === null, 'a smoke shop has to prove itself');
  ok(nameVerdict('Davidoff of Geneva') === 'chain', 'a cigar chain is known by name');
  ok(siteVerdict({ cigar: 30, other: 2 }).proven, 'a site full of cigar brands');
  ok(!siteVerdict({ cigar: 4, other: 0 }).proven, 'four mentions is not a cigar shop');
  ok(!siteVerdict({ cigar: 10, other: 25 }).proven, 'a vape site with a cigar shelf is not a cigar shop');
  ok(siteVerdict({ cigar: 20, other: 10 }).proven, 'a cigar shop that also sells vapes still counts');
  console.log(`pureCigarCheck self-test: ${pass} passed, ${fail} failed`);
  return fail === 0;
}

module.exports = { names, read, decide, apply, nameVerdict, siteVerdict, score };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const arg = n => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : null; };
  if (argv[0] === 'selftest') process.exit(selfTest() ? 0 : 1);
  (async () => {
    if (argv[0] === 'names') await names({ out: arg('--out') });
    else if (argv[0] === 'read') await read({ from: arg('--from'), out: arg('--out') });
    else if (argv[0] === 'decide') await decide({ from: arg('--from'), names: arg('--names'), out: arg('--out') });
    else if (argv[0] === 'apply' && argv.includes('--confirm')) await apply(arg('--from'));
    else console.error('usage: names | read | decide | apply --from <file> --confirm | selftest');
    process.exit(0);
  })().catch(err => { console.error(err); process.exit(1); });
}
