// Types for polyline.js, written by hand. Google's encoded-polyline format, in
// both directions: the server encodes a finished journey's trail into
// te_legs.route_polyline, the browser decodes it to draw the route.
// See the header of polyline.js for why the route is stored encoded at all.

/** A point on a route. Extra keys on a trail point (t, sp, acc) are ignored. */
export interface LatLng { lat: number; lng: number }

/** Points to an encoded polyline. Points without two finite numbers are
 *  dropped, never encoded as 0,0. */
export function encodePolyline(points: ReadonlyArray<{ lat: number | string; lng: number | string }>): string

/** An encoded polyline back to points. Returns [] for anything unreadable —
 *  never throws, because a corrupt string must not take down a screen. */
export function decodePolyline(s: string | null | undefined): LatLng[]

/** The corners of a route, for fitting a map to it. null when there is nothing
 *  to fit, which the caller must handle rather than centring on 0,0. */
export function boundsOf(points: ReadonlyArray<{ lat: number | string; lng: number | string }> | null | undefined):
  { north: number; south: number; east: number; west: number } | null
