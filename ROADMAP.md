# CigarBuddy Roadmap: from demo to "Weedmaps for cigars"

Last updated: 2026-09-09

## 1. Where you actually are

You have built a lot. The two-sided app is real: enthusiast accounts with a humidor, smoke list, detailed review logbook, cigar follows and in-stock alerts, community posts, events with RSVPs, a passport, store following with per-store notification preferences. Store accounts get a setup wizard, inventory management, Google Sheets sync every 15 minutes, CSV/XLSX import, deals, broadcasts, analytics, and a verification flow with an admin queue. It runs on Railway with Postgres, has a Leaflet map with distance sorting, a PWA install prompt, and a Capacitor shell for iOS/Android. The outreach scraper has already collected about 1,000 US stores into CSV and has email and voicemail senders ready.

What stops it from being a product people want today:

| Gap | Why it matters | Evidence in repo |
|---|---|---|
| The map is empty | A store only exists when an owner signs up. Weedmaps listed every dispensary on day one, claimed or not. A user in any city opens the app and sees nothing. | `stores.user_id NOT NULL`; the 1,035 scraped stores live in `scraper/results/stores_MASTER.csv`, not in the DB |
| The catalog is fake | Search for "Padron 1964" returns nothing. The whole pitch to shops ("customers search a cigar and find you") depends on the catalog. | `seed.js` has 25 cigars named Brand 1 through Brand 5 |
| Inventory is manual | Sheets sync is a good start, but a shop owner will not maintain a spreadsheet for a site with no users. Inventory needs to appear with near-zero effort. | Only Sheets sync and CSV import exist; no POS or website ingestion |
| No trust or legal basics | No age gate, no password reset, no email verification, no rate limiting, no tests. Tobacco apps get scrutinized. | No 21+ gate in client, no reset route in `auth.js`, no `express-rate-limit` |
| Photos live in Postgres | Review photos and cigar images are base64 TEXT columns. This will make the DB huge and slow. | `reviews.photo_data`, `cigar_images.image_data` |
| Nothing to sell | No pricing, no billing, no paid tier. | No Stripe anywhere |

Everything else you might be tempted to build (more community features, more review fields, more themes) is worth less than fixing the six rows above.

## 2. The strategy in one paragraph

Weedmaps won for four reasons. It listed every dispensary whether or not they asked. Menus were live because it integrated with the POS systems dispensaries already used. It was dense in one region (Southern California) before it went wide. Consumers came for menus, and dispensaries paid for placement once consumers were there. Cigars have one structural advantage over cannabis: shipping tobacco is heavily restricted, so most premium cigars are bought in person anyway. Local discovery is the natural mode. Your plan is the same four moves in the same order: list every store automatically, make inventory appear with as little owner effort as possible, win one metro completely, then charge for placement.

Every store on the platform should sit on a ladder that you can measure:

1. Listed. Auto-imported, no owner involved. Name, address, pin, hours if known.
2. Claimed. Owner verified they run it. Can edit details and post deals.
3. Live menu. Inventory is flowing from somewhere automated.
4. Partner. Paying for placement or promotion.

The north-star metric is the share of stores in your launch metro at rung 3 or higher.

## 3. Phase 1: Every store on the map (weeks 1 to 4)

Goal: a user in any US city opens the map and sees the cigar shops near them, with a "claim this store" button on each.

Schema changes:
- Make `stores.user_id` nullable. Add `claimed`, `claimed_at`, `source`, `source_id`, `store_type` (cigar shop, lounge, tobacco shop, smoke shop), `confidence`, `visible`, `hours_raw`, `last_verified_at`.
- Unique index on `(source, source_id)` so re-imports update instead of duplicate.
- A claim path: reuse `verification_requests` with a `claim` flag, or a `store_claims` table. Approval attaches the user and flips `claimed`.

Data pipeline, built as a re-runnable job:
- Primary sources are the open bulk datasets. Overture Maps Places (permissive CDLA license) and Foursquare Open Source Places (Apache 2.0) both publish Parquet files with categories like tobacco shop, cigar bar, and smoke shop. Filter by category plus a name regex (cigar, tobacco, tobacconist, humidor, stogie, lounge). Verify the exact category names in the current release.
- OpenStreetMap via Overpass (already built) as the first pass and gap fill. Note the ODbL share-alike clause if OSM becomes a large share of your derived database. Keep attribution on the map, which you already have.
- State tobacco retailer license lists as a validation layer. Most states publish licensed tobacco retailers as public records. They include gas stations, so use them to confirm, not to seed.
- Google Places only on demand for enrichment (hours, phone, website, photos) when a store is viewed or claimed. Google's terms let you store the place ID indefinitely but other fields only about 30 days, so do not bulk-cache Google data.
- Dedup by normalized name, E.164 phone, and proximity within about 150 meters. Merge, do not drop.
- Classification. Score each candidate as cigar shop versus vape or head shop versus convenience store using name keywords, category, and a fetch of the website homepage (mentions of humidor, lounge, or known brands). Anything under a confidence threshold is hidden from the public map and goes to an admin review queue.
- Reverse-geocode anything missing a city on a slow background schedule.

Product changes:
- Public store list and profile show unclaimed stores with a badge and a "Claim this store" call to action. Order verified and claimed above unclaimed.
- Claim flow. Owner picks the listing, proves control by one of: a code sent to the phone number on the listing, an email at the website's domain, or manual review with a photo of a license. Approved claims flip `claimed` and attach the user.
- Map upgrades. Marker clustering, viewport-based fetching with a bounding box parameter on the stores endpoint, and the map as the default view on mobile.
- Suppress and correct. A "report a problem" link on every listing (closed, wrong address, not a cigar shop). Owners and admins can hide junk.

Done when: at least 3,000 US stores are listed, your launch metro is at 95% coverage on a spot check against Google Maps, and under 2% of listings are junk.

## 4. Phase 2: A real cigar catalog (weeks 3 to 8, overlaps Phase 1)

Goal: someone can type "Padron 1964" or "Opus X" and land on the right cigar with its vitolas and a photo.

Data model:
- Add `line`, `manufacturer`, `slug`, `aliases`, `msrp_single`, `upc`, `status` (approved or pending), `is_discontinued`, `image_source` to `cigars`. Keep `vitolas` as is but add `upc` there too, since barcodes are per size.
- Brand becomes its own table with a logo, country, and website.

Sourcing:
- The top 60 brands cover the large majority of what sits in US humidors. Work brand by brand from manufacturer and distributor sites (Padron, Arturo Fuente, Davidoff, Drew Estate, General/STG, Tabacalera USA, Oliva, My Father, Rocky Patel, AJ Fernandez, Plasencia, Crowned Heads, Foundation, Tatuaje, Warped, Dunbarton, Aganorsa, Perdomo, and so on). Brand, line, vitola names, sizes, wrapper, binder, filler, and country are facts and can be collected freely. Descriptions and photos are not. Write or generate your own descriptions, and ask manufacturers for press images or use user-submitted photos.
- Every store inventory sheet or import is a catalog signal. Unknown names go to a pending queue with fuzzy match suggestions for you to approve. This queue will do most of your long-tail catalog work for free once stores are connected.
- Let users propose a cigar from the humidor add flow, marked pending until approved.

Matching and search:
- Enable `pg_trgm` in Postgres and replace the LIKE searches with trigram similarity on a concatenated brand plus line plus name field, with the alias list included. Add GIN indexes. This fixes "Padron 64" and "Fuente Opus" style queries and backs the existing autocomplete.
- Build one shared `matchCigarName()` used by Sheets sync, CSV import, and the smoke log import so all ingestion paths agree.

Later differentiator: band recognition. Photo of a cigar band, vision model returns brand and line, user confirms. Use it for the humidor add flow and for store shelf scans in Phase 3.

Done when: 2,500 or more cigars and 8,000 or more vitolas, photos for the top 300, and the pending queue is under 50 unmatched names after a full sync of connected stores.

## 5. Phase 3: Inventory that updates itself (weeks 6 to 12)

Goal: most listed stores in your launch metro show something in stock without the owner lifting a finger, and claimed stores get live inventory in one sitting.

Tier 0, automated, no owner action:
- Many cigar shops have an online store on Shopify, WooCommerce, or BigCommerce. Detect the platform from the website HTML. Shopify exposes a public products JSON endpoint on most stores, WooCommerce exposes a public Store API for products, BigCommerce and others can be walked through their sitemap. Pull product names, prices, and stock flags, run them through the matcher, and show them as an "online menu, updated N hours ago" with a link back to the shop. Include an opt-out for the owner. Never copy their descriptions or images.
- Re-crawl on a schedule and decay stale items.

Tier 1, five minutes for the owner: Google Sheets sync and CSV import. Already built.

Tier 2, fifteen minutes for the owner and the best long-term source: POS integrations via OAuth.
- Square (Catalog and Inventory APIs plus the inventory count webhook) and Clover (REST inventory plus webhooks) first, since they are the most common in small tobacconists. Lightspeed Retail and Shopify POS next.
- One webhook handler upserts an inventory row. Store the POS item ID on the inventory row so updates are idempotent.
- Unmatched POS items land in the pending catalog queue from Phase 2.

Tier 3, mobile shelf scan: owner photographs humidor shelves from the store dashboard on their phone, a vision model lists the bands it sees, owner confirms. Add barcode scanning for vitola UPCs on the same screen. This is the answer for the many shops with no POS integration and no website.

Crowdsourced layer, which cigars need and cannabis did not:
- "Spotted here" on the cigar page and store page: a user reports a cigar in stock at a store, optionally with a photo.
- "Still in stock?" thumbs on any inventory row.
- Confidence and decay. Each inventory row carries a source and a last-confirmed time. Hide rows not confirmed in 30 days. Show freshness everywhere: "updated 2 hours ago via Square" or "reported by 3 users this week".

Done when: 60% of listed stores in the launch metro show at least one in-stock item, and the median inventory freshness for claimed stores is under 48 hours.

## 6. Phase 4: Trust, legal, and production hardening (weeks 8 to 14)

These are not optional for a tobacco product with real users.

- Age gate. Federal law sets the tobacco purchase age at 21. Add a 21+ interstitial on first visit, a date of birth on signup, and block under-21 accounts.
- Auth basics. DONE: email verification, password reset, rate limiting on auth and the API, Helmet headers. Still open: request validation with a schema library.
- Move photos out of Postgres. Signed uploads to Cloudflare R2 or S3, store URLs, resize on upload. Migrate the existing base64 columns.
- Observability. Error tracking (Sentry), product analytics (PostHog), an uptime check, and a staging environment. Confirm Railway backups are on and test a restore once.
- Remove demo accounts and demo seeding from production. Keep the staff account.
- Tests and CI. A small integration suite for auth, search, claim flow, Sheets sync, and the matcher. Run on every push.
- Performance. Indexes on `inventory(store_id, cigar_id)`, `inventory(cigar_id, in_stock)`, and a geo index on stores (earthdistance or PostGIS) for bounding box queries.
- Transactional email. Move from a Gmail app password to Resend or Postmark on a real domain. The templates already say cigarbuddy.com, so secure that domain and move off the railway.app URL.

App store reality, which shapes UX:
- Apple's guidelines prohibit apps that facilitate the sale of tobacco. Weedmaps is allowed because of a specific exception for licensed cannabis dispensaries. That exception does not exist for cigars. Google Play has a similar restriction. Verify the current wording, but plan on this: the iOS and Android apps position as a cigar logbook, review, and lounge discovery app. No "buy", "order", "reserve", or checkout language in the native apps. The web app can show inventory and prices more freely. Design the inventory UI as "see it in the humidor at" rather than "buy it here" everywhere, so one codebase passes review.
- Deals and promotions are advertising for tobacco. Keep them factual, never youth-oriented, and get a lawyer's read on whether warning language is needed before you scale the deals feature.
- Do not build shipping or online ordering. The PACT Act and state laws make it a minefield, and it removes your structural advantage.

## 7. Phase 5: Consumer polish that drives weekly use (weeks 10 to 16)

The consumer app already has depth. What it needs is a reason to open it every week.

- Home screen is "near you". Open the app to the map plus in-stock-near-you results for cigars on your smoke list and follows. Make the in-stock alert on cigar follows fire from every ingestion path, and deliver it by push (Capacitor push plus web push) not just the bell.
- Where to find it. On every cigar page, list stores carrying it sorted by distance with price and freshness. The price comparison endpoint exists, so surface it.
- Lounge finder. Extend store filters with lockers, full bar, food, outdoor seating, BYOB, and cigar bar. Lounges are where the community already meets and are your best partners.
- Public event pages by city, shareable and indexable. Events and RSVPs exist, so this is mostly routing and SEO.
- SEO pages. Prerender or server-render routes like `/cigar-shops/{state}/{city}`, `/cigar-lounges/{city}`, `/cigars/{brand}/{line}`, and `/stores/{city}/{slug}`. "Cigar shop near me" and "where to buy X" searches are your cheapest acquisition channel and a single-page app gets none of it today.
- Onboarding in under a minute. Ask for location and three brands you like, then show stores and in-stock cigars immediately.
- Band scan to add to humidor, from Phase 2.
- Check-ins. The passport already tracks countries. Add store visits and lounge badges so users have a reason to open the app while sitting in a lounge.

Done when: weekly active users in the launch metro grow month over month and at least half of searches end on a cigar with a nearby in-stock result.

## 8. Phase 6: Monetization and go-to-market (months 4 to 6)

Free forever: listing, claiming, basic inventory, deals, events, broadcasts up to a limit.

Paid, per store per month, billed through Stripe:
- Featured placement in city and map results and a search boost. Dispensaries paid Weedmaps several hundred dollars a month. Cigar shops run thinner margins, so anchor around 49 to 199 dollars a month and test.
- Unlimited push broadcasts to followers, advanced analytics, event promotion, a partner badge.
- Concierge onboarding as a one-time fee, where you load their inventory for them.

The bigger line later is manufacturers and distributors. They spend on retail activation and would pay for "find the new release near you" campaigns targeted to followers of their brand. Accessories affiliate revenue (humidors, cutters, lighters) is safe for app stores because it is not tobacco.

Go-to-market playbook, one metro at a time:
- Pick the launch metro where you can show up in person. The Pacific Northwest scrapes and the Portland seed script suggest Portland. Target the 20 highest-review-count shops there first.
- Change the outreach pitch. The email sender currently pitches "sign up". Once Phase 1 ships, the pitch becomes "your shop is already listed and 40 people looked at it this month, claim it and fix your hours". That is the Yelp and Weedmaps claim psychology and it converts far better.
- Visit shops and load their first inventory yourself. Get one lounge to host a CigarBuddy herf.
- Community channels: r/cigars, Cigar Dojo, local Facebook herf groups, and the Premium Cigar Association trade show where retailers gather each summer (verify dates).
- Track the ladder. Listed, claimed, live menu, partner, per metro, every week. Expand to the next metro only when the first is at 60% live menu.

## 9. Decisions, now made

1. **Web-first.** The native apps are a logbook, review, and lounge-discovery product with no purchase language, so one codebase can pass app review. Done: the cigar page tab reads "Where to find it", not "Where to buy", and no screen offers to sell anything.
2. **Data licensing.** Overture Maps (CDLA-Permissive) is the base, OpenStreetMap fills the gaps. Both are credited in the site footer and on the map, as their licences require. Google stays an on-demand lookup and is never bulk-cached. Foursquare's open dataset is no longer published at its old address; revisit if it returns.
3. **Read shop websites for online menus.** Done: Shopify and WooCommerce product feeds, a link back to the shop on every row, an owner opt-out, and never copying their descriptions or images.
4. **The name is CigarBuddy.** Package names, window titles, and the start script all say CigarBuddy now. Still outstanding: buy cigarbuddy.com, check the trademark, and point the Railway domain at it.
5. **Sequencing.** Phases 1 through 3 are the product. Consumer polish waits until someone can open the map in their own city and see real shops with real cigars.

## 10. This week

1. DONE. `stores.user_id` is nullable, claim and source columns exist, and the national directory is imported as unclaimed listings on boot from `server/src/data/store_directory.json.gz` (42,831 places: 40,000 from Overture Maps plus 6,000 from OpenStreetMap, de-duplicated; 8,083 pass the cigar-shop classifier and show on the map, the rest sit in the admin Listings queue). Unclaimed badge, claim flow (instant email code when the email matches the shop's website domain, otherwise admin review), report-a-problem, clustered map with viewport loading, and admin Claims / Listings / Reports queues are live.
2. DONE. Age gate, Helmet, and rate limiting on the API and auth routes. Password reset and email verification are also built: `/auth/forgot`, `/auth/reset`, `/auth/send-verification`, `/auth/verify-email`, with the pages at `/forgot-password`, `/reset-password` and `/verify-email`, a "confirm your email" banner, and 5-per-15-minutes limits on both mail endpoints. Without SMTP configured the links are written to the server log so the flow works locally.
3. PARTLY. Search is now case- and accent-insensitive and matches every word ("padron 1964" works). `pg_trgm` fuzzy matching is still to do.
4. DONE. `server/src/database/catalog.js` seeds 169 real cigars / 690 vitolas across 55 brands on boot. The old "Brand 1" placeholders still exist in any database that was seeded before; delete them from the admin Cigars tab.
5. TODO. Write the Shopify and WooCommerce menu fetcher and run it against every listed store with a website.

Operational notes from the build:
- Refresh the directory (monthly is plenty): (1) pull Overture with DuckDB (`pip install duckdb`, then the query at the bottom of `server/src/jobs/buildDirectory.js`, about 2 minutes, writes `server/data/overture_raw.json`); (2) `cd server && npm run fetch:stores` (resumable, one Overpass request per state, about 35 minutes) then `npm run fetch:cities` (Nominatim, 1 request per second); (3) `npm run build:directory` to merge and de-duplicate into `src/data/store_directory.json.gz`; commit that file. The server imports it on the next boot and never touches claimed stores.
- Local development no longer needs Postgres: with no `DATABASE_URL` the server runs on embedded PGlite in `server/data/pglite`.
- Set `SMTP_USER` and `SMTP_PASS` on Railway to enable instant email-code claims; `ADMIN_EMAIL` receives manual claims.
- The Search page filters endpoint had been failing on Postgres (`SELECT DISTINCT` with an `ORDER BY CASE`); fixed.
