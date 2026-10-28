// lib/exit/__tests__/hr-exit.test.ts — an exit the company starts: who may, what it needs, the
// approval chain it walks, and the screens it lives on.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { canExitOthers, EXIT_ROLES, HR_EXIT_REASONS, startProblems, suggestedLwd, buildChain, advance, decide, waitingOn, type Person } from '../hr-exit.ts'

const P = (id: string, code = id.toUpperCase()): Person => ({ id, emp_code: code, full_name: `Name ${id}` })
const NOW = '2026-10-28T10:00:00.000Z'

test('the hiring and HR roles may exit others; everyone else may not', () => {
  for (const r of ['RECRUITER', 'HR_EXECUTIVE', 'BRANCH_HR', 'HR_MANAGER', 'HR_HEAD', 'CHRO', 'hr_head']) assert.ok(canExitOthers([r], false), r)
  for (const r of ['EMPLOYEE', 'L1_MANAGER', 'HOD', 'PAYROLL']) assert.equal(canExitOthers([r], false), false, r)
  assert.ok(canExitOthers([], true), 'super admin')
  assert.equal(EXIT_ROLES.length, 6)
})

test('the company reasons and their chains follow the spec', () => {
  const by = Object.fromEntries(HR_EXIT_REASONS.map(r => [r.code, r]))
  assert.deepEqual(by.ABSCOND.chain, ['HR_MANAGER', 'HR_HEAD'])
  assert.deepEqual(by.FRAUD.chain, ['HR_MANAGER', 'LEGAL', 'HR_HEAD', 'MD'])
  for (const c of ['LAYOFF', 'TERMINATION', 'DISCONTINUE']) assert.deepEqual(by[c].chain, ['HR_MANAGER', 'HR_HEAD', 'MD'], c)
  assert.ok(HR_EXIT_REASONS.every(r => r.subReasons.length > 0))
})

test('the last working day is suggested per reason', () => {
  const o = { today: '2026-10-28', noticeDays: 60, lastAttendance: '2026-10-20' }
  assert.equal(suggestedLwd('ABSCOND', o), '2026-10-20')
  assert.equal(suggestedLwd('ABSCOND', { ...o, lastAttendance: null }), '2026-10-28')
  assert.equal(suggestedLwd('FRAUD', o), '2026-10-28')
  assert.equal(suggestedLwd('LAYOFF', o), '2026-11-27')
  assert.equal(suggestedLwd('DISCONTINUE', o), '2026-12-27')
})

test('reason, sub-reason, date and additional information are required; nobody exits themself', () => {
  const ok = { employeeId: 'e1', reasonCode: 'TERMINATION', subReason: 'Conduct', lwd: '2026-11-30', remarks: 'Repeated warnings.' }
  assert.deepEqual(startProblems(ok, { self: 'me' }), [])
  const p = startProblems({}, { self: 'me' })
  for (const s of ['Pick the employee', 'Pick the reason', 'Enter the last working day', 'Additional information is required']) assert.ok(p.some(x => x.startsWith(s)), s)
  assert.ok(startProblems({ ...ok, employeeId: 'me' }, { self: 'me' })[0].startsWith('You cannot exit yourself'))
  assert.ok(startProblems({ ...ok, subReason: 'Data Theft' }, { self: 'me' })[0].startsWith('Pick the sub-reason'))
  assert.ok(startProblems({ ...ok, reasonCode: 'SELF' }, { self: 'me' })[0].includes('not one HR can start'))
})

test('the chain: the initiator’s own stage is approved, an empty stage skipped, the exited employee never an approver', () => {
  const holders = { HR_MANAGER: [P('hm1'), P('hm2')], HR_HEAD: [P('hh'), P('emp')] }
  const chain = buildChain('TERMINATION', { holders, initiator: P('hm1'), initiatorRoles: ['HR_MANAGER'], employeeId: 'emp', now: NOW })
  assert.deepEqual(chain.map(s => s.status), ['APPROVED', 'WAITING', 'SKIPPED'])
  assert.deepEqual(chain[1].approvers.map(p => p.id), ['hh'])
  assert.match(chain[2].note!, /Nobody holds the MD/)
  const a = advance(chain)
  assert.equal(a.current, 1); assert.equal(a.done, false); assert.ok(waitingOn(a.chain, 'hh')); assert.ok(!waitingOn(a.chain, 'hm2'))
})

test('approvals walk the chain; a rejection stops it; only the stage approvers may act', () => {
  const holders = { HR_MANAGER: [P('hm')], HR_HEAD: [P('hh')], MD: [P('md')] }
  let { chain } = advance(buildChain('LAYOFF', { holders, initiator: P('rec'), initiatorRoles: ['RECRUITER'], employeeId: 'emp', now: NOW }))
  assert.throws(() => decide(chain, { actor: P('hh'), approve: true, now: NOW }), /waiting on the HR Manager/)
  chain = decide(chain, { actor: P('hm'), approve: true, now: NOW })
  let a = advance(chain); assert.equal(a.current, 1)
  assert.throws(() => decide(a.chain, { actor: P('hh'), approve: false, now: NOW }), /reason for rejecting/)
  const rejected = decide(a.chain, { actor: P('hh'), approve: false, note: 'Not yet', now: NOW })
  assert.equal(rejected[1].status, 'REJECTED'); assert.equal(advance(rejected).current, null)
  chain = decide(a.chain, { actor: P('hh'), approve: true, now: NOW }); a = advance(chain)
  chain = decide(a.chain, { actor: P('md'), approve: true, now: NOW })
  assert.equal(advance(chain).done, true)
})

test('one person on two steps approves once', () => {
  const holders = { HR_MANAGER: [P('rn')], HR_HEAD: [P('rn')] }
  let { chain, current } = advance(buildChain('ABSCOND', { holders, initiator: P('rj'), initiatorRoles: ['RECRUITER'], employeeId: 'emp', now: NOW }), NOW)
  assert.equal(current, 0)
  chain = decide(chain, { actor: P('rn'), approve: true, now: NOW })
  const a = advance(chain, NOW)
  assert.equal(a.done, true); assert.equal(a.chain[1].status, 'APPROVED'); assert.match(a.chain[1].note!, /earlier step/)
})

test('the route guards before writing and takes effect only on the last approval', () => {
  const src = readFileSync('app/api/ess/exit-employee/route.ts', 'utf8')
  const insert = src.indexOf(".from('hr_exit_requests').insert(")
  for (const g of ["forbidden('Only the HR team and Hiring Managers can exit an employee.')", 'startProblems(x', "forbidden('This employee belongs to another company.')", 'already has an exit', 'already has a resignation in progress']) {
    const i = src.indexOf(g); assert.ok(i !== -1 && i < insert, g)
  }
  assert.ok(/if \(done\) \{\s*applied = await applyExit/.test(src), 'started fully approved → applied')
  assert.ok(/if \(status === 'APPROVED'\) \{\s*applied = await applyExit/.test(src), 'last approval → applied')
  assert.ok(/\.eq\('status', 'PENDING'\)\.eq\('current_step', row\.current_step\)/.test(src), 'two approvers cannot both act')
})

test('the Exit button lives on the employee detail; the ESS checkbox is gone; approvals are in Tasks & Approvals', () => {
  assert.ok(/<HrExitButton /.test(readFileSync('app/dashboard/employees/page.tsx', 'utf8')))
  const ess = readFileSync('components/ess/hris/ExitProcess.tsx', 'utf8')
  assert.ok(!/Exit an employee/.test(ess) && !/HrExitPanel/.test(ess))
  assert.ok(/<HrExitApprovals /.test(readFileSync('components/ess/hris/TasksApprovals.tsx', 'utf8')))
})
