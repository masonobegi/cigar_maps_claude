export const meta = {
  name: 'prove-shops-open',
  description: 'Research every public cigar shop listing: is it still open, and is it really a cigar shop',
  phases: [
    { title: 'Research', detail: 'WebSearch each shop for closure markers and what kind of shop it is' },
    { title: 'Verify', detail: 'Adversarially try to disprove every "open" verdict' },
  ],
}

/*
 * Research every public listing: is the shop open, and is it a cigar shop.
 *
 * Run it with the Workflow tool. It takes three things:
 *
 *   { total: <how many rows in the file>, size: 10, file: "<repo-relative path>" }
 *
 * To finish the run that was stopped on 2026-09-13 at 190 of 672:
 *
 *   { total: 482, size: 10, file: "sweeps/decisions/open_research_todo.json" }
 *
 * To redo everything from scratch:
 *
 *   { total: 672, size: 10, file: "sweeps/decisions/research_input.json" }
 *
 * The agents read their own slice of the file with node, so the file has to be
 * in the repository and the path relative to its root.
 *
 * WHAT NOT TO CHANGE. The scope wording below produced sixteen correct
 * out-of-scope calls in the first 190 — restaurants with a cigar room, smoke and
 * vape shops, a manufacturer, a liquor store. It is the owner's rule, quoted.
 * Rewriting it will cost you that accuracy.
 *
 * WHAT TO WATCH. About 23% came back 'unknown' on the first pass, which means
 * one agent with one to three searches found no proof — not that no proof
 * exists. The owner's instruction on those is "make judgement calls on the
 * unknowns": research them harder in a second pass, then decide each one and say
 * why. Do not blanket-drop them and do not keep them by default.
 *
 * The verify stage never ran before the stop, so the 190 already in
 * open_research_partial.json are research-only and still need it.
 *
 * Results land in the run's journal.jsonl, one 'result' entry per agent. Read
 * that rather than the return value: 672 records do not survive being passed
 * back through a tool result.
 */

const TOTAL = args.total
const SIZE = args.size
const FILE = args.file

const batches = []
for (let i = 0; i < TOTAL; i += SIZE) batches.push([i, Math.min(i + SIZE, TOTAL)])

const SCOPE = `
WHAT COUNTS AS IN SCOPE (the site owner's rule, applied strictly):
  - A cigar shop, cigar lounge, or tobacconist whose PRIMARY trade is cigars and/or pipe tobacco.
  - Selling cigarettes on the side is fine. Cigarettes being the main business is NOT.
  - NOT in scope, however many cigars they happen to stock:
      vape shops, smoke shops, head shops, glass/bong shops, CBD/hemp/dispensary,
      hookah lounges, convenience stores, gas stations, liquor stores, general
      tobacco outlets whose trade is cigarettes, cigar MAKERS/brands with no
      retail storefront, and online-only sellers.
  - The canonical rejection the owner gave: "Mary Jane's House of Glass" is a weed
    glass shop that happens to sell cigars. That is a 'no'.
`

const RESEARCH_SCHEMA = {
  type: 'object',
  properties: {
    shops: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'the listing id exactly as given' },
          name: { type: 'string' },
          status: { type: 'string', enum: ['open', 'closed', 'unknown'] },
          isCigarShop: { type: 'string', enum: ['yes', 'no', 'unknown'] },
          shopKind: { type: 'string', description: 'what this place actually is, in a few words' },
          evidence: { type: 'string', description: 'the specific quote or fact that decided it, and where it came from' },
          sources: { type: 'array', items: { type: 'string' }, description: 'URLs consulted' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        required: ['id', 'status', 'isCigarShop', 'shopKind', 'evidence', 'confidence'],
      },
    },
  },
  required: ['shops'],
}

const VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    shops: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'number' },
          refuted: { type: 'boolean', description: 'true if you found reason to doubt it is open AND in scope' },
          why: { type: 'string' },
          sources: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'refuted', 'why'],
      },
    },
  },
  required: ['shops'],
}

function researchPrompt([start, end]) {
  return `You are auditing a public cigar-shop directory. A shop that closed six months ago was
sitting on it with full opening hours, because its abandoned website still publishes them. The
owner's instruction is explicit: **guilty until proven innocent.** A listing is kept ONLY if you
find positive evidence it is trading NOW (September 2026). "Nothing says it closed" is NOT evidence.

Read your batch of listings with:
  node -e "const r=require('./${FILE}'); console.log(JSON.stringify(r.slice(${start},${end}),null,2))"

For EACH listing, establish two separate things.

1) IS IT OPEN RIGHT NOW?
   Use WebSearch. The highest-value trick: directory sites put closure in the PAGE TITLE.
   Yelp renders "BUSINESS NAME - CLOSED - Updated June 2026". Google/Facebook/Foursquare
   say "Permanently closed". Search the name with the city, and read the result TITLES
   carefully before anything else.
   Good queries:
     "<name>" "<city>" <state>
     "<name>" <city> permanently closed
     "<name>" <city> cigar reviews
   Signals it IS open: reviews dated within the last ~8 months, current hours on a
   third-party listing, recent social posts, local news, an events calendar with
   future dates. Signals it is CLOSED: a "CLOSED"/"Permanently closed" marker anywhere,
   news of closing, a lease/retail listing for the address, reviews that stop abruptly
   a year or more ago, or the address now showing a different business.
   WebFetch a Yelp/Google/Facebook listing when the search snippet is not decisive.

2) IS IT ACTUALLY A CIGAR SHOP?
${SCOPE}

RULES
  - status 'open' requires evidence you can quote. If you cannot find such evidence, the
    answer is 'unknown', NOT 'open'. Being unsure is normal and useful; guessing is not.
  - isCigarShop 'yes' likewise needs evidence of what it sells.
  - Put the deciding quote in 'evidence', with where it came from. Be concrete:
    "Yelp title reads 'X - CLOSED - Updated June 2026'" beats "seems closed".
  - Return one object per listing, ${end - start} in total, ids exactly as given.
  - Budget roughly 1-3 searches per shop. Do not over-research an obvious case.`
}

function verifyPrompt(opens) {
  const list = opens.map(s => `  id ${s.id}: ${s.name} — claimed open because: ${s.evidence}`).join('\n')
  return `Another researcher concluded these cigar-shop listings are OPEN and in scope. Your job is
to REFUTE that. The directory owner would rather drop a good shop than keep a dead one, so the
burden of proof is on "open", and doubt is a reason to refute.

${list}

For each, search independently (do not just re-read their source). Look hard for:
  - a "CLOSED" or "Permanently closed" marker on Yelp, Google, Facebook, Foursquare, TripAdvisor
  - the most recent review date — if the newest review is over a year old, that is a reason to doubt
  - the address now hosting a different business
  - news, Reddit or forum posts about it closing
  - whether it is actually a vape/smoke/head/hookah shop rather than a cigar shop
${SCOPE}

Set refuted=true if you find ANY credible reason to doubt it is an open cigar shop.
Set refuted=false ONLY if you positively confirmed it is trading now and in scope — say in 'why'
what confirmed it and when that evidence is dated.
Return one object per id given, ${opens.length} in total.`
}

log(`researching ${TOTAL} listings in ${batches.length} batches of ${SIZE}`)

const results = await pipeline(
  batches,
  (b) => agent(researchPrompt(b), {
    label: `research:${b[0]}-${b[1]}`,
    phase: 'Research',
    schema: RESEARCH_SCHEMA,
  }),
  (res, b) => {
    const shops = (res && res.shops) || []
    const opens = shops.filter(s => s.status === 'open' && s.isCigarShop === 'yes')
    if (!opens.length) return { range: b, shops, verified: [] }
    return agent(verifyPrompt(opens), {
      label: `verify:${b[0]}-${b[1]}`,
      phase: 'Verify',
      schema: VERIFY_SCHEMA,
    }).then(v => ({ range: b, shops, verified: (v && v.shops) || [] }))
  },
)

const all = []
for (const r of results.filter(Boolean)) {
  const refuted = new Map(((r.verified) || []).map(v => [v.id, v]))
  for (const s of r.shops || []) {
    const v = refuted.get(s.id)
    all.push({
      ...s,
      verified: v ? !v.refuted : null,
      verifyWhy: v ? v.why : null,
      verifySources: v ? v.sources : null,
    })
  }
}

const keep = all.filter(s => s.status === 'open' && s.isCigarShop === 'yes' && s.verified === true)
log(`researched ${all.length}; survive both passes: ${keep.length}`)

return {
  researched: all.length,
  keep: keep.length,
  closed: all.filter(s => s.status === 'closed').length,
  notCigarShop: all.filter(s => s.isCigarShop === 'no').length,
  unknown: all.filter(s => s.status === 'unknown').length,
  refutedAfterClaimingOpen: all.filter(s => s.verified === false).length,
  shops: all,
}
