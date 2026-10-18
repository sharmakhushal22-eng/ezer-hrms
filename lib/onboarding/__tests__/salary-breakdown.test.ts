import { test } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
// salary-breakdown.ts imports the CTC model through the app's `@/` alias — see lib/test-support.
register('../../test-support/alias-hooks.mjs', import.meta.url)
const { computeCtc } = await import('../../recruitment/ctc-model.ts')
const { buildBreakdown, stipendBreakdown, offerLetterBreakdown, computedBreakdown, rebuildFor } = await import('../salary-breakdown.ts')

const saved = { ...(computeCtc({ ctcAnnual: 900000, variableAnnual: 90000, minWage: 15000, state: 'Haryana' }) as any), minWage: 15000, state: 'Haryana', gratuity: 'yes', bonusPct: 0, bonusMode: 'salary' }

test('a saved negotiation is shown as it was saved', () => {
  const b = buildBreakdown(saved, null, 'Negotiation')
  assert.equal(b.source, 'negotiation'); assert.equal(b.annual_ctc, 900000)
  assert.equal(b.basic_monthly, Math.round(saved.basic))
  assert.ok(b.rows.some(r => r.label === 'Basic Salary' && r.monthly === saved.basic))
  assert.ok(b.rows.some(r => r.kind === 'total' && r.annual === 900000))
  assert.ok(b.rows.some(r => r.kind === 'net'))
})

test('a corrected CTC re-runs the model with the same inputs and keeps the variable share', () => {
  const b = buildBreakdown(saved, 1200000)
  assert.equal(b.annual_ctc, 1200000)
  assert.equal(b.calc?.variable, 120000, '10% variable kept')
  assert.ok(b.basic_monthly! > Math.round(saved.basic))
  assert.equal(b.basic_pct, Math.round((b.basic_monthly! * 12 / 1200000) * 1000) / 10)
})

test('a CTC below the statutory minimum is refused with the minimum', () => {
  const b = buildBreakdown(saved, 60000)
  assert.ok(b.too_low && b.too_low.minReqFixedAnn > 60000)
  assert.equal(b.rows.length, 0)
})

test('a stipend negotiation lists the monthly amount, TDS and net', () => {
  const b = stipendBreakdown({ is_stipend: true, pay_kind: 'FEES', pay_label: 'Fees', stipend_monthly: 100000, annual: 1200000, tds_applicable: true, tds_pct: 10, employment_type: 'Consultant' })
  assert.equal(b.source, 'stipend'); assert.equal(b.annual_ctc, 1200000)
  assert.equal(b.rows.find(r => r.kind === 'ded')?.monthly, 10000)
  assert.equal(b.rows.find(r => r.kind === 'net')?.monthly, 90000)
  assert.equal(b.basic_pct, null)
})

test('an offer letter is printed as it was, and the CTC on record is computed with defaults', () => {
  const o = offerLetterBreakdown({ offer_number: 'OFR-7', basic: 30000, hra: 12000, other_allowance: 8000, gross_monthly: 50000, employer_pf: 3000, employer_esic: 0, employee_pf: 3000, professional_tax: 200, net_take_home: 46800, fixed_ctc_monthly: 53000, variable_monthly: 0, final_ctc_monthly: 53000, annual_ctc: 636000 })
  assert.equal(o.source, 'offer_letter'); assert.match(o.label, /OFR-7/); assert.equal(o.basic_pct, 56.6)
  const c = computedBreakdown(600000, 'Karnataka')
  assert.equal(c.source, 'computed'); assert.ok(c.rows.length > 5); assert.equal(c.annual_ctc, 600000)
  const r = rebuildFor(c, 720000)
  assert.equal(r.annual_ctc, 720000); assert.equal(r.source, 'computed')
})
