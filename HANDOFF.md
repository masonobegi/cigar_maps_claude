# Handoff: finishing the CigarBuddy store-data sweeps

Read this file, then carry on. It is written to be the only thing you need;
everything it refers to is in this repository.

Written 2026-09-11 by the session that did the first ten sweeps. Work stopped
cleanly: nothing is half-applied, and production is in a consistent state.

---

## 1. What this project is, in one paragraph

CigarBuddy is a cigar-shop finder: an Express + Postgres API in `server/`, a
React/Vite client in `client/`, deployed on Railway (a push to `master` deploys).
Its store directory was imported from Overture Maps and OpenStreetMap, so it
arrived full of listings that are not cigar shops, shops that have closed or
moved, wrong pins, wrong hours and dead links. The work in hand is a programme of
sweeps that make every fact on a listing something we can stand behind.

## 2. The owner's rules, which outrank anything else

1. **Pure cigar and pipe-tobacco shops only.** Cigarettes on the side are fine; a
   vape, glass, hookah or kava shop that happens to sell cigars is not in this
   directory. "Mary Jane's House of Glass" is the type to exclude.
2. **When in doubt, off the map.** If we cannot show a listing is a cigar shop,
   open, at the address we hold, it stays hidden rather than making the site look
   like a junk directory. Hidden is never deleted: every hide records its reason
   and is reversible.
3. **Never apply a fresh read.** Dry run, write a decisions file, read it by hand,
   remove the false positives, then apply the saved file. Every sweep so far
   produced false positives on its first run. Finding them *is* the work.
4. **Claimed and staff-edited listings are never touched by a sweep.**

## 3. Where production is right now

- **4,377 public listings**, from 7,431 at the start. About 38,000 further rows
  are hidden, each with a verdict and a reason.
- 782 public listings show hours read from the shop's own website; the rest show
  either map hours labelled "not confirmed" or nothing.
- 968 have a thumbnail; 1,813 carry a Lounge badge, many on thin evidence, which
  is what sweep 7.5 below is for.
- Verdicts the importer honours, so a data refresh cannot undo them:
  `not_retail`, `online_only`, `closed`, `duplicate`, `moved`, `unproven`, and any
  `operating_status = 'permanently_closed'`.

## 4. Setting up (cloud or a fresh machine)

    npm ci --prefix server
    npm ci --prefix client

**Reaching production.** The database is Railway's. From `server/`:

    railway run --service Postgres node data/sweeps/scripts/prod.js <script.js>

`prod.js` maps `DATABASE_PUBLIC_URL` to `DATABASE_URL`, runs the migrations, then
requires the script you name. Reading `railway variables` is blocked by the
tooling; `railway run` injects them, which is enough. A cloud environment needs
`railway login` or a `RAILWAY_TOKEN`. **If you cannot reach Railway, do not
guess:** build the local copy below, produce the decision files, and hand them to
someone who can apply them.

**A local copy of production, for dry runs:**

    cd server
    railway run --service Postgres node data/sweeps/scripts/prod.js data/sweeps/scripts/dump_audit.js
    railway run --service Postgres node data/sweeps/scripts/prod.js data/sweeps/scripts/dump_tables.js
    PGLITE_DIR=/tmp/cbseed node data/sweeps/scripts/build_seed_db.js

Then run any job with `PGLITE_DIR=/tmp/cbseed`. **Never run a job without
PGLITE_DIR set** on the original Windows machine: the default local database
there is corrupt. Copy the seed directory per parallel job; PGlite allows one
writer at a time.

**Headless Chrome** is needed only for sites built in JavaScript
(`npm i --no-save puppeteer-core`, plus a Chrome binary; `CHROME_PATH` overrides
the default location). Where it is unavailable, skip the render passes and say so
in the log rather than hiding shops for having a JavaScript site.

## 5. The data that came with this handoff

In `sweeps/`:

- `decisions/` — every decision file produced so far, applied and unapplied,
  including those still waiting (section 7).
- `evidence.tar.gz` — expand with `tar -xzf sweeps/evidence.tar.gz -C sweeps/`.
  Inside: hours evidence for every shop website (`hours_evidence*.jsonl`), the
  browser-rendered passes (`render_*.jsonl`), chain store pages and locator feeds
  (`chain_evidence*.jsonl`), the hours actually applied
  (`hours_decisions_final.json`), and the reviewer verdicts used to score
  accuracy (`hours_verify*.json`). **These cost several hours of crawling: reuse
  them before re-fetching anything.**
- `scripts/` — the runners named above, plus `offline.js` (runs the hours
  decision code without a database) and `score_all.js` (scores hours rules
  against every reviewer verdict).
- `plan.json` — the full audit: `.plan.sweeps[]` ranked, `.audits[]` and `.gaps[]`
  with the ids and examples behind every claim. `plan_1_16.txt` is the readable
  version of the first sixteen.

`SWEEPS.md` is the running log of what shipped. Keep it current as you go.

## 6. What is already done (do not redo)

| # | Sweep | Result in production |
|---|-------|----------------------|
| 1 | Fixes survive the import | `stores.field_sources` records which hand wrote each field; `store_edits` logs every change; the import refreshes only directory-owned fields and treats our closures as binding. `node src/jobs/reimportTest.js` proves eight kinds of correction survive a forced re-import |
| 2 | Time zones | Read from real zone boundaries (geo-tz), not longitude rules; 153 listings moved |
| 3 | Map-only hours | Shown as "not confirmed", with no Open or Closed badge; 121 invented "Closed" days removed |
| 5 | Stock counts | Hidden shops no longer counted; no $0.00 prices |
| 15 | Search text | Apostrophes and ampersands folded; city chips carry their state |
| 16 | Duplicates | Matched by door, not name; 68 rows merged after review |
| 8 | Non-shop purge | 160 hidden: vape, glass, hookah and kava shops, makers, mobile lounges, a plumber |
| 8b | Pure cigar check | Every listing had to prove itself by name, stock or its own site; 2,480 hidden as "unproven" |
| 8c | Outlet chains | 321 hidden: Wild Bill's, Sweet Fire, Cheap Tobacco, The Tobacco Shoppe, grocery counters |
| 4 | Moved shops | 29 hidden at a door their own website no longer publishes |

The jobs behind these are in `server/src/jobs/`: `pureCigarCheck.js`,
`storefrontCheck.js`, `dedupeListings.js`, `movedShops.js`,
`recomputeTimezones.js`, `hoursSweep.js`, `hoursRender.js`, `siteFacts.js`,
`reimportTest.js`. Each has a `selftest` command or a self-test block; run them
before and after any change.

## 7. What is left, in the order I would do it

Each entry says what is wrong, how to judge it, and the traps that have already
caught me. Sizes are from the audit and from production today.

### 7.1 Search completeness (audit rank 12) — highest customer impact

`GET /stores` applies `LIMIT 300` *before* cutting to the radius, so dense metros
lose shops a few blocks away. Measured: a search from downtown Chicago at 25
miles returns **7 shops**; 131 listings cannot be found from their own doorstep
at 50 miles.

Fix in `server/src/routes/stores.js`: bounding-box prefilter with every SQL filter
applied, haversine distance computed in SQL, **no row cap** on the candidate set,
`openStatus` over the full set, sort by distance then id, return a total plus a
page of about 60 with "Show more". Cap the radius at 100 miles and answer "narrow
your search" above a ceiling instead of truncating silently. Only hours from the
shop's own site, its owner, staff or its chain count for "Open now"
(`hours_source`); say how many nearby shops have no confirmed hours. Client side:
`client/src/pages/Stores.jsx`.

Build the recall monitor the audit describes (62 metros by 4 radii by filters,
against a brute-force truth set, requiring 100%) and run it before and after. A
partial, untested start is on branch `sweep/search-and-menus`.

### 7.2 Pins, states and foreign rows (rank 9)

153 public pins sit more than 1 km from the Census geocode of their own address;
about 100 to 130 are real errors. Also 17 wrong-state or foreign rows, and 8
listings waiting in `sweeps/decisions/timezones_held.json` whose pin does not fit
the state they claim (their time zone was deliberately left alone).

Method: the free Census batch geocoder over every public address, with Nominatim
(one request per second) as a second opinion where they disagree by more than
1 km. Move a pin automatically only when all hold: an ordinary street (not US-,
SR-, FM, Hwy or Route), both geocoders agreeing within 250 m, both more than 1 km
from our pin, a move under 50 km, and the address backed by the shop's own site
or a chain feed. Everything else goes to a review list. Change a state only when
the ZIP prefix and one more signal agree, then recompute the zone with
`utils/storeHours.timeZoneFor`. Write through `utils/storeEdits.writeFields` with
source `geocode`, keeping the old coordinates in the decision file.

Named cases: Tobacco Junction of Marshall is 404 km off; Amsterdam Tobacco House
is pinned on Long Island; Black Jack's Cigar Lounge (El Paso) is listed in New
London, Connecticut. **Puro Estilo in Bethlehem, Pennsylvania must not be treated
as foreign.** On highway-style addresses the geocoder itself is wrong about 40%
of the time, so exclude them. Partial start: branch `sweep/pins`.

### 7.3 Links that lead somewhere else, and thumbnails (ranks 7, 19, 30)

About 318 public links end on a different domain than the one stored. Confirmed:
lapsed shop domains now serving gambling and for-sale pages, which also supply 14
thumbnails (Mike's Cigar Room shows a gambling banner). A live shop was once
hidden because a closure reader followed a redirect to a political blog.

Extend `server/src/jobs/linkCheck.js` with verdicts `elsewhere` (final domain
differs and the destination does not name the shop), `hijacked` (two or more
gambling terms and no cigar word), `parked` (a lander stub or for-sale template)
and `store_unavailable` (HTTP 402), all counting as dead. A hijacked or parked
own-domain is a weak closure signal for staff, never an automatic hide. Then
`thumbCheck.js` for the 968 thumbnails: status, content type, size, hot-link
behaviour, near-blank images, wide cropped banners, and one picture repeated
across unrelated shops. Partial start: branch `sweep/links`.

### 7.4 The hours we publish (ranks 6, 26)

The website hours scored 97.3% on a reviewed sample, and the remaining errors are
known: a sister branch's block, a host casino's hours, an office line, a lapsed
season, typos kept as impossible days, and two ranges in a day where only the
first is read. Tighten `mentionsShop` in `hoursSweep.js` (whole words; a domain
counts only with two of the name's words, or one distinctive word plus a trade
word) plus the parser fixes listed in the audit, then re-run `decide` on the
saved evidence and diff against production. **House of Cigar and Anthony's name
sibling towns and are correct: they must not be cleared.** Score any change with
`sweeps/scripts/score_all.js` against every reviewer verdict; accuracy must not
fall below 97.3%.

Separately, 405 listings with no hours have a readable three-day block on a page
already in the evidence. Partial start: branch `sweep/hours`.

### 7.5 Amenity badges from each shop's own site (rank 27)

`server/src/jobs/siteFacts.js` is written and tested, and was part-way through its
crawl when work stopped: 1,343 of 2,438 sites read, output in
`sweeps/decisions/site-facts/facts.jsonl`. It is resumable — rerun `read` and it
skips what it already has.

    node src/jobs/siteFacts.js read   --out sweeps/decisions/site-facts/facts.jsonl
    node src/jobs/siteFacts.js decide --from <facts.jsonl> --out <decisions.json>
    node src/jobs/siteFacts.js apply  --from <decisions.json> --confirm

It keeps the sentence each verdict rests on. A badge is added on a plain
statement, and removed only when the site is readable, names the shop, and never
mentions a lounge. 1,813 listings carry a Lounge badge today, many from a map
category alone.

### 7.6 The claim safety gate (rank 13), before claim emails are switched on

Instant claim trusts the domain of the stored website and nothing else, and about
480 listings have a dead domain anyone could buy and use to claim them. The full
condition list is in the audit's claims gap entry. A partial start, including a
vendored public suffix list, is on branch `sweep/claims`. **This only becomes
urgent when SMTP is configured; nothing can be claimed today.**

### 7.7 Menu scanner (rank 14)

36 of 43 shelves get no re-read in the next 30 days and no new shop is ever
reached, because a failed read never records an attempt. Add an attempt stamp on
every outcome, back off by outcome, expire stock after 21 days without a
successful read (set `in_stock = 0`, never delete), and attach a shared website's
feed only to the listing whose address the site names.

### 7.8 Closures and licence registries (ranks 10, 11)

The likely-closed flag rests on weak links: clean its inputs and extend it to
OpenStreetMap-only pins with no phone, no website, no hours, last edited before
2020, and no Overture record within 150 m. Never hide on this signal alone. Then
the free state licence registries (NYC, New York State, Texas, Florida,
California, Pennsylvania, Chicago, Washington) cover 2,850 listings and were the
only free signal that caught closures, renames and moves the other checks missed:
flag only, never hide, with a 60-day lag. **Stogies, BlackHouse and Manhattan
Tobacco are open and must not be flagged.**

### 7.9 Smaller ones

Stale former names (rank 17, overlapping the licences), chain branches (rank 18,
much smaller now the tobacco chains are off the map), and recovering real cigar
shops the classifier hid (rank 25 — publish only with evidence, per rule 2).

## 8. Traps this session hit, so you do not

- **Line endings.** Several server files use CRLF; Git Bash hides the carriage
  return, so a scripted multi-line replacement silently matches nothing. Check
  with node, and write back with the file's own endings.
- **Heredocs eat backslashes.** A bash heredoc collapsed doubled backslashes and
  wrote a real newline into a regex, corrupting two files. Use the editor tools
  for anything containing a backslash, then run `node --check`.
- **`db.run` uses `?` placeholders.** An apostrophe inside a SQL string literal
  broke a statement mid-run; pass values as parameters instead.
- **The menu scanner runs on the server every 6 hours** and writes `inventory`,
  which has no unique key: never run a manual menu sync at the same time.
- **The import only runs when the directory file changes,** so a bug in it stays
  invisible until the next data refresh. `reimportTest.js` is what catches it.
- **Do not trust one geocoder or one time-zone library.** A rounded grid put
  Kellogg, Idaho in Mountain time and Williston, North Dakota in the wrong zone;
  exact boundaries fixed both, and a public time API disagreed with both on a
  third town.

## 9. The first fifteen minutes

1. `git log --oneline -15`, then read `SWEEPS.md`.
2. `tar -xzf sweeps/evidence.tar.gz -C sweeps/`.
3. Check you can reach production: write a two-line script that counts
   `visible = 1` and run it through `prod.js`.
4. Run the self-tests: `node src/utils/hoursParser.js`,
   `node src/utils/storeHours.js`, `node src/jobs/dedupeListings.js selftest`,
   `node src/jobs/pureCigarCheck.js selftest`, and
   `PGLITE_DIR=/tmp/x node src/jobs/hoursSweep.js selftest`.
5. Take the next sweep from section 7, in order: dry run, read the output by
   hand, remove the false positives, apply the saved file, update `SWEEPS.md`,
   commit.

## 10. What to ask Mason when it matters

- A Google Places API key and budget, for the closures and hours no free source
  settles. Everything so far was done without paid data.
- Whether any outlet chain should come back: Wild Bill's (198 listings), Sweet
  Fire (61), Cheap Tobacco (32), The Tobacco Shoppe (21). Each is one command.
- Anything that would publish listings we cannot show are cigar shops: rule 2
  says no by default.
