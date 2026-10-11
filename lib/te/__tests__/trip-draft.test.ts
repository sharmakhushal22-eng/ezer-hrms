// lib/te/__tests__/trip-draft.test.ts — the planner's state.
//
// The invariant that matters most is the one the server never gets to see: a
// route of N places has N-1 ways of travelling between them. Every edit to the
// route goes through syncDraft, so every edit is tested against it.
import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import {
  addStop, autoName, blockingOn, defaultMode, errorFor, firstOpenLine, movePoint,
  newPlannerDraft, pointLabel, removePoint, setPattern, stepOfIssue, syncDraft,
  toTripDraft, worthPreviewing,
  type DraftContext, type PlannerDraft,
} from '../trip-draft.ts'
import type { TeMode, TripIssue } from '../types.ts'

const mode = (id: string, over: Partial<TeMode> = {}): TeMode => ({
  id, name: id, basis: 'bill', scopes: ['local', 'domestic', 'international'],
  gps: 'track', stops: true, ceil: 0, on: true, ...over,
})

const NAMES: Record<string, string> = { off: 'EZER office', plant: 'Manesar plant', pune: 'Pune site', mum: 'Mumbai office' }

const ctx = (over: Partial<DraftContext> = {}): DraftContext => ({
  today: '2026-11-16',
  officePlace: 'off',
  vehicles: [{ id: 'veh-1' }],
  modes: [
    mode('own', { basis: 'km', scopes: ['local', 'domestic'] }),
    mode('cab'),
    mode('flight', { basis: 'ticket', scopes: ['domestic', 'international'], gps: 'checkin', stops: false }),
    mode('train', { basis: 'ticket', scopes: ['local', 'domestic', 'international'], stops: false }),
    mode('auto', { basis: 'nobill', scopes: ['local', 'domestic'], on: false }),
  ],
  placeName: (id: string) => NAMES[id] ?? '',
  ...over,
})

const fresh = (scope: 'local' | 'domestic' | 'international' = 'domestic', c = ctx()) =>
  newPlannerDraft({ scope, origin: 'PRE_APPROVED', lastWorkday: '2026-11-13' }, c)

/** The invariant, asserted after every route edit in this file. */
function assertShape(d: PlannerDraft, where: string) {
  assert.equal(d.segs.length, d.points.length - 1, `${where}: ${d.points.length} places need ${d.points.length - 1} segments, found ${d.segs.length}`)
  assert.ok(d.points.filter(p => p.ret).length <= 1, `${where}: at most one return point`)
}

describe('a new plan', () => {
  it('starts and ends at the office, with one place still to choose', () => {
    const d = fresh()
    assertShape(d, 'new')
    assert.deepEqual(d.points.map(p => p.place), ['off', '', 'off'])
    assert.equal(d.points[2].ret, true)
    assert.equal(d.pattern, 'round')
    assert.equal(d.step, 1)
  })

  it('dates a local trip today, because it is one day', () => {
    assert.equal(fresh('local').points[0].leave, '2026-11-16')
  })

  it('dates a local trip you already did to the last working day', () => {
    const d = newPlannerDraft({ scope: 'local', origin: 'POST_FACTO', lastWorkday: '2026-11-13' }, ctx())
    assert.equal(d.points[0].leave, '2026-11-13')
  })

  it('leaves a longer trip undated: there is no sensible guess', () => {
    assert.equal(fresh('domestic').points[0].leave, '')
  })

  it('travels by own vehicle locally, by air otherwise', () => {
    assert.equal(fresh('local').segs[0].mode, 'own')
    assert.equal(fresh('local').segs[0].vehicleId, 'veh-1')
    assert.equal(fresh('domestic').segs[0].mode, 'flight')
  })

  it('falls back to a cab locally when no vehicle is on file', () => {
    const c = ctx({ vehicles: [] })
    assert.equal(defaultMode('local', c), 'cab')
    assert.equal(fresh('local', c).segs[0].mode, 'cab')
  })
})

describe('syncDraft keeps the shape', () => {
  it('gives a route of N places N-1 ways of travelling', () => {
    for (const n of [2, 3, 4, 7]) {
      const d = syncDraft({ ...fresh(), points: Array.from({ length: n }, () => ({ place: 'x', pt: '', leave: '', what: '' })) }, ctx())
      assertShape(d, `${n} points`)
    }
  })

  it('copies the way you were already travelling onto a new segment', () => {
    const base = fresh()
    const train = { ...base, segs: [{ ...base.segs[0], mode: 'train' }, { ...base.segs[1], mode: 'train' }] }
    const grown = syncDraft({ ...train, points: [...train.points, { place: 'z', pt: '', leave: '', what: '' }] }, ctx())
    assert.equal(grown.segs.length, 3)
    assert.equal(grown.segs[2].mode, 'train', 'the new leg copies the one before it, not the default')
  })

  it('replaces a mode an admin has switched off', () => {
    const d = fresh('local')
    const withOff = syncDraft({ ...d, segs: d.segs.map(s => ({ ...s, mode: 'auto' })) }, ctx())
    assert.equal(withOff.segs[0].mode, 'own', 'auto is off, so it falls back to the default')
  })

  it('replaces a mode that does not apply to this kind of trip', () => {
    const d = fresh('local')
    const flying = syncDraft({ ...d, segs: d.segs.map(s => ({ ...s, mode: 'flight' })) }, ctx())
    assert.equal(flying.segs[0].mode, 'own', 'a local trip cannot fly')
  })

  it('gives an own-vehicle segment a vehicle', () => {
    const d = fresh('local')
    const blank = syncDraft({ ...d, segs: d.segs.map(s => ({ ...s, mode: 'own', vehicleId: '' })) }, ctx())
    assert.equal(blank.segs[0].vehicleId, 'veh-1')
  })

  it('clears the vehicle when the mode is not own', () => {
    const d = fresh('domestic')
    assert.equal(d.segs[0].mode, 'flight')
    assert.equal(d.segs[0].vehicleId, '', 'a flight has no vehicle of yours')
  })

  it('nobody books a local trip for you', () => {
    const d = syncDraft({ ...fresh('local'), segs: fresh('local').segs.map(s => ({ ...s, bookedBy: 'desk' as const })) }, ctx())
    for (const s of d.segs) assert.equal(s.bookedBy, 'self')
  })

  it('mirrors the return point onto the start while retSame holds', () => {
    const d = fresh()
    const moved = syncDraft({ ...d, points: [{ ...d.points[0], place: 'plant', pt: 'factory' }, d.points[1], d.points[2]] }, ctx())
    assert.equal(moved.points[2].place, 'plant')
    assert.equal(moved.points[2].pt, 'factory')
  })

  it('leaves the return point alone once retSame is off', () => {
    const d = { ...fresh(), retSame: false }
    const moved = syncDraft({ ...d, points: [{ ...d.points[0], place: 'plant' }, d.points[1], { ...d.points[2], place: 'mum' }] }, ctx())
    assert.equal(moved.points[2].place, 'mum', 'you can come back somewhere else')
  })

  it('reads the pattern off the route rather than being told it', () => {
    const d = fresh()
    assert.equal(d.pattern, 'round')
    assert.equal(setPattern(d, 'oneway', ctx()).pattern, 'oneway')
    const two = addStop(d, 1, ctx())
    assert.equal(two.pattern, 'multi', 'two destinations make it multi-city')
  })

  it('keeps the roster the same length as the head count', () => {
    const c = ctx()
    assert.equal(syncDraft({ ...fresh(), pax: 3 }, c).people.length, 2)
    assert.equal(syncDraft({ ...fresh(), pax: 1 }, c).people.length, 0)
    // Shrinking drops the people off the end, it does not forget the first ones.
    const three = syncDraft({ ...fresh(), pax: 3, people: [{ id: 'A1', name: 'Ann' }, { id: 'B2', name: 'Bob' }] }, c)
    const two = syncDraft({ ...three, pax: 2 }, c)
    assert.deepEqual(two.people.map(p => p.id), ['A1'])
  })

  it('clamps the head count to something a trip can be', () => {
    const c = ctx()
    assert.equal(syncDraft({ ...fresh(), pax: 0 }, c).pax, 1)
    assert.equal(syncDraft({ ...fresh(), pax: -4 }, c).pax, 1)
    assert.equal(syncDraft({ ...fresh(), pax: 900 }, c).pax, 20)
  })
})

describe('the generated name', () => {
  it('names the trip after where it goes and why', () => {
    assert.equal(autoName('Audit or inspection', ['Manesar plant']), 'Manesar plant audit')
    assert.equal(autoName('Client meeting', ['Pune site', 'Mumbai office']), 'Pune site and Mumbai office client meeting')
    assert.equal(autoName('Other', ['Pune site']), 'Pune site trip')
  })

  it('falls back to the reason when nowhere is chosen, but never to "Other"', () => {
    assert.equal(autoName('Audit or inspection', []), 'Audit or inspection')
    assert.equal(autoName('Other', []), '')
    assert.equal(autoName('', []), '')
  })

  it('keeps the name inside the limit the server enforces', () => {
    const long = autoName('Client meeting', ['A very long place name indeed that goes on', 'And another one entirely'])
    assert.ok(long.length <= 60, `got ${long.length}`)
    assert.ok(long.endsWith('…'))
  })

  it('fills the name in from the route until you type one', () => {
    const d = fresh()
    const withPlace = syncDraft({ ...d, purpose: 'Audit or inspection', points: [d.points[0], { ...d.points[1], place: 'plant' }, d.points[2]] }, ctx())
    assert.equal(withPlace.name, 'Manesar plant audit')
  })

  it('stops rewriting the name the moment you touch it', () => {
    const d = fresh()
    const typed = syncDraft({ ...d, nameTouched: true, name: 'My own name', purpose: 'Audit or inspection', points: [d.points[0], { ...d.points[1], place: 'plant' }, d.points[2]] }, ctx())
    assert.equal(typed.name, 'My own name')
  })
})

describe('editing the route', () => {
  it('adds a stop with a way to reach it', () => {
    const d = addStop(fresh(), 1, ctx())
    assertShape(d, 'after addStop')
    assert.equal(d.points.length, 4)
    assert.equal(d.open, 'p2', 'the new stop opens for editing')
  })

  it('removes a stop and the travel that led to it', () => {
    const three = addStop(fresh(), 1, ctx())
    const back = removePoint(three, 2, ctx())
    assertShape(back, 'after removePoint')
    assert.equal(back.points.length, 3)
    assert.equal(back.open, null, 'closing all of them is deliberate, not "open the next"')
  })

  it('turns a round trip into a one-way and back', () => {
    const c = ctx()
    const one = setPattern(fresh(), 'oneway', c)
    assertShape(one, 'oneway')
    assert.equal(one.points.some(p => p.ret), false)
    const round = setPattern(one, 'round', c)
    assertShape(round, 'round again')
    assert.equal(round.points.filter(p => p.ret).length, 1)
    assert.equal(round.points[round.points.length - 1].place, 'off', 'you come back to where you started')
  })

  it('does nothing when the pattern is already what you asked for', () => {
    const d = fresh()
    assert.equal(setPattern(d, 'round', ctx()), d, 'the same object: React should not repaint')
  })

  it('swaps two destinations without moving how you travel', () => {
    const c = ctx()
    const two = addStop(fresh(), 1, c)
    const named = syncDraft({ ...two, points: two.points.map((p, i) => (i === 1 ? { ...p, place: 'plant' } : i === 2 ? { ...p, place: 'pune' } : p)) }, c)
    const moved = movePoint(named, 1, 1, c)
    assertShape(moved, 'after movePoint')
    assert.deepEqual(moved.points.map(p => p.place), ['off', 'pune', 'plant', 'off'])
  })

  it('refuses to move the start or the return out of place', () => {
    const c = ctx()
    const d = fresh()
    assert.equal(movePoint(d, 0, 1, c), d, 'the start stays the start')
    assert.equal(movePoint(d, 1, 1, c), d, 'a destination cannot swap with the return')
    assert.equal(movePoint(d, 2, 1, c), d, 'nothing comes after coming back')
    assert.equal(movePoint(d, 1, -1, c), d, 'nothing comes before the start')
  })
})

describe('what a route line is called', () => {
  it('names the start, the destination and the way back', () => {
    const d = fresh()
    assert.equal(pointLabel(d, 0).label, 'Start')
    assert.equal(pointLabel(d, 1).label, 'Destination')
    assert.equal(pointLabel(d, 2).label, 'Back to')
  })

  it('numbers the stops, and only the last place is the destination', () => {
    const two = addStop(fresh(), 1, ctx())
    assert.equal(pointLabel(two, 1).label, 'Stop 1')
    assert.equal(pointLabel(two, 1).isStop, true)
    assert.equal(pointLabel(two, 2).label, 'Destination')
    assert.equal(pointLabel(two, 2).isStop, false)
    assert.equal(pointLabel(two, 2).last, 2)
  })
})

describe('where a refusal belongs', () => {
  it('sends each key to the step that can fix it', () => {
    for (const k of ['scope', 'purpose', 'name', 'pax']) assert.equal(stepOfIssue(k), 1, k)
    for (const k of ['p0', 'p12', 'm1', 'd0', 'd3', 'pr']) assert.equal(stepOfIssue(k), 2, k)
    for (const k of ['pf', 'adv']) assert.equal(stepOfIssue(k), 3, k)
  })

  it('puts a refusal with no field of its own on the last step', () => {
    // These have nowhere to sit, so the summary on step 3 is where they show.
    assert.equal(stepOfIssue(undefined), 3)
    assert.equal(stepOfIssue(''), 3)
  })

  it('says nothing until the person has tried to move on', () => {
    const issues: TripIssue[] = [{ block: true, t: 'Give the trip a name.', k: 'name' }]
    assert.equal(errorFor(issues, 'name', false), '')
    assert.equal(errorFor(issues, 'name', undefined), '')
    assert.equal(errorFor(issues, 'name', true), 'Give the trip a name.')
  })

  it('ignores a warning that does not block', () => {
    const issues: TripIssue[] = [{ block: false, t: 'Less than 3 days notice.', k: 'd0' }]
    assert.equal(errorFor(issues, 'd0', true), '')
    assert.deepEqual(blockingOn(issues, 2), [])
  })

  it('groups what blocks each step', () => {
    const issues: TripIssue[] = [
      { block: true, t: 'Give the trip a name.', k: 'name' },
      { block: true, t: 'Choose where you go.', k: 'p1' },
      { block: true, t: 'Choose how you travel.', k: 'm0' },
      { block: false, t: 'just a warning', k: 'p1' },
      { block: true, t: 'no key at all', k: undefined },
    ]
    assert.deepEqual(blockingOn(issues, 1).map(i => i.k), ['name'])
    assert.deepEqual(blockingOn(issues, 2).map(i => i.k), ['p1', 'm0'])
    assert.deepEqual(blockingOn(issues, 3).map(i => i.t), ['no key at all'])
  })
})

describe('which line to open next', () => {
  const issues: TripIssue[] = [
    { block: true, t: 'a', k: 'p1' },
    { block: true, t: 'b', k: 'm1' },
    { block: true, t: 'c', k: 'p2' },
  ]

  it('opens the first line that still needs something', () => {
    assert.equal(firstOpenLine(issues), 'p1')
  })

  it('moves forward past the line just finished, never back to it', () => {
    assert.equal(firstOpenLine(issues, 'p1'), 's1', 'the travel after point 1 comes next')
    assert.equal(firstOpenLine(issues, 's1'), 'p2')
    assert.equal(firstOpenLine(issues, 'p2'), null, 'nothing left to open')
  })

  it('maps a travel refusal onto the travel line, not the place', () => {
    assert.equal(firstOpenLine([{ block: true, t: 'x', k: 'm3' }]), 's3')
  })

  it('sends a date problem to the place that owns the date', () => {
    assert.equal(firstOpenLine([{ block: true, t: 'x', k: 'd2' }]), 'p2')
  })

  it('ignores the trip-wide date, which is not on any line', () => {
    // d0 is the date field above the list, not a route row.
    assert.equal(firstOpenLine([{ block: true, t: 'x', k: 'd0' }]), null)
  })

  it('ignores warnings and keyless refusals', () => {
    assert.equal(firstOpenLine([{ block: false, t: 'x', k: 'p1' }]), null)
    assert.equal(firstOpenLine([{ block: true, t: 'x' }]), null)
  })
})

describe('what gets sent to the server', () => {
  it('tidies the people: upper-case ids, trimmed names, blanks dropped', () => {
    const d = syncDraft({ ...fresh(), pax: 3, people: [{ id: ' srs0533 ', name: '  Priya Nair ' }, { id: '', name: '' }] }, ctx())
    assert.deepEqual(toTripDraft(d).people, [{ id: 'SRS0533', name: 'Priya Nair' }])
  })

  it('a local trip has no hotel and no advance, whatever the form says', () => {
    const d = { ...fresh('local'), stayBy: 'desk' as const, advance: 5000 }
    const sent = toTripDraft(d)
    assert.equal(sent.stayBy, 'self')
    assert.equal(sent.advance, 0)
  })

  it('keeps the hotel and advance of a longer trip', () => {
    const d = { ...fresh('domestic'), stayBy: 'desk' as const, advance: 5000 }
    const sent = toTripDraft(d)
    assert.equal(sent.stayBy, 'desk')
    assert.equal(sent.advance, 5000)
  })

  it('sends an empty advance as nothing owed, not as NaN', () => {
    assert.equal(toTripDraft({ ...fresh('domestic'), advance: '' }).advance, 0)
  })

  it('sends the id only when editing an existing trip', () => {
    assert.equal(toTripDraft(fresh()).id, undefined)
    assert.equal(toTripDraft({ ...fresh(), editId: 'trip-9' }).id, 'trip-9')
  })

  it('marks the return point so the server knows which one it is', () => {
    const sent = toTripDraft(fresh())
    assert.equal(sent.points[2].ret, true)
    assert.equal(sent.points[0].ret, undefined)
  })

  it('sends a segment with no vehicle as null, not an empty string', () => {
    assert.equal(toTripDraft(fresh('domestic')).segs[0].vehicleId, null)
    assert.equal(toTripDraft(fresh('local')).segs[0].vehicleId, 'veh-1')
  })
})

describe('worthPreviewing', () => {
  it('waits until there is a start and somewhere to go', () => {
    const d = fresh()
    assert.equal(worthPreviewing(d), false, 'nowhere chosen yet')
    const c = ctx()
    const going = syncDraft({ ...d, points: [d.points[0], { ...d.points[1], place: 'plant' }, d.points[2]] }, c)
    assert.equal(worthPreviewing(going), true)
  })

  it('does not count the place you come back to as somewhere to go', () => {
    const d = fresh()
    assert.equal(worthPreviewing({ ...d, points: [d.points[0], { ...d.points[1], place: '' }, { ...d.points[2], place: 'off' }] }), false)
  })
})
