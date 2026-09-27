// lib/recruitment/__tests__/interview-decision.test.ts — the interview approval gate.
//
// This is the decision half of the hiring chain: what a round's outcome does to
// the candidate's stage. Two callers share it — the recruiter's route
// (/api/recruitment/interview-invite) and the ESS route an interviewer submits
// feedback from — so a change here moves candidates on BOTH paths at once.
//
// It had no tests. The module is pure apart from two Supabase calls, and those
// two are stubbed below rather than mocked away, because the rule worth pinning
// is the negative one: a candidate the offer flow already owns must never be
// written, whatever a late interview decision says.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyInterviewDecision, stageForRound, isDecision, roundOrdinal, distinctRounds,
  DECISIONS, ROUND_STAGES, HOLD_STAGE, ROUNDS_BEFORE_SHORTLIST, type Decision,
} from '../interview-decision.ts'

/** Minimal stand-in for the two calls applyInterviewDecision makes. Records writes. */
function fakeSb(stage: string | null, opts: { updateError?: string } = {}) {
  const writes: Record<string, unknown>[] = []
  const sb = {
    from() {
      return {
        select() {
          return { eq() { return { maybeSingle: async () => ({ data: stage === null ? null : { stage } }) } } }
        },
        update(patch: Record<string, unknown>) {
          writes.push(patch)
          return { eq: async () => ({ error: opts.updateError ? { message: opts.updateError } : null }) }
        },
      }
    },
  }
  return { sb: sb as never, writes }
}

describe('the decision vocabulary', () => {
  test('exactly three decisions exist, and nothing else is one', () => {
    assert.deepEqual(DECISIONS, ['HOLD', 'REJECT', 'SHORTLIST'])
    for (const d of DECISIONS) assert.equal(isDecision(d), true)
    for (const junk of ['hold', 'Shortlist', 'APPROVE', 'REJECTED', '', null, undefined, 7, {}]) {
      assert.equal(isDecision(junk), false, `${String(junk)} must not pass as a decision`)
    }
  })

  test('the shortlist gate is three rounds', () => {
    // The candidate popup only offers the final Shortlist after this many rounds.
    assert.equal(ROUNDS_BEFORE_SHORTLIST, 3)
  })
})

describe('a round maps to a funnel stage', () => {
  test('by name when the name is one of the known stages', () => {
    for (const s of ROUND_STAGES) {
      // Ordinal 99 would map to the last stage; the name must win over position.
      assert.equal(stageForRound(s, 99), s)
    }
  })

  test('by name regardless of case or surrounding space', () => {
    assert.equal(stageForRound('  telephonic ', 99), 'Telephonic')
    assert.equal(stageForRound('l2', 99), 'L2')
  })

  test('by position when the round is free-form', () => {
    assert.equal(stageForRound('Panel with the CTO', 1), 'Telephonic')
    assert.equal(stageForRound('Panel with the CTO', 2), 'L1')
    assert.equal(stageForRound('Panel with the CTO', 3), 'L2')
    assert.equal(stageForRound('Panel with the CTO', 4), 'Optional Round')
  })

  test('a position past the last stage clamps rather than falling off the end', () => {
    assert.equal(stageForRound('Case study', 9), 'Optional Round')
    assert.equal(stageForRound('Case study', 0), 'Telephonic')
    assert.equal(stageForRound('Case study', -5), 'Telephonic')
  })
})

describe('ordinals and round lists', () => {
  test('roundOrdinal is 1-based and case-insensitive', () => {
    const rounds = ['Telephonic', 'L1', 'Panel']
    assert.equal(roundOrdinal(rounds, 'Telephonic'), 1)
    assert.equal(roundOrdinal(rounds, 'l1'), 2)
    assert.equal(roundOrdinal(rounds, 'PANEL'), 3)
  })

  test('an unknown round is treated as the NEXT one, not as the first', () => {
    // Off-by-one here would map a brand-new round onto Telephonic and move the
    // candidate backwards through the funnel.
    assert.equal(roundOrdinal(['Telephonic', 'L1'], 'HOD round'), 3)
    assert.equal(roundOrdinal([], 'Telephonic'), 1)
  })

  test('distinctRounds keeps first-seen order and folds case', () => {
    const invites = [{ round: 'Telephonic' }, { round: 'L1' }, { round: 'telephonic' }, { round: 'L2' }]
    assert.deepEqual(distinctRounds(invites), ['Telephonic', 'L1', 'L2'])
  })

  test('distinctRounds drops blank rounds instead of emitting an empty stage', () => {
    assert.deepEqual(distinctRounds([{ round: '' }, { round: 'L1' }]), ['L1'])
  })
})

describe('applying a decision to the candidate', () => {
  test('REJECT sends the candidate to Rejected', async () => {
    const { sb, writes } = fakeSb('L1')
    assert.equal(await applyInterviewDecision(sb, 'c1', 'L1', 'REJECT', 2), 'Rejected')
    assert.deepEqual(writes, [{ stage: 'Rejected' }])
  })

  test('HOLD parks the candidate on the hold stage', async () => {
    const { sb, writes } = fakeSb('L1')
    assert.equal(await applyInterviewDecision(sb, 'c1', 'L1', 'HOLD', 2), HOLD_STAGE)
    assert.deepEqual(writes, [{ stage: 'Hold' }])
  })

  test('SHORTLIST advances to the round\'s own stage', async () => {
    const { sb, writes } = fakeSb('Telephonic')
    assert.equal(await applyInterviewDecision(sb, 'c1', 'L2', 'SHORTLIST', 3), 'L2')
    assert.deepEqual(writes, [{ stage: 'L2' }])
  })

  test('THE RULE THAT MATTERS: a candidate the offer flow owns is never disturbed', async () => {
    // A late or duplicated interview decision must not drag somebody who already
    // has an offer back into the funnel — nor reject them out of it.
    for (const owned of ['Offer Sent', 'Joined']) {
      for (const d of DECISIONS) {
        const { sb, writes } = fakeSb(owned)
        assert.equal(await applyInterviewDecision(sb, 'c1', 'L1', d as Decision, 2), owned)
        assert.deepEqual(writes, [], `${d} wrote to a candidate on ${owned}`)
      }
    }
  })

  test('a decision that changes nothing writes nothing', async () => {
    const { sb, writes } = fakeSb('Rejected')
    assert.equal(await applyInterviewDecision(sb, 'c1', 'L1', 'REJECT', 2), 'Rejected')
    assert.deepEqual(writes, [], 'a no-op decision should not touch the row')
  })

  test('a candidate row that does not exist still resolves to a stage', async () => {
    const { sb } = fakeSb(null)
    assert.equal(await applyInterviewDecision(sb, 'missing', 'L1', 'HOLD', 2), 'Hold')
  })

  test('a failed write throws rather than reporting a stage it did not set', async () => {
    const { sb } = fakeSb('L1', { updateError: 'permission denied' })
    await assert.rejects(
      () => applyInterviewDecision(sb, 'c1', 'L1', 'REJECT', 2),
      /permission denied/,
      'a swallowed write error would leave the UI showing a stage the database never took',
    )
  })
})
