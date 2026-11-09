// lib/rms/__tests__/tds-calculator-access.test.ts — Help → TDS Calculator is role-gated, and the
// calculator's sandbox mode never writes anyone's declaration.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { roleEntryOpen, TDS_CALCULATOR_ROLES, NAV_ENTRY_BY_KEY } from '../nav.ts'

test('the Help entry exists and is opened by the hiring / HR roles only', () => {
  const e = NAV_ENTRY_BY_KEY['tds-calculator']
  assert.ok(e && e.module === null && e.roles === TDS_CALCULATOR_ROLES)
  for (const r of ['RECRUITER', 'HR_EXECUTIVE', 'BRANCH_HR', 'HR_MANAGER', 'HR_HEAD', 'CHRO']) assert.ok(roleEntryOpen(e, [r], false), r)
  for (const r of ['EMPLOYEE', 'L1_MANAGER', 'PAYROLL', 'HOD']) assert.equal(roleEntryOpen(e, [r], false), false, r)
  assert.ok(roleEntryOpen(e, ['EMPLOYEE'], true), 'super admin')
  assert.ok(roleEntryOpen(e, ['employee', 'hr_head'], false), 'role codes are compared upper-case')
})

test('both shells filter role-gated entries by role, not by module', () => {
  assert.ok(/item\.roles\s*\?\s*roleEntryOpen\(item, grant\.roles\.map\(r => r\.role_code\)/.test(readFileSync('app/dashboard/layout.tsx', 'utf8')))
  assert.ok(/i\.roles\s*\?\s*roleEntryOpen\(i, essMenu\.roles\.map\(r => r\.code\)/.test(readFileSync('components/ess/EmployeePortal.tsx', 'utf8')))
})

test('sandbox mode cannot save, submit or restore a declaration', () => {
  const src = readFileSync('components/ess/FlexiTdsCalculator.tsx', 'utf8')
  assert.ok(/async function persistForm[^]*?\n\s*if \(sandbox\) return/.test(src), 'persistForm refuses in sandbox')
  assert.ok(/async function submitRegime\(\) \{\n\s*if \(sandbox\) return/.test(src), 'submitRegime refuses in sandbox')
  assert.ok(/if \(sandbox\) \{[^]*?return\n\s*\}/.test(src), 'no saved form is restored in sandbox')

})

test('the Help page is the Negotiation CTC calculator: no employee lookup, nothing written', () => {
  const page = readFileSync('app/dashboard/tds-calculator/page.tsx', 'utf8')
  assert.ok(/<CtcBreakupCalculator \/>/.test(page), 'the Help page renders CtcBreakupCalculator')
  assert.ok(!/employees|emp_code|EmployeePick/.test(page.replace(/^\s*\/\/.*$/gm, '')), 'no employee code input')
  const calc = readFileSync('components/recruitment/CtcBreakupCalculator.tsx', 'utf8')
  assert.ok(/computeCtc\(/.test(calc) && /ctcStatementRows\(/.test(calc) && /<CtcStatementTable /.test(calc), 'same model, rows and table as Negotiation')
  assert.ok(!/\.(insert|update|upsert|delete|rpc)\(|fetch\(/.test(calc), 'the calculator writes nothing')
})
