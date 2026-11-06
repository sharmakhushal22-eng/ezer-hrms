// src/features/expenses/plan/PinMap.tsx — put a pin where the address is
// (components/te/plan/TePinMap.tsx, the "no key" branch).
//
// NO MAP TILES. The website draws Google Maps here only when the build has
// NEXT_PUBLIC_GOOGLE_MAPS_KEY, which the deployment does not have, so what an
// employee sees is this schematic grid. The app draws the same grid with
// react-native-svg and does the same arithmetic (lib/te/trip-map.ts): a tap is
// converted to viewBox units (640 × 220) and handed to pixelToPin; the arrows
// nudge by span/16 km; zoom halves or doubles the span (1–96 km).
import * as React from 'react'
import { Pressable, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native'
import Svg, { Circle, Path, Rect, Text as SvgText } from 'react-native-svg'
import { nudgePin, pinToPixel, pixelToPin, zoomPin, type PinView } from '@web/te/trip-map'
import { useTheme } from '@/ui/ThemeProvider'
import { F, FONT, R, S } from '@/ui/theme'
import { Txt } from '@/ui/primitives'
import { TeIcon } from '../ui/TeIcon'
import { Flag } from '../ui/kit'

const W = 640
const H = 220
const STEP = W / 8
let GRID = ''
for (let x = STEP; x < W; x += STEP) GRID += `M${x} 0V${H}`
for (let y = STEP; y < H; y += STEP) GRID += `M0 ${y}H${W}`

const NUDGE: { d: 'n' | 'w' | 's' | 'e'; glyph: string; label: string }[] = [
  { d: 'n', glyph: '↑', label: 'Move north' },
  { d: 'w', glyph: '←', label: 'Move west' },
  { d: 's', glyph: '↓', label: 'Move south' },
  { d: 'e', glyph: '→', label: 'Move east' },
]

function SmallBtn({ label, onPress, disabled, children }: { label: string; onPress: () => void; disabled?: boolean; children: React.ReactNode }) {
  const { C } = useTheme()
  return (
    <Pressable onPress={disabled ? undefined : onPress} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => ({ minWidth: 44, height: 44, borderRadius: R.sm, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.line, backgroundColor: pressed ? C.sunken : C.surface, opacity: disabled ? 0.45 : 1 })}>
      {children}
    </Pressable>
  )
}

export function PinMap({ pin, view, onPin, onView }: {
  pin: { lat: number; lng: number } | null
  view: PinView
  onPin: (p: { lat: number; lng: number }) => void
  onView: (v: PinView) => void
}) {
  const { C } = useTheme()
  const [box, setBox] = React.useState({ w: 0, h: 0 })
  const at = pin ? pinToPixel(pin, view, W, H) : null

  const onLayout = (e: LayoutChangeEvent) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })
  /** A tap anywhere on the panel moves the pin there (viewBox units first). */
  const tap = (e: GestureResponderEvent) => {
    if (!box.w || !box.h) return
    const x = (e.nativeEvent.locationX / box.w) * W
    const y = (e.nativeEvent.locationY / box.h) * H
    onPin(pixelToPin(x, y, view, W, H))
  }

  return (
    <View style={{ gap: S.sm }}>
      <Pressable onPress={tap} onLayout={onLayout} accessibilityRole="image" accessibilityLabel="Place the pin on the map" accessibilityHint="Tap to move the pin"
        style={{ width: '100%', aspectRatio: W / H, borderRadius: R.md, overflow: 'hidden', borderWidth: 1, borderColor: C.line, backgroundColor: C.sunken }}>
        <View pointerEvents="none" style={{ flex: 1 }}>
          <Svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`}>
            <Rect width={W} height={H} fill={C.sunken} />
            <Path d={GRID} stroke={C.line} strokeWidth={1} fill="none" opacity={0.6} />
            {at ? (
              <>
                <Circle cx={at.x} cy={at.y} r={16} fill={C.brand} opacity={0.18} />
                <Circle cx={at.x} cy={at.y} r={7} fill={C.brand} stroke={C.surface} strokeWidth={2.5} />
              </>
            ) : (
              <SvgText x={W / 2} y={H / 2} textAnchor="middle" fill={C.muted} fontSize={13} fontFamily={FONT[400]}>Tap where the place is</SvgText>
            )}
            <Path d={`M16 ${H - 16}h${W / 8}`} stroke={C.inkSoft} strokeWidth={2} />
            <SvgText x={16 + W / 8 + 6} y={H - 12} fill={C.inkSoft} fontSize={11} fontFamily={FONT[400]}>{`${Math.round((view.span / 8) * 10) / 10} km`}</SvgText>
          </Svg>
        </View>
      </Pressable>

      <Txt size={F.tiny} tone="muted">Tap the map or use the arrows to move the pin.</Txt>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        <View accessibilityLabel="Move the pin" style={{ flexDirection: 'row', gap: 6 }}>
          {NUDGE.map(n => (
            <SmallBtn key={n.d} label={n.label} disabled={!pin} onPress={() => pin && onPin(nudgePin(pin, n.d, view))}>
              <Txt size={F.lead} w={700}>{n.glyph}</Txt>
            </SmallBtn>
          ))}
        </View>
        <SmallBtn label="Zoom in" onPress={() => onView(zoomPin(view, 'in'))}><TeIcon name="plus" size="sm" color={C.ink} /></SmallBtn>
        <SmallBtn label="Zoom out" onPress={() => onView(zoomPin(view, 'out'))}><TeIcon name="minus" size="sm" color={C.ink} /></SmallBtn>
      </View>

      {pin ? (
        <Flag tone="ok" icon="check" title={`Pin at ${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)}`}>
          The route and the distance are measured to this point.
        </Flag>
      ) : (
        <Flag tone="warn" icon="alert" title="This address has no position yet">
          Tap the exact spot on the map. Without it the distance to this place cannot be measured.
        </Flag>
      )}
    </View>
  )
}
