// lib/te/__tests__/desk-buckets.test.ts — the desk's work, gathered by trip.
//
// THE ONE THAT WOULD FAIL SILENTLY. Four of the five lists carry `trip_id`;
// DeskStay carries `id` as the trip id and `name` as the trip name, because it
// is a row OF a trip rather than a row ABOUT one. Grouping on `trip_id` alone
// compiles, runs, and drops every hotel row into a bucket keyed `undefined` —
// so the hotels quietly disappear from the view built to show them, and the one
// room whose work is most time-sensitive looks empty.
import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { deskBuckets, focusDeskRows, journeyBuckets, journeyRank } from '../desk-buckets.ts'
import type { DeskBooked, DeskJourney, DeskStay, DeskToBook, DeskWatch } from '../client.ts'

const stay = (over: Partial<DeskStay>): DeskStay => ({
  id: 't1', trip_no: 'TRP-1', name: 'A trip', employee_id: 'e1',
  emp_code: 'SRS9010', full_name: 'Shreya Reddy', scope: 'domestic',
  start_date: null, end_date: null, stay_by: 'desk', stay_options: [],
  ...over,
} as DeskStay)

const toBook = (over: Partial<DeskToBook>): DeskToBook => ({
  company_id: 'c', trip_id: 't1', trip_no: 'TRP-1', trip_name: 'A trip',
  employee_id: 'e1', emp_code: 'SRS9010', full_name: 'Shreya Reddy',
  kind: 'leg', leg_id: 'l1', point_seq: null, on_date: null, mode: 'flight',
  from_name: 'Delhi', to_name: 'Mumbai', pref_time: null, pref_url: null, pref_note: null,
  ...over,
} as DeskToBook)

const booked = (over: Partial<DeskBooked>): DeskBooked => ({
  id: 'b1', booking_no: 'BKG-1', trip_id: 't1', trip_no: 'TRP-1', trip_name: 'A trip',
  employee_id: 'e1', emp_code: 'SRS9010', full_name: 'Shreya Reddy',
  leg_id: 'l1', point_seq: null, kind: 'travel', vendor: 'IndiGo', reference: 'PNR',
  amount: 6480, paid_by: 'company', status: 'BOOKED', booked_at: '', ticket_url: 'x',
  emailed_at: null, emailed_to: null,
  ...over,
} as DeskBooked)

const journey = (over: Partial<DeskJourney>): DeskJourney => ({
  leg_id: 'l1', company_id: 'c', trip_id: 't1', trip_no: 'TRP-1', trip_name: 'A trip',
  scope: 'local', employee_id: 'e1', emp_code: 'SRS9010', full_name: 'Shreya Reddy',
  desk_confirmed_at: null, is_subtrip: false,
  ...over,
} as DeskJourney)

const watch = (over: Partial<DeskWatch>): DeskWatch => ({
  company_id: 'c', trip_id: 't1', trip_no: 'TRP-1', trip_name: 'A trip',
  employee_id: 'e1', emp_code: 'SRS9010', full_name: 'Shreya Reddy',
  scope: 'domestic', trip_status: 'APPROVED', start_date: '', end_date: '',
  stay_wanted: null, stay_by: null, leg_count: 2,
  ...over,
} as DeskWatch)

describe('the desk’s work gathers under the trip it belongs to', () => {
  it('a hotel row is keyed on `id`, not `trip_id` — the silent one', () => {
    // DeskStay has no trip_id at all. If this ever regresses the hotels
    // disappear from the view and nothing else complains.
    const b = deskBuckets({ stays: [stay({ id: 'tX', trip_no: 'TRP-9', name: 'Mumbai' })] })
    assert.equal(b.length, 1)
    assert.equal(b[0].tripId, 'tX')
    assert.equal(b[0].tripNo, 'TRP-9')
    assert.equal(b[0].tripName, 'Mumbai', 'and its name comes from `name`')
    assert.equal(b[0].lines[0].kind, 'stays')
  })

  it('four kinds on one trip become one bucket, not four', () => {
    const b = deskBuckets({
      stays: [stay({})],
      toBook: [toBook({}), toBook({ kind: 'hotel', mode: null })],
      booked: [booked({})],
      journeys: [journey({})],
    })
    assert.equal(b.length, 1, 'one trip')
    assert.deepEqual(b[0].lines.map(l => l.kind), ['stays', 'book', 'booked', 'journeys'])
  })

  it('separate trips stay separate', () => {
    const b = deskBuckets({
      toBook: [toBook({ trip_id: 'a', trip_no: 'TRP-A' }), toBook({ trip_id: 'b', trip_no: 'TRP-B' })],
    })
    assert.deepEqual(b.map(x => x.tripNo).sort(), ['TRP-A', 'TRP-B'])
  })

  it('lines keep the order work flows in', () => {
    const b = deskBuckets({
      journeys: [journey({})], booked: [booked({})], toBook: [toBook({})], stays: [stay({})], watch: [watch({})],
    })
    assert.deepEqual(b[0].lines.map(l => l.kind), ['stays', 'book', 'booked', 'journeys', 'watch'])
  })
})

describe('what counts as work', () => {
  it('trips needing the desk come first, most first', () => {
    const b = deskBuckets({
      toBook: [toBook({ trip_id: 'busy', trip_no: 'TRP-B' }), toBook({ trip_id: 'busy', trip_no: 'TRP-B' })],
      booked: [booked({ trip_id: 'done', trip_no: 'TRP-A' })],
      journeys: [journey({ trip_id: 'one', trip_no: 'TRP-C' })],
    })
    assert.deepEqual(b.map(x => x.tripNo), ['TRP-B', 'TRP-C', 'TRP-A'])
    assert.deepEqual(b.map(x => x.todo), [2, 1, 0])
  })

  it('a booking already made is a record, not work', () => {
    const b = deskBuckets({ booked: [booked({})] })
    assert.equal(b[0].todo, 0)
    assert.equal(b[0].lines[0].todo, false)
  })

  it('a journey this desk has confirmed stops being work', () => {
    const b = deskBuckets({ journeys: [journey({ desk_confirmed_at: '2026-10-20T00:00:00Z' })] })
    assert.equal(b[0].todo, 0)
    assert.equal(b[0].lines[0].todo, false)
    assert.match(b[0].lines[0].detail, /all confirmed/)
  })

  it('a mix of confirmed and waiting counts only what waits', () => {
    const b = deskBuckets({
      journeys: [journey({ leg_id: 'a' }), journey({ leg_id: 'b', desk_confirmed_at: '2026-10-20T00:00:00Z' })],
    })
    assert.equal(b[0].todo, 1)
    assert.match(b[0].lines[0].detail, /1 waiting/)
  })

  it('"for information" never counts as work — it is the room with nothing to do', () => {
    const b = deskBuckets({ watch: [watch({})] })
    assert.equal(b[0].todo, 0)
    assert.equal(b[0].lines[0].todo, false)
  })
})

describe('the line a desk actually reads', () => {
  it('names the modes rather than counting legs', () => {
    // "flight" tells a desk which supplier to open; "2 to book" does not.
    const b = deskBuckets({ toBook: [toBook({ mode: 'flight' }), toBook({ mode: 'train', leg_id: 'l2' })] })
    assert.equal(b[0].lines[0].detail, 'flight, train')
  })

  it('counts hotels separately from legs', () => {
    const b = deskBuckets({ toBook: [toBook({ mode: 'flight' }), toBook({ kind: 'hotel', mode: null, leg_id: null })] })
    assert.equal(b[0].lines[0].detail, 'flight · a hotel')
  })

  it('says when a booking has no ticket on it yet', () => {
    const b = deskBuckets({ booked: [booked({ ticket_url: null })] })
    assert.match(b[0].lines[0].detail, /no ticket/)
  })

  it('and when the ticket was never sent', () => {
    const b = deskBuckets({ booked: [booked({ ticket_url: 'x', emailed_at: null })] })
    assert.match(b[0].lines[0].detail, /not sent yet/)
  })

  it('marks a sub-trip, because it reviews differently', () => {
    const b = deskBuckets({ journeys: [journey({ is_subtrip: true })] })
    assert.match(b[0].lines[0].detail, /sub-trip/)
  })

  it('says how many hotels the traveller offered', () => {
    const b = deskBuckets({ stays: [stay({ stay_options: [{}, {}, {}] as never })] })
    assert.match(b[0].lines[0].detail, /3 offered/)
  })
})

describe('the edges', () => {
  it('nothing at the desk is an empty list, not a crash', () => {
    assert.deepEqual(deskBuckets({}), [])
  })

  it('a row with no trip id is dropped rather than bucketed under nothing', () => {
    const b = deskBuckets({ toBook: [toBook({ trip_id: undefined as never })] })
    assert.deepEqual(b, [])
  })

  it('a traveller named on one list fills in the rows that do not name them', () => {
    const b = deskBuckets({
      journeys: [journey({ full_name: null, emp_code: null })],
      booked: [booked({ full_name: 'Shreya Reddy', emp_code: 'SRS9010' })],
    })
    assert.equal(b[0].who, 'Shreya Reddy')
    assert.equal(b[0].empCode, 'SRS9010')
  })
})

describe('narrowing a room to one trip', () => {
  it('a hotel row is matched on `id`, not `trip_id` — the same trap', () => {
    // Filtering the hotels room on trip_id compares undefined to a uuid and
    // empties it, which reads as "nothing to choose" when somebody is waiting.
    const rows = [stay({ id: 'tA' }), stay({ id: 'tB' })]
    assert.deepEqual(focusDeskRows('stays', rows, 'tA').map(r => r.id), ['tA'])
  })

  it('every other room is matched on trip_id', () => {
    assert.deepEqual(
      focusDeskRows('book', [toBook({ trip_id: 'a' }), toBook({ trip_id: 'b' })], 'b').map(r => r.trip_id),
      ['b'],
    )
    assert.deepEqual(
      focusDeskRows('journeys', [journey({ trip_id: 'a' }), journey({ trip_id: 'b' })], 'a').map(r => r.trip_id),
      ['a'],
    )
  })

  it('no focus means every row, not none', () => {
    const rows = [toBook({ trip_id: 'a' }), toBook({ trip_id: 'b' })]
    assert.equal(focusDeskRows('book', rows, null).length, 2)
  })

  it('a focus on a trip the room has nothing for is empty, not everything', () => {
    assert.deepEqual(focusDeskRows('book', [toBook({ trip_id: 'a' })], 'zzz'), [])
  })
})

describe('the Journeys room, gathered under each trip', () => {
  // A trip's journeys ARE the trip: leg 1 out, a sub-trip across the city, leg
  // 2 home. Flat and sorted by urgency, two sub-trips of one trip could sit ten
  // rows apart with other people's journeys between them.
  const j = (over: Partial<DeskJourney>) => journey({ ...over })

  it('journeys of one trip come back as one bucket', () => {
    const b = journeyBuckets([
      j({ leg_id: 'a', leg_no: 1 }), j({ leg_id: 'b', leg_no: 2, is_subtrip: true }),
    ] as DeskJourney[], 'travel')
    assert.equal(b.length, 1)
    assert.equal(b[0].journeys.length, 2)
    assert.equal(b[0].subTrips, 1)
  })

  it('different trips stay apart, each keeping its own number', () => {
    const b = journeyBuckets([
      j({ leg_id: 'a', trip_id: 't1', trip_no: 'TRP-A' }),
      j({ leg_id: 'b', trip_id: 't2', trip_no: 'TRP-B' }),
    ] as DeskJourney[], 'travel')
    assert.deepEqual(b.map(x => x.tripNo), ['TRP-A', 'TRP-B'])
  })

  it('within a trip, journeys run in journey order once urgency ties', () => {
    // A trip reads as a sequence; 3, 1, 2 is not how anybody walks it.
    const b = journeyBuckets([
      j({ leg_id: 'c', leg_no: 3 }), j({ leg_id: 'a', leg_no: 1 }), j({ leg_id: 'b', leg_no: 2 }),
    ] as DeskJourney[], 'travel')
    assert.deepEqual(b[0].journeys.map(x => x.leg_no), [1, 2, 3])
  })

  it('a sent-back journey comes first inside its trip', () => {
    const b = journeyBuckets([
      j({ leg_id: 'a', leg_no: 1 }),
      j({ leg_id: 'b', leg_no: 2, sent_back_at: '2026-10-20T00:00:00Z' }),
    ] as DeskJourney[], 'travel')
    assert.equal(b[0].journeys[0].leg_no, 2, 'it is holding the claim')
    assert.equal(b[0].sentBack, 1)
  })

  it('the trip holding a claim sorts above one merely unlooked-at', () => {
    const b = journeyBuckets([
      j({ leg_id: 'a', trip_id: 'quiet', trip_no: 'TRP-A' }),
      j({ leg_id: 'b', trip_id: 'urgent', trip_no: 'TRP-Z', sent_back_at: '2026-10-20T00:00:00Z' }),
    ] as DeskJourney[], 'travel')
    assert.deepEqual(b.map(x => x.tripNo), ['TRP-Z', 'TRP-A'], 'urgency beats the number')
  })

  it('a trip whose journeys are all agreed sorts last', () => {
    const b = journeyBuckets([
      j({ leg_id: 'a', trip_id: 'done', trip_no: 'TRP-A', desk_confirmed_at: '2026-10-20T00:00:00Z' }),
      j({ leg_id: 'b', trip_id: 'open', trip_no: 'TRP-Z' }),
    ] as DeskJourney[], 'travel')
    assert.deepEqual(b.map(x => x.tripNo), ['TRP-Z', 'TRP-A'])
    assert.equal(b[1].waiting, 0)
  })

  it('each desk counts what IT has not confirmed, not what the other has', () => {
    const rows = [j({ leg_id: 'a', desk_confirmed_at: '2026-10-20T00:00:00Z', fin_confirmed_at: null })] as DeskJourney[]
    assert.equal(journeyBuckets(rows, 'travel')[0].waiting, 0, 'the travel desk is done')
    assert.equal(journeyBuckets(rows, 'finance')[0].waiting, 1, 'Finance is not')
  })

  it('the rank is one rule, so the bucket order and the rows inside agree', () => {
    const back = j({ leg_id: 'a', sent_back_at: 'x' }) as DeskJourney
    const fresh = j({ leg_id: 'b' }) as DeskJourney
    const done = j({ leg_id: 'c', desk_confirmed_at: 'x' }) as DeskJourney
    assert.deepEqual(
      [journeyRank(back, 'travel'), journeyRank(fresh, 'travel'), journeyRank(done, 'travel')],
      [0, 1, 2],
    )
  })

  it('a journey with no trip id is dropped rather than bucketed under nothing', () => {
    assert.deepEqual(journeyBuckets([j({ trip_id: undefined as never })] as DeskJourney[], 'travel'), [])
  })

  it('nothing to review is an empty list, not a crash', () => {
    assert.deepEqual(journeyBuckets([], 'travel'), [])
  })
})
