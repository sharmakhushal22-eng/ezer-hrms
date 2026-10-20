import { test } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
register('../../test-support/alias-hooks.mjs', import.meta.url)
const { seriesNumber, nextInSeries, queueAhead } = await import('../code-series.ts')

test('the next code is the highest in the company series plus one — gaps are never filled', () => {
  assert.deepEqual(nextInSeries(['STC9073', 'STC0003', 'STC0005', 'STC9022'], 'STC'), { code: 'STC9074', after: 'STC9073', max: 9073 })
  assert.equal(nextInSeries(['STC0004', 'STC0006'], 'STC').code, 'STC0007', 'STC0005 is not reused')
  assert.equal(nextInSeries([], 'SSM').code, 'SSM0001')
  assert.equal(nextInSeries(['SSM-0001', 'ssm0002'], 'SSM').code, 'SSM0003', 'a dash and lower case still count')
})

test('other series and other companies are ignored; the width grows past 9999', () => {
  assert.equal(seriesNumber('STCINT0001', 'STC'), null)
  assert.equal(seriesNumber('SRS9049', 'STC'), null)
  assert.equal(nextInSeries(['STC9999', 'STCINT0009', 'SRS9999'], 'STC').code, 'STC10000')
})

test('FIFO: only the earlier arrivals of the same company without a code are ahead', () => {
  const all = [
    { id: 'a', created_at: '2026-10-01T10:00:00Z', status: 'IN_PROGRESS', company_id: 'stc' },
    { id: 'b', created_at: '2026-10-02T10:00:00Z', status: 'APPROVED', company_id: 'stc' },
    { id: 'c', created_at: '2026-10-03T10:00:00Z', status: 'APPROVED', company_id: 'stc' },
    { id: 'd', created_at: '2026-09-01T10:00:00Z', status: 'EMPLOYEE_CREATED', company_id: 'stc', employee_code: 'STC0003' },
    { id: 'e', created_at: '2026-09-15T10:00:00Z', status: 'APPROVED', company_id: 'srs' },
  ]
  assert.deepEqual(queueAhead(all, all[2]).map(x => x.id), ['a', 'b'], 'c waits for a (still filling the form) and b')
  assert.deepEqual(queueAhead(all, all[1]).map(x => x.id), ['a'])
  assert.deepEqual(queueAhead(all, all[0]).map(x => x.id), [], 'the first arrival is never blocked')
})
