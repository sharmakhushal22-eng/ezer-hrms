// src/features/funzone/mind/reflexes.tsx — Echo (cat memory) and Quick Draw (cat reflex).
//
// Port of Echo / QuickDraw in components/funzone/MindGames.tsx and the .echo /
// .reflex / .splits rules of design/funzone.css. Timings are the web's.
//
// Quick Draw fires on onPressIn (the web's pointerdown) and times with
// perfNow(). Its "Keyboard: focus the panel and press Space." hint is
// web-only and is dropped here.
import * as React from 'react'
import { Animated, Pressable, View } from 'react-native'
import {
  echoExtend, echoCheck, echoStepMs,
  reflexWait, reflexVerdict, average, REFLEX_ROUNDS,
} from '@web/funzone/mindgames'
import { Txt } from '@/ui/primitives'
import { DISPLAY, Key, Stat, Status, useAccent, useFz, useReduceMotion, useShake, useTimers } from '../kit'
import { Frame, perfNow, rand, useFit, type Props } from './frame'

// ═════════════════════════════════════════════════════════════════════════
// ECHO
// ═════════════════════════════════════════════════════════════════════════

const PAD_NAMES = ['Violet', 'Teal', 'Amber', 'Pink']
/** design/funzone.css `.echo-pad:nth-child(n)` fills. */
const PAD_COLOURS = ['#8B5CF6', '#14B8A6', '#F59E0B', '#EC4899']

function EchoPad({ i, size, lit, disabled, onPress }: { i: number; size: number; lit: boolean; disabled: boolean; onPress: () => void }) {
  const calm = useReduceMotion()
  const v = React.useState(() => new Animated.Value(0))[0]
  React.useEffect(() => {
    Animated.timing(v, { toValue: lit ? 1 : 0, duration: calm ? 0 : 120, useNativeDriver: true }).start()
  }, [v, lit, calm])
  // The outer corner is "100%" and the rest 14px; CSS scales them down to fit
  // the side, which is what f does here.
  const f = size / (size + 14)
  const big = size * f, small = 14 * f
  const r = [
    { borderTopLeftRadius: big, borderTopRightRadius: small, borderBottomLeftRadius: small, borderBottomRightRadius: small },
    { borderTopLeftRadius: small, borderTopRightRadius: big, borderBottomLeftRadius: small, borderBottomRightRadius: small },
    { borderTopLeftRadius: small, borderTopRightRadius: small, borderBottomLeftRadius: big, borderBottomRightRadius: small },
    { borderTopLeftRadius: small, borderTopRightRadius: small, borderBottomLeftRadius: small, borderBottomRightRadius: big },
  ][i]
  const c = PAD_COLOURS[i]
  return (
    <Animated.View style={{
      opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] }),
      transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] }) }],
    }}>
      <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={PAD_NAMES[i]} accessibilityState={{ disabled }}
        style={{ width: size, height: size, ...r, backgroundColor: c, boxShadow: lit ? `inset 0 -6px 0 rgba(0,0,0,0.25), 0 0 18px ${c}` : 'inset 0 -6px 0 rgba(0,0,0,0.25)' }} />
    </Animated.View>
  )
}

export function Echo({ onBack }: Props) {
  const fz = useFz()
  const { mobile } = useFit()
  const [seq, setSeq] = React.useState<number[]>([])
  const [phase, setPhase] = React.useState<'idle' | 'show' | 'input' | 'over'>('idle')
  const [at, setAt] = React.useState(0)
  const [lit, setLit] = React.useState<number | null>(null)
  const [best, setBest] = React.useState(0)
  const [shake, setShake] = React.useState(0)
  const t = useTimers()
  const shakeStyle = useShake(shake)

  const play = React.useCallback((s: number[]) => {
    setPhase('show'); setAt(0)
    const step = echoStepMs(s.length)
    s.forEach((pad, k) => {
      t.after(500 + k * step, () => setLit(pad))
      t.after(500 + k * step + step * 0.6, () => setLit(null))
    })
    t.after(500 + s.length * step, () => setPhase('input'))
  }, [t])

  const start = () => { t.clear(); const s = echoExtend([], rand); setSeq(s); play(s) }

  const tap = (pad: number) => {
    if (phase !== 'input') return
    setLit(pad); t.after(180, () => setLit(null))
    const r = echoCheck(seq, at, pad)
    if (r === 'miss') {
      setPhase('over'); setShake(n => n + 1)
      setBest(b => Math.max(b, seq.length - 1))
      return
    }
    if (r === 'next') { setAt(a => a + 1); return }
    setBest(b => Math.max(b, seq.length))
    setPhase('show')
    const s = echoExtend(seq, rand)
    t.after(650, () => { setSeq(s); play(s) })
  }

  const text = phase === 'idle' ? 'Press start and watch closely.'
    : phase === 'show' ? 'Watch…'
    : phase === 'input' ? `Your turn: step ${at + 1} of ${seq.length}`
    : `Missed. You reached ${seq.length - 1}.`

  // .echo: 2 × 128 (mobile 108) pads, 12 gap, 12 padding, round.
  const pad = mobile ? 108 : 128
  const side = pad * 2 + 12 + 24
  return (
    <Frame code="simon" onBack={onBack}
      aside={<><Stat label="round" value={seq.length} hot bump /><Stat label="best" value={best} /></>}>
      <Status text={text} busy={phase === 'show'} tone={phase === 'over' ? 'lose' : undefined} />
      <Animated.View style={[{ width: side, height: side, borderRadius: side / 2, padding: 12, backgroundColor: fz.stage, flexDirection: 'row', flexWrap: 'wrap', gap: 12 }, shakeStyle]}>
        {PAD_NAMES.map((n, i) => (
          <EchoPad key={n} i={i} size={pad} lit={lit === i} disabled={phase !== 'input'} onPress={() => tap(i)} />
        ))}
        {/* .echo-core — the step counter in the middle; taps pass through. */}
        <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
          style={{ position: 'absolute', left: side / 2 - 46, top: side / 2 - 46, width: 92, height: 92, borderRadius: 46, backgroundColor: fz.stage, borderWidth: 6, borderColor: fz.stage2, alignItems: 'center', justifyContent: 'center' }}>
          <Txt size={30} w={800} color={fz.onStage} center style={{ fontFamily: DISPLAY, lineHeight: 32 }}>{seq.length}</Txt>
          <Txt size={10} w={700} color={fz.onStage2} center style={{ lineHeight: 13 }}>STEPS</Txt>
        </View>
      </Animated.View>
      <Key title={phase === 'idle' ? 'Start' : 'Play again'} onPress={start} disabled={phase === 'show' || phase === 'input'} />
    </Frame>
  )
}

// ═════════════════════════════════════════════════════════════════════════
// QUICK DRAW
// ═════════════════════════════════════════════════════════════════════════

type ReflexPhase = 'ready' | 'wait' | 'go' | 'early' | 'result' | 'done'

/** design/funzone.css `.reflex.wait / .go / .early` (ready = the stage, result/done = --a-solid). */
const REFLEX_WAIT = '#B91C1C'
const REFLEX_GO = '#15803D'
const REFLEX_EARLY = '#92400E'

/** react-native-web 0.21 only fires onPressIn on a Pressable that also has an onPress. */
const NOOP = () => {}

function ReflexPanel({ phase, big, small, onPressIn }: { phase: ReflexPhase; big: string; small: string; onPressIn: () => void }) {
  const fz = useFz()
  const ac = useAccent()
  const calm = useReduceMotion()
  const bump = React.useState(() => new Animated.Value(1))[0]
  React.useEffect(() => {
    // .reflex.go { animation: fz-bump .2s } — 1.35 at 40 %.
    if (phase !== 'go' || calm) return
    bump.setValue(1)
    Animated.sequence([
      Animated.timing(bump, { toValue: 1.35, duration: 80, useNativeDriver: true }),
      Animated.timing(bump, { toValue: 1, duration: 120, useNativeDriver: true }),
    ]).start()
  }, [phase, bump, calm])
  const bg = phase === 'ready' ? fz.stage : phase === 'wait' ? REFLEX_WAIT : phase === 'go' ? REFLEX_GO : phase === 'early' ? REFLEX_EARLY : ac.solid
  return (
    <Animated.View style={{ width: '100%', maxWidth: 520, transform: [{ scale: bump }] }}>
      <Pressable onPressIn={onPressIn} onPress={NOOP} accessibilityRole="button" accessibilityLabel={`${big}. ${small}`}
        style={{ height: 240, borderRadius: 22, alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 16, backgroundColor: bg, boxShadow: 'inset 0 -8px 0 rgba(0,0,0,0.2)' }}>
        <Txt size={38} w={800} color="#fff" center style={{ fontFamily: DISPLAY, lineHeight: 42, letterSpacing: -0.76 }}>{big}</Txt>
        <Txt size={14} color="#fff" center style={{ opacity: 0.9 }}>{small}</Txt>
      </Pressable>
    </Animated.View>
  )
}

function Splits({ times }: { times: number[] }) {
  const fz = useFz()
  const ac = useAccent()
  const fastest = Math.min(...times)
  return (
    <View accessibilityLabel="Your times" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>
      {times.map((ms, i) => {
        const best = ms === fastest
        return (
          <View key={i} style={{ paddingVertical: 4, paddingHorizontal: 10, borderRadius: 99, backgroundColor: best ? ac.tint : fz.C.sunken }}>
            <Txt size={12} w={700} color={best ? ac.ink : fz.C.ink}>{ms} ms</Txt>
          </View>
        )
      })}
    </View>
  )
}

export function QuickDraw({ onBack }: Props) {
  const [phase, setPhase] = React.useState<ReflexPhase>('ready')
  const [times, setTimes] = React.useState<number[]>([])
  const [last, setLast] = React.useState(0)
  const [best, setBest] = React.useState<number | null>(null)
  const goAt = React.useRef(0)
  const t = useTimers()

  const arm = () => {
    setPhase('wait')
    t.after(reflexWait(rand), () => { goAt.current = perfNow(); setPhase('go') })
  }

  const press = () => {
    if (phase === 'ready' || phase === 'early' || phase === 'result') { arm(); return }
    if (phase === 'done') { setTimes([]); arm(); return }
    if (phase === 'wait') { t.clear(); setPhase('early'); return }
    if (phase === 'go') {
      const ms = Math.round(perfNow() - goAt.current)
      const all = [...times, ms]
      setTimes(all); setLast(ms)
      setBest(b => (b === null ? ms : Math.min(b, ms)))
      setPhase(all.length >= REFLEX_ROUNDS ? 'done' : 'result')
    }
  }

  const avg = average(times)
  const face: Record<ReflexPhase, [string, string]> = {
    ready:  ['Tap to start', `${REFLEX_ROUNDS} rounds. Wait for green.`],
    wait:   ['Wait…', 'Not yet'],
    go:     ['TAP!', 'Now'],
    early:  ['Too soon', 'That was a false start. Tap to try again'],
    result: [`${last} ms`, `${reflexVerdict(last)} · tap for round ${times.length + 1}`],
    done:   [`${avg} ms`, `Average of ${REFLEX_ROUNDS} · ${reflexVerdict(avg)} · tap to go again`],
  }

  return (
    <Frame code="reflex" onBack={onBack} confetti={phase === 'done' && avg < 300 ? times.length + avg : 0}
      aside={<><Stat label="round" value={`${Math.min(times.length + (phase === 'done' ? 0 : 1), REFLEX_ROUNDS)}/${REFLEX_ROUNDS}`} />
        <Stat label="best ms" value={best ?? '-'} hot /></>}>
      <ReflexPanel phase={phase} big={face[phase][0]} small={face[phase][1]} onPressIn={press} />
      <Splits times={times} />
    </Frame>
  )
}
