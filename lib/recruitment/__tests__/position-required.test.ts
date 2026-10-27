// lib/recruitment/__tests__/position-required.test.ts — designation, department and work location
// are required from the MRF to onboarding (the offer letter states them).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { positionGaps, positionMessage } from '../position-required.ts'

test('gaps are named in letter order; blank and dash count as missing', () => {
  assert.deepEqual(positionGaps({ designation: 'Engineer', department: 'IT', location: 'Jaipur' }), [])
  assert.deepEqual(positionGaps({ designation: ' ', department: null, location: '—' }), ['Designation', 'Department', 'Work location'])
  assert.equal(positionMessage({ designation: 'X', department: 'IT', location: '' }, 'here'), 'Work location is required here.')
  assert.equal(positionMessage({ designation: 'X' }, 'here'), 'Department and Work location are required here.')
  assert.equal(positionMessage({ designation: 'X', department: 'Y', location: 'Z' }, 'here'), null)
})

test('every gate uses the shared rule', () => {
  const src = (p: string) => readFileSync(p, 'utf8')
  const send = src('app/api/recruitment/send-offer-email/route.ts')
  assert.ok(/const pos = positionOf\(d\.rows\)/.test(send) && /positionMessage\(pos,/.test(send), 'send-offer-email refuses a letter without them')
  assert.ok(/positionMessage\(positionOf\(d\.rows\), 'before the file can be verified'\)/.test(src('lib/recruitment/offer-dossier.ts')), 'the offer file cannot be verified without them')
  assert.ok(/positionMessage\(\{ designation, department: meRow\.department_id, location: body\.location_id \}/.test(src('app/api/ess/mrf/route.ts')), 'ESS MRF submit')
  assert.ok(/positionMessage\(\{ designation, department: department_id \|\| department/.test(src('app/api/onboarding/send-magic-link/route.ts')), 'onboarding link')
  assert.ok(/e\.location_id = 'Pick the work location before submitting'/.test(src('app/dashboard/recruitment/page.tsx')), 'dashboard MRF')
  assert.ok(/positionGaps\(\{ designation, department: pos\.department, location: pos\.location \}\)/.test(src('app/dashboard/recruitment/offer-flow-components.tsx')), 'offer approval submit')
})
