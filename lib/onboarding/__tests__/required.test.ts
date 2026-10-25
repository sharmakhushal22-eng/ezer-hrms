import { test } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
// The module imports its siblings extensionless (hiring-track) — see lib/test-support.
register('../../test-support/alias-hooks.mjs', import.meta.url)
const { missingFor, missingFields, describeMissing } = await import('../required.ts')

const good = {
  step_3: { full_name: 'Asha Rao', dob: '1995-04-12', gender: 'Female', father_name: 'R Rao', blood_group: 'O+', marital_status: 'Single', nationality: 'Indian' },
  step_4: { mobile: '9876543210', personal_email: 'asha@example.com', perm_line1: '12 MG Road', perm_city: 'Pune', perm_state: 'Maharashtra', perm_pin: '411001', same_address: true },
  step_5: { emrg1_name: 'R Rao', emrg1_relation: 'Father', emrg1_mobile: '9876500000', is_fresher: false, prev_employers: [{ company: 'Acme' }], education: [{ qualification: 'B.Com' }] },
  step_7: { pan_number: 'ABCDE1234F', acc_holder: 'Asha Rao', bank_name: 'HDFC', bank_account: '50100123456789', bank_ifsc: 'HDFC0001234', has_uan: true, uan_number: '100200300400', pf_nominees: [{ name: 'R Rao', relation: 'Father' }] },
}

test('a complete form has nothing missing', () => {
  assert.deepEqual(missingFields(good), [])
})

test('blanks are named step by step, and a bad value says what is wrong', () => {
  const m = missingFields({ ...good, step_3: { ...good.step_3, dob: '', gender: '' }, step_4: { ...good.step_4, perm_pin: '41', personal_email: 'asha' } })
  assert.deepEqual(m.map(x => x.key), ['dob', 'gender', 'personal_email', 'perm_pin'])
  assert.equal(m[0].message, 'Date of birth is required')
  assert.match(m[2].message, /valid email/)
  assert.match(m[3].message, /6-digit PIN/)
  assert.equal(describeMissing(m), 'Personal details: Date of birth, Gender · Contact & address: Email, Permanent address PIN / postal code')
})

test('the current address is needed unless it is the same as the permanent one', () => {
  assert.deepEqual(missingFor(4, { ...good.step_4, same_address: false }).map(x => x.key), ['curr_line1', 'curr_city', 'curr_state', 'curr_pin'])
  assert.deepEqual(missingFor(4, { ...good.step_4, same_address: false, curr_line1: 'x', curr_city: 'y', curr_state: 'z', curr_pin: '560001' }), [])
})

test('a fresher needs no previous employer; everybody needs a qualification, an emergency contact with a real mobile', () => {
  assert.deepEqual(missingFor(5, { ...good.step_5, is_fresher: true, prev_employers: [] }), [])
  assert.deepEqual(missingFor(5, { ...good.step_5, prev_employers: [], prev_company: 'Old Co' }), [], 'the legacy flat field counts')
  const m = missingFor(5, { ...good.step_5, prev_employers: [{ company: '' }], education: [], emrg1_mobile: '12345' })
  assert.deepEqual(m.map(x => x.key), ['emrg1_mobile', 'prev_employers', 'education'])
})

test('PAN, IFSC, account and UAN formats; the UAN only when they say they have one; one PF nominee', () => {
  const m = missingFor(7, { ...good.step_7, pan_number: 'abcde1234', bank_ifsc: 'HDFC1234', bank_account: '12', has_uan: true, uan_number: '', pf_nominees: [] })
  assert.deepEqual(m.map(x => x.key), ['pan_number', 'bank_account', 'bank_ifsc', 'uan_number', 'pf_nominees'])
  assert.deepEqual(missingFor(7, { ...good.step_7, has_uan: false, uan_number: '', pf_nominees: [], nominee_name: 'R', nominee_relation: 'Father' }), [])
  assert.deepEqual(missingFor(7, { ...good.step_7, pan_number: 'abcde1234f' }), [], 'case does not matter')
})

test('a foreign national in India: passport, visa, arrival and residency are required; PAN may be applied for', () => {
  const m = missingFields(good, { track: 'FOREIGN_IN_INDIA' })
  assert.deepEqual(m.map(x => x.key), ['fe_passport_number', 'fe_passport_country', 'fe_passport_expiry', 'fe_visa_type', 'fe_visa_number', 'fe_visa_expiry', 'fe_india_entry_date', 'fe_tax_residency'])
  const ok = { ...good.step_7, pan_number: '', pan_applied: true, fe_passport_number: 'X1', fe_passport_country: 'Germany', fe_passport_expiry: '2031-01-01', fe_visa_type: 'Employment', fe_visa_number: 'V1', fe_visa_expiry: '2028-01-01', fe_india_entry_date: '2026-10-01', fe_tax_residency: 'Non-Resident' }
  assert.deepEqual(missingFor(7, ok, { track: 'FOREIGN_IN_INDIA' }), [], 'PAN applied for is accepted')
  assert.deepEqual(missingFor(7, { ...ok, fe_ssa_exempt: true }, { track: 'FOREIGN_IN_INDIA' }).map(x => x.key), ['fe_ssa_country'], 'an SSA exemption names the country')
  assert.match(missingFor(7, { ...ok, fe_visa_expiry: '2020-01-01' }, { track: 'FOREIGN_IN_INDIA' })[0].message, /already passed/)
})

test('an overseas employee: no PAN, IFSC or PF nominee; IBAN, SWIFT, bank country, passport and home address instead; any phone', () => {
  const m = missingFields(good, { track: 'OVERSEAS' })
  assert.deepEqual(m.map(x => x.key), ['bank_iban', 'bank_swift', 'bank_country', 'fe_passport_number', 'fe_passport_country', 'fe_passport_expiry', 'fe_overseas_line', 'fe_overseas_city', 'fe_overseas_country'])
  assert.deepEqual(missingFor(4, { ...good.step_4, mobile: '+44 7700 900123', perm_pin: 'SW1A 1AA' }, { track: 'OVERSEAS' }), [], 'a UK number and postcode pass')
  assert.deepEqual(missingFor(7, { acc_holder: 'A', bank_name: 'B', bank_iban: 'GB33BUKB20201555555555', bank_swift: 'BUKBGB22', bank_country: 'UK', fe_passport_number: 'P', fe_passport_country: 'UK', fe_passport_expiry: '2031-01-01', fe_overseas_line: '1 St', fe_overseas_city: 'London', fe_overseas_country: 'UK' }, { track: 'OVERSEAS' }), [])
  assert.equal(missingFields({ ...good, hiring_track: 'OVERSEAS' }).length, 9, 'the track can ride on form_data itself')
})

test('a date of birth that makes the joiner a child, or 100 years old, is refused', () => {
  assert.match(missingFor(3, { ...good.step_3, dob: '2020-01-01' })[0].message, /at least 16/)
  assert.match(missingFor(3, { ...good.step_3, dob: '1900-01-01' })[0].message, /does not look right/)
})
