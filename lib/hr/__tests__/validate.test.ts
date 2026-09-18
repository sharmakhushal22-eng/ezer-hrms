import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fieldError, UPPERCASE } from '../validate.ts'

// An empty field is never an error: HR opens a file before the documents arrive.
test('blank values never raise an error', () => {
  for (const k of ['pan_number', 'ifsc_code', 'aadhaar_input', 'mobile', 'personal_email', 'res_pin'])
    for (const v of ['', null, undefined]) assert.equal(fieldError(k, v), null, `${k} / ${JSON.stringify(v)}`)
})

test('PAN takes the checklist format and nothing else', () => {
  assert.equal(fieldError('pan_number', 'ABCDE1234F'), null)
  assert.equal(fieldError('pan_number', 'abcde1234f'), null)   // case is not a mistake
  for (const bad of ['ABCDE1234', 'ABCD12345F', 'ABCDE12345', '1BCDE1234F', 'ABCDE1234FG'])
    assert.ok(fieldError('pan_number', bad), `${bad} should be rejected`)
})

test('IFSC needs the zero in position five', () => {
  assert.equal(fieldError('ifsc_code', 'HDFC0001234'), null)
  assert.equal(fieldError('ifsc_code', 'hdfc0001234'), null)
  for (const bad of ['HDFC1001234', 'HDF00001234', 'HDFC000123'])
    assert.ok(fieldError('ifsc_code', bad), `${bad} should be rejected`)
})

test('Aadhaar and UAN are twelve digits', () => {
  for (const k of ['aadhaar_input', 'uan_number', 'previous_uan']) {
    assert.equal(fieldError(k, '123456789012'), null)
    assert.ok(fieldError(k, '12345678901'))
    assert.ok(fieldError(k, '1234 5678 9012'))   // spaces are how people paste it
  }
})

test('mobile is ten digits starting 6-9', () => {
  for (const k of ['mobile', 'alternate_mobile', 'emergency_mobile', 'reference1_mobile']) {
    assert.equal(fieldError(k, '9876543210'), null)
    assert.ok(fieldError(k, '1234567890'), 'must not start with 1')
    assert.ok(fieldError(k, '+919876543210'), 'country code belongs elsewhere')
    assert.ok(fieldError(k, '98765 43210'))
  }
})

test('email wants the shape, not a DNS lookup', () => {
  assert.equal(fieldError('personal_email', 'a.b@example.co.in'), null)
  for (const bad of ['plainword', 'a@b', 'a b@c.com', '@example.com'])
    assert.ok(fieldError('personal_email', bad), `${bad} should be rejected`)
})

test('PIN is six digits and cannot open with zero', () => {
  assert.equal(fieldError('res_pin', '110001'), null)
  assert.ok(fieldError('res_pin', '011000'))
  assert.ok(fieldError('perm_pin', '11000'))
})

test('date of birth is sanity-checked, not pattern-matched', () => {
  assert.equal(fieldError('date_of_birth', '1990-05-14'), null)
  assert.ok(fieldError('date_of_birth', '2099-01-01'), 'future')
  assert.ok(fieldError('date_of_birth', '2020-01-01'), 'a child')
  assert.ok(fieldError('date_of_birth', '1890-01-01'), 'a typo in the century')
})

test('an unruled field accepts anything', () => {
  assert.equal(fieldError('full_name', "O'Brien-Kumar"), null)
  assert.equal(fieldError('hobbies', 'Reading, Cricket'), null)
})

test('PAN and IFSC are the fields normalised on save', () => {
  assert.deepEqual([...UPPERCASE].sort(), ['ifsc_code', 'pan_number'])
})
