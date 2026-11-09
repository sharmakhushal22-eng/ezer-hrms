// lib/letters/__tests__/catalog.test.ts — People → Letters: the twenty letters of the EZER Letters &
// Documents spec, their fields, ESS visibility, document IDs and wording.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LETTERS, LETTER_BY_CODE, missingFields, docIdFor, serviceText, longDate, money, type Values } from '../catalog.ts'

const SPEC_CODES = ['OFR', 'APT', 'NDA', 'NCA', 'WEL', 'CNF', 'INC', 'PRM', 'TRF', 'WRN', 'SCN', 'PIP', 'BNS', 'DEP', 'RAL', 'TRM', 'REL', 'EXP', 'FNF', 'PFC']

/** A value for every field of a letter: what a filled form would hold. */
function filled(code: string): Values {
  const v: Values = {}
  for (const f of LETTER_BY_CODE[code].fields) {
    v[f.key] = f.type === 'date' ? '2026-11-01' : f.type === 'money' ? '1200000' : f.type === 'number' ? '6'
      : f.type === 'select' ? (f.options || ['x'])[0] : f.key === 'earnings' ? 'Pending salary = 50000\nLeave encashment = 12000'
      : f.key === 'deductions' ? 'Notice shortfall = 8000' : f.key === 'goals' ? 'Close 20 tickets a week\nCSAT above 4.2' : `${f.label} text`
  }
  v.salutation = 'Ms.'; v.name = 'Asha Rao'; v.company_name = 'Sharma Trading Corporation'
  return v
}

test('all twenty letters of the spec, each once, with its code', () => {
  assert.deepEqual(LETTERS.map(l => l.code).sort(), [...SPEC_CODES].sort())
  assert.equal(new Set(LETTERS.map(l => l.name)).size, 20)
})

test('ESS visibility follows the spec: welcome, warning, show cause and PIP stay out', () => {
  const out = LETTERS.filter(l => !l.ess).map(l => l.code).sort()
  assert.deepEqual(out, ['PIP', 'SCN', 'WEL', 'WRN'])
})

test('every letter builds from a filled form, with a subject and content', () => {
  for (const l of LETTERS) {
    const doc = l.build(filled(l.code))
    assert.ok(doc.subject.length > 3, l.code)
    assert.ok(doc.blocks.length >= 2, `${l.code} has content`)
    const text = JSON.stringify(doc.blocks)
    assert.ok(!/undefined|NaN/.test(text), `${l.code} has no undefined / NaN: ${text.slice(0, 200)}`)
    assert.deepEqual(missingFields(l, filled(l.code)), [], `${l.code} complete`)
  }
})

test('every letter names the employee and the company somewhere, or is addressed to them', () => {
  for (const l of LETTERS) {
    const keys = l.fields.map(f => f.key)
    assert.ok(keys.includes('name'), `${l.code} asks for the name`)
    assert.ok(keys.includes('company_name'), `${l.code} asks for the company`)
  }
})

test('a blank required field is reported by its label', () => {
  const v = filled('INC'); v.revised_ctc = ''
  assert.deepEqual(missingFields(LETTER_BY_CODE.INC, v), ['Revised annual CTC'])
})

test('the increment letter works out the rise', () => {
  const v = { ...filled('INC'), previous_ctc: '1000000', revised_ctc: '1150000' }
  const kv = LETTER_BY_CODE.INC.build(v).blocks.find(b => b.t === 'kv') as any
  assert.deepEqual(kv.rows[2], ['Increment', 'INR 1,50,000 (15%)'])
})

test('the F&F statement adds up its lines', () => {
  const doc = LETTER_BY_CODE.FNF.build(filled('FNF'))
  const tables = doc.blocks.filter(b => b.t === 'money') as any[]
  assert.deepEqual(tables[0].total, ['Total earnings', 62000])
  assert.deepEqual(tables[1].total, ['Total deductions', 8000])
  const net = (doc.blocks.filter(b => b.t === 'kv') as any[])[1].rows[0]
  assert.deepEqual(net, ['Net payable', 'INR 54,000'])
})

test('certificates use the right pronouns and the service length', () => {
  const v = { ...filled('EXP'), doj: '2022-04-01', lwd: '2026-10-31' }
  const text = JSON.stringify(LETTER_BY_CODE.EXP.build(v).blocks)
  assert.match(text, /4 years and 6 months/)
  assert.match(text, /she held the position/)
  assert.equal(LETTER_BY_CODE.EXP.build(v).to, 'concern')
})

test('helpers: document ID, dates, money, service', () => {
  assert.equal(docIdFor('APT', 'STC', 'STC9101', '2026-10-31', 1), 'APT-STC-STC9101-20261031-001')
  assert.equal(docIdFor('WRN', 'ez-er', 'emp 001', '2026-12-15', 12), 'WRN-EZER-EMP001-20261215-012')
  assert.equal(longDate('2026-11-01'), '01 November 2026')
  assert.equal(money('1500000'), 'INR 15,00,000')
  assert.equal(serviceText('2026-01-15', '2026-03-10'), '1 month')
  assert.equal(serviceText('2026-01-15', '2026-01-20'), 'less than a month')
  assert.equal(serviceText('2026-05-01', '2026-01-01'), '')
})
