// lib/te/__tests__/finance-desk.test.ts — which button belongs on which row.
//
// Nearly every Finance-desk bug is the wrong button offered: a refund on an
// advance that never went out, a lock on a month still in motion. The states
// are the server's; which actions belong to them is here, and each is pinned
// down because offering the wrong one invites somebody to try it.
import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import {
  advanceActions, batchActions, payableTotal, periodActions, periodNeedsReason,
  PAYOUT_ROUTES,
} from '../finance-desk.ts'

const names = (list: { action: string }[]) => list.map(a => a.action)

describe('what can be done to an advance', () => {
  it('offers paying or refusing one that has not gone out', () => {
    assert.deepEqual(names(advanceActions('REQUESTED', 0)), ['pay', 'reject'])
    assert.deepEqual(names(advanceActions('APPROVED', 0)), ['pay', 'reject'])
  })

  it('never offers a refund on money that was never paid', () => {
    // The commonest shape of this bug, and the most confusing on a desk.
    assert.equal(advanceActions('REQUESTED', 0).some(a => a.action === 'refund'), false)
    assert.equal(advanceActions('APPROVED', 5000).some(a => a.action === 'refund'), false)
  })

  it('offers only ways back once the money has gone out', () => {
    assert.deepEqual(names(advanceActions('PAID', 5000)), ['refund', 'payroll', 'carry'])
    assert.deepEqual(names(advanceActions('PART_SETTLED', 2000)), ['refund', 'payroll', 'carry'])
    assert.deepEqual(names(advanceActions('RECOVERY_DUE', 2000)), ['refund', 'payroll', 'carry'])
  })

  it('offers nothing to recover when nothing is outstanding', () => {
    // The row may not be closed off yet, but there is no money to chase.
    assert.deepEqual(advanceActions('PAID', 0), [])
  })

  it('offers nothing on one that is finished or refused', () => {
    for (const st of ['SETTLED', 'REJECTED', 'CANCELLED', 'SOMETHING_ELSE']) {
      assert.deepEqual(advanceActions(st, 5000), [], st)
    }
  })

  it('says what paying and recovering actually do', () => {
    const pay = advanceActions('APPROVED', 0).find(a => a.action === 'pay')!
    assert.match(pay.effect, /Releases the money/)
    assert.equal(pay.amount, true, 'paying needs an amount')
    assert.equal(pay.reference, true, 'paying needs a reference')

    const payroll = advanceActions('PAID', 100).find(a => a.action === 'payroll')!
    assert.equal(payroll.grave, true, 'handing it to payroll should confirm first')
  })
})

describe('what can be done to a month', () => {
  it('offers only closing an open month', () => {
    assert.deepEqual(names(periodActions('OPEN')), ['close'])
  })

  it('offers reopening, rolling and locking a closed one', () => {
    assert.deepEqual(names(periodActions('CLOSED')), ['reopen', 'roll', 'lock'])
  })

  it('offers nothing on a locked month, which is the point of locking it', () => {
    assert.deepEqual(periodActions('LOCKED'), [])
  })

  it('treats a state it does not know as offering nothing', () => {
    assert.deepEqual(periodActions('WHATEVER'), [])
  })

  it('marks locking as the irreversible one', () => {
    const lock = periodActions('CLOSED').find(a => a.action === 'lock')!
    assert.equal(lock.grave, true)
    assert.match(lock.effect, /cannot be undone/)
  })

  it('asks why for the two that leave a mark', () => {
    assert.equal(periodNeedsReason('reopen'), true)
    assert.equal(periodNeedsReason('lock'), true)
    assert.equal(periodNeedsReason('close'), false)
    assert.equal(periodNeedsReason('roll'), false)
  })
})

describe('payout batches', () => {
  it('lets a draft or a generated file be paid, cancelled or regenerated', () => {
    assert.deepEqual(batchActions('DRAFT'), { file: true, paid: true, cancel: true })
    assert.deepEqual(batchActions('FILE_GENERATED'), { file: true, paid: true, cancel: true })
  })

  it('locks a paid batch down', () => {
    // The money has gone; regenerating a file or cancelling would be a lie.
    assert.deepEqual(batchActions('PAID'), { file: false, paid: false, cancel: false })
    assert.deepEqual(batchActions('CANCELLED'), { file: false, paid: false, cancel: false })
  })

  it('warns that the bank route produces a file with account numbers in it', () => {
    const bank = PAYOUT_ROUTES.find(r => r.route === 'OFF_CYCLE')!
    assert.match(bank.effect, /full account numbers/)
    const payroll = PAYOUT_ROUTES.find(r => r.route === 'PAYROLL')!
    assert.match(payroll.effect, /No bank file/)
  })

  it('adds up only what is ticked', () => {
    const rows = [{ id: 'a', net_amount: 1000 }, { id: 'b', net_amount: 250.5 }, { id: 'c', net_amount: 99 }]
    const id = (r: { id: string }) => r.id
    assert.equal(payableTotal(rows, new Set(['a', 'b']), id), 1250.5)
    assert.equal(payableTotal(rows, new Set(), id), 0)
    assert.equal(payableTotal(rows, new Set(['a', 'b', 'c']), id), 1349.5)
  })

  it('ignores a tick for a row that is no longer in the list', () => {
    // A stale page: the claim was batched by somebody else a moment ago.
    const rows = [{ id: 'a', net_amount: 1000 }]
    const id = (r: { id: string }) => r.id
    assert.equal(payableTotal(rows, new Set(['a', 'gone']), id), 1000)
  })
})
