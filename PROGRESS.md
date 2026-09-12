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
| `server/data/` snapshot | **Absent.** It is gitignored, so the clone did not carry it |
| The five `sweep/*` branches | **Absent.** They were local to the desktop machine; only `master` and this branch exist on the remote |

**What that means.** Per HANDOFF section 3 ("If you cannot reach Railway, do not
guess"), every task here stops at the decision file. Code, tests and dry runs
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
| 2 | 5.2 Pins, states and foreign rows | starting |
| 3 | 5.3 Hijacked links and thumbnails | not started |
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
