# Work log (2026-09-09)

Running log of the autonomous build session. Newest entries at the bottom. If this session was interrupted, start from "Next steps" and check "In flight".

## Done

- **ROADMAP.md** written (six phases + decisions). Companion web page drafted in the session scratchpad; publish pending.
- **Store directory (Phase 1).**
  - `server/src/jobs/osm.js` (Overpass bbox queries per state, classifier, hours converter, dedupe), `fetchOsmStores.js` (resumable 52-state fetch, `--fill-cities`), `geo.js` (point-in-state), `buildDirectory.js` (merges Overture + OSM into `server/src/data/store_directory.json.gz`), `importStores.js` (boot importer, currently still reads `osm_stores.json`; switching it to the merged directory is the next code change).
  - OSM fetch finished: 52/52 states, 6,046 records. Overture extract finished: 40,020 US places (DuckDB query in a comment at the bottom of `buildDirectory.js`; raw file at `server/data/overture_raw.json`, gitignored).
  - Merged directory built: 42,831 stores, 8,083 public (classifier confidence >= 0.5).
- **Schema** (`server/src/database/schema.js`): migrations 020-056: nullable `stores.user_id`, claim/source/type/confidence/visible columns, `store_claims`, `store_reports`, inventory provenance columns, `stores.menu_*`, `password_resets`, `users.email_verified`, `catalog_pending`.
- **Server**: claim endpoints (`POST /stores/:id/claim`, `/claim/verify`, `/claim-status`, `/report`), admin claims/listings/reports endpoints, `stores` list with `bbox`/`limit`/`store_type`/`claimed`, `/auth/me` returns `pending_claim`, cigar search case- and accent-insensitive per token, `/cigars/filters` fixed (was a Postgres error), helmet + rate limits, PGlite fallback when `DATABASE_URL` is unset (`server/data/pglite`).
- **Catalog**: `server/src/database/catalog.js` seeds 169 real cigars / 690 vitolas on boot.
- **Client**: AgeGate, clustered StoreMap with viewport loading, Stores page unclaimed pills, StoreProfile unclaimed banner + claim modal + report modal, Register `?type=store&claim=ID`, StoreDashboard pending-claim card, AdminPanel Claims/Listings/Reports tabs, AuthContext `pendingClaim`/`refreshMe`.
- **Verified locally**: `npm run build` passes; smoke test at scratchpad `api_test.js` passes (29/30, the one "failure" is a test assumption after an admin unhide).
- **Memory** updated (`~/.claude/projects/.../memory/project_habano.md`).

## Interruption 1 (session limit, ~7pm)

The review workflow finished Review + Verify (100 agents) but hit the session limit during Fix and never reached its Build stages. Recovered state:
- 32 findings raised across four lenses, **29 confirmed** by 2+ of 3 adversarial refuters (list below).
- The fix agent had already fixed `server/src/utils/claims.js` (shared-host domains cannot instant-verify, claimant now emailed on approve/reject, self-serve claim no longer un-hides a staff-hidden listing) and `server/src/utils/email.js` (sendMail resolves false instead of undefined) before it died. All server files pass `node --check`.
- **All 29 confirmed findings are now fixed** (by hand, after the agent died). Summary:
  - *Claim security*: per-route rate limits on claim and verify, 5 wrong codes burns the code, 2-minute cooldown between verification emails, claim falls back to staff review when the email fails to send, shared hosts (facebook, wixsite, square.site...) can never instant-verify.
  - *Visibility*: a staff-hidden listing 404s for the public (owner and staff still see it), staff edits set `stores.staff_edited` so a directory refresh no longer undoes them, `visible` is recomputed from confidence on re-import for rows staff have not touched, admin store_type is validated against the four known types.
  - *Leaks*: public store list and profile no longer return sheet URLs, menu bookkeeping, or source ids; cigar review lists no longer ship base64 photos (they use the existing `/api/review-images/:id`).
  - *Reports*: rate limited, and one open report per person per store (per reason for anonymous).
  - *Data*: overnight hours ("11am-2am") now read as open on both server and client; `24:00` closes become `11:59pm`; comma-separated OSM rules parse; dedupe no longer merges two shops that only share a generic word; state assignment snaps coastal and island points to the nearest state and stops labelling Alexandria as DC (12/12 test cases pass).
  - *Correctness*: owner-created stores are `claimed=1` immediately, followers of unclaimed listings get community and event notifications, recommendation review counts are no longer multiplied by inventory rows, following a bad user id returns 400/404 not 500.
  - *Client*: manual claims refresh the account so the dashboard shows "claim pending" instead of the setup wizard, the unclaimed banner disappears after a successful claim, `?next=` is honored on login, the map re-queries when filters change without moving.
- **Directory switched to the merged source**: `importStores.js` now loads `store_directory.json.gz` (Overture + OSM), keyed on `source:source_id`, and upgrades an existing OSM row in place when a later build folds it into an Overture record. Falls back to `osm_stores.json` when no built directory exists.
- The workflow's Build stages (password reset + email verification, cigar-page availability, online-menu importer, store filters) were NOT run. Schema migrations 039-056 and the api.js client functions for them are already in place, so that work can start from there.

## Verification after the fixes

- Fresh-database boot imports all 42,923 directory rows in 11 s; 8,193 pass the classifier and are public, 34,735 sit hidden in the admin Listings queue.
- One real bug caught by the new tests: the importer re-classifies every record, and it was being handed Overture's raw category object instead of the tag shape the classifier reads, which silently hid ~3,300 real shops. Fixed by having the directory build emit a `ctags` field for both sources.
- `scratchpad/fix_test.js` (17 targeted checks for the 29 fixes): all pass.
- `scratchpad/api_test.js` (30 end-to-end checks): all pass. Note the two suites share an IP, so running them back to back trips the new claim rate limiter; run them against separate server instances.
- `cd client && npm run build`: clean.

## Interruption 2 recovery — features

Password reset and email verification built by hand (I own these files, so they cannot collide with the agents):
- `server/src/routes/auth.js`: POST /auth/forgot (always 200, never reveals whether an account exists, invalidates older unused links, 1-hour single-use token), POST /auth/reset, POST /auth/send-verification, POST /auth/verify-email. Registration queues a verification email without blocking the response. Both mail endpoints are rate limited to 5 per 15 minutes per IP. With no SMTP configured the link is logged instead, so it works locally.
- New pages `ForgotPassword.jsx`, `ResetPassword.jsx`, `VerifyEmail.jsx`, banner `EmailVerifyBanner.jsx`, routes in `App.jsx`, "Forgot password?" link in `Login.jsx`, and `email_verified` on `/auth/me`.
- Test: `scratchpad/auth_test.js` (17 checks, reads the one-time links out of the server log).

A second workflow (`wf_3af3b172-8b3`) is building the other three features in parallel with strict file ownership: online menus from shop websites (new `cigarMatcher.js`, `webMenu.js`, `menus.js` + StoreProfile/StoreDashboard/AdminPanel), "where to find it" on the cigar page (CigarDetail.jsx + the availability handler), and store filters (Stores.jsx + the list handler). **If it dies again**: the store filters and cigar availability work were already landing when this was written; check `git status` and finish anything partial. The menus router still needs mounting in `server/src/index.js` at `/api` plus a `runStartupMenuScan()` call after listen, which the orchestrator (not the agent) must add.

## Final session: features, decisions, billing

All three parallel feature agents finished cleanly (6 agents, 0 errors).

- **Online menus (Tier 0 inventory).** `cigarMatcher.js` (brand-gated fuzzy matcher, 30 self-tests), `webMenu.js` (Shopify `/products.json` and WooCommerce Store API readers, private-IP refusal, 2 MB body cap, cigar-vocabulary keep list, accessory reject list, idempotent upsert keyed on `(store_id, source='web', external_id)`, unmatched titles queued in `catalog_pending`), `menus.js` (menu status, owner refresh with a 10-minute cooldown, owner opt-out, admin catalog queue and scan). Verified against three real shops: a Shopify store yielded 717 products with 506 matched to the catalog; a WooCommerce store 800 products with 62 matched; a third sells only a house brand, so all 22 correctly went to the queue instead of being force-matched. Router mounted in `index.js`; startup scan waits 5 minutes so it never races the directory import.
- **"Where to find it"** on the cigar page, with distance sorting, price ranges, freshness, and a web-source note.
- **Store filters**: multi-select type chips and a has-inventory filter, wired through both the list and the map viewport query.
- **Password reset and email verification** (built by hand, 18 checks).
- **Decisions, all now made and implemented**: web-first (the cigar tab reads "Where to find it", no purchase language anywhere); Overture plus OpenStreetMap with attribution in the footer and on the map; read shop websites with opt-out and link-back; the name is CigarBuddy everywhere (package names, window titles, start script).
- **Images out of Postgres**: `utils/storage.js` writes to any S3-compatible bucket (Cloudflare R2 by default) with hand-rolled SigV4 and no SDK, falling back to a local directory served at `/uploads`, and falling back again to the database when nothing is configured, so an unconfigured deploy behaves exactly as before. `jobs/migrateImages.js` moves existing base64 rows out one at a time and is safe to re-run.
- **Billing**: `routes/billing.js` with Free / Featured ($49) / Partner ($149), Stripe over plain https with no SDK, checkout and portal sessions, a signature-checked idempotent webhook, and paid placement that reorders results the search already matched. A `/pricing` page and a billing block in the store dashboard. With no Stripe key the whole thing reports itself as switched off rather than erroring.
- **Outreach rewritten** around claiming ("your shop is already listed") rather than signing up.

Verification on a clean database: `api_test.js`, `fix_test.js`, `auth_test.js` and `feature_test.js` all pass; client builds clean; every server file passes `node --check`.

## In flight (background jobs)

1. **Workflow `wf_eee88874-69d`** (multi-agent): Review (4 lenses) -> Verify (3 refuters per finding) -> Fix -> Build (parallel: password reset + email verification; cigar page "Where to find it"; online-menu importer from Shopify/WooCommerce feeds) -> store filters -> Check (client build, scratch server on port 3150, smoke test, fix loop). Journal: `~/.claude/projects/c--Users-mason-OneDrive-Desktop-cigarApp/a956c8ab-bec6-4085-b83b-7fcd97853bc4/subagents/workflows/wf_eee88874-69d/journal.jsonl`. As of this entry it is in the Verify stage.
2. **City backfill** for OSM records missing a city: `node src/jobs/fetchOsmStores.js --fill-cities` (about 50 minutes, saves progress every 25). Log in the session scratchpad `osm_cities.log`. Rebuild the directory afterwards (`cd server && npm run build:directory`).
3. Local dev API on port 3105 (PGlite in `server/data/pglite`) used for manual checks; safe to kill.

## Next steps (in order)

1. When the workflow's Fix stage is over: change `server/src/jobs/importStores.js` to load `src/data/store_directory.json.gz` (via `loadDirectory()` from `buildDirectory.js`, fallback to `osm_stores.json`), key rows on `source + ':' + source_id`, and when an Overture record carries `osm_id`, upgrade the existing `source='osm'` row in place (same DB id) instead of inserting a duplicate.
2. When the city backfill finishes: `npm run build:directory` again.
3. When the workflow finishes: read its result, re-run `node --check` on server files, `cd client && npm run build`, restart the local server and run the smoke test, spot-check the new endpoints.
4. Publish the roadmap page (scratchpad `cigarbuddy-roadmap.html`) and update its figures if they changed.
5. Final recap to Mason with the short "what's left" list (see ROADMAP.md section 10 and the phases).

## Shipped

Committed as `284823f` and pushed to `master`, which triggers the Railway deploy of the "cigar maps" project.

## Still needs Mason

**Rotate one password.** `W@ffle871` for mobegibusiness@gmail.com sat in this public repository's history (it predates this session). The seed no longer contains it and production now generates random passwords, but the old value is still in git history, so change it anywhere else it is used.

**Railway environment variables**, in rough priority order:
1. `ADMIN_PASSWORD` and `STAFF_PASSWORD` — otherwise the deploy prints one-time random ones in its boot log.
2. `SMTP_USER` / `SMTP_PASS` / `ADMIN_EMAIL` / `APP_URL` — turns on claim codes, password reset, and claim notifications.
3. `S3_*` for Cloudflare R2, then run `node src/jobs/migrateImages.js` once to move existing photos out of Postgres.
4. `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_FEATURED`, `STRIPE_PRICE_PARTNER` — until these exist the pricing page reports billing as switched off, which is the correct state for now.

**Other:**
- Delete the placeholder "Brand 1..5" cigars and "Store 1..5" demo stores from production in the admin panel once real shops have claimed listings.
- Buy cigarbuddy.com, check the trademark, and point the Railway domain at it.
- Spot-check the launch metro in the admin Listings queue and unhide anything the classifier scored too low.
