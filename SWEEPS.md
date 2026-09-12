# Store data sweeps: what is done, what is running, what is left

The ranked plan is in [WORKLOG.md](WORKLOG.md) ("Store data audit: the next sweeps,
ranked"); numbers below are its ranks. Every sweep is built, dry-run, reviewed by
hand, then applied from the reviewed file. Nothing is applied straight from a
fresh read.

**Updated 2026-09-11, 20:30. Public listings: 4,377** (from 7,431 at the start).

**Scope, set by Mason:** pure cigar and pipe-tobacco shops. Cigarettes on the side
are fine; a vape, glass, hookah or kava shop that happens to sell cigars is not in
this directory. **When in doubt the listing stays off the map**, rather than making
the site look like a junk directory. Hidden is never deleted: every hide carries
its reason and is reversible.

## Where the work lives (read this first if you are picking up)

- **Saved state, outside the session temp folder:** `server/data/sweeps/`
  (gitignored, so it persists on disk but is not committed).
  - `decisions/` - every decision file produced so far, applied and unapplied.
  - `evidence/` - the expensive crawls: hours evidence for every shop website,
    the browser-rendered passes, chain store pages and locator feeds, and the
    reviewer verdicts used to score accuracy. Regenerating these costs hours.
  - `scripts/` - the runners: `prod.js` (runs a script against production's
    database through `railway run`), `offline.js`, `score_all.js`,
    `build_seed_db.js`, the snapshot dumps, `render_one.js`.
  - `plan.json`, `plan_1_16.txt` - the audit's full findings and methods.
- **Production writes** go through, from the `server/` directory:
  `railway run --service Postgres node data/sweeps/scripts/prod.js <script.js>`.
  Reading Railway variables is blocked; `railway run` injects them.
- **A local copy of production** for dry runs: re-dump with `dump_audit.js` and
  `dump_tables.js`, then `PGLITE_DIR=<empty dir> node data/sweeps/scripts/build_seed_db.js`.

## Done, and live in production

| # | Sweep | What changed |
|---|-------|--------------|
| 1 | Make fixes stick | Per-field provenance (`stores.field_sources`) and an edit log (`store_edits`); the import refreshes only what the directory still owns and treats our closures as binding; the storefront sweep no longer overwrites a closure (491 restored); chain closures use the standard status; Boatyard Tobacco reopened. `reimportTest.js` seeds eight kinds of correction and checks all survive a forced re-import |
| 2 | Time zones | Real zone boundaries (geo-tz) instead of longitude rules: 153 listings moved, 27 public, all of Chattanooga among them |
| 3 | Map-only hours | Hours from map data show "not confirmed" with no Open or Closed badge; 121 invented "Closed" days removed |
| 5 | Stock counts | 741 cigar lines no longer count stock at hidden shops; no $0.00 prices; 2,790 stock rows at hidden shops marked out of stock |
| 15 | Search text | Apostrophes and "&" folded ("wild bills" 2 to 215 matches); city chips carry their state |
| 16 | Duplicates | Matched by door, not name: 42 automatic merges, then 25 of the 28 held clusters after review (68 rows hidden) |
| 8 | Non-shop purge | 160 hidden: vape, hookah, kava, glass and novelty shops, makers and leaf companies, lounges on wheels, rolling services, humidor catalogues, cigarette outlets, anti-smoking bodies, a plumber |
| 8b | Pure cigar check | Every listing had to prove itself by name, stock or its own website: 2,480 hidden as "unproven". A browser pass first rescued 60 whose sites are built in JavaScript |
| 8c | Outlet chains | 321 hidden: Wild Bill's, Sweet Fire, Cheap Tobacco, The Tobacco Shoppe, and tobacco counters inside Brookshire Brothers grocery stores |
| 4 | Moved shops | 29 listings hidden at a door their own website no longer publishes, 6 saying plainly that they moved |

Earlier in the programme, also live: hours read from 1,077 shop websites,
thumbnails for 1,427 listings, Bitcoin ATM listings hidden, and five wrong-site
hours cleared (a grout company, a county government, a petrol station, two
Yahoo pages).

## Running right now

**Six sweeps building in parallel**, each on its own git branch in this repo,
each producing code, tests and decision files. None of them writes to production.

| Branch | Sweeps | What it produces |
|--------|--------|------------------|
| `sweep/pins` | 9 | Pins more than 1 km from their address, wrong states, foreign rows; settles the 8 held in `decisions/timezones_held.json` |
| `sweep/links` | 7, 19, 30 | Taken-over, parked and redirected links; links to the wrong business; thumbnail vetting |
| `sweep/hours` | 6, 26 | Re-audit of the website hours we publish, and hours recovered from pages already downloaded |
| `sweep/search-and-menus` | 12, 14 | Distance-first search with no row cap (a Chicago search returns 7 shops within 25 miles today), and the menu scanner's back-off and stock expiry |
| `sweep/claims` | 13 | The claim safety gate, needed before claim emails are switched on |
| `sweep/closures` | 10, 11 | Likely-closed rules, and the free state licence registries |

**Plus one crawl running here:** `siteFacts.js` is reading 2,438 shop websites
for the Lounge badge, a walk-in humidor, members-only and drive-thru, keeping
the sentence each verdict rests on. Output: `decisions/site-facts/facts.jsonl`.

### To finish any of them

    git merge sweep/<name>            # then read the diff
    node src/jobs/<job>.js <step> --from <file> --out <file>    # dry run
    # read the output by hand and drop the false positives
    railway run --service Postgres node data/sweeps/scripts/prod.js <apply runner>

Each stream leaves a README beside its decision files saying what to check.
Every sweep so far produced false positives on its first run; finding them by
reading the output is the work, not an optional extra.

## Left after that

| # | Sweep | Size |
|---|-------|------|
| 27 | Amenity badges from the crawl above | 1,813 lounge badges today, many resting on a map category alone |
| 17 | Stale former names and rebrands | 55-75, overlaps the licence registries |
| 18 | Chain branches: missing, renamed, badges | Much smaller now the tobacco-outlet chains are off the map |
| 25 | Real cigar shops hidden by the classifier | At least 75, but the conservative rule means publishing only with evidence |

## Decisions Mason still owes

- A Google Places key and budget, for the closures and hours no free source settles.
- Whether any outlet chain should come back (Wild Bill's, Sweet Fire, Cheap
  Tobacco, The Tobacco Shoppe): one command each.

## Working rules

- Read-only dry run, read the output by hand, then apply the saved file.
- When in doubt, off the map; hidden is never deleted and always carries a reason.
- Claimed and staff-edited listings are never touched by a sweep.
- Verdicts the import honours: `not_retail`, `online_only`, `closed`,
  `duplicate`, `moved`, `unproven`, and any `permanently_closed` status.
