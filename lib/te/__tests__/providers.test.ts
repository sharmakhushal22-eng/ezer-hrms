// The parsers of the map provider's answers, with fixtures in Google's response shape.
// The network calls themselves are not executed here.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { parseDirections, directionsUrl, googleRoute, routesProvider } from '../providers/routes.ts'
import { parseGeocode, parseReverseGeocode, addressLine, geocodeProviders } from '../providers/geocode.ts'

const DIRECTIONS = {
  status: 'OK',
  routes: [{
    overview_polyline: { points: 'o}wlDq~muMyBnAeCzB' },
    legs: [{ distance: { text: '31.6 km', value: 31640 }, duration: { text: '52 mins', value: 3120 } }],
  }],
}

describe('directions', () => {
  test('km to one decimal, whole minutes, the route line', () => {
    assert.deepEqual(parseDirections(DIRECTIONS), { km: 31.6, minutes: 52, polyline: 'o}wlDq~muMyBnAeCzB', provider: 'google' })
  })
  test('several legs are added up', () => {
    const two = { status: 'OK', routes: [{ legs: [{ distance: { value: 1000 }, duration: { value: 60 } }, { distance: { value: 2549 }, duration: { value: 90 } }] }] }
    assert.deepEqual(parseDirections(two), { km: 3.5, minutes: 3, polyline: null, provider: 'google' })
  })
  test('no route, an error status or rubbish is null', () => {
    assert.equal(parseDirections({ status: 'ZERO_RESULTS', routes: [] }), null)
    assert.equal(parseDirections({ status: 'OVER_QUERY_LIMIT' }), null)
    assert.equal(parseDirections({ status: 'OK', routes: [{ legs: [{ distance: {} }] }] }), null)
    assert.equal(parseDirections(null), null)
    assert.equal(parseDirections('<html>'), null)
  })
  test('the request carries both ends and the key, and nothing else of ours', () => {
    const u = new URL(directionsUrl({ lat: 28.495, lng: 77.089 }, { lat: 28.508, lng: 77.078 }, 'k e/y'))
    assert.equal(u.searchParams.get('origin'), '28.495,77.089')
    assert.equal(u.searchParams.get('destination'), '28.508,77.078')
    assert.equal(u.searchParams.get('key'), 'k e/y')
    assert.equal(u.searchParams.get('mode'), 'driving')
  })
  test('googleRoute with a stand-in fetch: an answer, a failure, a bad position', async () => {
    const ok = (async () => new Response(JSON.stringify(DIRECTIONS), { status: 200 })) as typeof fetch
    assert.equal((await googleRoute({ lat: 1, lng: 2 }, { lat: 3, lng: 4 }, 'k', ok))?.km, 31.6)
    const down = (async () => { throw new Error('network') }) as typeof fetch
    assert.equal(await googleRoute({ lat: 1, lng: 2 }, { lat: 3, lng: 4 }, 'k', down), null)
    const denied = (async () => new Response('{}', { status: 403 })) as typeof fetch
    assert.equal(await googleRoute({ lat: 1, lng: 2 }, { lat: 3, lng: 4 }, 'k', denied), null)
    assert.equal(await googleRoute({ lat: NaN, lng: 2 }, { lat: 3, lng: 4 }, 'k', ok), null)
  })
  test('no key = no provider', () => {
    assert.equal(routesProvider({}), undefined)
    assert.equal(typeof routesProvider({ GOOGLE_MAPS_API_KEY: 'k' }), 'function')
  })
})

const GEOCODE = {
  status: 'OK',
  results: [{
    formatted_address: 'Plot 214, Udyog Vihar Phase 4, Gurugram, Haryana 122015, India',
    geometry: { location: { lat: 28.508, lng: 77.078 }, location_type: 'ROOFTOP' },
    address_components: [
      { long_name: 'Plot 214', short_name: 'Plot 214', types: ['premise'] },
      { long_name: 'Udyog Vihar Phase 4', short_name: 'Udyog Vihar Phase 4', types: ['sublocality_level_1', 'sublocality', 'political'] },
      { long_name: 'Gurugram', short_name: 'Gurugram', types: ['locality', 'political'] },
      { long_name: 'Haryana', short_name: 'HR', types: ['administrative_area_level_1', 'political'] },
      { long_name: 'India', short_name: 'IN', types: ['country', 'political'] },
      { long_name: '122015', short_name: '122015', types: ['postal_code'] },
    ],
  }],
}

describe('geocoding', () => {
  test('an exact building is not approximate; the centre of an area is', () => {
    assert.deepEqual(parseGeocode(GEOCODE), { lat: 28.508, lng: 77.078, approx: false })
    const area = { status: 'OK', results: [{ geometry: { location: { lat: 28.5, lng: 77.07 }, location_type: 'APPROXIMATE' } }] }
    assert.deepEqual(parseGeocode(area), { lat: 28.5, lng: 77.07, approx: true })
  })
  test('nothing found, or the (0, 0) point, is null', () => {
    assert.equal(parseGeocode({ status: 'ZERO_RESULTS', results: [] }), null)
    assert.equal(parseGeocode({ status: 'OK', results: [{ geometry: { location: { lat: 0, lng: 0 } } }] }), null)
    assert.equal(parseGeocode(undefined), null)
  })
  test('a position becomes a name, an address, a city, a PIN and a country', () => {
    assert.deepEqual(parseReverseGeocode(GEOCODE), {
      name: 'Plot 214', address: 'Plot 214, Udyog Vihar Phase 4, Gurugram, Haryana 122015, India', city: 'Gurugram', pin: '122015', country: 'India',
    })
    assert.equal(parseReverseGeocode({ status: 'OK', results: [] }), null)
  })
  test('the address line skips empty parts', () => {
    assert.equal(addressLine({ line: 'Plot 214', area: '', city: 'Gurugram', pin: '122015', country: 'India' }), 'Plot 214, Gurugram, 122015, India')
  })
  test('no key = no providers', () => {
    assert.deepEqual(geocodeProviders({}), {})
    assert.deepEqual(Object.keys(geocodeProviders({ GOOGLE_MAPS_API_KEY: 'k' })).sort(), ['geocode', 'reverseGeocode'])
  })
})
