// lib/exit/__tests__/lwd.test.ts — the tentative LWD, the HR Manager's LWD change after approval,
// the notice waiver and the shortfall that is left.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canManageLwd, tentativeProblem, shortfallDays, lwdChangeProblem, waiverProblem } from '../lwd.ts'
import { noticeShortfallOf } from '../fnf.ts'

test('only the HR Manager (and the super admin) may change an approved LWD or waive notice', () => {
  assert.equal(canManageLwd(['HR_MANAGER'], false), true)
  assert.equal(canManageLwd(['hr_manager', 'EMPLOYEE'], false), true)
  assert.equal(canManageLwd(['HR_EXECUTIVE', 'L1_MANAGER', 'HOD'], false), false)
  assert.equal(canManageLwd([], true), true)
})

test('the employee proposes a tentative LWD, not before the resignation', () => {
  assert.equal(tentativeProblem('2026-12-31', '2026-11-01'), null)
  assert.equal(tentativeProblem('2026-11-01', '2026-11-01'), null)
  assert.match(tentativeProblem('2026-10-30', '2026-11-01')!, /before the date of resignation/)
  assert.match(tentativeProblem('', '2026-11-01')!, /Enter your tentative/)
})

test('the HR Manager may move the LWD until it has passed, never into the past', () => {
  const t = '2026-11-10'
  assert.equal(lwdChangeProblem({ current: '2026-12-31', next: '2026-12-15', today: t }), null)
  assert.equal(lwdChangeProblem({ current: t, next: '2026-11-20', today: t }), null, 'on the day itself it can still change')
  assert.match(lwdChangeProblem({ current: '2026-11-09', next: '2026-11-20', today: t })!, /has passed/)
  assert.match(lwdChangeProblem({ current: '2026-12-31', next: '2026-11-01', today: t })!, /cannot be in the past/)
  assert.match(lwdChangeProblem({ current: '2026-12-31', next: '2026-12-31', today: t })!, /already/)
  assert.match(lwdChangeProblem({ current: null, next: '2026-12-31', today: t })!, /no approved last working day/)
  assert.match(lwdChangeProblem({ current: '2026-12-31', next: '2026-11-12', today: t, resignedOn: '2026-11-15' })!, /before the date of resignation/)
})

test('waiver: up to the whole notice, with a reason', () => {
  assert.equal(waiverProblem({ days: 60, noticeDays: 60, reason: 'Moving abroad' }), null)
  assert.equal(waiverProblem({ days: 0, noticeDays: 60, reason: '' }), null, 'zero clears a waiver')
  assert.match(waiverProblem({ days: 61, noticeDays: 60, reason: 'x' })!, /whole notice period \(60 days\)/)
  assert.match(waiverProblem({ days: 10, noticeDays: 60, reason: ' ' })!, /reason/)
})

test('the waived days come off the shortfall, in the resignation and in the F&F', () => {
  // 60 days notice from 1 Nov → policy LWD 31 Dec; leaving 1 Dec leaves 30 days unserved.
  assert.equal(shortfallDays({ policyLwd: '2026-12-31', finalLwd: '2026-12-01' }), 30)
  assert.equal(shortfallDays({ policyLwd: '2026-12-31', finalLwd: '2026-12-01', waivedDays: 20 }), 10)
  assert.equal(shortfallDays({ policyLwd: '2026-12-31', finalLwd: '2026-12-01', waivedDays: 60 }), 0)
  assert.equal(shortfallDays({ policyLwd: '2026-12-31', finalLwd: '2027-01-15' }), 0)
  const full = noticeShortfallOf(60000, 60, '2026-11-01', '2026-12-01')
  assert.equal(full.days, 30); assert.equal(full.amount, 60000)
  const part = noticeShortfallOf(60000, 60, '2026-11-01', '2026-12-01', { waivedDays: 20 })
  assert.equal(part.days, 10); assert.equal(part.amount, 20000); assert.match(part.note, /20 waived by HR/)
  assert.equal(noticeShortfallOf(60000, 60, '2026-11-01', '2026-12-01', { waivedDays: 60 }).amount, 0)
})
