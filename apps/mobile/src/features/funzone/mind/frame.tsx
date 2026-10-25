// src/features/funzone/mind/frame.tsx — what the ten mind games share.
//
// Port of the top of components/funzone/MindGames.tsx (Frame) plus the small
// visual pieces design/funzone.css gives several games (.timebar, .fz-input,
// the fz-pop / fz-mark / fz-deal entrances). Presentation only: every rule
// lives in lib/funzone/mindgames.ts and is imported unchanged.
import * as React from 'react'
import { Animated, Easing, TextInput, View, useWindowDimensions, type TextInputProps } from 'react-native'
import { mindGameByCode, type MindCode } from '@web/funzone/mindgames'
import { webNoOutline } from '@/ui/primitives'
import { DISPLAY, Stage, useAccent, useFz, useReduceMotion } from '../kit'

/** All randomness is Math.random(), injected into the pure rules (MindGames.tsx). */
export const rand = () => Math.random()

export type Props = { onBack: () => void }

/** Clocks, kept at module level like rand(): wall time (timers) and the
 *  monotonic clock the web uses for reaction times (performance.now). */
export const wallClock = () => Date.now()
export const perfNow = () => performance.now()

/** design/funzone.css --fz-ease / --fz-ease-out. */
export const EASE = Easing.bezier(0.2, 0.9, 0.25, 1.15)
export const EASE_OUT = Easing.bezier(0.16, 1, 0.3, 1)

/** The stage, pre-filled from the catalogue so every game reads the same. */
export function Frame({ code, onBack, aside, children, confetti, sub }: {
  code: MindCode; onBack: () => void; aside?: React.ReactNode; children: React.ReactNode
  confetti?: number; sub?: React.ReactNode
}) {
  const g = mindGameByCode(code)!
  return (
    <Stage cat={g.cat} icon={g.icon} title={g.name} sub={sub ?? g.how} onBack={onBack} aside={aside} confetti={confetti}>
      {children}
    </Stage>
  )
}

/**
 * Room for a board inside the stage body. The Fun Zone screen pads 16 each
 * side, the stage border is 1.5 and the body pads 14 — so a board gets the
 * window minus 63. `mobile` is funzone.css's one breakpoint (≤ 560 px).
 */
export function useFit() {
  const { width } = useWindowDimensions()
  return { mobile: width <= 560, room: Math.max(240, width - 63) }
}

/** Plays once on mount from 0 to 1 (an entrance). Reduce motion → already 1. */
export function useEnter(duration: number, easing = EASE, delay = 0) {
  const calm = useReduceMotion()
  const v = React.useState(() => new Animated.Value(0))[0]
  React.useEffect(() => {
    if (calm) { v.stopAnimation(); v.setValue(1); return }
    Animated.timing(v, { toValue: 1, duration, delay, easing, useNativeDriver: true }).start()
  }, [v, calm, duration, delay, easing])
  return v
}

/** `fz-pop` — scale .7 → 1.08 → 1 with a fade in, .3 s. Re-key to replay. */
export function Pop({ children, duration = 300 }: { children: React.ReactNode; duration?: number }) {
  const v = useEnter(duration, EASE)
  return (
    <Animated.View style={{
      opacity: v.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0, 1, 1] }),
      transform: [{ scale: v.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0.7, 1.08, 1] }) }],
    }}>{children}</Animated.View>
  )
}

/** `.timebar` — 8 px, the category colour, critical red at ≤ 10 s, 1 s linear width. */
export function TimeBar({ left, total }: { left: number; total: number }) {
  const fz = useFz()
  const ac = useAccent()
  const calm = useReduceMotion()
  const p = React.useState(() => new Animated.Value(left / total))[0]
  React.useEffect(() => {
    Animated.timing(p, { toValue: left / total, duration: calm ? 0 : 1000, easing: Easing.linear, useNativeDriver: false }).start()
  }, [p, left, total, calm])
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
      style={{ width: '100%', maxWidth: 420, height: 8, borderRadius: 99, backgroundColor: fz.C.sunken, overflow: 'hidden' }}>
      <Animated.View style={{ height: '100%', borderRadius: 99, backgroundColor: left <= 10 ? fz.C.critical : ac.a,
        width: p.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }} />
    </View>
  )
}

/** `.fz-input` — the big centred answer box. `ok` turns it green. */
export const GameInput = React.forwardRef<TextInput, TextInputProps & { ok?: boolean }>(function GameInput({ ok, style, onFocus, onBlur, ...rest }, ref) {
  const fz = useFz()
  const ac = useAccent()
  const [focus, setFocus] = React.useState(false)
  const border = ok ? fz.C.positive : focus ? ac.a : fz.edge
  const bg = ok ? fz.C.positiveTint : focus ? fz.C.surface : fz.C.sunken
  return (
    <TextInput ref={ref} {...rest}
      onFocus={e => { setFocus(true); onFocus?.(e) }}
      onBlur={e => { setFocus(false); onBlur?.(e) }}
      placeholderTextColor={fz.C.faint}
      style={[{
        width: '100%', maxWidth: 360, paddingVertical: 13, paddingHorizontal: 16, borderRadius: 14,
        fontFamily: DISPLAY, fontSize: 24, letterSpacing: 24 * 0.12, textAlign: 'center',
        borderWidth: 2, borderColor: border, backgroundColor: bg, color: fz.C.ink,
      }, webNoOutline, style]} />
  )
})
