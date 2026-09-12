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
 *   node src/jobs/siteFacts.js read   --out facts.jsonl [--redo-truncated]
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

/**
 * The sentence a verdict rests on, so a person can check it.
 *
 * This used to keep the first 200 characters of the matching LINE, and a line
 * off a web page is often a whole paragraph — so for 47 of the 1,343 sites
 * already crawled, the words that actually matched were cut off the end and the
 * stored "evidence" does not contain them. It now keeps the matching sentence
 * itself, with a little of what surrounds it, so the quote always contains the
 * reason it is there.
 */
function quote(text, re) {
  for (const line of String(text).split('\n')) {
    if (!re.test(line)) continue;
    const parts = sentences(line);
    const hit = parts.find(x => re.test(x));
    if (!hit) return line.trim().slice(0, 200);
    // The neighbouring sentence is worth keeping: "Our lounge is open late" reads
    // very differently under "We are closing in March".
    const i = parts.indexOf(hit);
    const around = [parts[i - 1], hit, parts[i + 1]].filter(Boolean).join(' ');
    return (around.length <= 300 ? around : hit).trim().slice(0, 300);
  }
  return null;
}

/**
 * The kept quote is a line off a page, and a line is often several sentences.
 * The badge has to rest on one sentence, not on a paragraph that happens to
 * contain the word somewhere — Padre Island Cigar Company's page says "does not
 * have a lounge" and then recommends somebody else's.
 */
function sentences(text) {
  return String(text || '')
    .split(/(?<=[.!?\u2022|])\s+|\s+[\u2013\u2014]\s+|\n/)
    .map(x => x.trim())
    .filter(Boolean);
}

/**
 * "We do not have a lounge." A regex that only looks for the word finds this
 * and reads it backwards.
 */
const NEGATED = /\b(do(es)?\s+not\s+have|do\s?n[o']t\s+have|is\s+not\s+a|are\s+not\s+a|no\s+(cigar\s+|smoking\s+|indoor\s+)?(lounge|humidor|seating)|not\s+a\s+(cigar\s+)?lounge|without\s+a\s+(lounge|humidor)|we\s+have\s+no\b|unfortunately[^.]*\b(lounge|humidor)|coming\s+soon|closed\s+(our|the)\s+lounge|no\s+membership\s+(is\s+)?(required|needed)|membership\s+(is\s+)?not\s+required|no\s+(annual\s+)?dues)/i;

/**
 * Somebody else's lounge. Shop biographies are full of them: "took a retail job
 * in a cigar lounge", "was instrumental in the opening of Burn by Rocky Patel",
 * "we recommend Prohibition Private Cigar Lounge". None of those say this shop
 * has one.
 */
const THIRD_PARTY = /\b(we\s+recommend|recommend(ed)?\s+(you|visiting)|took\s+a\s+(retail\s+)?job|worked?\s+(at|in|for)\s+a|working\s+(at|in)\s+a|opening\s+of\s+[\u2018\u2019'"]|his\s+career|her\s+career|their\s+career|before\s+joining|previously\s+(at|owned)|visit\s+our\s+friends|sister\s+(store|shop|location)|franchise\s+opportunit)/i;

/**
 * Not a claim about this shop: a question put to the reader, or an article
 * headline about lounges in general. "Do you love to smoke a fine cigar but
 * have never visited a cigar lounge?" and "THREE THINGS TO NEVER DO IN A CIGAR
 * LOUNGE" both name a lounge and neither says this shop has one.
 */
const NOT_A_CLAIM = /\?\s*$|^\s*(do|does|did|have|has|are|is|can|could|would|will|why|what|when|where|how)\b[^.!]*\?|\b(things?\s+to\s+(never|always)|guide\s+to|what\s+is\s+a|why\s+you\s+should)\b/i;

/**
 * The weaker half of the members test. "Private club", "lockers" and "dues"
 * turn up in prose that is not about this shop at all — Rts Cigars writes that
 * "the lounge descends from the Cuban tobacconist counter, the private club
 * smoking room, and the neighbourhood shop", which is a history of the trade.
 * So those three only count in the shop's own voice; "members only" and
 * "membership is required" stand on their own.
 */
const MEMBERS_WEAK = /\b(private\s+club|personal\s+lockers?|locker\s+(rental|program)|annual\s+dues)\b/i;
const OWN_VOICE = /\b(our|we|us|your|you|join|book|reserve|enquire|inquire|sign\s+up)\b/i;

/**
 * A verdict has to rest on a sentence that says this shop has the thing, in its
 * own voice. Returns that sentence, or null.
 */
function plainStatement(quoted, re) {
  const parts = sentences(quoted);
  // A quote with no sentence break at all is one statement; judge it whole.
  const candidates = parts.length ? parts : [String(quoted || '')];
  for (const sentence of candidates) {
    if (!re.test(sentence)) continue;
    if (NEGATED.test(sentence)) continue;
    if (THIRD_PARTY.test(sentence)) continue;
    if (NOT_A_CLAIM.test(sentence)) continue;
    // "private club", "lockers", "dues": only in the shop's own voice.
    if (re === MEMBERS && MEMBERS_WEAK.test(sentence) && !/(members?\s*(-|\s)?only|membership)/i.test(sentence)
        && !OWN_VOICE.test(sentence)) continue;
    return sentence.slice(0, 200);
  }
  return null;
}

/**
 * Why a saved quote produced no statement. Three different things, and only one
 * of them is a false positive:
 *
 *   'refused'   a matching sentence that is negative or about somebody else
 *   'truncated' no matching sentence at all, because the old quote() cut the
 *               line at 200 characters and the match was past the cut. The site
 *               has to be read again; nothing can be concluded from this.
 *   null        there was no quote to begin with
 */
function whyNoStatement(quoted, re) {
  if (!quoted) return null;
  const parts = sentences(quoted);
  const candidates = parts.length ? parts : [String(quoted)];
  return candidates.some(x => re.test(x)) ? 'refused' : 'truncated';
}

/** Does this page speak for this shop? Its name, in whole words. */
function namesShop(text, store) {
  const words = String(store.name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ')
    .filter(w => w.length > 3 && !['cigar', 'cigars', 'tobacco', 'lounge', 'shop', 'smoke', 'house', 'company', 'club'].includes(w));
  if (!words.length) return true;
  const hay = ` ${String(text).toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
  return words.some(w => hay.includes(` ${w} `));
}

async function read({ out, redoTruncated = false, log = console.log } = {}) {
  const rows = await db.all(`SELECT id, name, website, has_lounge, has_walk_in_humidor, store_type
    FROM stores WHERE visible = 1 AND website IS NOT NULL AND website <> ''
      AND COALESCE(website_status, 'ok') IN ('ok', 'blocked') ORDER BY id`);
  const todo = rows.filter(r => !NOT_THE_SHOPS_SITE.test(hostOf(r.website)));
  const done = new Set();
  if (fs.existsSync(out)) {
    for (const line of fs.readFileSync(out, 'utf8').split(String.fromCharCode(10))) {
      try {
        const f = JSON.parse(line);
        // A record whose quote was cut before the words that matched it has to
        // be read again, so it does not count as done. --redo-truncated, and
        // not by default, because a re-read costs a request to the shop.
        if (redoTruncated && f.ok && [['lounge', LOUNGE], ['walk_in', WALK_IN], ['members', MEMBERS], ['drive_thru', DRIVE_THRU]]
          .some(([k, re]) => f[k] && whyNoStatement(f[k], re) === 'truncated')) continue;
        done.add(f.id);
      } catch {}
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
  const rows = await db.all(`SELECT id, name, city, state, website, website_status, has_lounge,
      has_walk_in_humidor, store_type, tags
    FROM stores WHERE visible = 1 AND COALESCE(claimed, 0) = 0 AND COALESCE(staff_edited, 0) = 0`);
  const add = [], remove = [], humidor = [], members = [], driveThru = [];
  const categoryOnly = [], refused = [], reread = [];

  for (const r of rows) {
    const f = facts.get(r.id);

    // A badge on the public map with no sentence behind it and no reading of
    // the shop's own site is resting on a map category alone. Those are what a
    // person still has to accept or reject, and there is no honest way to
    // settle them from here — so they are listed, not guessed at.
    if (r.has_lounge === 1 && (!f || !f.ok)) {
      categoryOnly.push({
        id: r.id, name: r.name, city: r.city, state: r.state, field: 'has_lounge',
        website: r.website || null, website_status: r.website_status || null,
        why: !f ? 'its website has not been read yet'
          : 'its website could not be read',
        // The category the badge came from: cigar_lounge, the word "lounge" in
        // the name, or an OSM lounge=yes tag (see jobs/osm.js).
        from_category: r.store_type === 'cigar_lounge' ? 'store_type is cigar_lounge'
          : /lounge/i.test(r.name || '') ? 'the word "lounge" is in its name'
            : 'a map tag',
      });
    }
    if (r.has_walk_in_humidor === 1 && (!f || !f.ok)) {
      categoryOnly.push({
        id: r.id, name: r.name, city: r.city, state: r.state, field: 'has_walk_in_humidor',
        website: r.website || null, website_status: r.website_status || null,
        why: !f ? 'its website has not been read yet' : 'its website could not be read',
        from_category: 'its name',
      });
    }
    if (!f || !f.ok) continue;

    // Every verdict is re-read at the sentence it rests on. The crawl's own
    // regex matched a line, and a line is often a paragraph: one page says the
    // shop "does not have a lounge" and then recommends somebody else's, and
    // three more are biographies about a lounge the owner once worked in.
    const loungeSentence = plainStatement(f.lounge, LOUNGE);
    const humidorSentence = plainStatement(f.walk_in, WALK_IN);
    const membersSentence = plainStatement(f.members, MEMBERS);
    const driveSentence = plainStatement(f.drive_thru, DRIVE_THRU);

    for (const [quoted, sentence, re, field] of [
      [f.lounge, loungeSentence, LOUNGE, 'has_lounge'],
      [f.walk_in, humidorSentence, WALK_IN, 'has_walk_in_humidor'],
      [f.members, membersSentence, MEMBERS, 'members_only'],
      [f.drive_thru, driveSentence, DRIVE_THRU, 'drive_thru'],
    ]) {
      if (!quoted || sentence) continue;
      const why = whyNoStatement(quoted, re);
      const row = { id: r.id, name: r.name, field, quote: quoted };
      if (why === 'refused') {
        refused.push({ ...row, why: "the sentence is negative, or about somebody else's" });
      } else {
        // The old quote() kept 200 characters of the matching LINE, and a line
        // off a web page is often a paragraph — so the words that matched can be
        // past the cut. Nothing can be concluded from these; the site has to be
        // read again, with the quote() that keeps the matching sentence.
        reread.push({ ...row, why: 'the saved quote was cut before the words that matched it' });
      }
    }

    if (loungeSentence && r.has_lounge !== 1) {
      add.push({ id: r.id, name: r.name, city: r.city, state: r.state, field: 'has_lounge', value: 1, evidence: loungeSentence });
    }
    // Taking a badge off needs the site to be this shop's and to say nothing
    // about a lounge anywhere: a quiet page is not proof on its own. A refused
    // sentence does not count as silence either — the site did mention a
    // lounge, we simply could not tell whose.
    if (!f.lounge && r.has_lounge === 1 && f.names_shop && r.store_type !== 'cigar_lounge') {
      remove.push({ id: r.id, name: r.name, city: r.city, state: r.state, field: 'has_lounge', value: 0, evidence: 'its own site describes no lounge', website: r.website });
    }
    if (humidorSentence && r.has_walk_in_humidor !== 1) {
      humidor.push({ id: r.id, name: r.name, city: r.city, state: r.state, field: 'has_walk_in_humidor', value: 1, evidence: humidorSentence });
    }
    if (membersSentence) members.push({ id: r.id, name: r.name, city: r.city, evidence: membersSentence });
    if (driveSentence) driveThru.push({ id: r.id, name: r.name, city: r.city, evidence: driveSentence });
  }

  log(`lounge badges to add: ${add.length}; to take off: ${remove.length}; walk-in humidors to add: ${humidor.length}`);
  log(`members-only: ${members.length}; drive-thru: ${driveThru.length}`);
  log(`sentences refused on a second reading: ${refused.length}`);
  log(`sites to read again (the saved quote was cut short): ${reread.length}`);
  log(`badges still resting on a map category, for a person to accept: ${categoryOnly.length}`);
  if (out) {
    fs.writeFileSync(out, JSON.stringify({ add, remove, humidor, members, driveThru, refused, reread, categoryOnly }, null, 1));
    log(`written to ${out}`);
  }
  return { add, remove, humidor, members, driveThru, refused, reread, categoryOnly };
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

module.exports = { read, decide, apply, quote, sentences, plainStatement, namesShop,
  whyNoStatement, LOUNGE, WALK_IN, MEMBERS, DRIVE_THRU, NEGATED, THIRD_PARTY, selftest };

// ── self-test ───────────────────────────────────────────────────────────────
// Every "REFUSE" case below is a real sentence from the saved crawl
// (sweeps/decisions/site-facts/facts.jsonl), not an invented one.
function selftest() {
  let pass = 0, fail = 0;
  const ok = (cond, label, extra) => {
    if (cond) { pass++; console.log(`  ok   ${label}`); }
    else { fail++; console.log(`  FAIL ${label}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ''}`); }
  };

  const keeps = (q, re) => !!plainStatement(q, re);

  // The one that matters most: a shop whose own site says it has no lounge.
  ok(!keeps('Padre Island Cigar Company does not have a lounge. We do have an outdoor patio available. We recommend Prohibition Private Cigar Lounge. Memberships,', LOUNGE),
    'a shop that says it does not have a lounge does not get a lounge badge');

  // Biographies about somebody else's lounge.
  ok(!keeps('occasional cigar smoker, took a retail job in a cigar lounge,', LOUNGE),
    'a job the owner once had in a cigar lounge is not this shop having one');
  ok(!keeps('In 2010 Rich became a partner, found the location, and was instrumental in the opening of \u2018Burn by Rocky Patel\u2019 a new evolution of the luxury cigar lounge', LOUNGE),
    "and neither is the opening of somebody else's lounge");
  ok(!keeps('We recommend Prohibition Private Cigar Lounge.', LOUNGE),
    'nor a recommendation to go somewhere else');
  ok(!keeps('Visit our friends at the cigar lounge down the road.', LOUNGE), 'nor a lounge down the road');

  // Real evidence, from the same file, which must survive.
  for (const q of [
    "Join Corpus Christi's only Private & Exclusive Cigar Lounge.",
    'Clearwater Beach Cigar Lounge',
    'Cigar Society | Premium Cigar Lounge & Shop in Pharr (Lower Rio Grande Valley)',
    'Your Local St. Pete Cigar Shop & Cigar Lounge',
    'BYOB Lounge with Glass, Ice, and Mixer setups.',
    'Featuring two televisions, comfortable chairs and free WiFi.',
    'Throughout the shop and on the covered patio you will find comfortable seating where you can sit back, relax, and indulge',
  ]) ok(keeps(q, LOUNGE), `kept: "${q.slice(0, 60)}"`);

  // A paragraph where the negative and the positive sit side by side: the
  // badge rests on a sentence, so the negative one cannot be read past.
  ok(!keeps('Our shop does not have a lounge.', LOUNGE), 'a plain refusal is read as a refusal');
  ok(keeps('We are not a bar. Our cigar lounge seats twenty.', LOUNGE),
    'but a negative about something else does not veto a real statement');

  // Walk-in humidors, the same treatment.
  ok(keeps('Step into our walk-in humidor, stocked with over 400 facings.', WALK_IN), 'a walk-in humidor is a walk-in humidor');
  ok(!keeps('We do not have a walk-in humidor.', WALK_IN), 'and a shop that says it has none does not get the badge');
  ok(!keeps('He worked at a shop with a walk-in humidor before opening this one.', WALK_IN),
    "nor one that describes somebody else's");

  // Sentence splitting, which all of the above rests on.
  ok(sentences('One. Two! Three?').length === 3, 'sentences split on full stops', sentences('One. Two! Three?'));
  ok(sentences('Cigar Lounge \u2014 open late').length === 2, 'and on an em dash, which pages use as a full stop');
  ok(sentences('').length === 0, 'and nothing splits into nothing');
  ok(plainStatement('Cigar Lounge', LOUNGE) === 'Cigar Lounge', 'a quote with no sentence break is judged whole');
  // A question and a headline both name a lounge without claiming one. Both
  // were in the first real run's output: Destination Cigars asking "have you
  // never visited a cigar lounge?" and His and Hers Cigars' article "THREE
  // THINGS TO NEVER DO IN A CIGAR LOUNGE".
  ok(!plainStatement('Do you love a fine cigar but have never visited a cigar lounge?', LOUNGE),
    'a question put to the reader is not a claim about this shop');
  ok(!plainStatement('THREE THINGS TO NEVER DO IN A CIGAR LOUNGE', LOUNGE),
    'nor is an article headline about lounges in general');
  ok(!plainStatement('No membership required just bring your appreciation for the finer things.', MEMBERS),
    '"no membership required" is not a members-only shop');
  ok(!plainStatement('The lounge descends from the Cuban tobacconist counter, the private club smoking room, and the neighborhood shop.', MEMBERS),
    'a history of the trade that mentions a private club is not this shop’s membership');
  ok(plainStatement('Members of our private club have their own lockers.', MEMBERS),
    'but the same words in the shop’s own voice still count');
  ok(plainStatement('Membership is required only for access to the exclusive back lounge.', MEMBERS),
    'and "membership is required" stands on its own');
  ok(plainStatement('Enjoy your smoke in our well appointed smoking lounge.', LOUNGE),
    'but a plain statement still passes');
  ok(plainStatement(null, LOUNGE) === null, 'and a missing quote is null, not a crash');

  // "Coming soon" is a promise, not a lounge.
  ok(!keeps('Our new cigar lounge is coming soon!', LOUNGE), 'a lounge that is coming soon is not a lounge yet');

  // Two very different reasons a saved quote yields no statement. Reading them
  // as one would turn 65 unfinished reads into 65 badge removals.
  // The real quote, in full: the words that matched are in the recommendation
  // ("Prohibition Private Cigar Lounge"), and that sentence is somebody else's.
  ok(whyNoStatement('Padre Island Cigar Company does not have a lounge. We do have an outdoor patio available. We recommend Prohibition Private Cigar Lounge.', LOUNGE) === 'refused',
    "a quote whose only match is somebody else's lounge is a refusal");
  ok(whyNoStatement('We have no cigar lounge here.', LOUNGE) === 'refused',
    'and so is a plain denial that uses the words');
  ok(whyNoStatement('Our lounge and patio are excellent places to enjoy your time with us.', LOUNGE) === 'truncated',
    'but a quote cut before the words that matched it only means: read the site again');
  ok(whyNoStatement(null, LOUNGE) === null, 'and no quote at all is neither');

  // quote() keeps the matching sentence now, not the first 200 characters of
  // the line, which is what cut those 65 short.
  const paragraph = 'Our shop opened in 1994. ' + 'Filler about the family. '.repeat(12)
    + 'Downstairs you will find our cigar lounge. And a patio.';
  const q = quote(paragraph, LOUNGE);
  ok(q && LOUNGE.test(q), 'quote() keeps text that actually contains the match', q);
  ok(q && q.length <= 300, 'and keeps it short enough to read', q && q.length);
  ok(plainStatement(q, LOUNGE), 'so the badge can rest on it');

  console.log(`\nsiteFacts self-test: ${pass} passed, ${fail} failed`);
  return fail;
}

if (require.main === module && process.argv[2] === 'selftest') {
  process.exit(selftest() ? 1 : 0);
}

if (require.main === module && process.argv[2] !== 'selftest') {
  const argv = process.argv.slice(2);
  const arg = n => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : null; };
  (async () => {
    if (argv[0] === 'read') await read({ out: arg('--out'), redoTruncated: argv.includes('--redo-truncated') });
    else if (argv[0] === 'decide') await decide({ from: arg('--from'), out: arg('--out') });
    else if (argv[0] === 'apply' && argv.includes('--confirm')) await apply(arg('--from'));
    else {
      console.error('usage: read --out facts.jsonl [--redo-truncated]');
      console.error('       decide --from facts.jsonl --out decisions.json');
      console.error('       apply --from decisions.json --confirm');
      console.error('       selftest');
      console.error('');
      console.error('--redo-truncated re-reads the sites whose saved quote was cut before the');
      console.error('words that matched it (65 of them in the crawl that shipped with the handoff).');
    }
    process.exit(0);
  })().catch(err => { console.error(err); process.exit(1); });
}
