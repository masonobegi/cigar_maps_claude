# Store data sweeps: what is done and what is left

The ranked plan is in [WORKLOG.md](WORKLOG.md) ("Store data audit: the next sweeps,
ranked"). Numbers below are that plan's ranks. Each sweep is built, dry-run,
reviewed, then applied from the reviewed file. Nothing is applied straight from a
fresh read.

Updated 2026-09-11. Public listings: 4,429.

**Scope, set by Mason:** pure cigar and pipe-tobacco shops. Cigarettes on the side
are fine; a glass, vape, hookah or kava shop that happens to sell cigars is not in
this directory, whatever it carries.

## Done

| # | Sweep | What changed in production |
|---|-------|-----------------------------|
| 1 | Make fixes stick | Field provenance + edit log; import refreshes only directory-owned fields; storefront sweep no longer overwrites closures (491 restored); chain closures use the standard status (7); Boatyard Tobacco reopened; re-import test, 10 of 10 |
| 2 | Time zones | Real boundaries instead of longitude rules: 153 listings moved, 27 public, all of Chattanooga included |
| 3 | Map-only hours | 234 listings show "from map data, not confirmed" with no badge; 121 invented Closed days removed |
| 5 | Stock counts | 741 cigar lines no longer count stock at hidden shops; no more $0.00 prices; 2,790 rows marked out of stock |
| 15 | Search text | Apostrophes and "&" folded ("wild bills" 2 → 215 matches); city chips carry their state |
| 16 | Duplicates | Matching by door, not name: 42 plain merges applied, 28 clusters left for review |
| 8c | Outlet chains judged on their own sites | 321 hidden: Wild Bill's (198), Sweet Fire (61), Cheap Tobacco (32), The Tobacco Shoppe (21) and 9 tobacco counters inside Brookshire Brothers grocery stores. Cigarette, vape and grocery chains with a cigar shelf, reversible by chain |
| 8b | Pure cigar check: every listing must prove itself | 7,230 public → 4,750. 4,114 proven by name or stock, 636 by their own site, 2,480 hidden as unproven with the reason kept. A browser pass rescued 60 whose sites are built in JavaScript |
| 8 | Non-shop purge, with Mason's scope rule: cigar and pipe shops only | 160 hidden — 110 vape, hookah, kava, glass and novelty shops, 16 makers and leaf companies, 14 lounges on wheels, 4 rolling services, 4 humidor catalogues, 2 cigarette outlets, 2 anti-smoking bodies, a plumber, 3 pins on an ATF office and an RV resort. The classifier scores the same way, so a refresh does not bring them back |

## Still to do

In the order I plan to work through them.

| # | Sweep | Size |
|---|-------|------|
| 4 | Moved shops still at the old address | ~173 candidates, ~18 confirmed |
| 9 | Pins more than 1 km from their address, wrong states, foreign records | 100–130 pins |
| 7, 19 | Taken-over, parked and redirected links; links to the wrong business | ~318 links, 14 gambling thumbnails |
| 10 | Likely-closed: clean its inputs, extend to stale map-only pins | 45 flagged today |
| 6 | Re-audit the 1,077 website hours (wrong site, sister branch, lapsed season) | 30–50 wrong |
| 26 | Hours from pages already downloaded | 60–150 listings |
| 12 | Search completeness: distance first, hard radius, real counts | 131 unfindable at 50 mi |
| 14 | Menu scanner: unstick the queue, expire stale stock | 36 of 43 shelves |
| 13 | Claim safety gate (before claim emails are switched on) | ~480 buyable domains |
| 11 | State licence registries | 2,850 listings covered |
| 17 | Stale former names and rebrands | 55–75 |
| 18 | Chain branches: missing, renamed, badges | 48 missing |
| 25 | Real shops hidden or missing | at least 75 |
| 27 | Full-site read: lounge, humidor, members-only, brands, logos | 150+ wrong badges |
| 30 | Thumbnail vetting | at least 126 bad |

## Waiting for a person

- 28 duplicate clusters (`decisions/duplicates_review.json`).
- 8 listings whose pin does not fit the state they claim (`decisions/timezones_held.json`); the pin sweep settles these.
- 2 listings with no phone and no website whose names read as somebody's back garden (`decisions/nonshops_review.json`).

## Decisions Mason still owes

- A Google Places key and budget, for the closures and hours no free source settles.

## Working rules

- Read-only dry run, review the output by hand, then apply the saved file.
- When in doubt, the listing stays off the map: a shop we cannot show is a cigar shop is hidden as "unproven", never deleted, and returns when evidence arrives.
- Claimed and staff-edited listings are never touched by a sweep.
- Every hide is reversible and carries its reason.
