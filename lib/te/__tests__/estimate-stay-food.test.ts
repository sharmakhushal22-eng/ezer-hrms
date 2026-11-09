// The estimate honours both answers from step 1: no stay means no hotel line,
// and no food means no meals line.
//
// WHY THIS IS TESTED AGAINST THE ENGINE. The estimate is money — it is what the
// approver is shown, what the trip total is built from, and what the advance cap
// is a fraction of. A helper agreeing with a copy of the rule would prove
// nothing; estimateFor is the thing that decides.
//
// WHAT WENT WRONG BEFORE. stayWanted was honoured here and foodWanted was not,
// so a trip that answered "no food" was still estimated a full daily allowance
// for every day of it. The asymmetry was invisible while both questions lived
// on a later step and were rarely answered; asking them together on step 1 put
// the two answers side by side and the mismatch with them.
//
// Both directions are asserted for each: the line goes when the answer is no,
// and is still there when it is yes or unanswered.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require_ = createRequire(import.meta.url)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

function engine(): Any {
  const { createEngine } = require_('../engine/te-engine.js') as Any
  const EZ = createEngine()
  EZ.seed()
  return EZ
}

/** A multi-day trip, so both a hotel and more than one day of food apply. */
function trip(EZ: Any, scope: string, extra: Record<string, unknown>) {
  const places = EZ.S.places ?? []
  const from = places.find((p: Any) => p.pt === 'corp')?.id ?? places[0].id
  const to = places.find((p: Any) => p.id !== from && p.city && p.city !== places.find((q: Any) => q.id === from)?.city)?.id
  const start = EZ.addDays(EZ.S.today, 20)
  const end = EZ.addDays(EZ.S.today, 23)
  return EZ.derive({
    id: '__draft__', emp: EZ.S.expenses[0].emp, co: [], status: 'DRAFT', origin: 'PRE_APPROVED',
    name: 'Estimate test', scope, pattern: 'oneway', purpose: 'client', project: '',
    pax: 1, people: [], advance: 0, stayBy: 'self',
    points: [
      { place: from, pt: 'corp', what: '', leave: start, arrive: '' },
      { place: to, pt: 'client', what: 'Meeting', leave: end, arrive: start },
    ],
    segs: [{ mode: 'flight', bookedBy: 'desk', vehicleId: null, xfer: {} }],
    ...extra,
  })
}

const estimate = (EZ: Any, t: Any) => EZ.estimateFor(t.emp, t)

// ── food ────────────────────────────────────────────────────────────────────

test('saying no to food takes the meals line out of the estimate', () => {
  const EZ = engine()
  const asked = estimate(EZ, trip(EZ, 'domestic', { stayWanted: true, foodWanted: true }))
  assert.ok(asked.meals > 0, `fixture: an outstation trip should estimate food, got ${asked.meals}`)

  const refused = estimate(EZ, trip(EZ, 'domestic', { stayWanted: true, foodWanted: false }))
  assert.equal(refused.meals, 0, 'no food wanted, no food estimated')
  // And it comes out of the total, not just the line.
  assert.ok(refused.travel + refused.desk + refused.hotel + refused.conv === asked.travel + asked.desk + asked.hotel + asked.conv,
    'nothing else moved')
})

test('a trip planned before the question keeps the food it always had', () => {
  // null and undefined are "never asked", not "deliberately no". Zeroing those
  // would quietly cut the estimate of every trip already in the system.
  const EZ = engine()
  const never = estimate(EZ, trip(EZ, 'domestic', { stayWanted: true }))
  assert.ok(never.meals > 0, 'unanswered keeps the line')
  const nulled = estimate(EZ, trip(EZ, 'domestic', { stayWanted: true, foodWanted: null }))
  assert.ok(nulled.meals > 0, 'null keeps the line')
})

test('a local trip answers the food question too', () => {
  // The local branch returns early with its own flat meal cap, so it needed
  // the same guard and did not have it either.
  const EZ = engine()
  const asked = estimate(EZ, trip(EZ, 'local', { stayWanted: false, foodWanted: true }))
  const refused = estimate(EZ, trip(EZ, 'local', { stayWanted: false, foodWanted: false }))
  assert.ok(asked.meals >= 0)
  assert.equal(refused.meals, 0, 'a local trip that wants no food is estimated none')
})

// ── stay, which already worked and must keep working ────────────────────────

test('saying no to a stay takes the hotel line out', () => {
  const EZ = engine()
  const asked = estimate(EZ, trip(EZ, 'domestic', { stayWanted: true, foodWanted: true }))
  assert.ok(asked.hotel > 0, `fixture: a multi-day trip should estimate a hotel, got ${asked.hotel}`)
  const refused = estimate(EZ, trip(EZ, 'domestic', { stayWanted: false, foodWanted: true }))
  assert.equal(refused.hotel, 0)
})

test('both answers no leaves travel and local rides, and nothing else', () => {
  const EZ = engine()
  const e = estimate(EZ, trip(EZ, 'domestic', { stayWanted: false, foodWanted: false }))
  assert.equal(e.hotel, 0)
  assert.equal(e.meals, 0)
  // The journeys are still real and still cost money; this is not a way to
  // make a trip free.
  assert.ok(e.travel + e.desk > 0, 'the flights are still estimated')
})
