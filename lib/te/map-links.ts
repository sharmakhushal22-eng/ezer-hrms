// lib/te/map-links.ts — opening a trip in a real map.
//
// The panel on the trip screen is a schematic: it draws the route to scale but
// it is not a map, and it cannot be. A real one needs a Google Maps key, which
// this deployment does not have — GOOGLE_MAPS_API_KEY is what the server-side
// geocode and routes providers read, and it is not set, so those fall back too.
//
// These links need no key at all. They hand the route to the map application
// the person already has, which is better than an embed anyway once they are
// standing outside a station: it has their location, their traffic and their
// downloaded tiles.
//
// WHAT EACH ONE CAN DO IS NOT THE SAME, and the difference is not ours to hide.
//
//   Google  takes a full multi-stop route. `waypoints` is part of the
//           documented Maps URLs API, so a four-stop trip arrives as a
//           four-stop route.
//
//   Apple   has no waypoints. Its URL scheme documents saddr and daddr and
//           nothing between them, so a multi-stop trip can only be handed over
//           as start → final destination. appleDropsStops() says when that has
//           happened so the screen can admit it rather than quietly giving
//           somebody the wrong route.
//
// COORDINATES, NOT NAMES. Every link is built from lat/lng. A place name is
// ambiguous ("Noida Branch" means nothing to Google) and an address can be
// mistyped; the coordinates are what the trip was planned against, so they are
// what should be opened.
import type { TripScope } from './types.ts'

/** The least a place needs to be worth putting on a map. */
export interface MapPoint {
  lat: number
  lng: number
  /** Shown in the UI, not sent in the link. */
  name?: string
}

export type MapApp = 'google' | 'apple'

/** 0,0 is the Atlantic. It is what an unset coordinate looks like in this
 *  schema, and sending somebody there is worse than offering no link. */
export function hasPosition(p: { lat?: number | null; lng?: number | null } | null | undefined): boolean {
  if (!p) return false
  const { lat, lng } = p
  if (typeof lat !== 'number' || typeof lng !== 'number') return false
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false
  if (lat === 0 && lng === 0) return false
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180
}

/** Six decimals is about 10 cm. More is noise in a URL. */
const pair = (p: MapPoint) => `${round6(p.lat)},${round6(p.lng)}`
const round6 = (n: number) => Math.round(n * 1e6) / 1e6

/** The points of a trip that can actually be mapped, in order, with any
 *  consecutive duplicate collapsed — a round trip ends where it started, and
 *  "A to A" is not a route. */
export function mappable(points: (MapPoint | null | undefined)[]): MapPoint[] {
  const out: MapPoint[] = []
  for (const p of points) {
    if (!hasPosition(p)) continue
    const q = p as MapPoint
    const last = out[out.length - 1]
    if (last && pair(last) === pair(q)) continue
    out.push(q)
  }
  return out
}

/**
 * Directions through every stop, in Google Maps.
 *
 * Built on the Maps URLs API (`/maps/dir/?api=1`), which is the documented,
 * key-free entry point and opens the app on a phone and the site on a desktop.
 */
export function googleRouteUrl(points: (MapPoint | null | undefined)[], scope?: TripScope): string | null {
  const ps = mappable(points)
  if (!ps.length) return null
  if (ps.length === 1) return googlePlaceUrl(ps[0])

  const origin = ps[0]
  const destination = ps[ps.length - 1]
  const waypoints = ps.slice(1, -1)
  const q = new URLSearchParams({ api: '1', origin: pair(origin), destination: pair(destination) })
  if (waypoints.length) q.set('waypoints', waypoints.map(pair).join('|'))
  // An international trip is flown, and road directions between continents are
  // either refused or absurd. Asking for flights gets something useful instead.
  if (scope === 'international') q.set('travelmode', 'flight')
  else q.set('travelmode', 'driving')
  return `https://www.google.com/maps/dir/?${q.toString()}`
}

/** One place, pinned. */
export function googlePlaceUrl(p: MapPoint | null | undefined): string | null {
  if (!hasPosition(p)) return null
  const q = new URLSearchParams({ api: '1', query: pair(p as MapPoint) })
  return `https://www.google.com/maps/search/?${q.toString()}`
}

/**
 * Directions in Apple Maps.
 *
 * Apple's URL scheme has saddr and daddr and nothing in between, so a trip
 * with stops is handed over as start → final destination. That is a real
 * difference from the Google link and the screen should say so: see
 * appleDropsStops.
 */
export function appleRouteUrl(points: (MapPoint | null | undefined)[]): string | null {
  const ps = mappable(points)
  if (!ps.length) return null
  if (ps.length === 1) return applePlaceUrl(ps[0])
  const q = new URLSearchParams({ saddr: pair(ps[0]), daddr: pair(ps[ps.length - 1]), dirflg: 'd' })
  return `https://maps.apple.com/?${q.toString()}`
}

/** One place, pinned, in Apple Maps. */
export function applePlaceUrl(p: MapPoint | null | undefined): string | null {
  if (!hasPosition(p)) return null
  const q = new URLSearchParams({ ll: pair(p as MapPoint), q: (p as MapPoint).name?.trim() || pair(p as MapPoint) })
  return `https://maps.apple.com/?${q.toString()}`
}

/** True when handing this route to Apple would silently lose the middle of it. */
export function appleDropsStops(points: (MapPoint | null | undefined)[]): boolean {
  return mappable(points).length > 2
}

/** Both links at once, for a screen that offers the choice. */
export function routeLinks(points: (MapPoint | null | undefined)[], scope?: TripScope): {
  google: string | null
  apple: string | null
  /** How many stops the links actually cover. 0 means offer nothing. */
  stops: number
  /** Apple will show start to finish only. */
  appleShort: boolean
} {
  const ps = mappable(points)
  return {
    google: googleRouteUrl(ps, scope),
    apple: appleRouteUrl(ps),
    stops: ps.length,
    appleShort: ps.length > 2,
  }
}

/** The label under a pair of map buttons, admitting Apple's limit when it bites. */
export function mapLinksNote(stops: number, appleShort: boolean): string | null {
  if (stops === 0) return null
  if (stops === 1) return 'Opens the place in your map app.'
  if (!appleShort) return 'Opens the route in your map app.'
  return `Google gets all ${stops} stops. Apple Maps has no multi-stop routes, so it opens start to destination only.`
}
