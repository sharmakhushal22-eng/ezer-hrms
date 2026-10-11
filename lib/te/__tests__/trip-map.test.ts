// lib/te/__tests__/trip-map.test.ts — the review screen's schematic.
//
// Geometry is the kind of code that looks right and is wrong by a sign, so the
// properties that matter are asserted rather than the exact path strings:
// north is up, east is right, every drawn point lands inside the panel, and a
// place the trip returns to keeps its first letter.
import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { arcPoints, mapHeight, tripMapGeometry, type MapPlace } from '../trip-map.ts'

const PLACES = new Map<string, MapPlace>([
  ['office', { id: 'office', s: 'EZER office', lat: 28.4595, lng: 77.0266 }],   // Gurugram
  ['delhi', { id: 'delhi', s: 'Delhi airport T3', lat: 28.5562, lng: 77.1000 }],
  ['pune', { id: 'pune', s: 'Pune airport', lat: 18.5793, lng: 73.9089 }],
  ['site', { id: 'site', s: 'Corvin Logistics, Pune', lat: 18.5204, lng: 73.8567 }],
  ['nowhere', { id: 'nowhere', s: 'Not located yet', lat: 0, lng: 0 }],
])

const RETURN_TRIP = {
  points: ['office', 'site', 'office'],
  legs: [
    { from: 'office', to: 'delhi', mode: 'cab' },
    { from: 'delhi', to: 'pune', mode: 'flight' },
    { from: 'pune', to: 'site', mode: 'cab' },
    { from: 'site', to: 'pune', mode: 'cab' },
    { from: 'pune', to: 'delhi', mode: 'flight' },
    { from: 'delhi', to: 'office', mode: 'cab' },
  ],
  places: PLACES,
}

describe('tripMapGeometry', () => {
  it('draws nothing when no place has a location', () => {
    assert.equal(tripMapGeometry({ legs: [], points: [], places: PLACES }), null)
    assert.equal(tripMapGeometry({ legs: [], points: ['nowhere'], places: PLACES }), null)
    assert.equal(tripMapGeometry({ legs: [{ from: 'nowhere', to: 'nowhere', mode: 'cab' }], points: [], places: PLACES }), null)
  })

  it('ignores a place that is not in the list at all', () => {
    const g = tripMapGeometry({ legs: [{ from: 'office', to: 'ghost', mode: 'cab' }], points: ['office'], places: PLACES })
    assert.ok(g)
    assert.equal(g.plan, '', 'a leg with an unknown end cannot be drawn')
    assert.equal(g.marks.length, 1)
  })

  it('puts north up and east right', () => {
    const g = tripMapGeometry({ ...RETURN_TRIP, width: 640, height: 220 })!
    const office = g.marks.find(m => m.label === 'EZER office')!   // 28.46 N, 77.03 E
    const site = g.marks.find(m => m.label.includes('Corvin'))!    // 18.52 N, 73.86 E
    assert.ok(office.y < site.y, 'Gurugram is north of Pune, so it is higher up')
    assert.ok(office.x > site.x, 'Gurugram is east of Pune, so it is further right')
  })

  it('keeps everything it draws inside the panel', () => {
    const g = tripMapGeometry({ ...RETURN_TRIP, width: 640, height: 220 })!
    for (const m of g.marks) {
      assert.ok(m.x >= 0 && m.x <= g.width, `${m.label} x=${m.x} is off the panel`)
      assert.ok(m.y >= 0 && m.y <= g.height, `${m.label} y=${m.y} is off the panel`)
    }
    for (const [, x, y] of [...`${g.plan}${g.flights}`.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)]) {
      assert.ok(Number(x) >= -1 && Number(x) <= g.width + 1, `path x=${x} is off the panel`)
      assert.ok(Number(y) >= -1 && Number(y) <= g.height + 1, `path y=${y} is off the panel`)
    }
  })

  it('letters each distinct place once, in the order the trip reaches it', () => {
    const g = tripMapGeometry(RETURN_TRIP)!
    // office -> site -> office is two pins, not three: the return reuses A.
    assert.deepEqual(g.marks.map(m => m.letter), ['A', 'B'])
    assert.deepEqual(g.marks.map(m => m.label), ['EZER office', 'Corvin Logistics, Pune'])
  })

  it('merges the labels of two places that land on top of each other', () => {
    // The airport and a hotel across the road are one pin apart on screen.
    const close = new Map(PLACES)
    close.set('hotel', { id: 'hotel', s: 'Hotel Ascot', lat: 18.5795, lng: 73.9091 })
    const g = tripMapGeometry({ legs: [{ from: 'office', to: 'pune', mode: 'flight' }], points: ['office', 'pune', 'hotel'], places: close })!
    const pune = g.marks.find(m => m.letter === 'B')!
    const hotel = g.marks.find(m => m.letter === 'C')!
    assert.equal(pune.label, 'Pune airport · Hotel Ascot', 'the first pin carries both names')
    assert.equal(hotel.label, '', 'the pin behind it prints nothing, rather than overlapping')
  })

  it('hangs a label to the left when its pin is near the right edge', () => {
    const g = tripMapGeometry({ ...RETURN_TRIP, width: 640, height: 220 })!
    for (const m of g.marks) {
      if (m.x > 640 - 150) {
        assert.equal(m.labelAnchor, 'end')
        assert.ok(m.labelX < m.x, 'it should run back towards the middle')
      } else {
        assert.equal(m.labelAnchor, 'start')
        assert.ok(m.labelX > m.x)
      }
    }
  })

  it('separates flights from ground legs', () => {
    const g = tripMapGeometry(RETURN_TRIP)!
    assert.ok(g.flights.length > 0, 'the two flights are drawn')
    assert.ok(g.plan.length > 0, 'the four cab legs are drawn')
    // A ground leg is two points; a flight is bowed, so it is many.
    assert.equal((g.plan.match(/M/g) || []).length, 4, 'four ground legs, each one M')
    assert.ok((g.flights.match(/L/g) || []).length > 20, 'a flight is a curve, not a straight line')
  })

  it('drops a leg that starts and ends in the same place', () => {
    const g = tripMapGeometry({ legs: [{ from: 'office', to: 'office', mode: 'cab' }], points: ['office'], places: PLACES })!
    assert.equal(g.plan, '')
  })

  it('picks a round scale, about six squares across', () => {
    const near = tripMapGeometry({ legs: [{ from: 'office', to: 'delhi', mode: 'cab' }], points: ['office', 'delhi'], places: PLACES })!
    const far = tripMapGeometry(RETURN_TRIP)!
    assert.ok([1, 2, 5, 10, 25, 50, 100, 250, 500, 1000].includes(near.scale.km))
    assert.ok([1, 2, 5, 10, 25, 50, 100, 250, 500, 1000].includes(far.scale.km))
    assert.ok(far.scale.km > near.scale.km, 'Delhi to Pune needs a coarser scale than one city')
    assert.ok(far.scale.px > 0 && near.scale.px > 0)
  })

  it('does not magnify a single place into a meaningless grid', () => {
    // One point has no span at all. The 3 km floor keeps the scale sane.
    const g = tripMapGeometry({ legs: [], points: ['office'], places: PLACES })!
    assert.equal(g.marks.length, 1)
    assert.ok(g.scale.km >= 1 && g.scale.km <= 10, `a single place should stay zoomed in, got ${g.scale.km} km`)
    assert.ok(g.marks[0].x > 0 && g.marks[0].x < g.width)
  })
})

describe('arcPoints', () => {
  it('starts and ends exactly on the two places', () => {
    const a = { lat: 10, lng: 20 }
    const b = { lat: 30, lng: 50 }
    const pts = arcPoints(a, b)
    assert.deepEqual(pts[0], a)
    assert.deepEqual(pts[pts.length - 1], b)
  })

  it('bows off the straight line, so a flight does not look like a road', () => {
    const a = { lat: 0, lng: 0 }
    const b = { lat: 0, lng: 10 }
    const mid = arcPoints(a, b)[14]
    assert.ok(Math.abs(mid.lat) > 0.1, `the middle should leave the straight line, got lat ${mid.lat}`)
  })
})

describe('mapHeight', () => {
  it('is shorter on a phone, and for a local trip', () => {
    assert.equal(mapHeight('domestic', true), 150)
    assert.equal(mapHeight('local', false), 180)
    assert.equal(mapHeight('domestic', false), 220)
    assert.equal(mapHeight('international', false), 220)
  })
})
