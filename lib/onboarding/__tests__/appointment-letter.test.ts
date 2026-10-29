// lib/onboarding/__tests__/appointment-letter.test.ts — the Letter of Appointment's wording,
// joining-bonus terms and Annexure A.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildSections, annexureFrom, splitJoiningBonus, apptProblems, salutationFor, benefitsOf, type ApptFields } from '../appointment-letter.ts'

const base: ApptFields = {
  salutation: 'Mr.', name: 'Abhinav Setu', emp_code: 'OFB0001', letter_date: '2026-09-07', designation: 'Manager', department: 'Finance',
  company_name: 'OFB Tech Limited', doj: '2026-09-07', place: 'Gurugram', ctc_annual: 2100000, jb_total: 300000, jb_first: 150000, jb_second: 150000,
  esop_value: 800000, esop_vesting: '', probation_notice_days: 30, notice_days: 90, jurisdiction: 'Gurugram',
  medical: 'INR 5,00,000/- per annum (Spouse+2 Children)', gratuity_annual: 50505, gratuity_in_ctc: false,
}
const body = (f: ApptFields, key: string) => buildSections(f).find(s => s.key === key)!.body

test('the details land in the company wording', () => {
  assert.match(body(base, 'designation'), /“Manager” in “Finance” function/)
  assert.match(body(base, 'commencement'), /07 September 2026/)
  assert.match(body(base, 'posting'), /^You will be posted at Gurugram\./)
  assert.match(body(base, 'intro'), /asset to OFB Tech Limited\./)
  assert.match(body(base, 'termination'), /30-day notice period .* 90 Days/)
  assert.match(body(base, 'confidentiality'), /courts in Gurugram/)
  assert.match(body(base, 'declaration'), /employment with OFB Tech Limited is subject/)
})

test('a two-instalment joining bonus carries the three recovery terms, as on the letter', () => {
  const c = body(base, 'compensation')
  assert.match(c, /Total CTC of INR 21,00,000 per year/)
  assert.match(c, /joining bonus of INR 3,00,000/)
  assert.match(c, /first installment of INR 1,50,000 paid to you shall be fully recoverable/)
  assert.match(c, /after completing 12 months but before completing 18 months, only the second installment of INR 1,50,000/)
  assert.match(c, /ESOPs worth INR 8,00,000 .* 4-year vesting with 1 year cliff/)
})

test('one instalment, or none, changes the terms', () => {
  const one = body({ ...base, jb_first: 300000, jb_second: 0 }, 'compensation')
  assert.doesNotMatch(one, /second installment|6 months in the company/)
  assert.match(one, /before completing 12 months, the joining bonus of INR 3,00,000/)
  const later = body({ ...base, jb_first: 0, jb_second: 300000 }, 'compensation')
  assert.doesNotMatch(later, /first month salary/)
  assert.match(later, /before completing 18 months, the joining bonus of INR 3,00,000/)
  const none = body({ ...base, jb_total: 0, jb_first: 0, jb_second: 0, esop_value: 0 }, 'compensation')
  assert.doesNotMatch(none, /joining bonus|ESOP/)
})

test('joining bonus split from the offer’s frequency', () => {
  assert.deepEqual(splitJoiningBonus(300000, 'Two instalments'), { first: 150000, second: 150000 })
  assert.deepEqual(splitJoiningBonus(300000, 'With Salary'), { first: 300000, second: 0 })
  assert.deepEqual(splitJoiningBonus(300000, 'After 6 Months'), { first: 0, second: 300000 })
  assert.deepEqual(splitJoiningBonus(0, 'Two instalments'), { first: 0, second: 0 })
})

test('Annexure A keeps earnings, employer contributions and totals, not deductions', () => {
  const { annexure, gratuityInCtc } = annexureFrom([
    { kind: 'row', label: 'Basic Salary', monthly: 87500, annual: 1050000 },
    { kind: 'row', label: 'House Rent Allowance (HRA)', monthly: 43750, annual: 525000 },
    { kind: 'row', label: 'Special Allowance', monthly: 41950, annual: 503400 },
    { kind: 'sum', label: 'Gross Earnings (A)', monthly: 173200, annual: 2078400 },
    { kind: 'emp', label: 'Employer EPF', monthly: 1800, annual: 21600 },
    { kind: 'emp', label: 'Employer ESIC', monthly: 0, annual: 0 },
    { kind: 'sum', label: 'Fixed CTC Package', monthly: 175000, annual: 2100000 },
    { kind: 'muted', label: 'Variable / Performance CTC', monthly: 0, annual: 0 },
    { kind: 'total', label: 'Total Annual CTC Package', monthly: 175000, annual: 2100000 },
    { kind: 'head', label: 'Employee deductions & net in-hand' },
    { kind: 'ded', label: '(−) Employee PF', monthly: 1800, annual: 21600 },
  ])
  assert.deepEqual(annexure.map(r => r.label), ['Basic Salary', 'House Rent Allowance (HRA)', 'Special Allowance', 'Employer EPF', '*Fixed CTC', 'Total CTC'])
  assert.equal(gratuityInCtc, false)
  assert.ok(annexure.find(r => r.label === 'Total CTC')!.bold)
})

test('gratuity wording follows the structure', () => {
  assert.match(body(base, 'annex_note'), /over and above the Overall CTC/)
  assert.match(body({ ...base, gratuity_in_ctc: true }, 'annex_note'), /included in the CTC/)
  assert.deepEqual(benefitsOf(base).map(b => b[0]), ['Medical Policy', 'Gratuity'])
})

test('what blocks sending', () => {
  assert.deepEqual(apptProblems(base), [])
  assert.deepEqual(apptProblems({ ...base, place: ' ', ctc_annual: 0 }), ['the place of posting', 'the annual CTC'])
  assert.deepEqual(apptProblems({ ...base, jb_second: 100000 }), ['joining bonus instalments that add up to the total'])
  assert.equal(salutationFor('Female'), 'Ms.'); assert.equal(salutationFor('Male'), 'Mr.'); assert.equal(salutationFor(null), 'Mr.')
})
