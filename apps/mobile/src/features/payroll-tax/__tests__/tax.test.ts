// @ts-nocheck — a node:test file (no @types/node in the app; the .ts import is what node --experimental-strip-types needs).
// Checks the extraction in ../tax.ts against cases worked out by hand from the
// logic in components/ess/FlexiTdsCalculator.tsx (lines cited in tax.ts).
//   node --experimental-strip-types --test src/features/payroll-tax/__tests__/tax.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  R, groupIN, getSlab, oldTax, newTax, finalize, hraCalcPeriod, deriveSal, deriveJoin, joinedMidYear,
  oldLimit, newLimit, applyFlexi, hraExemptOf, computeTax, recOf, initialForm, initialChild, c80TotalOf, norm,
  type Form,
} from '../tax.ts'

const form = (patch: Partial<Form>): Form => ({ ...initialForm(), ...patch } as Form)

test('money formatting matches en-IN grouping', () => {
  assert.equal(groupIN(150000), '1,50,000')
  assert.equal(groupIN(1234567), '12,34,567')
  assert.equal(groupIN(999), '999')
  assert.equal(R(120000), '₹1,20,000')
  assert.equal(R(-1234.4), '₹-1,234')
  assert.equal(R(NaN), '₹0')
})

test('slabs use annual CTC in lakhs', () => {
  assert.equal(getSlab(500000), 0)
  assert.equal(getSlab(799000), 1)
  assert.equal(getSlab(1500000), 3)
  assert.equal(getSlab(1800000), 4)
  assert.equal(getSlab(5000000), 8)
})

test('slab tax, rebate, surcharge, cess', () => {
  assert.equal(oldTax(250000), 0)
  assert.equal(oldTax(1406800), 234540)
  assert.equal(newTax(1403400), 90510)
  assert.equal(newTax(800000), 20000)
  assert.equal(finalize(10340, 456800, false), 0)            // 87A old: ≤ ₹5L, rebate up to ₹12,500
  assert.equal(finalize(60000, 1200000, true), 0)            // 87A new: ≤ ₹12L, full rebate
  assert.equal(finalize(1000000, 6e6, false), 1144000)       // 10% surcharge + 4% cess
  assert.equal(finalize(1000000, 6e7, true), 1300000)        // new regime caps surcharge at 25%
  assert.equal(finalize(1000000, 6e7, false), 1424800)       // old regime 37%
})

test('HRA exemption is the least of the three legs, per period', () => {
  assert.equal(hraCalcPeriod(20000, 600000, 25000, 1, 12, true), 240000)
  assert.equal(hraCalcPeriod(20000, 600000, 15000, 1, 12, false), 120000)
  assert.equal(hraCalcPeriod(20000, 600000, 15000, 7, 6, false), 0)
  assert.equal(hraCalcPeriod(20000, 600000, 0, 1, 12, false), 0)
})

test('₹15L CTC, no structure, no declarations → New regime wins', () => {
  const f = form({ ctc: '1500000', variable: '0' })
  const sal = deriveSal(f.ctc, f.variable, null)
  assert.deepEqual(sal, { ctc: 1500000, vari: 0, fixed: 1500000, basic: 750000, hra: 375000, epf: 21600, lta8: 62475, other: 353400, si: 3 })
  const join = deriveJoin('')
  const T = computeTax(sal, join, hraExemptOf(f, sal), f, {}, {})!
  assert.equal(T.c80, 21600)
  assert.equal(T.dO, 93200)          // 50,000 + 80C(EPF) + EPF again (ported as implemented)
  assert.equal(T.tO, 1406800)
  assert.equal(T.fO, 243922)
  assert.equal(T.dN, 96600)
  assert.equal(T.tN, 1403400)
  assert.equal(T.fN, 94130)
  assert.equal(T.moO, 20327)
  assert.equal(T.moN, 7844)
  assert.equal(recOf(T), 'NEW')
  assert.equal(c80TotalOf(f, sal), 21600)
})

test('₹10L CTC → New regime tax is nil under the 87A rebate', () => {
  const f = form({ ctc: '1000000' })
  const sal = deriveSal(f.ctc, f.variable, null)
  const T = computeTax(sal, deriveJoin(''), 0, f, {}, {})!
  assert.equal(T.tN, 903400)
  assert.equal(T.fN, 0)
  assert.equal(T.fO, 97614)
})

test('no CTC → no report', () => {
  const f = form({})
  assert.equal(computeTax(deriveSal('', '', null), deriveJoin(''), 0, f, {}, {}), null)
})

test('real salary structure: wallet is the gross Special Allowance × 12', () => {
  const sal = deriveSal('1200000', '100000', { basic: 40000, hra: 20000, erPf: 1800, special: 15000, specialGross: 25000 })
  assert.equal(sal.basic, 480000)
  assert.equal(sal.hra, 240000)
  assert.equal(sal.epf, 21600)
  assert.equal(sal.other, 300000)
  assert.equal(sal.fixed, 1100000)
})

test('mid-year joining pro-rates income and spreads TDS over remaining months', () => {
  const j = deriveJoin('2026-10-01')
  assert.equal(j.mid, true)
  assert.equal(j.months, 6)
  assert.equal(j.pr, 182 / 365)
  assert.deepEqual(deriveJoin('2026-04-01'), { pr: 1, months: 12, mid: false })
  assert.deepEqual(deriveJoin('2027-04-01'), { pr: 1, months: 12, mid: false })
  assert.equal(deriveJoin('2027-03-31').months, 1)
  assert.equal(joinedMidYear('2026-10-01'), true)
  assert.equal(joinedMidYear('2026-04-01'), false)

  const f = form({ ctc: '1500000' })
  const sal = deriveSal(f.ctc, f.variable, null)
  const T = computeTax(sal, j, 0, f, {}, {})!
  const pr = 182 / 365
  assert.equal(T.eBasic, 750000 * pr)
  assert.equal(T.gN, 1500000 * pr)
  assert.equal(T.moN, Math.round(T.fN / 6))
})

test('flexi limits: LTA, children, car + driver move together', () => {
  const sal = deriveSal('2000000', '0', null)            // slab 4
  assert.equal(sal.si, 4)
  const kids = { count: 2, c1: { school: true, hostel: true }, c2: { school: true, hostel: false } }
  assert.equal(oldLimit(sal, kids, 'lta'), sal.lta8)
  assert.equal(oldLimit(sal, kids, 'childEdu'), 72000)
  assert.equal(oldLimit(sal, kids, 'hostel'), 84000)
  assert.equal(oldLimit(sal, initialChild(), 'childEdu'), 0)
  assert.equal(newLimit(sal, 'pda'), 0)
  const gl = (k: string) => newLimit(sal, k)
  const on = applyFlexi({}, 'car', 216000, gl)
  assert.deepEqual(on, { car: 216000, driver: 144000 })
  assert.deepEqual(applyFlexi(on, 'driver', 0, gl), { car: 0, driver: 0 })
})

test('car perquisite and flexi claims feed both regimes', () => {
  const f = form({ ctc: '2000000' })
  const sal = deriveSal(f.ctc, f.variable, null)
  const T = computeTax(sal, deriveJoin(''), 0, f, { car: 216000, driver: 144000 }, {})!
  assert.equal(T.oPerq, 120000)
  assert.equal(T.nPerq, 0)
  assert.equal(T.oClaim, 360000)
  assert.equal(T.gO, 2000000 + 120000)
})

test('regime normalisation', () => {
  assert.equal(norm('new'), 'NEW')
  assert.equal(norm('NEW_REGIME'), 'NEW')
  assert.equal(norm('Old'), 'OLD')
  assert.equal(norm(null), 'OLD')
})
