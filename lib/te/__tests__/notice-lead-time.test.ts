// The booking lead time: a trip that has to be ticketed cannot leave sooner
// than the notice the company asks for.
//
// WHY THIS IS TESTED AGAINST THE ENGINE AND NOT A HELPER. The rule decides
// whether a plan can be saved — tripSave refuses on plan.blocked before it
// ever reaches SQL — so the thing worth proving is that tripIssues itself
// blocks, with the configured number, for the configured kinds of trip. A
// pure helper that agreed with a copy of the rule would prove nothing.
//
// Every test asserts BOTH directions. A rule that blocks everything is as
// useless as one that blocks nothing, and the second half is what catches a
// comparison written the wrong way round.
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

/** A plannable trip leaving `inDays` days from the engine's today. */
function tripIn(EZ: Any, inDays: number, scope = 'domestic', extra: Record<string, unknown> = {}) {
  const start = EZ.addDays(EZ.S.today, inDays)
  const emp = EZ.S.expenses[0].emp
  // Two real places, so the trip is otherwise complete enough that the only
  // thing under test is the date.
  const places = EZ.S.places ?? EZ.S.masters?.places ?? []
  const a = places[0]?.id ?? ''
  const b = places.find((p: Any) => p.id !== a)?.id ?? ''
  return EZ.derive({
    id: '__draft__', emp, co: [], status: 'DRAFT', origin: 'PRE_APPROVED',
    name: 'Lead time test', scope, pattern: 'oneway', purpose: 'client', project: '',
    pax: 1, people: [], advance: 0, stayBy: 'self',
    points: [{ place: a, pt: 'corp', what: '', leave: start, arrive: '' },
      { place: b, pt: 'client', what: 'Meeting', leave: '', arrive: '' }],
    segs: [{ mode: 'flight', bookedBy: 'desk', vehicleId: null, xfer: {} }],
    ...extra,
  })
}

const blockers = (EZ: Any, t: Any): string[] => EZ.tripIssues(t).filter((i: Any) => i.block).map((i: Any) => i.t)
const notes = (EZ: Any, t: Any): string[] => EZ.tripIssues(t).filter((i: Any) => !i.block).map((i: Any) => i.t)
const leadText = (xs: string[]) => xs.find(s => /has to be planned at least/.test(s)) ?? ''

// ── the rule itself ─────────────────────────────────────────────────────────

test('a domestic trip leaving tomorrow is blocked, and says why and by when', () => {
  const EZ = engine()
  EZ.S.cfg.noticeDays = 3
  const got = leadText(blockers(EZ, tripIn(EZ, 1)))
  assert.ok(got, `expected a lead-time blocker, got: ${blockers(EZ, tripIn(EZ, 1)).join(' | ')}`)
  assert.match(got, /at least 3 days before you leave/)
  // The reason, not just the refusal: somebody told "no" without being told
  // why asks a person instead of fixing it.
  assert.match(got, /Travel Desk can book the ticket/)
  // And the date that WOULD work, so the fix is obvious.
  assert.match(got, new RegExp(EZ.fd(EZ.addDays(EZ.S.today, 3)).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
})

test('exactly the notice is enough; one day short is not', () => {
  const EZ = engine()
  EZ.S.cfg.noticeDays = 3
  assert.equal(leadText(blockers(EZ, tripIn(EZ, 3))), '', 'three days out must be allowed')
  assert.ok(leadText(blockers(EZ, tripIn(EZ, 2))), 'two days out must be blocked')
})

test('international is covered too', () => {
  const EZ = engine()
  EZ.S.cfg.noticeDays = 3
  assert.match(leadText(blockers(EZ, tripIn(EZ, 1, 'international'))), /International travel/)
})

test('a local trip is not covered, because nothing is booked for it', () => {
  const EZ = engine()
  EZ.S.cfg.noticeDays = 3
  assert.equal(leadText(blockers(EZ, tripIn(EZ, 0, 'local'))), '')
})

test('a trip already travelled is never held to a lead time', () => {
  // POST_FACTO is a trip that already happened. Asking it for notice would be
  // asking somebody to plan the past.
  const EZ = engine()
  EZ.S.cfg.noticeDays = 3
  const t = tripIn(EZ, 0, 'domestic', { origin: 'POST_FACTO' })
  assert.equal(leadText(blockers(EZ, t)), '')
})

// ── it is configuration, not a constant ─────────────────────────────────────

test('the number of days comes from the setting', () => {
  const EZ = engine()
  EZ.S.cfg.noticeDays = 7
  assert.match(leadText(blockers(EZ, tripIn(EZ, 5))), /at least 7 days/)
  assert.equal(leadText(blockers(EZ, tripIn(EZ, 7))), '')
})

test('zero days switches the rule off', () => {
  const EZ = engine()
  EZ.S.cfg.noticeDays = 0
  assert.equal(leadText(blockers(EZ, tripIn(EZ, 0))), '')
})

test('which kinds of trip it covers is configuration', () => {
  const EZ = engine()
  EZ.S.cfg.noticeDays = 3
  // A company that books local cabs through the desk can say so.
  EZ.S.cfg.track.noticeScopes = ['local']
  assert.ok(leadText(blockers(EZ, tripIn(EZ, 1, 'local'))))
  assert.equal(leadText(blockers(EZ, tripIn(EZ, 1, 'domestic'))), '')
  // An empty list is the other way to switch it off.
  EZ.S.cfg.track.noticeScopes = []
  assert.equal(leadText(blockers(EZ, tripIn(EZ, 1, 'domestic'))), '')
})

test('it can be softened to a note for the approver instead of a refusal', () => {
  const EZ = engine()
  EZ.S.cfg.noticeDays = 3
  EZ.S.cfg.track.noticeAction = 'warn'
  const t = tripIn(EZ, 1)
  assert.equal(leadText(blockers(EZ, t)), '', 'must not block when set to warn')
  assert.ok(leadText(notes(EZ, t)), 'must still tell the approver')
})

// ── the trap this rule could have set ───────────────────────────────────────

test('editing a trip that leaves tomorrow does not lock you out of it', () => {
  // The rule is about when you ASK for a booking. Somebody fixing a typo in
  // the purpose of a trip that leaves tomorrow must still be able to save it,
  // or the lead time becomes a cage around their own plan.
  const EZ = engine()
  EZ.S.cfg.noticeDays = 3
  const soon = EZ.addDays(EZ.S.today, 1)
  const stored = tripIn(EZ, 1)
  stored.id = 'TRP-LEAD-1'
  stored.status = 'PENDING_APPROVAL'
  EZ.S.trips.push(stored)

  const edited = tripIn(EZ, 1, 'domestic', { id: 'TRP-LEAD-1', name: 'Lead time test, renamed' })
  assert.equal(edited.start, soon)
  assert.equal(leadText(blockers(EZ, edited)), '', 'an unchanged date must not block')
  assert.ok(leadText(notes(EZ, edited)), 'but the approver is still told')
})

test('moving the date closer IS asking again, and is blocked', () => {
  const EZ = engine()
  EZ.S.cfg.noticeDays = 3
  const stored = tripIn(EZ, 10)
  stored.id = 'TRP-LEAD-2'
  stored.status = 'PENDING_APPROVAL'
  EZ.S.trips.push(stored)

  const pulledIn = tripIn(EZ, 1, 'domestic', { id: 'TRP-LEAD-2' })
  assert.ok(leadText(blockers(EZ, pulledIn)), 'pulling the date inside the notice must block')
})

// ── where the trip is TO ────────────────────────────────────────────────────
// Not the lead time, but the same engine function and the same fixture, so it
// lives here rather than in a file of its own.
//
// to_label used to come from the FIRST place after the start, so a trip with a
// stop on the way out was named after the stop — and the trips list falls back
// to it when a trip has no name. It also disagreed with the planner, which has
// always called the last one the destination. Both now read the last point
// that is neither the return nor a stop.

function place2(EZ: Any, n: number) {
  const P = EZ.S.places ?? EZ.S.masters?.places ?? []
  const byCity: Record<string, Any[]> = {}
  for (const p of P) (byCity[p.city] ??= []).push(p)
  return byCity[Object.keys(byCity)[n]][0]
}

/** A round trip through the given places, each either a destination or a stop. */
function roundVia(EZ: Any, legs: { id: string; stop?: true }[]) {
  const home = place2(EZ, 0)
  const pt = (place: string, extra: Record<string, unknown> = {}) =>
    ({ place, pt: 'corp', what: '', leave: '2026-11-10', arrive: '', ...extra })
  const points = [pt(home.id), ...legs.map(l => pt(l.id, l.stop ? { stop: true } : {})), pt(home.id, { ret: true })]
  return EZ.derive({
    id: '__draft__', emp: EZ.S.expenses[0].emp, co: [], status: 'DRAFT', origin: 'PRE_APPROVED',
    name: '', scope: 'domestic', pattern: 'round', purpose: 'client', project: '',
    pax: 1, people: [], advance: 0, stayBy: 'self',
    points, segs: points.slice(1).map(() => ({ mode: 'flight', bookedBy: 'desk', vehicleId: null, xfer: {} })),
  })
}

test('a stop on the way home does not become the destination', () => {
  const EZ = engine()
  const dest = place2(EZ, 2), stop = place2(EZ, 1)
  const t = roundVia(EZ, [{ id: dest.id }, { id: stop.id, stop: true }])
  assert.equal(t.to, dest.city, `expected ${dest.city}, got ${t.to}`)
})

test('a stop on the way out does not become the destination either', () => {
  // This is the one that was wrong: the engine took the first place after the
  // start, so the trip read as a trip to the stop.
  const EZ = engine()
  const stop = place2(EZ, 1), dest = place2(EZ, 2)
  const t = roundVia(EZ, [{ id: stop.id, stop: true }, { id: dest.id }])
  assert.equal(t.to, dest.city, `expected ${dest.city}, got ${t.to}`)
})

test('with nothing marked, the last place is still the destination', () => {
  // A trip saved before points could say which they were.
  const EZ = engine()
  const a = place2(EZ, 1), b = place2(EZ, 2)
  assert.equal(roundVia(EZ, [{ id: a.id }, { id: b.id }]).to, b.city)
})

test('the plain case is unchanged', () => {
  const EZ = engine()
  const dest = place2(EZ, 2)
  assert.equal(roundVia(EZ, [{ id: dest.id }]).to, dest.city)
})
