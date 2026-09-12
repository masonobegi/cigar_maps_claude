# Store data sweeps: what is done and what is left

The ranked plan is in [WORKLOG.md](WORKLOG.md) ("Store data audit: the next sweeps,
ranked"). Numbers below are that plan's ranks. Each sweep is built, dry-run,
reviewed, then applied from the reviewed file. Nothing is applied straight from a
fresh read.

Updated 2026-09-11.

## Done

| # | Sweep | What changed in production |
|---|-------|-----------------------------|
| 1 | Make fixes stick | Field provenance + edit log; import refreshes only directory-owned fields; storefront sweep no longer overwrites closures (491 restored); chain closures use the standard status (7); Boatyard Tobacco reopened; re-import test, 10 of 10 |
| 2 | Time zones | Real boundaries instead of longitude rules: 153 listings moved, 27 public, all of Chattanooga included |
| 3 | Map-only hours | 234 listings show "from map data, not confirmed" with no badge; 121 invented Closed days removed |
| 5 | Stock counts | 741 cigar lines no longer count stock at hidden shops; no more $0.00 prices; 2,790 rows marked out of stock |
| 15 | Search text | Apostrophes and "&" folded ("wild bills" 2 → 215 matches); city chips carry their state |
| 16 | Duplicates | Matching by door, not name: 42 plain merges applied, 28 clusters left for review |

## Still to do

In the order I plan to work through them.

| # | Sweep | Size |
|---|-------|------|
| 8 | Non-shop purge (makers, landmarks, government, trails, event services) plus the classifier fixes that let them in | 150–250 public listings |
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

## Decisions Mason still owes

- Are head shops, vape shops, hookah lounges and pipe-only shops in scope? Until
  this is answered they stay listed, and only plain non-shops are hidden.
- A Google Places key and budget, for the closures and hours no free source settles.

## Working rules

- Read-only dry run, review the output by hand, then apply the saved file.
- Never hide a real shop to catch a stale one; anything uncertain goes to a review list.
- Claimed and staff-edited listings are never touched by a sweep.
- Every hide is reversible and carries its reason.
