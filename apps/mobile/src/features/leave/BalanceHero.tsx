// src/features/leave/BalanceHero.tsx — "Leave balance · FY 2026-27": the total,
// the jump to the Apply panel, and one tile per headline type.
// Source: components/ess/LeaveSection.tsx (hero section + .ezlv-hero CSS).
import * as React from 'react'
import { AccessibilityInfo, Animated, Easing, Pressable, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { useTheme } from '@/ui/ThemeProvider'
import { elevation, F, R, S } from '@/ui/theme'
import { Txt } from '@/ui/primitives'
import { avail, barClass, type Balance, type Bar, type Payload } from './logic'

// The website's dark hero is a fixed navy rather than a theme token, because
// brand-on-brand inverts in dark (LeaveSection.tsx CSS, --lv-hero dark block).
const DARK_HERO = ['#0B1220', '#16223C', '#22355E'] as const
const DARK_INK = '#F6F9FF'
const DARK_SUB = 'rgba(216,229,252,0.78)'
const DARK_FILL = 'rgba(255,255,255,0.085)'
const DARK_EDGE = 'rgba(255,255,255,0.15)'
const DARK_CHIP = 'rgba(255,255,255,0.2)'
const DARK_TRACK = 'rgba(255,255,255,0.18)'
const DARK_BAR: Record<Bar, string> = { ok: 'rgba(110,231,183,1)', warn: 'rgba(252,211,77,1)', bad: 'rgba(252,165,165,1)' }

function useReduceMotion() {
  const [reduce, setReduce] = React.useState(false)
  React.useEffect(() => {
    let live = true
    AccessibilityInfo.isReduceMotionEnabled().then(v => { if (live) setReduce(v) }).catch(() => {})
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce)
    return () => { live = false; sub.remove() }
  }, [])
  return reduce
}

/** Counts a figure up once, the first time it lands (700 ms ease-out cubic, half steps). */
function useCountUp(target: number, live: boolean, reduce: boolean) {
  const [v, setV] = React.useState(target)
  const spent = React.useRef(false)
  React.useEffect(() => {
    if (!live || spent.current || reduce || !(target > 0)) { setV(target); return }
    spent.current = true
    let raf = 0
    const t0 = Date.now()
    const tick = () => {
      const p = Math.min(1, (Date.now() - t0) / 700)
      setV(Math.round(target * (1 - Math.pow(1 - p, 3)) * 2) / 2)
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, live, reduce])
  return v
}

function Tile({ b, i, reduce }: { b: Balance; i: number; reduce: boolean }) {
  const { C, isDark } = useTheme()
  const total = Number(b.opening || 0) + Number(b.accrued || 0)
  const av = avail(b)
  const pct = total > 0 ? Math.round(av / total * 100) : 0
  const width = Math.min(100, Math.max(0, pct))
  const bar = barClass(pct)
  const grow = React.useRef(new Animated.Value(reduce ? 1 : 0)).current
  React.useEffect(() => {
    if (reduce) { grow.setValue(1); return }
    Animated.timing(grow, { toValue: 1, duration: 700, delay: 260 + i * 60, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start()
  }, [grow, i, reduce])
  const sub = isDark ? DARK_SUB : C.muted
  const barColor = isDark ? DARK_BAR[bar] : bar === 'ok' ? C.positive : bar === 'warn' ? C.warning : C.critical
  return (
    <View style={{
      flexGrow: 1, flexBasis: '45%', minWidth: 140, borderRadius: R.md, borderWidth: 1, padding: 10,
      backgroundColor: isDark ? DARK_FILL : C.surface, borderColor: isDark ? DARK_EDGE : C.hair,
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <View style={{ paddingHorizontal: 7, paddingVertical: 1, borderRadius: R.pill, backgroundColor: isDark ? DARK_CHIP : C.brandTint }}>
          <Txt size={10} w={700} color={isDark ? DARK_INK : C.brand}>{b.leave_types?.short_name}</Txt>
        </View>
        <Txt size={F.micro} color={sub} numberOfLines={1} style={{ flex: 1 }}>{b.leave_types?.name}</Txt>
      </View>
      <Txt size={21} w={700} color={isDark ? DARK_INK : C.ink} style={{ lineHeight: 24, marginBottom: 6 }}>
        {av}<Txt size={F.micro} w={500} color={sub}> / {total}</Txt>
      </Txt>
      {Number(b.pending) > 0 && <Txt size={F.micro} color={sub} numberOfLines={1}>{b.pending} pending approval</Txt>}
      <View accessibilityRole="image" accessibilityLabel={`${av} of ${total} days left`}
        style={{ height: 5, borderRadius: 3, overflow: 'hidden', marginTop: 4, backgroundColor: isDark ? DARK_TRACK : C.sunken }}>
        <Animated.View style={{
          height: '100%', borderRadius: 3, backgroundColor: barColor,
          width: grow.interpolate({ inputRange: [0, 1], outputRange: ['0%', `${width}%`] }),
        }} />
      </View>
    </View>
  )
}

export function BalanceHero({ data, onApply }: { data: Payload; onApply: () => void }) {
  const { C, isDark } = useTheme()
  const reduce = useReduceMotion()
  const total = data.balance_total ?? data.balances.reduce((s, b) => s + avail(b), 0)
  const has = data.balances.length > 0
  const shown = useCountUp(total, has, reduce)
  const ink = isDark ? DARK_INK : C.ink
  const sub = isDark ? DARK_SUB : C.muted
  return (
    <View style={{ borderRadius: R.card, overflow: 'hidden', borderWidth: 1, borderColor: isDark ? DARK_EDGE : C.hair, marginBottom: S.md, ...elevation(C, 1) }}>
      <LinearGradient colors={isDark ? DARK_HERO : [C.surface, C.brandTint]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={{ padding: S.lg + 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
          <View>
            <Txt size={F.tiny} w={500} color={sub}>Leave balance · {data.fyLabel}</Txt>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
              <Txt size={40} w={700} color={ink} style={{ lineHeight: 46 }}>{has ? shown : '-'}</Txt>
              <Txt size={F.small} w={500} color={sub}>{has ? 'days available' : 'nothing loaded yet'}</Txt>
            </View>
          </View>
          <Pressable onPress={onApply} accessibilityRole="button"
            style={({ pressed }) => ({
              minHeight: 44, paddingHorizontal: 16, borderRadius: R.pill, borderWidth: 1, justifyContent: 'center',
              borderColor: isDark ? DARK_EDGE : C.brandEdge,
              backgroundColor: pressed ? (isDark ? 'rgba(255,255,255,0.22)' : C.brandTint) : (isDark ? DARK_FILL : C.surface),
            })}>
            <Txt size={F.small} w={600} color={isDark ? DARK_INK : C.brandDeep}>Apply for leave</Txt>
          </Pressable>
        </View>

        {!has ? (
          <View style={{ marginTop: S.lg, padding: S.md, borderRadius: R.md, borderWidth: 1, borderColor: isDark ? DARK_EDGE : C.hair, backgroundColor: isDark ? DARK_FILL : C.surface }}>
            <Txt size={F.small} color={sub}>
              <Txt size={F.small} w={700} color={ink}>No paid leave entitlement is set up for you in {data.fyLabel}.</Txt> HR sets it in Leave
              configuration. You can still apply for leave that needs no balance, such as Leave Without Pay.
            </Txt>
          </View>
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: S.lg }}>
            {data.balances.map((b, i) => <Tile key={b.leave_type_id || b.id || i} b={b} i={i} reduce={reduce} />)}
          </View>
        )}
      </LinearGradient>
    </View>
  )
}
