// The six offer letters moved from code into Configuration templates. This proves the
// built-in templates produce EXACTLY the wording the code produced (the legacy function is
// kept verbatim in lib/recruitment/__tests__/fixtures/offer-letter-words-legacy.ts), for
// every engagement and for the combinations of optional facts that change the text.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { words, type Facts } from '../../recruitment/__tests__/fixtures/offer-letter-words-legacy.ts'
import { letterFromTemplate, splitSections, parseClauses, validateLetterStructure, sampleFacts, OFFER_LETTER_KEY } from '../offer-letter.ts'
import { systemTemplate } from '../registry.ts'
import { validateTemplate } from '../render.ts'
import type { LetterKind } from '../../recruitment/engagement.ts'

const KINDS: LetterKind[] = ['EMPLOYMENT', 'INTERNSHIP', 'NATS', 'NAPS', 'CONTRACT', 'CONSULTANT']
const tplOf = (k: LetterKind) => systemTemplate(OFFER_LETTER_KEY[k])!

/** The facts that switch wording on and off, in both states. */
function variants(kind: LetterKind): Facts[] {
  const base = sampleFacts(kind) as Facts
  const bare: Facts = { ...base, dept: null, location: null, reportsTo: null, mentor: null, workMode: null, months: null, end: null,
    variable: 0, vPct: 0, tdsPct: 0, govShare: 0, bandLabel: null, bandMin: 0, registration: null, trade: null, qualification: null, institute: null, noticeDays: null }
  return [
    base,
    bare,
    { ...base, tdsPct: 10, noticeDays: 15, mentor: null },
    { ...base, months: 1, end: '2026-11-30', bandMin: base.monthly + 1 },       // below the minimum → no minimum clause
    { ...base, bandLabel: 'Technician apprentice / diploma holder', trade: base.trade ? null : 'Electrician', role: 'Electrician' },
    { ...base, location: null, dept: 'Finance', reportsTo: null },
  ]
}

describe('offer letters: built-in templates = the wording before Configuration', () => {
  for (const kind of KINDS) {
    test(kind, () => {
      for (const f of variants(kind)) {
        const want = words(f)
        const got = letterFromTemplate(tplOf(kind).defaults, f)
        assert.deepEqual(got, want, `${kind} differs for facts ${JSON.stringify({ months: f.months, dept: f.dept, loc: f.location, tds: f.tdsPct, rep: f.reportsTo, mentor: f.mentor, variable: f.variable })}`)
      }
    })
  }
})

describe('offer letter templates are valid', () => {
  for (const kind of KINDS) {
    test(kind, () => {
      const t = tplOf(kind)
      const names = t.variables.map(v => v.name)
      assert.deepEqual(validateTemplate(t.defaults.subject, names, { required: true }), [])
      assert.deepEqual(validateTemplate(t.defaults.body, names, { required: true }), [])
      assert.deepEqual(validateLetterStructure(t.defaults.body), [])
      assert.equal(t.letterLayout, 'offer')
    })
  }
})

describe('letter template layout', () => {
  test('sections split on "--- … ---" lines, case and spacing ignored', () => {
    const s = splitSections('Hi\n\n[A] x\n\n---   annexure a notes ---\nn1\nn2\n--- ANNEXURE B TERMS ---\n[T] t\n--- Acceptance ---\nI accept.')
    assert.equal(s.main, 'Hi\n\n[A] x')
    assert.equal(s.notes, 'n1\nn2')
    assert.equal(s.terms, '[T] t')
    assert.equal(s.acceptance, 'I accept.')
  })

  test('opening, numbered clauses and closing; a stray paragraph joins the clause above', () => {
    const c = parseClauses('Opening.\n\n[One] first\n\nmore of one\n\n[Two] second\n\nClosing.')
    assert.equal(c.opening, 'Opening.')
    assert.deepEqual(c.items, [['One', 'first\n\nmore of one'], ['Two', 'second']])
    assert.equal(c.closing, 'Closing.')
  })

  test('an edited template changes the letter; data parts stay', () => {
    const f = sampleFacts('EMPLOYMENT')
    const edited = tplOf('EMPLOYMENT').defaults.body.replace('[Probation] You will be on probation', '[Probation] Probation lasts')
      .replace('--- Acceptance ---', '[Dress code] Business formal.\n\n--- Acceptance ---')
    const got = letterFromTemplate({ subject: 'Your offer — {{role}}', body: edited }, f)
    assert.equal(got.subject, 'Your offer — Senior Sales Manager')
    assert.ok(got.items.some(([h, t]) => h === 'Probation' && t.startsWith('Probation lasts for a period of 180 days')))
    assert.deepEqual(got.annexB.items.at(-1), ['Dress code', 'Business formal.'])
    assert.equal(got.annexA.title, 'ANNEXURE A — COMPENSATION DETAILS')
    assert.ok(got.annexA.kv.length > 3)
  })

  test('structure problems are reported', () => {
    assert.ok(validateLetterStructure('Just a paragraph.').some(e => /numbered clause/.test(e)))
    assert.ok(validateLetterStructure('[A] x').some(e => /Acceptance/.test(e)))
  })
})
