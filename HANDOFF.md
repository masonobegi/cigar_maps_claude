# Handoff: instructions for the next session

**You are picking up a programme of data sweeps on CigarBuddy where all the code
is written and tested, and almost none of it has been run against production.
This file is your work order. Read it, then start at "Your next task".**

Written 2026-09-12. It replaces the handoff of 2026-09-11, which is in the git
history if you want it (`git show 94bcfd2:HANDOFF.md`). Work stopped cleanly:
nothing is half-applied, and production is in a consistent state.

---

## The one thing to understand before anything else

The session before you had **no Railway credentials and no outbound network
beyond the package registries**. So it did the half of the work that does not
need them — every job, every rule, every test — and could not do the other half.

**That means: the code is ahead of the data.** Nine sweeps are built and tested
on `master` and therefore deployed, but **not one listing in production has been
touched by them.** Your job is mostly to run them.

Check what you have before you plan anything:

```bash
railway whoami                 # or: echo "$RAILWAY_TOKEN"
curl -sS -o /dev/null -w '%{http_code}\n' https://geocoding.geo.census.gov/
```

- **Both work** → you can do everything below. Start at task 1.
- **Railway but no open web** → you can apply the decision files that already
  exist (task 1) but not produce new ones.
- **Neither** → say so plainly and stop rather than guessing. `PROGRESS.md`
  records what the last session did in that position.

## Your next task

In this order. The first is the only one that changes what a customer sees today.

| Order | Task | Why it is next |
|-------|------|----------------|
| 1 | [Apply the hours decisions](#1-apply-the-hours-decisions) | 50 schedules are read, reviewed and waiting. This is finished work sitting in a file |
| 2 | [Re-check every website](#2-re-check-every-website) | Every `ok` in the table predates four new verdicts, so ~318 dead links are still rendered as live ones |
| 3 | [Thumbnails](#3-thumbnails) | 14 cards show a picture from a gambling site. Depends on task 2 |
| 4 | [Pins](#4-pins) | ~100-130 public pins are more than 1 km from their own address |
| 5 | [Finish the amenity crawl](#5-finish-the-amenity-crawl) | 1,095 sites unread, 65 with evidence cut short by a bug since fixed |
| 6 | [Licence registries](#6-licence-registries) | The strongest free evidence that a shop exists. Feeds task 7 |
| 7 | [Recover hidden shops](#7-recover-hidden-shops) | ~75 real shops are hidden. Useless until 2, 5 and 6 have run |
| 8 | [The rest](#8-the-rest) | Two client niceties, and the menu scanner's first real pass |

**Before task 1, fifteen minutes:**

1. `git log --oneline -25`, then read `PROGRESS.md` (what the last session did
   and why) and `SWEEPS.md` (the running production log).
2. `tar -xzf sweeps/evidence.tar.gz -C sweeps/` — the crawls behind everything.
3. `npm ci --prefix server && npm ci --prefix client`
4. **Run every self-test and confirm 613 pass before you change anything:**

   ```bash
   cd server
   for f in src/utils/hoursParser.js src/utils/storeHours.js src/utils/storeSearch.js \
            src/utils/publicSuffix.js src/utils/rdap.js src/utils/claimGate.js; do node $f; done
   for j in dedupeListings pureCigarCheck hoursSweep recallMonitor geocodePins linkCheck \
            thumbCheck siteFacts webMenu closureCheck licenceSync recoverHidden; do
     PGLITE_DIR=/tmp/st node src/jobs/$j.js selftest; done
   ```

5. Build a real local database to try things against — **this is the trick the
   last session found and it is worth knowing:**

   ```bash
   cd server && PGLITE_DIR=/tmp/cb node src/index.js     # then Ctrl-C once it says "running on"
   ```

   That imports the bundled directory file: **42,928 listings, 7,904 public** —
   close to the pre-sweep production state. Every job and the recall monitor can
   be run against `PGLITE_DIR=/tmp/cb` with no credentials at all. **Its ids are
   not production's**, so the saved evidence files cannot be joined to it.

**How every task is done, without exception:**

```
dry run  ->  decisions file  ->  read it by hand  ->  remove the false
positives  ->  apply the saved file  ->  update SWEEPS.md  ->  commit
```

Never apply a fresh read. Every sweep so far produced false positives on its
first run, and the last session found eleven in one sitting by reading its own
output. Finding them is the work, not an optional extra.

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
   before spending money.

On rule 4 and judgement calls: Mason has said he would rather a session **make
the call and document it** than stop and ask, for anything that is not spending
money or publishing unproven listings. Two calls were made on that basis on
2026-09-12 (paid placement, and the no-location order) — both are written up in
`SWEEPS.md` with the reasoning and the constants to change. **Still his, not
yours:** a Google Places budget, and whether any outlet chain comes back.

## 2. What this project is, and where it stands

CigarBuddy is a cigar-shop finder: an Express + Postgres API in `server/`, a
React/Vite client in `client/`, deployed on Railway (**a push to `master`
deploys**). Its directory came from Overture Maps and OpenStreetMap, so it
arrived full of listings that are not cigar shops, shops that have closed or
moved, wrong pins, wrong hours and dead links.

Production today:

- **4,377 public listings**, from 7,431 at the start. About 38,000 further rows
  are hidden, each with a verdict and a reason.
- 782 show hours read from the shop's own website; the rest show map hours
  labelled "not confirmed", or nothing.
- 968 have a thumbnail; 1,813 carry a Lounge badge, many on thin evidence.
- Verdicts the importer honours, so a data refresh cannot undo them:
  `not_retail`, `online_only`, `closed`, `duplicate`, `moved`, `unproven`, and
  any `operating_status = 'permanently_closed'`.

**Live in production and done — do not redo:** field provenance and an edit log,
time zones from real boundaries, map-only hours shown as unconfirmed, stock
counts excluding hidden shops, search text folding, duplicate merging, the
non-shop purge, the pure-cigar check, outlet chains, and moved shops.
`SWEEPS.md` has the numbers for each.

**Deployed as code on 2026-09-12, not yet run against data:** everything in the
task list above. Plus two things that are live for customers right now because
they are pure code:

- **Search returns every shop in range.** `GET /stores` used to take 300 rows in
  placement order and only then cut to the radius, so a dense metro silently
  lost shops a few blocks away. Recall went 89.96% → 100.00% over 1,984 cases.
- **The no-location list and paid placement** — see `SWEEPS.md`.

## 3. Reaching production, and working locally

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

## 4. What is in the repository

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
  `build_fixture_db.js`, the snapshot dumps.
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
and `recallMonitor` to `contract`. Run them before and after you touch anything.

---

## The tasks

### 1. Apply the hours decisions

**State.** Done and waiting. The rules were tightened, scored against all 174
reviewer verdicts (**96.5% → 97.9%**, above the 97.3% floor), and the output was
read row by row. Six parser defects and five decide-time refusals are already
deployed.

**Do this.** From `sweeps/decisions/hours/`:

1. `hours_clear.json` — **42** schedules the rules no longer stand behind.
2. `hours_replace.json` — **8** read differently from the same evidence.
3. `hours_hold.json` — **16**. Nothing to do: their sites did not answer on the
   day of the crawl, so the hours we hold still stand. Listed only so nobody
   mistakes them for refusals.
4. `hours_chain_rerun.json` — **8. Do not apply as it stands.** The offline
   harness knows ~1,250 of the ~4,000 listings with a website, so it undercounts
   how many share a site and handed six Spring Street Cigars branches one page's
   hours. Re-run `hoursSweep.decide` against the real stores table first.
5. `hours_recoverable.json` — **292** listings with no hours whose saved pages
   hold a readable block. **Only 56 are real**; the rest were refused for
   reasons that still hold (a chain page tied to no address, a site that never
   names the shop) and their blocks belong to somebody else. Start with
   `standing_refusal: false`.

**Guardrails.** Re-score with `node sweeps/scripts/hours_offline.js score` after
any rule change: **accuracy must not fall below 97.3%**. House of Cigar and
Anthony's name sibling towns and are correct — all ten listings must keep their
exact hours.

**Done when** the clear and replace files are applied, the chain rows are
re-decided against production, and `SWEEPS.md` has the numbers.

### 2. Re-check every website

**Why first among the crawls.** `linkCheck` gained four verdicts — `elsewhere`,
`hijacked`, `parked`, `store_unavailable` — that did not exist when the current
statuses were written. **Every `ok` in the table predates them.** About 318
public links end on a different domain than the one stored; lapsed shop domains
now serve gambling and for-sale pages.

```bash
cd server && node src/jobs/linkCheck.js --all
```

**Guardrails.** A real rebrand must keep its link: a phone number, a street
address, or the distinctive part of the name on the destination passes it. A
taken-over own-domain is a **weak** closure signal for staff and never an
automatic hide — a live shop was once hidden because a closure reader followed a
redirect to a political blog.

**Done when** no public listing links to a gambling or parking page.

### 3. Thumbnails

Depends on task 2, because a thumbnail's verdict reads the website's.

```bash
node src/jobs/thumbCheck.js read   --out sweeps/decisions/thumbs.jsonl
node src/jobs/thumbCheck.js decide --from sweeps/decisions/thumbs.jsonl --out sweeps/decisions/thumbs.json
# read it, then:
node src/jobs/thumbCheck.js apply  --from sweeps/decisions/thumbs.json --confirm
```

**Be honest about its limit:** it cannot look at the picture. A photograph of the
wrong shop reads as a perfectly good image and only a person will catch it.

**Done when** no card shows an image from a gambling or parking page.

### 4. Pins

```bash
node src/jobs/geocodePins.js geocode   --out sweeps/decisions/pins_census.jsonl
node src/jobs/geocodePins.js nominatim --geo sweeps/decisions/pins_census.jsonl --out sweeps/decisions/pins_nomi.jsonl
node src/jobs/geocodePins.js decide    --geo … --nomi … --out sweeps/decisions/pins.json
node src/jobs/geocodePins.js apply     --from sweeps/decisions/pins.json --confirm
```

Both steps cache to `server/data/geocode-cache`, so an interrupted run resumes.
Nominatim is one request a second by their policy — the full pass takes hours.

**Guardrails.** A pin moves automatically only when all of: an ordinary street
address, both geocoders within 250 m of each other, both more than 1 km from our
pin, a move under 50 km, and the address backed by the shop's own site. Highway
addresses are excluded outright — the geocoders are wrong about 40% of the time
there. Named cases: Tobacco Junction of Marshall (404 km off), Amsterdam Tobacco
House (252 km, so it goes to review, not an automatic move), Black Jack's Cigar
Lounge (El Paso, listed in New London CT). **Puro Estilo in Bethlehem,
Pennsylvania is not foreign** whatever its name or its Israeli mobile suggests.

**Done when** the auto tier is applied, the review list is written, and the 8
rows in `timezones_held.json` are settled. Three of those are public and are
state errors with the pin right; the other five are hidden, so no customer sees
their clock.

### 5. Finish the amenity crawl

1,343 of 2,438 sites are read. Of those verdicts, **653 rest on a plain
statement, 7 are false positives, and 65 had their evidence cut short** by a
`quote()` bug that kept 200 characters of the matching line instead of the
matching sentence. That is fixed; the 65 need re-reading.

```bash
node src/jobs/siteFacts.js read   --out sweeps/decisions/site-facts/facts.jsonl --redo-truncated
node src/jobs/siteFacts.js decide --from … --out sweeps/decisions/site-facts/decisions.json
node src/jobs/siteFacts.js apply  --from … --confirm
```

**Guardrails.** A badge rests on a sentence, and the sentence must be in the
shop's own voice: Padre Island Cigar Company's page says it *does not have a
lounge* and then recommends somebody else's. Three sites share an owner
biography about a lounge he once worked in. Read the `refused` and `reread`
lists, not just the counts.

**Done when** every badge on the public map has either a sentence behind it or a
map category a person has accepted. `decide` produces that last list
(`categoryOnly`) — about 2,017 of them on the pre-sweep directory.

### 6. Licence registries

Eight free registries (NYC, New York State, Texas, Florida, California,
Pennsylvania, Chicago, Washington) covering about 2,850 listings. Four of the
eight are an API; the other four publish a file you save into the fetch
directory by hand — `licenceSync.js` tells you which and where.

```bash
node src/jobs/licenceSync.js fetch --out sweeps/decisions/licences/
node src/jobs/licenceSync.js match --from sweeps/decisions/licences/ --out sweeps/decisions/licences.json
```

**Guardrails.** **A lapse is a staff flag and nothing else** — the audit measured
"lapsed licence means closed" at roughly a coin flip, and a self-test asserts
there is no verdict in the job that hides a listing. Sixty days of publishing lag
are allowed. **Stogies, BlackHouse and Manhattan Tobacco are open** and are never
flagged. NYC smoke shops are exempt from lapse flags entirely, because the city
caps licences and runs a waiting list.

**Done when** the four queues exist and a person has reviewed the first batch.

### 7. Recover hidden shops

The pure-cigar check hid 2,480 listings as "unproven". Re-reading the saved
evidence recovers **nobody**, and that is arithmetic rather than a failure: the
check hid them by running `siteVerdict()` on that same evidence. Verified — zero
contradictions, and all 639 saved readings that would prove a cigar shop belong
to listings that were kept public.

So recovery needs **new** evidence, and `sweeps/decisions/recover/` says which
kind per listing:

| | |
|---:|---|
| 1,933 | no site evidence at all — a licence match (task 6) or web-shop stock |
| 84 | site could not be read — a re-crawl with the browser-rendered pass |
| 463 | site was read and does not say cigars — correctly hidden, leave them |

```bash
node src/jobs/recoverHidden.js propose --licences sweeps/decisions/licences.json --out sweeps/decisions/recover.json
```

**Guardrail, and it is rule 2:** a listing comes back only on something you can
quote. A name is never enough — a name is what put 2,480 listings in this pile.

### 8. The rest

- **The menu scanner has never had a real pass.** Its back-off and staleness
  ordering are deployed and a 30-day replay proves every shop gets reached
  (against 3,940 of 4,000 untouched under the old order), but it has only ever
  run against a model. Watch the first real 24 hours.
- **The autocomplete and the review-form store picker still ignore the saved
  location** (audit items (e) and (f)). Neither is wrong now that the
  no-location order is neutral; both would be better.
- **Stale former names** come out of `licenceSync` as its `renamed` and `moved`
  lists — that is the overlap the old handoff predicted.
- **Chain branches** shrank to almost nothing when the tobacco-outlet chains came
  off the map.

---

## 5. Traps, so you do not hit them again

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
  Kellogg, Idaho in Mountain time and Williston, North Dakota in the wrong zone.
  And a prefix test for a foreign clock cannot see that `America/Toronto` is
  Canadian — that bug was found and fixed on 2026-09-12.
- **A test that has never been run is not a test.** All five `sweep/*` branches
  shipped with tests that had never executed, and running them found five real
  bugs — one of which would have left the automatic pin move dead on arrival.

## 6. What to ask Mason

- **A Google Places API key and budget**, for the closures and hours no free
  source settles. Everything so far was done without paid data. This is the only
  item on this list that is genuinely blocked on him.
- **Whether any outlet chain should come back:** Wild Bill's (198 listings),
  Sweet Fire (61), Cheap Tobacco (32), The Tobacco Shoppe (21). Each is one
  command. Rule 4 makes this his call, not a session's.
- **Whether the paid-placement prices and reach match what he wants to sell** —
  $49 for 15 miles, $149 for 50. The mechanism is built and documented; the
  numbers are commercial.
- **Not questions any more:** paid placement's shape and the no-location order.
  Both were decided on 2026-09-12 at his request, and both are written up in
  `SWEEPS.md` with the constants to change if he disagrees.

## 7. Keep the log

After each task: update `SWEEPS.md` with what changed in production and the
numbers, and commit. If you stop part-way, say in `SWEEPS.md` exactly where you
are, as this file does. **The next session should never have to reconstruct it** —
and should never have to guess whether a number describes production, a local
copy, or a fixture. Say which.
