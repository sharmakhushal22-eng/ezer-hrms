// lib/te/__tests__/flag-review.test.ts — resolving a flag.
//
// The rules worth pinning here are about who may answer a check and what has
// to be said when the answer is "the check was wrong". Both exist because of
// what happens downstream: a manager dismissing a money check defeats the
// check, and an unexplained dismissal cannot later be told apart from a check
// that should be switched off.
import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import {
  flagNoteRequired, flagOffers, flagResolvedText, flagTone, isFlagOpen,
  openFlags, whyFlagNotReady,
} from '../flag-review.ts'

describe('who may answer a flag', () => {
  it('offers both answers to Finance on an open flag', () => {
    const offers = flagOffers('open', 'finance', true)
    assert.deepEqual(offers.map(o => o.verdict), ['dismissed', 'confirmed'])
  })

  it('offers nothing to a manager, who sees flags as context only', () => {
    // A manager dismissing the check that guards the money defeats the check.
    assert.deepEqual(flagOffers('open', 'manager', true), [])
  })

  it('offers nothing when the viewer may not act', () => {
    // Four eyes, somebody else's turn, or simply read-only.
    assert.deepEqual(flagOffers('open', 'finance', false), [])
  })

  it('offers nothing on a flag already answered', () => {
    assert.deepEqual(flagOffers('dismissed', 'finance', true), [])
    assert.deepEqual(flagOffers('confirmed', 'finance', true), [])
  })

  it('offers nothing when there is no stage at all', () => {
    assert.deepEqual(flagOffers('open', null, true), [])
  })

  it('treats an unknown status as already answered rather than open', () => {
    // Guessing "open" would offer a second verdict on a flag the server has
    // already moved on; the safe reading of a status we do not know is that
    // somebody else has dealt with it.
    assert.equal(isFlagOpen('superseded'), false)
    assert.deepEqual(flagOffers('superseded', 'finance', true), [])
  })
})

describe('what has to be said', () => {
  it('requires a reason to dismiss, and none to confirm', () => {
    assert.equal(flagNoteRequired('dismissed'), true)
    assert.equal(flagNoteRequired('confirmed'), false)
  })

  it('refuses a dismissal with no reason, and one that is only spaces', () => {
    assert.match(whyFlagNotReady('dismissed', ''), /Say why/)
    assert.match(whyFlagNotReady('dismissed', '   '), /Say why/)
  })

  it('explains the refusal in terms of the flag report', () => {
    // The reason this rule exists should be the reason the user is given.
    assert.match(whyFlagNotReady('dismissed', ''), /counts dismissals/)
  })

  it('lets a dismissal through once a reason is given', () => {
    assert.equal(whyFlagNotReady('dismissed', 'Map distance used; the odometer photo matches.'), '')
  })

  it('never blocks a confirmation', () => {
    assert.equal(whyFlagNotReady('confirmed', ''), '')
  })
})

describe('counting what is still open', () => {
  it('counts only open flags', () => {
    assert.equal(openFlags([{ status: 'open' }, { status: 'dismissed' }, { status: 'open' }]), 2)
    assert.equal(openFlags([]), 0)
    assert.equal(openFlags([{ status: 'confirmed' }]), 0)
  })
})

describe('how a resolved flag reads', () => {
  it('says what happened and quotes the reason', () => {
    assert.equal(flagResolvedText('dismissed', 'Short local leg.'), 'Dismissed: Short local leg.')
    assert.equal(flagResolvedText('confirmed', 'Bill is a duplicate.'), 'Confirmed: Bill is a duplicate.')
  })

  it('still says what happened when no reason was kept', () => {
    assert.equal(flagResolvedText('dismissed', ''), 'Dismissed.')
    assert.equal(flagResolvedText('confirmed', '   '), 'Confirmed.')
  })

  it('says nothing for a flag that is still open', () => {
    assert.equal(flagResolvedText('open', ''), '')
  })
})

describe('the tone of a flag', () => {
  it('stops shouting once a flag is dismissed, however bad it looked', () => {
    // A dismissed blocking flag is no longer a reason to worry about the claim.
    assert.equal(flagTone('dismissed', true), 'plain')
  })

  it('is critical when confirmed, whether or not it blocked', () => {
    assert.equal(flagTone('confirmed', false), 't-crit')
    assert.equal(flagTone('confirmed', true), 't-crit')
  })

  it('separates blocking from advisory while still open', () => {
    assert.equal(flagTone('open', true), 't-crit')
    assert.equal(flagTone('open', false), 't-warn')
  })
})
