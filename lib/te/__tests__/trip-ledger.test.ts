// Everything one trip cost, in one place — and who is allowed to see it.
//
// Two things here would fail silently and matter. One is the privacy filter: a
// traveller must not be shown what a colleague was reimbursed, which is a bug
// somebody already fixed once on this screen and which a merged view is the
// obvious way to reintroduce. The other is the grouping — a hotel landing under
// "Other" is wrong in a way that looks fine.
import { describe, it, test } from 'node:test'
import assert from 'node:assert/strict'
import { type LedgerRow, ledgerRows, ledgerTotals } from '../trip-ledger.ts'
import type { TeBooking, TeCategory, TeExpense, TeLeg } from '../types.ts'

const ME = 'me-1', MATE = 'mate-2'

/** What a row is, whichever kind it is — so a whole list can be asserted in
 *  one line without narrowing at every call site. */
const idOf = (r: LedgerRow) =>
  r.kind === 'expense' ? r.line.id
    : r.kind === 'booking' ? `bk-${r.booking.id}`
      : r.kind === 'journey' ? `jn-${r.leg.n}`
        : `stay-${r.name}`

/** A saved expense line. Only the fields the ledger reads are set; TeExpense
 *  has thirty-odd and filling them all in would bury what each test is about.
 *  Cast once, here, rather than at every call site. */
const BASE = {
  id: 'x1', no: 'SRS-EXP-00001', emp: ME, tripId: 't1', legId: null,
  cat: 'misc', date: '2026-10-20', merchant: '', billNo: '', bill: 0, claimed: 0,
  pay: 'self', payMode: 'UPI', status: 'UNCLAIMED', file: null,
}
const line = (over: Partial<TeExpense>): TeExpense =>
  ({ ...BASE, ...over } as TeExpense)

const leg = (over: Partial<TeLeg>): TeLeg =>
  ({ id: 'l1', n: 1, kind: 'main', status: 'SUBMITTED', ...over } as TeLeg)

const CATS: TeCategory[] = [
  { id: 'hotel', name: 'Hotel stay', icon: null, needsTrip: true, proof: 'always', group: 'Stay', on: true },
  { id: 'meals', name: 'Meals', icon: null, needsTrip: true, proof: 'above', group: 'Food', on: true },
  { id: 'air', name: 'Air travel', icon: null, needsTrip: true, proof: 'always', group: 'Travel', on: true },
  { id: 'cab', name: 'Cab or taxi', icon: null, needsTrip: false, proof: 'above', group: 'Local travel', on: true },
]

const rowsFor = (expenses: TeExpense[], o: { everyone?: boolean; legs?: TeLeg[]; cats?: TeCategory[] } = {}) =>
  ledgerRows({
    expenses, legs: o.legs ?? [], me: ME, everyone: o.everyone ?? false,
    nameOf: id => (id === MATE ? 'Asha Rao' : 'Someone'), cats: o.cats ?? CATS,
  })

// ── who sees whose money ────────────────────────────────────────────────────

test('a traveller sees their own lines', () => {
  const r = rowsFor([line({ id: 'a', emp: ME, cat: 'meals', claimed: 300 })])
  assert.equal(r.length, 1)
  assert.equal(r[0].who, 'You')
  assert.equal(r[0].mine, true)
})

test('a traveller is NOT shown what a colleague claimed', () => {
  // The bug this guards: a merged "everything on the trip" view is the obvious
  // way to put a colleague's reimbursement back on somebody else's screen.
  const r = rowsFor([
    line({ id: 'a', emp: ME, cat: 'meals', claimed: 300 }),
    line({ id: 'b', emp: MATE, cat: 'meals', claimed: 900, pay: 'self' }),
  ])
  assert.deepEqual(r.map(idOf), ['a'], 'the colleague’s own claim is gone')
})

test('but a traveller does see what the company paid for directly', () => {
  // A ticket the desk bought is the cost of the trip, not anybody's private
  // reimbursement, and hiding it would leave the traveller unable to see half
  // of what their own trip cost.
  const r = rowsFor([
    line({ id: 'a', emp: ME, cat: 'meals', claimed: 300 }),
    line({ id: 'b', emp: MATE, cat: 'air', bill: 6480, pay: 'company' }),
  ])
  assert.deepEqual(r.map(idOf), ['a', 'b'])
  // And it is not attributed to the colleague by name, because the reader was
  // not told whose line it is — only that the company paid.
  assert.equal(r[1].who, '')
})

test('a desk or Finance sees every line, with the owner named', () => {
  const r = rowsFor([
    line({ id: 'a', emp: ME, cat: 'meals', claimed: 300 }),
    line({ id: 'b', emp: MATE, cat: 'hotel', claimed: 4200 }),
  ], { everyone: true })
  assert.equal(r.length, 2)
  assert.equal(r[1].who, 'Asha Rao')
})

test('a voided line never appears, whoever is looking', () => {
  const r = rowsFor([line({ id: 'a', status: 'DISCARDED', claimed: 500 })], { everyone: true })
  assert.deepEqual(r, [])
})

// ── what goes where ─────────────────────────────────────────────────────────

test('stay, food, travel and local travel each land in their own group', () => {
  const r = rowsFor([
    line({ id: 'h', cat: 'hotel', claimed: 4200 }),
    line({ id: 'm', cat: 'meals', claimed: 800 }),
    line({ id: 'f', cat: 'air', bill: 6480, pay: 'company' }),
    line({ id: 'c', cat: 'cab', claimed: 980 }),
  ])
  assert.deepEqual(
    Object.fromEntries(r.map(x => [idOf(x), x.group])),
    { h: 'Stay', m: 'Food', f: 'Travel', c: 'Local travel' },
  )
})

test('an unknown category falls to Other rather than vanishing', () => {
  // Dropping it would make the total disagree with the lines, which is worse
  // than filing it under Other.
  const r = rowsFor([line({ id: 'z', cat: 'something-new', claimed: 100 })], { cats: [] })
  assert.equal(r.length, 1)
  assert.equal(r[0].group, 'Other')
})

test('the company’s own category names and groups win over the built-in copy', () => {
  const mine: TeCategory[] = [
    { id: 'hotel', name: 'Accommodation', icon: null, needsTrip: true, proof: 'always', group: 'Stay', on: true },
  ]
  const r = rowsFor([line({ id: 'h', cat: 'hotel', claimed: 1 })], { cats: mine })
  assert.equal(r[0].catName, 'Accommodation')
})

test('a category with no group set falls back rather than becoming blank', () => {
  const noGroup: TeCategory[] = [
    { id: 'hotel', name: 'Hotel stay', icon: null, needsTrip: true, proof: 'always', group: null, on: true },
  ]
  assert.equal(rowsFor([line({ id: 'h', cat: 'hotel' })], { cats: noGroup })[0].group, 'Stay')
})

// ── sub-trips are named as such ─────────────────────────────────────────────

test('a line reporting a journey added mid-trip is marked a sub-trip', () => {
  const r = rowsFor(
    [line({ id: 'a', cat: 'local', legId: 'l9', claimed: 320 })],
    { legs: [leg({ id: 'l9', n: 2, kind: 'extra' })] },
  )
  assert.equal(r[0].subTrip, true)
  assert.equal(r[0].leg?.n, 2)
})

test('a line reporting a planned journey is not', () => {
  const r = rowsFor(
    [line({ id: 'a', cat: 'cab', legId: 'l1', claimed: 980 })],
    { legs: [leg({ id: 'l1', n: 1, kind: 'main' })] },
  )
  assert.equal(r[0].subTrip, false)
})

test('a hotel bill belongs to no journey and claims none', () => {
  const r = rowsFor([line({ id: 'h', cat: 'hotel', legId: null, claimed: 4200 })])
  assert.equal(r[0].leg, null)
  assert.equal(r[0].subTrip, false)
})

// ── the totals ──────────────────────────────────────────────────────────────

test('what is owed and what the company already paid are kept apart', () => {
  // One total hiding both is the number nobody can act on: Finance needs to
  // know what to pay, not what the trip cost in total.
  const t = ledgerTotals(rowsFor([
    line({ id: 'h', cat: 'hotel', claimed: 4200 }),
    line({ id: 'm', cat: 'meals', claimed: 800 }),
    line({ id: 'f', cat: 'air', bill: 6480, pay: 'company' }),
  ]))
  assert.equal(t.self, 5000)
  assert.equal(t.company, 6480)
  assert.equal(t.total, 11480)
})

test('groups come back in reading order, and empty ones are left out', () => {
  const t = ledgerTotals(rowsFor([
    line({ id: 'm', cat: 'meals', claimed: 800 }),
    line({ id: 'f', cat: 'air', bill: 100, pay: 'company' }),
  ]))
  // Travel before Food, however the lines arrived; no Stay row at all.
  assert.deepEqual(t.byGroup.map(g => g.group), ['Travel', 'Food'])
})

test('a line with a bill but nothing claimed still counts at its bill amount', () => {
  // A desk-booked ticket has claimed = 0 and bill = the fare. Reading only
  // `claimed` would report the company as having spent nothing.
  const t = ledgerTotals(rowsFor([line({ id: 'f', cat: 'air', bill: 6480, claimed: 0, pay: 'company' })]))
  assert.equal(t.company, 6480)
})

test('an empty trip totals zero rather than throwing', () => {
  const t = ledgerTotals([])
  assert.deepEqual([t.self, t.company, t.total, t.byGroup.length], [0, 0, 0, 0])
})

// ── bookings the desk made ──────────────────────────────────────────────────
// Until 185 these were absent from the bucket entirely, so "Total on TRP-x"
// could omit the single largest thing the trip cost.

const booking = (over: Partial<TeBooking>): TeBooking =>
  ({ id: 'b1', no: 'SRS-BKG-0001', kind: 'travel', vendor: 'IndiGo', legId: null,
     pointIdx: null, pnr: 'X1Y2Z3', amount: 0, paidBy: 'company',
     status: 'BOOKED', at: '2026-10-18T09:00:00Z', ...over } as TeBooking)

const withBookings = (
  expenses: TeExpense[], bookings: TeBooking[],
  o: { everyone?: boolean; owner?: string } = {},
) => ledgerRows({
  expenses, legs: [], bookings, me: ME, everyone: o.everyone ?? false,
  nameOf: id => (id === MATE ? 'Asha Rao' : 'Someone'), cats: CATS,
  tripOwner: o.owner ?? ME,
})

test('a ticket the desk booked is in the bucket even with no bill for it', () => {
  // The whole point. A REQUESTED or freshly-booked ticket has no expense row,
  // and before this it was money the trip screen never mentioned.
  const r = withBookings([], [booking({ id: 'b1', amount: 40000 })])
  assert.equal(r.length, 1)
  assert.equal(r[0].kind, 'booking')
  assert.equal(r[0].group, 'Travel')
  assert.equal(r[0].amount, 40000)
  assert.equal(ledgerTotals(r).company, 40000)
})

test('a booking that ALREADY has a bill is counted once, not twice', () => {
  // THE BUG THIS EXISTS FOR. Some desk bookings have a mirror expense row
  // carrying the same money. Adding the booking as well would overstate the
  // trip by the price of a flight — and it would look perfectly plausible.
  const r = withBookings(
    [line({ id: 'mirror', cat: 'air', bill: 40000, claimed: 0, pay: 'company', bookingId: 'b1' })],
    [booking({ id: 'b1', amount: 40000 })],
  )
  assert.deepEqual(r.map(idOf), ['mirror'], 'the booking is not added a second time')
  assert.equal(ledgerTotals(r).company, 40000, 'and the total is the fare once')
})

test('a hotel booking lands under Stay, not Travel', () => {
  const r = withBookings([], [booking({ id: 'b2', kind: 'hotel', vendor: 'Hyatt', amount: 9000 })])
  assert.equal(r[0].group, 'Stay')
  assert.equal(r[0].catName, 'Hotel')
})

test('a cancelled booking is not a cost', () => {
  const r = withBookings([], [booking({ id: 'b3', amount: 40000, status: 'CANCELLED' })])
  assert.deepEqual(r, [])
})

test('a booking nobody has made yet is shown but not counted as spent', () => {
  // The table insists on an amount, so a request carries one. Treating that as
  // money spent would have the trip claim it cost more than it has.
  const r = withBookings([], [booking({ id: 'b4', kind: 'hotel', amount: 9000, status: 'REQUESTED' })])
  assert.equal(r.length, 1)
  assert.equal(r[0].pending, true)
  const t = ledgerTotals(r)
  assert.equal(t.pending, 9000)
  assert.equal(t.company, 0)
  assert.equal(t.total, 0, 'what the trip has cost does not include what was merely asked for')
})

test('a booking somebody paid for themselves stays private to them', () => {
  // Company-paid is the trip's cost and everyone on it may see it; a booking
  // paid out of pocket is that person's own money, and the privacy rule is the
  // same one the bills follow.
  const mate = withBookings([], [booking({ id: 'b5', amount: 3000, paidBy: 'self' })], { owner: MATE })
  assert.deepEqual(mate, [], 'not on a co-traveller’s screen')
  const desk = withBookings([], [booking({ id: 'b5', amount: 3000, paidBy: 'self' })], { owner: MATE, everyone: true })
  assert.equal(desk.length, 1, 'but Finance sees it')
  assert.equal(desk[0].who, 'Asha Rao')
})

test('bookings are left out entirely when none are passed', () => {
  // The old call signature still means what it did: bills only.
  const r = rowsFor([line({ id: 'a', cat: 'meals', claimed: 300 })])
  assert.equal(r.length, 1)
  assert.equal(r[0].kind, 'expense')
})

// ── the advance, and who owes whom ──────────────────────────────────────────

test('an advance is not a cost, and nets against what the traveller claims', () => {
  const rows = withBookings([line({ id: 'h', cat: 'hotel', claimed: 4200 })], [])
  const t = ledgerTotals(rows, { advance: { approved: 10000, outstanding: 10000 }, advanceMine: true })
  assert.equal(t.total, 4200, 'the advance does not inflate what the trip cost')
  assert.equal(t.advance, 10000)
  assert.equal(t.net, -5800, 'they are holding more than they spent, and owe it back')
})

test('a traveller owed money after their advance sees a positive net', () => {
  const rows = withBookings([line({ id: 'h', cat: 'hotel', claimed: 18000 })], [])
  const t = ledgerTotals(rows, { advance: { approved: 10000, outstanding: 10000 }, advanceMine: true })
  assert.equal(t.net, 8000)
})

test('the netting refuses to run on somebody else’s advance', () => {
  // An advance belongs to ONE employee. On a desk's screen `self` is the sum
  // across every traveller, so subtracting one person's advance from it would
  // produce a number that means nothing at all.
  const rows = ledgerRows({
    expenses: [line({ id: 'a', emp: ME, cat: 'meals', claimed: 300 }),
               line({ id: 'b', emp: MATE, cat: 'hotel', claimed: 9000 })],
    legs: [], me: ME, everyone: true, nameOf: () => 'Asha Rao', cats: CATS, tripOwner: MATE,
  })
  const t = ledgerTotals(rows, { advance: { approved: 5000, outstanding: 5000 }, advanceMine: false })
  assert.equal(t.net, null, 'no net is offered')
  assert.equal(t.advance, 5000, 'but the advance is still reported')
  assert.equal(t.self, 9300)
})

test('the net is computed from the reader’s own lines, not the trip’s', () => {
  // Finance reading their own trip must not have a colleague's claim netted
  // against their advance.
  const rows = ledgerRows({
    expenses: [line({ id: 'a', emp: ME, cat: 'meals', claimed: 2000 }),
               line({ id: 'b', emp: MATE, cat: 'hotel', claimed: 9000 })],
    legs: [], me: ME, everyone: true, nameOf: () => 'Asha Rao', cats: CATS, tripOwner: ME,
  })
  const t = ledgerTotals(rows, { advance: { approved: 1000, outstanding: 1000 }, advanceMine: true })
  assert.equal(t.mine, 2000)
  assert.equal(t.net, 1000, '2000 claimed less the 1000 advance, ignoring the colleague')
})

test('no advance means no net, rather than a net of everything claimed', () => {
  const rows = withBookings([line({ id: 'h', cat: 'hotel', claimed: 4200 })], [])
  const t = ledgerTotals(rows, { advance: null, advanceMine: true })
  assert.equal(t.net, null)
  assert.equal(t.advance, 0)
})

// ── the trip's own record, not just its money ────────────────────────────────
// WHAT WAS MISSING. The bucket listed money, so a journey nobody had billed yet
// was not in it at all. Measured on SRS-TRP-2026-0008: four journeys, two of
// them sub-trips, one bill between them — the bucket showed a single row and
// three journeys appeared nowhere. A trip's bucket is meant to BE the trip.

const withLegs = (expenses: TeExpense[], legs: TeLeg[], o: { everyone?: boolean; stay?: { status?: string; name?: string } | null } = {}) =>
  ledgerRows({
    expenses, legs, bookings: [], me: ME, everyone: o.everyone ?? false,
    nameOf: id => (id === MATE ? 'Asha Rao' : 'Someone'), cats: CATS,
    tripOwner: ME, stay: o.stay ?? null,
  })

describe('every journey of the trip is in the bucket', () => {
  it('a journey with no bill still appears', () => {
    const r = withLegs([], [leg({ id: 'l2', n: 2, kind: 'extra', status: 'PLANNED' })])
    assert.equal(r.length, 1)
    assert.equal(r[0].kind, 'journey')
    assert.equal(r[0].group, 'Journeys')
    assert.equal(r[0].amount, 0, 'and costs nothing, because nothing was billed')
  })

  it('all four of a real trip’s journeys appear, not just the billed one', () => {
    const legs = [
      leg({ id: 'l1', n: 1, kind: 'main', status: 'SUBMITTED' }),
      leg({ id: 'l2', n: 2, kind: 'extra', status: 'PLANNED' }),
      leg({ id: 'l3', n: 3, kind: 'return', status: 'SKIPPED' }),
      leg({ id: 'l4', n: 4, kind: 'extra', status: 'PLANNED' }),
    ]
    const r = withLegs([line({ id: 'x', cat: 'cab', legId: 'l1', claimed: 700 })], legs)
    const journeys = r.filter(j => j.kind === 'journey')
    assert.equal(journeys.length, 4, 'the shape of SRS-TRP-2026-0008')
    assert.deepEqual(journeys.map(j => j.catName),
      ['Journey 1', 'Sub-trip 2', 'Journey 3', 'Sub-trip 4'])
  })

  it('a sub-trip is named as one', () => {
    const r = withLegs([], [leg({ id: 'l9', n: 9, kind: 'extra', status: 'SUBMITTED' })])
    assert.equal(r[0].catName, 'Sub-trip 9')
    assert.equal(r[0].subTrip, true)
  })

  it('journeys come in order, whatever order they arrived in', () => {
    const r = withLegs([], [
      leg({ id: 'c', n: 3, kind: 'extra' }), leg({ id: 'a', n: 1 }), leg({ id: 'b', n: 2 }),
    ])
    assert.deepEqual(r.filter(j => j.kind === 'journey').map(j => j.leg.n), [1, 2, 3])
  })

  it('a cancelled journey is not part of the record', () => {
    const r = withLegs([], [leg({ id: 'l1', n: 1, status: 'CANCELLED' })])
    assert.deepEqual(r, [])
  })
})

describe('a journey’s bills fold into it, and are not counted twice', () => {
  it('the bill shows on the journey and nowhere else', () => {
    const r = withLegs([line({ id: 'x', cat: 'cab', legId: 'l1', claimed: 700 })],
      [leg({ id: 'l1', n: 1 })])
    assert.equal(r.length, 1, 'one row, not a journey row AND a bill row')
    assert.equal(r[0].kind, 'journey')
    assert.equal(r[0].amount, 700)
    assert.deepEqual(ledgerTotals(r).self, 700, 'counted once')
  })

  it('two bills on one journey add up on its row', () => {
    const r = withLegs([
      line({ id: 'a', cat: 'cab', legId: 'l1', claimed: 300 }),
      line({ id: 'b', cat: 'toll', legId: 'l1', claimed: 120 }),
    ], [leg({ id: 'l1', n: 1 })])
    assert.equal(r.length, 1)
    assert.equal(r[0].amount, 420)
  })

  it('bills that disagree about who paid are split, not lumped', () => {
    // The reason a row carries self and company separately: one flag would
    // have put the whole journey on whichever side the first line was.
    const r = withLegs([
      line({ id: 'a', cat: 'cab', legId: 'l1', claimed: 300, pay: 'self' }),
      line({ id: 'b', cat: 'air', legId: 'l1', bill: 5000, claimed: 0, pay: 'company' }),
    ], [leg({ id: 'l1', n: 1 })])
    const t = ledgerTotals(r)
    assert.equal(t.self, 300)
    assert.equal(t.company, 5000)
    assert.equal(t.total, 5300)
  })

  it('a bill on no journey stays a row of its own', () => {
    const r = withLegs([line({ id: 'h', cat: 'hotel', legId: null, claimed: 4200 })], [])
    assert.equal(r.length, 1)
    assert.equal(r[0].kind, 'expense')
    assert.equal(r[0].group, 'Stay')
  })

  it('a colleague’s private bill does not reach a journey row either', () => {
    // The privacy filter runs before the folding, so a journey a co-traveller
    // billed shows the journey without the amount.
    const r = withLegs([line({ id: 'a', emp: MATE, cat: 'cab', legId: 'l1', claimed: 900 })],
      [leg({ id: 'l1', n: 1 })])
    assert.equal(r.length, 1)
    assert.equal(r[0].kind, 'journey')
    assert.equal(r[0].amount, 0, 'the journey is shown; the colleague’s money is not')
    const desk = withLegs([line({ id: 'a', emp: MATE, cat: 'cab', legId: 'l1', claimed: 900 })],
      [leg({ id: 'l1', n: 1 })], { everyone: true })
    assert.equal(desk[0].amount, 900, 'but a desk sees it')
  })
})

describe('the stay the desk chose is in the record before the bill is', () => {
  it('a chosen hotel appears with no money against it', () => {
    const r = withLegs([], [], { stay: { status: 'CHOSEN', name: 'Hyatt Place Noida' } })
    assert.equal(r.length, 1)
    assert.equal(r[0].kind, 'stay')
    assert.equal(r[0].group, 'Stay')
    assert.equal(r[0].amount, 0)
    assert.equal(r[0].pending, true)
  })

  it('and gives way once a hotel bill exists', () => {
    const r = withLegs([line({ id: 'h', cat: 'hotel', claimed: 6200 })], [],
      { stay: { status: 'CHOSEN', name: 'Hyatt Place Noida' } })
    assert.equal(r.filter(x => x.kind === 'stay').length, 0, 'the bill IS the stay')
    assert.equal(r.length, 1)
  })

  it('a stay still being decided is not shown as settled', () => {
    for (const status of ['NONE', 'ASKED', 'OFFERED']) {
      assert.deepEqual(withLegs([], [], { stay: { status, name: 'Somewhere' } }), [])
    }
  })
})
