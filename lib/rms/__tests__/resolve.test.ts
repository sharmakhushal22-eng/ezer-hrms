import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveGrant, emptyGrant, canSee, canEdit, canManage, hasAdminAccess,
  canApprove, canAdministerRoles, visibleModules, type RoleRef,
} from '../resolve.ts'

const role = (id: string, code: string): RoleRef => ({ id, role_code: code, role_name: code })

const PAYROLL = role('r-pay', 'PAYROLL')
const RECRUITER = role('r-rec', 'RECRUITER')
const EMPLOYEE = role('r-emp', 'EMPLOYEE')
const HR_HEAD = role('r-hrh', 'HR_HEAD')
const SUPER = role('r-sup', 'ADMIN_SUPER')

const perms = [
  { role_id: 'r-pay', module: 'Payroll', access_level: 'FULL' as const },
  { role_id: 'r-pay', module: 'Compliance', access_level: 'VIEW' as const },
  { role_id: 'r-rec', module: 'Recruitment', access_level: 'FULL' as const },
  { role_id: 'r-rec', module: 'Employees', access_level: 'VIEW' as const },
  { role_id: 'r-hrh', module: 'Employees', access_level: 'FULL' as const },
  { role_id: 'r-emp', module: 'Payroll', access_level: 'NONE' as const },
]

const grantFor = (roles: RoleRef[], extra: Partial<Parameters<typeof resolveGrant>[0]> = {}) =>
  resolveGrant({ employeeId: 'e1', roles, permissions: perms, approvals: [], enforced: true, ...extra })

describe('functional permissions', () => {
  test('an employee with Payroll can open Payroll', () => {
    const g = grantFor([PAYROLL])
    assert.equal(canSee(g, 'Payroll'), true)
    assert.equal(canManage(g, 'Payroll'), true)
  })

  test('an employee without Payroll cannot open Payroll', () => {
    const g = grantFor([RECRUITER])
    assert.equal(canSee(g, 'Payroll'), false)
  })

  test('Recruitment works on its own, independently of Payroll', () => {
    const g = grantFor([RECRUITER])
    assert.equal(canSee(g, 'Recruitment'), true)
    assert.equal(canSee(g, 'Payroll'), false)
  })

  test('several roles combine, and the widest level wins', () => {
    const g = grantFor([RECRUITER, HR_HEAD])
    assert.equal(g.modules['Employees'], 'FULL')   // VIEW from recruiter, FULL from HR head
    assert.equal(canManage(g, 'Employees'), true)
    assert.equal(canSee(g, 'Recruitment'), true)
  })

  test('a level below what is needed is refused', () => {
    const g = grantFor([PAYROLL])
    assert.equal(canSee(g, 'Compliance'), true)
    assert.equal(canEdit(g, 'Compliance'), false)
  })

  test('an explicit NONE grants nothing', () => {
    const g = grantFor([EMPLOYEE])
    assert.equal(canSee(g, 'Payroll'), false)
    assert.deepEqual(visibleModules(g), [])
  })

  test('permissions belonging to roles the person does not hold are ignored', () => {
    const g = grantFor([RECRUITER])
    assert.equal(g.modules['Payroll'], undefined)
  })
})

describe('super admin', () => {
  test('is a floor, so an empty permission table cannot lock the last administrator out', () => {
    const g = resolveGrant({ employeeId: 'e1', roles: [SUPER], permissions: [], approvals: [], enforced: true })
    assert.equal(g.isSuperAdmin, true)
    assert.equal(canManage(g, 'Payroll'), true)
    assert.equal(canManage(g, 'ESS & Roles'), true)
  })
})

describe('enforcement switch', () => {
  test('while it is off, the sidebar behaves as it did before roles existed', () => {
    const g = grantFor([EMPLOYEE], { enforced: false })
    assert.equal(canSee(g, 'Payroll'), true)
    assert.equal(canEdit(g, 'Payroll'), true)
  })

  test('with it on, the same person is refused', () => {
    const g = grantFor([EMPLOYEE], { enforced: true })
    assert.equal(canSee(g, 'Payroll'), false)
  })
})

describe('who belongs in the dashboard', () => {
  test('somebody holding a module does', () => {
    assert.equal(hasAdminAccess(grantFor([PAYROLL])), true)
  })

  test('an ordinary employee does not', () => {
    assert.equal(hasAdminAccess(grantFor([EMPLOYEE])), false)
  })

  test('nobody signed in does not', () => {
    assert.equal(hasAdminAccess(emptyGrant()), false)
  })
})

describe('approval rights are separate from module access', () => {
  const approvals = [
    { role_id: 'r-hrh', approval_type: 'HIRING_MRF', can_approve: true, can_reject: true, can_initiate: false },
    { role_id: 'r-rec', approval_type: 'HIRING_MRF', can_approve: false, can_reject: false, can_initiate: true },
  ]

  test('a right from any held role is usable', () => {
    const g = resolveGrant({ employeeId: 'e1', roles: [HR_HEAD], permissions: perms, approvals, enforced: true })
    assert.equal(canApprove(g, 'HIRING_MRF'), true)
  })

  test('the union is taken across roles rather than the last one winning', () => {
    const g = resolveGrant({ employeeId: 'e1', roles: [HR_HEAD, RECRUITER], permissions: perms, approvals, enforced: true })
    const r = g.approvals.find(a => a.approval_type === 'HIRING_MRF')!
    assert.equal(r.can_approve, true)
    assert.equal(r.can_initiate, true)
  })

  test('a role without the right cannot approve', () => {
    const g = resolveGrant({ employeeId: 'e1', roles: [PAYROLL], permissions: perms, approvals, enforced: true })
    assert.equal(canApprove(g, 'HIRING_MRF'), false)
  })
})

describe('the rule that keeps hierarchy and permission apart', () => {
  test('resolution never reads relationships — managing people grants nothing', () => {
    // Somebody who is an L1 manager for half the company but holds only EMPLOYEE.
    const g = grantFor([EMPLOYEE])
    assert.equal(canSee(g, 'Payroll'), false)
    assert.equal(canSee(g, 'Employees'), false)
    assert.equal(hasAdminAccess(g), false)
  })

  test('and holding Payroll does not make somebody a manager — the grant carries no reports', () => {
    const g = grantFor([PAYROLL])
    assert.equal('reports' in g, false)
    assert.equal('managers' in g, false)
  })
})

describe('administering roles', () => {
  test('is limited to the short list', () => {
    assert.equal(canAdministerRoles(grantFor([HR_HEAD])), true)
    assert.equal(canAdministerRoles(grantFor([SUPER])), true)
    assert.equal(canAdministerRoles(grantFor([PAYROLL])), false)
    assert.equal(canAdministerRoles(grantFor([EMPLOYEE])), false)
  })
})
