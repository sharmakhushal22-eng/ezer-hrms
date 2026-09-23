// The leave feature has expressed "which year" in four different shapes:
//
//   leave_balances.year      '2026'      calendar-year TEXT, per migration 030
//   leave_policy.fy          '2026-27'   financial year
//   resolve_leave_quota      '2026-27'   the RPC's own default
//   the card title           'FY 2026-27'
//
// On 18 Sep 2026 every one of them resolved to the same year, so nothing looked
// broken. They diverge on 1 January, and a route that asks for FY 2026-27 quota
// while reading FY 2026 balances gets a plausible, wrong answer — the same
// shape as the Friday-to-Monday day count that started all of this.
//
// One conversion, named, tested.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { leaveYearOf, leaveFyLabel, leavePolicyFy, leaveFyStartYear } from '../leave-year.ts'

test('the year key is the FINANCIAL year start, not the calendar year', () => {
  // Indian FY begins 1 April.
  assert.equal(leaveYearOf(new Date(2026, 3, 1)), '2026')   // 1 Apr 2026
  assert.equal(leaveYearOf(new Date(2026, 8, 21)), '2026')  // 21 Sep 2026
  assert.equal(leaveYearOf(new Date(2026, 11, 31)), '2026') // 31 Dec 2026
})

test('it does NOT flip on 1 January — that was the bug', () => {
  assert.equal(leaveYearOf(new Date(2027, 0, 1)), '2026')   // still FY 2026-27
  assert.equal(leaveYearOf(new Date(2027, 2, 31)), '2026')  // 31 Mar 2027, last day
  assert.equal(leaveYearOf(new Date(2027, 3, 1)), '2027')   // 1 Apr 2027, new FY
})

test('the policy key is the same year in the shape leave_policy.fy wants', () => {
  assert.equal(leavePolicyFy('2026'), '2026-27')
  assert.equal(leavePolicyFy('2027'), '2027-28')
  // The century roll, since the suffix is two digits.
  assert.equal(leavePolicyFy('2099'), '2099-00')
})

test('the policy key and the display label agree about the same year', () => {
  // 'FY ' + the policy key. If these ever disagree, a card and a query are
  // describing different years to the same person.
  for (const y of ['2024', '2025', '2026', '2027']) {
    assert.equal(leaveFyLabel(y), `FY ${leavePolicyFy(y)}`)
  }
})

test('the accrual engine gets a number, from the same key', () => {
  assert.equal(leaveFyStartYear('2026'), 2026)
  assert.equal(typeof leaveFyStartYear('2026'), 'number')
})

test('a nonsense key degrades rather than throwing', () => {
  // These run against a TEXT column that HR uploads write, so a stray value is
  // possible. Returning it unchanged is visible; throwing takes the tab down.
  assert.equal(leaveFyLabel('oops'), 'oops')
  assert.equal(leavePolicyFy('oops'), 'oops')
  assert.equal(typeof leaveFyStartYear('oops'), 'number')
})

test('called with no argument, all three describe the same year as today', () => {
  const key = leaveYearOf()
  assert.equal(leavePolicyFy(), leavePolicyFy(key))
  assert.equal(leaveFyStartYear(), Number(key))
})
