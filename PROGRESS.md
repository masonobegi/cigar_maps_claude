# Session progress log

**Session started 2026-09-12.** Picking up `HANDOFF.md` in a cloud container.
This file is updated as each task lands, so that a stop at any point leaves the
next session an accurate picture. `SWEEPS.md` stays the production-facing log;
this file is the session log.

## The environment this session runs in, and what it blocks

| Thing | State |
|-------|-------|
| Repo | Fresh clone, branch `claude/handoff-tasks-completion-m1aqvb` off `master` |
| `npm ci` server + client | Done, both clean |
| `sweeps/evidence.tar.gz` | Extracted to `sweeps/evidence/` (16 files, 30 MB) |
| Self-tests before any change | **All 5 pass** (see baseline below) |
| Railway CLI / `RAILWAY_TOKEN` | **Absent.** No production database |
| Outbound network | **Package registries only.** The egress proxy answers 403 to anything else — no geocoders, no shop websites, no registries |
| `server/data/` snapshot | **Absent.** It is gitignored, so the clone did not carry it |
| The five `sweep/*` branches | **Absent.** They were local to the desktop machine; only `master` and this branch exist on the remote |

**What that means.** Two separate walls, not one. Per HANDOFF section 3 ("If you
cannot reach Railway, do not guess"), every task here stops at the decision file.
On top of that, any step that fetches something from the open web — the
geocoders in 5.2, the link and thumbnail checks in 5.3, the rest of the amenity
crawl in 5.4, the licence registries in 5.7 — cannot run here at all, because
the proxy answers 403 to every host outside the package registries. Those steps
are written and tested against fixtures and saved evidence; they are not run. Code, tests and dry runs
against the saved evidence are all in scope and are being done in full; the
`apply` step against production is not, and each task below says so explicitly.
No task is marked done on the strength of an apply that did not happen.

### Baseline self-tests (before any change, 2026-09-12)

    hoursParser        63 passed, 0 failed
    storeHours         35 passed, 0 failed
    dedupeListings     14 passed, 0 failed
    pureCigarCheck     10 passed, 0 failed
    hoursSweep         13 passed, 0 failed

## Task status

| # | Task | State |
|---|------|-------|
| 1 | 5.1 Search completeness | **code done, tested, committed** — applying is not a step this task has |
| 2 | 5.2 Pins, states and foreign rows | **code done, tested** — the crawl is blocked by the network policy |
| 3 | 5.3 Hijacked links and thumbnails | starting |
| 4 | 5.4 Finish the amenity crawl | not started |
| 5 | 5.5 Re-audit the hours we publish | not started |
| 6 | 5.6 Menu scanner | not started |
| 7 | 5.7 Closures and licence registries | not started |
| 8 | 5.8 Claim safety gate | not started |
| 9 | 5.9 The smaller ones | not started |

## Log

- **Prep.** Extracted the evidence archive, installed both workspaces, ran the
  five self-tests named in the handoff. All green. Established that production
  is unreachable from here and recorded it above rather than guessing at it.

- **5.1 Search completeness — done.** `utils/storeSearch.js` (filters, SQL
  haversine, the radius contract) and `utils/storeList.js` (the list itself) are
  new; `routes/stores.js` is a two-line wrapper over the latter, so
  `jobs/recallMonitor.js` replays the real code path instead of a copy.
  - Recall on the fixture: **72.9% at 50 mi / 58.4% at 100 mi before,
    100.00% (81,537/81,537) over 1,984 cases after, no failures.**
  - 19 contract checks pass: radius cap, ceiling refusal (forced, by lowering
    the ceiling under the list), paging with no repeats or gaps, two shops on
    one spot, a shop on the radius line, open-now on confirmed hours only,
    hidden rows, and the no-location order unchanged.
  - The client shows the real total, a Show more button, and how many nearby
    shops have no hours we can confirm.
  - **Deliberately not done:** the neutral no-location order is a separate
    sweep in `plan.json` and owes Mason a decision, so a visitor with no
    location still gets exactly the order they got before.
  - **Blocked on production:** the guardrail skim of the first 30 cards for the
    eight affected metros. `sweeps/scripts/metro_diff.js` does it and is proven
    to run; it needs the real directory to say anything about real shops.
  - The CRLF trap in HANDOFF section 6 does not apply here: every file in this
    clone is LF. It will still apply on the Windows machine.

- **5.2 Pins, states and foreign rows — code done.** `jobs/geocodePins.js`,
  read / decide / apply / selftest / applytest.
  - **47 self-test assertions pass**, including all four named guardrail cases.
    Two of my own assertions were wrong and were corrected, not the rules: the
    Midtown metre figure, and Amsterdam Tobacco House — its pin is 252 km out,
    which is past the spec's own 50 km ceiling, so the right answer is a review
    row carrying the upstate address, not a silent 252 km jump.
  - **9 apply-test assertions pass** against a real database: provenance stamped
    `geocode`, claimed and staff-edited listings untouched, the old coordinates
    in `store_edits` so a move can be undone, and a foreign row hidden with its
    reason rather than deleted.
  - The three public rows in `timezones_held.json` resolve to state errors with
    the pin right (Cigar Mafia and Cigar Crafted are Houston shops; Vip smoke
    and cigar is Mission Viejo, California); their clocks follow. The five
    hidden ones are left alone — no customer sees their clock.
  - **Blocked:** the `read` step. Neither geocoder is reachable from here.
