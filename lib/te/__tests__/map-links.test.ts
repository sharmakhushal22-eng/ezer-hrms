// lib/te/__tests__/map-links.test.ts — handing a route to a real map.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  appleDropsStops, applePlaceUrl, appleRouteUrl, googlePlaceUrl, googleRouteUrl,
  hasPosition, mappable, mapLinksNote, routeLinks,
} from '../map-links.ts'

const NOIDA = { lat: 28.6139, lng: 77.209, name: 'Noida Branch' }
const GURGAON = { lat: 28.4595, lng: 77.0266, name: 'Gurugram Corp Office' }
const PUNE = { lat: 18.5204, lng: 73.8567, name: 'Pune Branch' }
const DUBAI = { lat: 25.2048, lng: 55.2708, name: 'Dubai' }

const qs = (url: string) => Object.fromEntries(new URL(url).searchParams)

test('hasPosition: 0,0 is not a position', () => {
  assert.equal(hasPosition(NOIDA), true)
  // The Atlantic. It is what an unset coordinate looks like in this schema.
  assert.equal(hasPosition({ lat: 0, lng: 0 }), false)
  assert.equal(hasPosition(null), false)
  assert.equal(hasPosition(undefined), false)
  assert.equal(hasPosition({ lat: null, lng: null }), false)
  assert.equal(hasPosition({ lat: NaN, lng: 10 }), false)
  assert.equal(hasPosition({ lat: 91, lng: 10 }), false, 'off the globe')
  assert.equal(hasPosition({ lat: 10, lng: 181 }), false)
  // A real place can legitimately sit on a zero meridian or the equator.
  assert.equal(hasPosition({ lat: 51.5, lng: 0 }), true)
})

test('mappable: drops the unplaced and collapses a return to the start', () => {
  // A round trip ends where it began, and "A to A" is not a route.
  assert.deepEqual(mappable([NOIDA, NOIDA]).length, 1)
  assert.deepEqual(mappable([NOIDA, { lat: 0, lng: 0 }, GURGAON]).map(p => p.name), ['Noida Branch', 'Gurugram Corp Office'])
  assert.deepEqual(mappable([null, undefined]).length, 0)
  // Only CONSECUTIVE duplicates collapse: out and back is a real route.
  assert.deepEqual(mappable([NOIDA, GURGAON, NOIDA]).length, 3)
})

test('googleRouteUrl carries every stop as a waypoint', () => {
  const url = googleRouteUrl([NOIDA, GURGAON, PUNE])!
  const p = qs(url)
  assert.ok(url.startsWith('https://www.google.com/maps/dir/?'))
  assert.equal(p.api, '1')
  assert.equal(p.origin, '28.6139,77.209')
  assert.equal(p.destination, '18.5204,73.8567')
  assert.equal(p.waypoints, '28.4595,77.0266', 'the middle stop is a waypoint, not dropped')
  assert.equal(p.travelmode, 'driving')
})

test('googleRouteUrl: no waypoints parameter when there is nothing in between', () => {
  const p = qs(googleRouteUrl([NOIDA, GURGAON])!)
  assert.equal('waypoints' in p, false)
})

test('googleRouteUrl: an international trip asks for flights, not a drive to Dubai', () => {
  assert.equal(qs(googleRouteUrl([NOIDA, DUBAI], 'international')!).travelmode, 'flight')
  assert.equal(qs(googleRouteUrl([NOIDA, PUNE], 'domestic')!).travelmode, 'driving')
})

test('googleRouteUrl: one usable point falls back to pinning it', () => {
  const url = googleRouteUrl([NOIDA, { lat: 0, lng: 0 }])!
  assert.ok(url.includes('/maps/search/'))
  assert.equal(qs(url).query, '28.6139,77.209')
})

test('no usable point means no link at all, rather than a link to nowhere', () => {
  assert.equal(googleRouteUrl([]), null)
  assert.equal(googleRouteUrl([{ lat: 0, lng: 0 }]), null)
  assert.equal(appleRouteUrl([null]), null)
  assert.equal(googlePlaceUrl(null), null)
  assert.equal(applePlaceUrl({ lat: 0, lng: 0 }), null)
})

test('appleRouteUrl: start and finish, because Apple has no waypoints', () => {
  const p = qs(appleRouteUrl([NOIDA, GURGAON, PUNE])!)
  assert.equal(p.saddr, '28.6139,77.209')
  assert.equal(p.daddr, '18.5204,73.8567')
  assert.equal('waypoints' in p, false)
})

test('appleDropsStops is true exactly when something is lost', () => {
  assert.equal(appleDropsStops([NOIDA, GURGAON]), false)
  assert.equal(appleDropsStops([NOIDA, GURGAON, PUNE]), true)
  // The unplaced stop never counted, so nothing is lost by leaving it out.
  assert.equal(appleDropsStops([NOIDA, { lat: 0, lng: 0 }, GURGAON]), false)
})

test('applePlaceUrl uses the name as the label but the coordinates as the position', () => {
  const p = qs(applePlaceUrl(NOIDA)!)
  assert.equal(p.ll, '28.6139,77.209')
  assert.equal(p.q, 'Noida Branch')
  // No name: the label falls back to the coordinates rather than being blank.
  assert.equal(qs(applePlaceUrl({ lat: 28.6139, lng: 77.209 })!).q, '28.6139,77.209')
})

test('coordinates are rounded, so a float artefact does not reach the URL', () => {
  const p = qs(googlePlaceUrl({ lat: 28.613900000001, lng: 77.2090000004 })!)
  assert.equal(p.query, '28.6139,77.209')
})

test('routeLinks reports what the two links actually cover', () => {
  const r = routeLinks([NOIDA, GURGAON, PUNE])
  assert.equal(r.stops, 3)
  assert.equal(r.appleShort, true)
  assert.ok(r.google && r.apple)

  const none = routeLinks([{ lat: 0, lng: 0 }])
  assert.deepEqual({ g: none.google, a: none.apple, s: none.stops }, { g: null, a: null, s: 0 })
})

test('mapLinksNote admits the Apple limit instead of hiding it', () => {
  assert.equal(mapLinksNote(0, false), null)
  assert.match(mapLinksNote(1, false)!, /Opens the place/)
  assert.match(mapLinksNote(2, false)!, /Opens the route/)
  const n = mapLinksNote(4, true)!
  assert.match(n, /Google gets all 4 stops/)
  assert.match(n, /Apple Maps has no multi-stop/)
})
