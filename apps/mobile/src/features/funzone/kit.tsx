// src/features/funzone/kit.tsx — the pieces every Fun Zone screen is built from.
//
// Phone port of components/funzone/ui.tsx + the visual system of
// design/funzone.css (spec 08 §5.6, §5.16). Presentation only: nothing here
// knows a rule or a player. Sub-components live at module level (no remounts).
//
// Fun-Zone-only constants (the dark "stage", the category accents, the keycap
// shadow) are copied from design/funzone.css as named constants — the website
// hardcodes them too. Every neutral comes from the app palette (useTheme().C).
import * as React from 'react'
import { AccessibilityInfo, Animated, Easing, Pressable, View, type StyleProp, type ViewStyle } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import { useTheme } from '@/ui/ThemeProvider'
import { FONT } from '@/ui/theme'
import { Txt } from '@/ui/primitives'
import { DIFFICULTY_LABEL, DIFFICULTY_MEANING, type Difficulty } from './lib/ai'

export type Cat = 'arcade' | 'quiz' | 'social' | 'puzzle' | 'memory' | 'reflex' | 'words' | 'brain' | 'logic'

/** design/funzone.css .cat-* — vivid / solid (white text) / ink (on tint) / tint. Dark: ink + tint. */
const CATS: Record<Cat, { a: string; solid: string; ink: string; tint: string; inkD: string; tintD: string }> = {
  arcade: { a: '#8B5CF6', solid: '#6D28D9', ink: '#5B21B6', tint: '#EDE9FE', inkD: '#C4B5FD', tintD: 'rgba(139,92,246,0.16)' },
  quiz:   { a: '#3B82F6', solid: '#1D4ED8', ink: '#1E40AF', tint: '#DBEAFE', inkD: '#93C5FD', tintD: 'rgba(59,130,246,0.16)' },
  social: { a: '#EC4899', solid: '#BE185D', ink: '#9D174D', tint: '#FCE7F3', inkD: '#F9A8D4', tintD: 'rgba(236,72,153,0.16)' },
  puzzle: { a: '#F59E0B', solid: '#B45309', ink: '#92400E', tint: '#FEF3C7', inkD: '#FCD34D', tintD: 'rgba(245,158,11,0.15)' },
  memory: { a: '#14B8A6', solid: '#0F766E', ink: '#115E59', tint: '#CCFBF1', inkD: '#5EEAD4', tintD: 'rgba(20,184,166,0.15)' },
  reflex: { a: '#F97316', solid: '#C2410C', ink: '#9A3412', tint: '#FFEDD5', inkD: '#FDBA74', tintD: 'rgba(249,115,22,0.15)' },
  words:  { a: '#22C55E', solid: '#15803D', ink: '#166534', tint: '#DCFCE7', inkD: '#86EFAC', tintD: 'rgba(34,197,94,0.15)' },
  brain:  { a: '#F43F5E', solid: '#BE123C', ink: '#9F1239', tint: '#FFE4E6', inkD: '#FDA4AF', tintD: 'rgba(244,63,94,0.15)' },
  logic:  { a: '#06B6D4', solid: '#0E7490', ink: '#155E75', tint: '#CFFAFE', inkD: '#67E8F9', tintD: 'rgba(6,182,212,0.15)' },
}

export interface Accent { a: string; solid: string; ink: string; tint: string; keyShadow: string }

/** Mix a #RRGGBB colour toward black: color-mix(in srgb, c p%, #000). */
export function darken(hex: string, keep = 0.55) {
  const n = parseInt(hex.slice(1), 16)
  const ch = (s: number) => Math.round(((n >> s) & 255) * keep).toString(16).padStart(2, '0')
  return `#${ch(16)}${ch(8)}${ch(0)}`
}
/** #RRGGBB → rgba with alpha. */
export function alpha(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

export function accentOf(cat: Cat, isDark: boolean): Accent {
  const c = CATS[cat]
  return { a: c.a, solid: c.solid, ink: isDark ? c.inkD : c.ink, tint: isDark ? c.tintD : c.tint, keyShadow: darken(c.solid) }
}

/** The Fun-Zone-only neutrals (design/funzone.css .fz). */
export function useFz() {
  const { C, isDark } = useTheme()
  return React.useMemo(() => ({
    C, isDark,
    stage: isDark ? '#0B0A18' : '#1E1B4B',
    stage2: isDark ? '#1B1840' : '#2B2566',
    onStage: '#F5F3FF',
    onStage2: '#C4BCF5',
    edge: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(30,27,75,0.14)',
    keycap: isDark ? 'rgba(0,0,0,0.55)' : 'rgba(30,27,75,0.16)',
  }), [C, isDark])
}
export type Fz = ReturnType<typeof useFz>

/** The display face. The web loads "Bricolage Grotesque" 800; the app uses DM Sans 800. */
export const DISPLAY = FONT[800]

// ── category context: everything inside a Stage takes its accent ────────────
const CatCtx = React.createContext<Cat>('arcade')
export function useAccent(): Accent {
  const cat = React.useContext(CatCtx)
  const { isDark } = useTheme()
  return React.useMemo(() => accentOf(cat, isDark), [cat, isDark])
}
export function CatProvider({ cat, children }: { cat: Cat; children: React.ReactNode }) {
  return <CatCtx.Provider value={cat}>{children}</CatCtx.Provider>
}

// ── scroll control: the Fun Zone screen owns one ScrollView ─────────────────
// A swipe board (2048) disables scrolling while a finger is on it.
export const FzScrollCtx = React.createContext<{ setScrollEnabled: (on: boolean) => void }>({ setScrollEnabled: () => {} })
export const useFzScroll = () => React.useContext(FzScrollCtx)

export function useReduceMotion() {
  const [calm, setCalm] = React.useState(false)
  React.useEffect(() => {
    let live = true
    AccessibilityInfo.isReduceMotionEnabled().then(v => { if (live) setCalm(!!v) }).catch(() => {})
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', v => setCalm(!!v))
    return () => { live = false; sub.remove() }
  }, [])
  return calm
}

// ── the arcade key (.fz-key) ────────────────────────────────────────────────
export function Key({ title, onPress, onPressIn, soft, size = 'md', disabled, icon, label, style, bg, fg, shadow, children }: {
  title?: string; onPress?: () => void; onPressIn?: () => void; soft?: boolean; size?: 'sm' | 'md' | 'lg'; disabled?: boolean
  icon?: React.ReactNode; label?: string; style?: StyleProp<ViewStyle>
  /** Override colours (the hero's amber key). */
  bg?: string; fg?: string; shadow?: string; children?: React.ReactNode
}) {
  const ac = useAccent()
  const fz = useFz()
  const kh = size === 'sm' ? 3 : size === 'lg' ? 5 : 4
  const pad = size === 'sm' ? { paddingVertical: 8, paddingHorizontal: 14 } : size === 'lg' ? { paddingVertical: 15, paddingHorizontal: 30 } : { paddingVertical: 12, paddingHorizontal: 22 }
  const radius = size === 'sm' ? 10 : size === 'lg' ? 14 : 12
  const fs = size === 'sm' ? 12.5 : size === 'lg' ? 16 : 14
  const background = bg ?? (soft ? ac.tint : ac.solid)
  // --a-solid is chosen to carry white text at 4.5:1 in both themes (funzone.css).
  const color = fg ?? (soft ? ac.ink : '#FFFFFF')
  const under = shadow ?? (soft ? fz.keycap : ac.keyShadow)
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label ?? title} accessibilityState={{ disabled: !!disabled }}
      disabled={disabled} onPress={onPress} onPressIn={onPressIn} hitSlop={4}
      style={({ pressed }) => [{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: size === 'sm' ? 36 : 44,
        ...pad, borderRadius: radius, backgroundColor: background,
        borderBottomWidth: pressed && !disabled ? 0 : kh, borderBottomColor: under,
        marginTop: pressed && !disabled ? kh : 0, opacity: disabled ? 0.5 : 1,
      }, style]}>
      {icon}
      {children ?? (!!title && <Txt size={fs} w={700} color={color} center>{title}</Txt>)}
    </Pressable>
  )
}

const Chevron = ({ color }: { color: string }) => (
  <Svg width={16} height={16} viewBox="0 0 16 16" fill="none"><Path d="M10 3L5 8l5 5" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" /></Svg>
)

export function BackBtn({ onPress, label = 'Back' }: { onPress: () => void; label?: string }) {
  const fz = useFz()
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={6}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, paddingVertical: 8, paddingLeft: 10, paddingRight: 14, borderRadius: 999, borderWidth: 1.5, borderColor: pressed ? fz.C.ink : fz.edge, backgroundColor: fz.C.surface, alignSelf: 'flex-start' })}>
      <Chevron color={fz.C.ink} />
      <Txt size={13} w={700}>{label}</Txt>
    </Pressable>
  )
}

/** design/funzone.css `.fz-view` entrance: fade + rise 10px, .38s. */
export function ViewIn({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const calm = useReduceMotion()
  const v = React.useState(() => new Animated.Value(0))[0]
  React.useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: calm ? 0 : 380, easing: Easing.bezier(0.16, 1, 0.3, 1), useNativeDriver: true }).start()
  }, [v, calm])
  return <Animated.View style={[{ opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }, style]}>{children}</Animated.View>
}

/**
 * The panel every game sits on (`.fz-stage`): a category-tinted header with the
 * game's identity and live numbers, and a body. `left` stretches the body
 * (Play Together) instead of centring it.
 */
export function Stage({ cat, icon, title, sub, aside, onBack, children, left, confetti }: {
  cat: Cat; icon: string; title: string; sub?: React.ReactNode; aside?: React.ReactNode; onBack?: () => void
  children: React.ReactNode; left?: boolean
  /** Bump this number to fire one burst of confetti. 0 fires nothing. */
  confetti?: number
}) {
  const fz = useFz()
  const ac = accentOf(cat, fz.isDark)
  return (
    <CatProvider cat={cat}>
      <ViewIn>
        <View style={{ borderRadius: 24, backgroundColor: fz.keycap, paddingBottom: 6 }}>
          <View style={{ borderRadius: 24, borderWidth: 1.5, borderColor: fz.edge, backgroundColor: fz.C.surface, overflow: 'hidden' }}>
            <View style={{ backgroundColor: ac.tint, borderBottomWidth: 1.5, borderBottomColor: fz.edge, paddingVertical: 14, paddingHorizontal: 14, gap: 12 }}>
              {onBack && <BackBtn onPress={onBack} />}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={{ width: 52, height: 52, borderRadius: 14, backgroundColor: fz.C.surface, borderWidth: 1.5, borderColor: fz.edge, borderBottomWidth: 4, borderBottomColor: fz.keycap, alignItems: 'center', justifyContent: 'center' }}>
                  <Txt size={28} style={{ lineHeight: 34 }}>{icon}</Txt>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Txt size={20} w={800} style={{ fontFamily: DISPLAY, letterSpacing: -0.4, lineHeight: 24 }}>{title}</Txt>
                  {!!sub && (typeof sub === 'string' ? <Txt size={13} tone="soft" style={{ marginTop: 3, lineHeight: 18 }}>{sub}</Txt> : sub)}
                </View>
              </View>
              {!!aside && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>{aside}</View>}
            </View>
            <View style={{ paddingTop: 22, paddingHorizontal: 14, paddingBottom: 26, gap: 16, alignItems: left ? 'stretch' : 'center' }}>
              {children}
            </View>
            {!!confetti && <Confetti key={confetti} />}
          </View>
        </View>
      </ViewIn>
    </CatProvider>
  )
}

/** A number with a label (`.fz-stat`). `bump` replays a small pop whenever `value` changes. */
export function Stat({ label, value, hot, bump }: { label: string; value: React.ReactNode; hot?: boolean; bump?: boolean }) {
  const fz = useFz()
  const ac = useAccent()
  const scale = React.useState(() => new Animated.Value(1))[0]
  const first = React.useRef(true)
  React.useEffect(() => {
    if (first.current) { first.current = false; return }
    if (!bump) return
    scale.setValue(1)
    Animated.sequence([
      Animated.timing(scale, { toValue: 1.35, duration: 140, useNativeDriver: true }),
      Animated.timing(scale, { toValue: 1, duration: 210, useNativeDriver: true }),
    ]).start()
  }, [value, bump, scale])
  return (
    <View style={{ alignItems: 'center', minWidth: 64, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 12, backgroundColor: fz.C.surface, borderWidth: 1.5, borderColor: fz.edge }}>
      <Animated.View style={{ transform: [{ scale }] }}>
        <Txt size={20} w={800} color={hot ? ac.ink : fz.C.ink} style={{ fontFamily: DISPLAY, lineHeight: 24 }}>{value}</Txt>
      </Animated.View>
      <Txt size={11} w={600} tone="muted">{label}</Txt>
    </View>
  )
}

function PulseDot() {
  const ac = useAccent()
  const v = React.useState(() => new Animated.Value(0))[0]
  React.useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: 500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(v, { toValue: 0, duration: 500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]))
    loop.start()
    return () => loop.stop()
  }, [v])
  return <Animated.View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: ac.a, opacity: v.interpolate({ inputRange: [0, 1], outputRange: [1, 0.5] }), transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 0.55] }) }] }} />
}

/** The one line that says what is happening (`.fz-status`). Re-keyed on text to replay the pop. */
export function Status({ text, tone, busy }: { text: string; tone?: 'win' | 'lose' | 'draw'; busy?: boolean }) {
  return <StatusInner key={text} text={text} tone={tone} busy={busy} />
}
function StatusInner({ text, tone, busy }: { text: string; tone?: 'win' | 'lose' | 'draw'; busy?: boolean }) {
  const fz = useFz()
  const pop = React.useState(() => new Animated.Value(tone ? 0 : 1))[0]
  React.useEffect(() => {
    if (tone) Animated.spring(pop, { toValue: 1, friction: 5, tension: 140, useNativeDriver: true }).start()
  }, [pop, tone])
  const color = tone === 'win' ? fz.C.positive : tone === 'lose' ? fz.C.critical : tone === 'draw' ? fz.C.muted : fz.C.ink
  return (
    <Animated.View accessibilityLiveRegion="polite" accessibilityRole="text"
      style={{ minHeight: 28, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: pop, transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) }] }}>
      {busy && <PulseDot />}
      <Txt size={16} w={700} color={color} center>{text}</Txt>
    </Animated.View>
  )
}

const CONFETTI = ['#8B5CF6', '#F59E0B', '#14B8A6', '#EC4899', '#3B82F6', '#22C55E', '#F97316']

/** A single burst, positions derived from the index (ui.tsx Confetti), 36 pieces. */
export function Confetti() {
  const calm = useReduceMotion()
  const t = React.useState(() => new Animated.Value(0))[0]
  const [w, setW] = React.useState(0)
  React.useEffect(() => {
    if (calm) return
    Animated.timing(t, { toValue: 1, duration: 2700, easing: Easing.linear, useNativeDriver: true }).start()
  }, [t, calm])
  if (calm) return null
  const total = 2.7
  return (
    <View pointerEvents="none" onLayout={e => setW(e.nativeEvent.layout.width)} style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, overflow: 'hidden', zIndex: 5 }}>
      {w > 0 && Array.from({ length: 36 }, (_, i) => {
        const d = 1.3 + ((i * 7) % 10) / 10
        const delay = ((i * 13) % 10) / 25
        const a = delay / total, b = Math.min(1, (delay + d) / total)
        const dx = ((i * 29) % 120) - 60
        const r = ((i * 53) % 720) - 360
        const p = t.interpolate({ inputRange: [0, a, b, 1], outputRange: [0, 0, 1, 1] })
        return (
          <Animated.View key={i} style={{
            position: 'absolute', top: -12, left: (((i * 37) % 100) / 100) * w, width: 8, height: 13, borderRadius: 2, backgroundColor: CONFETTI[i % 7],
            opacity: t.interpolate({ inputRange: [0, a, a + 0.0001, b, 1], outputRange: [0, 0, 1, 0, 0] }),
            transform: [
              { translateX: p.interpolate({ inputRange: [0, 1], outputRange: [0, dx] }) },
              { translateY: p.interpolate({ inputRange: [0, 1], outputRange: [0, 420] }) },
              { rotate: p.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${r}deg`] }) },
            ],
          }} />
        )
      })}
    </View>
  )
}

const LEVELS: Difficulty[] = ['easy', 'medium', 'hard']

/** Easy / Medium / Hard switch plus what the level means (ui.tsx DifficultyBar). */
export function DifficultyBar({ level, onPick }: { level: Difficulty; onPick: (d: Difficulty) => void }) {
  const fz = useFz()
  const ac = useAccent()
  return (
    <View style={{ alignItems: 'center', gap: 6, alignSelf: 'stretch' }}>
      <View accessibilityRole="radiogroup" accessibilityLabel="Difficulty"
        style={{ flexDirection: 'row', padding: 4, borderRadius: 999, backgroundColor: fz.C.sunken, borderWidth: 1.5, borderColor: fz.edge }}>
        {LEVELS.map(d => {
          const on = d === level
          return (
            <Pressable key={d} onPress={() => onPick(d)} accessibilityRole="radio" accessibilityState={{ selected: on }}
              style={{ minWidth: 88, minHeight: 36, paddingHorizontal: 18, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? ac.solid : 'transparent', borderBottomWidth: on ? 2 : 0, borderBottomColor: ac.keyShadow }}>
              <Txt size={13} w={700} color={on ? '#FFFFFF' : fz.C.inkSoft}>{DIFFICULTY_LABEL[d]}</Txt>
            </Pressable>
          )
        })}
      </View>
      <Txt size={12} tone="muted" center style={{ maxWidth: 320, lineHeight: 18 }}>{DIFFICULTY_MEANING[level]}</Txt>
    </View>
  )
}

/** Head-to-head scoreboard (`.fz-vs`). `turn` lights the side whose move it is. */
export function VsBar({ left, right, turn, mid = 'vs' }: {
  left: { who: string; pts: number }; right: { who: string; pts: number }; turn?: 'left' | 'right' | null; mid?: string
}) {
  const fz = useFz()
  const ac = useAccent()
  const side = (s: { who: string; pts: number }, on: boolean, flip: boolean) => (
    <View style={{ flex: 1, flexDirection: flip ? 'row-reverse' : 'row', alignItems: 'center', gap: 8, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 11, backgroundColor: on ? fz.stage2 : 'transparent', borderWidth: 1.5, borderColor: on ? ac.a : 'transparent' }}>
      <Txt size={26} w={800} color={fz.onStage} style={{ fontFamily: DISPLAY, lineHeight: 30 }}>{s.pts}</Txt>
      <Txt size={12} w={600} color={fz.onStage2} numberOfLines={1} style={{ flexShrink: 1, textAlign: flip ? 'right' : 'left' }}>{s.who}</Txt>
    </View>
  )
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, width: '100%', maxWidth: 420, padding: 8, borderRadius: 16, backgroundColor: fz.stage }}>
      {side(left, turn === 'left', false)}
      <Txt size={11} w={700} color={fz.onStage2}>{mid}</Txt>
      {side(right, turn === 'right', true)}
    </View>
  )
}

/** `.fz-progress` — a 10px bar in the category's solid colour. */
export function Progress({ value }: { value: number }) {
  const fz = useFz()
  const ac = useAccent()
  return (
    <View style={{ width: '100%', maxWidth: 360, height: 10, borderRadius: 99, backgroundColor: fz.C.sunken, overflow: 'hidden' }}>
      <View style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, height: '100%', backgroundColor: ac.solid, borderRadius: 99 }} />
    </View>
  )
}

/** `.fz-result` — big number, what happened, a quieter line. */
export function Result({ big, what, sub }: { big: string; what?: string; sub?: string }) {
  const fz = useFz()
  const ac = useAccent()
  return (
    <View style={{ alignItems: 'center', gap: 6, paddingVertical: 20, paddingHorizontal: 26, borderRadius: 18, backgroundColor: ac.tint }}>
      <Txt size={44} w={800} color={ac.ink} center style={{ fontFamily: DISPLAY, lineHeight: 48, letterSpacing: -1.2 }}>{big}</Txt>
      {!!what && <Txt size={15} w={700} center>{what}</Txt>}
      {!!sub && <Txt size={12.5} color={fz.C.inkSoft} center>{sub}</Txt>}
    </View>
  )
}

/** `.fz-hint` — a quiet centred line. */
export function Hint({ children }: { children: React.ReactNode }) {
  return <Txt size={12.5} tone="muted" center style={{ lineHeight: 19, maxWidth: 360 }}>{children}</Txt>
}

/** `.fz-row` — a wrapping centred row. */
export function Row({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center', alignItems: 'center' }, style]}>{children}</View>
}

/** Shake horizontally whenever `trigger` changes to a truthy new value (`.shake`). */
export function useShake(trigger: unknown) {
  const x = React.useState(() => new Animated.Value(0))[0]
  const first = React.useRef(true)
  React.useEffect(() => {
    if (first.current) { first.current = false; return }
    if (!trigger) return
    x.setValue(0)
    Animated.sequence([-7, 7, -7, 7, 0].map(v => Animated.timing(x, { toValue: v, duration: 84, useNativeDriver: true }))).start()
  }, [trigger, x])
  return { transform: [{ translateX: x }] }
}

// ── hooks, copied from components/funzone/ui.tsx ────────────────────────────

/** setTimeout that cleans up after itself when the screen goes away. */
export function useTimers() {
  // One object for the life of the screen, so it is safe in a dependency list.
  const [api] = React.useState(() => {
    let ids: ReturnType<typeof setTimeout>[] = []
    return {
      after(ms: number, fn: () => void) { const id = setTimeout(fn, ms); ids.push(id); return id },
      clear() { ids.forEach(clearTimeout); ids = [] },
    }
  })
  React.useEffect(() => () => api.clear(), [api])
  return api
}

/** A countdown in whole seconds that runs while `running` is true (wall-clock based). */
export function useCountdown(seconds: number, running: boolean, onEnd: () => void) {
  const [left, setLeft] = React.useState(seconds)
  const end = React.useRef(onEnd)
  React.useEffect(() => { end.current = onEnd })
  // Same reset-when-stopped effect as components/funzone/ui.tsx useCountdown.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  React.useEffect(() => { if (!running) setLeft(seconds) }, [running, seconds])
  React.useEffect(() => {
    if (!running) return
    const started = Date.now()
    const t = setInterval(() => {
      const l = Math.max(0, seconds - Math.floor((Date.now() - started) / 1000))
      setLeft(l)
      if (l === 0) { clearInterval(t); end.current() }
    }, 200)
    return () => clearInterval(t)
  }, [running, seconds])
  return left
}
