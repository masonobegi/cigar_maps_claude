# Store data sweeps: what is done, what is running, what is left

The ranked plan is in [WORKLOG.md](WORKLOG.md) ("Store data audit: the next sweeps,
ranked"); numbers below are its ranks. Every sweep is built, dry-run, reviewed by
hand, then applied from the reviewed file. Nothing is applied straight from a
fresh read.

**Updated 2026-09-12. Public listings: 4,377** (from 7,431 at the start).
**The code from 2026-09-12 is now on `master` and therefore deployed**, but
**no listing data was changed**: that session could reach neither Railway's
database nor the open web, so every sweep it built is waiting on a run. See
"The session of 2026-09-12" below.

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

## The session of 2026-09-12: nine sweeps built, none applied

A cloud session worked through every task in `HANDOFF.md` section 5. It had no
Railway credentials and no outbound network beyond the package registries, so
**no listing in production was changed, and no crawl was run.** What it produced
is code, tests and decision files. `PROGRESS.md` is its full log.

| Task | What exists now | What it still needs |
|------|-----------------|---------------------|
| Search completeness | `utils/storeSearch.js`, `utils/storeList.js`, a rewritten list route, `jobs/recallMonitor.js`. Recall **89.96% to 100.00%** over 1,984 cases, measured on the bundled directory (7,904 public) | a deploy, and the metro skim read by a person |
| Pins and foreign rows | `jobs/geocodePins.js` from `sweep/pins`, with a resumable cache; 54 + 7 assertions | the Census and Nominatim crawl |
| Hijacked links | `jobs/linkCheck.js` from `sweep/links` with four new verdicts, plus `jobs/thumbCheck.js`; 26 + 27 assertions | `linkCheck --all` and the thumbnail read |
| Amenity crawl | the 1,343 saved sites re-read at the sentence: **653 sound, 7 false positives, 65 cut short by a bug in `quote()`** | the remaining 1,095 sites |
| Hours re-audit | six parser fixes, four refusals, a stricter name test. Accuracy **96.5% to 97.9%** | the decision files applied |
| Menu scanner | back-off, staleness ordering, stock expiry, shared-feed ownership. A 30-day replay reaches every shop; the old order left 3,940 of 4,000 untouched | a deploy |
| Closures and licences | five closureCheck changes, `jobs/licenceSync.js`, 16 + 31 assertions | the registry downloads |
| Claim safety gate | `utils/claimGate.js` from `sweep/claims`, with the real Public Suffix List and an RDAP client; all 25 of the audit's live examples as tests | SMTP, then a deploy |
| Recovering hidden shops | `jobs/recoverHidden.js`. Re-reading the saved evidence recovers nobody, which is arithmetic: the same function on the same evidence | new evidence — see below |

**Decision files waiting to be applied**, all read row by row:

- `sweeps/decisions/hours/` — 42 schedules to clear, 8 to replace, 16 held
  (their sites did not answer, so the hours we hold still stand), 8 chain rows
  that must be re-run against the real stores table first, and 292 recoverable
  candidates of which only 56 are real.
- `sweeps/decisions/site-facts/sentence_review.json` — the seven amenity
  verdicts that are wrong, and the 65 whose evidence was cut short.
- `sweeps/decisions/recover/` — the 2,480 hidden listings, split by what kind of
  new evidence could bring each one back: 1,933 need a licence match or
  web-shop stock, 84 need a re-crawl, 463 are correctly hidden.

**Self-tests across the server: 563 assertions in 18 suites, all passing**, plus
the apply-path tests, the re-import guard and the list's 16 contract checks. Every job in `server/src/jobs/` answers to `selftest`.

## Running right now

**This work is on `master` as of 2026-09-12, which means it is deployed.**

**Nothing is building in parallel any more, and the branches below are merged
and can be deleted** (the session that merged them could not delete them itself:
the cloud git proxy refuses every ref push that is not a branch create or
update). See PROGRESS.md for the one command. Five of the six reached the remote (`sweep/closures` never
did). The 2026-09-12 session read all five and folded them into
`claude/handoff-tasks-completion-m1aqvb`:

| Branch | What happened to it |
|--------|---------------------|
| `sweep/claims` | **Adopted whole** — the real Public Suffix List, an RDAP client, a better gate design |
| `sweep/pins` | **Adopted whole** — a resumable geocode cache and fuller reference tables |
| `sweep/links` | **Adopted whole** — it reads the visible page instead of raw HTML |
| `sweep/hours` | **One rule taken** — a day under two hours of trading is not a day |
| `sweep/search-and-menus` | **Superseded** — it carried the 5,000-row ceiling bug, and its menu half was never started |

All five were committed as "not tested", and running their tests found five real
bugs that had never been executed — the worst being a street-type comparison
that would have left the automatic pin move dead on arrival. The table below is
kept for the record of what each stream was for.

| Branch | Sweeps | What it produces |
|--------|--------|------------------|
| `sweep/pins` | 9 | Pins more than 1 km from their address, wrong states, foreign rows; settles the 8 held in `decisions/timezones_held.json` |
| `sweep/links` | 7, 19, 30 | Taken-over, parked and redirected links; links to the wrong business; thumbnail vetting |
| `sweep/hours` | 6, 26 | Re-audit of the website hours we publish, and hours recovered from pages already downloaded |
| `sweep/search-and-menus` | 12, 14 | Distance-first search with no row cap (a Chicago search returns 7 shops within 25 miles today), and the menu scanner's back-off and stock expiry |
| `sweep/claims` | 13 | The claim safety gate, needed before claim emails are switched on |
| `sweep/closures` | 10, 11 | Likely-closed rules, and the free state licence registries |

**The amenity crawl stopped at 1,343 of 2,438 sites.** Its output,
`decisions/site-facts/facts.jsonl`, came with the handoff and has since been
re-read sentence by sentence (see the 2026-09-12 section above).

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
- **What a visitor with no location should see.** The search sweep deliberately
  left the no-location order exactly as it was, because changing it is its own
  sweep in `plan.json` and needs a decision: a prompt with city chips, a
  rotating national sample, or IP geolocation. Until then the home page, the
  navbar autocomplete and the review picker keep showing the same alphabetical
  slice.
- ~~How paid placement should appear in a search.~~ **Decided and built** —
  Mason asked for a judgement call rather than a question. See "Paid placement"
  below. Override it by changing three numbers in `utils/storeSearch.js`.
- **Whether about two-thirds of claims may need a person.** The claim safety
  gate keeps the self-serve shortcut for roughly 1,537 of 4,533 eligible
  listings; the rest wait for staff. It never rejects a claim, and it tells the
  claimant why.

## Paid placement, as decided on 2026-09-12

`billing.js` sells Featured at $49 for "top placement in your city and on the
map" and Partner at $149 for "top placement across your whole metro". Neither
happened. `is_featured` was the first sort key, so one Featured shop would have
sat on top of every list in the country — the opposite of "in your city" — and
in a location search the distance sort overrode it entirely, so the thing being
sold did not occur at all.

The rules now, and the reasoning, because a later session will want to argue
with them:

1. **A sponsored slot reorders and never removes.** It lifts a row that already
   matched the search; the set and the total are identical either way. The
   recall monitor asserts this against the database, because it is the property
   everything else rests on: no amount of money can cost a customer a result.
2. **It is labelled.** The card says "Sponsored" above the shop's name, in
   muted grey rather than the amber every other badge uses — a disclosure is
   not a feature, and one a reader has to hunt for is not a disclosure.
3. **Only inside what the customer searched** — a radius around a point, or a
   named city. A paid shop is never inserted into a town nobody searched.
4. **Featured and Partner differ by reach**, because that is what the two plans
   describe: Featured carries 15 miles ("your city"), Partner 50 ("your whole
   metro"). Partner outranks Featured; between equals the nearer shop wins,
   then the lower id, so the order never wobbles.
5. **Two slots, and the first page only.** The plans promise a shop comes up
   first, not that it owns the page.
6. **A list with no location sells nothing.** "Top placement in your city"
   cannot honestly mean "top of a nationwide list". That contradiction is what
   the audit asked to have settled, and this is the settlement.

The map is untouched: a viewport returns every pin in it, so there is no order
to sell. "On the map" is honoured by the badge a paid shop already carries.

To change any of it: `SPONSORED_SLOTS`, `FEATURED_REACH_MI` and
`PARTNER_REACH_MI` in `server/src/utils/storeSearch.js`. Setting the slots to 0
turns paid placement off without removing anything else.

**Still owed on this:** whether the prices and the reach match what Mason wants
to sell, and — if a shop is ever refused a slot it thinks it paid for — what the
dashboard should tell it. The `store_views` table already records impressions,
so reporting "you appeared in N searches" is possible but not built.

## Working rules

- Read-only dry run, read the output by hand, then apply the saved file.
- When in doubt, off the map; hidden is never deleted and always carries a reason.
- Claimed and staff-edited listings are never touched by a sweep.
- Verdicts the import honours: `not_retail`, `online_only`, `closed`,
  `duplicate`, `moved`, `unproven`, and any `permanently_closed` status.
