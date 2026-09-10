/**
 * A chain's own website is the authority on which of its branches exist.
 *
 * Anthony's Cigar Emporium publishes four storefronts in schema.org markup:
 * three in Tucson and one in Phoenix. Our directory carried those four and a
 * fifth on N Oracle Rd that the chain does not list anywhere. Map data keeps
 * former locations alive long after the door is locked, and a shop that moved
 * across town leaves two pins behind.
 *
 * So: where several listings share a website, read that website's published
 * locations and keep the ones the business itself claims.
 *
 * This is only run where the evidence is strong enough to trust, because the
 * failure mode is deleting a real shop:
 *
 *  - the site must publish at least two addresses, so a single "visit us"
 *    block on a one-location page can never condemn a chain's other branches
 *  - it must publish at least 60% as many addresses as we hold, so a site
 *    showing only its flagship does not wipe out the rest
 *  - a listing is only doubted when its street number AND street name appear
 *    nowhere in the published set
 *  - claimed and staff-edited listings are never touched
 *
 * Anything ruled out is hidden with a reason, never deleted.
 *
 * CLI:  node src/jobs/chainCheck.js --out decisions.json    # dry run; read the file
 *       node src/jobs/chainCheck.js --confirm --from decisions.json
 */
'use strict';

const fs = require('fs');
const db = require('../database/db');
const { fetchUrl } = require('./webMenu');

const PAUSE_MS = 1200;
const MIN_PUBLISHED = 2;
const MIN_COVERAGE = 0.6;
// A branch the chain has dropped sits among the ones it kept.
const NEAR_SIBLING_MI = 75;
// Share of our listings the site must confirm before we trust it on the rest.
const MIN_AGREEMENT = 0.5;
const PAGE_CANDIDATES = [
  '', '/pages/contact', '/contact', '/contact-us', '/pages/locations',
  '/locations', '/pages/our-locations', '/store-locator', '/pages/stores',
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

function milesBetween(lat1, lng1, lat2, lng2) {
  const R = 3958.8;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Words every cigar shop's name might carry, which say nothing about which
// business it is.
const GENERIC_NAME_WORDS = new Set([
  'cigar', 'cigars', 'tobacco', 'tobacconist', 'tobacconists', 'smoke', 'smokes',
  'shop', 'shoppe', 'store', 'lounge', 'bar', 'club', 'co', 'company', 'inc',
  'llc', 'ltd', 'the', 'and', 'of', 'humidor', 'emporium', 'house', 'room',
]);

function nameWords(name) {
  return new Set(String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ')
    .split(' ').filter(w => w && !GENERIC_NAME_WORDS.has(w)));
}

/**
 * Do two listings carry the same business's name? "Omerta Cigar Co Monroe"
 * and "Omerta Cigar Co" do; "Tobacco Express Pinson" and "Birmingham Cigars"
 * do not. Judged on the distinctive words, so "Cigar Co" never counts.
 */
function sameName(a, b) {
  const wa = nameWords(a), wb = nameWords(b);
  if (!wa.size || !wb.size) return false;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / Math.min(wa.size, wb.size) >= 0.5;
}

/**
 * What a listing the chain does not publish most likely is.
 *
 *  former_branch  it sits among the chain's confirmed branches and carries the
 *                 chain's name: a shop the chain closed or moved. Hide it.
 *  wrong_website  it is far from every confirmed branch and its name is not
 *                 the chain's: a different business handed this link by
 *                 mistake. Keep the shop, clear the link.
 *  unclear        anything else — same name far away (a franchise or a
 *                 branch the site forgot), or a different name nearby. Nothing
 *                 is done on a guess.
 */
function classify(m, confirmed) {
  const near = confirmed.some(c => c.state === m.state
    && Number.isFinite(c.lat) && Number.isFinite(m.lat)
    && milesBetween(c.lat, c.lng, m.lat, m.lng) <= NEAR_SIBLING_MI);
  const named = confirmed.some(c => sameName(c.name, m.name));
  if (near && named) return 'former_branch';
  if (!near && !named) return 'wrong_website';
  return 'unclear';
}

const STREET_WORDS = {
  street: 'st', avenue: 'ave', road: 'rd', boulevard: 'blvd', drive: 'dr',
  highway: 'hwy', lane: 'ln', place: 'pl', court: 'ct', parkway: 'pkwy',
  trail: 'trl', circle: 'cir', turnpike: 'tpke', terrace: 'ter',
  north: 'n', south: 's', east: 'e', west: 'w',
  northeast: 'ne', northwest: 'nw', southeast: 'se', southwest: 'sw',
};

/**
 * "7866 N. Oracle Road, Suite 3" -> "7866 oracle".
 *
 * Street number plus the first real name word is the identity that survives
 * every way a business writes its own address. Direction prefixes, suffixes
 * and suite numbers all vary between a map record and a shop's footer.
 */
function addressKey(raw) {
  const txt = String(raw || '')
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .replace(/\b(?:ste|suite|unit|apt|bldg|#)\s*[\w-]+/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (!txt) return null;
  const parts = txt.split(' ');
  const num = parts[0];
  if (!/^\d+$/.test(num)) return null;
  for (let i = 1; i < parts.length; i++) {
    const w = STREET_WORDS[parts[i]] || parts[i];
    // Skip direction prefixes and pure ordinal markers; take the first word
    // that actually names the street.
    if (['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].includes(w)) continue;
    if (Object.values(STREET_WORDS).includes(w) && i === parts.length - 1) continue;
    return `${num} ${w}`;
  }
  return num;
}

function hostOf(website) {
  return String(website || '')
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .split('/')[0]
    .toLowerCase();
}

/** Every street address a page publishes, from markup and from plain text. */
function extractAddresses(html) {
  const found = new Set();
  if (!html) return found;

  // schema.org PostalAddress, the most trustworthy form.
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data;
    try { data = JSON.parse(m[1].replace(/\\\//g, '/')); } catch { continue; }
    const walk = node => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) return node.forEach(walk);
      const street = node.streetAddress || (node.address && node.address.streetAddress);
      if (typeof street === 'string') {
        const k = addressKey(street);
        if (k) found.add(k);
      }
      for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v);
    };
    walk(data);
  }

  // Plain text, for the many sites that only print their addresses.
  const text = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ');
  const re = /\b(\d{2,6})\s+((?:[NSEW]\.?|North|South|East|West|Northeast|Northwest|Southeast|Southwest)\s+)?([A-Za-z0-9'.-]+(?:\s+[A-Za-z0-9'.-]+){0,3}?)\s+(Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Highway|Hwy|Lane|Ln|Place|Pl|Court|Ct|Parkway|Pkwy|Trail|Trl|Circle|Cir|Turnpike|Tpke|Terrace|Ter|Way)\b/gi;
  for (const m of text.matchAll(re)) {
    const k = addressKey(`${m[1]} ${m[2] || ''} ${m[3]} ${m[4]}`);
    if (k) found.add(k);
  }
  return found;
}

/** Read a handful of likely pages and pool every address they publish. */
async function publishedAddresses(host, { log = console.log } = {}) {
  const pooled = new Set();
  let reachable = false;
  for (const path of PAGE_CANDIDATES) {
    let res;
    try {
      res = await fetchUrl(`https://${host}${path}`);
    } catch {
      continue;
    }
    if (!res || res.status >= 400 || !res.body) continue;
    reachable = true;
    for (const a of extractAddresses(res.body)) pooled.add(a);
    await sleep(250);
    // Four distinct addresses is already a locations page; stop bothering them.
    if (pooled.size >= 4 && path) break;
  }
  return { pooled, reachable };
}

async function checkChains({ confirm = false, host: onlyHost = null, limit = 0, out = null, from = null, log = console.log } = {}) {
  // Applying never re-reads the sites; it replays a reviewed dry run.
  if (confirm) {
    if (!from) throw new Error('--confirm needs --from <file> written by a reviewed dry run');
    return applyDecisions(from, { log });
  }

  const rows = await db.all(`
    SELECT id, name, address, city, state, lat, lng, website, claimed, staff_edited
    FROM stores
    WHERE visible = 1 AND claimed = 0 AND COALESCE(staff_edited, 0) = 0
      AND website IS NOT NULL AND website <> ''
    ORDER BY id
  `);

  const byHost = new Map();
  for (const r of rows) {
    const h = hostOf(r.website);
    if (!h) continue;
    if (!byHost.has(h)) byHost.set(h, []);
    byHost.get(h).push(r);
  }

  let chains = [...byHost.entries()].filter(([, list]) => list.length > 1);
  if (onlyHost) chains = chains.filter(([h]) => h === hostOf(onlyHost));
  if (limit) chains = chains.slice(0, limit);

  log(`${chains.length} websites are shared by more than one listing`);

  const doubted = [];
  const stats = { checked: 0, unreachable: 0, tooFewPublished: 0, lowCoverage: 0, noneConfirmed: 0, weakAgreement: 0, confirmedAll: 0, unclear: 0 };

  for (const [host, list] of chains) {
    stats.checked++;
    const { pooled, reachable } = await publishedAddresses(host, { log });
    if (!reachable) { stats.unreachable++; continue; }
    if (pooled.size < MIN_PUBLISHED) { stats.tooFewPublished++; continue; }
    if (pooled.size < Math.floor(list.length * MIN_COVERAGE)) { stats.lowCoverage++; continue; }

    const keyed = list.map(r => ({ ...r, key: addressKey(r.address) }));
    const confirmed = keyed.filter(r => r.key && pooled.has(r.key));
    const missing = keyed.filter(r => r.key && !pooled.has(r.key));

    // If not one of our listings appears in what the site publishes, we did not
    // find its store list — we found a footer, a shipping address, or a
    // directory site that happens to be linked from several unrelated shops.
    // That proves nothing about any of them.
    if (!confirmed.length) { stats.noneConfirmed++; await sleep(PAUSE_MS); continue; }
    if (!missing.length) { stats.confirmedAll++; await sleep(PAUSE_MS); continue; }
    // Most of a chain's real branches should appear on its own locations page.
    // When only one of seven does, the page we read is incomplete or is not
    // the store list at all, and the six "missing" ones are just as likely to
    // be real shops we failed to parse. Act only when the site agrees with us
    // about the majority.
    if (confirmed.length / (confirmed.length + missing.length) < MIN_AGREEMENT) {
      stats.weakAgreement++;
      log(`  ${host}: skipped — only ${confirmed.length} of ${confirmed.length + missing.length} listings found on the site`);
      await sleep(PAUSE_MS);
      continue;
    }

    for (const m of missing) {
      const verdict = classify(m, confirmed);
      if (verdict === 'unclear') {
        stats.unclear++;
        log(`  ${host}: #${m.id} ${m.name} (${m.city}, ${m.state}) — not listed, but not clearly either; left alone`);
        continue;
      }
      doubted.push({ ...m, host, published: pooled.size, siblings: list.length, confirmedCount: confirmed.length, verdict });
      log(`  ${host}: #${m.id} ${m.name} — ${m.address} (${m.city}, ${m.state}) ` +
          `${verdict === 'former_branch' ? 'is a branch the chain no longer lists' : 'is not this business — clearing the link'} ` +
          `[${confirmed.length} of ${list.length} confirmed, ${pooled.size} published]`);
    }
    await sleep(PAUSE_MS);
  }

  const branches = doubted.filter(d => d.verdict === 'former_branch');
  const wrongSites = doubted.filter(d => d.verdict === 'wrong_website');
  log(`\nchecked ${stats.checked} chains — ${stats.unreachable} unreachable, ` +
      `${stats.tooFewPublished} publish too few addresses, ${stats.lowCoverage} below coverage bar, ` +
      `${stats.noneConfirmed} matched none of our listings, ${stats.weakAgreement} agreed on too few, ` +
      `${stats.confirmedAll} fully confirmed, ${stats.unclear} unlisted listings left alone as unclear`);
  log(`branches the chain no longer lists (would hide): ${branches.length}`);
  log(`unrelated shops carrying this website (would clear the link, keep the shop): ${wrongSites.length}`);

  if (out) {
    fs.writeFileSync(out, JSON.stringify(doubted.map(d => ({
      id: d.id, name: d.name, address: d.address, city: d.city, state: d.state,
      host: d.host, published: d.published, verdict: d.verdict,
    })), null, 2));
    log(`\ndecisions written to ${out}`);
  }
  log('Dry run. Nothing changed. Apply the reviewed decisions with --confirm --from <file>.');
  return { dryRun: true, doubted };
}

/**
 * Apply decisions a dry run already made and a person already read. The sites
 * are not fetched again: a page that changed between the review and the apply
 * must not quietly change what gets hidden.
 */
async function applyDecisions(file, { log = console.log } = {}) {
  const decisions = JSON.parse(fs.readFileSync(file, 'utf8'));
  let hidden = 0, cleared = 0, skipped = 0;
  for (const d of decisions) {
    // Guard rails again at apply time: a shop claimed or hand-edited since the
    // review belongs to a person now.
    const cur = await db.get('SELECT visible, claimed, staff_edited FROM stores WHERE id = ?', [d.id]);
    if (!cur || cur.claimed || cur.staff_edited || !cur.visible) { skipped++; continue; }

    if (d.verdict === 'former_branch') {
      await db.run(`
        UPDATE stores
        SET visible = 0, storefront = 'closed', storefront_reason = ?,
            storefront_checked_at = NOW(), operating_status = 'closed',
            closed_reason = ?, closure_checked_at = NOW()
        WHERE id = ?
      `, [
        `Not among the ${d.published} locations ${d.host} publishes`,
        `The chain's own website lists its other branches here but not this address`,
        d.id,
      ]);
      hidden++;
    } else if (d.verdict === 'wrong_website') {
      // The shop stays; only the link it was wrongly given goes. staff_edited
      // keeps the next import from writing the same wrong URL straight back.
      await db.run(`
        UPDATE stores
        SET website = NULL, website_status = NULL, website_final_url = NULL,
            website_checked_at = NOW(), staff_edited = 1
        WHERE id = ?
      `, [d.id]);
      cleared++;
    }
  }
  const left = await db.get('SELECT COUNT(*)::int AS n FROM stores WHERE visible = 1');
  log(`hid ${hidden} former branches, cleared ${cleared} wrong links, skipped ${skipped} ` +
      `that changed since review. ${left.n} listings remain on the public map.`);
  return { hidden, cleared, skipped, remaining: left.n };
}

/**
 * Re-judge a saved dry run under the current rules without reading any site
 * again. Which listings a chain publishes does not change; only what we make
 * of the ones it leaves out.
 */
async function reclassifyDecisions(file, out, { log = console.log } = {}) {
  const decisions = JSON.parse(fs.readFileSync(file, 'utf8'));
  const doubtedIds = new Set(decisions.map(d => d.id));
  const byHost = new Map();
  for (const d of decisions) {
    if (!byHost.has(d.host)) byHost.set(d.host, []);
    byHost.get(d.host).push(d);
  }
  const kept = [];
  const counts = { former_branch: 0, wrong_website: 0, unclear: 0 };
  for (const [host, list] of byHost) {
    const rows = (await db.all(
      "SELECT id, name, state, lat, lng, website FROM stores WHERE visible = 1 AND website ILIKE ?",
      [`%${host}%`])).filter(r => hostOf(r.website) === host);
    const confirmed = rows.filter(r => !doubtedIds.has(r.id));
    for (const d of list) {
      const m = rows.find(r => r.id === d.id);
      if (!m) continue;                               // gone since the dry run
      const verdict = classify(m, confirmed);
      counts[verdict]++;
      if (verdict !== 'unclear') kept.push({ ...d, verdict });
    }
  }
  fs.writeFileSync(out, JSON.stringify(kept, null, 2));
  log(`re-judged ${decisions.length}: ${counts.former_branch} former branches, ` +
      `${counts.wrong_website} wrong links, ${counts.unclear} left alone as unclear. Written to ${out}`);
  return { ...counts, kept: kept.length };
}

module.exports = { checkChains, applyDecisions, reclassifyDecisions, classify, sameName, addressKey, extractAddresses, hostOf };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const arg = name => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : null; };
  checkChains({
    confirm: argv.includes('--confirm'),
    host: arg('--host'),
    limit: Number(arg('--limit')) || 0,
    out: arg('--out'),
    from: arg('--from'),
  }).then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
}
