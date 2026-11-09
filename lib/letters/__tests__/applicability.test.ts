// lib/letters/__tests__/applicability.test.ts — the appointment letter is for employees only:
// not for NATS / NAPS apprentices, interns, contractors or consultants.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { letterBlockedFor, noAppointmentFor } from '../applicability.ts'

test('apprentices, interns, contractors and consultants get no appointment letter', () => {
  for (const t of ['NATS', 'NAPS', 'Intern', 'Internship', 'Trainee', 'Contract', 'Consultant', ' contract ', 'Fixed Term', 'Freelancer'])
    assert.ok(letterBlockedFor('APT', t), t)
  assert.equal(noAppointmentFor('NAPS'), 'NAPS apprentice')
})

test('employees (and an unknown type) keep it, and other letters are never blocked', () => {
  for (const t of ['Employee', 'Permanent', '', null, undefined]) assert.equal(letterBlockedFor('APT', t), null, String(t))
  for (const code of ['OFR', 'EXP', 'REL', 'WRN']) assert.equal(letterBlockedFor(code, 'Consultant'), null, code)
})
