// lib/te/__tests__/entry-flow.test.ts — the option sheet's wording and ordering.
//
// These assertions are the prototype's kindNow / wayOff (ui-09-entry-flow.js)
// read back: one row per trip, the most urgent reason only, and a way turned off
// by the company's settings says which setting did it.
import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import {
  approvedTrips, continueItems, currentLeg, flowSteps, legsOf, legTitle,
  routeText, tripDates, wayCount, wayOff, FLOW_WAYS,
  type EntryFacts,
} from '../entry-flow.ts'
import type { TeLeg, TeTrip, TripDisplayStatus, TripOrigin } from '../types.ts'

const ME = 'emp-1'
const TODAY = '2026-11-16'

const PLACES: Record<string, string> = { p1: 'EZER office', p2: 'Manesar plant', p3: 'Home', p4: 'Dubai' }
const placeName = (id: string) => PLACES[id] ?? ''
const modeName = (id: string) => ({ own: 'Own vehicle', flight: 'Flight' })[id] ?? ''

function trip(over: Partial<TeTrip> & { id: string }): TeTrip {
  return {
    no: 'TRP-1', emp: ME, co: [], status: 'APPROVED', display: 'APPROVED',
    origin: 'PRE_APPROVED' as TripOrigin, name: 'Manesar plant audit', scope: 'local',
    pattern: 'return', purpose: '', project: '', points: [], segs: [], pax: 1, people: [],
    start: TODAY, end: TODAY, from: '', to: '', fromPlace: null, type: 'domestic', country: '',
    estimate: { travel: 0, desk: 0, hotel: 0, meals: 0, conv: 0 }, estimateTotal: 0, selfEstimate: 0,
    plannedKm: 0, stayBy: 'self', advance: 0, pfReason: '', pfNote: '', legIds: [], chain: [],
    why: [], createdAt: '', approvedAt: null,
    ...over,
  } as TeTrip
}

function leg(over: Partial<TeLeg> & { id: string; tripId: string; n: number }): TeLeg {
  return {
    emp: ME, seg: null, kind: 'travel', from: 'p1', to: 'p2', date: TODAY, purpose: '', why: '',
    mode: 'own', vehicleId: null, bookedBy: 'self', gps: 'track', plannedKm: 0, status: 'PLANNED',
    startedAt: null, endedAt: null, filedAt: null, manual: false, noGps: '', skipReason: '',
    addedWhy: '', expenseId: null, stats: null, gpsKm: null, routeKm: null, payKm: null,
    ...over,
  } as TeLeg
}

const facts = (trips: TeTrip[], journeys: TeLeg[]): EntryFacts =>
  ({ me: ME, today: TODAY, trips, journeys, placeName, modeName })

describe('continueItems', () => {
  it("offers today's leg of an approved trip, counted against the trip's legs", () => {
    const t = trip({ id: 't1' })
    const js = [leg({ id: 'j1', tripId: 't1', n: 1 }), leg({ id: 'j2', tripId: 't1', n: 2, date: '2026-11-17' })]
    const [row] = continueItems('local', facts([t], js))
    assert.equal(row.title, 'Ready today: journey 1 of 2')
    assert.equal(row.sub, 'EZER office → Manesar plant · Own vehicle')
    assert.equal(row.btn, 'Start journey')
    assert.equal(row.action, 'legStart')
    assert.equal(row.id, 'j1')
    assert.equal(row.tone, 'go')
    assert.equal(row.trip, 'Manesar plant audit')
  })

  it('says "Check in" instead of "Start leg" when the leg is a check-in leg', () => {
    const js = [leg({ id: 'j1', tripId: 't1', n: 1, gps: 'checkin' })]
    assert.equal(continueItems('local', facts([trip({ id: 't1' })], js))[0].btn, 'Check in')
  })

  it("does not offer a later leg while an earlier one is still open", () => {
    // Leg 2 is today, leg 1 is still PLANNED from yesterday: legs travel in order,
    // so nothing is offered rather than leg 2.
    const js = [
      leg({ id: 'j1', tripId: 't1', n: 1, date: '2026-11-15' }),
      leg({ id: 'j2', tripId: 't1', n: 2, date: TODAY }),
    ]
    assert.deepEqual(continueItems('local', facts([trip({ id: 't1' })], js)), [])
  })

  it('puts a running leg ahead of everything else on that trip', () => {
    const js = [
      leg({ id: 'j1', tripId: 't1', n: 1, status: 'ACTIVE' }),
      leg({ id: 'j2', tripId: 't1', n: 2, date: TODAY }),
    ]
    const [row] = continueItems('local', facts([trip({ id: 't1', display: 'ONGOING' })], js))
    assert.equal(row.tone, 'live')
    assert.equal(row.title, 'On the way: journey 1')
    assert.equal(row.action, 'legOpen')
  })

  it("ignores a colleague's running leg", () => {
    // The running leg belongs to someone else, so my trip's own leg is what is offered.
    const js = [
      leg({ id: 'other', tripId: 't9', n: 1, status: 'ACTIVE', emp: 'emp-2' }),
      leg({ id: 'j1', tripId: 't1', n: 1 }),
    ]
    assert.equal(continueItems('local', facts([trip({ id: 't1' })], js))[0].tone, 'go')
  })

  it('asks for the report of an ended leg before anything else', () => {
    const js = [leg({ id: 'j1', tripId: 't1', n: 1, status: 'ENDED' })]
    const [row] = continueItems('local', facts([trip({ id: 't1', display: 'ONGOING' })], js))
    assert.equal(row.title, 'Journey 1 ended. Save its report')
    assert.equal(row.btn, 'Save report')
  })

  const byDisplay: [TripDisplayStatus, string, string][] = [
    ['COMPLETED', 'Back. Send the claim', '2 journeys closed'],
    ['MISSED', 'Not travelled on 16 Nov', 'Add the journeys without GPS, or remove it'],
    ['SENT_BACK', 'Your approver asked a question', 'Answer and send it again'],
  ]
  for (const [display, title, sub] of byDisplay) {
    it(`words a ${display} trip as "${title}"`, () => {
      const js = [leg({ id: 'j1', tripId: 't1', n: 1, status: 'SUBMITTED' }), leg({ id: 'j2', tripId: 't1', n: 2, status: 'SUBMITTED' })]
      const [row] = continueItems('local', facts([trip({ id: 't1', display })], js))
      assert.equal(row.title, title)
      assert.equal(row.sub, sub)
      assert.equal(row.action, 'openTrip')
      assert.equal(row.id, 't1')
    })
  }

  it('asks a post-facto draft for its fares', () => {
    const t = trip({ id: 't1', display: 'DRAFT', origin: 'POST_FACTO' })
    const [row] = continueItems('local', facts([t], [leg({ id: 'j1', tripId: 't1', n: 1 })]))
    assert.equal(row.title, 'Recorded after travel: add the fares')
    assert.equal(row.sub, '1 journey')
  })

  it('says nothing about a plain draft, or a trip waiting for approval', () => {
    const quiet: TripDisplayStatus[] = ['DRAFT', 'PENDING_APPROVAL', 'CLAIMED', 'CLOSED', 'CANCELLED', 'REJECTED', 'EXPIRED']
    for (const display of quiet) {
      assert.deepEqual(continueItems('local', facts([trip({ id: 't1', display })], [])), [], display)
    }
  })

  it('keeps to one kind, and to my own trips', () => {
    const mine = trip({ id: 't1', display: 'COMPLETED' })
    const theirs = trip({ id: 't2', display: 'COMPLETED', emp: 'emp-2' })
    const abroad = trip({ id: 't3', display: 'COMPLETED', scope: 'international' })
    const rows = continueItems('local', facts([mine, theirs, abroad], []))
    assert.deepEqual(rows.map(r => r.tripId), ['t1'])
  })

  it('gives one row per trip, never two reasons for the same trip', () => {
    // An ended leg AND a leg due today: only the report is asked for.
    const js = [leg({ id: 'j1', tripId: 't1', n: 1, status: 'ENDED' }), leg({ id: 'j2', tripId: 't1', n: 2, date: TODAY })]
    assert.equal(continueItems('local', facts([trip({ id: 't1' })], js)).length, 1)
  })
})

describe('wayOff', () => {
  const base = { manualAllowed: true, postFacto: 'allowed' as const, savedBills: 2, approved: 1 }

  it('lets everything through when the company allows it', () => {
    for (const w of FLOW_WAYS.local) assert.equal(wayOff('local', w.id, base), '')
    for (const w of FLOW_WAYS.domestic) assert.equal(wayOff('domestic', w.id, base), '')
  })

  it('blocks a past local trip when the company wants GPS', () => {
    assert.equal(wayOff('local', 'past', { ...base, manualAllowed: false }), 'Your company accepts local trips only with GPS.')
    // Only local: the postFacto setting governs the other kinds.
    assert.equal(wayOff('domestic', 'past', { ...base, manualAllowed: false }), '')
  })

  it('blocks a past trip elsewhere when approval is always needed', () => {
    assert.equal(wayOff('domestic', 'past', { ...base, postFacto: 'blocked' }), 'Your company needs approval before every trip.')
    assert.equal(wayOff('domestic', 'past', { ...base, postFacto: 'limited' }), '')
  })

  it('names the kind when there is no approved trip to start', () => {
    assert.equal(wayOff('domestic', 'approved', { ...base, approved: 0 }), 'No approved domestic trip yet. Plan one first.')
    assert.equal(wayOff('international', 'approved', { ...base, approved: 0 }), 'No approved international trip yet. Plan one first.')
  })

  it('blocks submitting when nothing is saved', () => {
    assert.equal(wayOff('other', 'submit', { ...base, savedBills: 0 }), 'No saved bills yet. Add one first.')
  })
})

describe('the ways themselves', () => {
  it('offers "Start now" first for a local trip and "Plan a trip" first elsewhere', () => {
    assert.equal(FLOW_WAYS.local[0].id, 'start')
    assert.equal(FLOW_WAYS.domestic[0].id, 'plan')
    assert.equal(FLOW_WAYS.international[0].id, 'plan')
  })

  it('has no "Start an approved trip" for a local trip: a local trip starts now', () => {
    assert.equal(FLOW_WAYS.local.some(w => w.id === 'approved'), false)
  })

  it('badges only the counted ways', () => {
    const f = { savedBills: 3, approved: 2 }
    assert.equal(wayCount('approved', f), 2)
    assert.equal(wayCount('submit', f), 3)
    assert.equal(wayCount('plan', f), 0)
    assert.equal(wayCount('start', f), 0)
    assert.equal(wayCount('past', f), 0)
  })
})

describe('flowSteps', () => {
  it('words the third step differently when the way is an approved trip', () => {
    assert.deepEqual(flowSteps('international', 'approved'), [
      { small: 'What', label: 'International trip' },
      { small: 'How', label: 'Start an approved trip' },
      { small: 'Details', label: 'Choose the trip' },
    ])
  })

  it('says "Choose" for what has not been chosen yet', () => {
    assert.deepEqual(flowSteps('local', null).map(s => s.label), ['Local trip', 'Choose', 'Fill the form'])
    assert.deepEqual(flowSteps(null, null).map(s => s.label), ['Choose', 'Choose', 'Fill the form'])
  })
})

describe('the small wordings', () => {
  it('reads a trip as its points in order', () => {
    const t = trip({ id: 't1', points: [{ place: 'p3', pt: '', what: '', arrive: '', leave: '' }, { place: 'p4', pt: '', what: '', arrive: '', leave: '' }, { place: 'p3', pt: '', what: '', arrive: '', leave: '' }] })
    assert.equal(routeText(t, placeName), 'Home → Dubai → Home')
  })

  it('marks a point whose place is not known yet', () => {
    const t = trip({ id: 't1', points: [{ place: 'p3', pt: '', what: '', arrive: '', leave: '' }, { place: 'nope', pt: '', what: '', arrive: '', leave: '' }] })
    assert.equal(routeText(t, placeName), 'Home → …')
  })

  it('shows one date for a same-day trip and a range otherwise', () => {
    assert.equal(tripDates({ start: '2026-12-07', end: '2026-12-07' }), '7 Dec')
    assert.equal(tripDates({ start: '2026-12-07', end: '2026-12-10' }), '7 Dec to 10 Dec')
    assert.equal(tripDates({ start: null, end: null }), '')
  })

  it('titles a leg from where to where', () => {
    assert.equal(legTitle({ from: 'p1', to: 'p2' }, placeName), 'EZER office → Manesar plant')
  })

  it('orders a trip’s legs by their number, whatever order they arrive in', () => {
    const js = [leg({ id: 'b', tripId: 't1', n: 2 }), leg({ id: 'a', tripId: 't1', n: 1 }), leg({ id: 'x', tripId: 't2', n: 1 })]
    assert.deepEqual(legsOf({ id: 't1' }, js).map(j => j.id), ['a', 'b'])
  })

  it('calls the open leg current, else the next planned one', () => {
    const planned = [leg({ id: 'a', tripId: 't1', n: 1 }), leg({ id: 'b', tripId: 't1', n: 2 })]
    assert.equal(currentLeg(planned)?.id, 'a')
    const running = [leg({ id: 'a', tripId: 't1', n: 1, status: 'SUBMITTED' }), leg({ id: 'b', tripId: 't1', n: 2, status: 'ACTIVE' })]
    assert.equal(currentLeg(running)?.id, 'b')
    assert.equal(currentLeg([leg({ id: 'a', tripId: 't1', n: 1, status: 'CANCELLED' })]), null)
  })
})

describe('approvedTrips', () => {
  it('is the approved and ongoing trips of that kind, mine only', () => {
    const list = [
      trip({ id: 'a', scope: 'domestic', display: 'APPROVED' }),
      trip({ id: 'b', scope: 'domestic', display: 'ONGOING' }),
      trip({ id: 'c', scope: 'domestic', display: 'PENDING_APPROVAL' }),
      trip({ id: 'd', scope: 'local', display: 'APPROVED' }),
      trip({ id: 'e', scope: 'domestic', display: 'APPROVED', emp: 'emp-2' }),
    ]
    assert.deepEqual(approvedTrips('domestic', { me: ME, trips: list }).map(t => t.id), ['a', 'b'])
  })
})
