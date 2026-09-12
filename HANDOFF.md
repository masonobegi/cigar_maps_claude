# Handoff: instructions for the next session

**You are picking up a half-finished programme of data sweeps on CigarBuddy.
This file is your work order. Read it, then start at "Your next task".**

Written 2026-09-11 by the session that did the first ten sweeps. Work stopped
cleanly: nothing is half-applied, and production is in a consistent state.

---

## Your next task

Do these in this order. Each is a self-contained job in section 5, with the
steps, the guardrails and what "done" means. Do not skip ahead: the earlier ones
matter more to a customer.

| Order | Task | Section | Why it is next |
|-------|------|---------|----------------|
| 1 | Search completeness | [5.1](#51-search-completeness) | A search from downtown Chicago at 25 miles returns 7 shops. Customers cannot find shops that exist |
| 2 | Pins, states and foreign rows | [5.2](#52-pins-states-and-foreign-rows) | About 100-130 pins are more than 1 km from the shop's own address |
| 3 | Hijacked links and thumbnails | [5.3](#53-hijacked-links-and-thumbnails) | 14 listings show gambling images; about 318 links land on another domain |
| 4 | Finish the amenity crawl | [5.4](#54-finish-the-amenity-crawl) | Already 55% crawled and resumable; 1,813 Lounge badges rest on a map category |
| 5 | Re-audit the hours we publish | [5.5](#55-re-audit-the-hours-we-publish) | A known list of wrong schedules, plus 405 listings whose hours we already hold evidence for |
| 6 | Menu scanner | [5.6](#56-menu-scanner) | 36 of 43 shelves get no re-read in the next 30 days |
| 7 | Closures and licence registries | [5.7](#57-closures-and-licence-registries) | The free registries caught closures nothing else did |
| 8 | Claim safety gate | [5.8](#58-claim-safety-gate) | Only urgent once claim emails are switched on |
| 9 | The smaller ones | [5.9](#59-the-smaller-ones) | Stale names, chain branches, recovering hidden shops |

**Before task 1, spend fifteen minutes on this:**

1. `git log --oneline -15`, then read `SWEEPS.md` (the running log).
2. `tar -xzf sweeps/evidence.tar.gz -C sweeps/` — the crawls behind everything.
3. `npm ci --prefix server && npm ci --prefix client`.
4. Check you can reach production (section 3). If you cannot, you can still do
   every dry run locally, but say clearly that the applying step is blocked.
5. Run the self-tests and confirm they pass before you change anything:

       cd server
       node src/utils/hoursParser.js
       node src/utils/storeHours.js
       node src/jobs/dedupeListings.js selftest
       node src/jobs/pureCigarCheck.js selftest
       PGLITE_DIR=/tmp/x node src/jobs/hoursSweep.js selftest

6. Start section 5.1.

**How every task is done, without exception:**

    dry run  ->  decisions file  ->  read it by hand  ->  remove the false
    positives  ->  apply the saved file  ->  update SWEEPS.md  ->  commit

Never apply a fresh read. Every sweep so far produced false positives on its
first run, and finding them by reading the output is the work, not an optional
extra.

## 1. The owner's rules, which outrank anything else

1. **Pure cigar and pipe-tobacco shops only.** Cigarettes on the side are fine; a
   vape, glass, hookah or kava shop that happens to sell cigars is not in this
   directory. "Mary Jane's House of Glass" is the type to exclude.
2. **When in doubt, off the map.** If we cannot show a listing is a cigar shop,
   open, at the address we hold, it stays hidden rather than making the site look
   like a junk directory. Hidden is never deleted: every hide records its reason
   and is reversible.
3. **Claimed and staff-edited listings are never touched by a sweep.**
4. **Ask Mason** before publishing anything we cannot show is a cigar shop, or
   before spending money (section 7).

## 2. What this project is, and where it stands

CigarBuddy is a cigar-shop finder: an Express + Postgres API in `server/`, a
React/Vite client in `client/`, deployed on Railway (a push to `master` deploys).
Its directory came from Overture Maps and OpenStreetMap, so it arrived full of
listings that are not cigar shops, shops that have closed or moved, wrong pins,
wrong hours and dead links.

Production today:

- **4,377 public listings**, from 7,431 at the start. About 38,000 further rows
  are hidden, each with a verdict and a reason.
- 782 show hours read from the shop's own website; the rest show map hours
  labelled "not confirmed", or nothing.
- 968 have a thumbnail; 1,813 carry a Lounge badge, many on thin evidence.
- Verdicts the importer honours, so a data refresh cannot undo them:
  `not_retail`, `online_only`, `closed`, `duplicate`, `moved`, `unproven`, and
  any `operating_status = 'permanently_closed'`.

Already done, so do not redo it: fixes surviving the import (field provenance and
an edit log), time zones from real boundaries, map-only hours shown as
unconfirmed, stock counts excluding hidden shops, search text folding, duplicate
merging, the non-shop purge, the pure-cigar check, outlet chains, and moved
shops. `SWEEPS.md` has the numbers for each.

## 3. Reaching production, and working locally

From `server/`:

    railway run --service Postgres node data/sweeps/scripts/prod.js <script.js>

`prod.js` maps `DATABASE_PUBLIC_URL` to `DATABASE_URL`, runs migrations, then
requires the script you name. Reading `railway variables` is blocked by the
tooling; `railway run` injects them, which is enough. A cloud environment needs
`railway login` or a `RAILWAY_TOKEN`. **If you cannot reach Railway, do not
guess:** do the dry runs against a local copy, produce the decision files, and
hand them to someone who can apply them.

A local copy of production, for dry runs:

    cd server
    railway run --service Postgres node data/sweeps/scripts/prod.js data/sweeps/scripts/dump_audit.js
    railway run --service Postgres node data/sweeps/scripts/prod.js data/sweeps/scripts/dump_tables.js
    PGLITE_DIR=/tmp/cbseed node data/sweeps/scripts/build_seed_db.js

Then run any job with `PGLITE_DIR=/tmp/cbseed`. **Never run a job without
PGLITE_DIR set** on the original Windows machine: the default local database
there is corrupt. Copy the seed directory per parallel job; PGlite allows one
writer at a time.

Headless Chrome is needed only for sites built in JavaScript
(`npm i --no-save puppeteer-core` plus a Chrome binary; `CHROME_PATH` overrides
the location). Where it is unavailable, skip the render passes and say so —
never hide a shop for having a JavaScript site.

## 4. What came with this handoff

In `sweeps/`:

- `decisions/` — every decision file so far, applied and unapplied, including
  `timezones_held.json` (8 listings whose pin does not fit their state, waiting
  for task 5.2) and `site-facts/facts.jsonl` (the part-finished amenity crawl).
- `evidence.tar.gz` — hours evidence for every shop website
  (`hours_evidence*.jsonl`), the browser-rendered passes (`render_*.jsonl`),
  chain store pages and locator feeds (`chain_evidence*.jsonl`), the hours
  applied (`hours_decisions_final.json`), and the reviewer verdicts used to score
  accuracy (`hours_verify*.json`). **These cost hours of crawling. Reuse them
  before re-fetching anything.**
- `scripts/` — `prod.js`, `offline.js` (runs the hours decision code with no
  database), `score_all.js` (scores hours rules against every reviewer verdict),
  the snapshot dumps, `build_seed_db.js`, `render_one.js`.
- `plan.json` — the full audit: `.plan.sweeps[]` ranked, `.audits[]` and
  `.gaps[]` with the ids and examples behind every claim. `plan_1_16.txt` is the
  readable version of the first sixteen.

Five branches hold partial, untested starts from sweeps that were stopped
part-way: `sweep/pins`, `sweep/links`, `sweep/hours`, `sweep/search-and-menus`,
`sweep/claims`. Treat them as notes, not as work that is done. Read the diff, keep
what is useful, and be ready to throw them away.

The jobs themselves are in `server/src/jobs/`: `pureCigarCheck.js`,
`storefrontCheck.js`, `dedupeListings.js`, `movedShops.js`,
`recomputeTimezones.js`, `hoursSweep.js`, `hoursRender.js`, `siteFacts.js`,
`reimportTest.js`. Each has a `selftest` command or a self-test block.

## 5. The tasks

### 5.1 Search completeness

**Problem.** `GET /stores` applies `LIMIT 300` *before* cutting to the radius, so
dense metros lose shops a few blocks away. A search from downtown Chicago at 25
miles returns 7 shops; 131 listings cannot be found from their own doorstep at
50 miles.

**Do this.**
1. Rewrite the list route in `server/src/routes/stores.js`: bounding-box
   prefilter with every SQL filter applied, haversine distance computed in SQL,
   **no row cap** on the candidate set, `openStatus` over the full set, sort by
   distance then id.
2. Return a total plus a page of about 60 with "Show more"; hydrate ratings and
   inventory only for that page.
3. Cap the radius at 100 miles, and above a ceiling answer "narrow your search"
   instead of truncating silently.
4. Count only confirmed hours for "Open now" (`hours_source` of website, owner,
   staff or chain), and say how many nearby shops have no confirmed hours.
5. Update `client/src/pages/Stores.jsx` for the count, "Show more" and that note.
6. Write the recall monitor: 62 metros by 4 radii by filters, replayed against a
   brute-force truth set, requiring 100% recall. Run it before and after.

**Guardrails.** Removing the cap surfaces low-confidence rows that the cap used
to hide; check the first 30 cards for Midtown, Brooklyn, Newark, DC, Baltimore,
Fort Lauderdale and LA before and after.

**Done when** the recall monitor reports 100%, a Chicago search at 25 miles
returns every public shop in range, and the diff of those metros looks right.

### 5.2 Pins, states and foreign rows

**Problem.** 153 public pins sit more than 1 km from the Census geocode of their
own address; about 100-130 are real errors. Plus 17 wrong-state or foreign rows,
and 8 listings in `sweeps/decisions/timezones_held.json` whose pin does not fit
the state they claim (their time zone was deliberately left alone).

**Do this.**
1. New job `server/src/jobs/geocodePins.js`. Run the free Census batch geocoder
   over every public address; take Nominatim (one request per second) as a second
   opinion only where the two disagree by more than 1 km.
2. Move a pin automatically only when **all** hold: an ordinary street (not US-,
   SR-, FM, Hwy or Route), both geocoders agreeing within 250 m, both more than
   1 km from our pin, a move under 50 km, and the address backed by the shop's
   own site or a chain feed. Everything else goes to a review list with its
   evidence.
3. Change a state only when the ZIP prefix and one more signal agree; then
   recompute the zone with `utils/storeHours.timeZoneFor`.
4. Propose foreign rows (+961, Canadian postcodes or area codes) as hidden.
5. Write through `utils/storeEdits.writeFields` with source `geocode`, keeping
   the old coordinates in the decision file.

**Guardrails.** On highway-style addresses the geocoder itself is wrong about 40%
of the time — exclude them. **Puro Estilo in Bethlehem, Pennsylvania is not
foreign.** Named cases to get right: Tobacco Junction of Marshall (404 km off),
Amsterdam Tobacco House (pinned on Long Island), Black Jack's Cigar Lounge (El
Paso, listed in New London, Connecticut).

**Done when** the auto tier is applied, the review list is written, and the 8 held
time zones are settled.

### 5.3 Hijacked links and thumbnails

**Problem.** About 318 public links end on a different domain than the one
stored. Lapsed shop domains now serve gambling and for-sale pages, and 14 of them
supply thumbnails — Mike's Cigar Room shows a gambling banner. A live shop was
once hidden because a closure reader followed a redirect to a political blog.

**Do this.**
1. Extend `server/src/jobs/linkCheck.js` with verdicts `elsewhere` (final domain
   differs and the destination does not name the shop), `hijacked` (two or more
   gambling terms and no cigar word), `parked` (a lander stub or for-sale
   template) and `store_unavailable` (HTTP 402). All count as dead.
2. Force a recheck of every public website.
3. A hijacked or parked own-domain becomes a weak closure signal for staff,
   never an automatic hide. Hijacked or parked domains lose their thumbnail.
4. New job `thumbCheck.js` over the 968 thumbnails: status, content type, byte
   and pixel size, hot-link behaviour, near-blank images, wide cropped banners,
   and one picture repeated across unrelated shops.

**Guardrails.** A real rebrand redirect must keep its link: a phone or address
match on the destination passes it.

**Done when** no public listing links to a gambling or parking page, and no card
shows an image from one.

### 5.4 Finish the amenity crawl

**Problem.** 1,813 listings carry a Lounge badge, many resting on a map category
alone, while shops whose own site describes a lounge do not have one. Walk-in
humidor is flagged on 74 listings, all from their names.

**Do this.** `server/src/jobs/siteFacts.js` is written and tested, and its crawl
is resumable: 1,343 of 2,438 sites are already read into
`sweeps/decisions/site-facts/facts.jsonl`.

    node src/jobs/siteFacts.js read   --out sweeps/decisions/site-facts/facts.jsonl
    node src/jobs/siteFacts.js decide --from <facts.jsonl> --out <decisions.json>
    node src/jobs/siteFacts.js apply  --from <decisions.json> --confirm

**Guardrails.** It keeps the sentence each verdict rests on: read them. A badge is
added on a plain statement, and removed only when the site is readable, names the
shop, and never mentions a lounge.

**Done when** every badge on the public map has either a sentence behind it or a
map category that a person has accepted.

### 5.5 Re-audit the hours we publish

**Problem.** The website hours scored 97.3% on a reviewed sample; the remaining
errors are known — a sister branch's block, a host casino's hours, an office
line, a lapsed season, typos kept as impossible days, and two ranges in a day
where only the first is read. Separately, 405 listings with no hours have a
readable three-day block on a page already in the evidence.

**Do this.**
1. Tighten `mentionsShop` in `hoursSweep.js`: whole words only; a domain counts
   only when it holds two of the name's words, or one distinctive word plus a
   trade word; drop the town-only fallback.
2. Refuse at decide time: a sibling town's heading between the address and the
   hours; blocks labelled casino, convenience store or mall; weekday-only 8-5 or
   9-5 blocks near support, office, fax or orders; a schedule whose named season
   excludes today.
3. Parser fixes in `hoursParser.js`: every comma range; a leading 00:00-04:00
   segment belongs to the previous night; 25:00-28:00; "12: 00"; "4 pm - 12 pm"
   meaning midnight; a day 12 hours off the others becomes unknown.
4. Re-run `decide` on the saved evidence, diff against production, and write two
   files: schedules to clear, and schedules to replace.
5. Then the 405: produce them as their own decisions file with the lines quoted.

**Guardrails.** Score every change with `sweeps/scripts/score_all.js` against all
reviewer verdicts: **accuracy must not fall below 97.3%**. House of Cigar and
Anthony's name sibling towns and are correct — they must not be cleared.

**Done when** the score holds, and the clear and replace files have been read row
by row.

### 5.6 Menu scanner

**Problem.** 36 of 43 shelves get no re-read in the next 30 days and no new shop
is ever reached, because a failed read never records an attempt. Stock claims
stay up indefinitely.

**Do this.** In `server/src/jobs/webMenu.js`: record an attempt stamp on every
outcome; back off by outcome (ok 7 days, unsupported 60, errors 3, 7, 14 then
30); skip dead website statuses; put never-read listings ahead of low-value
re-reads; expire stock after 21 days without a successful read (`in_stock = 0`
with a marker, never deleted); turn the store page's "checked N days ago" label
amber after 7 days; attach a shared website's feed only to the listing whose
address the site names.

**Done when** a replay of the next 30 days shows never-read listings being
reached and live shelves being re-read.

### 5.7 Closures and licence registries

**Do this.**
1. `closureCheck.js`: treat a dead link on a platform or directory host as "no
   website"; merge duplicates before flagging; add the rule for map-only pins
   (OpenStreetMap-only, no phone, no website, no hours, last edited before 2020,
   no Overture record within 150 m); clear the flag automatically when a listing
   gains a phone, a working site or hours; sort the staff queue by strength of
   evidence.
2. New job `licenceSync.js` for the free registries (NYC, New York State, Texas,
   Florida, California, Pennsylvania, Chicago, Washington), which cover 2,850
   listings. Join on phone, or ZIP plus house number plus a shared street word,
   or within 60 m with the names agreeing. Four outputs: verified stamps, renamed
   candidates, moves, and closure flags.

**Guardrails.** Never hide on either signal alone; a licence lapse alone is
roughly a coin flip. Allow 60 days of lag. **Stogies, BlackHouse and Manhattan
Tobacco are open and must not be flagged.** NYC smoke shops are exempt from lapse
flags.

**Done when** the queues exist and a person has reviewed the first batch.

### 5.8 Claim safety gate

**Problem.** Instant claim trusts the domain of the stored website and nothing
else; about 480 listings have a dead domain anyone could buy and use to claim
them. Only urgent once SMTP is configured — nothing can be claimed today.

**Do this.** The full condition list is in the claims entry of `plan.json`
(`.gaps[]`). A partial start, including a vendored public suffix list, is on
branch `sweep/claims`.

**Done when** the 25 live examples in that audit entry behave as it says.

### 5.9 The smaller ones

Stale former names (overlaps the licence work), chain branches (much smaller now
the tobacco-outlet chains are off the map), and recovering real cigar shops the
classifier hid — publish those only with evidence, per rule 2.

## 6. Traps this session hit, so you do not

- **Line endings.** Several server files use CRLF; Git Bash hides the carriage
  return, so a scripted multi-line replacement silently matches nothing. Check
  with node, and write back with the file's own endings.
- **Heredocs eat backslashes.** A bash heredoc collapsed doubled backslashes and
  wrote a real newline into a regex, corrupting two files. Use the editor tools
  for anything containing a backslash, then run `node --check`.
- **`db.run` uses `?` placeholders.** An apostrophe inside a SQL string literal
  broke a statement mid-run; pass values as parameters.
- **The menu scanner runs on the server every 6 hours** and writes `inventory`,
  which has no unique key: never run a manual menu sync at the same time.
- **The import only runs when the directory file changes,** so a bug in it stays
  invisible until the next data refresh. `node src/jobs/reimportTest.js` is what
  catches it — run it after touching `importStores.js`.
- **Do not trust one geocoder or one time-zone library.** A rounded grid put
  Kellogg, Idaho in Mountain time and Williston, North Dakota in the wrong zone;
  exact boundaries fixed both, and a public time API disagreed with both on a
  third town.

## 7. What to ask Mason

- A Google Places API key and budget, for the closures and hours no free source
  settles. Everything so far was done without paid data.
- Whether any outlet chain should come back: Wild Bill's (198 listings), Sweet
  Fire (61), Cheap Tobacco (32), The Tobacco Shoppe (21). Each is one command.
- Anything that would publish listings we cannot show are cigar shops.

## 8. Keep the log

After each task: update `SWEEPS.md` with what changed in production and the
numbers, and commit. If you stop part-way, say in `SWEEPS.md` exactly where you
are, as this file does. The next session should never have to reconstruct it.
