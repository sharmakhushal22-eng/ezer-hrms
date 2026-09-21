// Leave balance is money-adjacent: it decides what an employee may take and,
// through LWP, what they are paid. leave_balances has been empty for all 398
// employees since the table was created, so every one of these rules is being
// applied for the first time and nothing is available to check them against.
//
// The figures below come from the live catalogue: EL 15/year, CL 7, SL 7.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  daysInMonth, effectiveDays, monthlyAccrual, floor1, fyMonths,
  accruedAsOf, usedFrom, balanceFor, carryForward, normaliseMode,
} from '../accrual.ts'

const EL = 15, FY = 2026   // FY 2026-27 runs Apr 2026 → Mar 2027
const endOf = (y: number, m: number) => new Date(y, m - 1, daysInMonth(y, m))

// ── The FY window ──────────────────────────────────────────────────────────
test('the financial year runs April to March, twelve months', () => {
  const ms = fyMonths(FY)
  assert.equal(ms.length, 12)
  assert.deepEqual(ms[0], { year: 2026, month: 4 })    // April
  assert.deepEqual(ms[8], { year: 2026, month: 12 })   // December
  assert.deepEqual(ms[9], { year: 2027, month: 1 })    // January, next calendar year
  assert.deepEqual(ms[11], { year: 2027, month: 3 })   // March
})

// ── Rounding: the trap that loses half a day a year ────────────────────────
test('a full year accrues EXACTLY the annual quota, not 14.4', () => {
  // EL is 15/12 = 1.25 a month. Flooring each month to one decimal gives 1.2,
  // and twelve of those is 14.4 — the employee silently loses 0.6 days to
  // arithmetic. The months are summed exactly and floored once.
  assert.equal(accruedAsOf(EL, FY, '2020-06-12', null, endOf(2027, 3)), 15)
  assert.equal(accruedAsOf(7, FY, '2020-06-12', null, endOf(2027, 3)), 7)   // CL
})

test('rounding is DOWN, never nearest', () => {
  assert.equal(floor1(0.6666), 0.6)
  assert.equal(floor1(1.25), 1.2)
  assert.equal(floor1(0.99), 0.9)
  // and exact values survive binary float
  assert.equal(floor1(15), 15)
  assert.equal(floor1(0.1 + 0.2), 0.3)
})

// ── Month-end crediting ────────────────────────────────────────────────────
test('a month is credited only once it has ENDED', () => {
  const doj = '2020-06-12'
  // 21 September: April–August are done, September is not.
  assert.equal(accruedAsOf(EL, FY, doj, null, new Date(2026, 8, 21)), floor1(5 * 1.25))
  // 30 September: September now counts.
  assert.equal(accruedAsOf(EL, FY, doj, null, new Date(2026, 8, 30)), floor1(6 * 1.25))
})

test('nothing has accrued on the first day of the financial year', () => {
  assert.equal(accruedAsOf(EL, FY, '2020-06-12', null, new Date(2026, 3, 1)), 0)
})

// ── Effective days: joiners ────────────────────────────────────────────────
test('a mid-month joiner is weighted by the days they were actually here', () => {
  // Joins 15 Sept (30 days): 30 − 15 + 1 = 16 effective days.
  assert.equal(effectiveDays(2026, 9, '2026-09-15', null), 16)
  // Joins on the 1st: the whole month.
  assert.equal(effectiveDays(2026, 9, '2026-09-01', null), 30)
  // Joins on the last day: one day.
  assert.equal(effectiveDays(2026, 9, '2026-09-30', null), 1)
})

test('months before joining accrue nothing', () => {
  assert.equal(effectiveDays(2026, 8, '2026-09-15', null), 0)
  assert.equal(monthlyAccrual(EL, 2026, 8, '2026-09-15', null), 0)
})

test('a September joiner has only the September fraction by 30 September', () => {
  // 1.25 × 16/30 = 0.6667 → floored to 0.6
  assert.equal(accruedAsOf(EL, FY, '2026-09-15', null, endOf(2026, 9)), 0.6)
})

// ── Effective days: leavers ────────────────────────────────────────────────
test('a leaver is weighted to their last working day', () => {
  // Leaves 10 Oct: 10 − 1 + 1 = 10 effective days.
  assert.equal(effectiveDays(2026, 10, '2020-01-01', '2026-10-10'), 10)
  // Leaving on the 1st is one day, not none.
  assert.equal(effectiveDays(2026, 10, '2020-01-01', '2026-10-01'), 1)
  // Leaving on the last day is the whole month.
  assert.equal(effectiveDays(2026, 10, '2020-01-01', '2026-10-31'), 31)
})

test('a leaving date without a joining date still accrues nothing', () => {
  // This was written as `null && undefined`, which is just null — so it proved
  // the no-DOJ path while claiming to be about leavers. tsc caught it
  // (TS2873: always falsy) where the passing assertion did not.
  assert.equal(effectiveDays(2026, 10, null, '2026-10-10'), 0)
})

test('months after leaving accrue nothing', () => {
  assert.equal(effectiveDays(2026, 11, '2020-01-01', '2026-10-10'), 0)
  assert.equal(effectiveDays(2027, 3, '2020-01-01', '2026-10-10'), 0)
})

test('joining and leaving inside one month counts only those days', () => {
  // 10 Sept → 20 Sept is 11 days.
  assert.equal(effectiveDays(2026, 9, '2026-09-10', '2026-09-20'), 11)
})

// ── Missing data must not invent entitlement ───────────────────────────────
test('no joining date on file accrues NOTHING, rather than a full year', () => {
  // Two of 398 employees are in this state. Crediting them a full year would
  // hide an HR data gap behind a plausible-looking number.
  assert.equal(accruedAsOf(EL, FY, null, null, endOf(2027, 3)), 0)
  assert.equal(accruedAsOf(EL, FY, '', null, endOf(2027, 3)), 0)
  assert.equal(accruedAsOf(EL, FY, 'not-a-date', null, endOf(2027, 3)), 0)
})

test('a zero-quota type accrues nothing at all', () => {
  // BL, COL, CP, SAB and LWP all sit at annual_quota 0.
  assert.equal(accruedAsOf(0, FY, '2020-01-01', null, endOf(2027, 3)), 0)
})

// ── used, derived from approved applications ───────────────────────────────
const APPS = [
  { leave_type_id: 'el', status: 'APPROVED', from_date: '2026-07-02', days: 2 },
  { leave_type_id: 'el', status: 'APPROVED', from_date: '2026-07-11', days: 0.5 },
  { leave_type_id: 'el', status: 'PENDING',  from_date: '2026-08-01', days: 3 },
  { leave_type_id: 'el', status: 'CANCELLED', from_date: '2026-08-05', days: 1 },
  { leave_type_id: 'cl', status: 'APPROVED', from_date: '2026-07-20', days: 1 },
]

test('used counts APPROVED only — pending and cancelled are not taken', () => {
  // The two approved rows are the live ones: 2.0 + 0.5.
  assert.equal(usedFrom(APPS, 'el', FY), 2.5)
})

test('used is per leave type, not pooled', () => {
  assert.equal(usedFrom(APPS, 'cl', FY), 1)
  assert.equal(usedFrom(APPS, 'sl', FY), 0)
})

test('used ignores leave from a different financial year', () => {
  const older = [{ leave_type_id: 'el', status: 'APPROVED', from_date: '2026-03-31', days: 5 }]
  assert.equal(usedFrom(older, 'el', FY), 0)        // 31 Mar 2026 is FY 2025-26
  assert.equal(usedFrom(older, 'el', FY - 1), 5)
})

// ── The whole balance ──────────────────────────────────────────────────────
test('available = opening + accrued − used − encashed', () => {
  const b = balanceFor({
    annualQuota: EL, fyStartYear: FY, doj: '2020-06-12', lwd: null,
    opening: 5, encashed: 1, applications: APPS, leaveTypeId: 'el',
    asOf: endOf(2026, 9),
  })
  assert.equal(b.accrued, floor1(6 * 1.25))   // Apr–Sep
  assert.equal(b.used, 2.5)
  assert.equal(b.available, floor1(5 + 7.5 - 2.5 - 1))
})

test('a balance is never negative', () => {
  const b = balanceFor({
    annualQuota: EL, fyStartYear: FY, doj: '2020-06-12', lwd: null,
    opening: 0, applications: [{ leave_type_id: 'el', status: 'APPROVED', from_date: '2026-05-01', days: 99 }],
    leaveTypeId: 'el', asOf: endOf(2026, 9),
  })
  assert.equal(b.available, 0)
})

// ── Carry-forward: the FY boundary only ────────────────────────────────────
test('carry-forward is capped at the year end, and only there', () => {
  assert.equal(carryForward(42, 30), 30)   // EL caps at 30
  assert.equal(carryForward(12, 30), 12)   // under the cap, all of it carries
  assert.equal(carryForward(9, 0), 0)      // CL and SL cap at 0 — they lapse
  assert.equal(carryForward(0, 30), 0)
  assert.equal(carryForward(-3, 30), 0)
})

test('an unlimited type carries everything', () => {
  // LWP and SAB set carry_forward_unlimited.
  assert.equal(carryForward(120, 0, true), 120)
})

// ── The accrual mode, which the live data and the spec disagree about ──────
test('MONTHLY spreads across the year; YEARLY grants it all at once', () => {
  const doj = '2020-06-12'
  const sep = new Date(2026, 8, 30)
  assert.equal(accruedAsOf(EL, FY, doj, null, sep, 'MONTHLY'), 7.5)  // Apr–Sep
  assert.equal(accruedAsOf(EL, FY, doj, null, sep, 'YEARLY'), 15)    // the lot
})

test('NONE accrues nothing however large the quota', () => {
  assert.equal(accruedAsOf(EL, FY, '2020-06-12', null, new Date(2027, 2, 31), 'NONE'), 0)
})

test('YEARLY still gives nothing to somebody who was never here', () => {
  // Joins after the FY ends.
  assert.equal(accruedAsOf(EL, FY, '2027-06-01', null, new Date(2027, 2, 31), 'YEARLY'), 0)
  assert.equal(accruedAsOf(EL, FY, null, null, new Date(2027, 2, 31), 'YEARLY'), 0)
})

test('the mode reaches balanceFor — it is not silently MONTHLY', () => {
  // This failed once: balanceFor called accruedAsOf without passing the mode,
  // so every balance computed MONTHLY whatever the configuration said.
  const base = {
    annualQuota: EL, fyStartYear: FY, doj: '2020-06-12', lwd: null,
    asOf: new Date(2026, 8, 30),
  }
  assert.equal(balanceFor({ ...base, mode: 'MONTHLY' }).accrued, 7.5)
  assert.equal(balanceFor({ ...base, mode: 'YEARLY' }).accrued, 15)
  assert.equal(balanceFor({ ...base, mode: 'NONE' }).accrued, 0)
  assert.equal(balanceFor(base).accrued, 7.5, 'default must be MONTHLY')
})

test('an unrecognised accrual value falls back to MONTHLY, not to nothing', () => {
  // A typo in configuration must not silently zero everybody's entitlement.
  assert.equal(normaliseMode('monthly'), 'MONTHLY')
  assert.equal(normaliseMode('YEARLY'), 'YEARLY')
  assert.equal(normaliseMode('none'), 'NONE')
  assert.equal(normaliseMode(''), 'MONTHLY')
  assert.equal(normaliseMode(null), 'MONTHLY')
  assert.equal(normaliseMode('QUARTERLY'), 'MONTHLY')
})
