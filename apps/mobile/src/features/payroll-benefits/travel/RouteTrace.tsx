// components/travel/RouteMap.tsx on the phone.
//
// The website draws a Google map when NEXT_PUBLIC_GOOGLE_MAPS_KEY is set and,
// without one, the keyless SVG trace. The app always draws the trace: a native
// Google map on Android needs its own Maps SDK key in the APK, which the
// project does not have. The trace has the real shape, proportions and the same
// numbers; the legend, stats, method line and concerns are the website's.
import * as React from 'react'
import { View } from 'react-native'
import Svg, { Circle, Defs, Path, Pattern, Rect } from 'react-native-svg'
import { decodePolyline, projectToViewBox, type LatLng } from '@web/travel/polyline'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S } from '@/ui/theme'
import { Txt } from '@/ui/primitives'
import type { RouteData } from './data'

const km = (n: number | null | undefined) => n == null ? '-' : `${Number(n).toFixed(2)} km`

function Stat({ label, value, colour }: { label: string; value: string; colour?: string }) {
  const { C } = useTheme()
  return (
    <View style={{ minWidth: 96, flexGrow: 1 }}>
      <Txt size={10} w={600} tone="muted" upper>{label}</Txt>
      <Txt size={F.lead} w={700} color={colour || C.ink} style={{ marginTop: 2 }}>{value}</Txt>
    </View>
  )
}

function Key({ swatch, label }: { swatch: React.ReactNode; label: string }) {
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>{swatch}<Txt size={F.micro} tone="muted">{label}</Txt></View>
}

function Legend({ hasOptimal }: { hasOptimal: boolean }) {
  const { C } = useTheme()
  const line = (c: string) => <View style={{ width: 16, height: 3, backgroundColor: c, borderRadius: 2 }} />
  const dot = (c: string) => <View style={{ width: 9, height: 9, borderRadius: 99, backgroundColor: c }} />
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 8 }}>
      <Key swatch={line(C.brand)} label="Route taken" />
      {hasOptimal && <Key swatch={line(C.faint)} label="Direct route" />}
      <Key swatch={dot(C.positive)} label="Start" />
      <Key swatch={dot(C.critical)} label="End" />
    </View>
  )
}

function Trace({ actual, optimal, height }: { actual: LatLng[]; optimal: LatLng[] | null; height: number }) {
  const { C } = useTheme()
  const W = 600, H = height
  // Both paths projected against the combined extent, so they stay aligned.
  const all = optimal ? [...actual, ...optimal] : actual
  const scaled = projectToViewBox(all, W, H)
  const a = scaled.slice(0, actual.length)
  const o = optimal ? scaled.slice(actual.length) : []
  const d = (pts: { x: number; y: number }[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  return (
    <View style={{ borderRadius: R.md, borderWidth: 1, borderColor: C.line, overflow: 'hidden', backgroundColor: C.sunken }}>
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
        <Defs>
          <Pattern id="rm-grid" width="30" height="30" patternUnits="userSpaceOnUse">
            <Path d="M30 0H0V30" fill="none" stroke={C.line} strokeWidth="1" />
          </Pattern>
        </Defs>
        <Rect width={W} height={H} fill="url(#rm-grid)" />
        {o.length > 1 && <Path d={d(o)} fill="none" stroke={C.faint} strokeWidth="3" strokeDasharray="7 5" strokeLinecap="round" strokeLinejoin="round" />}
        {a.length > 1 && <Path d={d(a)} fill="none" stroke={C.brand} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />}
        {a.length > 0 && <Circle cx={a[0].x} cy={a[0].y} r="6" fill={C.positive} stroke={C.surface} strokeWidth="2" />}
        {a.length > 1 && <Circle cx={a[a.length - 1].x} cy={a[a.length - 1].y} r="6" fill={C.critical} stroke={C.surface} strokeWidth="2" />}
      </Svg>
    </View>
  )
}

export function RouteTrace({ route, height = 300, title }: { route: RouteData | null; height?: number; title?: string }) {
  const { C } = useTheme()
  if (!route) return null
  const actualPts = route.actual.points?.length ? route.actual.points : decodePolyline(route.actual.polyline)
  const optimalPts = route.optimal ? (route.optimal.points?.length ? route.optimal.points : decodePolyline(route.optimal.polyline)) : null
  const excess = route.comparison.excess_pct
  const excessColour = excess == null ? C.muted : excess > 40 ? C.critical : excess > 15 ? C.warning : C.positive
  const t = route.trail
  const dropped = t.dropped_accuracy + t.dropped_drift + t.dropped_jump

  return (
    <View style={{ backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: R.md, paddingVertical: 14, paddingHorizontal: S.lg, marginBottom: 12 }}>
      {!!title && <Txt size={F.small} w={700} style={{ marginBottom: 10 }}>{title}</Txt>}
      <Trace actual={actualPts} optimal={optimalPts} height={height} />
      <Legend hasOptimal={!!optimalPts} />

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.line }}>
        <Stat label="Route taken" value={km(route.actual.distance_km)} colour={C.brandDeep} />
        {route.optimal && <Stat label="Direct route" value={km(route.optimal.distance_km)} />}
        {route.comparison.excess_km != null && (
          <Stat label="Difference" value={`${route.comparison.excess_km > 0 ? '+' : ''}${route.comparison.excess_km.toFixed(2)} km`} colour={excessColour} />
        )}
        <Stat label="Duration" value={`${t.duration_min} min`} />
        {t.avg_speed_kmph != null && <Stat label="Avg speed" value={`${t.avg_speed_kmph} km/h`} />}
      </View>

      <Txt size={F.micro} tone="muted" style={{ marginTop: 10, lineHeight: 17 }}>
        {route.actual.source === 'GPS_SNAPPED'
          ? `Matched to roads from ${t.used_points} recorded points.`
          : `Measured from ${t.used_points} recorded points, straight-line between fixes${route.maps_configured ? ' (road matching was unavailable)' : ''}.`}
        {dropped > 0 ? ` ${dropped} point(s) excluded as drift, jumps or poor accuracy.` : ''}
        {t.mean_accuracy_m != null ? ` Average accuracy ±${Math.round(t.mean_accuracy_m)} m.` : ''}
      </Txt>

      {/* The website's no-key note, without its developer instructions (the app never has a basemap). */}
      <Txt size={F.micro} color={C.warning} style={{ marginTop: 8, lineHeight: 17 }}>
        Showing the recorded path without a basemap. Distances above are still measured from the real trail.
      </Txt>

      {route.concerns.length > 0 && (
        <View style={{ marginTop: 10, gap: 2 }}>
          {route.concerns.map((c, i) => (
            <Txt key={i} size={F.tiny} color={c.severity === 'BLOCK' ? C.critical : C.warning} style={{ lineHeight: 19 }}>• {c.message}</Txt>
          ))}
        </View>
      )}
    </View>
  )
}
