// src/features/expenses/ui/TripMap.tsx — the trip drawn as a schematic, and the
// "open in a map app" links (components/te/plan/TeTripMap.tsx + TeMapLinks.tsx).
//
// NO MAP TILES, ON PURPOSE. The website draws Google Maps only when the build has
// NEXT_PUBLIC_GOOGLE_MAPS_KEY, which this deployment does not have (TeMapLinks
// says so in its header), so what employees see is this keyless schematic. The
// app draws the same schematic from the same pure geometry (lib/te/trip-map.ts)
// with react-native-svg — no Maps SDK and no new paid key. A real map is one tap
// away through MapLinks, which hands the route to Google Maps / Apple Maps.
import * as React from 'react'
import { Linking, View } from 'react-native'
import Svg, { Circle, G, Path, Rect, Text as SvgText } from 'react-native-svg'
import { tripMapGeometry, type MapLeg, type MapPlace } from '@web/te/trip-map'
import { mapLinksNote, routeLinks, type MapPoint } from '@web/te/map-links'
import type { TripScope } from '@web/te/types'
import { useTheme } from '@/ui/ThemeProvider'
import { F, FONT, R } from '@/ui/theme'
import { Button, Txt } from '@/ui/primitives'
import { TeIcon } from './TeIcon'

export function TripMap({ legs, points, places, height, label }: {
  legs: MapLeg[]
  /** The trip's points in order; these get the lettered pins. */
  points: string[]
  places: Map<string, MapPlace>
  height?: number
  label?: string
}) {
  const { C } = useTheme()
  const g = tripMapGeometry({ legs, points, places, height })
  // No place has a location yet — an empty grey panel would say nothing.
  if (!g) return null
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label || 'Map of the trip'}
      style={{ width: '100%', aspectRatio: g.width / g.height, borderRadius: R.md, overflow: 'hidden', borderWidth: 1, borderColor: C.line, backgroundColor: C.sunken, marginBottom: 10 }}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${g.width} ${g.height}`}>
        <Rect width={g.width} height={g.height} fill={C.sunken} />
        <Path d={g.grid} stroke={C.line} strokeWidth={1} fill="none" opacity={0.6} />
        {/* A planned road leg is dotted: it is an intention, not a recorded track. */}
        {g.plan ? <Path d={g.plan} stroke={C.brand} strokeOpacity={0.4} strokeWidth={5} strokeLinecap="round" strokeDasharray="1 9" fill="none" /> : null}
        {g.flights ? <Path d={g.flights} stroke={C.inkSoft} strokeOpacity={0.75} strokeWidth={2} strokeDasharray="7 6" fill="none" /> : null}
        {g.marks.map(m => (
          <G key={m.letter}>
            <Circle cx={m.x} cy={m.y} r={10} fill={m.letter === 'A' ? C.positive : C.ink} stroke={C.surface} strokeWidth={2.5} />
            <SvgText x={m.x} y={m.y + 4} textAnchor="middle" fill={C.surface} fontSize={11} fontWeight="700" fontFamily={FONT[700]}>{m.letter}</SvgText>
            {m.label ? (
              <>
                <SvgText x={m.labelX} y={m.y + 4} textAnchor={m.labelAnchor as 'start' | 'end' | 'middle'} stroke={C.sunken} strokeWidth={3} fill={C.sunken} fontSize={12} fontWeight="700" fontFamily={FONT[700]}>{m.label}</SvgText>
                <SvgText x={m.labelX} y={m.y + 4} textAnchor={m.labelAnchor as 'start' | 'end' | 'middle'} fill={C.inkSoft} fontSize={12} fontWeight="700" fontFamily={FONT[700]}>{m.label}</SvgText>
              </>
            ) : null}
          </G>
        ))}
        <Path d={`M16 ${g.height - 16}h${g.scale.px}`} stroke={C.inkSoft} strokeWidth={2} />
        <SvgText x={16 + g.scale.px + 6} y={g.height - 12} fill={C.inkSoft} fontSize={11} fontFamily={FONT[400]}>{`${g.scale.km} km`}</SvgText>
      </Svg>
    </View>
  )
}

/** Open the route in the map app the person already has (TeMapLinks). Needs no key. */
export function MapLinks({ points, scope, label }: { points: (MapPoint | null | undefined)[]; scope?: TripScope; label?: string }) {
  const { C } = useTheme()
  const { google, apple, stops, appleShort } = routeLinks(points, scope)
  if (!google && !apple) return null
  const note = mapLinksNote(stops, appleShort)
  const what = label || 'this trip'
  return (
    <View style={{ gap: 6, marginBottom: 10 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {google ? (
          <View accessibilityLabel={`Open ${what} in Google Maps`}>
            <Button size="sm" variant="outline" title="Open in Google Maps" icon={<TeIcon name="pin" size="sm" color={C.brandDeep} />}
              onPress={() => void Linking.openURL(google)} />
          </View>
        ) : null}
        {apple ? (
          <View accessibilityLabel={`Open ${what} in Apple Maps`}>
            <Button size="sm" variant="outline" title="Open in Apple Maps" icon={<TeIcon name="compass" size="sm" color={C.brandDeep} />}
              onPress={() => void Linking.openURL(apple)} />
          </View>
        ) : null}
      </View>
      {note ? <Txt size={F.tiny} tone="muted">{note}</Txt> : null}
    </View>
  )
}
