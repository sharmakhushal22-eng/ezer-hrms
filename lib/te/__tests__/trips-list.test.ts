// lib/te/__tests__/trips-list.test.ts — grouping and wording the trips list.
//
// The grouping is the part worth pinning down: a trip approved for next week
// and one approved for this morning are the SAME state and belong under
// different headings, which is exactly the kind of rule that rots quietly.
import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { groupTrips, myTrips, scopeCounts, tripChip, tripGroup, tripMoney, TRIP_GROUPS, linesWaitingInTrips } from '../trips-list.ts'
import type { TeTrip, TripDisplayStatus } from '../types.ts'

const TODAY = '2026-11-16'

const trip = (over: Partial<TeTrip> & { id: string }): TeTrip => ({
  no: 'TRP-1', emp: 'me', co: [], status: 'APPROVED', display: 'APPROVED',
  origin: 'PRE_APPROVED', name: 'A trip', scope: 'local', pattern: 'round',
  purpose: '', project: '', points: [], segs: [], pax: 1, people: [],
  start: TODAY, end: TODAY, from: '', to: '', fromPlace: null, type: 'domestic', country: '',
  estimate: { travel: 0, desk: 0, hotel: 0, meals: 0, conv: 0 }, estimateTotal: 0, selfEstimate: 0,
  plannedKm: 0, stayBy: 'self', advance: 0, pfReason: '', pfNote: '', legIds: [], chain: [],
  why: [], createdAt: '', approvedAt: null,
  ...over,
} as TeTrip)

describe('which heading a trip sits under', () => {
  it('puts a trip you are on under "Now and today"', () => {
    assert.equal(tripGroup(trip({ id: 't', display: 'ONGOING', start: '2026-11-01' }), TODAY), 'now')
  })

  it('moves an approved trip to "Now" the day it starts, not before', () => {
    // The same state, two headings — this is the whole point of the function.
    assert.equal(tripGroup(trip({ id: 't', display: 'APPROVED', start: '2026-11-20' }), TODAY), 'next')
    assert.equal(tripGroup(trip({ id: 't', display: 'APPROVED', start: TODAY }), TODAY), 'now')
    assert.equal(tripGroup(trip({ id: 't', display: 'APPROVED', start: '2026-11-10' }), TODAY), 'now')
  })

  it('keeps an approved trip with no date out of "Now"', () => {
    assert.equal(tripGroup(trip({ id: 't', display: 'APPROVED', start: null }), TODAY), 'next')
  })

  it('counts waiting and sent-back as still ahead of you', () => {
    assert.equal(tripGroup(trip({ id: 't', display: 'PENDING_APPROVAL' }), TODAY), 'next')
    assert.equal(tripGroup(trip({ id: 't', display: 'SENT_BACK' }), TODAY), 'next')
  })

  it('treats a trip you are back from as work, not history', () => {
    for (const st of ['COMPLETED', 'MISSED', 'DRAFT'] as TripDisplayStatus[]) {
      assert.equal(tripGroup(trip({ id: 't', display: st }), TODAY), 'claim', st)
    }
  })

  it('files everything finished under "Done"', () => {
    for (const st of ['CLAIMED', 'CLOSED', 'CANCELLED', 'REJECTED', 'EXPIRED'] as TripDisplayStatus[]) {
      assert.equal(tripGroup(trip({ id: 't', display: st }), TODAY), 'done', st)
    }
  })
})

describe('the chip on a trip', () => {
  it('does not claim somebody approved a trip nobody had to approve', () => {
    // A short local trip has an empty chain. "Approved" would send the person
    // looking for an approver who was never involved.
    assert.deepEqual(tripChip({ display: 'APPROVED', chain: [] }), { label: 'Ready, no approval needed', tone: 't-brand' })
  })

  it('says Approved when somebody actually did', () => {
    const withChain = { display: 'APPROVED' as const, chain: [{ role: 'R1' }] as TeTrip['chain'] }
    assert.deepEqual(tripChip(withChain), { label: 'Approved', tone: 't-brand' })
  })

  it('words each state the way the employee thinks of it', () => {
    assert.deepEqual(tripChip({ display: 'PENDING_APPROVAL', chain: [] }), { label: 'Waiting for approval', tone: 't-warn' })
    assert.deepEqual(tripChip({ display: 'COMPLETED', chain: [] }), { label: 'Back, close and claim', tone: 't-info' })
    assert.deepEqual(tripChip({ display: 'CLOSED', chain: [] }), { label: 'Closed', tone: 't-pos' })
    assert.deepEqual(tripChip({ display: 'EXPIRED', chain: [] }), { label: 'Expired', tone: 't-crit' })
    assert.deepEqual(tripChip({ display: 'ONGOING', chain: [] }), { label: 'On the trip', tone: 't-info' })
  })

  it('falls back to readable words for a state it has no wording for', () => {
    const odd = tripChip({ display: 'SOMETHING_NEW' as TripDisplayStatus, chain: [] })
    assert.equal(odd.label, 'something new')
    assert.equal(odd.tone, 'plain')
  })
})

describe('the money against a trip', () => {
  const t = trip({ id: 't1', selfEstimate: 9000 })

  it('is an estimate before anything has been spent', () => {
    assert.deepEqual(tripMoney(t, [], []), { value: 9000, label: 'estimate' })
  })

  it('becomes what is ready to claim once lines are saved', () => {
    const lines = [{ tripId: 't1', status: 'UNCLAIMED' as const, claimed: 1200 }, { tripId: 't1', status: 'UNCLAIMED' as const, claimed: 300 }]
    assert.deepEqual(tripMoney(t, [], lines), { value: 1500, label: 'to claim' })
  })

  it('ignores lines that are already in a claim', () => {
    const lines = [{ tripId: 't1', status: 'CLAIMED' as const, claimed: 1200 }]
    assert.deepEqual(tripMoney(t, [], lines), { value: 9000, label: 'estimate' })
  })

  it('becomes the claim once there is one, and says paid when it is settled', () => {
    assert.deepEqual(tripMoney(t, [{ tripId: 't1', status: 'IN_APPROVAL', approved: 0, claimed: 4000 }], []), { value: 0, label: 'claimed' })
    assert.deepEqual(tripMoney(t, [{ tripId: 't1', status: 'SETTLED', approved: 3800, claimed: 4000 }], []), { value: 3800, label: 'paid' })
  })

  it('ignores a claim that was taken back', () => {
    assert.deepEqual(tripMoney(t, [{ tripId: 't1', status: 'CANCELLED', approved: 4000, claimed: 4000 }], []), { value: 9000, label: 'estimate' })
  })

  it('ignores another trip’s claim and another trip’s lines', () => {
    assert.deepEqual(tripMoney(t, [{ tripId: 'other', status: 'SETTLED', approved: 99, claimed: 99 }], [{ tripId: 'other', status: 'UNCLAIMED', claimed: 50 }]), { value: 9000, label: 'estimate' })
  })
})

describe('the list itself', () => {
  const trips = [
    trip({ id: 'a', display: 'ONGOING', scope: 'local', start: '2026-11-15' }),
    trip({ id: 'b', display: 'APPROVED', scope: 'domestic', start: '2026-12-01' }),
    trip({ id: 'c', display: 'COMPLETED', scope: 'domestic', start: '2026-11-02' }),
    trip({ id: 'd', display: 'CLOSED', scope: 'international', start: '2026-10-01' }),
  ]

  it('counts each kind for the filter', () => {
    assert.deepEqual(scopeCounts(trips), { all: 4, local: 1, domestic: 2, international: 1 })
  })

  it('leaves out a heading with nothing under it', () => {
    const groups = groupTrips(trips, TODAY)
    assert.deepEqual(groups.map(g => g.id), ['now', 'next', 'claim', 'done'])
    const onlyDone = groupTrips([trips[3]], TODAY)
    assert.deepEqual(onlyDone.map(g => g.id), ['done'], 'an empty heading is not drawn')
  })

  it('keeps the headings in their own order, not the trips’', () => {
    const shuffled = [trips[3], trips[1], trips[0], trips[2]]
    assert.deepEqual(groupTrips(shuffled, TODAY).map(g => g.id), TRIP_GROUPS.map(g => g.id))
  })

  it('shows my trips, newest first', () => {
    const mixed = [...trips, trip({ id: 'theirs', emp: 'someone-else', start: '2026-12-31' })]
    assert.deepEqual(myTrips(mixed, 'me', null).map(t => t.id), ['b', 'a', 'c', 'd'])
  })

  it('filters to one kind when asked', () => {
    assert.deepEqual(myTrips(trips, 'me', 'domestic').map(t => t.id), ['b', 'c'])
  })

  it('sorts an undated trip last rather than dropping it', () => {
    const undated = trip({ id: 'z', start: null, display: 'DRAFT' })
    assert.deepEqual(myTrips([undated, trips[0]], 'me', null).map(t => t.id), ['a', 'z'])
  })

  it('shows a trip I was taken on, and still not one I have nothing to do with', () => {
    // The whole reason co-travellers exist: somebody else planned it, I am on
    // it, and for a long time it appeared nowhere on my own screen.
    const taken = trip({ id: 'with-me', emp: 'someone-else', co: ['me'], start: '2026-12-10' })
    const notMine = trip({ id: 'nothing-to-do-with-me', emp: 'someone-else', co: ['asha'], start: '2026-12-31' })
    // It sorts in among my own by date like any other trip, and the one I am
    // not on stays out however recent it is.
    assert.deepEqual(
      myTrips([...trips, taken, notMine], 'me', null).map(t => t.id),
      ['with-me', 'b', 'a', 'c', 'd'],
    )
  })

  it('filters a trip I was taken on by kind like any other', () => {
    const taken = trip({ id: 'with-me', emp: 'someone-else', co: ['me'], scope: 'international' })
    assert.deepEqual(myTrips([...trips, taken], 'me', 'international').map(t => t.id), ['with-me', 'd'])
  })
})

describe('lines waiting inside trips', () => {
  const trips = [{ id: 't1', name: 'Pune factory' }, { id: 't2', name: 'Delhi review' }]
  const line = (over: Partial<{ tripId: string | null; status: string; other: boolean; claimed: number }> = {}) =>
    ({ tripId: 't1', status: 'UNCLAIMED', claimed: 100, ...over })

  it('groups my unclaimed trip lines by trip, with counts and totals', () => {
    const out = linesWaitingInTrips(
      [line(), line({ claimed: 50 }), line({ tripId: 't2', claimed: 400 })],
      trips,
    )
    assert.deepEqual(out, [
      { tripId: 't2', name: 'Delhi review', count: 1, total: 400 },
      { tripId: 't1', name: 'Pune factory', count: 2, total: 150 },
    ])
  })

  it('ignores lines with no trip, which are the monthly claim itself', () => {
    assert.deepEqual(linesWaitingInTrips([line({ tripId: null })], trips), [])
  })

  it('ignores lines already on a claim', () => {
    assert.deepEqual(linesWaitingInTrips([line({ status: 'CLAIMED' })], trips), [])
  })

  it("ignores a colleague's line, which is never mine to claim", () => {
    // Those are in the snapshot only so the server can spot duplicates.
    assert.deepEqual(linesWaitingInTrips([line({ other: true })], trips), [])
  })

  it('still lists lines whose trip is not in the snapshot', () => {
    // Hiding them is exactly the bug this card exists to prevent.
    const out = linesWaitingInTrips([line({ tripId: 'gone' })], trips)
    assert.equal(out.length, 1)
    assert.equal(out[0].name, 'A trip')
  })

  it('treats a missing amount as nothing rather than NaN', () => {
    const out = linesWaitingInTrips([{ tripId: 't1', status: 'UNCLAIMED' }], trips)
    assert.equal(out[0].total, 0)
  })
})
