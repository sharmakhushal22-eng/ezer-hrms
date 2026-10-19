// Everything one trip cost, in one place — and who is allowed to see it.
//
// Two things here would fail silently and matter. One is the privacy filter: a
// traveller must not be shown what a colleague was reimbursed, which is a bug
// somebody already fixed once on this screen and which a merged view is the
// obvious way to reintroduce. The other is the grouping — a hotel landing under
// "Other" is wrong in a way that looks fine.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ledgerRows, ledgerTotals } from '../trip-ledger.ts'
import type { TeCategory, TeExpense, TeLeg } from '../types.ts'

const ME = 'me-1', MATE = 'mate-2'

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
  assert.deepEqual(r.map(x => x.line.id), ['a'], 'the colleague’s own claim is gone')
})

test('but a traveller does see what the company paid for directly', () => {
  // A ticket the desk bought is the cost of the trip, not anybody's private
  // reimbursement, and hiding it would leave the traveller unable to see half
  // of what their own trip cost.
  const r = rowsFor([
    line({ id: 'a', emp: ME, cat: 'meals', claimed: 300 }),
    line({ id: 'b', emp: MATE, cat: 'air', bill: 6480, pay: 'company' }),
  ])
  assert.deepEqual(r.map(x => x.line.id), ['a', 'b'])
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
    Object.fromEntries(r.map(x => [x.line.id, x.group])),
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
