// lib/exit/__tests__/fnf-clearance.test.ts — the clearance forms and the F&F arithmetic (spec §8–§10).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CLEARANCE_FORMS, DEPTS, clearanceProblems, recoveryOf, payableOf, isCleared, clearanceEscalation } from '../clearance.ts'
import { gratuityOf, pendingSalaryOf, noticeShortfallOf, serviceOf, fnfTotals, lettersFor, GRATUITY_CAP } from '../fnf.ts'

test('five departments, each with the spec’s items', () => {
  assert.deepEqual(DEPTS, ['IT', 'ADMIN', 'FINANCE', 'HR', 'HOD'])
  assert.equal(CLEARANCE_FORMS.IT.items.length, 13)
  assert.equal(CLEARANCE_FORMS.ADMIN.items.length, 10)
  assert.equal(CLEARANCE_FORMS.FINANCE.items.length, 10)
  assert.equal(CLEARANCE_FORMS.HR.items.length, 12)
  assert.equal(CLEARANCE_FORMS.HOD.items.length, 10)
})

const all = (dept: 'IT' | 'ADMIN' | 'FINANCE' | 'HR' | 'HOD', pick = 0) => Object.fromEntries(CLEARANCE_FORMS[dept].items.map(it => [it.key, { status: it.options[Math.min(pick, it.options.length - 1)] }]))

test('a sign-off needs every item, and dues must match the status', () => {
  assert.ok(clearanceProblems('IT', { items: {}, signoff: 'CLEARED' })[0].startsWith('Set a status for every item'))
  const items = all('IT')
  assert.deepEqual(clearanceProblems('IT', { items, signoff: 'CLEARED' }), [])
  const damaged = { ...items, laptop: { status: 'Damaged', amount: 12000 } }
  assert.equal(recoveryOf('IT', damaged), 12000)
  assert.ok(clearanceProblems('IT', { items: damaged, signoff: 'CLEARED' }).some(p => p.includes('Cleared with dues')))
  assert.deepEqual(clearanceProblems('IT', { items: damaged, signoff: 'CLEARED_WITH_DUES' }), [])
  assert.ok(clearanceProblems('IT', { items, signoff: 'CLEARED_WITH_DUES' }).some(p => p.includes('needs a recovery')))
  const pending = { ...items, sim: { status: 'Pending' } }
  assert.ok(clearanceProblems('IT', { items: pending, signoff: 'CLEARED' }).some(p => p.includes('still outstanding')))
  assert.ok(clearanceProblems('HR', { items: all('HR'), signoff: 'CLEARED_WITH_CONDITIONS' }).some(p => p.includes('conditions')))
})

test('finance: expenses are payable to the employee, everything else recovered', () => {
  const items = { ...all('FINANCE', 1), loan: { status: 'Recover', amount: 50000 }, expenses: { status: 'Pay employee', amount: 3000 } }
  assert.equal(recoveryOf('FINANCE', items), 50000)
  assert.equal(payableOf('FINANCE', items), 3000)
  assert.ok(isCleared('CLEARED_WITH_DUES') && !isCleared('NOT_CLEARED') && !isCleared(null))
})

test('escalation after 5 and 7 business days', () => {
  assert.equal(clearanceEscalation('2026-10-26', '2026-10-30'), 'NONE')       // Mon → Fri: 4
  assert.equal(clearanceEscalation('2026-10-26', '2026-11-02'), 'HR_MANAGER') // 5
  assert.equal(clearanceEscalation('2026-10-26', '2026-11-04'), 'HR_HEAD')    // 7
})

test('gratuity: 4 years + 240 days, the spec’s worked example, the cap, withholding', () => {
  assert.equal(gratuityOf(45000, '2022-01-01', '2026-06-30').eligible, false)            // 4 y 181 d
  assert.equal(gratuityOf(45000, '2021-11-01', '2026-06-30').eligible, true)             // 4 y 242 d
  const g = gratuityOf(45000, '2021-07-01', '2026-06-30')                                // 5 years
  assert.equal(g.years, 5); assert.equal(g.amount, 129808)
  assert.equal(gratuityOf(5_000_000, '1990-01-01', '2026-06-30').amount, GRATUITY_CAP)
  assert.equal(gratuityOf(45000, '2021-07-01', '2026-06-30', { withhold: true }).amount, 0)
  assert.deepEqual(serviceOf('2021-07-01', '2026-06-30'), { years: 5, days: 0, totalDays: 1826 })
})

test('pending salary pro-rates each month; notice shortfall uses gross ÷ 30', () => {
  const p = pendingSalaryOf(31000, '2026-09-30', '2026-10-15')
  assert.equal(p.days, 15); assert.equal(p.amount, 15000)
  assert.equal(pendingSalaryOf(31000, '2026-10-31', '2026-10-15').amount, 0)
  const n = noticeShortfallOf(30000, 30, '2026-10-01', '2026-10-11')
  assert.equal(n.days, 20); assert.equal(n.amount, 20000)
  assert.equal(noticeShortfallOf(30000, 30, '2026-10-01', '2026-10-11', { waived: true }).amount, 0)
})

test('totals and the letter matrix', () => {
  assert.deepEqual(fnfTotals({ earnings: [{ key: 'a', label: 'a', amount: 100 }, { key: 'b', label: 'b', amount: 50 }], deductions: [{ key: 'c', label: 'c', amount: 30 }] }), { earnings: 150, deductions: 30, net: 120 })
  assert.ok(lettersFor('ABSCOND').includes('TERMINATION') && !lettersFor('ABSCOND').includes('EXPERIENCE'))
  assert.ok(lettersFor('LAYOFF').includes('RELIEVING'))
  assert.ok(!lettersFor('TERMINATION').includes('EXPERIENCE') && lettersFor('TERMINATION', { caseByCase: true }).includes('EXPERIENCE'))
  assert.deepEqual(lettersFor('TRANSFER'), ['FNF_STATEMENT'])
})

test('death in service: gratuity with no minimum service, no notice recovery, the nominee’s letters', async () => {
  const { NO_NOTICE_RECOVERY } = await import('../fnf.ts')
  const { reasonOf, isSilent } = await import('../hr-exit.ts')
  const g = gratuityOf(30000, '2024-01-01', '2026-10-31', { death: true })          // 2 y 10 m → 3 yrs
  assert.equal(g.eligible, true); assert.equal(g.years, 3); assert.equal(g.amount, Math.round(30000 * 15 / 26 * 3))
  assert.equal(gratuityOf(30000, '2024-01-01', '2026-10-31').eligible, false)
  assert.ok(NO_NOTICE_RECOVERY.includes('DEATH'))
  assert.deepEqual(lettersFor('DEATH'), ['FNF_STATEMENT', 'PF_GUIDANCE'])
  assert.deepEqual(reasonOf('DEATH')!.chain, ['HR_MANAGER', 'HR_HEAD'])
  assert.ok(isSilent('DEATH') && !isSilent('LAYOFF'))
})
