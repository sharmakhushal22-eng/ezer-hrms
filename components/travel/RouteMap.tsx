'use client'
// components/travel/RouteMap.tsx — the route an employee actually drove.
//
// Two lines on one map:
//   purple  the route actually taken, matched to roads from the recorded trail
//   grey    the route Google would have suggested between the same two points
//
// The gap between them is the point of the whole screen. A bill-less claim has
// no receipt to check, so what an approver can check is the shape of the
// journey and how far it ran past the direct route. A detour is often
// legitimate — traffic, a one-way, a second client — so this shows the
// difference and lets a person judge it, rather than auto-rejecting.
//
// NO KEY, STILL USEFUL. Without NEXT_PUBLIC_GOOGLE_MAPS_KEY there are no map
// tiles, so the same path is drawn as an SVG trace instead: correct shape,
// correct proportions, correct distance, no basemap. The panel says so plainly.
// Rendering nothing would hide a journey that was genuinely recorded.
import { useEffect, useRef, useState } from 'react'
import { decodePolyline, projectToViewBox, type LatLng } from '@/lib/travel/polyline'
// Design tokens, aliased as TK — many of these files already declare
// their own C. See lib/ui/tokens.ts.
import { C as TK } from '@/lib/ui'

const V = {
  navy: TK.ink, purple: TK.brand, purpleDark: TK.brandDeep, border: TK.line,
  muted: TK.muted, card: TK.surface, green: TK.positive, amber: TK.warning,
  red: TK.critical, field: TK.sunken, grey: TK.faint,
}

export interface RouteData {
  actual: { distance_km: number; source: string; polyline: string; points: LatLng[] }
  optimal: { distance_km: number; duration_min: number | null; polyline: string; points: LatLng[] } | null
  comparison: { excess_km: number | null; excess_pct: number | null }
  raw_trail_km: number
  trail: {
    recorded_points: number; used_points: number
    dropped_accuracy: number; dropped_drift: number; dropped_jump: number
    mean_accuracy_m: number | null; duration_min: number; avg_speed_kmph: number | null
  }
  maps_configured: boolean
  concerns: { code: string; severity: 'WARN' | 'BLOCK'; message: string }[]
}

const km = (n: number | null | undefined) =>
  n == null ? '—' : `${Number(n).toFixed(2)} km`

// ---------------------------------------------------------------------------
// Sub-components outside the parent — inside, they remount every render.
// ---------------------------------------------------------------------------
function Stat({ label, value, colour }: { label: string; value: string; colour?: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 600, color: V.muted,
                    textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: colour || V.navy, marginTop: 2 }}>{value}</div>
    </div>
  )
}

function Legend({ hasOptimal }: { hasOptimal: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 11, color: V.muted,
                  marginTop: 8 }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <span style={{ width: 16, height: 3, background: V.purple, borderRadius: 2 }} />
        Route taken
      </span>
      {hasOptimal && (
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 16, height: 3, background: V.grey, borderRadius: 2,
                         opacity: .9 }} />
          Direct route
        </span>
      )}
      <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <span style={{ width: 9, height: 9, borderRadius: 99, background: V.green }} /> Start
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <span style={{ width: 9, height: 9, borderRadius: 99, background: V.red }} /> End
      </span>
    </div>
  )
}

/**
 * Keyless fallback — the route drawn from its own coordinates.
 * No tiles, so no external request and nothing to configure.
 */
function TraceFallback({ actual, optimal, height }: {
  actual: LatLng[]; optimal: LatLng[] | null; height: number
}) {
  const W = 600
  const H = height
  // Both paths are projected against the combined extent, so they stay aligned
  // with each other rather than each filling the box independently.
  const all = optimal ? [...actual, ...optimal] : actual
  const scaleAll = projectToViewBox(all, W, H)
  const a = scaleAll.slice(0, actual.length)
  const o = optimal ? scaleAll.slice(actual.length) : []

  const d = (pts: { x: number; y: number }[]) =>
    pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height, display: 'block',
         background: V.field, borderRadius: 10, border: `1px solid ${V.border}` }}>
      <defs>
        <pattern id="rm-grid" width="30" height="30" patternUnits="userSpaceOnUse">
          <path d="M30 0H0V30" fill="none" stroke={V.border} strokeWidth="1" />
        </pattern>
      </defs>
      <rect width={W} height={H} fill="url(#rm-grid)" />
      {o.length > 1 && (
        <path d={d(o)} fill="none" stroke={V.grey} strokeWidth="3"
              strokeDasharray="7 5" strokeLinecap="round" strokeLinejoin="round" />
      )}
      {a.length > 1 && (
        <path d={d(a)} fill="none" stroke={V.purple} strokeWidth="3.5"
              strokeLinecap="round" strokeLinejoin="round" />
      )}
      {a.length > 0 && <circle cx={a[0].x} cy={a[0].y} r="6" fill={V.green} stroke={TK.surface} strokeWidth="2" />}
      {a.length > 1 && (
        <circle cx={a[a.length - 1].x} cy={a[a.length - 1].y} r="6"
                fill={V.red} stroke={TK.surface} strokeWidth="2" />
      )}
    </svg>
  )
}

// ---------------------------------------------------------------------------
export default function RouteMap({ route, height = 300, title }: {
  route: RouteData | null
  height?: number
  title?: string
}) {
  const mapRef = useRef<HTMLDivElement | null>(null)
  const [mapFailed, setMapFailed] = useState(false)
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY

  const actualPts = route?.actual.points?.length
    ? route.actual.points
    : route ? decodePolyline(route.actual.polyline) : []
  const optimalPts = route?.optimal
    ? (route.optimal.points?.length ? route.optimal.points : decodePolyline(route.optimal.polyline))
    : null

  // ---- Google map ----------------------------------------------------------
  useEffect(() => {
    if (!key || !route || !mapRef.current || actualPts.length < 2) return
    let cancelled = false

    const draw = () => {
      const G = (window as any).google
      if (!G?.maps || !mapRef.current || cancelled) return

      const map = new G.maps.Map(mapRef.current, {
        mapTypeControl: false, streetViewControl: false, fullscreenControl: true,
        zoom: 12, center: actualPts[0],
      })

      if (optimalPts && optimalPts.length > 1) {
        new G.maps.Polyline({
          path: optimalPts, map, strokeColor: V.grey, strokeOpacity: 0, strokeWeight: 4,
          // Dashed, so it reads as a reference rather than a second journey.
          icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.9, scale: 3 },
                    offset: '0', repeat: '12px' }],
        })
      }

      new G.maps.Polyline({
        path: actualPts, map, strokeColor: V.purple, strokeOpacity: 0.95, strokeWeight: 5,
      })

      new G.maps.Marker({ position: actualPts[0], map, title: 'Start',
        icon: { path: G.maps.SymbolPath.CIRCLE, scale: 7, fillColor: V.green,
                fillOpacity: 1, strokeColor: TK.onAccent, strokeWeight: 2 } })
      new G.maps.Marker({ position: actualPts[actualPts.length - 1], map, title: 'End',
        icon: { path: G.maps.SymbolPath.CIRCLE, scale: 7, fillColor: V.red,
                fillOpacity: 1, strokeColor: TK.onAccent, strokeWeight: 2 } })

      const bounds = new G.maps.LatLngBounds()
      for (const p of [...actualPts, ...(optimalPts ?? [])]) bounds.extend(p)
      map.fitBounds(bounds, 32)
    }

    if ((window as any).google?.maps) { draw(); return }

    // One shared script tag — a second one throws "included multiple times".
    const existing = document.getElementById('ezer-gmaps') as HTMLScriptElement | null
    if (existing) {
      existing.addEventListener('load', draw)
      return () => existing.removeEventListener('load', draw)
    }

    const script = document.createElement('script')
    script.id = 'ezer-gmaps'
    script.src = `https://maps.googleapis.com/maps/api/js?key=${key}`
    script.async = true
    script.onload = draw
    // A bad key, a referrer restriction or a blocked request must not leave an
    // empty grey box — fall through to the trace instead.
    script.onerror = () => { if (!cancelled) setMapFailed(true) }
    document.head.appendChild(script)

    return () => { cancelled = true }
  }, [key, route, actualPts, optimalPts])

  if (!route) return null

  const excess = route.comparison.excess_pct
  const excessColour = excess == null ? V.muted : excess > 40 ? V.red : excess > 15 ? V.amber : V.green
  const useMap = !!key && !mapFailed && actualPts.length >= 2

  return (
    <div style={{ background: V.card, border: `1px solid ${V.border}`, borderRadius: 10,
                  padding: '14px 16px', marginBottom: 12 }}>
      {title && (
        <div style={{ fontSize: 13, fontWeight: 700, color: V.navy, marginBottom: 10 }}>{title}</div>
      )}

      {useMap
        ? <div ref={mapRef} style={{ width: '100%', height, borderRadius: 10,
                                     border: `1px solid ${V.border}` }} />
        : <TraceFallback actual={actualPts} optimal={optimalPts} height={height} />}

      <Legend hasOptimal={!!optimalPts} />

      {/* ---- the numbers ---- */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(110px,1fr))',
                    gap: 12, marginTop: 12, paddingTop: 12, borderTop: `1px solid ${V.border}` }}>
        <Stat label="Route taken" value={km(route.actual.distance_km)} colour={V.purpleDark} />
        {route.optimal && <Stat label="Direct route" value={km(route.optimal.distance_km)} />}
        {route.comparison.excess_km != null && (
          <Stat label="Difference"
                value={`${route.comparison.excess_km > 0 ? '+' : ''}${route.comparison.excess_km.toFixed(2)} km`}
                colour={excessColour} />
        )}
        <Stat label="Duration" value={`${route.trail.duration_min} min`} />
        {route.trail.avg_speed_kmph != null && (
          <Stat label="Avg speed" value={`${route.trail.avg_speed_kmph} km/h`} />
        )}
      </div>

      {/* How the distance was arrived at — an approver should not have to guess. */}
      <div style={{ fontSize: 11, color: V.muted, marginTop: 10, lineHeight: 1.6 }}>
        {route.actual.source === 'GPS_SNAPPED'
          ? <>Matched to roads from {route.trail.used_points} recorded points.</>
          : <>Measured from {route.trail.used_points} recorded points, straight-line between fixes
              {route.maps_configured ? ' (road matching was unavailable)' : ''}.</>}
        {route.trail.dropped_drift + route.trail.dropped_jump + route.trail.dropped_accuracy > 0 && (
          <> {route.trail.dropped_accuracy + route.trail.dropped_drift + route.trail.dropped_jump} point(s)
             excluded as drift, jumps or poor accuracy.</>
        )}
        {route.trail.mean_accuracy_m != null && <> Average accuracy ±{Math.round(route.trail.mean_accuracy_m)} m.</>}
      </div>

      {!key && (
        <div style={{ fontSize: 11, color: V.amber, marginTop: 8, lineHeight: 1.6 }}>
          Showing the recorded path without a basemap — no Google Maps key is configured.
          Distances above are still measured from the real trail. Set
          NEXT_PUBLIC_GOOGLE_MAPS_KEY for the map, and GOOGLE_MAPS_API_KEY on the server
          for road matching and the direct-route comparison.
        </div>
      )}

      {route.concerns.length > 0 && (
        <ul style={{ margin: '10px 0 0', paddingLeft: 18, fontSize: 12, lineHeight: 1.6 }}>
          {route.concerns.map((c, i) => (
            <li key={i} style={{ color: c.severity === 'BLOCK' ? V.red : V.amber, marginBottom: 2 }}>
              {c.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
