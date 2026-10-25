import { test } from 'node:test'
import assert from 'node:assert/strict'
import { approvalTrail, peopleLine } from '../approval-trail.ts'

const holders = {
  HR_MANAGER: [{ name: 'Riya Nair', code: 'STC9073' }],
  IT: [{ name: 'Kiran Patel' }],
  ADMIN: [{ name: 'Asha Rao' }, { name: 'Vikram Shah' }],
  PAYROLL: [{ name: 'Pooja Verma' }],
}
const by = (s: ReturnType<typeof approvalTrail>, k: string) => s.steps.find(x => x.key === k)!

test('a submitted form waits on the HR Manager, since the submission', () => {
  const t = approvalTrail({ status: 'SUBMITTED', submitted_at: '2026-10-20T10:00:00Z', holders, approvals: [
    { team: 'HR_MANAGER', status: 'PENDING' }, { team: 'IT', status: 'PENDING' }, { team: 'ADMIN', status: 'PENDING' }, { team: 'PAYROLL', status: 'PENDING' },
  ] })
  assert.equal(by(t, 'HR_MANAGER').state, 'waiting')
  assert.equal(by(t, 'HR_MANAGER').since, '2026-10-20T10:00:00Z')
  assert.equal(by(t, 'IT').state, 'not_started', 'the heads only see it after the HR Manager accepts')
  assert.equal(t.nowWith, 'HR Manager (Riya Nair)')
  assert.equal(t.summary, '0/4 · HR Manager')
  assert.equal(t.approved, 0)
})

test('after acceptance the three heads wait in parallel, since the acceptance; approvals carry the name and date', () => {
  const t = approvalTrail({ status: 'HR_REVIEW', holders, approvals: [
    { team: 'HR_MANAGER', status: 'APPROVED', acted_by_name: 'Riya Nair', acted_at: '2026-10-17T16:06:37Z' },
    { team: 'IT', status: 'APPROVED', acted_by_name: 'Kiran Patel', acted_at: '2026-10-17T16:10:30Z' },
    { team: 'ADMIN', status: 'PENDING' }, { team: 'PAYROLL', status: 'PENDING' },
  ] })
  assert.equal(t.approved, 2)
  assert.deepEqual([by(t, 'IT').state, by(t, 'IT').by], ['done', 'Kiran Patel'])
  assert.equal(by(t, 'ADMIN').since, '2026-10-17T16:06:37Z')
  assert.equal(t.summary, '2/4 · Admin, Payroll')
  assert.equal(t.nowWith, 'Admin (Asha Rao, Vikram Shah) · Payroll (Pooja Verma)')
  assert.equal(by(t, 'CODE').state, 'not_started')
})

test('all four approved: the code is next, waiting on the HR Manager since the last head', () => {
  const t = approvalTrail({ status: 'APPROVED', holders, approvals: [
    { team: 'HR_MANAGER', status: 'APPROVED', acted_at: '2026-10-23T17:44:39Z' },
    { team: 'IT', status: 'APPROVED', acted_at: '2026-10-23T17:55:03Z' },
    { team: 'PAYROLL', status: 'APPROVED', acted_at: '2026-10-23T17:56:49Z' },
    { team: 'ADMIN', status: 'APPROVED', acted_at: '2026-10-23T17:57:22Z' },
  ] })
  assert.equal(t.summary, '4/4 · code next')
  assert.equal(by(t, 'CODE').state, 'waiting')
  assert.equal(by(t, 'CODE').since, '2026-10-23T17:57:22Z')
  assert.equal(t.tone, 'positive')
})

test('a return sends it back to the candidate, with who returned it and the remark', () => {
  const t = approvalTrail({ status: 'IN_PROGRESS', holders, approvals: [
    { team: 'HR_MANAGER', status: 'APPROVED', acted_by_name: 'Riya Nair' },
    { team: 'PAYROLL', status: 'RETURNED', acted_by_name: 'Pooja Verma', acted_at: '2026-10-21T09:00:00Z', remark: 'Bank account does not match the cheque' },
  ] })
  assert.equal(by(t, 'PAYROLL').state, 'returned')
  assert.equal(by(t, 'PAYROLL').remark, 'Bank account does not match the cheque')
  assert.equal(t.summary, 'Returned')
  assert.match(t.nowWith, /candidate/)
  assert.equal(t.tone, 'critical')
})

test("the HR Manager's own return comes from the review when there is no RETURNED row", () => {
  const t = approvalTrail({ status: 'IN_PROGRESS', approvals: [], hr_review: { outcome: 'RETURNED', by_name: 'Riya Nair', at: '2026-10-19T00:00:00Z', note: 'PAN unreadable' } })
  assert.equal(by(t, 'HR_MANAGER').state, 'returned')
  assert.equal(by(t, 'HR_MANAGER').by, 'Riya Nair')
  assert.equal(by(t, 'HR_MANAGER').remark, 'PAN unreadable')
})

test('before submission nothing is waiting on an approver', () => {
  const t = approvalTrail({ status: 'INVITED', approvals: [] })
  assert.ok(t.beforeSubmit)
  assert.ok(t.steps.every(s => s.state === 'not_started'))
  assert.equal(t.summary, 'Not started')
})

test('a code generated without the approvals on record marks them skipped, not pending', () => {
  const t = approvalTrail({ status: 'EMPLOYEE_CREATED', employee_code: 'STC0101', role_assignment: { by_name: 'Riya Nair', at: '2026-10-18T10:23:27Z' }, approvals: [
    { team: 'HR_MANAGER', status: 'APPROVED' }, { team: 'IT', status: 'APPROVED' },
  ] })
  assert.equal(by(t, 'ADMIN').state, 'skipped')
  assert.deepEqual([by(t, 'CODE').state, by(t, 'CODE').by, by(t, 'CODE').remark], ['done', 'Riya Nair', 'STC0101'])
  assert.equal(t.summary, 'Complete')
})

test('a team with nobody holding the role still shows, without names', () => {
  const t = approvalTrail({ status: 'SUBMITTED', approvals: [] })
  assert.deepEqual(by(t, 'HR_MANAGER').people, [])
  assert.equal(t.nowWith, 'HR Manager')
})

test('peopleLine keeps a long list short', () => {
  assert.equal(peopleLine([]), '')
  assert.equal(peopleLine(['A', 'B']), 'A, B')
  assert.equal(peopleLine(['A', 'B', 'C', 'D']), 'A, B +2')
})

test('one date format on the onboarding screens, and plain relative days', async () => {
  const { dayLabel, daysFromToday, relDays } = await import('../approval-trail.ts')
  assert.equal(dayLabel('2026-10-12'), '12 Oct 2026')
  assert.equal(dayLabel(null), '—')
  assert.equal(dayLabel('not a date'), '—')
  const now = new Date('2026-10-25T15:00:00')
  assert.equal(daysFromToday('2026-10-12', now), -13)
  assert.equal(daysFromToday('2026-10-25', now), 0)
  assert.deepEqual([relDays(0), relDays(1), relDays(5), relDays(-1), relDays(-13), relDays(null)], ['today', 'tomorrow', 'in 5 days', 'yesterday', '13 days ago', ''])
})
