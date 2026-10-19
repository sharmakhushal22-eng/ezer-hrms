// The preferred time on the commute step starts as when you leave on the route.
//
// They have already said "I leave Mumbai at 21:40" on step 2. Asking again on
// step 3 is the same question twice, so the preference starts as a copy and
// FOLLOWS the route while nobody has touched it.
//
// The whole risk of an autofill is the other direction: it must never
// overwrite an answer somebody deliberately gave. So every test here is a pair
// — it follows when untouched, and it stops dead once typed in.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fromTrip, newPlannerDraft, syncDraft, type DraftContext, type PlannerDraft } from '../trip-draft.ts'

const MODES = [
  { id: 'flight', name: 'Flight', basis: 'ticket' as const, scopes: ['domestic'] as const, gps: 'checkin' as const, stops: false, ceil: 0, on: true },
  { id: 'cab', name: 'Cab', basis: 'bill' as const, scopes: ['local', 'domestic'] as const, gps: 'track' as const, stops: true, ceil: 0, on: true },
// eslint-disable-next-line @typescript-eslint/no-explicit-any
] as any

const ctx: DraftContext = {
  today: '2026-10-19', officePlace: 'off', vehicles: [], modes: MODES, placeName: (id: string) => id,
}

/** A two-point domestic plan: one journey, so segs[0] leaves points[0]. */
function plan(patch: Partial<PlannerDraft> = {}): PlannerDraft {
  const base = newPlannerDraft({ scope: 'domestic', origin: 'PRE_APPROVED', lastWorkday: '2026-10-16' }, ctx)
  return syncDraft({ ...base, ...patch }, ctx)
}

/** Set the leave time on the first point, as step 2 does. */
const leavingAt = (d: PlannerDraft, at: string): PlannerDraft =>
  syncDraft({ ...d, points: d.points.map((p, i) => (i === 0 ? { ...p, leaveAt: at } : p)) }, ctx)

// ── it follows ──────────────────────────────────────────────────────────────

test('the preferred time starts as the time you leave on the route', () => {
  const d = leavingAt(plan(), '21:40')
  assert.equal(d.segs[0].prefTime, '21:40')
  assert.equal(d.segs[0].prefTimeTouched, undefined, 'a copy is not a choice')
})

test('changing the route changes it, while nobody has typed their own', () => {
  let d = leavingAt(plan(), '21:40')
  d = leavingAt(d, '06:15')
  assert.equal(d.segs[0].prefTime, '06:15', 'it follows the route')
})

test('no leave time means no preferred time, not midnight', () => {
  // '' and '00:00' are different answers, and only one of them is true.
  const d = plan()
  assert.equal(d.segs[0].prefTime, '', 'empty, not 00:00')
})

test('each journey follows its own starting point, not the first one', () => {
  // A round trip: segs[1] leaves the destination, so it follows points[1].
  const d = syncDraft({
    ...plan(),
    points: [
      { place: 'off', pt: 'corp', what: '', leave: '2026-12-01', leaveAt: '08:00', arrive: '' },
      { place: 'bom', pt: 'client', what: '', leave: '2026-12-04', leaveAt: '19:30', arrive: '2026-12-01' },
      { place: 'off', pt: 'corp', what: '', leave: '', arrive: '2026-12-04', ret: true },
    ],
  }, ctx)
  assert.equal(d.segs.length, 2)
  assert.equal(d.segs[0].prefTime, '08:00', 'the outbound leaves the office at 08:00')
  assert.equal(d.segs[1].prefTime, '19:30', 'the return leaves the destination at 19:30')
})

// ── and it stops following once it is theirs ─────────────────────────────────

test('a time somebody typed is never overwritten by the route', () => {
  let d = leavingAt(plan(), '21:40')
  // They ask for something else on the commute step.
  d = syncDraft({ ...d, segs: d.segs.map(s => ({ ...s, prefTime: '07:30', prefTimeTouched: true as const })) }, ctx)
  assert.equal(d.segs[0].prefTime, '07:30')

  // Now the route changes underneath it. Their answer must survive.
  d = leavingAt(d, '05:00')
  assert.equal(d.segs[0].prefTime, '07:30', 'the typed preference wins over a later route edit')
})

test('clearing the box is an answer too, and stays cleared', () => {
  // "No preference" is a real thing to say. Having the route refill it would
  // put words back in their mouth.
  let d = leavingAt(plan(), '21:40')
  d = syncDraft({ ...d, segs: d.segs.map(s => ({ ...s, prefTime: '', prefTimeTouched: true as const })) }, ctx)
  d = leavingAt(d, '09:00')
  assert.equal(d.segs[0].prefTime, '', 'still empty')
})

// ── reopening a saved trip ──────────────────────────────────────────────────

test('a saved preference survives being reopened', () => {
  // THE BUG THIS PREVENTS: syncDraft runs on the way in, so a trip whose route
  // carries no leave time would have had its preference wiped the moment
  // somebody opened it to look.
  const trip = {
    id: 't1', name: 'Pune', scope: 'domestic' as const, origin: 'PRE_APPROVED' as const,
    purpose: 'client', project: '',
    points: [
      { place: 'off', pt: 'corp', what: '', leave: '2026-12-01', arrive: '' },
      { place: 'bom', pt: 'client', what: '', leave: '', arrive: '2026-12-01' },
    ],
    segs: [{ mode: 'flight', bookedBy: 'desk', vehicleId: null, xfer: { first: 'cab', last: 'cab' }, prefTime: '07:30' }],
    pax: 1, people: [], stayBy: 'self' as const, advance: 0,
    pfReason: '', pfNote: '', status: 'APPROVED',
  }
  const d = syncDraft(fromTrip(trip, ctx), ctx)
  assert.equal(d.segs[0].prefTime, '07:30', 'the time the desk was given is still there')
  assert.equal(d.segs[0].prefTimeTouched, true, 'and it is treated as settled, not as a copy')
})

test('a saved trip with no preference still picks one up from its route', () => {
  const trip = {
    id: 't2', name: 'Pune', scope: 'domestic' as const, origin: 'PRE_APPROVED' as const,
    purpose: 'client', project: '',
    points: [
      { place: 'off', pt: 'corp', what: '', leave: '2026-12-01', leaveAt: '06:45', arrive: '' },
      { place: 'bom', pt: 'client', what: '', leave: '', arrive: '2026-12-01' },
    ],
    segs: [{ mode: 'flight', bookedBy: 'desk', vehicleId: null, xfer: { first: 'cab', last: 'cab' } }],
    pax: 1, people: [], stayBy: 'self' as const, advance: 0,
    pfReason: '', pfNote: '', status: 'APPROVED',
  }
  const d = syncDraft(fromTrip(trip, ctx), ctx)
  assert.equal(d.segs[0].prefTime, '06:45')
  assert.equal(d.segs[0].prefTimeTouched, undefined)
})
