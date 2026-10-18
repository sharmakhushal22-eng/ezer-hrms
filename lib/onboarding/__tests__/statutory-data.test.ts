import { test } from 'node:test'
import assert from 'node:assert/strict'
import { statutoryData, maritalWord, ddmmyyyy, ageOf } from '../statutory-data.ts'

const oc = {
  full_name: 'Arjun Mehra', email: 'a@x.in', mobile: '9811000111', date_of_joining: '2026-10-23', submitted_at: '2026-10-16T10:00:00Z', employee_code: 'SSM0042', esic_applicable: false,
  form_data: {
    step_3: { full_name: 'Arjun Mehra', dob: '1996-04-12', gender: 'Male', father_name: 'Ramesh Mehra', marital_status: 'Married', nationality: 'Indian', country: 'India' },
    step_4: { mobile: '9811000111', personal_email: 'arjun@x.in', perm_line1: 'Mehra House, 14 MG Road', perm_village: 'Sector 21', perm_po: 'Sector 21 PO', perm_thana: 'Sector 20 PS', perm_city: 'Gurugram', perm_state: 'Haryana', perm_pin: '122016', same_address: true },
    step_5: { is_fresher: false, prev_employers: [{ company: 'Bluestone', to: '2026-09-26' }] },
    step_7: {
      pan_number: 'abcpm1234k', has_uan: true, uan_number: '100123456789', prev_pf_id: 'DSNHP00123450000012345', bank_account: '502112345678', bank_ifsc: 'HDFC0000123',
      pf_nominees: [{ name: 'Neha Mehra', relation: 'Spouse', dob: '1997-08-02', share: '60', address: 'Gurugram' }, { name: 'Ramesh Mehra', relation: 'Father', dob: '1965-03-14', share: '40', address: 'Gurugram' }],
      grat_nominees: [{ name: 'Neha Mehra', relation: 'Spouse', dob: '1997-08-02', share: '100', address: 'Gurugram' }],
      eps_family: [{ name: 'Neha Mehra', address: 'Gurugram', dob: '1997-08-02', relation: 'Spouse' }], eps_fallback: { name: 'Sunita Mehra', relation: 'Mother', address: 'Gurugram', dob: '1969-07-19' },
      insurance: { spouse_name: 'Neha Mehra', spouse_dob: '1997-08-02', spouse_residing: 'Yes', father_name: 'Ramesh Mehra', father_dob: '1965-03-14', father_residing: 'No', mother_name: 'Sunita Mehra', mother_dob: '1969-07-19', mother_residing: 'Yes' },
      esic_details: { prev_ip: '', dispensary: 'ESIC Dispensary Sector 9' },
    },
  },
}
const company = { company_name: 'Sharma Sons Manufacturing Pvt Ltd', reg_office: 'Plot 12 Sector 5 Dwarka New Delhi 110075', epf_code: 'DSNHP0012345000', esic_code: '11001234560001001' }

test('the forms are filled from the onboarding record', () => {
  const d = statutoryData({ oc, company, aadhaar: '1234 5678 9012' })
  assert.equal(d.name, 'Arjun Mehra')
  assert.deepEqual(d.parent, { kind: 'Father', name: 'Ramesh Mehra' })
  assert.equal(d.dob, '12/04/1996')
  assert.equal(d.marital, 'Married')
  assert.equal(d.has_uan, true); assert.equal(d.uan, '100123456789'); assert.equal(d.prev_exit, '26/09/2026')
  assert.equal(d.pan, 'ABCPM1234K'); assert.equal(d.aadhaar, '1234 5678 9012')
  assert.equal(d.doj, '23/10/2026'); assert.equal(d.emp_code, 'SSM0042')
  assert.equal(d.epf_code, 'DSNHP0012345000'); assert.equal(d.esic_code, '11001234560001001')
  assert.match(d.perm_address, /^Mehra House, 14 MG Road, Sector 21, PO Sector 21 PO, PS Sector 20 PS, Gurugram, Haryana, 122016$/)
  assert.equal(d.curr_address, d.perm_address, 'same-as-permanent copies the permanent address')
  assert.equal(d.curr_pin, '122016')
  assert.equal(d.pf_nominees.length, 2); assert.equal(d.pf_nominees[0].share, '60%'); assert.equal(d.pf_nominees[0].dob, '02/08/1997')
  assert.equal(d.eps_fallback?.relation, 'Mother')
  assert.equal(d.grat_nominees.length, 1); assert.equal(d.grat_nominees[0].age, '29'); assert.equal(d.grat_nominees[0].share, '100%')
  assert.equal(d.perm_parts.thana, 'Sector 20 PS'); assert.equal(d.perm_parts.state, 'Haryana'); assert.equal(d.designation, '')
  assert.equal(d.family.length, 3)
  assert.deepEqual(d.family.map(f => f.relation), ['Wife', 'Father', 'Mother'])
  assert.equal(d.family[1].residing, false); assert.equal(d.family[1].town, 'Gurugram')
  assert.equal(d.esic_nominee?.name, 'Neha Mehra')
  assert.equal(d.date, '16/10/2026'); assert.equal(d.place, 'Gurugram')
  assert.equal(d.is_foreign, false); assert.equal(d.country, 'India')
})

test('a married woman signs with her husband as the parent line, and a fresher has no previous PF', () => {
  const d = statutoryData({ oc: { ...oc, form_data: { ...oc.form_data, step_3: { ...oc.form_data.step_3, gender: 'Female' }, step_7: { ...oc.form_data.step_7, has_uan: false, uan_number: '' } } }, company })
  assert.deepEqual(d.parent, { kind: 'Spouse', name: 'Neha Mehra' })
  assert.equal(d.has_uan, false); assert.equal(d.prev_exit, '')
  assert.equal(d.family[0].relation, 'Husband')
})

test('legacy flat nominee fields still print, and a blank record does not throw', () => {
  const d = statutoryData({ oc: { form_data: { step_7: { nominee_name: 'Kh', nominee_relation: 'Spouse', nominee_share: '100%' } } } })
  assert.equal(d.pf_nominees.length, 1); assert.equal(d.pf_nominees[0].share, '100%')
  const e = statutoryData({ oc: {} })
  assert.equal(e.name, ''); assert.equal(e.pf_nominees.length, 0); assert.equal(e.family.length, 0); assert.equal(e.esic_nominee, null)
})

test('wording helpers', () => {
  assert.equal(maritalWord('Single'), 'Unmarried'); assert.equal(maritalWord('Widowed'), 'Widow'); assert.equal(maritalWord('Divorced'), 'Divorce'); assert.equal(maritalWord(''), '')
  assert.equal(ddmmyyyy('2026-10-16T10:00:00Z'), '16/10/2026'); assert.equal(ddmmyyyy('12 Jan 2020'), '12 Jan 2020')
  assert.equal(ageOf('1997-08-02', new Date('2026-08-01')), '28'); assert.equal(ageOf('1997-08-02', new Date('2026-08-02')), '29'); assert.equal(ageOf('', new Date()), '')
})
