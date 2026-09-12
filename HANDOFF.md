# Handoff: instructions for the next session

**Every sweep in this programme has now been run against production.** What is
left is judgement work on lists a person has to read, plus two things blocked on
data this repository does not hold. This file is your work order. Read it, then
start at "Your next task".

Written 2026-09-12, revised twice the same day: once by a cloud session that had
no credentials and built the jobs, and once by the session that ran them all.
The version before this one (`git show 00b2d75:HANDOFF.md`) described eight
tasks waiting to be run; they are done, and what running them changed is
recorded in `SWEEPS.md` under "The session of 2026-09-12 (evening)".

**Production, 2026-09-12 evening: 4,363 public listings.** 930 with hours (783
from the shop's own site), 806 with a thumbnail, 2,149 with a lounge badge, 404
with a walk-in humidor, 216 stamped by a current tobacco licence, and no public
listing linking to a gambling or parking page.

---

## The one thing to understand before anything else

**Reading the output is the work.** Every job in `server/src/jobs/` is written,
tested and deployed, and each one still had something wrong with it that only
showed up when somebody read what it produced against real listings. Seven such
faults were found and fixed in one evening — including three jobs whose central
rule was not running at all:

- `linkCheck` had `pageIdentity`, `namesShop` and `looksHijacked` written and
  tested, and **never called them**. Every gambling takeover on the map read as
  a working link, and the self-test passed.
- `recoverHidden` proposed bringing back 320 outlet-chain listings, each
  "proved" by the chain's own website — the page that took it off the map.
- `thumbCheck` counted any two shops sharing the word "cigars" as one business,
  which made its shared-image check nearly inert.

So: **run a job, then read fifty of its rows by hand before applying anything.**
The dry run is not the check; your reading is. Every false positive found this
way is written into a self-test so it cannot come back.

Check what you have before you plan anything:

```bash
railway whoami                 # or: echo "$RAILWAY_TOKEN"
curl -sS -o /dev/null -w '%{http_code}\n' https://geocoding.geo.census.gov/
node sweeps/scripts/selftest_all.js          # expect 880 assertions, 0 failed
```

**Running a job against production.** `sweeps/scripts/prod.js` requires its
target, so a job's own `require.main` block never fires and its subcommands are
unreachable. Use `prodrun.js`, which starts the job as a real child process with
`DATABASE_URL` pointed at the public proxy:

```bash
railway run --service Postgres node sweeps/scripts/prodrun.js src/jobs/<job>.js <subcommand> [args]
# paths inside the job's arguments are relative to server/, so: --out ../sweeps/decisions/x.json
```

`prod.js` is still the right wrapper for a one-off script of your own:

```bash
railway run --service Postgres node sweeps/scripts/prod.js <absolute path to your script>
```

## Your next task

In this order. None of these changes what a customer sees by itself — they are
all lists somebody has to read.

| Order | Task | Why it is next |
|-------|------|----------------|
| 1 | [The 963 category-only badges](#1-the-963-category-only-badges) | The largest remaining claim on the map that rests on nothing a person has checked |
| 2 | [The pin review list](#2-the-pin-review-list) | 59 rows, and 16 of them need no move at all |
| 3 | [Licence renames and moves](#3-licence-renames-and-moves) | 57 shops trading under another name, 146 licensed at another address |
| 4 | [The four manual registries](#4-the-four-manual-registries) | Florida, California, Pennsylvania and Washington, by hand |
| 5 | [The Overture dedupe change](#5-the-overture-dedupe-change) | Blocked on a file that is not in the repository |
| 6 | [Watch the menu scanner](#6-watch-the-menu-scanner) | It has never had a real 24 hours |

---

## 1. The 963 category-only badges

**What they are.** 963 public listings carry a lounge or walk-in-humidor badge
that came from a map category — Overture's `cigar_bar`, mostly — and nothing
else. The amenity crawl read 2,408 shop websites and could put a sentence behind
344 lounges and 331 humidors; these are the ones it could not.

They are listed under `categoryOnly` in
`sweeps/decisions/site-facts/decisions.json`, with what the map said and what
the site did say.

**The decision to make.** A badge with no sentence behind it is a claim we
cannot support. Three honest options, in the order they cost:

1. Clear them. A shop with a lounge loses its badge until its site says so.
2. Keep them, and mark them in the UI as coming from map data, the way
   unconfirmed hours already are.
3. Read them — 963 rows is perhaps four hours of work with the crawl's text in
   front of you.

**This is Mason's call**, and it is in `SWEEPS.md` under "Decisions Mason still
owes". Do not clear 963 badges on your own initiative.

## 2. The pin review list

59 rows in `sweeps/decisions/pins/pins_review.json`, each with the reasons it
was held. **Sixteen say "Nominatim agrees with the pin we already have"** — for
those the Census was wrong and there is nothing to do but mark them settled.
The rest are a geocoder disagreement, a highway address, or a non-exact match.

To apply any you decide to move, write `"verdict": "move"` on the row and:

```bash
railway run --service Postgres node sweeps/scripts/prodrun.js src/jobs/geocodePins.js apply --from ../sweeps/decisions/pins/<file>.json --confirm
```

**Guardrails are unchanged.** A highway address is excluded outright: the
geocoders are wrong about 40% of the time there. **Puro Estilo in Bethlehem,
Pennsylvania is not foreign** whatever its name or its Israeli mobile suggests.

## 3. Licence renames and moves

`sweeps/decisions/licences.json` holds two lists the apply step deliberately
does not touch:

- **renamed (57)** — the current licence at this door is under another trading
  name. Some are only the legal entity ("E&A Cigars" → "E & A CIGARS LLC") and
  mean nothing; others are a real rebrand ("TJ's Cigar Lounge" → "TOBACCO
  JUNCTION"). `stores.name_aliases` exists to hold the old name, and search
  already reads it.
- **moved (146)** — the licence for this business is at a different address.
  Cross-check against `sweeps/decisions/pins/pins_review.json` before believing
  either one.

**A lapse is never a hide.** 202 listings have no current licence; 54 were noted
for staff and none were hidden. A self-test asserts there is no verdict in that
job that hides a listing. Keep it that way.

## 4. The four manual registries

`licenceSync fetch` prints the URL for each. Save the file into
`sweeps/decisions/licences/` under the name it asks for (`fl.csv`, `ca.csv`,
`pa.csv`, `wa.csv`), then re-run `match`. Between them they cover roughly 2,100
listings that four registries cannot currently speak for.

The four that work are NYC (6,699 licences), New York State (22,091), Texas
(59,603) and Chicago (59,414). **Their dataset ids move**: all four broke
between the day they were written and the day they were first run. If one
answers 400 or 404, find the new id rather than dropping the registry —
`sweeps/scripts/socrata_find.js` searches a Socrata domain by keyword, and
`socrata_peek.js` prints one row so the column names can be read.

## 5. The Overture dedupe change

Unchanged and still blocked. `sweeps/plan.json` (duplicates, items 2 and 3) asks
`buildDirectory` to let one Overture record absorb *every* OSM record of the
same shop rather than stopping at the first (the `!t.osm_id` guard), emit an
`also_osm_ids` list, and have the importer hide any older OSM row those ids
name. Both are small changes. Neither can be made here, because
`server/data/overture_raw.json` is gitignored and a rebuild without it produces
an OSM-only file — which is how the directory got destroyed once already.

Get the Overture extract, then make the change, then rebuild and diff the record
count before importing anything.

The other half of this — merging the twins that already exist — is done and
wired up: `dedupeListings.mergeAutomatic` runs after every import on the auto
tier only. Its first production run merged six doors, all six genuinely one shop
listed twice.

## 6. Watch the menu scanner

Still true, and still worth a look: its back-off and staleness ordering are
deployed and a 30-day replay proves every shop gets reached, but it has only
ever run against a model. Watch the first real 24 hours.

---

## Reference: the owner's rules, which outrank anything else

1. **Pure cigar and pipe-tobacco shops only.** Cigarettes on the side are fine; a
   vape, glass, hookah or kava shop that happens to sell cigars is not in this
   directory. "Mary Jane's House of Glass" is the type to exclude.
2. **When in doubt, off the map.** If we cannot show a listing is a cigar shop,
   open, at the address we hold, it stays hidden rather than making the site look
   like a junk directory. Hidden is never deleted: every hide records its reason
   and is reversible.
3. **Claimed and staff-edited listings are never touched by a sweep.**
4. **Ask Mason** before publishing anything we cannot show is a cigar shop, or
   before spending money.

On rule 4 and judgement calls: Mason has said he would rather a session **make
the call and document it** than stop and ask, for anything that is not spending
money or publishing unproven listings. Two calls were made on that basis on
2026-09-12 (paid placement, and the no-location order) — both are written up in
`SWEEPS.md` with the reasoning and the constants to change. **Still his, not
yours:** a Google Places budget, and whether any outlet chain comes back.

## Reference: what this project is, and where it stands

CigarBuddy is a cigar-shop finder: an Express + Postgres API in `server/`, a
React/Vite client in `client/`, deployed on Railway (**a push to `master`
deploys**). Its directory came from Overture Maps and OpenStreetMap, so it
arrived full of listings that are not cigar shops, shops that have closed or
moved, wrong pins, wrong hours and dead links.

Production today:

- **4,363 public listings**, from 7,431 at the start. About 38,560 further rows
  are hidden, each with a verdict and a reason.
- 930 hold hours; 783 of those were read from the shop's own website. The rest
  show map hours labelled "not confirmed", or nothing.
- 806 have a thumbnail, after 159 were taken down as too small, banner-shaped,
  blank, dead or somebody else's. 2,149 carry a Lounge badge and 404 a walk-in
  humidor — 675 of those now rest on a sentence from the shop's own site, and
  963 still rest on a map category alone (task 1 above).
- 216 are stamped by a current tobacco licence at the door.
- Verdicts the importer honours, so a data refresh cannot undo them:
  `not_retail`, `online_only`, `closed`, `duplicate`, `moved`, `unproven`, and
  any `operating_status = 'permanently_closed'`.

**Live in production and done — do not redo:** field provenance and an edit log,
time zones from real boundaries, map-only hours shown as unconfirmed, stock
counts excluding hidden shops, search text folding, duplicate merging, the
non-shop purge, the pure-cigar check, outlet chains, and moved shops.
`SWEEPS.md` has the numbers for each.

**Run against production on 2026-09-12 (evening):** all eight tasks of the
previous handoff — hours, links, thumbnails, pins, amenities, licences,
recovery and duplicates. `SWEEPS.md` has the numbers and the seven rules that
reading the output corrected.

**Live for customers right now, because it is pure code.** Each of these is a
sweep from `sweeps/plan.json` whose sources are code only; each was measured
against a database built from the committed directory (42,928 listings, 7,904
public), never against the synthetic fixture:

- **Search returns every shop in range.** `GET /stores` used to take 300 rows in
  placement order and only then cut to the radius, so a dense metro silently
  lost shops a few blocks away. Recall went 89.96% → 100.00% over 1,984 cases.
- **The map draws every pin.** `GET /stores/map` groups in the database. The map
  asked the list for 1,000 rows and clustered those in the browser, so the
  national view drew 1,000 of 7,904, every bubble's count came from that
  thousand — a bubble marked 84 could open onto nine shops — and the header said
  "1000+ stores in view". Fifteen viewports now account for every listing in the
  box, exactly (`sweeps/scripts/map_viewports.js`).
- **Search matches the way people type.** Accents fold by Unicode decomposition,
  St/Saint and Mt/Mount fold as whole words, trademark badges and emoji drop,
  and other alphabets are left intact so a shop named in Arabic stays searchable
  by its own letters. `sweeps/scripts/fold_parity.js` runs the SQL half and the
  JavaScript half against each other in the engine over 42 cases.
- **The duplicate matcher.** Measured against the 13 pairs the audit named and
  the 4 it warns must never merge: 122 clusters proposing 125 drops, against 116
  and 119 before. It also fixes a false positive the plan names — the "two
  shared words" shortcut counted two *generic* words, so "Cigar City Brewing"
  matched "Cigar City Cigars".
- **Corrections survive the import.** `node src/jobs/reimportTest.js` seeds every
  kind of correction, forces a re-import and checks all 16 are still there.
- **Staff can see and undo things.** `/admin/listings` covered `source = 'osm'`
  only: a page of 500 rows showed 9 listings and hid 491 Overture ones, so most
  of the directory could not be reviewed at all. A claim can be taken back. The
  claim card carries the evidence a decision rests on. Phone and website have a
  staff editor.
- **`destinationKind` called all 23,972 stored websites ordinary sites** — it
  ran `new URL()` on a column that stores bare hosts. With the scheme supplied:
  2,011 platform links, 878 social, 4 parked. Those 2,893 listings have
  something other than the shop's own site in the website field and no verdict
  would ever have flagged them, because the links work. They are in the staff
  queue under `kind=link`.
- **The Request button did nothing** — it set React state that nothing rendered.
- **The no-location list and paid placement** — see `SWEEPS.md`.

## Reference: reaching production, and working locally

From `server/`:

```bash
railway run --service Postgres node data/sweeps/scripts/prod.js <script.js>
```

`prod.js` maps `DATABASE_PUBLIC_URL` to `DATABASE_URL`, runs migrations, then
requires the script you name. Reading `railway variables` is blocked by the
tooling; `railway run` injects them, which is enough. A cloud environment needs
`railway login` or a `RAILWAY_TOKEN`.

**Two local options, and the second is usually what you want:**

```bash
# A real copy of production, if you have credentials:
railway run --service Postgres node data/sweeps/scripts/prod.js data/sweeps/scripts/dump_audit.js
railway run --service Postgres node data/sweeps/scripts/prod.js data/sweeps/scripts/dump_tables.js
PGLITE_DIR=/tmp/cbseed node data/sweeps/scripts/build_seed_db.js

# The bundled directory, which needs nothing (see the checklist above):
PGLITE_DIR=/tmp/cb node src/index.js
```

**Never run a job without `PGLITE_DIR` set** on the original Windows machine:
the default local database there is corrupt. Copy the directory per parallel
job; PGlite allows one writer at a time.

Headless Chrome is needed only for sites built in JavaScript
(`npm i --no-save puppeteer-core` plus a Chrome binary; `CHROME_PATH` overrides
the location). Where it is unavailable, skip the render passes and say so —
never hide a shop for having a JavaScript site.

## Reference: what is in the repository

- **`PROGRESS.md`** — the 2026-09-12 session's own log: what it did, what it got
  wrong and corrected, and every number it measured. Read it before arguing with
  any decision below.
- **`SWEEPS.md`** — the running production log, plus the two judgement calls in
  full.
- **`sweeps/decisions/`** — every decision file, applied and unapplied:
  - `hours/` — **the ones waiting for you.** 42 to clear, 8 to replace, 16 held,
    8 chain rows that need re-running, 292 recovery candidates of which 56 are
    real.
  - `site-facts/sentence_review.json` — the 7 wrong amenity verdicts and the 65
    whose evidence was truncated.
  - `recover/` — the 2,480 hidden listings split by what evidence would bring
    each back.
  - `search-and-menus/` — recall reports and the metro diff.
  - `timezones_held.json` — settled by `geocodePins`; see task 4.
- **`sweeps/evidence.tar.gz`** — hours evidence for every shop website, the
  browser-rendered passes, chain pages and locator feeds, and the reviewer
  verdicts used to score accuracy. **These cost hours of crawling. Reuse them
  before re-fetching anything.**
- **`sweeps/scripts/`** — `prod.js`, `hours_offline.js` (the hours harness,
  rebuilt to work from the committed files), `metro_diff.js`, `before_recall.js`,
  `build_fixture_db.js`, the snapshot dumps, and four added in the revision:
  - **`selftest_all.js`** — runs every self-test and prints one total. **Use
    this.** 850 assertions across 23 suites, 0 failed, as of this file.
  - **`fold_parity.js`** — the SQL and JavaScript halves of the search fold,
    against each other, in the database engine. A difference between them is a
    search that matches nothing rather than one that errors, so no
    JavaScript-only test can catch it.
  - **`map_viewports.js`** — for 15 viewports, the pins plus every bubble's
    count must equal the listings in the box. It also checks the SQL grouping
    against the JavaScript one used for "open now".
  - `server/src/utils/storeMap.js` is the map endpoint's logic, alongside
    `storeList.js`, so both can be replayed without HTTP.
- **`sweeps/plan.json`** — the full audit: `.plan.sweeps[]` ranked, `.audits[]`
  and `.gaps[]` with the ids and examples behind every claim.

**The `sweep/*` branches are merged and can be deleted.** The 2026-09-12 session
read all five, adopted three whole, took one rule from a fourth, and superseded
the fifth; `PROGRESS.md` has the table of what came from where. It could not
delete them itself — the cloud git proxy refuses any ref push that is not a
branch create or update. One command from a normal machine:

```bash
git push origin --delete sweep/claims sweep/hours sweep/links sweep/pins \
  sweep/search-and-menus __reftest
```

`__reftest` is litter from that session's diagnosis of the same limitation.
Before you delete, note that **`sweep/search-and-menus` is the only branch whose
code is not in master** — it was superseded, not adopted.

**Every job answers to `selftest`.** `geocodePins` also answers to `applytest`,
and `recallMonitor` to `contract`. Run them before and after you touch anything:

```bash
node sweeps/scripts/selftest_all.js          # 850 assertions, 23 suites
node src/jobs/reimportTest.js                # from server/: 16 checks
```

`selftest_all.js` reads each file before launching it and skips any that does
not declare a `selftest` handler. That is not fussiness — see the trap about it
in section 5.

---

## Reference: traps, so you do not hit them again

- **`git branch -a` lies in a fresh clone.** It lists only what has been fetched.
  The 2026-09-12 session reported five branches as missing on that basis and had
  to be corrected. Use `git ls-remote --heads origin`.
- **The cloud git proxy only allows branch creates and updates.** Tag pushes and
  ref deletes come back HTTP 403, and the GitHub API tools available in that
  environment have no delete-branch call.
- **Line endings.** Several server files use CRLF on the Windows machine; Git
  Bash hides the carriage return, so a scripted multi-line replacement silently
  matches nothing. A Linux clone normalises them, so this trap is Windows-only.
  Check with node, and write back with the file's own endings.
- **A helper that is never called passes every test.** `linkCheck` had three
  identity checks, twenty assertions covering them, and no call site. Test the
  wiring, not only the rule: `judgePage` exists as one pure function so that
  the path from a downloaded page to a verdict is itself asserted.
- **Heredocs eat backslashes, and the damage is invisible.** A quoted bash
  heredoc turned `\b` into a real backspace byte (0x08) inside two regexes on
  2026-09-12, which silently disabled both: the file parses, the tests pass,
  and the rule never matches anything. Use the editor tools for anything
  containing a backslash, then `node --check` AND scan for control bytes:
  `grep -rlnP "\x08" server/src client/src sweeps/scripts`.
- **`db.run` uses `?` placeholders.** An apostrophe inside a SQL string literal
  broke a statement mid-run; pass values as parameters.
- **The menu scanner runs on the server every 6 hours** and writes `inventory`,
  which has no unique key: never run a manual menu sync at the same time.
- **The import only runs when the directory file changes,** so a bug in it stays
  invisible until the next data refresh. `node src/jobs/reimportTest.js` is what
  catches it — run it after touching `importStores.js`.
- **Do not trust one geocoder or one time-zone library.** A rounded grid put
  Kellogg, Idaho in Mountain time and Williston, North Dakota in the wrong zone.
  And a prefix test for a foreign clock cannot see that `America/Toronto` is
  Canadian — that bug was found and fixed on 2026-09-12.
- **A test that has never been run is not a test.** All five `sweep/*` branches
  shipped with tests that had never executed, and running them found five real
  bugs — one of which would have left the automatic pin move dead on arrival.
- **Never run a file to find out whether it is a test.** The first version of
  `sweeps/scripts/selftest_all.js` did `node <file> selftest` over everything in
  `jobs/` and `utils/`. Most jobs ignore an argument they do not recognise and
  get on with their work, so that run did not test `buildDirectory.js` — it
  *ran* it, and `buildDirectory` rebuilds
  `server/src/data/store_directory.json.gz` in place. With no network reachable
  it wrote what it could, and the 3.7 MB national directory of 42,928 listings
  became a 310 KB stub. It was restored with `git checkout` and verified against
  HEAD's checksum, but only because it is committed. The script now reads each
  file's source and launches nothing that does not declare the handler. If you
  add a runner of any kind, make it do the same.
- **PGlite allows one connection.** Opening a scratch database with `node -e`
  while the server holds the same `PGLITE_DIR` aborts the second process with
  `Aborted()`. Stop the server, or check through the API.
- **`new URL()` throws on a bare host,** and the `stores.website` column stores
  bare hosts. Three functions had a `try/catch` that quietly returned a
  plausible default for all 23,972 of them. If you parse a URL from that
  column, add the scheme first.
- **The synthetic fixture is too small to catch ceiling bugs.** `CANDIDATE_CEILING`
  was set to 5,000 against a 3,636-row fixture and broke the nationwide list at
  7,904 public rows. Measure against a database built from the committed
  directory (`node src/index.js` does it with no credentials) and say which of
  the two any number came from.

## Reference: what to ask Mason

### One command for him to run

The five `sweep/*` branches are merged and the work is on `master`. They cannot
be deleted from a cloud session — the git proxy refuses any ref push that is not
a branch create or update, so a delete comes back HTTP 403, and the GitHub tools
available here have no delete-branch call. From a normal machine:

```bash
git push origin --delete sweep/claims sweep/hours sweep/links sweep/pins \
  sweep/search-and-menus __reftest
```

`__reftest` is litter from diagnosing that limitation. **Before running it:**
`sweep/search-and-menus` is the only one of the five whose code is *not* in
`master` — it was superseded rather than adopted, so that deletion is the one
that actually loses a version. `PROGRESS.md` has the table of what came from
which branch. Nothing in the repository depends on any of them.

### The rest

- **A Google Places API key and budget**, for the closures and hours no free
  source settles. Everything so far was done without paid data. This is the only
  item on this list that is genuinely blocked on him.
- **Whether any outlet chain should come back:** Wild Bill's (198 listings),
  Sweet Fire (61), Cheap Tobacco (32), The Tobacco Shoppe (21). Each is one
  command. Rule 4 makes this his call, not a session's.
- **Whether the paid-placement prices and reach match what he wants to sell** —
  $49 for 15 miles, $149 for 50. The mechanism is built and documented; the
  numbers are commercial.
- **Not questions any more:** paid placement's shape and the no-location order,
  decided on 2026-09-12 at his request. Plus, decided in the revision because he
  asked for judgement rather than questions, each written up in `SWEEPS.md` with
  what to change to reverse it:
  - Requests on unclaimed listings are **collected**, and the dialog says they
    cannot reach the shop yet, rather than the tile being hidden.
  - A website nobody has checked stays a **live link**; only an address somebody
    has just changed is withheld, under a new `checking` verdict. Rendering
    unchecked as unclickable would have emptied the website line on 5,214 of the
    5,214 public listings that have one.
  - Which owner edits go live instantly: hours, phone and website, each with its
    checks re-run; an address change re-geocodes and recomputes the time zone.
  - The dead domain is **no longer named** in the unclaimed banner, since the
    page has already withheld the link.

## Reference: keep the log

After each task: update `SWEEPS.md` with what changed in production and the
numbers, and commit. If you stop part-way, say in `SWEEPS.md` exactly where you
are, as this file does. **The next session should never have to reconstruct it** —
and should never have to guess whether a number describes production, a local
copy, or a fixture. Say which.
\x08' server/src client/src sweeps/scripts`.
- **`db.run` uses `?` placeholders.** An apostrophe inside a SQL string literal
  broke a statement mid-run; pass values as parameters.
- **The menu scanner runs on the server every 6 hours** and writes `inventory`,
  which has no unique key: never run a manual menu sync at the same time.
- **The import only runs when the directory file changes,** so a bug in it stays
  invisible until the next data refresh. `node src/jobs/reimportTest.js` is what
  catches it — run it after touching `importStores.js`.
- **Do not trust one geocoder or one time-zone library.** A rounded grid put
  Kellogg, Idaho in Mountain time and Williston, North Dakota in the wrong zone.
  And a prefix test for a foreign clock cannot see that `America/Toronto` is
  Canadian — that bug was found and fixed on 2026-09-12.
- **A test that has never been run is not a test.** All five `sweep/*` branches
  shipped with tests that had never executed, and running them found five real
  bugs — one of which would have left the automatic pin move dead on arrival.
- **Never run a file to find out whether it is a test.** The first version of
  `sweeps/scripts/selftest_all.js` did `node <file> selftest` over everything in
  `jobs/` and `utils/`. Most jobs ignore an argument they do not recognise and
  get on with their work, so that run did not test `buildDirectory.js` — it
  *ran* it, and `buildDirectory` rebuilds
  `server/src/data/store_directory.json.gz` in place. With no network reachable
  it wrote what it could, and the 3.7 MB national directory of 42,928 listings
  became a 310 KB stub. It was restored with `git checkout` and verified against
  HEAD's checksum, but only because it is committed. The script now reads each
  file's source and launches nothing that does not declare the handler. If you
  add a runner of any kind, make it do the same.
- **PGlite allows one connection.** Opening a scratch database with `node -e`
  while the server holds the same `PGLITE_DIR` aborts the second process with
  `Aborted()`. Stop the server, or check through the API.
- **`new URL()` throws on a bare host,** and the `stores.website` column stores
  bare hosts. Three functions had a `try/catch` that quietly returned a
  plausible default for all 23,972 of them. If you parse a URL from that
  column, add the scheme first.
- **The synthetic fixture is too small to catch ceiling bugs.** `CANDIDATE_CEILING`
  was set to 5,000 against a 3,636-row fixture and broke the nationwide list at
  7,904 public rows. Measure against a database built from the committed
  directory (`node src/index.js` does it with no credentials) and say which of
  the two any number came from.

## Reference: what to ask Mason

### One command for him to run

The five `sweep/*` branches are merged and the work is on `master`. They cannot
be deleted from a cloud session — the git proxy refuses any ref push that is not
a branch create or update, so a delete comes back HTTP 403, and the GitHub tools
available here have no delete-branch call. From a normal machine:

```bash
git push origin --delete sweep/claims sweep/hours sweep/links sweep/pins \
  sweep/search-and-menus __reftest
```

`__reftest` is litter from diagnosing that limitation. **Before running it:**
`sweep/search-and-menus` is the only one of the five whose code is *not* in
`master` — it was superseded rather than adopted, so that deletion is the one
that actually loses a version. `PROGRESS.md` has the table of what came from
which branch. Nothing in the repository depends on any of them.

### The rest

- **A Google Places API key and budget**, for the closures and hours no free
  source settles. Everything so far was done without paid data. This is the only
  item on this list that is genuinely blocked on him.
- **Whether any outlet chain should come back:** Wild Bill's (198 listings),
  Sweet Fire (61), Cheap Tobacco (32), The Tobacco Shoppe (21). Each is one
  command. Rule 4 makes this his call, not a session's.
- **Whether the paid-placement prices and reach match what he wants to sell** —
  $49 for 15 miles, $149 for 50. The mechanism is built and documented; the
  numbers are commercial.
- **Not questions any more:** paid placement's shape and the no-location order,
  decided on 2026-09-12 at his request. Plus, decided in the revision because he
  asked for judgement rather than questions, each written up in `SWEEPS.md` with
  what to change to reverse it:
  - Requests on unclaimed listings are **collected**, and the dialog says they
    cannot reach the shop yet, rather than the tile being hidden.
  - A website nobody has checked stays a **live link**; only an address somebody
    has just changed is withheld, under a new `checking` verdict. Rendering
    unchecked as unclickable would have emptied the website line on 5,214 of the
    5,214 public listings that have one.
  - Which owner edits go live instantly: hours, phone and website, each with its
    checks re-run; an address change re-geocodes and recomputes the time zone.
  - The dead domain is **no longer named** in the unclaimed banner, since the
    page has already withheld the link.

## Reference: keep the log

After each task: update `SWEEPS.md` with what changed in production and the
numbers, and commit. If you stop part-way, say in `SWEEPS.md` exactly where you
are, as this file does. **The next session should never have to reconstruct it** —
and should never have to guess whether a number describes production, a local
copy, or a fixture. Say which.
