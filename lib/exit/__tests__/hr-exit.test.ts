// lib/exit/__tests__/hr-exit.test.ts — who may exit another employee from ESS, and what it needs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { canExitOthers, exitProblems, EXIT_ROLES } from '../hr-exit.ts'

test('the hiring and HR roles may exit others; everyone else may not', () => {
  for (const r of ['RECRUITER', 'HR_EXECUTIVE', 'BRANCH_HR', 'HR_MANAGER', 'HR_HEAD', 'CHRO', 'hr_head']) assert.ok(canExitOthers([r], false), r)
  for (const r of ['EMPLOYEE', 'L1_MANAGER', 'HOD', 'PAYROLL']) assert.equal(canExitOthers([r], false), false, r)
  assert.ok(canExitOthers([], true), 'super admin')
  assert.equal(EXIT_ROLES.length, 6)
})

test('reason, employee, date are required; nobody exits themself', () => {
  const o = { self: 'me', reasons: ['TERMINATION', 'OTHER'] }
  assert.deepEqual(exitProblems({ employeeId: 'e1', reasonCode: 'TERMINATION', dateOfExit: '2026-11-30' }, o), [])
  const p = exitProblems({}, o)
  assert.ok(p.some(x => x.startsWith('Pick the employee')) && p.some(x => x.startsWith('Pick the reason')) && p.some(x => x.startsWith('Enter the date')))
  assert.ok(exitProblems({ employeeId: 'me', reasonCode: 'OTHER', dateOfExit: '2026-11-30' }, o)[0].startsWith('You cannot exit yourself'))
  assert.ok(exitProblems({ employeeId: 'e1', reasonCode: 'NOPE', dateOfExit: '2026-11-30' }, o)[0].includes('not in the exit reasons'))
  assert.ok(exitProblems({ employeeId: 'e1', reasonCode: 'OTHER', dateOfExit: '30/11/2026' }, o)[0].startsWith('Enter the date'))
})

test('the route checks the role, the company and an open exit before writing', () => {
  const src = readFileSync('app/api/ess/exit-employee/route.ts', 'utf8')
  const write = src.indexOf(".from('employee_resignation').insert(")
  for (const guard of ['canExitOthers', "forbidden('This employee belongs to another company.')", 'already has an exit in progress', 'exitProblems(x']) {
    const i = src.indexOf(guard)
    assert.ok(i !== -1 && (guard === 'canExitOthers' || i < write), guard)
  }
})
