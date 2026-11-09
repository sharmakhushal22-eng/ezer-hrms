// src/features/funzone/boards.tsx — the three boards the Classics share across
// solo, against-the-computer modes (design/funzone.css .ttt, .mem/.mcard, .quiz).
// Presentation only; the games decide what is shown and what a tap does.
import * as React from 'react'
import { Animated, Easing, Pressable, View, useWindowDimensions } from 'react-native'
import { Txt } from '@/ui/primitives'
import { DISPLAY, useAccent, useFz, useReduceMotion, useShake } from './kit'

// ── tic-tac-toe ─────────────────────────────────────────────────────────────
// X is the brand violet, O pink (funzone.css .ttt-sq .m.x / .m.o, dark variants).
const MARK = { X: { l: '#7C3AED', d: '#A78BFA' }, O: { l: '#DB2777', d: '#F472B6' } }

function TttMark({ v, win }: { v: string; win: boolean }) {
  const fz = useFz()
  const s = React.useState(() => new Animated.Value(0.2))[0]
  React.useEffect(() => { Animated.spring(s, { toValue: 1, friction: 5, tension: 160, useNativeDriver: true }).start() }, [s])
  const col = win ? fz.C.positive : v === 'X' ? (fz.isDark ? MARK.X.d : MARK.X.l) : (fz.isDark ? MARK.O.d : MARK.O.l)
  return (
    <Animated.View style={{ transform: [{ scale: s }, { rotate: s.interpolate({ inputRange: [0.2, 1], outputRange: ['-25deg', '0deg'] }) }] }}>
      <Txt size={46} w={800} color={col} style={{ fontFamily: DISPLAY, lineHeight: 54 }}>{v}</Txt>
    </Animated.View>
  )
}

/** A 3×3 board. `disabled(i)` decides which squares take a tap. */
export function TttBoard({ board, line, disabled, onTap }: {
  board: (string | null | undefined)[]; line: number[]; disabled: (i: number) => boolean; onTap: (i: number) => void
}) {
  const fz = useFz()
  const ac = useAccent()
  const { width } = useWindowDimensions()
  const cell = width <= 560 ? 84 : 92
  return (
    <View style={{ width: cell * 3 + 20, flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
      {board.map((v, i) => {
        const win = line.includes(i)
        const off = disabled(i)
        return (
          <Pressable key={i} onPress={() => onTap(i)} disabled={off}
            accessibilityRole="button" accessibilityLabel={v ? `Square ${i + 1}, ${v}` : `Square ${i + 1}, empty`} accessibilityState={{ disabled: off }}
            style={({ pressed }) => ({
              width: cell, height: cell, borderRadius: 18, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center',
              borderColor: win ? fz.C.positive : fz.edge, backgroundColor: win ? fz.C.positiveTint : pressed && !off ? ac.tint : fz.C.sunken,
              borderBottomWidth: 4, borderBottomColor: win ? fz.C.positive : fz.keycap, transform: [{ scale: pressed && !off ? 0.95 : 1 }],
            })}>
            {!!v && <TttMark v={v} win={win} />}
          </Pressable>
        )
      })}
    </View>
  )
}

// ── memory match ────────────────────────────────────────────────────────────
/** A card that turns over (rotateY .42s). `open` = face up, `done` = matched. */
export function MemCard({ i, face, open, done, onPress, size }: {
  i: number; face: string; open: boolean; done: boolean; onPress: () => void; size: number
}) {
  const fz = useFz()
  const ac = useAccent()
  const calm = useReduceMotion()
  const up = open || done
  const r = React.useState(() => new Animated.Value(up ? 1 : 0))[0]
  React.useEffect(() => {
    Animated.timing(r, { toValue: up ? 1 : 0, duration: calm ? 0 : 420, easing: Easing.bezier(0.2, 0.9, 0.25, 1.15), useNativeDriver: true }).start()
  }, [up, r, calm])
  const back = r.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] })
  const front = r.interpolate({ inputRange: [0, 1], outputRange: ['180deg', '360deg'] })
  const side = { position: 'absolute' as const, left: 0, top: 0, width: size, height: size, borderRadius: 16, alignItems: 'center' as const, justifyContent: 'center' as const, backfaceVisibility: 'hidden' as const }
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={up ? `Card ${i + 1}, ${face}` : `Card ${i + 1}, face down`}
      style={{ width: size, height: size }}>
      <Animated.View style={[side, { backgroundColor: ac.solid, borderBottomWidth: 4, borderBottomColor: 'rgba(0,0,0,0.2)', transform: [{ perspective: 900 }, { rotateY: back }] }]}>
        <View style={{ width: size * 0.42, height: size * 0.42, borderRadius: 8, borderWidth: 2, borderColor: 'rgba(255,255,255,0.22)', transform: [{ rotate: '45deg' }] }} />
      </Animated.View>
      <Animated.View style={[side, {
        backgroundColor: done ? fz.C.positiveTint : fz.C.surface, borderWidth: 1.5, borderColor: done ? fz.C.positive : fz.edge,
        borderBottomWidth: 4, borderBottomColor: done ? fz.C.positive : fz.keycap, transform: [{ perspective: 900 }, { rotateY: front }],
      }]}>
        <Txt size={Math.round(size * 0.44)} style={{ lineHeight: Math.round(size * 0.56) }}>{up ? face : ''}</Txt>
      </Animated.View>
    </Pressable>
  )
}

/** The 4×4 deal. Pass the faces, which are open/matched, and the tap. */
export function MemGrid({ faces, isOpen, isDone, onFlip }: {
  faces: string[]; isOpen: (i: number) => boolean; isDone: (i: number) => boolean; onFlip: (i: number) => void
}) {
  const { width } = useWindowDimensions()
  const card = Math.min(width <= 560 ? 66 : 78, Math.floor((width - 32 - 28 - 30) / 4))
  return (
    <View style={{ width: card * 4 + 30, flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
      {faces.map((f, i) => <MemCard key={i} i={i} face={f} open={isOpen(i)} done={isDone(i)} onPress={() => onFlip(i)} size={card} />)}
    </View>
  )
}

// ── trivia ──────────────────────────────────────────────────────────────────
export const KEYS = ['A', 'B', 'C', 'D', 'E']

/** One answer button (`.quiz-opt`): letter badge, then right/wrong/mine states. */
export function QuizOption({ i, text, state, locked, onPress, tag }: {
  i: number; text: string; state?: 'right' | 'wrong' | 'mine' | null; locked: boolean; onPress: () => void
  /** A small pill on the right, e.g. "computer". */
  tag?: string
}) {
  const fz = useFz()
  const ac = useAccent()
  const shake = useShake(state === 'wrong')
  const edge = state === 'right' ? fz.C.positive : state === 'wrong' ? fz.C.critical : state === 'mine' ? ac.a : fz.edge
  const bg = state === 'right' ? fz.C.positiveTint : state === 'wrong' ? fz.C.criticalTint : state === 'mine' ? ac.tint : fz.C.surface
  const ink = state === 'right' ? fz.C.positive : state === 'wrong' ? fz.C.critical : fz.C.ink
  const badgeBg = state === 'right' ? fz.C.positive : state === 'wrong' ? fz.C.critical : ac.tint
  const badgeInk = state === 'right' || state === 'wrong' ? '#FFFFFF' : ac.ink
  const badge = state === 'right' ? '✓' : state === 'wrong' ? '✕' : KEYS[i]
  return (
    <Animated.View style={shake}>
      <Pressable onPress={locked ? undefined : onPress} accessibilityRole="button" accessibilityState={{ disabled: locked }}
        style={({ pressed }) => ({
          flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingVertical: 12, paddingLeft: 12, paddingRight: 14,
          borderRadius: 14, borderWidth: 1.5, borderColor: pressed && !locked ? ac.a : edge, backgroundColor: bg,
          borderBottomWidth: 4, borderBottomColor: state ? edge : fz.keycap,
        })}>
        <View style={{ width: 28, height: 28, borderRadius: 9, backgroundColor: badgeBg, alignItems: 'center', justifyContent: 'center' }}>
          <Txt size={12} w={800} color={badgeInk}>{badge}</Txt>
        </View>
        <Txt size={14.5} w={600} color={ink} style={{ flex: 1 }}>{text}</Txt>
        {!!tag && (
          <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 99, backgroundColor: fz.stage }}>
            <Txt size={11} w={700} color={fz.onStage}>{tag}</Txt>
          </View>
        )}
      </Pressable>
    </Animated.View>
  )
}

/** The question line (`.quiz-q`): a small "Question n of 4" over the text. */
export function QuizQuestion({ small, text }: { small: string; text: string }) {
  const ac = useAccent()
  return (
    <View style={{ marginBottom: 4 }}>
      <Txt size={12} w={700} color={ac.ink} style={{ marginBottom: 6 }}>{small}</Txt>
      <Txt size={20} w={800} style={{ fontFamily: DISPLAY, lineHeight: 26, letterSpacing: -0.3 }}>{text}</Txt>
    </View>
  )
}
