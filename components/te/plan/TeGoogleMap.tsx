'use client'
// components/te/plan/TeGoogleMap.tsx — a real map, when there is a key for one.
//
// WHAT THIS REPLACES. The route forms draw their own panels: TePinMap is a
// grid you tap to drop a pin, TeTripMap is the route to scale. Both are honest
// about having no streets behind them, and both are the wrong tool for
// "where exactly is this place" — the distance a claim is paid on is measured
// to that pin, so a pin dropped on a blank grid is a money error waiting to
// happen.
//
// IT NEEDS NEXT_PUBLIC_GOOGLE_MAPS_KEY, which is a DIFFERENT key from the
// server-side GOOGLE_MAPS_API_KEY the rules engine uses for distances. Anything
// NEXT_PUBLIC_ is compiled into the JavaScript every visitor downloads, so this
// one has to be referrer-restricted and limited to the Maps JavaScript API;
// the server key must never be put here.
//
// WITHOUT THE KEY IT RENDERS NOTHING and says `false` from hasMapKey(), so the
// caller keeps its existing panel. That is deliberate: a grey box reading
// "map unavailable" is worse than the schematic, which at least shows the
// shape and the scale.
//
// THE LOADER IS THE ONE RouteMap ALREADY USES — one shared <script id="ezer-gmaps">,
// because a second tag throws "included multiple times", and an onerror that
// reports failure rather than leaving an empty panel. A bad key, a referrer
// restriction or a blocked request all land there.
import { useEffect, useRef, useState } from 'react'
import TeIcon from '../TeIcon'

/** Set once, at build time. Read through a helper so callers do not each
 *  reach into process.env and disagree about what "configured" means. */
export const mapsKey = (): string | undefined => process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY || undefined
export const hasMapKey = (): boolean => !!mapsKey()

export interface MapPin { lat: number; lng: number }

/** Did the script bring the Places library? Absent when the Places API is not
 *  enabled on the key, in which case the search box must not be drawn: an
 *  input that looks like a search and never suggests anything is worse than
 *  no input. */
const hasPlaces = (): boolean => {
  const G = gmaps() as unknown as { places?: { Autocomplete?: unknown } } | null
  return !!G?.places?.Autocomplete
}

/* The Maps JS API is loaded at runtime and has no types here. One alias, used
   deliberately, rather than `any` scattered through the file. */
type GMaps = Record<string, never> & { [k: string]: unknown }
interface GoogleGlobal { maps?: GMaps }
const gmaps = (): GMaps | null => ((window as unknown as { google?: GoogleGlobal }).google?.maps ?? null)

/**
 * Load the Maps script once and tell the caller when it is ready.
 * `failed` means the script did not load: a bad key, a referrer restriction,
 * an offline browser or an ad blocker. The caller falls back.
 */
export function useGoogleMaps(): { ready: boolean; failed: boolean; places: boolean } {
  const key = mapsKey()
  const [ready, setReady] = useState(() => !!key && !!gmaps())
  const [failed, setFailed] = useState(false)
  /** Whether the script actually came back with the Places library. Asked here
   *  rather than in the component that needs it, so there is one answer about
   *  what this script provides — and so the answer arrives the same way
   *  `ready` does, from the load callback, never from an effect body. */
  const [places, setPlaces] = useState(() => hasPlaces())

  useEffect(() => {
    if (!key || ready) return
    let live = true
    const done = () => { if (live) { setReady(true); setPlaces(hasPlaces()) } }
    const bad = () => { if (live) setFailed(true) }

    if (gmaps()) { done(); return }

    const existing = document.getElementById('ezer-gmaps') as HTMLScriptElement | null
    if (existing) {
      existing.addEventListener('load', done)
      existing.addEventListener('error', bad)
      return () => { live = false; existing.removeEventListener('load', done); existing.removeEventListener('error', bad) }
    }

    const s = document.createElement('script')
    s.id = 'ezer-gmaps'
    // libraries=places so a place can be found by NAME — "Taj Hotel Mumbai"
    // rather than a street address nobody remembers. The library is requested
    // once here for every map in the module; if the Places API is not enabled
    // on the key, google.maps.places is simply absent and TePlaceSearch below
    // renders nothing rather than an input that silently does nothing.
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=places`
    s.async = true
    s.addEventListener('load', done)
    s.addEventListener('error', bad)
    document.head.appendChild(s)
    return () => { live = false; s.removeEventListener('load', done); s.removeEventListener('error', bad) }
  }, [key, ready])

  return { ready, failed, places }
}

export type FixState = 'idle' | 'asking' | 'ok' | 'denied' | 'unavailable'

/**
 * This phone's position, asked for only when the person presses the button.
 *
 * NEVER ON MOUNT. A permission prompt that appears because a form opened
 * teaches people to dismiss it, and the one time it matters they will.
 *
 * enableHighAccuracy, because the whole point is which building you are
 * standing at. The timeout is generous: a cold GPS fix indoors genuinely
 * takes this long, and failing early would send somebody back to tapping a
 * blank grid.
 */
export function useMyLocation(onFix?: (p: MapPin) => void): { fix: MapPin | null; state: FixState; ask: () => void; message: string } {
  const [fix, setFix] = useState<MapPin | null>(null)
  const [state, setState] = useState<FixState>('idle')
  // The fix arrives in a callback, long after ask() returned. A caller that
  // did `ask(); if (fix) onPin(fix)` would be reading the PREVIOUS fix, or
  // null the first time — so the position is handed over from in here, when
  // it actually exists.
  const hand = useRef(onFix)
  useEffect(() => { hand.current = onFix }, [onFix])

  const ask = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) { setState('unavailable'); return }
    setState('asking')
    navigator.geolocation.getCurrentPosition(
      p => {
        const at = { lat: p.coords.latitude, lng: p.coords.longitude }
        setFix(at); setState('ok'); hand.current?.(at)
      },
      err => setState(err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable'),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    )
  }

  const message =
    state === 'asking' ? 'Reading your location…'
    : state === 'denied' ? 'Location is blocked for this site. Allow it in your browser, or drop the pin by hand.'
    : state === 'unavailable' ? 'Your location could not be read. Drop the pin by hand instead.'
    : ''

  return { fix, state, ask, message }
}

/**
 * A map with one draggable pin.
 *
 * The pin moves on a drag OR a tap, because both are what people try, and the
 * caller is told on every move so the address and the distance follow it.
 */
export default function TeGoogleMap({ pin, onPin, height = 260, zoom = 15, label }: {
  pin: MapPin | null
  onPin: (p: MapPin) => void
  height?: number
  zoom?: number
  label?: string
}) {
  const { ready, failed } = useGoogleMaps()
  const box = useRef<HTMLDivElement | null>(null)
  const map = useRef<unknown>(null)
  const marker = useRef<unknown>(null)
  // The callback is kept in a ref so the map is built once: putting onPin in
  // the effect's deps would tear down and rebuild the map on every render of
  // the parent, losing the person's pan and zoom each time they typed.
  const cb = useRef(onPin)
  useEffect(() => { cb.current = onPin }, [onPin])

  useEffect(() => {
    const G = ready ? gmaps() : null
    if (!G || !box.current || map.current) return
    const M = G as unknown as {
      Map: new (el: HTMLElement, o: unknown) => unknown
      Marker: new (o: unknown) => unknown
      event: { addListener: (t: unknown, e: string, f: (x: unknown) => void) => void }
    }
    const centre = pin ?? { lat: 20.5937, lng: 78.9629 }   // India, when there is no pin yet
    const m = new M.Map(box.current, {
      center: centre, zoom: pin ? zoom : 4,
      // THE REAL MAP'S OWN CONTROLS, which used to be switched off. Satellite
      // is how somebody confirms the pin is on the right building rather than
      // the car park behind it, and fullscreen is how that is done on a phone.
      mapTypeControl: true, streetViewControl: true, fullscreenControl: true, zoomControl: true,
      // POI pins stay unclickable on purpose: tapping anywhere on this map
      // moves YOUR pin, and a Google info window opening instead — on the
      // restaurant next door — would quietly swallow that tap.
      clickableIcons: false,
    })
    const mk = new M.Marker({ position: centre, map: m, draggable: true })
    map.current = m
    marker.current = mk

    const moved = (p: { lat: () => number; lng: () => number }) => cb.current({ lat: p.lat(), lng: p.lng() })
    M.event.addListener(mk, 'dragend', (e: unknown) => moved((e as { latLng: { lat: () => number; lng: () => number } }).latLng))
    M.event.addListener(m, 'click', (e: unknown) => {
      const ll = (e as { latLng: { lat: () => number; lng: () => number } }).latLng
      ;(mk as { setPosition: (p: unknown) => void }).setPosition(ll)
      moved(ll)
    })
  }, [ready, pin, zoom])

  // The pin can also move from outside — "use my current location", or a
  // geocoded address — and the map has to follow it.
  useEffect(() => {
    if (!pin || !map.current || !marker.current) return
    ;(marker.current as { setPosition: (p: unknown) => void }).setPosition(pin)
    ;(map.current as { panTo: (p: unknown) => void }).panTo(pin)
  }, [pin])

  if (!hasMapKey() || failed) return null

  return (
    <div
      ref={box}
      className="gmap"
      style={{ height }}
      role="application"
      aria-label={label || 'Map. Drag the pin, or tap where the place is.'}
    />
  )
}

/**
 * The trip's route on real tiles: a lettered marker at every point, a line
 * along every journey, and the view fitted to the whole thing.
 *
 * This is the same information TeTripMap draws as a schematic, on a map that
 * has streets. The schematic stays and is still what renders without a key —
 * it is a genuinely good fallback, correct in shape, proportion and scale.
 *
 * A FLIGHT IS DRAWN DIFFERENTLY from a drive, as it is on the schematic: a
 * dashed line, because no road was taken and a solid line between two cities
 * would claim one was. Google is never asked for directions here — that is
 * the server's job, billed to the server key, and drawing a straight line
 * between two known points needs no request at all.
 */
export function TeGoogleRoute({ points, legs, height = 220, label }: {
  /** Point coordinates in order. Anything unplaced is dropped by the caller. */
  points: { lat: number; lng: number; s?: string }[]
  /** One per journey, in order, so a flight can be dashed. */
  legs?: { from: { lat: number; lng: number }; to: { lat: number; lng: number }; mode: string }[]
  height?: number
  label?: string
}) {
  const { ready, failed } = useGoogleMaps()
  const box = useRef<HTMLDivElement | null>(null)
  // WHY A SIGNATURE AND NOT THE ARRAYS. The caller builds `points` and `legs`
  // fresh on every render, so a dependency array holding them never matches
  // itself and the effect re-runs forever — each run building ANOTHER
  // google.maps.Map over the same div, which renders as an empty grey panel.
  // The route only actually changes when the coordinates do, and this is that.
  const sig = JSON.stringify([points.map(p => [p.lat, p.lng]), (legs ?? []).map(l => l.mode)])
  const data = useRef({ points, legs })
  // Written in an effect, not during render — this repo refuses a ref write in
  // the render body, and rightly: it is the kind of thing that works until a
  // re-render order changes. Declared BEFORE the drawing effect below so it
  // has already run by the time that one reads it.
  useEffect(() => { data.current = { points, legs } })

  useEffect(() => {
    const { points, legs } = data.current
    const G = ready ? gmaps() : null
    if (!G || !box.current || !points.length) return
    const M = G as unknown as {
      Map: new (el: HTMLElement, o: unknown) => unknown
      Marker: new (o: unknown) => unknown
      Polyline: new (o: unknown) => unknown
      LatLngBounds: new () => { extend: (p: unknown) => void }
      SymbolPath: { CIRCLE: unknown }
    }
    const m = new M.Map(box.current, {
      mapTypeControl: false, streetViewControl: false, fullscreenControl: false,
      clickableIcons: false, zoom: 5, center: points[0],
    })

    // The Maps API paints the label itself and cannot read a CSS custom
    // property, so the token is resolved to its current value here. That keeps
    // the letter following the theme instead of being a hex literal frozen at
    // whatever the palette looked like the day this was written.
    const onAccent = getComputedStyle(document.documentElement)
      .getPropertyValue('--ez-on-accent').trim() || 'white'

    const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    points.forEach((p, i) => {
      new M.Marker({
        position: p, map: m,
        label: { text: LETTERS[i] ?? String(i + 1), color: onAccent, fontWeight: '700', fontSize: '12px' },
        title: p.s || undefined,
      })
    })

    for (const l of legs ?? []) {
      const flight = l.mode === 'flight'
      new M.Polyline({
        path: [l.from, l.to], map: m, geodesic: flight,
        strokeOpacity: flight ? 0 : 0.85, strokeWeight: flight ? 2 : 4,
        // A flight has no road, so it is dashed rather than drawn as one.
        ...(flight ? { icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.8, scale: 3 }, offset: '0', repeat: '12px' }] } : {}),
      })
    }

    // Fit to everything, but do not zoom to street level on a single point.
    if (points.length > 1) {
      const b = new M.LatLngBounds()
      for (const p of points) b.extend(p)
      ;(m as { fitBounds: (b: unknown, pad: number) => void }).fitBounds(b, 36)
    } else {
      ;(m as { setZoom: (z: number) => void }).setZoom(13)
    }
  }, [ready, sig])

  if (!hasMapKey() || failed || !points.length) return null
  return <div ref={box} className="gmap" style={{ height }} role="img" aria-label={label || 'Map of the route'} />
}

/** What a Places result gives us: a position AND the address parts, in one
 *  request. The whole point is that nobody has to type any of it. */
export interface FoundPlace {
  lat: number
  lng: number
  name: string
  address: string
  city: string
  pin: string
  country: string
}

/** Pull the address parts out of a Places result. Shaped like the geocoder's
 *  parser in lib/te/providers/geocode.ts and for the same reason: Google
 *  returns components in no particular order, so each one is looked up by its
 *  type rather than by position. */
function partsOf(place: {
  name?: string
  formatted_address?: string
  address_components?: { long_name?: string; short_name?: string; types?: string[] }[]
  geometry?: { location?: { lat: () => number; lng: () => number } }
}): FoundPlace | null {
  const loc = place.geometry?.location
  if (!loc) return null
  const comp = (...types: string[]) => {
    for (const t of types) {
      const c = (place.address_components || []).find(k => (k.types || []).includes(t))
      if (c?.long_name) return c.long_name
    }
    return ''
  }
  return {
    lat: loc.lat(),
    lng: loc.lng(),
    name: place.name || place.formatted_address || '',
    address: place.formatted_address || '',
    // locality first, then the administrative levels, because an office in a
    // satellite town reports its own town and not the metro it sits beside.
    city: comp('locality', 'postal_town', 'administrative_area_level_3', 'administrative_area_level_2'),
    pin: comp('postal_code'),
    country: comp('country') || 'India',
  }
}

/**
 * Find a place by name, on the real map.
 *
 * WHY THIS IS THE BEST WAY IN. Every other route to a place costs the person
 * something: typing a full postal address from memory, or dropping a pin and
 * trusting a reverse lookup. Searching "Radisson Blu Indore" gives the name,
 * the formatted address, the city, the PIN and the exact coordinates in one
 * go — and the coordinates are Google's own for that building.
 *
 * WHY THIS DOES NOT USE google.maps.places.Autocomplete, which is the widget
 * built for exactly this and would be three lines instead of ninety.
 *
 * That widget appends its suggestion list to document.body as .pac-container
 * and positions it absolutely, relying on z-index to sit above the page. Every
 * screen in this module is inside a <dialog> opened with showModal(), and a
 * modal dialog renders in the browser's TOP LAYER — above the whole normal
 * stacking context, z-index 1000 or 2147483647 alike. So the list rendered,
 * correctly positioned and visible, permanently behind the sheet.
 *
 * Measured in the live app: .pac-container on <body>, one child, display
 * block, visibility visible, 710x135 at the right coordinates, and nothing on
 * screen. Re-parenting it into the dialog is the usual workaround and breaks
 * its positioning, because Google keeps writing page-relative top/left to it.
 *
 * So the predictions are fetched with AutocompleteService and drawn as part of
 * this component, inside the dialog, in the module's own list styles. It also
 * drops a widget Google deprecated in March 2025.
 *
 * ATTRIBUTION IS NOT OPTIONAL. Showing Places predictions outside a Google map
 * requires the Google wordmark, which is why the note below the list is there.
 */
export function TePlaceSearch({ onFound, label, placeholder, country }: {
  onFound: (p: FoundPlace) => void
  label?: string
  placeholder?: string
  /** An ISO country code to bias to, or undefined for anywhere. */
  country?: string
}) {
  const { ready, failed, places } = useGoogleMaps()
  const [q, setQ] = useState('')
  const [list, setList] = useState<{ id: string; main: string; rest: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const cb = useRef(onFound)
  useEffect(() => { cb.current = onFound }, [onFound])
  /** Which query the list belongs to, so a slow answer to an old one is dropped. */
  const asked = useRef('')

  useEffect(() => {
    const text = q.trim()
    asked.current = text
    // No setState here: clearing the list is done where the typing happens,
    // which is an event handler and may set state freely. An effect body may
    // not — it cascades a second render before the first has painted, and it
    // is the one lint rule every screen in this module is held to.
    if (!ready || !places || text.length < 3) return
    const G = gmaps() as unknown as {
      places?: {
        AutocompleteService?: new () => {
          getPlacePredictions: (r: unknown, cb: (res: unknown, status: string) => void) => void
        }
      }
    } | null
    const Svc = G?.places?.AutocompleteService
    if (!Svc) return
    // Debounced: one request per pause, not one per keystroke — these are
    // billed per session and per request.
    const timer = setTimeout(() => {
      new Svc().getPlacePredictions(
        { input: text, ...(country ? { componentRestrictions: { country } } : {}) },
        (res, status) => {
          if (asked.current !== text) return
          const ok = status === 'OK' && Array.isArray(res)
          setList(ok
            ? (res as { place_id: string; structured_formatting?: { main_text?: string; secondary_text?: string }; description?: string }[])
              .slice(0, 6)
              .map(r => ({
                id: r.place_id,
                main: r.structured_formatting?.main_text || r.description || '',
                rest: r.structured_formatting?.secondary_text || '',
              }))
            : [])
          setNote(ok || status === 'ZERO_RESULTS' ? '' : `Place search is unavailable (${status}).`)
        },
      )
    }, 300)
    return () => clearTimeout(timer)
  }, [q, ready, places, country])

  /** Turn the chosen prediction into a position and an address. */
  function choose(placeId: string, shown: string) {
    const G = gmaps() as unknown as {
      places?: { PlacesService?: new (el: HTMLElement) => { getDetails: (r: unknown, cb: (res: unknown, status: string) => void) => void } }
    } | null
    const Svc = G?.places?.PlacesService
    if (!Svc) return
    setBusy(true)
    setNote(`Reading ${shown}…`)
    // PlacesService needs a node to attribute into; it is never shown, because
    // the wordmark below is rendered by this component instead.
    new Svc(document.createElement('div')).getDetails(
      { placeId, fields: ['name', 'formatted_address', 'address_components', 'geometry'] },
      (res, status) => {
        setBusy(false)
        const parsed = status === 'OK' ? partsOf(res as Parameters<typeof partsOf>[0]) : null
        if (!parsed) { setNote('That place could not be read. Try another, or type the address.'); return }
        setNote('')
        setList([])
        setQ('')
        cb.current(parsed)
      },
    )
  }

  if (!hasMapKey() || failed || !places) return null

  return (
    <div className="sec">
      <label className="fld">
        <span>{label || 'Find a place by name'}</span>
        <input
          type="text"
          value={q}
          placeholder={placeholder || 'Hotel, office, airport or landmark'}
          autoComplete="off"
          onChange={e => {
            const v = e.target.value
            setQ(v)
            // Below the threshold there is nothing to suggest, and a list left
            // over from a longer query would be answering a question that is
            // no longer on screen.
            if (v.trim().length < 3) { setList([]); setNote('') }
          }}
        />
        <small>Pick a suggestion and the address, city and PIN fill themselves.</small>
      </label>

      {/* Guarded by the query length as well as by the list, so a result that
          arrives just as somebody deletes back to two characters does not
          flash up under an input that no longer asked for it. */}
      {q.trim().length >= 3 && list.length ? (
        <div className="stack sm">
          {list.map(r => (
            <button key={r.id} type="button" className="act flat" disabled={busy} onClick={() => choose(r.id, r.main)}>
              <span className="ico-b sm"><TeIcon name="pin" size="sm" /></span>
              <span><b>{r.main}</b><small>{r.rest}</small></span>
            </button>
          ))}
          {/* Required when predictions are shown outside a Google map. */}
          <small className="muted">Place suggestions by Google</small>
        </div>
      ) : null}

      {note ? <div className="note"><TeIcon name="info" size="sm" /><span>{note}</span></div> : null}
    </div>
  )
}

/**
 * Turn a position into an address IN THE BROWSER, using the already-loaded
 * Maps script and the browser key.
 *
 * WHY A SECOND PATH EXISTS. /api/te/places/lookup does the same job on the
 * server, which is the better place for it: the server key is not exposed and
 * the Geocoding quota stays off a key that sits in the page source. But the
 * server key's Google Cloud project has to have BILLING enabled, and when it
 * does not, Geocoding answers REQUEST_DENIED no matter which APIs are switched
 * on. The browser key's project is already billed — the map tiles prove it —
 * so this path works when the server one cannot.
 *
 * The caller tries the server first and falls back here, so enabling billing
 * later silently moves the work back to the server with no code change.
 *
 * Returns null for anything other than a clean answer: no library, no result,
 * ZERO_RESULTS, or an API that is not enabled. The caller then keeps the pin
 * and lets the person type, which is the honest outcome — never a guess.
 */
export async function reverseGeocodeHere(lat: number, lng: number): Promise<FoundPlace | null> {
  const G = gmaps() as unknown as {
    Geocoder?: new () => { geocode: (r: unknown, cb: (res: unknown, status: string) => void) => void }
  } | null
  if (!G?.Geocoder) return null
  const geocoder = new G.Geocoder()
  const results = await new Promise<unknown[]>(resolve => {
    // The callback form, not the promise form: the promise form REJECTS on
    // ZERO_RESULTS, which is an answer and not an error.
    let settled = false
    const finish = (r: unknown[]) => { if (!settled) { settled = true; resolve(r) } }
    // A geocoder that never calls back would hang the form open on "Looking
    // up the address…" forever.
    const timer = setTimeout(() => finish([]), 10000)
    geocoder.geocode({ location: { lat, lng } }, (res, status) => {
      clearTimeout(timer)
      finish(status === 'OK' && Array.isArray(res) ? res : [])
    })
  })
  if (!results.length) return null
  // Google returns the most specific match first — the building, then the
  // street, then the suburb — and the building is what somebody recognises.
  const parsed = partsOf(results[0] as Parameters<typeof partsOf>[0])
  if (!parsed) return null
  return {
    ...parsed,
    // THE PIN'S OWN COORDINATES, not the geocoder's. Google answers with the
    // centroid of whatever it matched — the street, or the whole suburb — and
    // returning that would quietly drag the pin off the spot the person chose.
    // The distance on their claim is measured to this point, so it is theirs.
    lat,
    lng,
    // A reverse-geocoded result has no place NAME, only a formatted address,
    // so the first line of that address stands in for one.
    name: parsed.name || parsed.address.split(',')[0] || '',
  }
}
