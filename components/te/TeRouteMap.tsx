'use client'
// components/te/TeRouteMap.tsx — the route a journey actually took, on a map.
//
// WHAT WAS MISSING. Nothing in this product has ever drawn a recorded GPS
// trail. TeGoogleRoute draws straight lines between the places a trip was
// PLANNED through; TeLegEvidence draws exactly two points and says so on screen
// — "the straight line between the two places". So the one question a reviewer
// most wants to ask about a cab ride across Mumbai, did it go where they said
// it went, could not be asked at all.
//
// WHERE THE ROUTE COMES FROM. te_legs.route_polyline, written at the moment the
// journey ends and handed out by te_leg_json as `routeLine`. Not from the raw
// pings: te_daily() purges those after gps_rules.retentionDays, and a claim
// queried a year later is exactly when somebody wants to see the route. The
// polyline is the record that outlives them.
//
// IT DRAWS WHAT WAS RECORDED, INCLUDING THE UGLY PARTS. A segment the engine
// called an impossible jump is in this line, because that is precisely what a
// desk needs to look at. The flags beside the map say what the engine thought;
// the map itself makes no claim beyond "these are the fixes, in order".
//
// NO KEY, NO MAP, AND IT SAYS SO. Without NEXT_PUBLIC_GOOGLE_MAPS_KEY this
// renders the distance and the two ends as text rather than a grey box reading
// "map unavailable" — the facts are still true and still worth reading.
// Google is never asked for directions: the line is already known, so drawing
// it costs no request.
import { useEffect, useRef } from 'react'
import { decodePolyline } from '@/lib/te/engine/polyline.js'
import { hasMapKey, useGoogleMaps } from './plan/TeGoogleMap'
import TeIcon from './TeIcon'

export interface RouteEnd { lat: number; lng: number; label?: string }

/* The Maps JS API is loaded at runtime and has no types here. One alias, used
   deliberately, rather than `any` scattered through the file — the same shape
   TeGoogleMap declares for the same reason. */
type GMaps = Record<string, never> & { [k: string]: unknown }
interface GoogleGlobal { maps?: GMaps }
const gmaps = (): GMaps | null => ((window as unknown as { google?: GoogleGlobal }).google?.maps ?? null)

export default function TeRouteMap({ line, start, end, stops, height = 240, label, km }: {
  /** The encoded polyline from te_legs.route_polyline. '' on a journey recorded
   *  before migration 180, and on one that was never tracked. */
  line: string
  /** The start and end fixes, drawn as the two ends even when there is no
   *  trail between them — a check-in journey has only these. */
  start?: RouteEnd | null
  end?: RouteEnd | null
  /** Where the traveller stopped on the way. Business and personal are drawn
   *  the same: which is which is the engine's judgement, not the map's. */
  stops?: { lat: number; lng: number; name?: string; minutes?: number | null }[]
  height?: number
  label?: string
  /** Shown in the corner, because a route without its distance invites the
   *  reader to estimate one by eye. */
  km?: number | null
}) {
  const { ready, failed } = useGoogleMaps()
  const box = useRef<HTMLDivElement | null>(null)

  // WHY A SIGNATURE AND NOT THE ARRAYS. The caller rebuilds `stops` on every
  // render, so a dependency array holding it never matches itself and the
  // effect re-runs forever — each run building another google.maps.Map over
  // the same div, which paints as an empty grey panel. Same reasoning, and the
  // same fix, as TeGoogleRoute.
  const sig = `${line}|${start?.lat},${start?.lng}|${end?.lat},${end?.lng}|${(stops ?? []).length}`
  const data = useRef({ line, start, end, stops })
  // Written in an effect, never in the render body: a ref write during render
  // works until a re-render order changes. Declared before the drawing effect
  // so it has already run by the time that one reads it.
  useEffect(() => { data.current = { line, start, end, stops } })

  useEffect(() => {
    const { line, start, end, stops } = data.current
    const G = ready ? gmaps() : null
    if (!G || !box.current) return
    const path = decodePolyline(line)
    // The two ends stand in for a trail that was never recorded, so a check-in
    // journey still draws something true.
    const pts = path.length ? path
      : [start, end].filter(Boolean).map(p => ({ lat: Number(p!.lat), lng: Number(p!.lng) }))
    if (!pts.length) return

    const M = G as unknown as {
      Map: new (el: HTMLElement, o: unknown) => unknown
      Marker: new (o: unknown) => unknown
      Polyline: new (o: unknown) => unknown
      LatLngBounds: new () => { extend: (p: unknown) => void }
      SymbolPath: { CIRCLE: unknown }
    }
    const m = new M.Map(box.current, {
      mapTypeControl: false, streetViewControl: false, fullscreenControl: false,
      clickableIcons: false, zoom: 13, center: pts[0],
    })

    // The Maps API paints these itself and cannot read a CSS custom property,
    // so the tokens are resolved to their current values here. That keeps the
    // route following the theme instead of freezing a hex literal at whatever
    // the palette looked like the day this was written.
    // Fallbacks are CSS colour NAMES, not hex. A hex literal here would be a
    // colour frozen at whatever the palette was the day this was written — the
    // exact thing lib/ui/__tests__/theme-hardcoded-colours.test.ts exists to
    // stop — and these are only ever reached when the token system has failed
    // outright, which is already a broken state and not one to be precise in.
    const css = getComputedStyle(document.documentElement)
    const tok = (n: string, fallback: string) => css.getPropertyValue(n).trim() || fallback
    const brand = tok('--ez-brand', 'navy')
    const onAccent = tok('--ez-on-accent', 'white')
    const positive = tok('--ez-positive', 'green')
    const critical = tok('--ez-critical', 'crimson')
    const warning = tok('--ez-warning', 'darkorange')

    // THE TRAIL, SOLID. A dashed line would read as "approximate", and this is
    // the opposite of approximate — it is every fix the phone reported.
    new M.Polyline({ path: pts, map: m, strokeColor: brand, strokeOpacity: 0.9, strokeWeight: 4 })

    // Where it began and where it ended. Green and red rather than letters: on
    // a trail the question is direction, not sequence.
    const endPin = (p: { lat: number; lng: number } | undefined, colour: string, text: string, title?: string) => {
      if (!p) return
      new M.Marker({
        position: p, map: m, title,
        label: { text, color: onAccent, fontWeight: '700', fontSize: '11px' },
        icon: { path: (M.SymbolPath as { CIRCLE: unknown }).CIRCLE, scale: 9, fillColor: colour, fillOpacity: 1, strokeColor: onAccent, strokeWeight: 2 },
      })
    }
    endPin(pts[0], positive, 'S', start?.label || 'Start')
    if (pts.length > 1) endPin(pts[pts.length - 1], critical, 'E', end?.label || 'End')

    for (const s of stops ?? []) {
      const lat = Number(s.lat), lng = Number(s.lng)
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
      new M.Marker({
        position: { lat, lng }, map: m,
        title: [s.name, s.minutes ? `${s.minutes} min` : ''].filter(Boolean).join(' · ') || 'Stop',
        icon: { path: (M.SymbolPath as { CIRCLE: unknown }).CIRCLE, scale: 5, fillColor: warning, fillOpacity: 1, strokeColor: onAccent, strokeWeight: 1 },
      })
    }

    // Fit to the whole route, but do not zoom to street level on a single
    // point: a journey that recorded one fix is a fact about the recording,
    // and a maximum-zoom view of one doorway hides it.
    const b = new M.LatLngBounds()
    for (const p of pts) b.extend(p)
    const map = m as unknown as { fitBounds: (b: unknown, pad?: number) => void; setZoom: (z: number) => void; getZoom: () => number }
    map.fitBounds(b, 32)
    if (pts.length === 1) map.setZoom(15)
  }, [ready, sig])

  const path = decodePolyline(line)
  const ends = [start, end].filter(Boolean).length

  // NOTHING TO DRAW. Said plainly, with whatever is known, rather than an empty
  // panel that reads as a broken map.
  if (!line && ends < 1) {
    return (
      <div className="note">
        <TeIcon name="info" size="sm" />
        <span>No route was recorded for this journey, so there is nothing to draw.</span>
      </div>
    )
  }
  if (!hasMapKey() || failed) {
    return (
      <div className="note">
        <TeIcon name="info" size="sm" />
        <span>
          {path.length
            ? `The route was recorded — ${path.length} points${km ? `, ${km} km` : ''} — but no map key is set up on this deployment, so it cannot be drawn here.`
            : 'The two ends of this journey were recorded; there is no map key on this deployment to draw them on.'}
        </span>
      </div>
    )
  }

  return (
    <div className="routemap">
      <div ref={box} className="rm-canvas" style={{ height }} role="img"
        aria-label={label || `Map of the recorded route${km ? `, ${km} km` : ''}`} />
      <div className="rm-foot small muted">
        {path.length > 1
          ? <>Recorded route · {path.length} points{km ? <> · {km} km</> : null}</>
          : <>The two recorded ends{km ? <> · {km} km</> : null}</>}
      </div>
    </div>
  )
}
