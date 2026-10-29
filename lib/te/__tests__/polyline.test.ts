// The recorded route, folded into one string so it outlives the raw pings.
//
// te_leg_pings is purged after 180 days; te_legs.route_polyline is not. So this
// encoding is the only surviving record of where a journey actually went, and a
// claim queried a year later rests on it. Hence the round-trip tests: encode is
// only correct if decode gets the same places back, to the precision the format
// promises.
//
// The known-vector test matters more than it looks. Round-tripping my own
// encoder against my own decoder would pass just as happily if both were wrong
// in the same direction, so one case is checked against the published example
// from Google's own specification.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { boundsOf, decodePolyline, encodePolyline } from '../engine/polyline.js'

/** Within a metre, which is the format's own precision (5 decimal places). */
const near = (a: number, b: number, what: string) =>
  assert.ok(Math.abs(a - b) < 0.00002, `${what}: ${a} vs ${b}`)

const sameRoute = (got: { lat: number; lng: number }[], want: { lat: number; lng: number }[]) => {
  assert.equal(got.length, want.length, 'point count')
  got.forEach((p, i) => { near(p.lat, want[i].lat, `lat[${i}]`); near(p.lng, want[i].lng, `lng[${i}]`) })
}

// ── against the published specification ─────────────────────────────────────

test('matches the example from Google own specification', () => {
  // The worked example in the encoded-polyline documentation: three points
  // round Yosemite, and the exact string they must produce.
  const points = [
    { lat: 38.5, lng: -120.2 },
    { lat: 40.7, lng: -120.95 },
    { lat: 43.252, lng: -126.453 },
  ]
  assert.equal(encodePolyline(points), '_p~iF~ps|U_ulLnnqC_mqNvxq`@')
})

test('decodes that same string back to those same points', () => {
  sameRoute(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@'), [
    { lat: 38.5, lng: -120.2 },
    { lat: 40.7, lng: -120.95 },
    { lat: 43.252, lng: -126.453 },
  ])
})

// ── the journeys this actually stores ───────────────────────────────────────

test('a Mumbai sub-trip round-trips to within a metre', () => {
  // Andheri East to Bandra Kurla Complex, the kind of hop this feature exists
  // for: small deltas, southern and eastern hemisphere signs both positive.
  const track = [
    { lat: 19.11972, lng: 72.84656 },
    { lat: 19.11504, lng: 72.85011 },
    { lat: 19.10233, lng: 72.86045 },
    { lat: 19.06701, lng: 72.86921 },
    { lat: 19.0606, lng: 72.86598 },
  ]
  sameRoute(decodePolyline(encodePolyline(track)), track)
})

test('a two-fix check-in journey still makes a line', () => {
  // A flight records only the two ends. Drawing those two is still worth more
  // than drawing nothing, so this must not be treated as "no route".
  const line = encodePolyline([{ lat: 28.5562, lng: 77.1 }, { lat: 19.0896, lng: 72.8656 }])
  assert.ok(line.length > 0, 'two points encode')
  assert.equal(decodePolyline(line).length, 2)
})

test('extra keys on a trail point are ignored', () => {
  // te_leg_json hands out { lat, lng, t, sp, acc, fake }. Only two of those are
  // a position.
  const track = [
    { lat: 19.11972, lng: 72.84656, t: 0, sp: 0, acc: 12, fake: false },
    { lat: 19.11504, lng: 72.85011, t: 48, sp: 22.4, acc: 9, fake: false },
  ]
  sameRoute(decodePolyline(encodePolyline(track)), [
    { lat: 19.11972, lng: 72.84656 }, { lat: 19.11504, lng: 72.85011 },
  ])
})

test('a long trail stays small enough to keep for good', () => {
  // 2,000 fixes is a long drive recorded every few seconds. If this ever blew
  // up to JSON size the whole reason for encoding would be gone.
  const track = Array.from({ length: 2000 }, (_, i) => ({ lat: 19.1 + i * 0.0001, lng: 72.85 + i * 0.00008 }))
  const line = encodePolyline(track)
  assert.equal(decodePolyline(line).length, 2000, 'all of it survives')
  assert.ok(line.length < JSON.stringify(track).length / 5,
    `encoded ${line.length} vs json ${JSON.stringify(track).length}`)
})

// ── what it refuses to invent ───────────────────────────────────────────────

test('a point with no position is dropped, not encoded as the Gulf of Guinea', () => {
  // 0,0 is a real place. A trail that silently visits it is a false record.
  const line = encodePolyline([
    { lat: 19.11972, lng: 72.84656 },
    { lat: NaN, lng: 72.85 } as unknown as { lat: number; lng: number },
    { lat: 19.10233, lng: 72.86045 },
  ])
  const back = decodePolyline(line)
  assert.equal(back.length, 2, 'the unusable point is gone')
  near(back[1].lat, 19.10233, 'the route closes over the gap')
})

test('no points is an empty string, which te_leg_end stores as null', () => {
  assert.equal(encodePolyline([]), '')
  assert.equal(encodePolyline(null as unknown as []), '')
})

test('a corrupt or truncated string decodes to nothing instead of throwing', () => {
  // A screen drawing this map is also showing the distance, the fare and the
  // flags. One bad column must not take the other facts down with it.
  for (const bad of ['', '???', '_p~iF', '_p~iF~ps|U_ulL', 'not a polyline at all']) {
    assert.doesNotThrow(() => decodePolyline(bad), `threw on ${JSON.stringify(bad)}`)
  }
  assert.deepEqual(decodePolyline(null), [])
  assert.deepEqual(decodePolyline(undefined), [])
})

// ── fitting a map to it ─────────────────────────────────────────────────────

test('bounds cover every point', () => {
  const b = boundsOf([
    { lat: 19.11972, lng: 72.84656 },
    { lat: 19.0606, lng: 72.86598 },
    { lat: 19.10233, lng: 72.80000 },
  ])
  assert.deepEqual(b, { north: 19.11972, south: 19.0606, east: 72.86598, west: 72.8 })
})

test('nothing to fit answers null rather than centring on 0,0', () => {
  assert.equal(boundsOf([]), null)
  assert.equal(boundsOf(null), null)
  assert.equal(boundsOf([{ lat: NaN, lng: NaN }] as unknown as []), null)
})

// ── the route actually reaches the database ─────────────────────────────────
//
// THE MOST IMPORTANT TESTS IN THIS FILE. te_legs.route_polyline and the write
// in te_leg_end both existed from the first migration; legEndStats simply never
// put the key in its payload, so the column was null on every journey ever
// recorded and no screen could draw anybody's route. Nobody noticed for
// thirty-six migrations, because every other number in that payload was right.
//
// A perfect encoder that is never called is worth nothing, so the contract is
// pinned here: ending a journey produces a route. The engine is stubbed down to
// the three things legEndStats asks of it, which is what makes this a test of
// the adapter rather than of the whole engine.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const stubEngine = (journey: any): any => ({
  journey: () => journey,
  jStats: (j: { track?: unknown[] }) => ({ n: (j.track || []).length, gpsKm: 7.4, gapMaxMin: 0, maxSp: 41, moving: 900 }),
  viaKm: () => 7.1,
})

test('ending a journey records the route it took', async () => {
  const { legEndStats } = await import('../engine/te-adapter.js')
  const track = [
    { lat: 19.11972, lng: 72.84656, t: 0, sp: 0, acc: 10 },
    { lat: 19.11504, lng: 72.85011, t: 60, sp: 24, acc: 9 },
    { lat: 19.10233, lng: 72.86045, t: 180, sp: 31, acc: 8 },
  ]
  const out = legEndStats(
    stubEngine({ id: 'leg-1', status: 'ACTIVE', startedAt: '2026-10-20T09:00:00Z', gps: 'track', track, stops: [] }),
    'leg-1',
    { lat: 19.0606, lng: 72.86598, recorded_at: '2026-10-20T09:20:00Z', accuracy_m: 11 },
    Date.parse('2026-10-20T09:20:00Z'),
  )
  assert.ok(!('error' in out), 'the stub journey is acceptable')
  const payload = (out as { payload: { route_polyline: string } }).payload
  assert.ok(typeof payload.route_polyline === 'string', 'the key exists')
  assert.ok(payload.route_polyline.length > 0, 'and carries a route, not an empty string')

  // And it is the real route: the three recorded fixes plus the ending one.
  const back = decodePolyline(payload.route_polyline)
  assert.equal(back.length, 4, 'three fixes and the end fix')
  near(back[0].lat, 19.11972, 'starts where the journey started')
  near(back[3].lng, 72.86598, 'ends where it was ended')
})

test('a check-in journey records its two ends', async () => {
  // A flight keeps only the two fixes. It must still produce a line, because
  // "Delhi to Mumbai, as recorded" is worth drawing.
  const { legEndStats } = await import('../engine/te-adapter.js')
  const out = legEndStats(
    stubEngine({
      id: 'leg-2', status: 'ACTIVE', startedAt: '2026-10-20T06:00:00Z', gps: 'checkin', track: [], stops: [],
      checkin: { start: { lat: 28.5562, lng: 77.1, acc: 20 } },
    }),
    'leg-2',
    { lat: 19.0896, lng: 72.8656, recorded_at: '2026-10-20T08:10:00Z', accuracy_m: 18 },
    Date.parse('2026-10-20T08:10:00Z'),
  )
  assert.ok(!('error' in out))
  const line = (out as { payload: { route_polyline: string } }).payload.route_polyline
  assert.equal(decodePolyline(line).length, 2, 'both ends')
})
