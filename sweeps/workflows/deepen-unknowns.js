export const meta = {
  name: 'deepen-unknowns',
  description: 'Second, harder pass over the listings the first research could not settle',
  phases: [
    { title: 'Deepen', detail: 'Open the actual listing pages rather than reading search snippets' },
  ],
}

/*
 * The listings the first pass returned 'unknown' for, researched properly.
 *
 * WHY THIS EXISTS. About a quarter of the directory came back 'unknown' from
 * the first pass. That does not mean no evidence exists — it means one agent
 * with one to three searches did not find it. Dropping a quarter of the
 * directory on a first-pass miss would be over-correcting, and the listings it
 * would hit hardest are exactly the small independent shops with a thin web
 * presence, which are the ones worth having.
 *
 * The owner's instruction on these, verbatim: "i just want you to make
 * judgement calls on the unknowns." So this pass exists to make those calls
 * possible — to get real evidence in front of a decision, rather than to
 * rubber-stamp either answer.
 *
 * WHAT MAKES IT DEEPER. The first pass reads search result titles and snippets,
 * which is fast and catches the loud cases (Yelp writes CLOSED into its title).
 * This one opens the pages. The single best liveness signal for a small shop is
 * the date of its most recent review, and that is never in a snippet.
 *
 *   { total: <n>, size: 8, file: "sweeps/decisions/open_unknowns.json" }
 */

const TOTAL = args.total
const SIZE = args.size
const FILE = args.file

const batches = []
for (let i = 0; i < TOTAL; i += SIZE) batches.push([i, Math.min(i + SIZE, TOTAL)])

const SCOPE = `
IN SCOPE: a cigar shop, cigar lounge or tobacconist whose PRIMARY trade is
cigars and/or pipe tobacco. Cigarettes on the side are fine; cigarettes as the
main business are not.
NOT IN SCOPE, however many cigars they stock: vape shops, smoke shops, head or
glass shops, CBD/hemp/dispensaries, hookah lounges, convenience stores, gas
stations, liquor stores, general tobacco outlets trading mainly in cigarettes,
cigar makers or brands with no retail storefront, and online-only sellers.
Restaurants and bars that happen to have a cigar room are NOT in scope; the
first pass correctly rejected several on exactly this ground.
`

const SCHEMA = {
  type: 'object',
  properties: {
    shops: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'number' },
          name: { type: 'string' },
          status: { type: 'string', enum: ['open', 'closed', 'unknown'] },
          isCigarShop: { type: 'string', enum: ['yes', 'no', 'unknown'] },
          shopKind: { type: 'string' },
          newestSignalDate: {
            type: 'string',
            description: 'The date of the most recent dated evidence found, as YYYY-MM or YYYY-MM-DD. Empty string if none.',
          },
          newestSignalWhat: {
            type: 'string',
            description: 'What that dated thing was — "a Google review", "an Instagram post", "an events page listing"',
          },
          evidence: { type: 'string', description: 'The deciding fact, quoted, and where it came from' },
          sources: { type: 'array', items: { type: 'string' } },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        required: ['id', 'status', 'isCigarShop', 'newestSignalDate', 'evidence', 'confidence'],
      },
    },
  },
  required: ['shops'],
}

function prompt([start, end]) {
  return `These cigar-shop listings could not be settled by a quick search. Settle them properly.

Read your batch with:
  node -e "const r=require('./${FILE}'); console.log(JSON.stringify(r.slice(${start},${end}),null,2))"

Today is September 2026. For each listing, find the MOST RECENT DATED EVIDENCE that
the business is trading, and say what it was and when.

DO NOT stop at search snippets — that is what the first pass already did and it is
why these are unresolved. Open the pages:

  1. WebFetch its Yelp page. Read the date of the newest review, and whether the page
     carries a CLOSED banner. Yelp shows "Updated <month year>" and dates each review.
  2. WebFetch its Google Maps / Google Business listing, or search
     "<name> <city> google reviews". Newest review date again.
  3. WebFetch its Facebook page. When was the last post? A page posting this year is
     a trading business.
  4. WebFetch its own website and look for anything DATED — an events calendar, a
     "new arrivals" post, a cigar-dinner announcement, a copyright year.
  5. Try the phone number as a search term. A number appearing on current third-party
     listings is a working number.

HOW TO DECIDE
  open     — dated evidence within roughly the last 8 months. A review from
             June 2026, an Instagram post from August 2026, an event listed for
             October 2026. Say which, and give the date.
  closed   — an explicit closure marker, OR the address now hosting a different
             business, OR the newest evidence of any kind is more than about two
             years old. State which of those it is.
  unknown  — genuinely nothing datable after actually opening the pages. This is
             a legitimate answer and you should use it rather than guess; a human
             will make the call on these and needs to know you looked properly.

ALSO CONFIRM WHAT KIND OF SHOP IT IS:
${SCOPE}

RULES
  - newestSignalDate is the whole point of this pass. Fill it in whenever you find
    anything dated, even if it does not change the verdict.
  - Quote the deciding fact in 'evidence'. "Newest Google review 12 July 2026,
    five stars, mentions the walk-in humidor" is useful. "Appears open" is not.
  - Return one object per listing, ${end - start} in total, ids exactly as given.
  - Spend real effort here — 4 to 8 fetches per shop is expected. These are the
    hard ones; the easy ones were already decided.`
}

log(`deepening ${TOTAL} unsettled listings in ${batches.length} batches of ${SIZE}`)

const results = await parallel(batches.map(b => () =>
  agent(prompt(b), { label: `deepen:${b[0]}-${b[1]}`, phase: 'Deepen', schema: SCHEMA })))

const shops = []
for (const r of results.filter(Boolean)) for (const s of (r.shops || [])) shops.push(s)

const c = { open: 0, closed: 0, unknown: 0 }
for (const s of shops) c[s.status] = (c[s.status] || 0) + 1
log(`deepened ${shops.length}: ${c.open} open, ${c.closed} closed, ${c.unknown} still unsettled`)

return { deepened: shops.length, ...c, shops }
