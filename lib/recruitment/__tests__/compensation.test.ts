// lib/recruitment/__tests__/compensation.test.ts — the annual/monthly rule.
//
// budget_min/budget_max are quoted in the engagement's OWN period, while an
// offer's offered_ctc is always annual. Every comparison between the two has to
// normalise first, and there are now two callers that must agree: the MRF
// form's Quick Hire / Full MRF lane check, and the HR Head's over-ceiling tile.
//
// The rule worth pinning is the false-positive one. A monthly-paid requisition
// compared without normalising reads as over-budget on almost any real offer —
// a red flag on the screen where someone signs off real money. So the tests
// below care less about the happy path than about the two ways this goes wrong:
// a monthly ceiling treated as annual, and a missing ceiling treated as zero.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { COMPENSATION, compOf, annualCeiling, overCeiling } from '../compensation.ts'

describe('compOf', () => {
  test('defaults to Employee for unknown or missing types', () => {
    assert.equal(compOf(undefined).period, 'ANNUAL')
    assert.equal(compOf('').period, 'ANNUAL')
    assert.equal(compOf('Nonsense').label, 'Salary')
    assert.equal(compOf(undefined), COMPENSATION['Employee'])
  })

  test('trainees and contractors are not quoted as salary', () => {
    assert.equal(compOf('Intern').kind, 'STIPEND')
    assert.equal(compOf('Contract').kind, 'FEES')
    assert.equal(compOf('Consultant').kind, 'FEES')
    assert.equal(compOf('Employee').kind, 'SALARY')
  })

  test('only Employee is quoted annually', () => {
    const monthly = Object.entries(COMPENSATION).filter(([, c]) => c.period === 'MONTHLY').map(([k]) => k)
    // .sort() is alphabetical, so Consultant precedes Contract.
    assert.deepEqual(monthly.sort(), ['Consultant', 'Contract', 'Intern', 'Live Project', 'NAPS', 'NATS'])
    assert.equal(COMPENSATION['Employee'].period, 'ANNUAL')
  })

  test('fixed-term engagements are the ones that need a duration', () => {
    assert.equal(compOf('Intern').fixedTerm, true)
    assert.equal(compOf('Contract').fixedTerm, true)
    // A consultant engagement runs open-ended, like an employee.
    assert.equal(compOf('Consultant').fixedTerm, false)
    assert.equal(compOf('Employee').fixedTerm, false)
  })
})

describe('annualCeiling', () => {
  test('an annual budget is already annual', () => {
    assert.equal(annualCeiling(1200000, 'Employee'), 1200000)
  })

  test('a monthly budget is multiplied by twelve', () => {
    // 25,000/mo is a 3L-a-year internship, not a 25,000 one.
    assert.equal(annualCeiling(25000, 'Intern'), 300000)
    assert.equal(annualCeiling(120000, 'Contract'), 1440000)
  })

  test('no ceiling recorded returns 0, not a falsely tiny one', () => {
    assert.equal(annualCeiling(null, 'Employee'), 0)
    assert.equal(annualCeiling(undefined, 'Intern'), 0)
    assert.equal(annualCeiling(0, 'Employee'), 0)
  })

  test('an unknown employment type is treated as annual, like Employee', () => {
    assert.equal(annualCeiling(900000, 'Nonsense'), 900000)
    assert.equal(annualCeiling(900000, undefined), 900000)
  })
})

describe('overCeiling', () => {
  test('flags an offer above an annual ceiling', () => {
    assert.equal(overCeiling(1300000, 1200000, 'Employee'), true)
  })

  test('does not flag an offer at or below the ceiling', () => {
    assert.equal(overCeiling(1200000, 1200000, 'Employee'), false)
    assert.equal(overCeiling(1100000, 1200000, 'Employee'), false)
  })

  test('THE REGRESSION THIS EXISTS FOR: a monthly ceiling is not compared raw', () => {
    // A 25,000/mo internship with a 3L annual offer is exactly on budget.
    // Comparing 300000 against the raw 25000 would call it 12x over.
    assert.equal(overCeiling(300000, 25000, 'Intern'), false)
    assert.equal(overCeiling(301000, 25000, 'Intern'), true)
  })

  test('an unknown budget is not an exceeded one', () => {
    assert.equal(overCeiling(5000000, null, 'Employee'), false)
    assert.equal(overCeiling(5000000, undefined, 'Intern'), false)
    assert.equal(overCeiling(5000000, 0, 'Employee'), false)
  })

  test('a missing offer figure never flags', () => {
    assert.equal(overCeiling(null, 1200000, 'Employee'), false)
    assert.equal(overCeiling(undefined, 1200000, 'Employee'), false)
  })
})
