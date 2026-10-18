import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CHECKLISTS, HEAD_TEAMS, missingItems, normaliseChecklist, checklistColumns, summariseChecklist } from '../checklists.ts'

test('every head team has a checklist with at least one required item', () => {
  for (const t of HEAD_TEAMS) assert.ok(CHECKLISTS[t].fields.some(f => f.required), t)
})

test('IT cannot approve until the email, laptop and access are confirmed', () => {
  assert.deepEqual(missingItems('IT', {}), ['Official email ID', 'Email ID is created', 'Laptop is ready', 'System access set up (HRMS, tools, VPN)'])
  assert.deepEqual(missingItems('IT', { it_email: 'a@b.in', it_email_created: true, it_laptop_issued: true, it_access_done: true }), [])
  assert.deepEqual(missingItems('IT', { it_email: '  ', it_email_created: 'true', it_laptop_issued: true, it_access_done: true }), ['Official email ID', 'Email ID is created'], 'a blank email and a string true are not confirmations')
})

test('Payroll needs a positive CTC and the structure entered; basic % comes from the breakdown', () => {
  assert.deepEqual(missingItems('PAYROLL', { annual_ctc: 0, basic_pct: '40', payroll_setup_done: true }), ['Annual CTC (₹)'])
  assert.deepEqual(missingItems('PAYROLL', { annual_ctc: '900000', payroll_setup_done: true }), [])
})

test('normalising types the values and drops unknown keys; columns keep only candidate columns', () => {
  const n = normaliseChecklist('PAYROLL', { annual_ctc: '900000', basic_pct: '40', pf_applicable: 'true', pt_state: ' Haryana ', payroll_setup_done: true, hacker: 'x' })
  assert.deepEqual(n, { annual_ctc: 900000, basic_pct: 40, pf_applicable: true, pt_state: 'Haryana', payroll_setup_done: true })
  const c = checklistColumns('PAYROLL', n)
  assert.equal('payroll_setup_done' in c, false, 'payroll_setup_done is not a column')
  assert.equal(c.annual_ctc, 900000)
  assert.deepEqual(checklistColumns('ADMIN', { admin_id_card: true, admin_welcome_kit: true, admin_seating: 'Bay B' }), { admin_id_card: true, admin_seating: 'Bay B' })
})

test('the summary names what was confirmed', () => {
  assert.equal(summariseChecklist('IT', { it_email: 'a@b.in', it_email_created: true, it_laptop_issued: false, it_laptop_tag: '' }), 'Official email ID: a@b.in · Email ID is created')
  assert.equal(summariseChecklist('PAYROLL', { tds_regime: 'NEW' }), 'Tax regime: New regime')
})
