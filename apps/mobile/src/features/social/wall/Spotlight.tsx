// src/features/social/wall/Spotlight.tsx — Spotlight, Leaderboard (podium),
// Hall of legends (components/wall/Spotlight.tsx). Gold is used ONLY for the
// spotlight frame and the #1 step/row; text on gold uses the gold text tokens
// (a contrast requirement, spec 6.4.15). Points are never shown.
import * as React from 'react'
import { AccessibilityInfo, Animated, Easing, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import Svg, { Ellipse, G, Path } from 'react-native-svg'
import { useTheme } from '@/ui/ThemeProvider'
import { F } from '@/ui/theme'
import { Txt } from '@/ui/primitives'
import { Avatar, Icon, RAD, WEmpty, shortDate } from './ui'

/** components/wall/Spotlight.tsx GOLD_CSS — light / dark. */
const GOLD_L = { wash: '#FEF3C7', ink: '#B45309', text: '#3A2A08', edge: '#F5C86B', soft: '#6B4E12' }
const GOLD_D = { wash: '#3A2A08', ink: '#FCD34D', text: '#FDF3D6', edge: '#7A5A18', soft: '#E4CE96' }
function useGold() { const { isDark } = useTheme(); return isDark ? GOLD_D : GOLD_L }

export interface Winner { id: string; name: string; designation?: string | null; awardName?: string | null; cycleLabel?: string | null; message?: string | null; publishedAt?: string | null; hasLeft?: boolean }
export interface LeaderRow { employeeId: string; name: string; designation?: string | null; recognitionCount: number; points?: number | null }

/** Spotlight's useCalm starts calm (no motion) until reduce-motion is known. */
function useCalm() {
  const [calm, setCalm] = React.useState(true)
  React.useEffect(() => {
    let live = true
    AccessibilityInfo.isReduceMotionEnabled().then(v => { if (live) setCalm(!!v) }).catch(() => { if (live) setCalm(false) })
    return () => { live = false }
  }, [])
  return calm
}

function Laurel({ color }: { color: string }) {
  return (
    <Svg width={170} height={170} viewBox="0 0 120 120" style={{ position: 'absolute', right: -34, top: -30, opacity: 0.35 }}>
      <G fill="none" stroke={color} strokeWidth={3} strokeLinecap="round">
        <Path d="M60 104C30 96 16 70 20 36" />
        <Path d="M60 104C90 96 104 70 100 36" />
        {[0, 1, 2, 3, 4].map(i => (
          <G key={i}>
            <Ellipse cx={24 + i * 3} cy={44 + i * 12} rx={9} ry={4.5} transform={`rotate(${-50 + i * 8} ${24 + i * 3} ${44 + i * 12})`} />
            <Ellipse cx={96 - i * 3} cy={44 + i * 12} rx={9} ry={4.5} transform={`rotate(${50 - i * 8} ${96 - i * 3} ${44 + i * 12})`} />
          </G>
        ))}
      </G>
    </Svg>
  )
}

export function Spotlight({ winner }: { winner: Winner | null }) {
  const { C } = useTheme()
  const g = useGold()
  const calm = useCalm()
  const v = React.useState(() => new Animated.Value(0))[0]
  React.useEffect(() => {
    if (!winner) return
    Animated.timing(v, { toValue: 1, duration: calm ? 0 : 600, easing: Easing.bezier(0.22, 0.72, 0.28, 1), useNativeDriver: true }).start()
  }, [v, calm, winner])
  if (!winner) {
    return (
      <View style={{ minHeight: 220, borderRadius: 20, borderWidth: 1.5, borderStyle: 'dashed', borderColor: C.line, justifyContent: 'center', padding: 16, backgroundColor: C.surface }}>
        <WEmpty icon="trophy" title="The spotlight is waiting" bare>No award has been published yet. The first one will appear here.</WEmpty>
      </View>
    )
  }
  const w = winner
  const when = shortDate(w.publishedAt)
  return (
    <Animated.View style={{ opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }, { scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.99, 1] }) }] }}>
      <View style={{ borderRadius: 20, borderWidth: 2, borderColor: g.edge, overflow: 'hidden' }}>
        <LinearGradient colors={[g.wash, g.wash, C.surface]} locations={[0, 0.38, 1]} start={{ x: 0.3, y: 0 }} end={{ x: 0.7, y: 1 }} style={{ padding: 16, gap: 12 }}>
          <Laurel color={g.edge} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4, paddingHorizontal: 11, borderRadius: 999, backgroundColor: g.ink }}>
              <Icon name="trophy" size={13} stroke={2} color={g.wash} />
              <Txt size={F.micro} w={700} color={g.wash}>{w.awardName ?? 'Award'}</Txt>
            </View>
            {!!w.cycleLabel && <Txt size={F.micro} w={600} color={g.soft}>{w.cycleLabel}</Txt>}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ padding: 3, borderRadius: 40, backgroundColor: g.edge }}><Avatar name={w.name} size={64} /></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt size={24} w={700} color={g.text} style={{ lineHeight: 28, letterSpacing: -0.4 }}>{w.name}</Txt>
              {!!w.designation && <Txt size={F.small} color={g.soft} style={{ marginTop: 4 }}>{w.designation}</Txt>}
            </View>
          </View>
          {!!w.message && (
            <View style={{ paddingLeft: 16, borderLeftWidth: 3, borderLeftColor: g.edge }}>
              <Txt size={F.body} color={g.text} style={{ lineHeight: 23 }}>{w.message}</Txt>
            </View>
          )}
          {!!when && <Txt size={F.micro} color={g.soft}>Announced {when}</Txt>}
        </LinearGradient>
      </View>
    </Animated.View>
  )
}

const HEIGHT = [112, 88, 72]

function Step({ r, rank, h, i, n, corner, calm }: { r: LeaderRow; rank: number; h: number; i: number; n: number; corner: [number, number]; calm: boolean }) {
  const { C } = useTheme()
  const g = useGold()
  const first = rank === 1
  const line = first ? g.edge : C.line
  const rise = React.useState(() => new Animated.Value(calm ? 1 : 0))[0]
  const shimmer = React.useState(() => new Animated.Value(0))[0]
  React.useEffect(() => {
    if (calm) { rise.setValue(1); return }
    Animated.timing(rise, { toValue: 1, duration: 500, delay: i * 90, easing: Easing.bezier(0.2, 0.8, 0.2, 1), useNativeDriver: true }).start()
    if (!first) return
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(shimmer, { toValue: 1, duration: 2250, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(shimmer, { toValue: 0, duration: 2250, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]))
    loop.start()
    return () => loop.stop()
  }, [calm, first, i, rise, shimmer])
  const label = `${rank}. ${r.name}, ${r.recognitionCount} ${r.recognitionCount === 1 ? 'recognition' : 'recognitions'}`
  return (
    <Animated.View accessible accessibilityLabel={label} style={{ flex: 1, maxWidth: 116, alignItems: 'center', opacity: rise, transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] }}>
      <View style={{ alignItems: 'center' }}>
        <Avatar name={r.name} size={first ? 54 : 42} ring={first ? g.edge : C.surface} />
        {first && <Txt size={19} color={g.ink} style={{ position: 'absolute', top: -14, lineHeight: 22 }}>♛</Txt>}
        <View style={{ width: first ? 34 : 26, height: 4, marginTop: -3, borderRadius: 4, backgroundColor: 'rgba(0,0,0,0.12)' }} />
      </View>
      <View style={{
        width: '100%', height: h, overflow: 'hidden', alignItems: 'center', paddingTop: 8, paddingHorizontal: 6,
        borderTopLeftRadius: corner[0], borderTopRightRadius: corner[1], backgroundColor: first ? g.wash : C.sunken,
        borderTopWidth: 1, borderTopColor: line, borderLeftWidth: 1, borderLeftColor: i === 0 ? line : C.line,
        borderRightWidth: i === n - 1 ? 1 : 0, borderRightColor: line,
      }}>
        {!first && <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.16)']} style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }} />}
        {first && <Animated.View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: '#FFFFFF', opacity: shimmer.interpolate({ inputRange: [0, 1], outputRange: [0, 0.045] }) }} />}
        <View style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 4, backgroundColor: line, opacity: 0.85 }} />
        <Txt size={F.micro} w={700} color={first ? g.text : C.ink} numberOfLines={1} center>{r.name.split(/\s+/)[0]}</Txt>
        <Txt size={11} color={first ? g.soft : C.muted} style={{ marginTop: 1 }}>{r.recognitionCount}</Txt>
        <View style={{ flex: 1 }} />
        <Txt size={first ? 34 : 26} w={700} color={first ? g.ink : C.muted}
          style={{ opacity: first ? 0.9 : 0.5, lineHeight: first ? 36 : 28, marginBottom: -3, textShadowColor: 'rgba(0,0,0,0.22)', textShadowOffset: { width: 0, height: -1 }, textShadowRadius: 0 }}>{rank}</Txt>
      </View>
    </Animated.View>
  )
}

function Podium({ rows, calm }: { rows: LeaderRow[]; calm: boolean }) {
  const { C } = useTheme()
  const seats = (rows.length >= 3 ? [1, 0, 2] : [1, 0]).filter(i => rows[i])
  const hs = seats.map(i => HEIGHT[i])
  const corner = (i: number, side: number) => { const j = i + side; return j < 0 || j >= hs.length || hs[j] < hs[i] ? 10 : 0 }
  return (
    <View style={{ marginBottom: 8, alignSelf: 'center', width: seats.length * 116, maxWidth: '100%' }}>
      <View accessibilityLabel="Top three" style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
        {seats.map((idx, i) => <Step key={rows[idx].employeeId} r={rows[idx]} rank={idx + 1} h={hs[i]} i={i} n={seats.length} corner={[corner(i, -1), corner(i, 1)]} calm={calm} />)}
      </View>
      <View style={{ height: 8, borderBottomLeftRadius: 8, borderBottomRightRadius: 8, backgroundColor: C.line }} />
    </View>
  )
}

function RankRow({ row, rank, top }: { row: LeaderRow; rank: number; top: number }) {
  const { C } = useTheme()
  const g = useGold()
  const first = rank === 1
  const pct = top > 0 ? Math.max(6, Math.round((row.recognitionCount / top) * 100)) : 0
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 12, borderRadius: RAD.tile, borderWidth: 1, borderColor: first ? g.edge : 'transparent', backgroundColor: first ? g.wash : 'transparent' }}>
      <Txt size={F.small} w={700} center color={first ? g.ink : C.faint} style={{ width: 24 }}>{rank}</Txt>
      <Avatar name={row.name} size={34} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt size={F.small} w={700} color={first ? g.text : C.ink} numberOfLines={1}>{row.name}</Txt>
        {!!row.designation && <Txt size={F.micro} color={first ? g.soft : C.muted} numberOfLines={1}>{row.designation}</Txt>}
        <View style={{ height: 4, borderRadius: 4, marginTop: 6, backgroundColor: first ? g.edge : C.sunken, overflow: 'hidden' }}>
          <View style={{ height: '100%', width: `${pct}%`, borderRadius: 4, backgroundColor: first ? g.ink : C.brand, opacity: first ? 1 : 0.7 }} />
        </View>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Txt size={F.lead} w={700} color={first ? g.text : C.ink} style={{ lineHeight: 18 }}>{row.recognitionCount}</Txt>
        <Txt size={11} color={first ? g.soft : C.muted} style={{ marginTop: 3 }}>{row.recognitionCount === 1 ? 'recognition' : 'recognitions'}</Txt>
      </View>
    </View>
  )
}

export function Leaderboard({ rows, enabled }: { rows: LeaderRow[]; enabled: boolean }) {
  const calm = useCalm()
  if (!enabled) return <WEmpty icon="list" compact>Your company has the leaderboard switched off.</WEmpty>
  if (!rows.length) return <WEmpty icon="list" compact>Nobody is on the board yet. It fills as recognitions are published.</WEmpty>
  const top = rows[0]?.recognitionCount ?? 0
  const onPodium = rows.length >= 2 ? Math.min(rows.length, 3) : 0
  const rest = rows.slice(onPodium)
  return (
    <View>
      {onPodium > 0 && <Podium key={calm ? 'c' : 'm'} rows={rows} calm={calm} />}
      {rest.length > 0 && <View style={{ gap: 4 }}>{rest.map((r, i) => <RankRow key={r.employeeId} row={r} rank={i + onPodium + 1} top={top} />)}</View>}
      <Txt size={F.micro} tone="faint" style={{ marginTop: 8, paddingLeft: 12 }}>Counts recognitions received. It affects nothing else.</Txt>
    </View>
  )
}

function LegendRow({ w }: { w: Winner }) {
  const { C } = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 6 }}>
      <View style={{ opacity: w.hasLeft ? 0.6 : 1 }}><Avatar name={w.name} size={32} /></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
          <Txt size={F.small} w={600}>{w.name}</Txt>
          {w.hasLeft && <View style={{ paddingVertical: 1, paddingHorizontal: 7, borderRadius: 999, backgroundColor: C.sunken }}><Txt size={11} w={600} tone="muted">no longer here</Txt></View>}
        </View>
        <Txt size={F.micro} tone="muted">{[w.awardName, w.cycleLabel].filter(Boolean).join(' · ')}</Txt>
      </View>
      {!!w.publishedAt && <Txt size={11} tone="faint">{new Date(w.publishedAt).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}</Txt>}
    </View>
  )
}

export function HallOfLegends({ winners }: { winners: Winner[] }) {
  if (!winners.length) return <WEmpty icon="trophy" compact>Past award winners will be listed here once the first cycle closes.</WEmpty>
  return (
    <View>
      <View style={{ gap: 2 }}>{winners.map(w => <LegendRow key={w.id} w={w} />)}</View>
      <Txt size={F.micro} tone="faint" style={{ marginTop: 8, lineHeight: 16 }}>People who have left the company stay here. What somebody won is still theirs.</Txt>
    </View>
  )
}
