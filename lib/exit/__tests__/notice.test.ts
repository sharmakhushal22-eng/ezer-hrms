import { test } from 'node:test'
import assert from 'node:assert/strict'
import { onProbation, effectiveNoticeDays, noticeLabel } from '../notice.ts'

const now = new Date('2026-10-20T09:00:00Z')

test('on probation → 30 days; confirmed → 60 days', () => {
  assert.equal(effectiveNoticeDays({ confirmation_status: 'Probation' }, now), 30)
  assert.equal(effectiveNoticeDays({ confirmation_status: 'Confirmed' }, now), 60)
  assert.equal(noticeLabel({ confirmation_status: 'Probation' }, now), '30 days (on probation)')
})

test('with no status, the first 6 months after joining count as probation', () => {
  assert.equal(onProbation({ company_doj: '2026-06-01' }, now), true, '4.5 months in')
  assert.equal(onProbation({ company_doj: '2026-04-01' }, now), false, '6.5 months in')
  assert.equal(onProbation({ company_doj: '2026-04-20' }, now), false, 'exactly 6 months today — confirmed')
  assert.equal(onProbation({ company_doj: '2026-01-01', probation_months: 12 }, now), true, 'a longer probation set on the record')
  assert.equal(onProbation({ company_doj: '2026-06-01', confirmation_date: '2026-09-01' }, now), false, 'confirmed early')
  assert.equal(effectiveNoticeDays({}, now), 60, 'nothing known — treated as confirmed')
})
