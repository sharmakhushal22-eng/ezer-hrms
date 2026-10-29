// The wording helpers the screens share.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { rs, day, dayAt, when, claimChip, claimHolder, currentStep, flagClass, errorText, todayIst } from '../format.ts'
import type { TeStep } from '../types.ts'

const step = (o: Partial<TeStep>): TeStep => ({ id: 's', n: 1, role: 'Reporting manager (R1)', who: 'e1', whoName: 'Rajesh Mehta', team: '', level: null, stage: 'manager', status: 'pending', by: null, byName: null, at: null, comment: '', due: null, ...o })

describe('amounts and dates', () => {
  test('rupees with Indian grouping and no paise', () => {
    assert.equal(rs(158840), '₹1,58,840')
    assert.equal(rs(166.4), '₹166')
    assert.equal(rs('166.00'), '₹166')
    assert.equal(rs(-8000), '-₹8,000')
    assert.equal(rs(null), '₹0')
  })
  test('a calendar date is not shifted by the time zone', () => {
    assert.equal(day('2026-11-16'), '16 Nov')
    assert.equal(day('2026-01-01'), '1 Jan')
    assert.equal(day(null), '')
  })
  test('a timestamp is shown in India time', () => {
    assert.equal(when('2026-11-16T04:17:00+00:00'), '16 Nov, 09:47')
    assert.equal(when('2026-12-31T20:00:00Z'), '1 Jan, 01:30')
    assert.equal(when(''), '')
  })
  test('today in India rolls over at 18:30 UTC', () => {
    assert.equal(todayIst(Date.parse('2026-10-09T18:29:00Z')), '2026-10-09')
    assert.equal(todayIst(Date.parse('2026-10-09T18:31:00Z')), '2026-10-10')
  })
})

describe('claim wording', () => {
  test('every status has a chip', () => {
    assert.deepEqual(claimChip({ status: 'IN_APPROVAL', stage: 'manager' }), { label: 'With manager', tone: 't-warn' })
    assert.deepEqual(claimChip({ status: 'IN_VERIFICATION', stage: 'finance' }), { label: 'With Finance', tone: 't-warn' })
    assert.deepEqual(claimChip({ status: 'SENT_BACK', stage: 'manager' }), { label: 'Needs your answer', tone: 't-crit' })
    assert.deepEqual(claimChip({ status: 'SETTLED', stage: 'finance' }), { label: 'Settled', tone: 't-pos' })
    assert.deepEqual(claimChip({ status: 'SOMETHING_NEW', stage: 'finance' }), { label: 'something new', tone: 'plain' })
  })
  test('who holds it: the first pending step, across approval and finance levels', () => {
    const chain = [step({ status: 'approved', byName: 'Rajesh Mehta' })]
    const fin = [step({ id: 'f', role: 'Finance check', whoName: 'Finance team', team: 'finance', stage: 'finance' })]
    assert.equal(currentStep({ chain, fin })?.id, 'f')
    assert.equal(claimHolder({ status: 'IN_VERIFICATION', chain, fin, settledAt: null, verifiedAt: null }), 'With Finance team')
    assert.equal(claimHolder({ status: 'SETTLED', chain, fin, settledAt: '2026-11-07T05:04:00Z', verifiedAt: null }), 'Settled 7 Nov, 10:34')
    assert.equal(claimHolder({ status: 'SENT_BACK', chain, fin, settledAt: null, verifiedAt: null }), 'Sent back to you')
    assert.equal(currentStep({ chain, fin: [] }), null)
  })
  test('flags and errors', () => {
    assert.equal(flagClass({ block: true }), 'flag crit')
    assert.equal(flagClass({ block: false }), 'flag warn')
    assert.equal(errorText(new Error('Add a reason where one is asked.')), 'Add a reason where one is asked.')
    assert.equal(errorText('x'), 'Something went wrong. Try again.')
  })
})

test('dayAt prints the time only when there is one', () => {
  // '' must never become midnight: migration 165 keeps "not recorded" and
  // 00:00 as different facts, and so must the words for them.
  const d = dayAt('2026-04-16')
  assert.ok(d.length > 0)
  assert.equal(dayAt('2026-04-16', ''), d)
  assert.equal(dayAt('2026-04-16', null), d)
  assert.equal(dayAt('2026-04-16', '  '), d)
  assert.equal(dayAt('2026-04-16', '06:15'), `${d}, 06:15`)
  // Anything that is not HH:MM is ignored rather than printed raw.
  assert.equal(dayAt('2026-04-16', '6am'), d)
  assert.equal(dayAt('2026-04-16', '06:15:00'), d)
  assert.equal(dayAt(null, '06:15'), '')
  assert.equal(dayAt('', '06:15'), '')
})
