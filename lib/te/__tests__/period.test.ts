import { test } from 'node:test'
import assert from 'node:assert/strict'
import { claimDateOf, monthOf, periodFor } from '../period.ts'
import type { TePeriod } from '../types.ts'

const p = (m: string, status = 'OPEN'): TePeriod =>
  ({ m, status, label: `${['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m.slice(5, 7)]} ${m.slice(0, 4)}` })

// The live configuration that produced the bug: five open months, June first.
const LIVE = [p('2026-06'), p('2026-07'), p('2026-08'), p('2026-10'), p('2026-11')]

// ── the bug itself ──────────────────────────────────────────────────────────

test('a 17 October trip goes into October, not into the first open month', () => {
  // The screen used to show `openPeriods[0].label`, which was "Jun 2026".
  const got = periodFor(LIVE, '2026-10-17', '2026-10-18')
  assert.equal(got?.period.label, 'Oct 2026')
  assert.equal(got?.isLate, false)
})

test('the month is read from the date, not from today', () => {
  // Same company, same open months, a bill from August. August is open, so
  // that is where it goes — even though today is in October.
  const got = periodFor(LIVE, '2026-08-29', '2026-10-18')
  assert.equal(got?.period.label, 'Aug 2026')
  assert.equal(got?.isLate, false)
})

// ── te_period_for's fallback, clause by clause ──────────────────────────────

test('a bill whose own month is closed is late, and goes to the current month first', () => {
  // September is not open at all. te_period_for orders by
  // `(period_month = this month) desc` first, so October wins over November
  // even though both are after September.
  const got = periodFor(LIVE, '2026-09-14', '2026-10-18')
  assert.equal(got?.period.label, 'Oct 2026')
  assert.equal(got?.isLate, true)
})

test('when the current month is not open, the earliest month AFTER the bill wins', () => {
  // Clause two: `(period_month > the expense month) desc`, then period_month.
  const months = [p('2026-06'), p('2026-08'), p('2026-11')]
  const got = periodFor(months, '2026-07-03', '2026-10-18')
  assert.equal(got?.period.label, 'Aug 2026')
  assert.equal(got?.isLate, true)
})

test('with nothing after it, the earliest open month takes it', () => {
  // Clause three. A December bill with only June and August open: neither is
  // after it, so the plain `period_month` ordering decides.
  const got = periodFor([p('2026-08'), p('2026-06')], '2026-12-20', '2027-01-09')
  assert.equal(got?.period.label, 'Jun 2026')
  assert.equal(got?.isLate, true)
})

test('a closed or locked month is never offered', () => {
  const months = [p('2026-10', 'CLOSED'), p('2026-11', 'LOCKED'), p('2026-06')]
  const got = periodFor(months, '2026-10-17', '2026-10-18')
  assert.equal(got?.period.label, 'Jun 2026')
  assert.equal(got?.isLate, true)
})

test('no open month at all says nothing rather than inventing one', () => {
  // te_period_for raises TE_NO_OPEN_PERIOD here and the submit is refused.
  // The screen must not promise a month that does not exist.
  assert.equal(periodFor([p('2026-10', 'CLOSED')], '2026-10-17', '2026-10-18'), null)
  assert.equal(periodFor([], '2026-10-17', '2026-10-18'), null)
})

test('a full date in the period month is read as its month', () => {
  // travel_periods.period_month is the first of the month; the snapshot may
  // carry either shape.
  const got = periodFor([p('2026-10-01')], '2026-10-17', '2026-10-18')
  assert.equal(got?.isLate, false)
})

// ── which date the month is picked from ─────────────────────────────────────

test("a trip's end date wins over its bills", () => {
  // te_claim_submit: coalesce(t.end_date, max(expense_date)). A bill dated
  // after the trip ended does not move the claim into the next month.
  assert.equal(claimDateOf('2026-10-17', ['2026-11-02', '2026-10-16']), '2026-10-17')
})

test('with no trip, the latest bill decides', () => {
  assert.equal(claimDateOf(null, ['2026-10-02', '2026-10-29', '2026-10-11']), '2026-10-29')
})

test('an empty or unusable set of dates has no opinion', () => {
  assert.equal(claimDateOf(null, []), '')
  assert.equal(claimDateOf(null, ['', 'soon']), '')
  assert.equal(monthOf(''), '')
  assert.equal(monthOf(null), '')
  assert.equal(monthOf('2026-10-17'), '2026-10')
})

test('a claim with no usable date still picks a month rather than breaking', () => {
  // Nothing to go on: fall through to the fallback ordering, and say it is
  // late, because "I cannot tell" must not read as "filed on time".
  const got = periodFor(LIVE, '', '2026-10-18')
  assert.equal(got?.period.label, 'Oct 2026')
  assert.equal(got?.isLate, true)
})
