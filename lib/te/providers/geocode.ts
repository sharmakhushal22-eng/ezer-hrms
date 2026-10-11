// lib/te/providers/geocode.ts — address → position, and position → address.
//
// Used when an employee types an address without dropping a pin (geocode), and
// when they pin a place by GPS and it needs a name (reverseGeocode). Google
// Geocoding API with the server key the repo already has (GOOGLE_MAPS_API_KEY;
// the Geocoding API must be enabled on that key). Without the key both
// providers are absent: a typed address then needs a pin, and a GPS pin is
// stored as "GPS point (lat, lng)".
//
// PURE PART: parseGeocode(), parseReverseGeocode(), addressLine() — unit-tested.
// NETWORK PART: googleGeocode(), googleReverseGeocode() — NOT executed in the sandbox.

export interface AddressQuery { line: string; area: string; city: string; state?: string; pin: string; country: string }
export interface GeocodeResult { lat: number; lng: number; approx: boolean }
export interface ReverseGeocodeResult { name: string; address: string; city: string; pin: string; country: string }

interface GResult {
  formatted_address?: string
  geometry?: { location?: { lat?: number; lng?: number }; location_type?: string }
  address_components?: { long_name?: string; short_name?: string; types?: string[] }[]
}
const results = (json: unknown): GResult[] => {
  const j = (json && typeof json === 'object' ? json : {}) as { status?: unknown; results?: unknown }
  if (j.status !== undefined && j.status !== 'OK') return []
  return Array.isArray(j.results) ? (j.results as GResult[]) : []
}
const part = (r: GResult, ...types: string[]): string => {
  for (const t of types) {
    const c = (r.address_components || []).find(k => (k.types || []).includes(t))
    if (c?.long_name) return c.long_name
  }
  return ''
}

/** The one-line address sent to the geocoder. */
export function addressLine(a: AddressQuery): string {
  return [a.line, a.area, a.city, a.pin, a.country].map(s => String(s || '').trim()).filter(Boolean).join(', ')
}

/** approx = Google placed it at the centre of an area, not at the building: the UI should ask for a pin. */
export function parseGeocode(json: unknown): GeocodeResult | null {
  const r = results(json)[0]
  const lat = Number(r?.geometry?.location?.lat)
  const lng = Number(r?.geometry?.location?.lng)
  if (!r || !Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return null
  const kind = r.geometry?.location_type || ''
  return { lat, lng, approx: !(kind === 'ROOFTOP' || kind === 'RANGE_INTERPOLATED') }
}

export function parseReverseGeocode(json: unknown): ReverseGeocodeResult | null {
  const r = results(json)[0]
  if (!r) return null
  const name = part(r, 'premise', 'point_of_interest', 'establishment', 'sublocality_level_1', 'sublocality', 'neighborhood', 'route')
  const city = part(r, 'locality', 'administrative_area_level_3', 'administrative_area_level_2')
  return {
    name: name || city || 'GPS point',
    address: r.formatted_address || '',
    city,
    pin: part(r, 'postal_code'),
    country: part(r, 'country') || 'India',
  }
}

const BASE = 'https://maps.googleapis.com/maps/api/geocode/json'

export async function googleGeocode(a: AddressQuery, key: string, fetchImpl: typeof fetch = fetch): Promise<GeocodeResult | null> {
  try {
    const india = !a.country || a.country === 'India'
    const url = `${BASE}?address=${encodeURIComponent(addressLine(a))}${india ? '&components=country:IN' : ''}&key=${encodeURIComponent(key)}`
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(8000) })
    return res.ok ? parseGeocode(await res.json()) : null
  } catch {
    return null
  }
}

export async function googleReverseGeocode(lat: number, lng: number, key: string, fetchImpl: typeof fetch = fetch): Promise<ReverseGeocodeResult | null> {
  try {
    const res = await fetchImpl(`${BASE}?latlng=${lat},${lng}&key=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(8000) })
    return res.ok ? parseReverseGeocode(await res.json()) : null
  } catch {
    return null
  }
}

export function geocodeProviders(env: Record<string, string | undefined> = process.env): {
  geocode?: (a: AddressQuery) => Promise<GeocodeResult | null>
  reverseGeocode?: (lat: number, lng: number) => Promise<ReverseGeocodeResult | null>
} {
  const key = env.GOOGLE_MAPS_API_KEY
  if (!key) return {}
  return { geocode: a => googleGeocode(a, key), reverseGeocode: (lat, lng) => googleReverseGeocode(lat, lng, key) }
}
