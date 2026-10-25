import { test } from 'node:test'
import assert from 'node:assert/strict'
import { correctionsMail, summarise, docLabel } from '../corrections.ts'

const c = {
  documents: [{ doc_code: 'PAN', label: 'PAN Card', reason: 'blurred — upload a clear scan' }, { doc_code: 'BANK_PROOF', label: 'Cancelled Cheque / Bank Passbook', reason: 'different account holder' }],
  details: [{ section: 'Personal', field: 'Date Of Birth', reason: 'does not match Aadhaar' }],
  note: 'Please finish by Friday.',
}

test('the return mail lists every rejected document and flagged detail with its reason', () => {
  const m = correctionsMail({ name: 'Riya Nair', link: 'https://app.ezerhrms.com/onboarding/tok', validityHours: 48, byTeam: 'The HR Manager' }, c)
  assert.equal(m.subject, 'Corrections needed on your onboarding form (3 items)')
  for (const s of ['Dear Riya Nair', '1. PAN Card — blurred — upload a clear scan', '2. Cancelled Cheque / Bank Passbook — different account holder', 'Details to correct:', '1. Date Of Birth (Personal) — does not match Aadhaar', 'Note from The HR Manager: Please finish by Friday.', 'https://app.ezerhrms.com/onboarding/tok', 'valid for 48 hours'])
    assert.ok(m.text.includes(s), `text lacks "${s}"`)
  assert.ok(m.html.includes('<li>PAN Card — blurred — upload a clear scan</li>'))
  assert.ok(m.html.includes('href="https://app.ezerhrms.com/onboarding/tok"'))
})

test('a plain return (remark only, from a team in ESS) is still a complete mail', () => {
  const m = correctionsMail({ name: 'Aman', link: 'L', validityHours: 48, byTeam: 'The IT team' }, { documents: [], details: [], note: 'Laptop preference missing' })
  assert.equal(m.subject, 'A correction is needed on your onboarding form')
  assert.ok(!m.text.includes('Documents rejected'))
  assert.ok(m.text.includes('Note from The IT team: Laptop preference missing'))
})

test('html escapes what the reviewer typed', () => {
  const m = correctionsMail({ name: 'X', link: 'L', validityHours: 1 }, { documents: [{ doc_code: 'PAN', label: 'PAN Card', reason: '<b>bad</b>' }], details: [] })
  assert.ok(m.html.includes('&lt;b&gt;bad&lt;/b&gt;'))
  assert.ok(m.text.includes('<b>bad</b>'))
})

test('summarise names the documents and fields', () => {
  assert.equal(summarise(c), '2 documents rejected (PAN Card, Cancelled Cheque / Bank Passbook); 1 detail to correct (Date Of Birth); Please finish by Friday.')
  assert.equal(summarise({ documents: [], details: [], note: '' }), 'Corrections requested')
})

test('docLabel knows the portal names and falls back to the code', () => {
  assert.equal(docLabel('AADHAAR_FRONT'), 'Aadhaar Card (Front)')
  assert.equal(docLabel('SOME_NEW_DOC'), 'Some New Doc')
})
