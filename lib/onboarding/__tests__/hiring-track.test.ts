import { test } from 'node:test'
import assert from 'node:assert/strict'
import { trackOf, trackFlags, requiredDocCodes, frroDueDate, immigrationExpiries, isSsaCountry, dueForReminder } from '../hiring-track.ts'

test('an unknown or blank track is domestic — today\'s flow', () => {
  assert.equal(trackOf(undefined), 'DOMESTIC'); assert.equal(trackOf('x'), 'DOMESTIC'); assert.equal(trackOf('OVERSEAS'), 'OVERSEAS')
  assert.deepEqual(trackFlags('DOMESTIC'), { indianStatutory: true, needsAadhaar: true, needsPan: true, indianBank: true, immigration: false, overseas: false, indianPayroll: true })
})

test('a foreign national in India: no Aadhaar, passport + visa, still Indian statutory and payroll', () => {
  const f = trackFlags('FOREIGN_IN_INDIA')
  assert.equal(f.needsAadhaar, false); assert.equal(f.immigration, true); assert.equal(f.indianStatutory, true); assert.equal(f.indianPayroll, true)
  assert.deepEqual(requiredDocCodes('FOREIGN_IN_INDIA', { esic: true }), ['PAN', 'PHOTO', 'DEGREE', 'BANK_PROOF', 'FAMILY_PHOTO', 'PASSPORT', 'VISA'])
})

test('an overseas employee: no Indian statutory, no PAN, passport only, outside the Indian payroll', () => {
  const f = trackFlags('OVERSEAS')
  assert.equal(f.indianStatutory, false); assert.equal(f.indianBank, false); assert.equal(f.indianPayroll, false)
  assert.deepEqual(requiredDocCodes('OVERSEAS', { esic: true }), ['PHOTO', 'DEGREE', 'BANK_PROOF', 'PASSPORT'])
  assert.deepEqual(requiredDocCodes('DOMESTIC'), ['AADHAAR_FRONT', 'AADHAAR_BACK', 'PAN', 'PHOTO', 'DEGREE', 'BANK_PROOF'])
})

test('FRRO is due 14 days after arrival; the expiry list is sorted by days left and drops FRRO once done', () => {
  assert.equal(frroDueDate('2026-10-01'), '2026-10-15'); assert.equal(frroDueDate(''), null)
  const now = new Date('2026-10-19T09:00:00Z')
  const x = immigrationExpiries({ passport_expiry: '2028-01-01', visa_expiry: '2026-11-18', frro_due_date: '2026-10-19', work_permit_expiry: null }, now)
  assert.deepEqual(x.map(i => [i.kind, i.days_left]), [['frro', 0], ['visa', 30], ['passport', 439]])
  assert.deepEqual(immigrationExpiries({ frro_due_date: '2026-10-19', frro_date: '2026-10-10' }, now), [], 'registered — nothing due')
  assert.equal(dueForReminder(30), true); assert.equal(dueForReminder(31), false)
})

test('SSA countries are matched by name, case-insensitively', () => {
  assert.equal(isSsaCountry('germany'), true); assert.equal(isSsaCountry('United States'), false)
})
