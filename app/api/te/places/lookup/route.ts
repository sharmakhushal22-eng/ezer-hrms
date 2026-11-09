// GET /api/te/places/lookup?lat=&lng= — what is at this position?
//
// WHY THIS EXISTS. "Use my current location" used to read the phone's GPS and
// immediately save a place, then close the picker. The address was resolved —
// placeAdd has always called reverseGeocode — but only on the way into the
// database, so the person never saw what was found, could not correct a pin
// that landed on the building next door, and the button's own subtitle
// ("fills the address from the map") was describing something invisible.
//
// This route answers the same question WITHOUT writing anything, so the form
// can fill itself in front of the person and they can confirm or drag the pin.
//
// THE SERVER KEY, NOT THE BROWSER ONE. GOOGLE_MAPS_API_KEY is unrestricted by
// referrer; NEXT_PUBLIC_GOOGLE_MAPS_KEY is referrer-locked for the map tiles
// and would be refused for a Geocoding call from a server. Doing the lookup
// here also keeps the Geocoding quota off a key that sits in the page source.
//
// NO PROVIDER, NO GUESS. With no key configured reverseGeocode is absent and
// this returns found: false. The caller then leaves the address fields empty
// for the person to type, which is what it did before this route existed —
// never a made-up address.
import { NextRequest } from 'next/server'
import { teRoute, teProviders } from '@/lib/te/server'
import { TeHttpError } from '@/lib/te/errors'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** A coordinate that is actually a coordinate. 0,0 is in the Atlantic and is
 *  what an unset pair looks like, so it is refused rather than looked up. */
function coord(v: string | null, limit: number): number {
  const n = Number(v)
  if (!Number.isFinite(n) || Math.abs(n) > limit) {
    throw new TeHttpError(400, 'TE_BAD_REQUEST', 'That is not a position on the map.')
  }
  return n
}

export async function GET(req: NextRequest) {
  return teRoute(req, async t => {
    // Signed in is enough: this reads a public map, not company data. The call
    // is still behind the session so the Geocoding quota cannot be spent by
    // anybody who finds the URL.
    await t.actor()
    const q = req.nextUrl.searchParams
    const lat = coord(q.get('lat'), 90)
    const lng = coord(q.get('lng'), 180)
    if (!lat && !lng) {
      throw new TeHttpError(400, 'TE_BAD_REQUEST', 'That is not a position on the map.')
    }
    const rev = teProviders().reverseGeocode
    if (!rev) return { found: false as const, lat, lng }
    const r = await rev(lat, lng)
    if (!r) return { found: false as const, lat, lng }
    return { found: true as const, lat, lng, ...r }
  })
}
