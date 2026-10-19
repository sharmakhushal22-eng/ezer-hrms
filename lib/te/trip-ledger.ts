// lib/te/trip-ledger.ts — which lines of a trip a reader may see, and what they
// add up to.
//
// Pure, and in lib/ rather than beside the component, for the same reason
// trip-stay.ts and journey-review.ts are: JSX cannot be loaded by the test
// runner, and these are the two things here that would fail silently and
// matter. One is the privacy filter — a traveller must not be shown what a
// colleague was reimbursed, which is a bug somebody already fixed once on the
// trip screen and which a merged "everything on this trip" view is the obvious
// way to reintroduce. The other is the grouping: a hotel landing under "Other"
// is wrong in a way that looks fine.
//
// The component (components/te/trip/TeTripLedger.tsx) renders what these
// return and decides nothing of its own.
import type { TeCategory, TeExpense, TeLeg } from './types'

/** The order a reader thinks about a trip in: how they got there, where they
 *  slept, what they ate, what they spent getting about, then the rest. */
const GROUPS = ['Travel', 'Stay', 'Food', 'Local travel', 'Other'] as const
type Group = (typeof GROUPS)[number]

/** Category code → group. Mirrors te_categories.grp as seeded in 149; passed in
 *  from the snapshot where available so a company that has added its own
 *  category is not forced into 'Other' by a copy made here. */
const FALLBACK_GROUP: Record<string, Group> = {
  air: 'Travel', train: 'Travel', bus: 'Travel',
  hotel: 'Stay',
  meals: 'Food',
  cab: 'Local travel', local: 'Local travel', mileage: 'Local travel', toll: 'Local travel',
  client: 'Other', comm: 'Other', misc: 'Other',
}

const isGroup = (v: string): v is Group => (GROUPS as readonly string[]).includes(v)

export interface LedgerRow {
  line: TeExpense
  group: Group
  /** The journey this line reports, when it is one. */
  leg: TeLeg | null
  /** true = that journey was added during the trip: a GPS sub-trip. */
  subTrip: boolean
  /** Who spent it, named. '' when the reader may not be told. */
  who: string
  mine: boolean
  /** The category in the company's own words. */
  catName: string
}

/**
 * The lines this reader may see, grouped.
 *
 * Exported and pure so the grouping can be tested without a browser: the thing
 * most likely to go quietly wrong here is a category landing in the wrong
 * group, or somebody's private line leaking into another traveller's view.
 */
export function ledgerRows(o: {
  expenses: TeExpense[]
  legs: TeLeg[]
  me: string
  /** Desk, Finance or an approver: may see every traveller's lines. */
  everyone: boolean
  /** employee id → name, for naming a line's owner. */
  nameOf: (id: string) => string
  /** te_categories as the snapshot has them: the company's own names and
   *  groups, so a category somebody added is not forced into 'Other' by the
   *  fallback copy above. */
  cats?: TeCategory[]
}): LedgerRow[] {
  const catBy = new Map((o.cats ?? []).map(c => [c.id, c]))
  const legById = new Map(o.legs.map(l => [l.id, l]))
  return o.expenses
    // DISCARDED is already filtered by te_trip_detail; this is belt and braces
    // for a line that was voided after the page loaded.
    .filter(x => x.status !== 'DISCARDED')
    .filter(x => {
      if (o.everyone) return true
      if (x.emp === o.me) return true
      // What the company paid for directly is not a colleague's reimbursement:
      // it is the cost of this trip, and the traveller on it may see it.
      return x.pay === 'company'
    })
    .map(x => {
      const cat = catBy.get(x.cat)
      const raw = cat?.group || FALLBACK_GROUP[x.cat] || 'Other'
      const leg = x.legId ? legById.get(x.legId) ?? null : null
      return {
        line: x,
        group: isGroup(raw) ? raw : 'Other',
        leg,
        // A journey with no planned segment behind it was added mid-trip.
        subTrip: !!leg && leg.kind === 'extra',
        who: x.emp === o.me ? 'You' : (o.everyone ? o.nameOf(x.emp) : ''),
        mine: x.emp === o.me,
        catName: cat?.name || x.cat,
      }
    })
}

/** What each group adds up to, and the whole trip. `claimed` is what was asked
 *  for; `company` is what the company had already paid directly. */
export function ledgerTotals(rows: LedgerRow[]): {
  byGroup: { group: Group; self: number; company: number; n: number }[]
  self: number
  company: number
  total: number
} {
  const by = new Map<Group, { self: number; company: number; n: number }>()
  for (const r of rows) {
    const g = by.get(r.group) ?? { self: 0, company: 0, n: 0 }
    const amount = Number(r.line.claimed || r.line.bill || 0)
    if (r.line.pay === 'company') g.company += amount
    else g.self += amount
    g.n += 1
    by.set(r.group, g)
  }
  const byGroup = GROUPS.filter(g => by.has(g)).map(g => ({ group: g, ...by.get(g)! }))
  const self = byGroup.reduce((a, g) => a + g.self, 0)
  const company = byGroup.reduce((a, g) => a + g.company, 0)
  return { byGroup, self, company, total: self + company }
}
