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

/** Set once, at build time. Read through a helper so callers do not each
 *  reach into process.env and disagree about what "configured" means. */
export const mapsKey = (): string | undefined => process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY || undefined
export const hasMapKey = (): boolean => !!mapsKey()

export interface MapPin { lat: number; lng: number }

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
export function useGoogleMaps(): { ready: boolean; failed: boolean } {
  const key = mapsKey()
  const [ready, setReady] = useState(() => !!key && !!gmaps())
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!key || ready) return
    let live = true
    const done = () => { if (live) setReady(true) }
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
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}`
    s.async = true
    s.addEventListener('load', done)
    s.addEventListener('error', bad)
    document.head.appendChild(s)
    return () => { live = false; s.removeEventListener('load', done); s.removeEventListener('error', bad) }
  }, [key, ready])

  return { ready, failed }
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
      mapTypeControl: false, streetViewControl: false, fullscreenControl: false,
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
