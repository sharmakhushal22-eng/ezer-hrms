// lib/te/trip-ledger.ts — everything one trip cost, who may see which part of
// it, and what is still owed.
//
// Pure, and in lib/ rather than beside the component, for the same reason
// trip-stay.ts and journey-review.ts are: JSX cannot be loaded by the test
// runner, and the things here that would fail silently all matter.
//
//   * the privacy filter — a traveller must not be shown what a colleague was
//     reimbursed, a bug somebody already fixed once on the trip screen and
//     which a merged "everything on this trip" view is the obvious way to
//     reintroduce;
//   * the grouping — a hotel landing under "Other" is wrong in a way that
//     looks fine;
//   * and now the double count, below, which is wrong by the price of a
//     flight.
//
// WHAT CHANGED, AND WHY THE TOTAL WAS WRONG BEFORE. This used to read expense
// lines only and call the sum "Total on TRP-2026-0007". But a trip's money
// arrives three ways: bills the traveller files, tickets and hotels the Travel
// Desk books and the company pays for directly, and an advance paid out before
// anybody travelled. Only the first was counted. A ₹40,000 flight the desk
// bought was absent from the one figure that claimed to be what the trip cost.
//
// THE DOUBLE COUNT IS THE DANGEROUS PART. Some desk bookings also have a mirror
// te_expenses row (paid_by = 'company', booking_id set); some — anything still
// REQUESTED — have none. Adding bookings naively would count the mirrored ones
// twice. That is what `bookingId` on the expense line is for, exposed by
// migration 185 precisely so this file can tell the two apart. Before 185 the
// only route to that id was a fabricated `file.sha` of 'bk-<uuid>', which is
// not a key anybody should join on.
//
// REQUESTED IS NOT SPENT. A hotel the traveller has asked for and nobody has
// booked yet has an amount, because the table demands one, but no money has
// left. It is carried as `pending` and kept out of what the trip has cost, so
// the total never claims money was spent that wasn't.
//
// The component (components/te/trip/TeTripLedger.tsx) renders what these
// return and decides nothing of its own.
import type { TeBooking, TeCategory, TeExpense, TeLeg } from './types'

/** The order a reader thinks about a trip in: where they went, how they got
 *  there, where they slept, what they ate, what they spent getting about, then
 *  the rest.
 *
 *  JOURNEYS COME FIRST AND HAVE THEIR OWN GROUP. They are the spine of a trip —
 *  the thing a sub-trip IS — and before this they were not rows at all: the
 *  bucket listed money, so a journey with no bill against it was invisible.
 *  Measured on SRS-TRP-2026-0008: four journeys, two of them sub-trips, one
 *  bill between them, so the bucket showed a single row and three journeys
 *  appeared nowhere. */
export const GROUPS = ['Journeys', 'Travel', 'Stay', 'Food', 'Local travel', 'Other'] as const
export type Group = (typeof GROUPS)[number]

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

/** What every row in the bucket has, however it got there.
 *
 *  THE MONEY IS SPLIT ON THE ROW, not inferred from a single `pay` flag. A
 *  journey can carry more than one bill and they need not agree about who
 *  paid — one cab reimbursed, one paid on a company card. A single flag made
 *  that unrepresentable, and the totals would have put the whole journey on
 *  whichever side the first line happened to be. */
interface RowBase {
  group: Group
  /** What somebody is owed for this row. */
  self: number
  /** What the company has already paid for it directly. */
  company: number
  /** Asked for, not bought yet — deliberately outside what the trip has cost. */
  pendingAmt: number
  /** self + company + pendingAmt, for rendering one figure on the row. */
  amount: number
  /** True when nothing has actually been spent yet. */
  pending: boolean
  /** Who spent it, named. '' when the reader may not be told. */
  who: string
  mine: boolean
  /** The journey this row belongs to, when it belongs to one. */
  leg: TeLeg | null
  /** true = that journey was added during the trip: a GPS sub-trip. */
  subTrip: boolean
}

/** A bill somebody filed. */
export interface ExpenseRow extends RowBase {
  kind: 'expense'
  line: TeExpense
  /** The category in the company's own words. */
  catName: string
}

/** A ticket or hotel the Travel Desk bought, with no bill of its own. */
export interface BookingRow extends RowBase {
  kind: 'booking'
  booking: TeBooking
  /** 'Flight', 'Hotel' — what to call it where a category name would go. */
  catName: string
}

/** A journey of the trip — planned, recorded or skipped — with whatever bills
 *  are attached to it folded in, so the same money is never counted twice. */
export interface JourneyRow extends RowBase {
  kind: 'journey'
  leg: TeLeg
  /** The bills against this journey that this reader may see. */
  lines: TeExpense[]
  /** 'Journey 2', and 'Sub-trip 2' when it was added during the trip. */
  catName: string
}

/** A stay the desk has decided on that has not become a bill or a booking yet.
 *  Without this the hotel somebody is actually sleeping in appears nowhere in
 *  the trip's own record until the bill arrives days later. */
export interface StayRow extends RowBase {
  kind: 'stay'
  name: string
  catName: string
}

export type LedgerRow = ExpenseRow | BookingRow | JourneyRow | StayRow

/**
 * Everything on this trip that this reader may see, in one list.
 *
 * Exported and pure so the grouping, the privacy filter and the de-duplication
 * can be tested without a browser.
 */
export function ledgerRows(o: {
  expenses: TeExpense[]
  legs: TeLeg[]
  /** te_bookings for this trip, as te_trip_detail returns them. Omitted, the
   *  bucket behaves as it did before 185 and counts bills only. */
  bookings?: TeBooking[]
  me: string
  /** Desk, Finance or an approver: may see every traveller's lines. */
  everyone: boolean
  /** employee id → name, for naming a line's owner. */
  nameOf: (id: string) => string
  /** te_categories as the snapshot has them: the company's own names and
   *  groups, so a category somebody added is not forced into 'Other' by the
   *  fallback copy above. */
  cats?: TeCategory[]
  /** Whose trip it is. A desk booking is the company's spending on this
   *  traveller's behalf, so it is named after them rather than left blank. */
  tripOwner?: string
  /** trip.stay — what the Travel Desk answered about the hotel. Shown as a row
   *  only while it has become neither a bill nor a booking. */
  stay?: { status?: string; name?: string } | null
}): LedgerRow[] {
  const catBy = new Map((o.cats ?? []).map(c => [c.id, c]))
  const legById = new Map(o.legs.map(l => [l.id, l]))

  const expenseRows: LedgerRow[] = o.expenses
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
    .map((x): ExpenseRow => {
      const cat = catBy.get(x.cat)
      const raw = cat?.group || FALLBACK_GROUP[x.cat] || 'Other'
      const leg = x.legId ? legById.get(x.legId) ?? null : null
      const amount = Number(x.claimed || x.bill || 0)
      return {
        kind: 'expense',
        line: x,
        group: isGroup(raw) ? raw : 'Other',
        amount,
        self: x.pay === 'company' ? 0 : amount,
        company: x.pay === 'company' ? amount : 0,
        pendingAmt: 0,
        pending: false,
        leg,
        // A journey with no planned segment behind it was added mid-trip.
        subTrip: !!leg && leg.kind === 'extra',
        who: x.emp === o.me ? 'You' : (o.everyone ? o.nameOf(x.emp) : ''),
        mine: x.emp === o.me,
        catName: cat?.name || x.cat,
      }
    })

  // ── bookings with no bill of their own ────────────────────────────────────
  // THE DE-DUPLICATION. A booking the desk made may already have a mirror
  // expense row; that row is in the list above and carries the same money.
  // Only bookings nothing else accounts for are added.
  const billed = new Set(
    o.expenses.map(x => x.bookingId).filter((id): id is string => !!id),
  )
  const owner = o.tripOwner
  const bookingRows: LedgerRow[] = (o.bookings ?? [])
    // Nothing was bought and nothing will be: a cancelled booking is not a cost.
    .filter(b => b.status !== 'CANCELLED')
    .filter(b => !billed.has(b.id))
    .filter(b => {
      // Same rule as a bill: what the company paid for directly is this trip's
      // cost and anyone on the trip may see it. A booking somebody paid for
      // themselves is their own money and is private to them.
      if (o.everyone) return true
      if ((b.paidBy ?? 'company') === 'company') return true
      return !!owner && owner === o.me
    })
    .map((b): BookingRow => {
      const leg = b.legId ? legById.get(b.legId) ?? null : null
      return {
        kind: 'booking',
        booking: b,
        group: b.kind === 'hotel' ? 'Stay' : 'Travel',
        amount: Number(b.amount || 0),
        ...(b.status === 'REQUESTED'
          // Asked for, nobody has bought it: an amount, but not money spent.
          ? { self: 0, company: 0, pendingAmt: Number(b.amount || 0) }
          : (b.paidBy ?? 'company') === 'self'
            ? { self: Number(b.amount || 0), company: 0, pendingAmt: 0 }
            : { self: 0, company: Number(b.amount || 0), pendingAmt: 0 }),
        pending: b.status === 'REQUESTED',
        leg,
        subTrip: !!leg && leg.kind === 'extra',
        who: owner ? (owner === o.me ? 'You' : (o.everyone ? o.nameOf(owner) : '')) : '',
        mine: !!owner && owner === o.me,
        catName: b.kind === 'hotel' ? 'Hotel' : 'Ticket',
      }
    })

  // ── every journey of the trip, with its bills folded in ───────────────────
  // THE SPINE OF THE TRIP. A journey IS the thing a sub-trip is, and the bucket
  // used to list money only — so a journey nobody had billed yet appeared
  // nowhere, which on a real trip meant three of four were missing.
  //
  // The bills attached to a journey fold INTO its row rather than standing
  // beside it, so the same money is never counted twice and the row reads as
  // one fact: this journey happened, and this is what it cost.
  const perLeg = new Map<string, ExpenseRow[]>()
  for (const r of expenseRows as ExpenseRow[]) {
    if (r.kind !== 'expense' || !r.leg) continue
    const list = perLeg.get(r.leg.id) ?? []
    list.push(r)
    perLeg.set(r.leg.id, list)
  }
  const journeyRows: LedgerRow[] = o.legs
    // A cancelled journey is not part of the trip's record of itself.
    .filter(l => l.status !== 'CANCELLED')
    .slice()
    .sort((a, b) => a.n - b.n)
    .map((l): JourneyRow => {
      const lines = perLeg.get(l.id) ?? []
      const self = lines.reduce((a, r) => a + r.self, 0)
      const company = lines.reduce((a, r) => a + r.company, 0)
      const sub = l.kind === 'extra'
      return {
        kind: 'journey',
        leg: l,
        lines: lines.map(r => r.line),
        group: 'Journeys',
        self, company, pendingAmt: 0,
        amount: self + company,
        // Nothing spent on it YET is not the same as nothing to spend: a
        // journey with no bill is shown, and adds nothing to the total.
        pending: false,
        subTrip: sub,
        who: owner ? (owner === o.me ? 'You' : (o.everyone ? o.nameOf(owner) : '')) : '',
        mine: !!owner && owner === o.me,
        catName: sub ? `Sub-trip ${l.n}` : `Journey ${l.n}`,
      }
    })
  // A journey's bills now live on the journey's row.
  const looseExpenseRows = (expenseRows as ExpenseRow[]).filter(r => !r.leg)

  // ── the stay the desk decided on, before any money moves ──────────────────
  // CHOSEN but not yet billed or booked is the normal state for days: somebody
  // is sleeping in that hotel and the trip's own record did not mention it.
  const stayRows: LedgerRow[] = (() => {
    if (!o.stay || !o.stay.name) return []
    if (o.stay.status !== 'CHOSEN' && o.stay.status !== 'BOOKED') return []
    // If a hotel bill or a hotel booking already exists, that IS the stay.
    const already = [...(expenseRows as ExpenseRow[])].some(r => r.group === 'Stay')
      || (o.bookings ?? []).some(b => b.kind === 'hotel' && b.status !== 'CANCELLED')
    if (already) return []
    return [{
      kind: 'stay',
      name: o.stay.name,
      group: 'Stay',
      self: 0, company: 0, pendingAmt: 0, amount: 0,
      pending: true,
      leg: null,
      subTrip: false,
      who: owner ? (owner === o.me ? 'You' : (o.everyone ? o.nameOf(owner) : '')) : '',
      mine: !!owner && owner === o.me,
      catName: 'Stay',
    }]
  })()

  return [...journeyRows, ...looseExpenseRows, ...bookingRows, ...stayRows]
}

export interface LedgerTotals {
  byGroup: { group: Group; self: number; company: number; pending: number; n: number }[]
  /** What travellers are owed, before any advance. */
  self: number
  /** What the company has already paid directly. */
  company: number
  /** Asked for and not bought yet — deliberately outside `total`. */
  pending: number
  /** What this trip has cost so far: self + company. Excludes `pending`. */
  total: number
  /** The advance approved against this trip, and what is still outstanding. */
  advance: number
  outstanding: number
  /** What the reader's own claim comes to. The advance is one employee's, so
   *  only this can honestly be netted against it. */
  mine: number
  /** mine − outstanding, when the advance is the reader's own; otherwise null.
   *  Positive: the company owes them. Negative: they return the difference. */
  net: number | null
}

/**
 * What each group adds up to, and the trip as a whole.
 *
 * THE NETTING IS DELIBERATELY NARROW. An advance belongs to one employee — the
 * database allows a single live one per trip — so netting it against `self`,
 * which on a desk's screen is the sum across every traveller, would produce a
 * number that means nothing. `net` is only returned when the advance is the
 * reader's own, and is computed from their own lines.
 */
export function ledgerTotals(rows: LedgerRow[], o: {
  advance?: { approved: number | null; outstanding: number } | null
  /** true when the advance on this trip is the reader's own. */
  advanceMine?: boolean
} = {}): LedgerTotals {
  const by = new Map<Group, { self: number; company: number; pending: number; n: number }>()
  for (const r of rows) {
    const g = by.get(r.group) ?? { self: 0, company: 0, pending: 0, n: 0 }
    // Straight off the row. Each one already knows how its money divides,
    // which a journey carrying two bills that disagree about who paid needs.
    g.self += r.self
    g.company += r.company
    g.pending += r.pendingAmt
    g.n += 1
    by.set(r.group, g)
  }
  const byGroup = GROUPS.filter(g => by.has(g)).map(g => ({ group: g, ...by.get(g)! }))
  const self = byGroup.reduce((a, g) => a + g.self, 0)
  const company = byGroup.reduce((a, g) => a + g.company, 0)
  const pending = byGroup.reduce((a, g) => a + g.pending, 0)
  const mine = rows.filter(r => r.mine).reduce((a, r) => a + r.self, 0)

  const advance = Number(o.advance?.approved ?? 0)
  const outstanding = Number(o.advance?.outstanding ?? 0)
  return {
    byGroup, self, company, pending,
    total: self + company,
    advance, outstanding, mine,
    net: o.advanceMine && o.advance ? mine - outstanding : null,
  }
}
