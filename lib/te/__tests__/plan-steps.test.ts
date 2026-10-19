// Which steps a plan shows, and what step 1 waits for.
//
// Two questions moved to step 1 — "do you need a hotel or food" and "is a
// flight or train part of this" — and each one hides part of the form when the
// answer is no. That makes them the only answers in the planner that change the
// shape of the form itself, so the rules get their own tests:
//
//   · a step that is hidden must not be reachable by Next or Back, or somebody
//     lands on a screen the nav says does not exist;
//   · standing on a step that disappears must land somewhere sensible, not on
//     step 4 of three;
//   · a mode ruled out on step 1 must not survive on a segment, or the plan
//     saves with the very thing that was ruled out.
//
// Both directions are asserted throughout. A gate that always refuses is as
// wrong as one that never does.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  HUB_MODES, nearestStep, newPlannerDraft, step1Gaps, stepAfter, stepBefore, syncDraft, visibleSteps,
  type DraftContext, type PlannerDraft, type PlanStep,
} from '../trip-draft.ts'

/** Modes shaped like te_modes, with flight and train allowed outstation only —
 *  which is this company's actual configuration. */
const MODES = [
  { id: 'flight', name: 'Flight', basis: 'ticket' as const, scopes: ['domestic', 'international'] as const, gps: 'checkin' as const, stops: false, ceil: 0, on: true },
  { id: 'train', name: 'Train', basis: 'ticket' as const, scopes: ['local', 'domestic', 'international'] as const, gps: 'checkin' as const, stops: false, ceil: 0, on: true },
  { id: 'cab', name: 'Cab', basis: 'bill' as const, scopes: ['local', 'domestic', 'international'] as const, gps: 'track' as const, stops: true, ceil: 0, on: true },
  { id: 'own', name: 'Own vehicle', basis: 'km' as const, scopes: ['local', 'domestic'] as const, gps: 'track' as const, stops: true, ceil: 0, on: true },
// eslint-disable-next-line @typescript-eslint/no-explicit-any
] as any

const ctx: DraftContext = {
  today: '2026-10-19',
  officePlace: 'off',
  vehicles: [],
  modes: MODES,
  placeName: (id: string) => id,
}

const draft = (patch: Partial<PlannerDraft> = {}): PlannerDraft =>
  syncDraft({ ...newPlannerDraft({ scope: 'domestic', origin: 'PRE_APPROVED', lastWorkday: '2026-10-16' }, ctx), ...patch }, ctx)

// ── which steps exist ───────────────────────────────────────────────────────

test('the Stay step appears only when a stay is wanted', () => {
  assert.deepEqual(visibleSteps({ stayWanted: true }), [1, 2, 3, 4, 5])
  assert.deepEqual(visibleSteps({ stayWanted: false }), [1, 2, 3, 5])
  // Not asked yet is not a yes: the step stays away until somebody says so.
  assert.deepEqual(visibleSteps({}), [1, 2, 3, 5])
})

test('Next and Back skip the step that is not there', () => {
  const no = { stayWanted: false }
  assert.equal(stepAfter(no, 3), 5, 'from Commute, Next goes to Review')
  assert.equal(stepBefore(no, 5), 3, 'from Review, Back goes to Commute')
  assert.equal(stepAfter(no, 5), null, 'Review is the end')
  assert.equal(stepBefore(no, 1), null, 'Trip is the start')

  const yes = { stayWanted: true }
  assert.equal(stepAfter(yes, 3), 4, 'with a stay, Next goes to Stay')
  assert.equal(stepBefore(yes, 5), 4)
})

test('standing on Stay when the answer turns to no lands on Review, not nowhere', () => {
  // The person is on step 4 and goes back to step 1 to say "no stay". Step 4
  // stops existing underneath them.
  assert.equal(nearestStep({ stayWanted: false }, 4), 5)
  // And a step that does exist is left alone.
  assert.equal(nearestStep({ stayWanted: false }, 2), 2)
  assert.equal(nearestStep({ stayWanted: true }, 4), 4)
})

// ── what step 1 is waiting for ──────────────────────────────────────────────

test('step 1 waits for both answers when a flight or train is possible', () => {
  assert.deepEqual(step1Gaps({}, true).length, 2)
  assert.deepEqual(step1Gaps({ stayWanted: false }, true).length, 1)
  assert.deepEqual(step1Gaps({ stayWanted: false, flightOrTrain: false }, true), [])
  // false is an answer. Only undefined is a gap.
  assert.deepEqual(step1Gaps({ stayWanted: false, flightOrTrain: false }, true), [])
})

test('a trip that cannot fly or take a train is never asked', () => {
  // A local trip with flight and train switched off for local: the question
  // would have no answers to offer, so it is not asked and not waited for.
  assert.deepEqual(step1Gaps({ stayWanted: false }, false), [])
  assert.equal(step1Gaps({}, false).length, 1, 'the stay question is still asked')
})

test('the gaps are sentences a person can act on', () => {
  for (const g of step1Gaps({}, true)) {
    assert.match(g, /^Say whether /)
    assert.match(g, /\.$/)
  }
})

// ── the answer actually removes the mode ────────────────────────────────────

test('saying no to a flight replaces a flight already chosen', () => {
  const flying = draft({ flightOrTrain: true })
  assert.ok(flying.segs.every(s => s.mode === 'flight'), 'fixture: an outstation trip defaults to flying')

  // They go back to step 1 and say no.
  const grounded = syncDraft({ ...flying, flightOrTrain: false }, ctx)
  assert.ok(grounded.segs.every(s => !HUB_MODES.includes(s.mode)),
    `no segment may still be a flight or a train, got ${grounded.segs.map(s => s.mode).join(', ')}`)

  // And saying yes again does not force it back: the choice is theirs to make
  // on the commute step, it is only the ruled-out mode that is replaced.
  const again = syncDraft({ ...grounded, flightOrTrain: true }, ctx)
  assert.ok(again.segs.every(s => !HUB_MODES.includes(s.mode)), 'their cab is kept')
})

test('a local trip is unaffected: it never defaulted to a flight anyway', () => {
  const local = syncDraft({ ...newPlannerDraft({ scope: 'local', origin: 'PRE_APPROVED', lastWorkday: '2026-10-16' }, ctx), flightOrTrain: false }, ctx)
  assert.ok(local.segs.every(s => !HUB_MODES.includes(s.mode)))
})

test('a train an admin allows on a local trip still survives a yes', () => {
  // train has scope_local = true in this fixture, as it does in the real data.
  // Saying yes must not have it replaced by syncDraft's mode repair.
  const local = syncDraft({
    ...newPlannerDraft({ scope: 'local', origin: 'PRE_APPROVED', lastWorkday: '2026-10-16' }, ctx),
    flightOrTrain: true,
    segs: [{ mode: 'train', bookedBy: 'desk', vehicleId: '', xfer: { first: 'cab', last: 'cab' } }],
  }, ctx)
  assert.equal(local.segs[0].mode, 'train')
})

// ── the step the draft carries stays one of the real ones ───────────────────

test('every visible step is a step the planner knows', () => {
  for (const d of [{ stayWanted: true }, { stayWanted: false }, {}]) {
    for (const n of visibleSteps(d)) {
      assert.ok(([1, 2, 3, 4, 5] as PlanStep[]).includes(n), `${n} is not a PlanStep`)
    }
  }
})
