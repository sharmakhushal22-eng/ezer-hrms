import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CHECKLISTS, HEAD_TEAMS, missingItems, normaliseChecklist, checklistColumns, summariseChecklist, confirmationsOnly } from '../checklists.ts'

test('every head team has a checklist with at least one required item', () => {
  for (const t of HEAD_TEAMS) assert.ok(CHECKLISTS[t].fields.some(f => f.required), t)
})

test('IT cannot approve until the email, laptop and access are confirmed — ticks only, never a typed detail', () => {
  assert.deepEqual(missingItems('IT', {}), ['Email ID is created', 'Laptop is ready', 'System access set up (HRMS, tools, VPN)'])
  assert.deepEqual(missingItems('IT', { it_email_created: true, it_laptop_issued: true, it_access_done: true }), [], 'the email address itself is a fact HR keeps, not a head\'s input')
  assert.deepEqual(missingItems('IT', { it_email_created: 'true', it_laptop_issued: true, it_access_done: true }), ['Email ID is created'], 'a string true is not a confirmation')
  for (const t of HEAD_TEAMS) assert.ok(CHECKLISTS[t].fields.every(f => !f.required || f.kind === 'bool'), `${t}: only yes/no items may be required`)
})

test('Payroll only confirms the structure is entered; the CTC and basic % are facts from the breakdown', () => {
  assert.deepEqual(missingItems('PAYROLL', { annual_ctc: 0, basic_pct: '40', payroll_setup_done: true }), [])
  assert.deepEqual(missingItems('PAYROLL', { annual_ctc: '900000' }), ['Salary structure entered in payroll'])
})

test('confirmationsOnly keeps the ticks and drops every typed detail', () => {
  assert.deepEqual(confirmationsOnly('PAYROLL', { annual_ctc: 1, pf_applicable: true, payroll_setup_done: false, pt_state: 'X', hacker: true }), { pf_applicable: true, payroll_setup_done: false })
  assert.deepEqual(confirmationsOnly('IT', null), {})
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
