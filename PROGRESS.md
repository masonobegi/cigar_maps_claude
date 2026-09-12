# Session log: working through HANDOFF.md

**Session of 2026-09-12, in a cloud container.** All nine tasks in
`HANDOFF.md` section 5 have been worked. `SWEEPS.md` is the production-facing
log; this file is the session's own record, kept so that a stop at any point
leaves an accurate picture rather than a reconstruction.

---

## The two walls this session ran into

| Thing | State |
|-------|-------|
| Repo | Fresh clone, branch `claude/handoff-tasks-completion-m1aqvb` off `master` |
| `npm ci` server + client | Clean, both |
| `sweeps/evidence.tar.gz` | Extracted; 16 files, 30 MB of saved crawls |
| Self-tests before any change | All 5 passed (baseline below) |
| **Railway CLI / `RAILWAY_TOKEN`** | **Absent. No production database.** |
| **Outbound network** | **Package registries only.** The egress proxy answers 403 to every other host |
| `server/data/` snapshot | Absent — gitignored, so the clone did not carry it |
| The five `sweep/*` branches | Absent. They were local to the desktop machine; only `master` and this branch exist on the remote |

**What that means, task by task.** Per HANDOFF section 3 ("If you cannot reach
Railway, do not guess"), nothing was applied to production. On top of that,
every step that fetches from the open web — the geocoders in 5.2, the link and
thumbnail checks in 5.3, the rest of the amenity crawl in 5.4, the licence
registries in 5.7 — cannot run here at all.

So the shape of this session's work is: **every job written and tested; every
dry run that the saved evidence supports, run; nothing applied.** Where a number
below describes real listings it says so; where it describes a test fixture it
says that too.

### One thing that turned out better than expected

`node src/index.js` imports the bundled directory file on first boot: **42,928
listings, 7,904 public.** That is close to the pre-sweep production state, and
it let the search work be measured against real listings rather than a fixture.
It also validates the audit — replaying the old route returns 272 rows from
Midtown, 297 from Fort Lauderdale, 250 from Baltimore and 295 from Los Angeles,
against the audit's own live figures of 272, 297, 251 and 297.

Its listing ids are **not** production's, so the saved evidence files (which are
keyed to production ids) cannot be joined to it. That is why 5.2, 5.4 and 5.9
still need the real database.

---

## Task status

| # | Task | State |
|---|------|-------|
| 1 | 5.1 Search completeness | **Done and measured on real data.** Applying is not a step this task has |
| 2 | 5.2 Pins, states and foreign rows | Code done and tested. **The geocoder crawl is blocked** |
| 3 | 5.3 Hijacked links and thumbnails | Code done and tested. **The crawls are blocked** |
| 4 | 5.4 Amenity crawl | Saved crawl re-read in full; rules fixed. **The remaining 1,095 sites are blocked** |
| 5 | 5.5 Re-audit the hours we publish | **Done end to end.** All its evidence was saved |
| 6 | 5.6 Menu scanner | **Done and tested.** No crawl needed for the proof |
| 7 | 5.7 Closures and licence registries | Code done and tested. **The registry downloads are blocked** |
| 8 | 5.8 Claim safety gate | **Done and tested** against all 25 of the audit's live examples |
| 9 | 5.9 The smaller ones | Done, with a finding: recovery needs new evidence, not a re-read |

### Self-tests

Baseline, before any change: 5 suites, 135 assertions.
Now: **16 suites, 502 assertions, 0 failures**, plus the 10-assertion re-import
guard and a live server boot.

    hoursParser      76    storeHours       35    storeSearch      41
    claimProof       44    dedupeListings   14    pureCigarCheck   10
    hoursSweep       43    recallMonitor    14    geocodePins      47
    linkCheck        33    thumbCheck       27    siteFacts        30
    webMenu          15    closureCheck     16    licenceSync      31
    recoverHidden    26    reimportTest     10

---

## What was done, task by task

### 5.1 Search completeness — done

`utils/storeSearch.js` (filters, SQL haversine, the radius contract) and
`utils/storeList.js` (the list itself) are new. `routes/stores.js` is a two-line
wrapper over the latter, so `jobs/recallMonitor.js` replays the real code path
rather than a copy of it.

Measured on the imported directory, not a fixture:

- **Recall 89.96% before, 100.00% after**, 1,984 cases, no failures.
  91.0% → 100% at 50 miles; 70.5% → 100% at 100.
- 16 of 16 contract checks: the radius cap, the ceiling refusal (forced, by
  lowering the ceiling under the list), paging with no repeats or gaps, two
  shops on one spot, a shop on the radius line, open-now on confirmed hours
  only, hidden rows, and the no-location order unchanged.
- A radius search takes 23–41 ms; the nationwide list 467 ms, against 954 ms
  for the old route's query alone.
- `metro_diff_real.json` holds the first 30 cards for each of the eight affected
  metros with the new rows marked — the guardrail this task owes a person.

**One real bug the fixture was too small to catch.** The candidate ceiling was
5,000, sized against the worst radius search (763 listings within 100 miles of
Philadelphia). A list with no location has no radius: it is the directory,
paged. At 7,904 public listings the home page, the autocomplete and the review
picker all came back "narrow your search". The contract check caught it; the
ceiling is 50,000 now.

**Deliberately not done.** The neutral no-location order is a separate sweep in
`plan.json` and owes Mason a decision, so a visitor with no location gets
exactly the order they got before.

### 5.2 Pins, states and foreign rows — code done

`jobs/geocodePins.js`: read / decide / apply / selftest / applytest.

- **47 self-test assertions**, including all four named guardrail cases. Two of
  my own assertions were wrong and were corrected rather than the rules: the
  Midtown metre figure, and Amsterdam Tobacco House — its pin is 252 km out,
  past the spec's own 50 km ceiling, so the right answer is a review row
  carrying the upstate address, not a silent 252 km jump.
- **9 apply-test assertions** against a real database: provenance stamped
  `geocode`, claimed and staff-edited listings untouched, the old coordinates in
  `store_edits`, and a foreign row hidden with its reason rather than deleted.
- The three public rows in `timezones_held.json` resolve to state errors with
  the pin right; their clocks follow. The five hidden ones are left alone.

**Blocked:** the `read` step. Neither geocoder is reachable.

### 5.3 Hijacked links and thumbnails — code done

Four new linkCheck verdicts (`elsewhere`, `hijacked`, `parked`,
`store_unavailable`), all dead links; 402 moved out of the firewall bucket.
New `jobs/thumbCheck.js`. A taken-over own-domain is a weak closure signal only.

- linkCheck **33 passed**, thumbCheck **27 passed**.
- Fixed in passing: `FOR_SALE_PATTERNS` used `[^.<>]` as its gap, so it could
  not cross the dot in the domain name it exists to span — the example in its
  own comment did not match.
- The profile explains the three new statuses instead of silently dropping the
  link.

**Blocked:** the recheck of every public website, and the thumbnail read.

### 5.4 Amenity crawl — the saved half is done, and it found real errors

All 1,343 crawled sites re-read at the sentence each verdict rests on:
**653 rest on a plain statement, 7 are false positives, 65 need re-reading.**

- The 7: Padre Island Cigar Company's site says it *does not have a lounge* and
  then recommends somebody else's — that recommendation is what matched. Three
  sites share an owner biography ("took a retail job in a cigar lounge"); three
  more describe the opening of Burn by Rocky Patel.
- The 65 are a defect in the read step, not in the shops: `quote()` kept 200
  characters of the matching *line*, and a line is often a paragraph, so the
  words that matched were cut off the end. Reading those as refusals would have
  removed 65 badges on no evidence. `quote()` keeps the matching sentence now;
  `read --redo-truncated` picks them up.
- `sweeps/decisions/site-facts/sentence_review.json` is real output about real
  listings.

**Blocked:** the remaining 1,095 sites, and the add/remove lists.

### 5.5 Hours re-audit — done end to end

**Accuracy 96.5% before, 97.9% after**, against all 174 reviewer verdicts. The
floor the work order sets is 97.3%.

- Six parser defects fixed, each now a test. The worst was `"4 pm - 12 pm"` read
  as `4am-12pm` — open all morning and shut all evening, the exact opposite of
  the truth.
- Four decide-time refusals added, plus the two-businesses-at-one-street-number
  case, which has no tie-breaker and is now a refusal.
- `mentionsShop` matches whole words now. My first version of the domain rule
  was too strict: it refused 14 listings and **reading them by hand showed 11
  were real shops on their own domains**. The rule was loosened to the work
  order's actual wording; the two known bad cases (brainerdglass.net,
  groutmasters.com) are still refused.
- House of Cigar and Anthony's keep their exact hours on all ten listings.
- Decision files in `sweeps/decisions/hours/`: 42 to clear, 8 to replace, 8
  chain rows needing the real stores table, 16 held, 292 recoverable candidates
  of which only 56 are real.
- `sweeps/scripts/hours_offline.js` replaces the harness that pointed at Windows
  paths and a snapshot that never travelled.

**Caveat, stated in the files themselves:** the harness knows ~1,250 of the
~4,000 listings with a website, so it undercounts how many share a site. The
chain rows are wrong here for that reason and are kept apart.

### 5.6 Menu scanner — done

The scan picked the same forty shops every six hours, for ever: a failed read
left `menu_matcher_version` NULL, which kept a shop permanently eligible, and
the order was by paid placement and classifier confidence rather than by when a
shop was last looked at.

- Every outcome goes through one `recordAttempt()`. Back-off: a live feed in a
  week, no online store in two months, errors at 3, 7, 14 then 30 days.
- The queue is ordered by staleness; a dead website is not asked for a menu.
- Stock unconfirmed for 21 days is marked out of stock with its reason, never
  deleted. An owner's own rows are never touched.
- One website, several listings: the feed belongs to the branch whose address
  the site names.
- The "checked N days ago" label turns amber past a week.
- **A 30-day replay is the test**: every shop reached, all 43 live shelves
  re-read (against 7 before). Under the old order, 3,940 of 4,000 shops were
  still untouched after 120 passes.

### 5.7 Closures and licence registries — code done

closureCheck: a platform profile is not a website; duplicates folded before
flagging; a new weak map-only rule; flags clear themselves when a listing gains
a phone, hours or a working site; the queue ordered by evidence strength.

`jobs/licenceSync.js` is new: eight free registries, four outputs. **A lapse is
a staff flag and nothing else** — a self-test asserts there is no verdict in the
job that hides a listing. Stogies, BlackHouse and Manhattan Tobacco are never
flagged; New York City is exempt from lapse flags entirely.

- closureCheck **16 passed** (it had no tests), licenceSync **31 passed**.
- Two bugs the tests caught: "1 Main St" and "1 Main Ave" matched as one door,
  and "Anthony's" split on the apostrophe into "anthony", which matches nothing
  in "ANTHONYS CIGARS LLC".

**Blocked:** the registry downloads.

### 5.8 Claim safety gate — done

`utils/claimProof.js`. The shortcut needs all of: a live re-check saying `ok`;
the listed URL, the final URL and the email on one registrable domain under a
public suffix list; a domain that is not free mail, a shortener, a directory, a
hosting platform, a government or a foreign country; exactly one public listing
on it; a page naming the shop; RDAP showing it registered a year ago and not
since import; and a verified email matching the account.

**It never rejects a claim** — only the self-serve shortcut, with the reasons
returned to the claimant so a real owner knows what proof to send.

- **All 25 live examples from the audit are tests.** The five sampled good
  domains pass; the four dead domains, the four gambling and for-sale redirects,
  the twelve two-label, free-mail, locality and institutional cases, and the
  shared domains are all refused. 44 assertions.
- `approveClaim` gains two guards, both checked against a real database: a
  duplicate listing can never be claimed, and self-serve never un-hides one.

### 5.9 The smaller ones — done, with a finding

`jobs/recoverHidden.js` brings a hidden shop back only on quotable evidence.
Run against the saved evidence it recovers **nobody**, and that is arithmetic
rather than a failure: the pure-cigar check hid those 2,480 listings by running
`siteVerdict()` on this same evidence. Verified rather than assumed — zero
contradictions, and all 639 saved readings that would prove a cigar shop belong
to listings that were kept public.

The useful part is what recovery actually needs, written per listing in
`sweeps/decisions/recover/`:

| | |
|---:|---|
| 1,933 | no site evidence at all — a licence match or web-shop stock is the only thing that can speak for them |
| 84 | site could not be read — a re-crawl with the browser-rendered pass |
| 463 | site was read and does not say cigars — these stay hidden, correctly |

Stale former names and rebrands come out of licenceSync as its `renamed` and
`moved` lists, which is the overlap the work order predicted. Chain branches
shrank to almost nothing when the tobacco-outlet chains came off the map.

---

## What the next session should do first

Everything below needs credentials or network this container did not have.
Nothing needs new code.

1. **Apply the hours decisions.** `sweeps/decisions/hours/` holds files that
   have been read row by row. Start with `hours_clear.json` (42) and
   `hours_replace.json` (8). `hours_chain_rerun.json` must be re-run against the
   real stores table first — do not apply it as it stands.
2. **Run the crawls that are blocked here**, in this order — each one feeds the
   next:
   - `linkCheck --all` (every public website; the new verdicts did not exist
     when the current statuses were written, so every `ok` in the table predates
     them)
   - `thumbCheck read` → `decide` → read the output → `apply`
   - `geocodePins read` → `decide` → read the review list → `apply`
   - `siteFacts read --redo-truncated` for the 65 cut-short quotes and the 1,095
     sites never read
   - `licenceSync fetch` → `match` → review
3. **Then `recoverHidden propose --licences <file>`**, which only becomes
   useful once the licence and crawl steps above have run.
4. **Re-run the recall monitor against production** before and after shipping
   the search change, and read `metro_diff.js` output for the eight metros.
5. **Ask Mason** the three questions in HANDOFF section 7, plus the one this
   session added: the neutral no-location order needs a decision before the
   home page and the review picker can be improved.

## Notes for whoever picks this up

- The CRLF trap in HANDOFF section 6 does not apply in a Linux clone — every
  file here is LF. It will still apply on the Windows machine.
- `node src/index.js` builds a realistic 42,928-listing database from the
  bundled directory file on first boot. Its ids are not production's, so saved
  evidence cannot be joined to it, but it is the right place to test anything
  that only needs realistic shape and volume.
- `sweeps/scripts/build_fixture_db.js` builds a synthetic database on demand.
  It is clearly labelled: no decision about a real shop may be taken from it.
- Every job in `server/src/jobs/` now answers to `selftest`. Run them all before
  changing anything.
