# Handoff: instructions for the next session

**The directory is live at https://cigar-buddy.com and it has a trust problem.**
A shop that closed six months ago was sitting on the public map with full
opening hours, and the owner — who lives next door to it — had to be the one to
notice. A sweep to find the rest was started and is only 28% done. **That sweep
is task 1 and nothing else matters until it is finished.** This file is your
work order. Read it, then start at "Your next task".

Written 2026-09-12, revised twice the same day: once by a cloud session that had
no credentials and built the jobs, and once by the session that ran them all.
The version before this one (`git show 00b2d75:HANDOFF.md`) described eight
tasks waiting to be run; they are done, and what running them changed is
recorded in `SWEEPS.md` under "The session of 2026-09-12 (evening)".

**Production, 2026-09-13: 672 public listings**, on `https://cigar-buddy.com`
(Cloudflare in front, Railway behind, `www` 301s to the apex). 670 with hours
read from the shop's own website, 349 with a thumbnail, 814 URLs in the sitemap,
and a favicon and share card that did not exist yesterday.

**Treat the 672 as unproven.** Of the first 190 researched, 57 (30%) should not
be there: 4 shut, 16 not cigar shops, 37 unprovable either way. See task 1.

---

## The one thing to understand before anything else

**Reading the output is the work.** Every job in `server/src/jobs/` is written,
tested and deployed, and each one still had something wrong with it that only
showed up when somebody read what it produced against real listings. Seven such
faults were found and fixed in one evening — including three jobs whose central
rule was not running at all:

- `linkCheck` had `pageIdentity`, `namesShop` and `looksHijacked` written and
  tested, and **never called them**. Every gambling takeover on the map read as
  a working link, and the self-test passed.
- `recoverHidden` proposed bringing back 320 outlet-chain listings, each
  "proved" by the chain's own website — the page that took it off the map.
- `thumbCheck` counted any two shops sharing the word "cigars" as one business,
  which made its shared-image check nearly inert.

So: **run a job, then read fifty of its rows by hand before applying anything.**
The dry run is not the check; your reading is. Every false positive found this
way is written into a self-test so it cannot come back.

Check what you have before you plan anything:

```bash
railway whoami                 # or: echo "$RAILWAY_TOKEN"
curl -sS -o /dev/null -w '%{http_code}\n' https://geocoding.geo.census.gov/
node sweeps/scripts/selftest_all.js          # expect 888 assertions, 0 failed
```

**Running a job against production.** `sweeps/scripts/prod.js` requires its
target, so a job's own `require.main` block never fires and its subcommands are
unreachable. Use `prodrun.js`, which starts the job as a real child process with
`DATABASE_URL` pointed at the public proxy:

```bash
railway run --service Postgres node sweeps/scripts/prodrun.js src/jobs/<job>.js <subcommand> [args]
# paths inside the job's arguments are relative to server/, so: --out ../sweeps/decisions/x.json
```

`prod.js` is still the right wrapper for a one-off script of your own:

```bash
railway run --service Postgres node sweeps/scripts/prod.js <absolute path to your script>
```

## Your next task

Task 1 is not like the others. Do it first and do not start anything else until
it is done: every day the directory is up, it is sending people to shops that
are not there.

> ### Run this WITHOUT production credentials. That is a decision, not a gap.
>
> Asked on 2026-09-13 whether the next session should be given a
> `RAILWAY_TOKEN`, Mason said **go without it**. So do not ask for one, do not
> wait on one, and do not treat its absence as something blocking you.
>
> **What that means in practice.** Everything that writes to production goes
> through `railway run --service Postgres node sweeps/scripts/prod.js <script>`,
> and that credential lives on his machine, not in this repository. So tasks 1,
> 2, 4, 5 and 6 are yours to *decide* and his to *apply*.
>
> **Your job is to finish everything up to the write.** For task 1: research all
> 482, run the verify pass, make the judgement calls on the unknowns, write the
> apply script, dry-run it against the decision file, and commit the result.
> Then hand him one command and a list he can read.
>
> This is deliberate and it is the point. He found the shop that started all of
> this by standing next to it, and roughly 90 to 150 listings are going to come
> off the map — too many to remove without him seeing them first. **Do not
> design around getting access later. Design to hand over a reviewed list.**

| Order | Task | Why it is next |
|-------|------|----------------|
| **1** | **[Finish proving the shops are open](#1-finish-proving-the-shops-are-open)** | **All 672 researched 2026-09-13. Verification and a deeper pass on the unknowns were running when this was written; the drop list still needs reading before anything is hidden** |
| 2 | ~~Add Paul&#39;s Cigars, Hazel Dell~~ | **Done 2026-09-13.** Added as #42931; both Vancouver shops are public |
| 3 | [Two environment variables](#3-two-environment-variables) | Mail still cannot leave the server, so no shop can claim a listing |
| 4 | ~~[The pins nobody could settle](#4-the-pins-nobody-could-settle--closed-leave-them)~~ | **Closed 2026-09-13.** All 41 stay: no second opinion beats the pin already held |
| 5 | ~~Licence renames and moves~~ | **Closed 2026-09-13.** All 19 addresses stay; the 13 renames are split and applied |
| 6 | [The two remaining manual registries](#6-the-two-remaining-manual-registries) | Pennsylvania and Washington; California and Florida fetch themselves now |
| 7 | ~~The Overture dedupe change~~ | **Done 2026-09-13.** The extract was there all along; the fix removes 2 duplicates |
| 8 | ~~Watch the menu scanner~~ | **Done 2026-09-13.** Healthy against the live table; it surfaced two duplicate listings |

---

## 1. Finish proving the shops are open

### What happened

`#10184 Cascade Cigar & Tobacco`, Happy Valley OR, was public with full opening
hours. It had been shut for six months. The owner lives next to it.

It passed every gate the directory had: a live website of its own, an address
something outside the directory agreed with, and hours read off that website.
**Those gates prove a website exists. They do not prove a shop does, and nobody
had noticed those are two different questions.** `cascadecigar.com` still
answers 200 with 85KB and still publishes "11am to 7pm - Everyday".

The obvious fix does not work either, and this is the part worth knowing before
you spend a day on it. Measuring how stale each site is fails: Cascade is on
Squarespace, whose `sitemap.xml` `lastmod` reads **15 days old**, with a cart,
an Instagram link and a Facebook link. It scores as *more alive* than shops that
are genuinely trading. `sweeps/scripts/probe_open_evidence.js` is kept because it
does catch dead hosts and truly frozen sites — Prestige Cigars at 987 days — but
it cannot answer the question and you should not try to make it.

**What answers it is research.** Directory sites put closure in the page title:
Yelp renders `CASCADE CIGAR & TOBACCO - CLOSED - Updated June 2026`. That is one
WebSearch away and no crawl of the shop's own site will ever contain it.

### The owner's rule, verbatim

> "PLEASE PLEASE only keep stores you are 100% sure are open, do research on the
> stores, do whatever you need to do to ensure they are open. this should not be
> innocent until proven guilty this should be guilty until proven innocent"

and, separately:

> "ensure that not only are they just open stores but they are open CIGAR stores
> or tobacconists"

So each listing must clear **two** bars: trading now, **and** in scope under the
rules in "Reference: the owner's rules" below. `unknown` does not survive.

On the `unknown` pile the owner was asked and said: **"i just want you to make
judgement calls on the unknowns."** So: research them harder first, then decide
each one yourself on the evidence and say why. Do not blanket-drop them, and do
not keep them just because nothing disproved them.

### Where it got to

A workflow of 68 research agents, each taking 10 shops, each batch then handed to
a second agent whose only job is to disprove "open". It was stopped at the
owner's request partway through. **190 of 672 judged, 482 left.** Verification
had not started when it stopped, so treat all 190 as research-only.

| | |
|---|---|
| `sweeps/decisions/open_research_partial.json` | the 190 already judged, with evidence and source URLs |
| `sweeps/decisions/open_research_todo.json` | the 482 still to do, ready to batch |
| `sweeps/decisions/research_input.json` | all 672, the input the agents read |
| `sweeps/decisions/open_candidates.json` | every public row with all its current fields |
| `sweeps/decisions/open_evidence.json` | the site-freshness probe, for triage only |

Of the 190: **142 open, 4 closed, 44 unknown, 16 out of scope.**

Closed: `#1949 Sabor Havana`, `#3979 Smokers Castle`, `#11405 Tobacco Leaf`,
`#18884 Signature Cigars`.

Out of scope, and note the shape of them — restaurants and bars with a cigar
room, smoke/vape/head shops, one manufacturer, one liquor store: `#403 Jallo`,
`#618 Cigar Bar Live`, `#815 My Tobacconist`, `#1676 Cigar Cartel Posner`,
`#1738 St Lucie`, `#1969 Warped Cigars`, `#3399 Brazil Smoke`, `#3965 WeHo`,
`#4208 Captain Tobacco`, `#5054 Frontier Tobacco`, `#6180 Hemingway's`,
`#6666 The 19th Hole`, `#8198 Continent`, `#8574 Cigar Bar & Grill`,
`#10272 Lucky Raven`, `#14995 Embers Vine`.

### How to run the rest

The workflow script is saved and can be re-run against the 482:

```
sweeps/workflows/prove-shops-open.js
```

Run it with the Workflow tool, passing:

```
{ total: 482, size: 10, file: "sweeps/decisions/open_research_todo.json" }
```

Its header block says what not to change and what to watch for. Batches of 10 worked well; 16 run concurrently; the whole 672
looked like 2-3 hours end to end. Give each agent the scope rules verbatim —
the ones already in the script produced the sixteen correct out-of-scope calls
above, so do not rewrite them.

### Then, and only then, apply it

**No apply script exists yet. Write it, dry-run it, and let the owner read the
list before anything is hidden.** He caught Cascade himself and will catch your
mistakes too; show him every shop you want to drop with its evidence and source
URL.

Hiding must survive the next deploy. `importStores.js` recomputes `visible`
from the classifier on every boot, and a regression once put 519 hidden listings
back on the map including a brewery. It honours only these:

```
storefront IN ('not_retail','online_only','closed','duplicate','moved','unproven','unverified')
   -- or --
staff_edited = 1
```

So use `storefront = 'closed'` for shut, `'not_retail'` for out of scope, and
`'unproven'` for the ones you judge unprovable — all three are honoured. Write
through `utils/storeEdits.js` `writeFields` so every hide is logged and
reversible, and put the evidence in `storefront_reason`.

---

## 2. Add Paul's Cigars, Hazel Dell

Reported missing by the owner. Paul's runs two shops in Vancouver WA; we had one.
Mill Plain (`#10234`) is public, Hazel Dell was not in the table under any name.

`sweeps/scripts/add_pauls_hazel_dell.js` is written, commented and **not yet
run**. Everything in it is first-hand from `paulscigars.net`'s own locations
page, and the pin is where Census and Nominatim agree (about 70m apart, a
multi-tenant strip, consistent with "Suite 114").

```
DRY=1 railway run --service Postgres node sweeps/scripts/prod.js <abs path>
      railway run --service Postgres node sweeps/scripts/prod.js <abs path>
```

Two other rows named "Paul's Cigars" exist — Beaverton OR and Hayden Island
Portland — on no page of the company's own site. They are already hidden. They
are probably former locations; task 1 will settle them.

---

## 3. Two environment variables

---

**The domain is done.** `cigar-buddy.com` is live, `APP_URL` is set on the
**`cigar_maps_claude`** service (not Postgres — see below), `www` 301s to the
apex, SSL is Full (strict), and a crawl of the live site reports 814 URLs with
no faults. Two variables are left.

| | What | Why it blocks everything behind it |
|---|---|---|
| 1 | **Set `RESEND_API_KEY`** (not SMTP) | Mail cannot leave over SMTP from here at all — see below. One key, and mail goes over HTTPS. Also set `MAIL_FROM` and `OUTREACH_POSTAL_ADDRESS`, which US commercial email is required to carry. Until this is set, **a shop that tries to claim its listing gets nothing** |
| 2 | **Add analytics and Search Console** | `GOOGLE_SITE_VERIFICATION` then submit `https://cigar-buddy.com/sitemap.xml`. `store_views` already records every shop page view; what is missing is search impressions and indexed-page counts |

**The Railway trap, which has now cost three wrong conclusions.** The project has
two services and the CLI's linked default for this directory is **Postgres**, not
the app. Any `railway` command without `--service` acts on the database, where
nothing reads your variable. The app is:

```
railway variable set KEY=VALUE --service 76dbe85c-e820-42e1-882c-aa23038a115c
railway status --json            # bare 'railway status' hangs on a prompt
```

Reading variables is blocked, so **verify from outside**: `/api/health/config`
reports `app_url`, whether mail can actually send, verification tokens and
analytics. That endpoint is the check, not the CLI.

The old Gmail password in this repository's history is burned — rotate it
whatever you decide.

### Mail: SMTP is not available here, and never will be

`SMTP_USER` and `SMTP_PASS` were set, `/api/health/config` reported email as
configured, and **not one message had ever left the server.** A boot check added
on 2026-09-12 is what found it:

    [email] SMTP is configured but not working:
    cannot reach the mail server (ETIMEDOUT). This is the network, not the password.

It began as `ENETUNREACH` on an IPv6 address — the container has an IPv6
interface with no route, and nodemailer picks the family by looking at the
interfaces. Pinning to IPv4 fixed that and produced `ETIMEDOUT` on port 465, and
then on 587. **Railway does not route outbound SMTP at all**, which is ordinary:
a platform that lets arbitrary code open port 25 becomes a spam relay within a
week. No SMTP provider will work here. Resend over SMTP will not work here.

So mail goes over HTTPS on 443, which is never blocked:

```
RESEND_API_KEY=re_...        # resend.com, 3,000 a month free
# or
POSTMARK_TOKEN=...
MAIL_FROM=CigarBuddy <hello@yourdomain.com>
```

`utils/mailHttp.js` posts to the provider's API — no SDK, since it is one POST —
and `utils/email.js` prefers it whenever a key is set, keeping the SMTP path for
anywhere that allows SMTP. The boot log then says `[email] ready via resend over
HTTPS`.

**What this means for everything upstream:** the claim flow's verification codes
have never arrived, so a shop that tried to claim a listing fell through to
staff review without knowing why. That is fixed by the same one key.

### What runs itself now

| Job | What it does | When |
|---|---|---|
| `utils/seo.js` | Per-page title, description, canonical, LocalBusiness JSON-LD, robots.txt, sitemap index | Every request; sitemap rebuilt hourly |
| `utils/places.js` + `/cigar-shops/:slug` | A page per state and per city with two or more shops, with an ItemList and a breadcrumb | Live, cached 10 minutes |
| `jobs/verifiedSet.js` | Recomputes the verified set both ways: a shop whose hours get read appears, one whose domain lapses goes | 10 minutes after boot, then daily |
| `jobs/outreach.js find` | Reads each shop's own site for the address it publishes | Already run |
| `jobs/contactRoutes.js` | The same, but decoding Cloudflare-protected addresses, HTML entities and "name (at) domain" — plus contact forms, Facebook and Instagram for shops that publish no address | Already run: **416 emails, 161 contact forms, 31 Facebook, 652 phones, 0 shops with no way in** |
| `jobs/linkCheck`, `webMenu`, `closureCheck` | Links, menus and closures | On boot, then on their own timers |

### The one command a day

```bash
node src/jobs/outreach.js draft --city tampa-fl      # queue a city, once
node src/jobs/outreach.js send  --limit 20           # every morning
node src/jobs/outreach.js followup                   # picks up anything 7 days old
node src/jobs/outreach.js report                     # sent, replied, claimed
```

`send` refuses to exceed 40 in any 24 hours and paces two seconds apart, because
a new domain sending six hundred at once is a new domain in a spam folder. Every
message carries a one-click unsubscribe (`/api/outreach/unsubscribe`, signed per
shop) and is never sent twice to the same listing.

**What is deliberately not automated: the reply.** A shop that answers gets a
person. That is the entire value of the channel.

### What to expect, and when

Indexing is slow: pages start appearing in two to six weeks, rankings build over
months. Nothing below will feel like it is working for a fortnight. The leading
indicator is *impressions* in Search Console, which moves well before clicks do.

## 4. The pins nobody could settle — CLOSED, leave them

**Decided 2026-09-13: all 41 stay where they are.** Nothing here needs doing;
this section is kept so the next session does not reopen it.

Of the 41 rows in `sweeps/decisions/pins/pins_left.json`, **16 were never
unsettled at all** — Nominatim, an independent second geocoder, answers with the
pin already held, so it was the Census that was wrong and the pin is right.

The other **25 have no reliable second opinion, and that is the finding.** In
every one the Census answered with a *different street or town*:

    22 SW 8th St, Miami        ->  22 SW 8TH AVE      (a different street)
    8608 Preston Rd, Plano     ->  8608 PRESTON MEADOW DR
    104 Hills Plz, Charleston  ->  104 HILL DR
    2015 Main St, Liberty Hill ->  2015 N MAIN ST, LIBERTY TX, 309 km away

or the address is a highway, where the handoff's own measurement puts the
geocoders wrong about 40% of the time — `895 GA-138`, `1146 PA-72`,
`6645 SE State Route O`, `3633 US Route 60`.

**Moving a pin on a single wrong-street match makes the data worse, not better.**
One geocoder answering confidently about a road it has confused for another is
not evidence, and there is no third source: cross-referencing all 25 against the
state licence registries — which now cover NY, TX, FL, CA and Chicago — returns
a current licence for exactly two, and one of those (#42345 ZODI'X) is a
duplicate being hidden anyway.

So the existing pins stand. They come from the record's own source, which had
the address in front of it, and nothing available beats that.

## 5. Licence renames and moves — CLOSED, nothing moves

**Decided 2026-09-13. No address in the directory changes on this evidence.**

The "moved (132)" figure in the previous handoff was measured against a 4,363-listing
directory that no longer exists; most of those rows are already hidden. Re-matched
against today's 673 public listings with the registries now covering NY, TX, FL, CA and
Chicago, it is **19 moved and 13 renamed**. All 32 were read.

### Moved: all 19 stay

A "moved" verdict turns out not to be evidence that our address is wrong.

**Four are the same address spelled differently** — the same class of thing the previous
session had already pulled three of:

    1895 NW 21st St        vs  1895 NW 21 Street
    1130 Townpark Ave      vs  1130 Town Park Avenue
    24174 Hwy 27 Ste 500   vs  24174 Hwy 27 #500
    36 S Atlantic Ave      vs  34/36/38 S Atlantic Avenue   (a multi-unit building)

**One is settled by the shop's own words.** El Titan de Bronze is listed by us at 1071
SW 8th St and licensed at 1067; the research quotes their own site saying 1071. Ours is
right and the licence is the unit next door.

**One looked like a real move and is not.** Boiler Room Smoking Lounge is licensed at
11500 Rock Rose Ave while we list 311 W 7th St. Their own site reads "311 W 7th Street,
Basement of the York Rite Building, Austin, TX 78701" and lists no second location. The
licence is somebody else.

**The rest are chains and namesakes** — Finck Cigars runs three San Antonio shops, Corona
several in Florida — where the licence found is a different branch of the same business.
In nearly all of them the open/closed research independently confirms the shop is
trading at the address we hold.

### Renamed: 13, split and applied

`sweeps/scripts/apply_licence_renames.js` (now takes `FILE=` so it can be pointed at a
fresher match without overwriting the record of the 2026-09-12 reading):

  - 3 the same name formalised — nothing to do
  - 3 a licence holder rather than a name over the door — not an alias anybody searches
  - 5 another name in the trade — written to `name_aliases` so search finds the shop
    either way
  - 2 another trade at the door, for staff: Jallo Cigar Lounge is licensed to
    "Friendship Wine & Liquor", Burn One Cigars to "Cigar & Wine Bar"

**One thing worth keeping from this.** The script flags "another trade" by keyword, and
3 Islas Cigar Lounge, whose door is licensed to "Toke Shack LLC", slipped through it —
the pattern has no term for cannabis. It did not matter, because the research had
already settled it independently: its Yelp page was updated this month and describes a
walk-in humidor, so it is open and in scope, and "Toke Shack LLC" is simply the company
holding the licence. Read that as a reminder that the keyword list is a prompt for a
human, not a verdict.

**A lapse is never a hide.** A self-test asserts there is no verdict in that job that
hides a listing. Keep it that way.

## 6. The two remaining manual registries

**California and Florida are no longer manual.** Both publish the whole file as
plain CSV with no key and no form — the pages that made them look manual are
JavaScript, so the link is simply not in the HTML. `licenceSync fetch` now
downloads and parses them like any other registry:

    https://data-cdtfa.opendata.arcgis.com/datasets/CDTFA::california-cigarette-and-tobacco-licensees.csv
    https://www2.myfloridalicense.com/sto/file_download/extracts/bd4012lic.csv
    https://www2.myfloridalicense.com/sto/file_download/extracts/bdTOBlic.csv

That took listings verified by a current licence from 126 to **177**, and put a
current state tobacco licence behind 22 listings the open/closed research could
not settle.

**One caveat to carry.** Every match is on house number, ZIP and street — the
address, not the name — so a licence says a licensed tobacco retailer trades at
that door, not that this particular shop does. It is supporting evidence, not
proof. #6180 Hemingway's is the case that shows why: the registry says the
address is licensed, and research found a different business trading there now.

California withholds the licensee name under taxpayer confidentiality, so its
rows are address-only and the `renamed` verdict cannot work there at all.
Florida publishes both the owner and the DBA, so it can.

**Still manual: Pennsylvania and Washington.** `licenceSync fetch` prints the
URL for each; save the file into `sweeps/decisions/licences/` as `pa.csv` or
`wa.csv` and re-run `match`. Washington genuinely has no dataset — the Business
Lookup is a search form, and the list needs a public-records request.

The four that work are NYC (6,699 licences), New York State (22,091), Texas
(59,603) and Chicago (59,414). **Their dataset ids move**: all four broke
between the day they were written and the day they were first run. If one
answers 400 or 404, find the new id rather than dropping the registry —
`sweeps/scripts/socrata_find.js` searches a Socrata domain by keyword, and
`socrata_peek.js` prints one row so the column names can be read.

## 7. The Overture dedupe change — DONE, and smaller than it looked

**The blocker was not real.** `server/data/overture_raw.json` is present on the
owner's machine (27 MB, 45,129 rows), so the change was made and measured
against the real extract rather than an OSM-only rebuild.

`buildDirectory` had a `!t.osm_id` guard that stopped an Overture row once it
had absorbed one OSM record, so a second OSM record for the same shop fell
through to `osmOnly` and became a second listing for a shop already in the file.
OpenStreetMap holds more than one record for one shop routinely — a node and a
way for the same building, or two contributors who each mapped the same door.
The guard is gone, and extra ids are recorded in `also_osm_ids`.

**Measured, and the honest number is two.**

    before   42,863 stores, 3,105 merged, 2,941 OSM-only
    after    42,861 stores, 3,107 merged, 2,939 OSM-only

Two duplicates, one of them Bellevue Tobacco — the very shop the comment beside
that code warns about. The plan item was right; its importance was overestimated.

### Two things deliberately not done

**The importer half is not implemented.** The plan asked for the importer to hide
any older row an `also_osm_id` names. Both absorbed ids were checked against
production and neither names a row that exists, so it would act on nothing — and
that file is the one that once put 519 hidden listings back on the map including
a brewery. Zero benefit against that risk is not a trade worth making, and the
build change already stops the duplicate at source. If `also_osm_ids` ever names
a real row, this becomes worth doing; it does not today.

**The rebuilt `store_directory.json.gz` is not committed.** A fresh build comes
out 60 records different from the committed one for reasons unrelated to this
change — an older classifier or older inputs produced the committed file.
Shipping that delta while a 672-listing sweep was mid-flight would have made the
two impossible to tell apart. **Rebuild it, diff it and review it on its own**,
then commit; the code change is already in, so any future build carries the fix.

## 8. Watch the menu scanner

Still true, and still worth a look: its back-off and staleness ordering are
deployed and a 30-day replay proves every shop gets reached, but it has only
ever run against a model. Watch the first real 24 hours.

---

## Reference: what the session of 2026-09-13 changed

Shipped and deployed, all verified against the live site:

| | |
|---|---|
| **The domain** | `cigar-buddy.com` live. Cloudflare in front, Railway behind. `www` 301s to the apex keeping the path. SSL Full (strict) |
| **`APP_URL`** | Was never set, so every verification email, password reset, unsubscribe and outreach link pointed at a dead Railway subdomain. Now `https://cigar-buddy.com` |
| **The map** | OpenStreetMap had blocked us — correctly; their tile policy asks that anything past light use go elsewhere, and a pannable map over 672 shops is not light use. Now CARTO's dark basemap, which also removes the white slab from the middle of a dark page |
| **A favicon** | There was none. The old PWA icons carry the words CIGAR BUDDY across the middle, which at 16px is four grey smudges, so the mark is the cigar alone |
| **A share card** | `og:image` was `null` on the homepage, `/stores` and `/cigar-shops`, so a texted link arrived as a grey rectangle. `client/public/og.png`, with dimensions attached. Regenerate with `sweeps/scripts/make_brand_assets.js` |
| **Thumbnails** | `StoreThumb` decided how to draw a picture by testing whether the URL contained the word "logo". 67 logos were being drawn as photographs on a near-black backdrop — a see-through logo in dark ink on a near-black square is an invisible logo, and six measured a standard deviation of 0.022. Now drawn from `image_kind`/`image_luma`, measured from the file |
| **User-Agents** | Three crawler jobs announced `cigarbuddy.com` — no hyphen, a domain nobody owns — and `thumbCheck` sent it as a `Referer` to third-party image hosts. All follow `APP_URL` now |

Two faults found by reading output rather than trusting a pass, which is the
lesson this file opens with:

- `readClosureText` returns `{ closed: false }` — an object, always truthy — so
  a plain truthiness check reported **37 of 37 sites as closed**.
- The site check reported "robots.txt does not name the sitemap" against a site
  whose robots.txt names the sitemap. It was reading Cloudflare's four-hour
  cache of a copy made before the domain was wired up. Cloudflare **merges**
  the origin's robots.txt; it does not replace it. The check now asks the
  origin when the cached answer fails, and says which of the two it is.

---

## Reference: the owner's rules, which outrank anything else

1. **Pure cigar and pipe-tobacco shops only.** Cigarettes on the side are fine; a
   vape, glass, hookah or kava shop that happens to sell cigars is not in this
   directory. "Mary Jane's House of Glass" is the type to exclude.
2. **When in doubt, off the map.** If we cannot show a listing is a cigar shop,
   open, at the address we hold, it stays hidden rather than making the site look
   like a junk directory. Hidden is never deleted: every hide records its reason
   and is reversible.
3. **Guilty until proven innocent** — his words, 2026-09-13, after finding a shop
   on the map that had been shut for six months and that he lives next door to:
   *"only keep stores you are 100% sure are open, do research on the stores, do
   whatever you need to do to ensure they are open. this should not be innocent
   until proven guilty this should be guilty until proven innocent."* Nothing
   disproving a closure is not evidence it is open. This outranks rule 2, which
   was written as a tie-breaker and was being read as a licence to keep anything
   nobody had actively disproved.
4. **Claimed and staff-edited listings are never touched by a sweep.**
5. **Ask Mason** before publishing anything we cannot show is a cigar shop, or
   before spending money.

On rule 5 and judgement calls: Mason has said he would rather a session **make
the call and document it** than stop and ask, for anything that is not spending
money or publishing unproven listings. Two calls were made on that basis on
2026-09-12 (paid placement, and the no-location order) — both are written up in
`SWEEPS.md` with the reasoning and the constants to change. **Still his, not
yours:** a Google Places budget, and whether any outlet chain comes back.

## Reference: what this project is, and where it stands

CigarBuddy is a cigar-shop finder: an Express + Postgres API in `server/`, a
React/Vite client in `client/`, deployed on Railway (**a push to `master`
deploys**). Its directory came from Overture Maps and OpenStreetMap, so it
arrived full of listings that are not cigar shops, shops that have closed or
moved, wrong pins, wrong hours and dead links.

Production today:

- **4,363 public listings**, from 7,431 at the start. About 38,560 further rows
  are hidden, each with a verdict and a reason.
- 930 hold hours; 783 of those were read from the shop's own website. The rest
  show map hours labelled "not confirmed", or nothing.
- 806 have a thumbnail, after 159 were taken down as too small, banner-shaped,
  blank, dead or somebody else's. 1,854 carry a Lounge badge and 367 a walk-in
  humidor: 675 rest on a sentence from the shop's own site and the rest on the
  shop's own name, after 332 resting on a map category alone were cleared.
- 230 are stamped by a current tobacco licence at the door.
- Verdicts the importer honours, so a data refresh cannot undo them:
  `not_retail`, `online_only`, `closed`, `duplicate`, `moved`, `unproven`, and
  any `operating_status = 'permanently_closed'`.

**Live in production and done — do not redo:** field provenance and an edit log,
time zones from real boundaries, map-only hours shown as unconfirmed, stock
counts excluding hidden shops, search text folding, duplicate merging, the
non-shop purge, the pure-cigar check, outlet chains, and moved shops.
`SWEEPS.md` has the numbers for each.

**Run against production on 2026-09-12 (evening):** all eight tasks of the
previous handoff — hours, links, thumbnails, pins, amenities, licences,
recovery and duplicates. `SWEEPS.md` has the numbers and the seven rules that
reading the output corrected.

**Live for customers right now, because it is pure code.** Each of these is a
sweep from `sweeps/plan.json` whose sources are code only; each was measured
against a database built from the committed directory (42,928 listings, 7,904
public), never against the synthetic fixture:

- **Search returns every shop in range.** `GET /stores` used to take 300 rows in
  placement order and only then cut to the radius, so a dense metro silently
  lost shops a few blocks away. Recall went 89.96% → 100.00% over 1,984 cases.
- **The map draws every pin.** `GET /stores/map` groups in the database. The map
  asked the list for 1,000 rows and clustered those in the browser, so the
  national view drew 1,000 of 7,904, every bubble's count came from that
  thousand — a bubble marked 84 could open onto nine shops — and the header said
  "1000+ stores in view". Fifteen viewports now account for every listing in the
  box, exactly (`sweeps/scripts/map_viewports.js`).
- **Search matches the way people type.** Accents fold by Unicode decomposition,
  St/Saint and Mt/Mount fold as whole words, trademark badges and emoji drop,
  and other alphabets are left intact so a shop named in Arabic stays searchable
  by its own letters. `sweeps/scripts/fold_parity.js` runs the SQL half and the
  JavaScript half against each other in the engine over 42 cases.
- **The duplicate matcher.** Measured against the 13 pairs the audit named and
  the 4 it warns must never merge: 122 clusters proposing 125 drops, against 116
  and 119 before. It also fixes a false positive the plan names — the "two
  shared words" shortcut counted two *generic* words, so "Cigar City Brewing"
  matched "Cigar City Cigars".
- **Corrections survive the import.** `node src/jobs/reimportTest.js` seeds every
  kind of correction, forces a re-import and checks all 16 are still there.
- **Staff can see and undo things.** `/admin/listings` covered `source = 'osm'`
  only: a page of 500 rows showed 9 listings and hid 491 Overture ones, so most
  of the directory could not be reviewed at all. A claim can be taken back. The
  claim card carries the evidence a decision rests on. Phone and website have a
  staff editor.
- **`destinationKind` called all 23,972 stored websites ordinary sites** — it
  ran `new URL()` on a column that stores bare hosts. With the scheme supplied:
  2,011 platform links, 878 social, 4 parked. Those 2,893 listings have
  something other than the shop's own site in the website field and no verdict
  would ever have flagged them, because the links work. They are in the staff
  queue under `kind=link`.
- **The Request button did nothing** — it set React state that nothing rendered.
- **The no-location list and paid placement** — see `SWEEPS.md`.

## Reference: reaching production, and working locally

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

## Reference: what is in the repository

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
  `build_fixture_db.js`, the snapshot dumps, and four added in the revision:
  - **`selftest_all.js`** — runs every self-test and prints one total. **Use
    this.** 850 assertions across 23 suites, 0 failed, as of this file.
  - **`fold_parity.js`** — the SQL and JavaScript halves of the search fold,
    against each other, in the database engine. A difference between them is a
    search that matches nothing rather than one that errors, so no
    JavaScript-only test can catch it.
  - **`map_viewports.js`** — for 15 viewports, the pins plus every bubble's
    count must equal the listings in the box. It also checks the SQL grouping
    against the JavaScript one used for "open now".
  - `server/src/utils/storeMap.js` is the map endpoint's logic, alongside
    `storeList.js`, so both can be replayed without HTTP.
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
and `recallMonitor` to `contract`. Run them before and after you touch anything:

```bash
node sweeps/scripts/selftest_all.js          # 850 assertions, 23 suites
node src/jobs/reimportTest.js                # from server/: 16 checks
```

`selftest_all.js` reads each file before launching it and skips any that does
not declare a `selftest` handler. That is not fussiness — see the trap about it
in section 5.

---

## Reference: traps, so you do not hit them again

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
- **A helper that is never called passes every test.** `linkCheck` had three
  identity checks, twenty assertions covering them, and no call site. Test the
  wiring, not only the rule: `judgePage` exists as one pure function so that
  the path from a downloaded page to a verdict is itself asserted.
- **Heredocs eat backslashes, and the damage is invisible.** A quoted bash
  heredoc turned `\b` into a real backspace byte (0x08) inside two regexes on
  2026-09-12, which silently disabled both: the file parses, the tests pass,
  and the rule never matches anything. Use the editor tools for anything
  containing a backslash, then `node --check` AND scan for control bytes:
  `grep -rlnP "\x08" server/src client/src sweeps/scripts`.
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
- **Never run a file to find out whether it is a test.** The first version of
  `sweeps/scripts/selftest_all.js` did `node <file> selftest` over everything in
  `jobs/` and `utils/`. Most jobs ignore an argument they do not recognise and
  get on with their work, so that run did not test `buildDirectory.js` — it
  *ran* it, and `buildDirectory` rebuilds
  `server/src/data/store_directory.json.gz` in place. With no network reachable
  it wrote what it could, and the 3.7 MB national directory of 42,928 listings
  became a 310 KB stub. It was restored with `git checkout` and verified against
  HEAD's checksum, but only because it is committed. The script now reads each
  file's source and launches nothing that does not declare the handler. If you
  add a runner of any kind, make it do the same.
- **PGlite allows one connection.** Opening a scratch database with `node -e`
  while the server holds the same `PGLITE_DIR` aborts the second process with
  `Aborted()`. Stop the server, or check through the API.
- **`new URL()` throws on a bare host,** and the `stores.website` column stores
  bare hosts. Three functions had a `try/catch` that quietly returned a
  plausible default for all 23,972 of them. If you parse a URL from that
  column, add the scheme first.
- **The synthetic fixture is too small to catch ceiling bugs.** `CANDIDATE_CEILING`
  was set to 5,000 against a 3,636-row fixture and broke the nationwide list at
  7,904 public rows. Measure against a database built from the committed
  directory (`node src/index.js` does it with no credentials) and say which of
  the two any number came from.

## Reference: what to ask Mason

### One command for him to run

The five `sweep/*` branches are merged and the work is on `master`. They cannot
be deleted from a cloud session — the git proxy refuses any ref push that is not
a branch create or update, so a delete comes back HTTP 403, and the GitHub tools
available here have no delete-branch call. From a normal machine:

```bash
git push origin --delete sweep/claims sweep/hours sweep/links sweep/pins \
  sweep/search-and-menus __reftest
```

`__reftest` is litter from diagnosing that limitation. **Before running it:**
`sweep/search-and-menus` is the only one of the five whose code is *not* in
`master` — it was superseded rather than adopted, so that deletion is the one
that actually loses a version. `PROGRESS.md` has the table of what came from
which branch. Nothing in the repository depends on any of them.

### The rest

- **A Google Places API key and budget**, for the closures and hours no free
  source settles. Everything so far was done without paid data. This is the only
  item on this list that is genuinely blocked on him.
- **Whether any outlet chain should come back:** Wild Bill's (198 listings),
  Sweet Fire (61), Cheap Tobacco (32), The Tobacco Shoppe (21). Each is one
  command. Rule 4 makes this his call, not a session's.
- **Whether the paid-placement prices and reach match what he wants to sell** —
  $49 for 15 miles, $149 for 50. The mechanism is built and documented; the
  numbers are commercial.
- **Not questions any more:** paid placement's shape and the no-location order,
  decided on 2026-09-12 at his request. Plus, decided in the revision because he
  asked for judgement rather than questions, each written up in `SWEEPS.md` with
  what to change to reverse it:
  - Requests on unclaimed listings are **collected**, and the dialog says they
    cannot reach the shop yet, rather than the tile being hidden.
  - A website nobody has checked stays a **live link**; only an address somebody
    has just changed is withheld, under a new `checking` verdict. Rendering
    unchecked as unclickable would have emptied the website line on 5,214 of the
    5,214 public listings that have one.
  - Which owner edits go live instantly: hours, phone and website, each with its
    checks re-run; an address change re-geocodes and recomputes the time zone.
  - The dead domain is **no longer named** in the unclaimed banner, since the
    page has already withheld the link.

## Reference: keep the log

After each task: update `SWEEPS.md` with what changed in production and the
numbers, and commit. If you stop part-way, say in `SWEEPS.md` exactly where you
are, as this file does. **The next session should never have to reconstruct it** —
and should never have to guess whether a number describes production, a local
copy, or a fixture. Say which.
\x08' server/src client/src sweeps/scripts`.
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
- **Never run a file to find out whether it is a test.** The first version of
  `sweeps/scripts/selftest_all.js` did `node <file> selftest` over everything in
  `jobs/` and `utils/`. Most jobs ignore an argument they do not recognise and
  get on with their work, so that run did not test `buildDirectory.js` — it
  *ran* it, and `buildDirectory` rebuilds
  `server/src/data/store_directory.json.gz` in place. With no network reachable
  it wrote what it could, and the 3.7 MB national directory of 42,928 listings
  became a 310 KB stub. It was restored with `git checkout` and verified against
  HEAD's checksum, but only because it is committed. The script now reads each
  file's source and launches nothing that does not declare the handler. If you
  add a runner of any kind, make it do the same.
- **PGlite allows one connection.** Opening a scratch database with `node -e`
  while the server holds the same `PGLITE_DIR` aborts the second process with
  `Aborted()`. Stop the server, or check through the API.
- **`new URL()` throws on a bare host,** and the `stores.website` column stores
  bare hosts. Three functions had a `try/catch` that quietly returned a
  plausible default for all 23,972 of them. If you parse a URL from that
  column, add the scheme first.
- **The synthetic fixture is too small to catch ceiling bugs.** `CANDIDATE_CEILING`
  was set to 5,000 against a 3,636-row fixture and broke the nationwide list at
  7,904 public rows. Measure against a database built from the committed
  directory (`node src/index.js` does it with no credentials) and say which of
  the two any number came from.
