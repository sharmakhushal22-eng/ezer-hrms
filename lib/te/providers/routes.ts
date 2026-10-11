// lib/te/providers/routes.ts — road distance between two places.
//
// The rules engine pays an own-vehicle leg against the SHORTEST ROAD ROUTE, so
// it needs a real map distance. te-service asks for it only when the pair is
// not in the te_routes cache, and stores the answer (te_route_put), so each
// pair of places costs one Directions call, ever.
//
// Uses the same Google Directions endpoint and the same server key
// (GOOGLE_MAPS_API_KEY) as the existing app/api/travel/route/route.ts.
// Without the key this provider is absent and the engine uses its own
// estimate (straight line x the roadFactor setting).
//
// PURE PART: parseDirections() — unit-tested with a fixture.
// NETWORK PART: googleRoute() — NOT executed in the handover sandbox (no key).

export interface LatLng { lat: number; lng: number }
export interface RouteResult { km: number; minutes: number | null; polyline: string | null; provider: string }

const round1 = (n: number) => Math.round(n * 10) / 10

/** Read a Directions API response. null = no usable route. */
export function parseDirections(json: unknown): RouteResult | null {
  const j = (json && typeof json === 'object' ? json : {}) as { status?: unknown; routes?: unknown }
  if (j.status !== undefined && j.status !== 'OK') return null
  const routes = Array.isArray(j.routes) ? j.routes : []
  const route = routes[0] as { legs?: unknown; overview_polyline?: { points?: unknown } } | undefined
  const legs = route && Array.isArray(route.legs) ? (route.legs as { distance?: { value?: unknown }; duration?: { value?: unknown } }[]) : []
  if (!legs.length) return null
  let metres = 0
  let seconds = 0
  let timed = true
  for (const leg of legs) {
    const d = Number(leg?.distance?.value)
    if (!Number.isFinite(d) || d < 0) return null
    metres += d
    const s = Number(leg?.duration?.value)
    if (Number.isFinite(s) && s >= 0) seconds += s
    else timed = false
  }
  const line = route?.overview_polyline?.points
  return {
    km: round1(metres / 1000),                       // te_routes.km is numeric(10,1)
    minutes: timed ? Math.round(seconds / 60) : null,
    polyline: typeof line === 'string' && line ? line : null,
    provider: 'google',
  }
}

export function directionsUrl(from: LatLng, to: LatLng, key: string): string {
  return 'https://maps.googleapis.com/maps/api/directions/json'
    + `?origin=${from.lat},${from.lng}&destination=${to.lat},${to.lng}`
    + `&mode=driving&alternatives=false&region=in&key=${encodeURIComponent(key)}`
}

/** One Directions call. Any failure (timeout, quota, no route) is null: the engine then
 *  falls back to its estimate, and the pair is asked again next time. */
export async function googleRoute(from: LatLng, to: LatLng, key: string, fetchImpl: typeof fetch = fetch): Promise<RouteResult | null> {
  if (![from?.lat, from?.lng, to?.lat, to?.lng].every(n => Number.isFinite(Number(n)))) return null
  try {
    const res = await fetchImpl(directionsUrl(from, to, key), { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return null
    return parseDirections(await res.json())
  } catch {
    return null
  }
}

/** The provider te-service takes as ctx.routes, or undefined when no key is set. */
export function routesProvider(env: Record<string, string | undefined> = process.env): ((from: LatLng, to: LatLng) => Promise<RouteResult | null>) | undefined {
  const key = env.GOOGLE_MAPS_API_KEY
  if (!key) return undefined
  return (from, to) => googleRoute(from, to, key)
}
