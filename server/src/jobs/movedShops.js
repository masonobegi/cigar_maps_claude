/**
 * A shop that moved, still listed at the door it left.
 *
 * Map data keeps the old address long after the shop is gone, and often keeps
 * the new one beside it, so a customer drives to an empty storefront while the
 * real shop sits two miles away in the same list. Serafin de Cuba, Mardo
 * Cigars and SJ Cigars all read that way today.
 *
 * The shop's own website is the authority: it lists the doors it trades from.
 * When it publishes at least as many addresses as we hold and never mentions
 * one of ours, that one has been left. When it names a street we do not have
 * at all, the address itself is stale and gets proposed for correction.
 *
 * A chain with several branches is not a move: Point Break has three shops in
 * Key West on one phone, and its site names all three.
 *
 *   node src/jobs/movedShops.js plan --from candidates.json --out moved.json
 *   node src/jobs/movedShops.js apply --from moved.json --confirm
 */
'use strict';

const fs = require('fs');
const db = require('../database/db');
const { fetchUrl } = require('./webMenu');
const { pageText, candidateLinks, jsonLdBlocks } = require('./hoursSweep');
const { addressKey, hostOf } = require('./chainCheck');
const { writeFields } = require('../utils/storeEdits');

const PAUSE_MS = 350;
const MAX_PAGES = 4;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// "Moved", said plainly on the page.
const MOVED_WORDS = /\b(we\s+(have\s+)?moved|now\s+(located|open)\s+at|new\s+location|relocated|our\s+new\s+(home|address|store))\b/i;

// A street address ends in a street word (not "sq", which is floor space:
// "800 sq ft" read as an address). Without this, prose supplies
// addresses that do not exist — "12 years", "1964 Presidente", "50 other".
const STREET_TYPE = /\b(st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|hwy|highway|ln|lane|way|pkwy|parkway|ct|court|pl|place|ter|terrace|cir|circle|trl|trail|pike|plaza|route|rt|suite|ste|unit|#)\b/i;

/** Every street address a page publishes, as "number street" keys. */
function addressesOn(html) {
  const keys = new Set();
  const text = pageText(html);
  for (const line of text.split('\n')) {
    const m = line.match(/\b(\d{2,6})\s+((?:[NSEW]\.?\s+)?[A-Za-z][A-Za-z0-9'.-]*(?:\s+[A-Za-z0-9'.-]+){0,4})/);
    if (!m || !STREET_TYPE.test(m[0])) continue;
    const key = addressKey(m[0]);
    if (key && /\s/.test(key)) keys.add(key);
  }
  for (const block of jsonLdBlocks(html)) {
    for (const m of block.matchAll(/"streetAddress"\s*:\s*"([^"]{4,120})"/gi)) {
      const key = addressKey(m[1]);
      if (key) keys.add(key);
    }
  }
  return { keys, movedWording: MOVED_WORDS.test(text), text };
}

/** Read a shop's site: home page plus its contact and locations pages. */
async function readSite(website) {
  const site = /^https?:\/\//i.test(website) ? website : `https://${website}`;
  const out = { pages: 0, keys: new Set(), movedWording: false, names: '' };
  let home;
  try { home = await fetchUrl(site, { accept: 'text/html' }); } catch { return out; }
  if (!home || home.status >= 400 || !home.body) return out;
  const pages = [home];
  for (const link of candidateLinks(home.body, home.url || site).slice(0, MAX_PAGES - 1)) {
    await sleep(PAUSE_MS);
    try {
      const p = await fetchUrl(link, { accept: 'text/html' });
      if (p && p.status < 400 && p.body) pages.push(p);
    } catch {}
  }
  for (const p of pages) {
    const found = addressesOn(p.body);
    for (const k of found.keys) out.keys.add(k);
    out.movedWording = out.movedWording || found.movedWording;
    out.names += ' ' + found.text.slice(0, 4000);
    out.pages++;
  }
  return out;
}

/** One letter apart is the same street: Point Break's site spells Greene "Green". */
function nearlySame(a, b) {
  if (a === b) return true;
  if (!a || !b || Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/**
 * Is our door among the doors this site publishes? House numbers disagree
 * between sources on the same street — Tinder Box Ballantyne is 14815 for us
 * and 14825 on its own site — and a near number on the same street is the same
 * shop, not one to hide.
 */
function listedOn(key, keys) {
  if (!key) return false;
  if (keys.has(key)) return true;
  const [num, street] = key.split(' ');
  for (const k of keys) {
    const [n2, s2] = k.split(' ');
    if (!nearlySame(street, s2)) continue;
    if (n2 === num) return true;
    if (Math.abs(Number(n2) - Number(num)) <= 20) return true;
  }
  return false;
}

async function plan({ from, out, log = console.log } = {}) {
  const groups = JSON.parse(fs.readFileSync(from, 'utf8'));
  const decisions = [];
  const sites = new Map();
  let read = 0, noSite = 0, bothListed = 0, notItsSite = 0;
  for (const g of groups) {
    // Each listing is judged by its OWN website, or by one the whole group
    // shares. Diamond Crown shares a phone with J.C. Newman, and Newman's site
    // says nothing about where Diamond Crown trades.
    const hosts = new Set(g.rows.map(r => r.website).filter(Boolean).map(hostOf));
    const shared = hosts.size === 1 ? g.rows.map(r => r.website).find(Boolean) : null;
    const ours = [];
    for (const r of g.rows) {
      const site = r.website || shared;
      if (!site) continue;
      if (!sites.has(site)) {
        sites.set(site, await readSite(site));
        read++;
        await sleep(PAUSE_MS);
      }
      ours.push({ row: r, key: addressKey(r.address), site, evidence: sites.get(site) });
    }
    if (!ours.length) { noSite++; continue; }

    const withEvidence = ours.filter(o => o.evidence.pages && o.evidence.keys.size);
    if (!withEvidence.length) continue;
    const named = withEvidence.filter(o => listedOn(o.key, o.evidence.keys));
    const missing = withEvidence.filter(o => o.key && !listedOn(o.key, o.evidence.keys));
    if (!named.length) continue;                       // we cannot read its addresses at all
    if (!missing.length) { bothListed++; continue; }   // every door we hold is on its site

    for (const m of missing) {
      const evidence = m.evidence;
      // The site has to be this shop's: it must publish a sibling's door too.
      const provesGroup = named.some(n => n.site === m.site);
      if (!provesGroup && !evidence.movedWording) { notItsSite++; continue; }
      if (evidence.keys.size < named.filter(n => n.site === m.site).length) continue;
      const site = m.site;
      const unlisted = [...evidence.keys].filter(k => !ours.some(o => o.key === k));
      decisions.push({
        id: m.row.id,
        name: m.row.name,
        address: m.row.address,
        city: m.row.city,
        state: m.row.state,
        phone: m.row.phone,
        site,
        sharedSite: hosts.size === 1,
        keeps: named.map(n => ({ id: n.row.id, address: n.row.address })),
        site_addresses: [...evidence.keys].slice(0, 12),
        moved_wording: evidence.movedWording,
        unlisted_street: unlisted[0] || null,
        action: unlisted.length === 1 && named.length === ours.length - 1 && evidence.movedWording
          ? 'address_change' : 'hide',
        reason: evidence.movedWording
          ? `its own website says it moved, and no longer lists ${m.row.address}`
          : `its own website lists ${evidence.keys.size} addresses and not ${m.row.address}`,
      });
    }
  }
  log(`${groups.length} groups: ${read} sites read, ${noSite} with no site, ${bothListed} where every door is still listed, ${notItsSite} judged by a site that is not the shop own`);
  log(`${decisions.length} listings look like a door the shop has left`);
  for (const d of decisions.slice(0, 30)) log(`  #${d.id} ${d.name} — ${d.address}, ${d.city} (${d.action}) — ${d.reason}`);
  if (out) { fs.writeFileSync(out, JSON.stringify(decisions, null, 1)); log(`\nwritten to ${out}`); }
  return decisions;
}

async function apply(file, { log = console.log } = {}) {
  const decisions = JSON.parse(fs.readFileSync(file, 'utf8'));
  let hidden = 0, moved = 0;
  for (const d of decisions) {
    if (d.action === 'address_change' && d.new_address) {
      const done = await writeFields(d.id, { address: d.new_address }, {
        source: 'website', job: 'movedShops', reason: d.reason,
      });
      moved += done.length ? 1 : 0;
      continue;
    }
    const keep = (d.keeps || [])[0];
    const res = await db.run(`UPDATE stores SET visible = 0, storefront = 'moved', storefront_reason = ?,
        storefront_checked_at = NOW()
      WHERE id = ? AND COALESCE(claimed, 0) = 0 AND COALESCE(staff_edited, 0) = 0`,
      [`${d.reason}${keep ? `; still trading at ${keep.address} (listing #${keep.id})` : ''}`.slice(0, 300), d.id]);
    hidden += res.changes;
  }
  const left = await db.get('SELECT COUNT(*)::int AS n FROM stores WHERE visible = 1');
  log(`hid ${hidden} listings at a door the shop has left, corrected ${moved} addresses. ${left.n} listings remain public.`);
  return { hidden, moved, remaining: left.n };
}

module.exports = { plan, apply, addressesOn, readSite };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const arg = n => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : null; };
  (async () => {
    if (argv[0] === 'apply' && argv.includes('--confirm')) await apply(arg('--from'));
    else await plan({ from: arg('--from'), out: arg('--out') });
    process.exit(0);
  })().catch(err => { console.error(err); process.exit(1); });
}
