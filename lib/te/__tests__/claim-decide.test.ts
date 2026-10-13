// lib/te/__tests__/claim-decide.test.ts — an approver changing what is paid.
//
// This is the one screen in the module that alters somebody's money, so the
// arithmetic and the gates are pinned down here rather than trusted to the
// shape of a form. The gates all exist for the same reason: a number that
// changes without a reason, or a claim returned with nothing said, leaves the
// employee guessing.
import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import {
  decidedTotal, describe as describeDecision, emptyDecision, isTouched,
  toDecideInput, whyNotReady, type DecisionDraft,
} from '../claim-decide.ts'

const LINES = [
  { id: 'a', eligible: 1000 },
  { id: 'b', eligible: 500 },
  { id: 'c', eligible: 250 },
]

const draft = (over: Partial<DecisionDraft> = {}): DecisionDraft => ({ ...emptyDecision(), ...over })

describe('what the claim comes to', () => {
  it('is the eligible total when nothing is touched', () => {
    assert.deepEqual(decidedTotal(LINES, {}), { total: 1750, cut: 0, rejected: 0 })
  })

  it('pays what the approver said, and counts the difference as cut', () => {
    assert.deepEqual(decidedTotal(LINES, { a: { amount: 600 } }), { total: 1350, cut: 400, rejected: 0 })
  })

  it('pays nothing for a refused line', () => {
    assert.deepEqual(decidedTotal(LINES, { b: { reject: 'final' } }), { total: 1250, cut: 0, rejected: 500 })
  })

  it('counts a refusal as refused, not as a cut to zero', () => {
    // The two mean different things to the employee: one can be refiled, the
    // other is gone. Collapsing them would hide that.
    const cutToZero = decidedTotal(LINES, { b: { amount: 0 } })
    const refused = decidedTotal(LINES, { b: { reject: 'final' } })
    assert.equal(cutToZero.total, refused.total)
    assert.equal(cutToZero.cut, 500)
    assert.equal(cutToZero.rejected, 0)
    assert.equal(refused.cut, 0)
    assert.equal(refused.rejected, 500)
  })

  it('a refusal wins over an amount on the same line', () => {
    assert.deepEqual(decidedTotal(LINES, { a: { amount: 900, reject: 'final' } }), { total: 750, cut: 0, rejected: 1000 })
  })

  it('works from the ELIGIBLE amount, not what was claimed', () => {
    // The policy limit was applied before the approver saw it; they are
    // deciding on top of that, not from scratch.
    const trimmed = [{ id: 'a', eligible: 300 }]
    assert.equal(decidedTotal(trimmed, {}).total, 300)
  })

  it('never goes negative on a silly amount', () => {
    assert.equal(decidedTotal(LINES, { a: { amount: -50 } }).total, 750)
  })

  it('counts several decisions together', () => {
    const r = decidedTotal(LINES, { a: { amount: 600 }, b: { reject: 'refile' } })
    assert.deepEqual(r, { total: 850, cut: 400, rejected: 500 })
  })
})

describe('whether a line has been touched', () => {
  it('is false for nothing, and for a bare reason', () => {
    assert.equal(isTouched(undefined), false)
    assert.equal(isTouched({}), false)
    assert.equal(isTouched({ reason: 'typed then thought better of it' }), false)
  })

  it('is true for an amount, including zero', () => {
    assert.equal(isTouched({ amount: 0 }), true)
    assert.equal(isTouched({ amount: 100 }), true)
  })

  it('is true for a refusal', () => {
    assert.equal(isTouched({ reject: 'final' }), true)
  })
})

describe('what stops a decision being sent', () => {
  it('lets a clean approval through', () => {
    assert.equal(whyNotReady('approve', draft(), LINES), '')
  })

  it('refuses a send-back with nothing said', () => {
    // Screen 95. The commonest way to waste somebody's afternoon.
    assert.match(whyNotReady('sendback', draft({ fix: ['a'] }), LINES), /Say what needs fixing/)
    assert.match(whyNotReady('sendback', draft({ comment: '   ', fix: ['a'] }), LINES), /Say what needs fixing/)
  })

  it('refuses a rejection with no reason', () => {
    assert.match(whyNotReady('reject', draft(), LINES), /needs a reason/)
  })

  it('refuses a send-back that marks nothing and changes nothing', () => {
    // A comment alone gives the employee nothing to act on.
    assert.match(whyNotReady('sendback', draft({ comment: 'please check' }), LINES), /Mark at least one line/)
  })

  it('accepts a send-back that changed a line even with nothing marked', () => {
    const d = draft({ comment: 'reduced the hotel', lines: { a: { amount: 600, reason: 'above the limit' } } })
    assert.equal(whyNotReady('sendback', d, LINES), '')
  })

  it('refuses a cut with no reason', () => {
    assert.match(whyNotReady('approve', draft({ lines: { a: { amount: 600 } } }), LINES), /why the amount was changed/)
  })

  it('refuses a refusal with no reason', () => {
    assert.match(whyNotReady('approve', draft({ lines: { a: { reject: 'final' } } }), LINES), /why the line is refused/)
  })

  it('refuses a negative amount', () => {
    assert.match(whyNotReady('approve', draft({ lines: { a: { amount: -1, reason: 'x' } } }), LINES), /cannot be negative/)
  })

  it('refuses approving MORE than the policy allowed', () => {
    // The limit was applied before the approver saw the claim; raising it is
    // not theirs to do from this screen.
    assert.match(whyNotReady('approve', draft({ lines: { a: { amount: 1500, reason: 'they deserve it' } } }), LINES), /above its eligible amount/)
  })

  it('allows approving exactly the eligible amount', () => {
    assert.equal(whyNotReady('approve', draft({ lines: { a: { amount: 1000, reason: 'checked' } } }), LINES), '')
  })

  it('ignores a reason typed on a line that was not changed', () => {
    assert.equal(whyNotReady('approve', draft({ lines: { a: { reason: 'just a note' } } }), LINES), '')
  })
})

describe('what gets sent', () => {
  it('leaves untouched lines out entirely', () => {
    const d = draft({ lines: { a: { reason: 'nothing done' }, b: { amount: 100, reason: 'cut' } } })
    const sent = toDecideInput('approve', d)
    assert.deepEqual(Object.keys(sent.decisions ?? {}), ['b'])
  })

  it('trims the words and drops empty ones', () => {
    const sent = toDecideInput('approve', draft({ comment: '  ', lines: { a: { amount: 5, reason: '  over  ' } } }))
    assert.equal('comment' in sent, false)
    assert.equal(sent.decisions?.a.reason, 'over')
  })

  it('sends the lines to fix only on a send-back', () => {
    const d = draft({ comment: 'fix these', fix: ['a', 'b'] })
    assert.deepEqual(toDecideInput('sendback', d).fix, ['a', 'b'])
    assert.equal('fix' in toDecideInput('approve', d), false, 'approving does not ask for fixes')
  })

  it('sends nothing at all for a plain approval', () => {
    assert.deepEqual(toDecideInput('approve', draft()), {})
  })
})

describe('telling the approver what they are about to do', () => {
  it('says so plainly when nothing changed', () => {
    assert.equal(describeDecision('approve', draft(), LINES), 'Passes as it stands.')
  })

  it('names the cut and the refusal', () => {
    const d = draft({ lines: { a: { amount: 600, reason: 'x' }, b: { reject: 'final', reason: 'y' } } })
    assert.equal(describeDecision('approve', d, LINES), 'Approves 850, with 400 cut and 500 refused.')
  })

  it('counts the lines a send-back asks for', () => {
    assert.match(describeDecision('sendback', draft({ fix: ['a'] }), LINES), /1 line to fix/)
    assert.match(describeDecision('sendback', draft({ fix: ['a', 'b'] }), LINES), /2 lines to fix/)
  })

  it('does not soften a rejection', () => {
    assert.equal(describeDecision('reject', draft(), LINES), 'The whole claim is refused. Nothing is paid.')
  })
})
