// src/features/home/kit.tsx — the small pieces every Home card shares.
//
// The website's Today tab (components/ess/today) styles itself with today.css:
// one `.card` with an `h2` header (a 4px brand accent bar, the title, an
// optional count chip and a "more" link on the right), plus a handful of
// colours the tab defines for itself (gold, the hero's navy). Those live here so
// every card reads the same, and the hooks from components/ess/today/hooks.ts
// (useNow, useCountUp, useMounted, useReducedMotion) are ported for React Native.
import * as React from 'react'
import { AccessibilityInfo, Pressable, View, type StyleProp, type ViewStyle } from 'react-native'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S } from '@/ui/theme'
import { Txt } from '@/ui/primitives'

// ── Colours the Today tab defines itself (components/ess/today/today.css) ──────
/** today.css `--gold` / `--gold-soft`, light and dark blocks. */
export const GOLD = { light: { fg: '#D4A017', bg: '#FBEBB5' }, dark: { fg: '#F2C14E', bg: '#3A2E0F' } }
export const useGold = () => (useTheme().isDark ? GOLD.dark : GOLD.light)
/** today.css `--sun` — the streak flame. */
export const SUN = '#FCD34D'

/** A palette hex with an alpha — the website's color-mix(in srgb, X n%, transparent). */
export function alpha(hex: string, a: number) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) return hex
  return `#${m[1]}${Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0')}`
}

// ── Card ──────────────────────────────────────────────────────────────────────
/** today.css `.card`: surface, hairline, radius 16, padding 16/18, 16 below. */
export function HomeCard({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const { C, isDark } = useTheme()
  return (
    <View style={[{
      backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 16, paddingVertical: 16, paddingHorizontal: 16,
      marginBottom: S.lg, shadowColor: isDark ? '#000000' : '#101828', shadowOpacity: isDark ? 0.4 : 0.08, shadowRadius: 14,
      shadowOffset: { width: 0, height: 6 }, elevation: 2,
    }, style]}>
      {children}
    </View>
  )
}

/** The text-only link button in a card header (today.css `.more`). */
export function MoreLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={12} accessibilityRole="button" style={{ marginLeft: 'auto', minHeight: 32, justifyContent: 'center' }}>
      <Txt size={12.5} w={600} tone="brand">{label}</Txt>
    </Pressable>
  )
}

/** today.css `.card h2` — accent bar, title, optional count, optional link. */
export function CardHead({ title, count, more }: { title: string; count?: number; more?: { label: string; onPress: () => void } }) {
  const { C } = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: S.md, minHeight: 24 }}>
      <View style={{ width: 4, height: 14, borderRadius: 3, backgroundColor: C.brand }} />
      <Txt size={F.lead} w={700}>{title}</Txt>
      {!!count && count > 0 && (
        <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: R.pill, backgroundColor: C.criticalTint }}>
          <Txt size={F.micro} w={700} tone="critical">{count}</Txt>
        </View>
      )}
      {more && <MoreLink label={more.label} onPress={more.onPress} />}
    </View>
  )
}

/** The faint one-liner a card shows when it has nothing (12.5px, --ez-faint). */
export function EmptyLine({ children }: { children: React.ReactNode }) {
  return <Txt size={12.5} tone="faint">{children}</Txt>
}

/** today.css `.wish` — the small outline button (Wish / Welcome), green once sent. */
export function SmallButton({ label, done, onPress, busy }: { label: string; done?: boolean; busy?: boolean; onPress: () => void }) {
  const { C } = useTheme()
  const off = !!done || !!busy
  return (
    <Pressable onPress={off ? undefined : onPress} accessibilityRole="button" accessibilityState={{ disabled: off }} hitSlop={6}
      style={({ pressed }) => ({
        marginLeft: 'auto', minHeight: 36, paddingHorizontal: 14, borderRadius: 9, borderWidth: 1, justifyContent: 'center',
        borderColor: done ? C.positive : pressed ? C.brand : C.lineStrong, backgroundColor: done ? C.positiveTint : C.surface,
        opacity: busy ? 0.6 : 1,
      })}>
      <Txt size={12.5} w={600} color={done ? C.positive : C.ink}>{label}</Txt>
    </Pressable>
  )
}

/** Initials in a tinted circle (today.css `.pav`). */
export function Pav({ initials, bg, fg, size = 40, children, border }: { initials: string; bg: string; fg: string; size?: number; children?: React.ReactNode; border?: string }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center', borderWidth: border ? 2 : 0, borderColor: border }}>
      <Txt size={size >= 40 ? 13 : 12} w={700} color={fg}>{initials}</Txt>
      {children}
    </View>
  )
}

// ── Hooks (components/ess/today/hooks.ts) ─────────────────────────────────────
/** prefers-reduced-motion → the OS "remove animations" setting. */
export function useReducedMotion() {
  const [r, setR] = React.useState(false)
  React.useEffect(() => {
    let live = true
    AccessibilityInfo.isReduceMotionEnabled().then(v => { if (live) setR(v) }).catch(() => {})
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setR)
    return () => { live = false; sub.remove() }
  }, [])
  return r
}

/** Ticks every `ms`; returns the current Date. */
export function useNow(ms = 15000) {
  const [now, setNow] = React.useState(() => new Date())
  React.useEffect(() => { const id = setInterval(() => setNow(new Date()), ms); return () => clearInterval(id) }, [ms])
  return now
}

/** True after `ms` — the website uses it to start CSS transitions after mount. */
export function useMounted(ms = 250) {
  const [ok, setOk] = React.useState(false)
  React.useEffect(() => { const id = setTimeout(() => setOk(true), ms); return () => clearTimeout(id) }, [ms])
  return ok
}

/** Eased (cubic out) tween from the last value to `to`, after `delay` ms. Instant under reduced motion. */
export function useTween(to: number, duration = 1100, delay = 0, from0 = 0) {
  const reduce = useReducedMotion()
  const [v, setV] = React.useState(from0)
  const cur = React.useRef(from0)
  React.useEffect(() => {
    if (reduce) { cur.current = to; setV(to); return }
    const from = cur.current
    let raf = 0
    const start = Date.now() + delay
    const step = () => {
      const p = Math.min(1, Math.max(0, (Date.now() - start) / duration))
      const val = from + (to - from) * (1 - Math.pow(1 - p, 3))
      cur.current = val
      setV(val)
      if (p < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [to, duration, delay, reduce])
  return v
}

/** hooks.ts useCountUp — counts up from 0 to `to` (450 ms in, 1.1 s long). */
export function useCountUp(to: number, decimals = 0, delay = 450, duration = 1100) {
  return useTween(to, duration, delay).toFixed(decimals)
}
