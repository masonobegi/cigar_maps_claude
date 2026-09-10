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

## Cleanup pass (same day, later)

**Demo data gone from production.** `jobs/purgeDemoData.js` removed the 25 "Cigar 1..25" placeholders, the 5 "Store 1..5" shops and the 7 @demo.com accounts, plus 63 vitolas, 165 inventory rows, 7 reviews and the owner's own test humidor/smoke-list entries against a placeholder. 169 real cigars remain. The seed can no longer recreate any of it when DATABASE_URL is set.

**Storefront sweep.** `jobs/storefrontCheck.js` hid 537 listings that are not places you can walk into: wrong categories (a brewery, a barbershop, a title company, a cabinet maker, a fastener supplier, a t-shirt printer, a pressure-washing supplier, all called "Cigar City" because that is Tampa's nickname), wholesalers and distributors, factories and museums, corporate headquarters, and company registrations with no phone or website. A name that says what the business sells outranks a wrong category, so lounges filed under "cafe" or "barber" survive. 7,651 real shops remain public, 35,272 sit in the admin review queue.

**Website sweep.** `jobs/linkCheck.js` checked all 4,977 websites on public listings. 3,616 work and keep their link; 1,361 are dead and the link is now hidden entirely, so a shop with a broken site looks the same as one that never had a site. Breakdown of the dead: 779 domains that no longer resolve (120cigarbar.com among them), 339 not found, 63 refused, 59 timing out, 49 parked on for-sale pages, 72 other errors.

A follow-up pass matters here: the first run treated an HTTP 403 as dead, but Cloudflare answers any non-browser with 403, so 199 real shops (JR Cigar included) were wrongly marked. 401/403/407/429/451 are now a separate 'blocked' verdict that counts as working, and those links were restored.

## Shipped

Committed as `284823f` and pushed to `master`, which triggers the Railway deploy of the "cigar maps" project.

## Closed shops (2026-09-10)

Overture carries an `operating_status` column we were not reading: 564 US cigar/tobacco places are marked `permanently_closed`. The extract, the directory build and the importer now carry it, and a source-confirmed closure is hidden on import.

It is necessary but not sufficient. Broadway Cigar Company in Camas WA is shut but Overture still says `open`, so the source lags by months. Three more signals fill the gap:
- the shop's own website announcing a closure, with guards so "closed Sundays" never counts;
- nothing left to contact at all (dead website, no phone, no hours) as a weak "likely closed";
- visitors reporting it, with two independent reports hiding an unclaimed listing automatically.

A claimed listing is never auto-hidden by any of these. An owner who claimed their shop knows better than our data does.

### What actually shipped (2026-09-10)

- **Source status**: 560 listings marked `permanently_closed` by Overture; 162 were still public and are hidden.
- **Website signal**: swept 3,867 listings with a working site, found 4 genuine closures the source still calls open (Redland Cigar Co in San Antonio says "closed permanently" on its own page).
- **No contact route**: 49 listings with a dead site, no phone and no hours flagged `likely_closed`. Left visible on purpose and sent to the staff queue, because it is suggestive, not proof.
- **Visitor reports**: two independent "permanently closed" reports hide an unclaimed listing; claimed and staff-decided listings are never auto-hidden.
- Public map: 7,483 listings.

### Three bugs caught during this pass, all worth remembering

1. **The importer un-did the sweeps.** A deploy re-ran the directory import, which recomputes `visible` from the classifier for any row without `staff_edited`. The storefront sweep writes its verdict to `stores.storefront` but not `staff_edited`, so 519 ruled-out listings came back, Cigar City Brewing included. Fixed: the importer now treats `storefront IN ('not_retail','online_only','closed')` as binding. Proven with a forced re-import against a scratch database (`scratchpad/test_reimport.js`). **Any future sweep that hides rows must either set `staff_edited` or be honoured explicitly by `importStores.js`.**
2. **A closure notice on someone else's page.** OC Cigar Lounge is listed with an Eventbrite URL reading "online ticket sales are now closed". The lounge trades. Now a listing pointing at a platform (Eventbrite, Facebook, Yelp, directories) is never read for closure, and closure sentences about tickets, registration or waitlists are disqualified.
3. **A trade word in the name is not proof.** Adding brewery/barbershop words to the reject list caught the airport brewpub but also six genuine lounges sharing premises with another trade. The trade word now only disqualifies a name that never states a cigar premises of its own.

## Superseded plan: closed shops

Broadway Cigar Company in Camas WA (store 10022) is shut down but was still listed. Hidden by hand and marked `storefront='closed'`. The wider problem is that nothing in the pipeline knows a shop has closed: the source data lags by months, and roughly 1,361 listings already have a dead website, which is itself a strong closure signal.

Worth trying tomorrow, cheapest first:
1. **Dead website plus no phone answer.** Cross the 1,361 dead-link listings against the ones with no phone. That intersection is very likely closed and is free to compute.
2. **Google Places on demand.** Their `business_status` field returns CLOSED_PERMANENTLY / CLOSED_TEMPORARILY and is authoritative. The terms allow storing the place id indefinitely but other fields only ~30 days, so query it lazily when a listing is viewed and cache only the status. This is the reliable answer, and the $200/month free credit covers roughly 10,000 lookups.
3. **A "permanently closed" reason on the existing report button**, so visitors do the work. The report queue already exists; it just needs closure as a first-class reason that hides the listing after a couple of independent reports.
4. **Re-import freshness.** Overture publishes monthly; a listing that disappears from two consecutive releases has probably closed.

## Store pages, catalog and chains (2026-09-10, afternoon)

Mason's report: Anthony's Cigar Emporium showed 1,402 "SKUs" as a wall of near-identical "Fuente Fuente $X" chips, OpusX 161 times from $6 to $3,500, while its own site lists dozens of brands the page didn't show. "Near Camas" sat above a nationwide list. The directory was one long column.

**The store page now reads brand → line → sizes, with one price range per line.** A shop's feed lists a single, a five-pack and a box as three products, so a line gets a range ("$5–$300") instead of a chip per variant. Brand filters; search reaches the whole shelf, not the first 200 rows; tabs appear only where there is something behind them.

**The catalog learns from shop feeds.** 169 curated lines became ~6,600 live lines: every shop's product titles, with packaging and size stripped, grouped by line. Measured on Anthony's 5,177 products: 46% placed before, ~98% after, 47 brands on the page instead of 30, OpusX down to its 25 real listings. Rules Mason set, all enforced by tests (`productParser.js` self-test, the catalog tests):
- sublines stay separate (Camacho Corojo / Connecticut / Broadleaf; Rocky Patel Vintage 1990 / 1992 / 2003);
- sizes fold under their line, including house size names (Curivari Gloria de Leon Dominante/Fuerza/… are one line in six sizes);
- a Shopify "vendor" field that is really the store's own name ("handrolledcigars", "My Store") is not a brand.

Old shapes are **retired, never deleted** (`cigars.source = 'retired'`): out of matching, browsing and counts, still joined by the stock that points at them, so no shop page empties while menus are re-read. `MATCHER_VERSION` (now 4) makes the menu scanner re-read every shop matched by an older version.

**Matcher bugs found on the way:** a brand word earned credit as a name word (every Arturo Fuente product scored 2/3 against OpusX); "Serie R No. 8 … 5-Pack" satisfied the number check for "No. 5"; a size word in a title ("Corona") counted as evidence for any line carrying it.

**Directory:** a grid, not a column. A remembered location is only applied if it still has coordinates, and never automatically. 34 same-address duplicates hidden (chains with several branches in one city kept). Anthony's has 3 Tucson shops and 1 in Phoenix, per its own structured data. A fifth listing on N Oracle Rd is not one of them and is hidden.

**Chain check** (`jobs/chainCheck.js`): where listings share a website, compare them with the locations the chain publishes. The first run flagged 59 "closed branches". A second look found 47 were in towns the chain's site still names: real stores whose addresses the scraper couldn't parse, including 14 Sweet Fire Tobacco stores. Applied only the 7 with corroborating evidence (town and phone absent from the chain's site, or structured data), and cleared 2 wrong links rather than hide shops of uncertain identity. Apply only a reviewed decisions file: `--confirm --from`.

## Still needs Mason

**Rotate one password.** `W@ffle871` for mobegibusiness@gmail.com sat in this public repository's history (it predates this session). The seed no longer contains it and production now generates random passwords, but the old value is still in git history, so change it anywhere else it is used.

**Railway environment variables**, in rough priority order:
1. `ADMIN_PASSWORD` and `STAFF_PASSWORD` — otherwise the deploy prints one-time random ones in its boot log.
2. `SMTP_USER` / `SMTP_PASS` / `ADMIN_EMAIL` / `APP_URL` — turns on claim codes, password reset, and claim notifications.
3. `S3_*` for Cloudflare R2, then run `node src/jobs/migrateImages.js` once to move existing photos out of Postgres.
4. `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_FEATURED`, `STRIPE_PRICE_PARTNER` — until these exist the pricing page reports billing as switched off, which is the correct state for now.

**Other:**
- Buy cigarbuddy.com, check the trademark, and point the Railway domain at it.
- Spot-check the launch metro in the admin Listings queue and unhide anything the classifier scored too low.
