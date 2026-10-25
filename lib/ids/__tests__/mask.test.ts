// lib/ids/__tests__/mask.test.ts — the onChange masks for PAN, Aadhaar and phone numbers.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { maskPan, maskAadhaar, maskMobile, maskIntlPhone, maskUan, isPan, isAadhaar } from '../mask.ts'

test('PAN: upper-case, 10 characters, letters and digits only where they belong', () => {
  assert.equal(maskPan('abcde1234f'), 'ABCDE1234F')
  assert.equal(maskPan('ABCDE1234FXYZ'), 'ABCDE1234F')
  assert.equal(maskPan('AB-CD E12.34F'), 'ABCDE1234F')
  assert.equal(maskPan('12345'), '')          // digits cannot start a PAN
  assert.equal(maskPan('ABCDEF1234G'), 'ABCDE1234G')   // the 6th letter is dropped
  assert.ok(isPan(maskPan('abcde1234f')))
})

test('Aadhaar: 12 digits only, optionally grouped', () => {
  assert.equal(maskAadhaar('1234-5678-9012-99'), '123456789012')
  assert.equal(maskAadhaar('1234abcd5678 9012', true), '1234 5678 9012')
  assert.equal(maskAadhaar('12345', true), '1234 5')
  assert.ok(isAadhaar('1234 5678 9012'))
})

test('Mobile: 10 digits; a pasted +91 or 0 is dropped', () => {
  assert.equal(maskMobile('+91 98765 43210'), '9876543210')
  assert.equal(maskMobile('09876543210'), '9876543210')
  assert.equal(maskMobile('98765432109999'), '9876543210')
  assert.equal(maskMobile('98a76'), '9876')
})

test('International phone and UAN', () => {
  assert.equal(maskIntlPhone('+44 20 7946 0958'), '+442079460958')
  assert.equal(maskIntlPhone('1234567890123456789'), '123456789012345')
  assert.equal(maskUan('1001-2345-6789-0'), '100123456789')
})
