// Which airport (or station) a flight or train actually leaves from, when the
// company has configured one for the city AND the traveller picked another.
//
// WHY THIS EXISTS. The planner shows a hub button per end of every flight or
// train leg. Tap it and the label reads "Chosen by you. Tap to change"
// (TePlanCommute.tsx) — so the control presents itself as the decision. The
// engine resolved the hub the other way round: the city's configured default
// was tried FIRST and the traveller's pick was only a fallback, so the pick
// changed nothing whenever a default existed.
//
// That was survivable while almost no city had a hub configured — the default
// was usually null, so the fallback ran. Migration 173 then configured an
// airport and a station for every city on the master, which turned the
// traveller's choice into dead UI everywhere at once.
//
// WHAT MUST STAY TRUE, in this order:
//   1. the place itself, when the leg already starts or ends at a hub — the
//      traveller is standing there and no preference can move them;
//   2. the hub the traveller picked;
//   3. the company's configured default for the city or its region.
//
// Both directions are asserted everywhere. A resolver that always returns the
// pick is as wrong as one that always returns the default, and the second half
// of each test is what catches the comparison written the wrong way round.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require_ = createRequire(import.meta.url)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

/** The engine, plus a SECOND airport in Bengaluru so a traveller can prefer
 *  one terminal over the configured one. The seed has a single airport per
 *  city, which is exactly the shape that hid this bug. */
function engine(): Any {
  const { createEngine } = require_('../engine/te-engine.js') as Any
  const EZ = createEngine()
  EZ.seed()
  EZ.S.places.push({
    src: 'saved', country: 'India', id: 'blr2', pt: 'airport', code: 'BLR2',
    s: 'Bengaluru airport T2', name: 'Kempegowda International Airport T2',
    addr: 'Terminal 2, Kempegowda International Airport, Devanahalli, Bengaluru, Karnataka 560300',
    city: 'Bengaluru', pin: '560300', lat: 13.1989, lng: 77.7102,
  })
  return EZ
}

/** A one-way flight Gurugram → Bengaluru. `xfer` is the traveller's choice. */
function flight(EZ: Any, xfer: Record<string, unknown>) {
  return EZ.derive({
    id: '__draft__', emp: EZ.S.expenses[0].emp, co: [], status: 'DRAFT', origin: 'PRE_APPROVED',
    name: 'Hub choice', scope: 'domestic', pattern: 'oneway', purpose: 'client', project: '',
    pax: 1, people: [], advance: 0, stayBy: 'self',
    points: [
      { place: 'off', pt: 'corp', what: '', leave: EZ.addDays(EZ.S.today, 10), arrive: '' },
      { place: 'blnw', pt: 'client', what: 'Meeting', leave: '', arrive: '' },
    ],
    segs: [{ mode: 'flight', bookedBy: 'desk', vehicleId: null, xfer }],
  })
}

/** The flight leg the engine planned: the hub-to-hub one. */
const flightLeg = (EZ: Any, t: Any) => EZ.buildLegs(t).find((l: Any) => l.mode === 'flight')

// ── the traveller's pick beats the company default ──────────────────────────

test('the airport the traveller picked is the one the flight leaves from', () => {
  const EZ = engine()
  // The company default for Bengaluru is blr (HUBS.Bengaluru.air).
  assert.equal(EZ.HUBS.Bengaluru.air, 'blr', 'fixture: Bengaluru must have a configured airport')

  const chosen = flightLeg(EZ, flight(EZ, { first: 'cab', last: 'cab', hubB: 'blr2' }))
  assert.equal(chosen.to, 'blr2', 'the flight must arrive at the terminal the traveller chose')

  // The other direction: with no pick, the configured default must still win.
  const dflt = flightLeg(EZ, flight(EZ, { first: 'cab', last: 'cab' }))
  assert.equal(dflt.to, 'blr', 'with nothing chosen, the company default must be used')
})

test('the same holds for the departure end', () => {
  const EZ = engine()
  // Gurugram sits in the NCR region, whose configured airport is igi.
  assert.equal(EZ.regionOf('Gurugram'), 'NCR')
  assert.equal(EZ.HUBS.NCR.air, 'igi')

  const chosen = flightLeg(EZ, flight(EZ, { first: 'cab', last: 'cab', hubA: 'blr2' }))
  assert.equal(chosen.from, 'blr2', 'the flight must leave from the airport the traveller chose')

  const dflt = flightLeg(EZ, flight(EZ, { first: 'cab', last: 'cab' }))
  assert.equal(dflt.from, 'igi', 'with nothing chosen, the region default must be used')
})

// ── but standing at the hub beats everything ────────────────────────────────

test('a trip that already starts at an airport ignores any other choice', () => {
  // The traveller is AT Delhi T3. Preferring another airport cannot teleport
  // them, and the plan must not invent a leg to somewhere they are not.
  const EZ = engine()
  const t = EZ.derive({
    id: '__draft__', emp: EZ.S.expenses[0].emp, co: [], status: 'DRAFT', origin: 'PRE_APPROVED',
    name: 'Already there', scope: 'domestic', pattern: 'oneway', purpose: 'client', project: '',
    pax: 1, people: [], advance: 0, stayBy: 'self',
    points: [
      { place: 'igi', pt: 'airport', what: '', leave: EZ.addDays(EZ.S.today, 10), arrive: '' },
      { place: 'blnw', pt: 'client', what: 'Meeting', leave: '', arrive: '' },
    ],
    segs: [{ mode: 'flight', bookedBy: 'desk', vehicleId: null, xfer: { first: 'cab', last: 'cab', hubA: 'blr2' } }],
  })
  assert.equal(flightLeg(EZ, t).from, 'igi', 'the place the trip starts at is the hub')
})

// ── and a pick must satisfy the blocker, not just the leg builder ───────────

test('a city with no configured hub is satisfied by the traveller picking one', () => {
  // Mumbai has an airport configured but NO station (HUBS.Mumbai has no rail),
  // so a train to Mumbai is refused until somebody names the station. The pick
  // is what unblocks it, and it has to reach tripIssues and not only buildLegs.
  const EZ = engine()
  assert.equal(EZ.HUBS.Mumbai?.rail, undefined, 'fixture: Mumbai must have no configured station')
  const train = (xfer: Record<string, unknown>) => EZ.derive({
    id: '__draft__', emp: EZ.S.expenses[0].emp, co: [], status: 'DRAFT', origin: 'PRE_APPROVED',
    name: 'Train', scope: 'domestic', pattern: 'oneway', purpose: 'client', project: '',
    pax: 1, people: [], advance: 0, stayBy: 'self',
    points: [
      { place: 'off', pt: 'corp', what: '', leave: EZ.addDays(EZ.S.today, 10), arrive: '' },
      { place: 'bkc', pt: 'client', what: 'Meeting', leave: '', arrive: '' },
    ],
    segs: [{ mode: 'train', bookedBy: 'desk', vehicleId: null, xfer }],
  })
  const blockers = (t: Any) => EZ.tripIssues(t).filter((i: Any) => i.block).map((i: Any) => i.t)
  const stationAsk = (xs: string[]) => xs.find(s => /station you arrive at/.test(s)) ?? ''

  assert.ok(stationAsk(blockers(train({ first: 'cab', last: 'cab' }))),
    'with no station anywhere, the plan must ask for one')
  assert.equal(stationAsk(blockers(train({ first: 'cab', last: 'cab', hubB: 'ndls' }))), '',
    'once the traveller names a station, the plan must stop asking')
})
