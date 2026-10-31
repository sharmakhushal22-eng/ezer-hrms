// lib/onboarding/__tests__/appointment-letter.test.ts — the Letter of Appointment: the spec's
// sections in order, the company's joining-bonus terms, Annexure A as the negotiation shows it,
// Annexure B and the amount in words.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildSections, annexureFrom, splitJoiningBonus, apptProblems, apptWarnings, salutationFor, relationFor, benefitsOf, leaveRows, inrWords, type ApptFields } from '../appointment-letter.ts'
import type { StmtRow } from '../../recruitment/ctc-statement.ts'

const base: ApptFields = {
  letter_date: '2026-09-07', ref_no: '', salutation: 'Mr.', name: 'Abhinav Setu', emp_code: 'OFB0001', relation: 'S/o', father_name: 'Ramesh Setu',
  perm_address: '45, MG Road, Jaipur, Rajasthan 302001', company_name: 'OFB Tech Limited', company_address: '123, Sector 44, Gurugram', cin: 'U72200HR2024PTC123456',
  designation: 'Manager', department: 'Finance', grade: 'L5', employment_type: 'Full-time (Permanent)', reporting_manager: 'Nayan Ahuja, CTO', functional_manager: '',
  doj: '2026-09-07', place: 'Gurugram', ctc_annual: 2100000, jb_total: 300000, jb_first: 150000, jb_second: 150000, retention_bonus: 0,
  esop_value: 800000, esop_vesting: '', esi_applicable: false, medical: 'INR 5,00,000/- per annum (Spouse+2 Children)', gratuity_annual: 50505, gratuity_in_ctc: false,
  probation_months: 6, probation_extension_months: 3, probation_notice_days: 30, notice_days: 90, fnf_days: 30,
  working_days: 'Monday to Friday (5-day week)', working_hours: '9:00 AM to 6:00 PM', effective_hours: '8 hours per day', overtime: 'Not applicable.',
  el_days: 15, el_carry_max: 30, cl_days: 8, sl_days: 7, maternity_weeks: 26, paternity_days: 5, bereavement_days: '3-5', marriage_days: 3,
  confidentiality_years: 2, non_compete_months: 12, non_solicit_months: 12, non_compete_region: 'India', gift_limit: 2000, bgv_days: 30,
  jurisdiction: 'Gurugram, Haryana', signatory_name: 'Puja', signatory_designation: 'HR Head', witness_name: '', witness_designation: '',
}
const body = (f: ApptFields, key: string) => buildSections(f).find(s => s.key === key)!.body

test('every section of the spec, in its order', () => {
  const headed = buildSections(base).filter(s => s.heading && !s.key.startsWith('annex')).map(s => s.heading)
  assert.deepEqual(headed, ['Position & Reporting', 'Probation', 'Compensation (CTC)', 'Working Hours & Days', 'Leave Policy', 'Notice Period & Termination',
    'Recovery of Joining Costs', 'Code of Conduct', 'Confidentiality & Non-Disclosure', 'Non-Compete & Non-Solicitation', 'Intellectual Property Rights',
    'Statutory Benefits', 'Company Policies', 'Grievance Mechanism', 'Background Verification', 'Medical Fitness', 'Governing Law & Jurisdiction'])
  assert.ok(buildSections(base).some(s => s.key === 'annex_c'))
})

test('the details land in the letter', () => {
  assert.match(body(base, 'intro'), /appoint you as “Manager” in the “Finance” department of OFB Tech Limited\. Your employment will commence from 07 September 2026\. Your Employee Code is OFB0001\./)
  assert.match(body(base, 'position'), /Grade \/ Level \/ Band: L5/)
  assert.match(body(base, 'position'), /Reporting Manager: Nayan Ahuja, CTO/)
  assert.doesNotMatch(body(base, 'position'), /dotted-line/)
  assert.match(body(base, 'probation'), /6 months[\s\S]*further 3 months/)
  assert.match(body(base, 'termination'), /30 days or 1 month’ salary in lieu[\s\S]*90 days or 3 months’ salary/)
  assert.match(body(base, 'governing_law'), /courts in Gurugram, Haryana/)
  assert.match(body(base, 'leave'), /15 days per year[\s\S]*maximum of 30 days/)
  assert.match(body(base, 'confidentiality'), /2 years after separation/)
  assert.match(body(base, 'declaration'), /employment with OFB Tech Limited is subject/)
})

test('the CTC in figures and in words', () => {
  assert.match(body(base, 'compensation'), /INR 21,00,000 \(Rupees Twenty One Lakh Only\)/)
  assert.equal(inrWords(1200000), 'Rupees Twelve Lakh Only')
  assert.equal(inrWords(1523450), 'Rupees Fifteen Lakh Twenty Three Thousand Four Hundred Fifty Only')
  assert.equal(inrWords(25000000), 'Rupees Two Crore Fifty Lakh Only')
})

test('a two-instalment joining bonus carries the three recovery terms, as on the letter', () => {
  const c = body(base, 'compensation')
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

test('Annexure A is the negotiation statement line for line, grouped, with deductions, net and one-time payments', () => {
  // The candidate's statement for a 15 L offer with 1 L variable (linkStatementRows' shape).
  const link: { rows: StmtRow[] } = { rows: [
    { kind: 'row', label: 'Basic Salary', monthly: 58333.33, annual: 700000 },
    { kind: 'row', label: 'House Rent Allowance (HRA)', monthly: 23333.33, annual: 280000 },
    { kind: 'row', label: 'Conveyance Allowance', monthly: 1600, annual: 19200 },
    { kind: 'row', label: 'Special Allowance', monthly: 25816.67, annual: 309800 },
    { kind: 'sum', label: 'Gross Earnings (A)', monthly: 109083.33, annual: 1309000 },
    { kind: 'emp', label: 'Employer EPF', monthly: 7583.33, annual: 91000 },
    { kind: 'sum', label: 'Fixed CTC Package', monthly: 116666.67, annual: 1400000 },
    { kind: 'muted', label: 'Variable / Performance CTC', monthly: 8333.33, annual: 100000 },
    { kind: 'total', label: 'Total Annual CTC Package', monthly: 125000, annual: 1500000 },
    { kind: 'head', label: 'Employee deductions & net in-hand' },
    { kind: 'sum', label: 'Gross Earnings (A)', monthly: 109083.33, annual: 1309000 },
    { kind: 'ded', label: '(−) Employee PF', monthly: 7000, annual: 84000 },
    { kind: 'net', label: 'Net In-Hand Salary', monthly: 102083.33, annual: 1225000 },
    { kind: 'note', label: 'Net in-hand is shown before income tax (TDS).' },
  ] }
  const { annexure } = annexureFrom(link.rows, [['Joining bonus (With Salary)', 100000]])
  const lines = annexure.map(r => `${r.kind}:${r.label}=${r.monthly}`)
  // Every money line of the negotiation is there with the same monthly figure.
  for (const r of link.rows.filter(x => x.kind !== 'note' && x.kind !== 'head')) {
    if (!(Number(r.monthly) || Number(r.annual))) continue
    assert.ok(annexure.some(a => Math.round(Number(r.monthly) || 0) === a.monthly), `${r.label} ${r.monthly}`)
  }
  assert.deepEqual(annexure.filter(r => r.kind === 'head').map(r => r.label),
    ['EARNINGS', 'EMPLOYER CONTRIBUTIONS', 'PERFORMANCE LINKED', 'EMPLOYEE DEDUCTIONS & NET IN-HAND', 'ONE-TIME PAYMENTS (OUTSIDE THE CTC)'])
  assert.ok(lines.includes('total:TOTAL CTC=125000'), lines.join(' | '))
  assert.ok(annexure.some(r => r.kind === 'net' && /Net In-Hand/.test(r.label)))
  assert.ok(annexure.some(r => r.kind === 'ded' && r.label === 'Less: Employee PF'))
  assert.deepEqual(annexure.at(-1), { label: 'Joining bonus (With Salary)', monthly: 0, annual: 100000, kind: 'extra' })
})

test('Annexure A from the recruiter statement keeps gratuity in the CTC', () => {
  const { annexure, gratuityInCtc, gratuityAnnual } = annexureFrom([
    { kind: 'row', label: 'Basic Salary', monthly: 87500, annual: 1050000 },
    { kind: 'sum', label: 'Gross Earnings (A)', monthly: 173200, annual: 2078400 },
    { kind: 'emp', label: 'Employer EPF', monthly: 1800, annual: 21600 },
    { kind: 'emp', label: 'Employer ESIC', monthly: 0, annual: 0 },
    { kind: 'grat', label: 'Gratuity', monthly: 4209, annual: 50505 },
    { kind: 'sum', label: 'Fixed CTC Package', monthly: 175000, annual: 2100000 },
    { kind: 'muted', label: 'Variable / Performance CTC', monthly: 0, annual: 0 },
    { kind: 'total', label: 'Total Annual CTC Package', monthly: 175000, annual: 2100000 },
  ])
  assert.equal(gratuityInCtc, true); assert.equal(gratuityAnnual, 50505)
  assert.ok(!annexure.some(r => /ESIC|Variable/.test(r.label)), 'zero lines are left out')
  assert.ok(annexure.some(r => r.label === 'Fixed CTC (B)' && r.bold))
})

test('gratuity wording, benefits and the leave annexure', () => {
  assert.match(body(base, 'annex_note'), /over and above the CTC/)
  assert.match(body({ ...base, gratuity_in_ctc: true }, 'annex_note'), /included in the CTC/)
  assert.deepEqual(benefitsOf(base).map(b => b[0]), ['Medical Policy', 'Gratuity'])
  const l = leaveRows(base)
  assert.equal(l.length, 8)
  assert.equal(l[0].days, '15'); assert.equal(l[0].carry, 'Max 30 days'); assert.equal(l[3].days, '26 weeks')
})

test('what blocks sending, and what is only flagged', () => {
  assert.deepEqual(apptProblems(base), [])
  assert.deepEqual(apptProblems({ ...base, place: ' ', ctc_annual: 0 }), ['the place of posting', 'the annual CTC'])
  assert.deepEqual(apptProblems({ ...base, jb_second: 100000 }), ['joining bonus instalments that add up to the total'])
  assert.deepEqual(apptWarnings(base), [])
  assert.deepEqual(apptWarnings({ ...base, father_name: '', grade: ' ' }), ["the father's / husband's name", 'the grade / band'])
  assert.equal(salutationFor('Female'), 'Ms.'); assert.equal(salutationFor('Male'), 'Mr.'); assert.equal(salutationFor(null), 'Mr.')
  assert.equal(relationFor('Female'), 'D/o'); assert.equal(relationFor('Male'), 'S/o')
})
