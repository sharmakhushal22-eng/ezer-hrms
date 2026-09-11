import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  atLeast, higher, moduleForPath, roleCodeForExcelName, normaliseRoleName, MODULES, ROUTE_MODULE,
} from '../modules.ts'

describe('access levels', () => {
  test('are ordered, not just compared for equality', () => {
    assert.equal(atLeast('FULL', 'VIEW'), true)
    assert.equal(atLeast('EDIT', 'VIEW'), true)
    assert.equal(atLeast('VIEW', 'EDIT'), false)
    assert.equal(atLeast('NONE', 'VIEW'), false)
  })

  test('treat a missing level as NONE rather than throwing', () => {
    assert.equal(atLeast(undefined, 'VIEW'), false)
    assert.equal(atLeast(null, 'VIEW'), false)
    assert.equal(atLeast(undefined, 'NONE'), true)
  })

  test('higher() picks the wider of two, which is how several roles combine', () => {
    assert.equal(higher('VIEW', 'FULL'), 'FULL')
    assert.equal(higher('EDIT', 'VIEW'), 'EDIT')
    assert.equal(higher('NONE', 'NONE'), 'NONE')
  })
})

describe('moduleForPath', () => {
  test('maps a dashboard section to its module', () => {
    assert.equal(moduleForPath('/dashboard/payroll'), 'Payroll')
    assert.equal(moduleForPath('/dashboard/employees'), 'Employees')
  })

  test('a sub-path stays inside its section', () => {
    assert.equal(moduleForPath('/dashboard/payroll/flexi-approval'), 'Payroll')
  })

  test('the longest prefix wins, so attendance-reports is not swallowed by attendance', () => {
    assert.equal(moduleForPath('/dashboard/attendance'), 'Attendance')
    assert.equal(moduleForPath('/dashboard/attendance-reports'), 'Attendance Reports')
  })

  test('the dashboard landing page belongs to no module', () => {
    assert.equal(moduleForPath('/dashboard'), null)
    assert.equal(moduleForPath('/dashboard/'), null)
    assert.equal(moduleForPath(null), null)
  })

  test('pages that are not in the sidebar are still mapped — hiding a menu item never gated them', () => {
    assert.equal(moduleForPath('/dashboard/ess-credentials'), 'ESS & Roles')
    assert.equal(moduleForPath('/dashboard/roles'), 'ESS & Roles')
    assert.equal(moduleForPath('/dashboard/holidays'), 'Holidays')
    assert.equal(moduleForPath('/dashboard/investment-proofs'), 'Payroll')
    assert.equal(moduleForPath('/dashboard/statutory-leave'), 'Leave Config')
    assert.equal(moduleForPath('/dashboard/flexi-invoices'), 'Flexi Claims')
  })

  test('an unknown path resolves to no module rather than to some module', () => {
    assert.equal(moduleForPath('/dashboard/something-new'), null)
  })

  test('every mapped module is one that actually exists', () => {
    for (const m of Object.values(ROUTE_MODULE)) {
      assert.ok((MODULES as readonly string[]).includes(m), `${m} is not in MODULES`)
    }
  })
})

describe('spreadsheet role names', () => {
  test('normalising ignores case, spacing and punctuation', () => {
    assert.equal(normaliseRoleName('  HR   Head '), 'hr head')
    assert.equal(normaliseRoleName('Payroll-Manager'), 'payroll manager')
  })

  test('the six roles the app already had are recognised', () => {
    assert.equal(roleCodeForExcelName('HR Manager'), 'HR_MANAGER')
    assert.equal(roleCodeForExcelName('HR Head'), 'HR_HEAD')
    assert.equal(roleCodeForExcelName('Payroll manager'), 'PAYROLL')
    assert.equal(roleCodeForExcelName('Admin Manager'), 'ADMIN_COMPANY')
    assert.equal(roleCodeForExcelName('IT Manager'), 'IT')
    assert.equal(roleCodeForExcelName('Branch HR Executive'), 'BRANCH_HR')
  })

  test('Finance Executive maps to the role migration 058 adds', () => {
    assert.equal(roleCodeForExcelName('Finance Executive'), 'FINANCE_EXECUTIVE')
  })

  test('a name the application does not know returns null instead of a guess', () => {
    assert.equal(roleCodeForExcelName('Chief Vibes Officer'), null)
    assert.equal(roleCodeForExcelName(''), null)
  })
})
