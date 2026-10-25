// What a leave type lets somebody take, and whether a request fits.
//
// These rules decide whether a request reaches an approver at all, and an
// approval that slips through them is unpaid leave paid as paid leave. The
// figures are the live catalogue's: CL 7/year monthly, ML 180 per occurrence
// (twice in tenure), LWP unlimited and unpaid, Bereavement with no quota.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  policyOf, isHeadline, computeTypeBalance, checkRequest, checkApproval, splitWithLwp, approverRole, pendingFrom,
  type LeaveTypeLike,
} from '../policy.ts'

const CL: LeaveTypeLike = { id: 'cl', short_name: 'CL', name: 'Casual Leave', application_mode: 'EMPLOYEE', accrual: 'MONTHLY', annual_quota: 7, is_paid: true, gender: 'ANY' }
const ML: LeaveTypeLike = { id: 'ml', short_name: 'ML', name: 'Maternity Leave', application_mode: 'EMPLOYEE', accrual: 'MONTHLY', annual_quota: 180, is_paid: true, gender: 'F', max_times_in_tenure: 2 }
const LWP: LeaveTypeLike = { id: 'lwp', short_name: 'LWP', name: 'Leave Without Pay', application_mode: 'EMPLOYEE', annual_quota: 0, is_paid: false, allow_without_balance: true }
const CP: LeaveTypeLike = { id: 'cp', short_name: 'CP', name: 'Comp Off', application_mode: 'EARN_AVAIL', annual_quota: 0, is_paid: true }
const BL: LeaveTypeLike = { id: 'bl', short_name: 'BL', name: 'Bereavement Leave', application_mode: 'EMPLOYEE', accrual: 'YEARLY', annual_quota: 0, is_paid: true, gender: 'ANY' }

// 12 Oct 2026: April–September have ended → 6 months of CL at 7/12.
const asOf = new Date(2026, 9, 12)
const bal = (type: LeaveTypeLike, quota: number, apps: any[] = [], opening = 0) =>
  computeTypeBalance({ type, quota, fyStartYear: 2026, doj: '2024-01-01', lwd: null, stored: { opening }, applications: apps, asOf })

test('each catalogue type gets the policy its settings describe', () => {
  assert.equal(policyOf(CL, 7), 'ACCRUAL')
  assert.equal(policyOf(ML, 180), 'PER_OCCURRENCE')
  assert.equal(policyOf(LWP, 0), 'UNLIMITED')
  assert.equal(policyOf(CP, 0), 'EARNED')
  assert.equal(policyOf(BL, 0), 'ACCRUAL')
})

test('only ordinary paid leave makes up the headline balance', () => {
  assert.equal(isHeadline(CL, 7, 'ACCRUAL'), true)
  assert.equal(isHeadline(ML, 180, 'PER_OCCURRENCE'), false)
  assert.equal(isHeadline(LWP, 0, 'UNLIMITED'), false)
  assert.equal(isHeadline(BL, 0, 'ACCRUAL'), false)      // no quota, nothing to count
})

test('pending requests hold their days: available stays, bookable drops', () => {
  const b = bal(CL, 7, [
    { id: 'a', leave_type_id: 'cl', status: 'APPROVED', from_date: '2026-06-01', days: 1 },
    { id: 'p', leave_type_id: 'cl', status: 'PENDING', from_date: '2026-11-02', days: 2 },
  ])
  assert.equal(b.accrued, 3.5)
  assert.equal(b.used, 1)
  assert.equal(b.available, 2.5)
  assert.equal(b.pending, 2)
  assert.equal(b.bookable, 0.5)
})

test('an 11-day CL request on a 3.5-day balance is refused, with the bookable figure', () => {
  const b = bal(CL, 7)
  const c = checkRequest(b, 11)
  assert.equal(c.ok, false)
  if (!c.ok) {
    assert.equal(c.bookable, 3.5)
    assert.match(c.reason, /3\.5 days of CL/)
  }
  assert.equal(checkRequest(b, 3.5).ok, true)
})

test('a type with no quota and no opening says HR has not set it up', () => {
  const c = checkRequest(bal(BL, 0), 2)
  assert.equal(c.ok, false)
  if (!c.ok) assert.match(c.reason, /entitlement/)
  // …but an opening balance loaded by HR makes it usable.
  assert.equal(checkRequest(bal(BL, 0, [], 3), 2).ok, true)
})

test('maternity is a full entitlement per occurrence, not 15 days a month', () => {
  const b = bal(ML, 180)
  assert.equal(b.available, 180)
  assert.equal(checkRequest(b, 180).ok, true)
  assert.equal(checkRequest(b, 181).ok, false)
})

test('LWP and Comp Off are never blocked on balance', () => {
  assert.equal(checkRequest(bal(LWP, 0), 30).ok, true)
  assert.equal(checkRequest(bal(CP, 0), 1).ok, true)
  assert.equal(bal(LWP, 0, [{ leave_type_id: 'lwp', status: 'APPROVED', from_date: '2026-07-01', days: 4 }]).used, 4)
})

test('approval ignores other pending requests but never overdraws', () => {
  const b = bal(CL, 7, [{ id: 'x', leave_type_id: 'cl', status: 'PENDING', from_date: '2026-11-02', days: 3 }])
  assert.equal(checkApproval(b, 3).ok, true)       // 3.5 earned, this request is 3
  assert.equal(checkApproval(b, 4).ok, false)
})

test('pendingFrom can leave the request under review out', () => {
  const apps = [{ id: 'x', leave_type_id: 'cl', status: 'PENDING', from_date: '2026-11-02', days: 3 }]
  assert.equal(pendingFrom(apps, 'cl', 2026), 3)
  assert.equal(pendingFrom(apps, 'cl', 2026, 'x'), 0)
})

test('split: whole paid days first, the rest as LWP, both on working days', () => {
  const days = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-11', '2026-11-12', '2026-11-13']
  const s = splitWithLwp(days, 3.5)
  assert.deepEqual(s.paid, { from: '2026-11-02', to: '2026-11-04', days: 3 })
  assert.deepEqual(s.lwp, { from: '2026-11-05', to: '2026-11-13', days: 6 })
  assert.deepEqual(splitWithLwp(days, 0), { paid: null, lwp: { from: '2026-11-02', to: '2026-11-13', days: 9 } })
  assert.deepEqual(splitWithLwp(['2026-11-02'], 5), { paid: { from: '2026-11-02', to: '2026-11-02', days: 1 }, lwp: null })
})

test('the approver is named by relationship, line manager first', () => {
  const e = { l1_manager_id: 'a', hr_manager_id: 'a', l2_manager_id: 'b', hr_head_id: 'c' }
  assert.equal(approverRole(e, 'a'), 'Reporting manager')
  assert.equal(approverRole({ ...e, l1_manager_id: 'z' }, 'a'), 'HR manager')
  assert.equal(approverRole(e, 'b'), 'L2 manager')
  assert.equal(approverRole(e, 'c'), 'HR head')
  assert.equal(approverRole(e, 'q'), 'Approver (delegate)')
})
