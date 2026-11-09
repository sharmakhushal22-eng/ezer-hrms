// lib/rms/__tests__/company-scope.test.ts — a role's company scope (ess_user_roles.company_ids,
// migration 203): which companies each module's screens may show and pick.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveGrant, companyFilter, scopedCompanies, allowedCompanies, type RoleRef } from '../resolve.ts'

const role = (id: string, code: string, scope?: string): RoleRef => ({ id, role_code: code, role_name: code, ...(scope ? { scope } : {}) } as RoleRef)
const OWN = 'stc', SRS = 'srs', SSM = 'ssm'

function grant(roleCompanies: Record<string, string[] | null>, extra: RoleRef[] = []) {
  const roles = [role('r-pay', 'PAYROLL_ADMIN'), role('r-hod', 'HOD'), role('r-emp', 'EMPLOYEE'), ...extra]
  return resolveGrant({
    employeeId: 'e1', companyId: OWN, roles,
    permissions: [
      { role_id: 'r-pay', module: 'Payroll', access_level: 'FULL' },
      { role_id: 'r-hod', module: 'Recruitment', access_level: 'EDIT' },
      { role_id: 'r-emp', module: 'Company Profile', access_level: 'VIEW' },
    ],
    approvals: [], roleCompanies, enforced: true,
  })
}

test('no scope stored: everything stays in the own company, as before', () => {
  const g = grant({})
  assert.deepEqual(g.companyIds, [OWN])
  assert.deepEqual(g.companiesByModule.Payroll, [OWN])
  assert.equal(companyFilter(g, SRS, 'Payroll'), OWN, 'another company is refused back to the own one')
  assert.equal(companyFilter(g, 'ALL', 'Payroll'), OWN)
})

test('a role scoped to more companies opens its modules there, and only its modules', () => {
  const g = grant({ 'r-pay': [OWN, SRS] })
  assert.deepEqual(g.companyIds.sort(), [OWN, SRS].sort())
  assert.deepEqual(g.companiesByModule.Payroll.sort(), [OWN, SRS].sort())
  assert.equal(companyFilter(g, SRS, 'Payroll'), SRS, 'Payroll may pick SRS')
  assert.equal(companyFilter(g, SSM, 'Payroll'), OWN, 'but not a company outside the scope')
  // Recruitment comes from HOD, which never leaves the own company.
  assert.equal(companyFilter(g, SRS, 'Recruitment'), OWN, 'HOD’s module does not inherit Payroll’s scope')
  const cos = [{ id: OWN }, { id: SRS }, { id: SSM }]
  assert.deepEqual(scopedCompanies(g, cos, 'Payroll').map(c => c.id), [OWN, SRS])
  assert.deepEqual(scopedCompanies(g, cos, 'Recruitment').map(c => c.id), [OWN])
})

test('the manager roles and EMPLOYEE are own-company whatever is stored', () => {
  const g = grant({ 'r-hod': [SRS, SSM], 'r-emp': [SRS] })
  assert.deepEqual(g.companiesByModule.Recruitment, [OWN])
  assert.deepEqual(g.companiesByModule['Company Profile'], [OWN])
  assert.deepEqual(g.companyIds, [OWN])
})

test('without a module, any company one of the roles is valid in', () => {
  const g = grant({ 'r-pay': [SRS] })
  assert.deepEqual(allowedCompanies(g, null).sort(), [OWN, SRS].sort())
  assert.equal(companyFilter(g, SRS), SRS)
})

test('a cross-company role still sees everything', () => {
  const g = grant({}, [role('r-sup', 'ADMIN_SUPER')])
  assert.equal(companyFilter(g, SSM, 'Payroll'), SSM)
  assert.equal(companyFilter(g, 'ALL', 'Payroll'), null)
  assert.equal(scopedCompanies(g, [{ id: OWN }, { id: SSM }], 'Payroll').length, 2)
})
