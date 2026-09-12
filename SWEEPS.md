# Store data sweeps: what is done, what is running, what is left

The ranked plan is in [WORKLOG.md](WORKLOG.md) ("Store data audit: the next sweeps,
ranked"); numbers below are its ranks. Every sweep is built, dry-run, reviewed by
hand, then applied from the reviewed file. Nothing is applied straight from a
fresh read.

**Updated 2026-09-12 (evening). Public listings: 4,363** (from 7,431 at the
start). **Every sweep the cloud session built has now been run against
production**, and what reading the output changed is the table at the top of
"The session of 2026-09-12 (evening)" below. What is still open is the list at
the end of it.

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

## The session of 2026-09-12 (evening): the handoff, worked through

This session has Railway and the open web, so it applied what the cloud session
built. **Every task in HANDOFF.md is done except the parts that need data this
machine does not have**: the Overture extract, and four registries that publish
a file by hand.

**Production now: 4,363 public listings.** 930 with hours (783 read from the
shop's own site), 806 with a thumbnail, 2,149 with a lounge badge, 404 with a
walk-in humidor, 216 stamped by a current tobacco licence.

**What reading the output changed.** Seven rules were wrong, or were not running
at all, and every one of them was found by reading rows rather than by a test:

| Job | What was wrong | What it cost |
|-----|----------------|--------------|
| `linkCheck` | `pageIdentity`, `namesShop` and `looksHijacked` were written, tested, and never called; no call site passed the store row | every gambling takeover on the map read as a working link — zero `elsewhere`, zero `hijacked` |
| `linkCheck` | a redirect that left the listed domain stopped without reading where it landed | havanaonhudson.com answers 302 to a betting site and stayed 'ok' |
| `recoverHidden` | a hide that named a chain could be undone by that chain's own website | it proposed bringing back 320 outlet listings, and nothing else |
| `thumbCheck` | one shared image tainted every member of its group | 23 Cigaret Shopper branches would have lost their own logo |
| `thumbCheck` | `sameBusiness` matched any two shops sharing the word "cigars" | the shared-image check was nearly inert |
| `licenceSync` | four of eight registry URLs answered 400 or 404, and the fetch read one page | half the free evidence unreachable; Texas and Chicago silently cut at 50,000 rows |
| `hoursParser` | a day written as two shifts became one long one | a shop published as open through an hour its door is locked |

### 1. Hours decisions — applied

| File | Waiting | Applied | Notes |
|------|---------|---------|-------|
| `hours_clear.json` | 42 | 38 cleared | 5 had already gone in an earlier partial run; 1 moved to the replace file by hand |
| `hours_replace.json` | 8 | 6 written, 1 skipped, 1 cleared | the four hand decisions are below |
| `hours_hold.json` | 16 | — | nothing to do, as the file says |
| `hours_chain_rerun.json` | 8 | **no change** | re-decided against the real stores table: production returns exactly the hours already stored for all eight. The offline harness had handed six Spring Street branches the Tupelo page, and two Tinder Boxes another branch's |
| `hours_recoverable.json` | 56 real | 18 written, 38 refused | most were a call centre, a warehouse or a live-chat desk rather than a door |

**The four decided by hand, and how to reverse each:**

- **#9843 Skookum Creek Cigar Lounge — cleared.** Both readings came from
  `littlecreek.com`: the old one is headed "Casino Hours", the new one reads
  like the casino's office week. The lounge inside keeps its own hours and
  neither of these is it. Reverse: put back `8am-3am` Sunday–Thursday.
- **#3032 Bright fire cigars — skipped.** The replacement came from a page whose
  text stopped at "Fri", so taking it would have dropped Friday, Saturday and
  Sunday. The stored week is complete and agrees with it as far as it goes.
- **#9541 Maine Street Cigar — written as two shifts.** The site says "Friday
  12pm-6pm & 7pm-10pm". The stored value claimed it shuts at six; the proposal
  claimed it is open through the seven o'clock break. It now reads
  `12pm-6pm, 7pm-10pm`, which needed the split-shift work below.
- **#20766 Kay's Cigar Sensations — the season that is running.** The page prints
  September–April beside May–August, so September takes the first column. The
  stored Monday was `4am-12pm`: open all morning and shut all evening, the exact
  opposite of the truth.

**Split shifts.** A day written as two shifts was being stored as one long one,
which tells a customer the shop is open during an hour its door is locked;
reading only the first shift says it is closed all evening. The parser and the
open-now clock now keep the shifts apart (`hoursParser.joinShifts`,
`storeHours.parseRanges`), on the server and in the browser fallback. Hours
accuracy re-scored at **97.9%**, above the 97.3% floor.

### 2. Every website re-checked — done

3,337 public links in 624 seconds. **ok 2,324, dns_fail 467, not_found 163,
blocked 139, error 55, elsewhere 51, refused 45, timeout 38, parked 32,
hijacked 18, store_unavailable 5.** No public listing now links to a gambling or
parking page.

Three rules came out of reading those verdicts:

- a shop that moves to a longer spelling of its own domain keeps its link
  (ejcigars.com → eandjcigars.com, planetcigar.com → planetcigars.com) — but only
  when both stems are eight characters or more and within four of each other,
  since otherwise "google" inside "googleblog" makes a dead Currents link look
  like a rebrand;
- a Discord or WhatsApp invite is a social link, not a stranger's domain;
- **#9499 Cigar Express is set to 'elsewhere' by hand.** cigarexpress.com lands
  on klafters.com, a jeweller, and the word "express" on that page passed the
  name test. It is the one verdict here a person overrode.

### 3. Thumbnails — done

965 read, **159 taken down and 806 kept**: 76 too small for a card, 45 banners
that crop to a smear, 25 that answer 4xx, 16 that are a web page rather than a
picture, 14 near-blank, 10 sharing one picture with unrelated shops, 5 on
domains that are no longer the shop's, and the rest unreadable. Every URL went
into the edit log first, so any of them can be put back.

### 4. Pins — done

4,194 addresses geocoded against the Census, and the 78 disagreements taken to
Nominatim. **18 pins moved automatically** — all five gates: an ordinary street,
an exact Census match, a house-level second opinion within 250 m, both more than
a kilometre from our pin, and the ZIP backing the address. **One moved by hand**:
Tobacco Junction of Marshall, 405 km out, past the automatic limit with
everything except the pin agreeing. **Six listings hidden** whose records
contradict themselves — Sam Hills (a Prescott address, a Gallup filing, and a
domain now serving a Vietnamese casino), Smoky J's, Black Jack's, Mort's, an
Alaskan ZIP on a Florida row, and a Windsor, Ontario shop filed in Michigan.

**59 rows are left for a person** in `sweeps/decisions/pins/pins_review.json`.
Sixteen of them say "Nominatim agrees with the pin we already have", which means
no move at all: there, the Census was the one that was wrong.

The three public time-zone rows are settled. Cigar Mafia's state went NY → TX
(its address, ZIP 77002, its 281 phone and its pin are all Houston); the other
two came off the map, having nothing in them that agrees with anything else.

### 5. The amenity crawl — done

1,122 more sites read, 2,408 in all. **344 lounge badges added, 4 taken off, 331
walk-in humidors**, each resting on a sentence from the shop's own site. Reading
them added two refusals: a question or an article headline is not a claim ("Do
you love a fine cigar but have never visited a cigar lounge?", "THREE THINGS TO
NEVER DO IN A CIGAR LOUNGE"), and "private club" or "lockers" only count in the
shop's own voice, since a shop's history of the trade mentions both.

**963 badges still rest on a map category**, listed under `categoryOnly` in
`decisions/site-facts/decisions.json` for a person to accept or clear. That is
the part of this task still open.

### 6. Licence registries — four of the eight

NYC 6,699, New York State 22,091, Texas 59,603, Chicago 59,414. Florida,
California, Pennsylvania and Washington publish a file by hand; `licenceSync
fetch` prints the URL for each.

Of 732 listings in registry states: **216 verified** by a current licence at the
door, 57 trading under another name, 146 licensed at another address, and 202
with no current licence — of which 54 were noted for staff and **none hidden**,
per the rule that a lapse is a coin flip.

The downloads are gitignored: 27 MB of public data that `fetch` re-creates in a
minute. The matched result, `decisions/licences.json`, is committed.

### 7. Recovering hidden shops — nobody, and that is the answer

Every one of the 320 proposals was a branch of an outlet chain, "proved" by the
chain's own website — the page that took it off the map in the first place: 197
Wild Bill's, 61 Sweet Fire, 32 Cheap Tobacco, 21 The Tobacco Shoppe and 9
tobacco counters inside Brookshire Brothers groceries. The job can no longer
argue with a hide that names a chain, and now proposes nobody. Recovery needs
new evidence: a licence match in a state we can reach, or stock read from a
shop's own web shop.

### 8. Duplicates — the auto tier is wired up

Read against production first, as the handoff asked. Six doors carried more than
one listing: four plain enough to merge on their own, two for review. All six
turned out to be one shop listed twice — O Cigar Company is O Cigar Bar's web
shop, "Lake Orion's premier cigar bar bringing its humidor online" — and all six
were merged. `dedupeListings.mergeAutomatic` now runs after every import, on the
auto tier only; review-tier clusters still wait for a person.

### Still open

- **963 category-only amenity badges**, for a person to accept or clear.
- **59 pin rows** for review, plus 57 licence renames and 146 licence moves as
  lists.
- **The Overture-dependent dedupe change**, still blocked: `overture_raw.json`
  is not in the repository, and a rebuild without it produces an OSM-only file.
- **Four registries** that publish a file by hand rather than an API.
- **The menu scanner's first real 24 hours**, still worth watching.


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
- ~~What a visitor with no location should see.~~ **Decided and built** — see
  "What a visitor with no location sees" below. IP geolocation was ruled out
  because it needs a paid or licensed database and spending money is Mason's
  call, not a session's.
- ~~How paid placement should appear in a search.~~ **Decided and built** —
  Mason asked for a judgement call rather than a question. See "Paid placement"
  below. Override it by changing three numbers in `utils/storeSearch.js`.
- **Whether about two-thirds of claims may need a person.** The claim safety
  gate keeps the self-serve shortcut for roughly 1,537 of 4,533 eligible
  listings; the rest wait for staff. It never rejects a claim, and it tells the
  claimant why.

## What a visitor with no location sees, as decided on 2026-09-12

The nationwide list was ordered by paid placement, then claimed, then verified,
then followers, then in-stock count, then confidence, then name. With nobody
claimed, verified or followed, that came down to **"how many cigars are in your
web feed, then alphabetically"**: the 42 shops with a feed, then names from
"105 Cigar Co." to "Casa Fuente Cigars", and 96% of the directory never appeared
at all. The home page showed the same Tucson and Florida online sellers to every
visitor in the country, under the heading "Local Retailers".

The audit left three options: a prompt, a neutral sample, or IP geolocation. IP
geolocation needs a paid or licensed database, so it is out — spending money is
not a session's call. Between the other two, a prompt refuses to answer a
question the customer asked, and a directory whose front page is a form is not a
directory. So: **a neutral sample**, ordered by what makes a listing useful.

Four keys, in `noLocationOrderSql()`:

1. **Anything that looks closed goes last** — a dead link or a likely_closed
   flag is the one thing that makes a card actively unhelpful.
2. **One listing per website before the second on the same one.** Anthony's has
   three Tucson branches on one feed, 3J's four, Miami Humidor two, Lucky two;
   showing all of them is showing one shop four times. A listing with no website
   counts as its own, because it shares no feed.
3. **Completeness, 0 to 4** — a working website, known hours, a phone, a
   picture.
4. **A shuffle seeded by the date**, so the tail rotates daily and every listing
   gets its turn, while any one day's order is stable enough to page and cache.

Paid placement is deliberately **not** one of the keys: a shop buys the top of a
search near it, not the top of the country.

Measured on the imported directory: the first page of 60 now spans **32 states**
(the audit's guardrail was ten), no website appears twice, nothing on it looks
closed, and every row has at least two of the four. It is also faster than the
order it replaced — 243 ms against 467 ms — because it drops two correlated
subqueries.

The home page's "Local Retailers" now uses the location the visitor already gave
us and is titled "Retailers near <place>"; with no location it says "Retailers
across the US", which is what it is.

**Still owed on this:** the navbar autocomplete and the review-form store picker
still ignore the saved location (audit items (e) and (f)). Neither is wrong now,
both would be better.

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

---

# 2026-09-12, second pass: the code-only sweeps

Every sweep in `sweeps/plan.json` whose `sources` is code alone and whose
`needs_from_mason` is nothing, plus the ones whose only Mason item was a
decision he asked to be made without him. No credentials, no network beyond the
package registry, no money.

**Where the numbers come from.** A database built from the committed directory
with `node src/index.js` — 42,928 listings, 7,904 public, no credentials
needed — and, for the endpoints, a booted server on a fresh import of it. Not
the synthetic fixture; `sweeps/scripts/build_fixture_db.js` says why no decision
about a real shop may come from that. Nothing here was applied to production,
because production was unreachable: these are code changes, live on `master`,
that change what the site does with whatever data it holds.

## What changed

| Area | Sweep | Measured effect |
|---|---|---|
| result-assembly | Server-side map clustering | National view drew 1,000 of 7,904 pins; now 7,856 accounted for exactly across 15 viewports |
| names-and-text | S8 search folding | 73 accented names reachable; `st james` = `saint james`; 38 listings in Saint/Mount towns |
| names-and-text | S1 name provenance | `source_name` on all 42,928 rows; `name_aliases` added and searched |
| duplicates | Matcher, both copies | 122 clusters / 125 drops, from 116 / 119 |
| contact | Guardrails in code | 2,893 links that are not the shop's own site surfaced; verdicts no longer inherited across a domain change |
| claims-and-owner-edits | Staff review, revoke, honest copy | Unclaim exists; claim card carries its evidence; 35,024 hidden rows reviewable where 0 Overture rows were |
| inventory-and-brands | Hidden stock, $0 prices | Reconciled in one place; $0 reads as "not listed" |
| amenities | Prerequisite item 3 | Lounge badge can be removed and stay removed |
| location / closures / names | "Make it stick" | 16 checks in `reimportTest.js`, from 10 |

## The judgement calls, and how to reverse each

Mason asked for decisions rather than questions. Each of these was a `plan.json`
item marked as needing him.

**An unchecked website stays a live link.** `contact` sweep 6 item 2 says to
render a NULL `website_status` as "checking" with no link. Measured first: 5,214
of the 5,214 public listings that carry a website have a NULL status, because
`linkCheck --all` has never run. Implementing it literally would have removed
the website link from every listing that has one, on an absence of evidence
rather than any evidence of a problem. So NULL — "nobody has looked" — stays a
link and makes no freshness claim, and a new verdict `checking` marks an address
a hand has just changed, which is what the work order was actually about. The
owner form, the staff editor and the importer all write it.
*To reverse:* treat `!status` as not-ok in `websiteInfo` in
`client/src/pages/StoreProfile.jsx`.

**Requests on unclaimed listings are collected, not hidden.** `claims` sweep 6
item 1 offers either. The Request button had been on every profile for months
setting React state that nothing rendered, so a customer pressed it and the page
did nothing. Collecting wins because a list of people asking for a particular
cigar at a particular shop is the strongest thing we can show that shop when we
ask it to claim its listing. The dialog says plainly that the request cannot
reach anyone yet; the server refuses requests on a listing that is off the map.
*To reverse:* render the Request tile only when `store.claimed`.

**Which owner edits go live instantly.** `claims` sweep 4 proposes hours, phone
and website immediately with re-checks, and name, state and large address moves
held for staff. Adopted as proposed, with one addition: an address change
re-geocodes and recomputes the time zone, because otherwise a moved shop keeps a
pin across town and "open now" is judged on the old clock. All of it is recorded
in `field_sources` as `owner`, so the next import leaves it alone.

**The dead domain is no longer named in the unclaimed banner.** `contact` sweep
6 item 6. The page has already withheld the link; naming the domain in the next
breath republishes it exactly where a reader is most likely to type it by hand.
The line still tells an owner the listed website does not work, which is the
part that gets a shop to claim.

**The dedupe auto tier is still not wired to the import.** `duplicates` sweep 5
item 4 asks for it. The matcher changed materially in this pass — six pairs
moved from auto to review, eight clusters are new — and a job that hides
listings on every deploy should not be the thing that first exercises a matcher
nobody has read the output of. `HANDOFF.md` task 8 says what to do instead.

## Two bugs worth naming

**The matcher merged a brewery into the directory.** `namesMatch` treated "two
shared words" as a match without asking whether either word named a business,
so "Cigar City Brewing" matched "Cigar City Cigars". `plan.json` records that
regression happening once already through the classifier; this was a second door
onto it. At least one shared word must now name the business.

**`destinationKind` called all 23,972 stored websites ordinary sites.** It ran
`new URL()` on a column that stores bare hosts and returned `'site'` from the
catch. With the scheme supplied: 2,011 platform links, 878 social, 4 parked.
Those 2,893 listings carry something other than the shop's own website, and no
verdict would ever have flagged them, because the links work.

## Tests

850 assertions across 23 suites, 0 failed (`node sweeps/scripts/selftest_all.js`).
16 checks in `reimportTest.js`. 117 in `map_viewports.js`. 42 in
`fold_parity.js`, which is the only thing that can catch the SQL and JavaScript
halves of the search fold disagreeing — a difference there is a search that
matches nothing rather than one that errors.
