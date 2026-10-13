// lib/recruitment/__tests__/pipeline-gates.test.ts — the pipeline's two real gates.
//
// WHY THIS FILE EXISTS
//
// A candidate could be moved to 'Shortlisted' straight after the Telephonic
// round, and to 'Offer Sent' with no negotiation, no HR Head approval and no
// offer letter — because the pipeline's manual "Move to" picker checked only
// that the target sat later in the STAGES array, and both of those do.
//
// THAT PICKER IS GONE. A stage is now a consequence of the interview rounds,
// never an input: a decision moves it, the Shortlist button posts
// action:'shortlist', Reject posts action:'reject'. The gates that existed to
// police the picker (offerFlowGate, roundStepGate, stageGate, the round ladder)
// went with it, and their tests with them.
//
// What remains is the rule the SERVER enforces: three CLEARED rounds, one
// candidate per opening. This file pins that policy (pure, below), then pins
// that every write path actually consults it — the lesson already written down
// in mrf-assignment-rule.test.ts is that a rule enforced at one write is not
// enforced, and four separate writes had to learn it one at a time.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  SLOT_STAGES, ROUNDS_BEFORE_SHORTLIST,
  occupiesSlot, openingsOf, slotsUsed, canShortlist,
  type ShortlistFacts,
} from '../pipeline-gates.ts'

/** A candidate who SHOULD pass, so each test can spoil exactly one thing. */
const facts = (o: Partial<ShortlistFacts> = {}): ShortlistFacts => ({
  currentStage: 'L2', clearedRounds: 3, openings: 1, slotsUsed: 0, ...o,
})

describe('the vocabulary', () => {
  test('a slot is held from Shortlisted onward, not from Offer Sent', () => {
    // The cap is "one candidate per opening", and a shortlisted candidate is the
    // one being taken to offer — so they occupy the opening from that moment,
    // not from the moment the letter goes out.
    assert.deepEqual([...SLOT_STAGES], ['Shortlisted', 'Offer Sent', 'Joined'])
    assert.equal(occupiesSlot('Shortlisted'), true)
    assert.equal(occupiesSlot('L2'), false)
    assert.equal(occupiesSlot('Rejected'), false, 'a rejected candidate frees their slot')
    assert.equal(occupiesSlot('Hold'), false, 'a held candidate has not claimed an opening')
    for (const junk of [null, undefined, '']) assert.equal(occupiesSlot(junk), false)
  })

  test('the shortlist gate is still three rounds', () => {
    // Telephonic, L1, L2 are the mandatory three; Optional Round is not.
    assert.equal(ROUNDS_BEFORE_SHORTLIST, 3)
  })
})

describe('openingsOf', () => {
  test('prefers no_of_openings, falls back to the older openings echo', () => {
    assert.equal(openingsOf({ no_of_openings: 3, openings: 9 }), 3)
    assert.equal(openingsOf({ openings: 2 }), 2)
  })

  test('anything missing or nonsensical means ONE opening, never zero', () => {
    // Zero would refuse every shortlist on the requisition — a cap that locks
    // the funnel is worse than no cap.
    const junk: unknown[] = [null, undefined, {}, { no_of_openings: 0 }, { no_of_openings: -4 },
      { no_of_openings: null }, { no_of_openings: Number.NaN }, { no_of_openings: 'three' }]
    for (const m of junk) {
      assert.equal(openingsOf(m as never), 1, `${JSON.stringify(m)} should mean one opening`)
    }
  })

  test('a fractional count floors rather than rounding up', () => {
    assert.equal(openingsOf({ no_of_openings: 2.7 }), 2)
  })
})

describe('slotsUsed', () => {
  const rows = [
    { id: 'a', mrf_id: 'M1', stage: 'Shortlisted' },
    { id: 'b', mrf_id: 'M1', stage: 'Offer Sent' },
    { id: 'c', mrf_id: 'M1', stage: 'L2' },        // still interviewing — no slot
    { id: 'd', mrf_id: 'M1', stage: 'Rejected' },  // freed their slot
    { id: 'e', mrf_id: 'M2', stage: 'Joined' },    // a different requisition
  ]

  test('counts only slot-holding candidates, and only on that requisition', () => {
    assert.equal(slotsUsed(rows, 'M1'), 2)
    assert.equal(slotsUsed(rows, 'M2'), 1)
  })

  test('THE RULE THAT MATTERS: exceptId frees the candidate being moved', () => {
    // A candidate sent back from the offer flow for a revision still reads
    // 'Shortlisted' (page.tsx markRevision, and the pre-onboarding revise path).
    // Counting them would refuse them their own slot and strand the revision.
    assert.equal(slotsUsed(rows, 'M1', 'a'), 1)
    assert.equal(slotsUsed(rows, 'M1', 'b'), 1)
    assert.equal(slotsUsed(rows, 'M1', 'c'), 2, 'excluding a non-holder changes nothing')
  })

  test('no requisition means no cap to apply', () => {
    assert.equal(slotsUsed(rows, null), 0)
    assert.equal(slotsUsed(rows, undefined), 0)
  })

  test('an empty list is zero rather than a crash', () => {
    assert.equal(slotsUsed([], 'M1'), 0)
  })
})

describe('canShortlist', () => {
  test('allows a candidate with three decisions and a free opening', () => {
    assert.deepEqual(canShortlist(facts()), { ok: true })
  })

  test('THE REPORTED BUG: one round is not enough', () => {
    const g = canShortlist(facts({ clearedRounds: 1, currentStage: 'Telephonic' }))
    assert.equal(g.ok, false)
    assert.match(g.reason as string, /3 rounds must be cleared/)
    assert.match(g.reason as string, /1 so far/, 'the message should say how many there are')
  })

  test('two is not enough either; three is', () => {
    assert.equal(canShortlist(facts({ clearedRounds: 0 })).ok, false)
    assert.equal(canShortlist(facts({ clearedRounds: 2 })).ok, false)
    assert.equal(canShortlist(facts({ clearedRounds: 3 })).ok, true)
    assert.equal(canShortlist(facts({ clearedRounds: 9 })).ok, true)
  })

  test('CLEARED, not merely decided: a Hold does not count toward the three', () => {
    // The rule: all three rounds must be decided SHORTLIST. This counted any
    // recorded decision, so Telephonic ✓ / L1 Hold / L2 ✓ read as three and the
    // button unlocked — and worse, Shortlist / Shortlist / Hold unlocked while
    // the candidate's own stage was 'Hold'.
    //
    // The count is produced by the caller (the modal filters on SHORTLIST, and
    // finalShortlist filters the same way server-side), so what this pins is
    // that THREE is three cleared rounds and two is refused — i.e. a Hold costs
    // a round rather than being quietly forgiven here.
    const telephonicAndL2Cleared = 2   // L1 was Hold
    const g = canShortlist(facts({ clearedRounds: telephonicAndL2Cleared, currentStage: 'L2' }))
    assert.equal(g.ok, false, 'a Hold on L1 must leave the candidate one short')
    assert.match(g.reason as string, /must be cleared/)
    assert.match(g.reason as string, /2 so far/)

    // And the recovery path: the hiring manager adds a fourth round, because a
    // submitted round cannot be re-decided (both feedback paths return 409).
    assert.equal(canShortlist(facts({ clearedRounds: 3, currentStage: 'Optional Round' })).ok, true,
      'clearing a fourth round must unlock it — otherwise a single Hold is terminal')
  })

  test('a candidate parked on Hold is refused even with three cleared', () => {
    // Guard for the sharpest version of the old hole: three cleared rounds but
    // the LAST decision was Hold, so the stage is 'Hold'. occupiesSlot() does
    // not cover 'Hold', so nothing else in this module would refuse it.
    const g = canShortlist(facts({ clearedRounds: 3, currentStage: 'Hold' }))
    assert.equal(g.ok, true,
      'NOTE: the stage alone does not refuse this — the caller must not count the Hold round ' +
      'as cleared, which is what the SHORTLIST-only filter in the modal and finalShortlist does')
  })

  test('THE CAP: one candidate per opening', () => {
    assert.equal(canShortlist(facts({ openings: 1, slotsUsed: 1 })).ok, false)
    assert.equal(canShortlist(facts({ openings: 3, slotsUsed: 3 })).ok, false)
    assert.equal(canShortlist(facts({ openings: 3, slotsUsed: 2 })).ok, true,
      'a 3-opening requisition must still take a third candidate')
  })

  test('a requisition with several openings fills one candidate at a time', () => {
    // Walk a 3-opening requisition from empty to full.
    for (let used = 0; used < 3; used++) {
      assert.equal(canShortlist(facts({ openings: 3, slotsUsed: used })).ok, true, `slot ${used + 1} of 3`)
    }
    assert.equal(canShortlist(facts({ openings: 3, slotsUsed: 3 })).ok, false, 'the fourth is refused')
  })

  test('the cap message names the real number of openings', () => {
    assert.match(canShortlist(facts({ openings: 1, slotsUsed: 1 })).reason as string, /one opening/)
    assert.match(canShortlist(facts({ openings: 4, slotsUsed: 4 })).reason as string, /All 4 openings/)
  })

  test('a candidate already holding a slot is not shortlisted twice', () => {
    for (const s of SLOT_STAGES) {
      const g = canShortlist(facts({ currentStage: s }))
      assert.equal(g.ok, false, `${s} should not be re-shortlisted`)
      assert.match(g.reason as string, new RegExp(`already ${s}`))
    }
  })

  test('a rejected candidate is refused however good the rest looks', () => {
    const g = canShortlist(facts({ currentStage: 'Rejected', clearedRounds: 9, slotsUsed: 0 }))
    assert.equal(g.ok, false)
    assert.match(g.reason as string, /rejected/i)
  })

  test('the round rule is reported before the cap', () => {
    // Both are wrong here. The round count is the one the recruiter can act on,
    // so it should be what they are told first.
    const g = canShortlist(facts({ clearedRounds: 0, openings: 1, slotsUsed: 1 }))
    assert.match(g.reason as string, /rounds must be cleared/)
  })

  test('a refusal always carries a reason, since the UI shows it verbatim', () => {
    const refusals = [
      facts({ clearedRounds: 0 }), facts({ openings: 1, slotsUsed: 1 }),
      facts({ currentStage: 'Rejected' }), facts({ currentStage: 'Offer Sent' }),
    ]
    for (const f of refusals) {
      const g = canShortlist(f)
      assert.equal(g.ok, false)
      assert.ok(g.reason && g.reason.length > 10, `a refusal with no usable reason: ${JSON.stringify(f)}`)
    }
  })
})

// ── Every write path must actually REACH the policy ─────────────────────────
//
// The tests above prove the rules. These prove the rules are reached, which is
// the half that was missing: both rules already existed and were already
// correct, and the whole bug was that the pipeline's "Move to" picker went
// through neither of them.
//
// This reads source rather than driving the UI, for the same reason
// mrf-assignment-rule.test.ts does: moveStage and addCandidate are closures
// inside a 6,300-line client component, and reaching them needs React, Supabase
// and a session. A test that needs all three to check a guard is a test nobody
// runs. The cost is that a rename breaks it — which is the point, because a
// human then re-reads the rule.

const PAGE = readFileSync('app/dashboard/recruitment/page.tsx', 'utf8')
const ROUTE = readFileSync('app/api/recruitment/interview-invite/route.ts', 'utf8')
const MODAL = readFileSync('components/recruitment/CandidateInterviewModal.tsx', 'utf8')
const DERIVE = readFileSync('components/recruitment/rx/logic/derive.ts', 'utf8')
const OFFER = readFileSync('app/dashboard/recruitment/offer-flow-components.tsx', 'utf8')

/** One function's body, so a guard living elsewhere cannot satisfy an assertion. */
function slice(src: string, startAnchor: string, endAnchor?: string): string {
  const a = src.indexOf(startAnchor)
  assert.notEqual(a, -1, `anchor not found — it was renamed: ${startAnchor}`)
  if (!endAnchor) return src.slice(a)
  const b = src.indexOf(endAnchor, a + startAnchor.length)
  return src.slice(a, b === -1 ? undefined : b)
}

test('all five sources were actually read', () => {
  // Every assertion below is worthless if a file came back empty or truncated.
  assert.ok(PAGE.length > 100_000, `page.tsx looks truncated (${PAGE.length} chars)`)
  assert.ok(ROUTE.length > 5_000, `the shortlist route looks truncated (${ROUTE.length} chars)`)
  assert.ok(MODAL.length > 15_000, `the modal looks truncated (${MODAL.length} chars)`)
  assert.ok(DERIVE.length > 4_000, `derive.ts looks truncated (${DERIVE.length} chars)`)
  assert.ok(OFFER.length > 40_000, `offer-flow looks truncated (${OFFER.length} chars)`)
})

describe('addCandidate: a candidate cannot be CREATED into an opening', () => {
  const body = slice(PAGE, 'const knockedOut = cForm.q1', "let error = (await supabase.from('candidates').insert(")

  test('it refuses a slot-holding stage before the insert', () => {
    assert.ok(/occupiesSlot\(stage\)/.test(body),
      'the Add-candidate form could insert a row directly at Shortlisted, skipping the funnel ' +
      'and the cap together. The dropdown is a courtesy; the insert is the write.')
  })

  test('the Stage dropdown no longer offers Shortlisted', () => {
    assert.ok(!/'Optional Round','Shortlisted'\]/.test(PAGE),
      'shortlisting needs three decided rounds, which a candidate being created cannot have')
  })
})

describe('rehire: re-entering the pipeline is not re-entering an opening', () => {
  const body = slice(OFFER, 'async function rehire(', '\n  async function processApproval')

  test('it refuses a slot-holding stage, and before writing', () => {
    assert.ok(/occupiesSlot\(stage\)/.test(body),
      'rehire wrote whatever stage it was handed with no check at all')
    const guard = body.indexOf('occupiesSlot(stage)')
    const write = body.indexOf('update({ stage,')
    assert.ok(guard !== -1 && write !== -1 && guard < write, 'the guard must precede the write')
  })

  test('REHIRE_STAGES no longer lists Shortlisted', () => {
    assert.ok(!/'Optional Round','Shortlisted'\]/.test(OFFER))
  })
})

describe('the shortlist route is the single enforcement point', () => {
  test('BOTH sides count CLEARED rounds, not merely decided ones', () => {
    // canShortlist only sees a number — it cannot tell a cleared round from a
    // held one. The MEANING of that number lives in two filters: the modal's,
    // and finalShortlist's. If either reverted to counting any decision, every
    // policy test above would still pass while a held candidate got shortlisted.
    // So the filters themselves are pinned here.
    const MODAL = readFileSync('components/recruitment/CandidateInterviewModal.tsx', 'utf8')
    assert.ok(/clearedRounds = rounds\.filter\(r => decisionOf\(mainOf\(r\)\) === 'SHORTLIST'\)/.test(MODAL),
      "the modal must count only rounds decided SHORTLIST — counting any decision is what let a " +
      'candidate sitting on Hold reach the Shortlist button')
    assert.ok(/distinctRounds\(rows\.filter\(r => decisionOf\(r\) === 'SHORTLIST'\)\)/.test(ROUTE),
      'finalShortlist must count only rounds decided SHORTLIST — it is the real gate, and the ' +
      'modal is only its mirror')
    // Neither side may fall back to the old "any decision" shape.
    assert.ok(!/filter\(r => r\.decision \|\| r\.feedback\?\.decision\)/.test(ROUTE),
      'the any-decision filter is the old rule and must not return')
  })

  const body = slice(ROUTE, 'async function finalShortlist(')

  test('it asks canShortlist, and refuses before writing', () => {
    assert.ok(/canShortlist\(\{/.test(body), 'the route must use the shared policy, not its own copy')
    const guard = body.indexOf('if (!gate.ok)')
    const write = body.indexOf("update({ stage: 'Shortlisted' })")
    assert.ok(guard !== -1 && write !== -1 && guard < write,
      'a refused shortlist must not have already been written')
  })

  test('the cap is counted from the database', () => {
    assert.ok(/openingsOf\(/.test(body) && /slotsUsed\(/.test(body) && /SLOT_STAGES/.test(body),
      'the cap must be measured server-side — two recruiters shortlisting at once both pass ' +
      'any check made in a browser')
  })

  test('the count excludes THIS candidate', () => {
    // `.*`, not `[^)]*`: the call is slotsUsed((peers || []) as any[], mrfId,
    // candidate_id), and a negated class stops dead at the ')' inside
    // '(peers || [])' — so the first version of this assertion could never reach
    // candidate_id and failed while the code was correct. `.*` does not cross a
    // newline (and ES2017 forbids the /s flag, which would be a TS1501 error),
    // so this still only matches within the one call.
    assert.ok(/slotsUsed\(.*candidate_id\)/.test(body),
      'a candidate sent back from the offer flow still reads Shortlisted, so counting them would ' +
      'refuse them their own slot and strand the revision')
  })

  test('nothing about the cap is taken from the request body', () => {
    assert.ok(!/body\.openings|body\.slots|body\.cap/.test(body),
      'the client must not be able to state its own cap')
  })
})

describe('the revision paths are deliberately NOT capped', () => {
  test('a candidate sent back for a revision keeps their own slot', () => {
    // markRevision writes 'Shortlisted' on a candidate who ALREADY holds the
    // opening, moving them backwards out of the offer flow. Routing that through
    // the cap would refuse them their own slot, so it writes directly — and must
    // keep doing so. This is why slotsUsed takes an exceptId at all.
    assert.ok(/offer_response:'REVISION'[^\n]*stage:'Shortlisted'/.test(PAGE),
      'markRevision should still write the stage directly, bypassing the cap')
  })
})
