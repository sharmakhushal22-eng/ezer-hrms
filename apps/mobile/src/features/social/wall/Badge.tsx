// src/features/social/wall/Badge.tsx — generated badge art and the cabinet
// (components/wall/Badge.tsx + BadgeCabinet.tsx), drawn with react-native-svg.
//
// Shape = kind of badge, metal = how many times earned, glyph = the work. Paths,
// metals, gradient stops, highlight and plate circles are copied from the web.
// feDropShadow and CSS grayscale do not exist here: the drop shadow becomes a
// faint offset copy of the shape, and "locked" keeps the web's opacity .5 with
// a neutral (silver) metal in place of the greyscale filter (spec 6.4.15).
import * as React from 'react'
import { Animated, Easing, View, useWindowDimensions } from 'react-native'
import Svg, { Circle, Defs, G, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg'
import { useTheme } from '@/ui/ThemeProvider'
import { F } from '@/ui/theme'
import { Txt } from '@/ui/primitives'
import { RAD, WEmpty } from './ui'

export type BadgeTier = 'blue' | 'bronze' | 'silver' | 'gold' | 'platinum'
export type BadgeShape = 'shield' | 'hex' | 'medal' | 'ring'
interface Metal { a: string; b: string; c: string; rim: string; label: string }

export const BADGE_TIERS: Record<BadgeTier, Metal> = {
  blue: { a: '#DBEAFE', b: '#3B82F6', c: '#1D4ED8', rim: '#93C5FD', label: 'Blue' },
  bronze: { a: '#F6D5B3', b: '#C97B3C', c: '#7C4318', rim: '#E0A472', label: 'Bronze' },
  silver: { a: '#F7FAFD', b: '#A9B6C6', c: '#5F6E80', rim: '#D5DEE8', label: 'Silver' },
  gold: { a: '#FDEBB0', b: '#EFB02A', c: '#9A5E06', rim: '#F8D77A', label: 'Gold' },
  platinum: { a: '#F0F8FF', b: '#9BC0E6', c: '#3F6B94', rim: '#CBE1F5', label: 'Platinum' },
}
const SHAPE_PATH: Record<BadgeShape, string> = {
  shield: 'M60 8 L104 27 V72 C104 99 84 117 60 125 C36 117 16 99 16 72 V27 Z',
  hex: 'M60 7 L104 32 V82 L60 107 L16 82 V32 Z',
  medal: 'M60 12 a48 48 0 1 1 -0.1 0 Z',
  ring: 'M60 10 a50 50 0 1 1 -0.1 0 Z',
}
const RING_C = 2 * Math.PI * 54
let seq = 0

function Rays({ colour, size }: { colour: string; size: number }) {
  const v = React.useState(() => new Animated.Value(0))[0]
  React.useEffect(() => {
    const loop = Animated.loop(Animated.timing(v, { toValue: 1, duration: 22000, easing: Easing.linear, useNativeDriver: true }))
    loop.start()
    return () => loop.stop()
  }, [v])
  // The rays rotate about (60,66) of the -6 -6 132 144 box: draw them in a square
  // centred on that point and spin the square.
  const k = size / 132
  const box = 144 * k
  const cx = (60 + 6) * k, cy = (66 + 6) * k
  return (
    <Animated.View pointerEvents="none" style={{ position: 'absolute', left: cx - box / 2, top: cy - box / 2, width: box, height: box, transform: [{ rotate: v.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }}>
      <Svg width={box} height={box} viewBox="-12 -6 144 144">
        {Array.from({ length: 16 }, (_, i) => (
          <Rect key={i} x={59} y={-6} width={2.4} height={16} rx={1.2} fill={colour} opacity={i % 2 ? 0.35 : 0.7} transform={`rotate(${i * 22.5} 60 66)`} />
        ))}
      </Svg>
    </Animated.View>
  )
}

export function Badge({ shape = 'shield', tier = 'bronze', glyph = '★', years, label, sub, count = 1, locked = false, progress = 0, size = 118, showLabel = true }: {
  shape?: BadgeShape; tier?: BadgeTier; glyph?: string; years?: number; label?: string; sub?: string
  count?: number; locked?: boolean; progress?: number; size?: number; showLabel?: boolean
}) {
  const { C } = useTheme()
  const uid = React.useMemo(() => `b${++seq}`, [])
  const metal = BADGE_TIERS[locked ? 'silver' : tier] ?? BADGE_TIERS.bronze
  const path = SHAPE_PATH[shape] ?? SHAPE_PATH.shield
  const h = Math.round(size * 1.1)
  const pct = Math.max(0, Math.min(100, progress))
  return (
    <View style={{ width: size, alignItems: 'center' }} accessibilityLabel={label ?? 'Badge'}>
      <View style={{ width: size, height: h, opacity: locked ? 0.5 : 1 }}>
        {tier === 'platinum' && !locked && <Rays colour={metal.rim} size={size} />}
        <Svg width={size} height={h} viewBox="-6 -6 132 144">
          <Defs>
            <LinearGradient id={`mg${uid}`} x1="0" y1="0" x2="0.35" y2="1">
              <Stop offset="0%" stopColor={metal.a} /><Stop offset="42%" stopColor={metal.b} />
              <Stop offset="72%" stopColor={metal.c} /><Stop offset="100%" stopColor={metal.b} />
            </LinearGradient>
            <LinearGradient id={`pl${uid}`} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%" stopColor={metal.c} /><Stop offset="100%" stopColor={metal.b} />
            </LinearGradient>
            <RadialGradient id={`hl${uid}`} cx="34%" cy="24%" r="62%">
              <Stop offset="0%" stopColor="#FFFFFF" stopOpacity={0.55} /><Stop offset="100%" stopColor="#FFFFFF" stopOpacity={0} />
            </RadialGradient>
          </Defs>
          {locked && (
            <>
              <Circle cx={60} cy={64} r={54} fill="none" stroke="#CBD5E1" strokeWidth={4} opacity={0.45} />
              <Circle cx={60} cy={64} r={54} fill="none" stroke="#2563EB" strokeWidth={4} strokeLinecap="round"
                strokeDasharray={`${((RING_C * pct) / 100).toFixed(1)} ${RING_C.toFixed(1)}`} transform="rotate(-90 60 64)" />
            </>
          )}
          {shape === 'medal' && (
            <>
              <Path d="M40 96 L28 130 L46 122 L58 130 L52 96 Z" fill={metal.c} opacity={0.9} />
              <Path d="M80 96 L92 130 L74 122 L62 130 L68 96 Z" fill={metal.b} opacity={0.9} />
            </>
          )}
          {/* the drop shadow (dy 4, colour c, opacity .38), as an offset copy */}
          <Path d={path} fill={metal.c} opacity={0.22} transform="translate(0 4)" />
          <G>
            <Path d={path} fill={`url(#mg${uid})`} stroke={metal.rim} strokeWidth={1.5} />
            <Path d={path} fill={`url(#hl${uid})`} />
            <Path d={path} fill="none" stroke="#FFFFFF" strokeOpacity={0.38} strokeWidth={1} transform="translate(60 62) scale(.86) translate(-60 -62)" />
            {shape === 'ring' && <Circle cx={60} cy={60} r={38} fill="none" stroke={`url(#pl${uid})`} strokeWidth={9} opacity={0.55} />}
            <Circle cx={60} cy={55} r={27} fill={`url(#pl${uid})`} opacity={0.42} />
          </G>
        </Svg>
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: Math.round(size * 0.22), height: Math.round(size * 0.48), alignItems: 'center', justifyContent: 'center', opacity: locked ? 0.7 : 1 }}>
          <Txt size={shape === 'ring' ? Math.round(size * 0.23) : Math.round(size * 0.26)} w={shape === 'ring' ? 800 : 400}
            color={shape === 'ring' ? '#FFFFFF' : undefined}
            style={{ lineHeight: Math.round(size * 0.34), textShadowColor: 'rgba(0,0,0,0.28)', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 3 }}>
            {shape === 'ring' ? (years ?? '') : glyph}
          </Txt>
        </View>
        {!locked && count > 1 && (
          <View style={{ position: 'absolute', right: 2, top: 6, minWidth: 26, height: 26, paddingHorizontal: 6, borderRadius: 999, backgroundColor: C.ink, borderWidth: 2, borderColor: C.surface, alignItems: 'center', justifyContent: 'center' }}>
            <Txt size={12} w={800} color={C.surface}>×{count}</Txt>
          </View>
        )}
        {locked && (
          <View style={{ position: 'absolute', bottom: 34, alignSelf: 'center', paddingVertical: 2, paddingHorizontal: 8, borderRadius: 999, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line }}>
            <Txt size={10.5} w={700} tone="muted">{progress}%</Txt>
          </View>
        )}
      </View>
      {showLabel && !!label && <Txt size={12.5} w={600} center color={locked ? C.faint : C.ink} style={{ marginTop: 6, lineHeight: 16 }}>{label}</Txt>}
      {showLabel && !!sub && <Txt size={11} center tone="faint" style={{ marginTop: 2 }}>{sub}</Txt>}
    </View>
  )
}

export interface MyBadge {
  badge_code: string; label: string; glyph: string | null; tier: string | null; shape: string | null
  earned_count: number | null; progress_pct: number | null; earned_at: string | null
}

export function BadgeCabinet({ badges, size = 118 }: { badges: MyBadge[]; size?: number }) {
  const { C } = useTheme()
  const { width } = useWindowDimensions()
  if (!badges.length) {
    return (
      <WEmpty icon="medal" title="Your cabinet is empty" compact>
        Badges arrive from awards, company values and service milestones, the last of those on their own, from your joining date.
      </WEmpty>
    )
  }
  const earned = badges.filter(b => b.earned_at).length
  // auto-fill minmax(size+16px): two to a row on a phone.
  const inner = Math.min(width, 760) - 32 - 32 - 24
  const cols = Math.max(1, Math.floor((inner + 10) / (size + 16 + 10)))
  const cell = Math.floor((inner - 10 * (cols - 1)) / cols)
  return (
    <View>
      <Txt size={F.micro} tone="muted" style={{ marginBottom: 10 }}>
        <Txt size={F.micro} w={700}>{earned}</Txt> earned{badges.length > earned ? `, ${badges.length - earned} in progress` : ''}
      </Txt>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, padding: 12, borderRadius: RAD.tile, backgroundColor: C.sunken, borderWidth: 1, borderColor: C.line }}>
        {badges.map(b => (
          <View key={b.badge_code} style={{ width: cell, alignItems: 'center' }}>
            <Badge size={size}
              tier={(b.tier as BadgeTier) ?? 'blue'} shape={(b.shape as BadgeShape) ?? 'shield'} glyph={b.glyph ?? '★'}
              label={b.label}
              sub={b.earned_at ? new Date(b.earned_at).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : undefined}
              count={b.earned_count ?? 1} locked={!b.earned_at} progress={b.progress_pct ?? 0} showLabel />
          </View>
        ))}
      </View>
    </View>
  )
}
