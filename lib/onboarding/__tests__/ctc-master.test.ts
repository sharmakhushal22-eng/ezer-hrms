// lib/onboarding/__tests__/ctc-master.test.ts — a joiner's payroll CTC row from their salary
// statement: the financial year and the figures payroll and ESS Flexi read.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fyOf, ctcFigures } from '../ctc-figures.ts'

test('the financial year a joining date falls in', () => {
  assert.equal(fyOf('2026-10-23'), '2026-27')
  assert.equal(fyOf('2026-04-01'), '2026-27')
  assert.equal(fyOf('2027-03-31'), '2026-27')
  assert.equal(fyOf('2026-03-31'), '2025-26')
})

test('CTC, variable, basic and HRA from the negotiation statement', () => {
  const fig = ctcFigures([
    { kind: 'row', label: 'Basic Salary', monthly: 58333.33, annual: 700000 },
    { kind: 'row', label: 'House Rent Allowance (HRA)', monthly: 23333.33, annual: 280000 },
    { kind: 'row', label: 'Special Allowance', monthly: 25816.67, annual: 309800 },
    { kind: 'sum', label: 'Gross Earnings (A)', monthly: 109083.33, annual: 1309000 },
    { kind: 'muted', label: 'Variable / Performance CTC', monthly: 8333.33, annual: 100000 },
    { kind: 'total', label: 'Total Annual CTC Package', monthly: 125000, annual: 1500000 },
    { kind: 'head', label: 'Employee deductions & net in-hand' },
    { kind: 'ded', label: '(−) Employee PF', monthly: 7000, annual: 84000 },
  ], 1500000)
  assert.deepEqual(fig, { annual_ctc: 1500000, annual_variable: 100000, basic_annual: 700000, hra_annual: 280000 })
  assert.deepEqual(ctcFigures([], 900000), { annual_ctc: 900000, annual_variable: 0, basic_annual: 0, hra_annual: 0 })
})
