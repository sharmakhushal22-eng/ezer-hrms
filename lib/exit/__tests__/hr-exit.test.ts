// lib/exit/__tests__/hr-exit.test.ts — an exit the company starts: who may, what it needs, the
// approval chain it walks, and the screens it lives on.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { canExitOthers, EXIT_ROLES, HR_EXIT_REASONS, STAGE_ORDER, startProblems, suggestedLwd, buildChain, advance, act, actionsFor, proposedLwd, waitingOn, type Person } from '../hr-exit.ts'

const P = (id: string, code = id.toUpperCase()): Person => ({ id, emp_code: code, full_name: `Name ${id}` })
const NOW = '2026-10-28T10:00:00.000Z'

test('the hiring and HR roles may exit others; everyone else may not', () => {
  for (const r of ['RECRUITER', 'HR_EXECUTIVE', 'BRANCH_HR', 'HR_MANAGER', 'HR_HEAD', 'CHRO', 'hr_head']) assert.ok(canExitOthers([r], false), r)
  for (const r of ['EMPLOYEE', 'L1_MANAGER', 'HOD', 'PAYROLL']) assert.equal(canExitOthers([r], false), false, r)
  assert.ok(canExitOthers([], true), 'super admin')
  assert.equal(EXIT_ROLES.length, 6)
})

test('the company reasons; every one walks the resignation chain', () => {
  assert.deepEqual(HR_EXIT_REASONS.map(r => r.code), ['ABSCOND', 'FRAUD', 'LAYOFF', 'TERMINATION', 'DISCONTINUE', 'TRANSFER', 'DEATH'])
  assert.ok(HR_EXIT_REASONS.every(r => r.subReasons.length > 0))
  // The same four stages, in the same order, as 071's fn_resignation_advance.
  assert.deepEqual(STAGE_ORDER, ['RM_L1', 'RM_L2', 'HOD', 'HR_MANAGER'])
  const sql = readFileSync('supabase/migrations/071_ess_access_reconciliation.sql', 'utf8')
  assert.ok(sql.includes("stages TEXT[] := ARRAY['RM_L1','RM_L2','HOD','HR_MANAGER']"), 'the resignation chain is still these four stages')
})

test('a transfer needs another company', () => {
  const ok = { employeeId: 'e1', reasonCode: 'TRANSFER', subReason: 'Different Company Same Group', lwd: '2026-11-30', remarks: 'Moving to the group company.', sourceCompanyId: 'A' }
  assert.ok(startProblems(ok, { self: 'me' })[0].startsWith('Pick the company'))
  assert.ok(startProblems({ ...ok, destinationCompanyId: 'A' }, { self: 'me' })[0].startsWith('A transfer goes to another company'))
  assert.deepEqual(startProblems({ ...ok, destinationCompanyId: 'B' }, { self: 'me' }), [])
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

const appr = { RM_L1: P('l1'), RM_L2: P('l2'), HOD: P('hod'), HR_MANAGER: P('hr') }

test('the chain: one approver per stage from the employee’s record; skips as a resignation’s', () => {
  const chain = buildChain({ approvers: { ...appr, RM_L2: null, HOD: P('emp') }, initiator: P('rec'), employeeId: 'emp', now: NOW })
  assert.deepEqual(chain.map(s => s.status), ['WAITING', 'SKIPPED', 'SKIPPED', 'WAITING'])
  assert.equal(chain[1].note, 'No approver resolved'); assert.equal(chain[2].note, 'Resolves to the employee being exited')
  const a = advance(chain)
  assert.equal(a.current, 0); assert.ok(waitingOn(a.chain, 'l1')); assert.ok(!waitingOn(a.chain, 'hr'))
})

test('the initiator’s own manager stage is done by starting it, never the HR Manager’s', () => {
  const asL1 = buildChain({ approvers: appr, initiator: P('l1'), employeeId: 'emp', now: NOW })
  assert.equal(asL1[0].status, 'APPROVED'); assert.equal(asL1[0].action, 'STARTED')
  const asHr = buildChain({ approvers: appr, initiator: P('hr'), employeeId: 'emp', now: NOW })
  assert.equal(asHr[3].status, 'WAITING', 'the HR Manager still sets the final LWD')
})

test('managers acknowledge / accept with a date / request retention; HR sets the final LWD', () => {
  let { chain } = advance(buildChain({ approvers: appr, initiator: P('rec'), employeeId: 'emp', now: NOW }))
  assert.deepEqual(actionsFor(chain[0]), ['ACKNOWLEDGED', 'ACCEPTED_WITH_DATE', 'REQUESTED_RETENTION'])
  assert.throws(() => act(chain, { actor: P('l2'), action: 'ACKNOWLEDGED', now: NOW }), /waiting on the Reporting Manager/)
  assert.throws(() => act(chain, { actor: P('l1'), action: 'FINAL_LWD_SET', lwd: '2026-11-30', now: NOW }), /Only the HR Manager stage sets/)
  chain = advance(act(chain, { actor: P('l1'), action: 'Acknowledge & forward', now: NOW }).chain).chain   // the label works too
  assert.throws(() => act(chain, { actor: P('l2'), action: 'ACCEPTED_WITH_DATE', now: NOW }), /Enter the last working day you accept/)
  chain = advance(act(chain, { actor: P('l2'), action: 'ACCEPTED_WITH_DATE', lwd: '2026-12-15', now: NOW }).chain).chain
  assert.equal(proposedLwd(chain), '2026-12-15')
  // Retention: the stage holds until its approver resumes it.
  const held = act(chain, { actor: P('hod'), action: 'REQUESTED_RETENTION', note: 'Key person', now: NOW })
  assert.equal(held.hold, true); assert.equal(held.chain[2].status, 'HOLD'); assert.deepEqual(actionsFor(held.chain[2]), ['RESUMED'])
  assert.equal(advance(held.chain).current, 2, 'a hold does not move the chain')
  assert.throws(() => act(held.chain, { actor: P('hod'), action: 'ACKNOWLEDGED', now: NOW }), /retention hold/)
  chain = act(held.chain, { actor: P('hod'), action: 'RESUMED', now: NOW }).chain
  chain = advance(act(chain, { actor: P('hod'), action: 'ACKNOWLEDGED', now: NOW }).chain).chain
  assert.deepEqual(actionsFor(chain[3]), ['FINAL_LWD_SET'])
  const fin = act(chain, { actor: P('hr'), action: 'FINAL_LWD_SET', lwd: '2026-12-10', now: NOW })
  assert.equal(fin.finalLwd, '2026-12-10'); assert.equal(advance(fin.chain).done, true)
})

test('a manager who already acted is skipped at a later stage; the HR Manager never is', () => {
  let { chain, current } = advance(buildChain({ approvers: { RM_L1: P('m'), RM_L2: P('m'), HOD: P('m'), HR_MANAGER: P('m') }, initiator: P('rec'), employeeId: 'emp', now: NOW }), NOW)
  assert.equal(current, 0)
  const a = advance(act(chain, { actor: P('m'), action: 'ACKNOWLEDGED', now: NOW }).chain, NOW)
  assert.deepEqual(a.chain.map(s => s.status), ['APPROVED', 'SKIPPED', 'SKIPPED', 'PENDING'])
  assert.match(a.chain[1].note!, /Already acted at an earlier stage/)
})

test('the route guards before writing and takes effect only on the last approval', () => {
  const src = readFileSync('app/api/ess/exit-employee/route.ts', 'utf8')
  const insert = src.indexOf(".from('hr_exit_requests').insert(")
  for (const g of ["forbidden('Only the HR team and Hiring Managers can exit an employee.')", 'startProblems({ ...x', "forbidden('This employee belongs to another company.')", 'already has an exit', 'already has a resignation in progress']) {
    const i = src.indexOf(g); assert.ok(i !== -1 && i < insert, g)
  }
  assert.ok(/if \(done\) \{\s*applied = await applyCompanyExit/.test(src), 'started with nobody to act → applied')
  assert.ok(/if \(done\) applied = await applyCompanyExit\(sb as any, upd\[0\], actor\)/.test(src), 'final LWD set → applied')
  assert.ok(/fn_resignation_stage_approver/.test(src) && /ess_effective_approver/.test(src), 'approvers resolve as a resignation’s do')
  assert.ok(/abscond \? \{ chain: built, current: null, done: false \}/.test(src), 'abscond waits for the reminders')
  assert.ok(/body\.target_id/.test(src) && !/body\.employee_id/.test(src), 'the target is target_id, never employee_id (lib/ess/asked)')
  assert.ok(/\.eq\('status', 'PENDING'\)\.eq\('current_step', row\.current_step\)/.test(src), 'two approvers cannot both act')
})

test('Exit lives in the employee’s HR Actions in place of Initiate resignation; the ESS checkbox is gone; approvals are in Tasks & Approvals', () => {
  const panel = readFileSync('components/employees/HRActionPanel.tsx', 'utf8')
  assert.ok(/<HrExitSection /.test(panel) && !/>Initiate resignation</.test(panel))
  assert.ok(!/HrExit/.test(readFileSync('app/dashboard/employees/page.tsx', 'utf8')), 'no Exit button on the profile header any more')
  const ess = readFileSync('components/ess/hris/ExitProcess.tsx', 'utf8')
  assert.ok(!/Exit an employee/.test(ess) && !/HrExitPanel/.test(ess))
  assert.ok(/<HrExitApprovals /.test(readFileSync('components/ess/hris/TasksApprovals.tsx', 'utf8')))
})
