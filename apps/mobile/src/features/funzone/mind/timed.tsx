// src/features/funzone/mind/timed.tsx — Payroll Scramble (cat words), Math
// Sprint and Colour Clash (cat brain).
//
// Port of Scramble / MathSprint / ColourClash in components/funzone/MindGames.tsx
// and the .tiles-row / .ltile / .fz-input / .sum / .numpad / .clash-word /
// .swatch rules of design/funzone.css. Copy, timings and rules are the web's.
//
// Phone input: Scramble types into a TextInput (characters, no autocorrect,
// maxLength len + 2, refocused on every new word). Sprint keeps the answer
// field for parity but hides the system keyboard — the on-screen numpad is
// the keyboard.
import * as React from 'react'
import { Animated, Pressable, TextInput, View } from 'react-native'
import {
  scrambleDeck, scramble, normaliseWord, SCRAMBLE_SECONDS, type WordItem,
  makeSum, SPRINT_SECONDS, type Sum,
  clashCard, CLASH_COLOURS, CLASH_ROUNDS, average, type ClashCard,
} from '@web/funzone/mindgames'
import { Txt } from '@/ui/primitives'
import { DISPLAY, Hint, Key, Result, Row, Stat, useAccent, useFz, useReduceMotion, useTimers, useCountdown } from '../kit'
import { EASE, Frame, GameInput, Pop, TimeBar, perfNow, rand, type Props } from './frame'

// ═════════════════════════════════════════════════════════════════════════
// PAYROLL SCRAMBLE
// ═════════════════════════════════════════════════════════════════════════

/** `.ltile` — dealt in with a 35 ms stagger (fz-deal .45 s); a used letter sinks and fades. */
function LetterTile({ c, i, used }: { c: string; i: number; used?: boolean }) {
  const fz = useFz()
  const ac = useAccent()
  const calm = useReduceMotion()
  const deal = React.useState(() => new Animated.Value(calm ? 1 : 0))[0]
  const sink = React.useState(() => new Animated.Value(used ? 1 : 0))[0]
  React.useEffect(() => {
    if (calm) { deal.setValue(1); return }
    Animated.timing(deal, { toValue: 1, duration: 450, delay: i * 35, easing: EASE, useNativeDriver: true }).start()
  }, [deal, i, calm])
  React.useEffect(() => {
    Animated.timing(sink, { toValue: used ? 1 : 0, duration: calm ? 0 : 150, useNativeDriver: true }).start()
  }, [sink, used, calm])
  return (
    <Animated.View style={{
      opacity: Animated.multiply(deal, sink.interpolate({ inputRange: [0, 1], outputRange: [1, 0.3] })),
      transform: [
        { translateY: Animated.add(deal.interpolate({ inputRange: [0, 1], outputRange: [26, 0] }), sink.interpolate({ inputRange: [0, 1], outputRange: [0, 3] })) },
        { rotate: deal.interpolate({ inputRange: [0, 1], outputRange: [`${(i - 3) * 1.4}deg`, '0deg'] }) },
        { scale: deal.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) },
      ],
    }}>
      <View style={{
        width: 44, height: 52, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
        backgroundColor: fz.C.surface, borderWidth: 1.5, borderColor: fz.edge,
        boxShadow: `0 ${used ? 1 : 4}px 0 ${ac.a}`,
      }}>
        <Txt size={24} w={800} style={{ fontFamily: DISPLAY, lineHeight: 30 }}>{c}</Txt>
      </View>
    </Animated.View>
  )
}

function LetterRow({ letters, used, label }: { letters: string; used?: boolean[]; label?: string }) {
  return (
    <View accessibilityLabel={label} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>
      {letters.split('').map((c, i) => <LetterTile key={i} c={c} i={i} used={used?.[i]} />)}
    </View>
  )
}

export function Scramble({ onBack }: Props) {
  const [phase, setPhase] = React.useState<'ready' | 'play' | 'done'>('ready')
  const [deck, setDeck] = React.useState<WordItem[]>([])
  const [idx, setIdx] = React.useState(0)
  const [mix, setMix] = React.useState('')
  const [guess, setGuess] = React.useState('')
  const [score, setScore] = React.useState(0)
  const [skipped, setSkipped] = React.useState<string | null>(null)
  const [good, setGood] = React.useState(false)
  const [round, setRound] = React.useState(0)
  const input = React.useRef<TextInput>(null)
  const t = useTimers()
  const left = useCountdown(SCRAMBLE_SECONDS, phase === 'play', () => setPhase('done'))

  const dealWord = (d: WordItem[], i: number) => {
    const w = d[i % d.length]
    setIdx(i); setMix(scramble(w.word, rand)); setGuess('')
    setTimeout(() => input.current?.focus(), 0)
  }
  const start = () => {
    const d = scrambleDeck(rand)
    setDeck(d); setScore(0); setSkipped(null); setPhase('play'); setRound(r => r + 1); dealWord(d, 0)
  }

  const word = deck.length ? deck[idx % deck.length] : null
  const onType = (v: string) => {
    if (!word || good) return
    setGuess(v)
    if (normaliseWord(v) === word.word) {
      setGood(true); setScore(s => s + 1); setSkipped(null)
      t.after(450, () => { setGood(false); dealWord(deck, idx + 1) })
    }
  }
  const skip = () => { if (!word) return; setSkipped(word.word); dealWord(deck, idx + 1) }

  // Letters used so far, crossed off left to right.
  const used = new Array(mix.length).fill(false)
  for (const ch of normaliseWord(guess)) {
    const k = mix.split('').findIndex((c, j) => c === ch && !used[j])
    if (k >= 0) used[k] = true
  }

  return (
    <Frame code="scramble" onBack={onBack} confetti={phase === 'done' && score >= 8 ? round : 0}
      aside={<><Stat label="solved" value={score} hot bump /><Stat label="seconds" value={phase === 'play' ? left : SCRAMBLE_SECONDS} /></>}>
      {phase === 'play' && word ? (
        <>
          <TimeBar left={left} total={SCRAMBLE_SECONDS} />
          <LetterRow key={`${idx}-${mix}`} letters={mix} used={used} label={`Letters ${mix.split('').join(' ')}`} />
          {/* The web upper-cases the box with CSS; the value is shown upper-cased here. */}
          <Hint>Hint: {word.hint} · {word.word.length} letters</Hint>
          <GameInput ref={input} ok={good} value={guess.toUpperCase()} onChangeText={onType} accessibilityLabel="Your answer"
            autoComplete="off" autoCapitalize="characters" autoCorrect={false} spellCheck={false}
            maxLength={word.word.length + 2} />
          <Row>
            <Key title="Skip word" soft size="sm" onPress={skip} />
          </Row>
          {skipped && <Hint>Last one was {skipped}.</Hint>}
        </>
      ) : phase === 'done' ? (
        <>
          <Pop duration={500}><Result big={String(score)} what={`${score === 1 ? 'word' : 'words'} in ${SCRAMBLE_SECONDS} seconds`}
            sub={word ? `The last word was ${word.word}.` : undefined} /></Pop>
          <Key title="Play again" onPress={start} />
        </>
      ) : (
        <>
          <LetterRow letters="PAYROLL" />
          <Hint>You get {SCRAMBLE_SECONDS} seconds. Type each word. It moves on by itself when it is right.</Hint>
          <Key title="Start" size="lg" onPress={start} />
        </>
      )}
    </Frame>
  )
}

// ═════════════════════════════════════════════════════════════════════════
// MATH SPRINT
// ═════════════════════════════════════════════════════════════════════════

/** `.sum` — clamp(44px, 9vw, 64px); a phone is always at the 44 floor. */
function SumText({ text }: { text: string }) {
  return <Txt size={44} w={800} center style={{ fontFamily: DISPLAY, lineHeight: 50, letterSpacing: -1.3 }}>{text}</Txt>
}

const PAD_ROWS = [['7', '8', '9'], ['4', '5', '6'], ['1', '2', '3'], ['', '0', '⌫']]

function NumKey({ d, onKey }: { d: string; onKey: (d: string) => void }) {
  const ac = useAccent()
  if (!d) return <View style={{ width: 62 }} />
  return (
    <Key soft onPress={() => onKey(d)} label={d === '⌫' ? 'Delete' : d}
      style={{ width: 62, paddingVertical: 13, paddingHorizontal: 0 }}>
      <Txt size={18} w={700} color={ac.ink} center>{d}</Txt>
    </Key>
  )
}

/** `.numpad` — 3 × 62, gap 8: 7 8 9 / 4 5 6 / 1 2 3 / _ 0 ⌫. */
function NumPad({ onKey }: { onKey: (d: string) => void }) {
  return (
    <View style={{ gap: 8 }}>
      {PAD_ROWS.map((r, k) => (
        <View key={k} style={{ flexDirection: 'row', gap: 8, height: 52, alignItems: 'flex-start' }}>
          {r.map((d, j) => <NumKey key={j} d={d} onKey={onKey} />)}
        </View>
      ))}
    </View>
  )
}

export function MathSprint({ onBack }: Props) {
  const [phase, setPhase] = React.useState<'ready' | 'play' | 'done'>('ready')
  const [sum, setSum] = React.useState<Sum | null>(null)
  const [solved, setSolved] = React.useState(0)
  const [typed, setTyped] = React.useState('')
  const [best, setBest] = React.useState(0)
  const [round, setRound] = React.useState(0)
  const input = React.useRef<TextInput>(null)
  // The web raises best in an effect on entering 'done'; doing it as time runs
  // out is the same moment with one render fewer.
  const left = useCountdown(SPRINT_SECONDS, phase === 'play', () => { setPhase('done'); setBest(b => Math.max(b, solved)) })

  const start = () => {
    setSolved(0); setTyped(''); setSum(makeSum(0, rand)); setPhase('play'); setRound(r => r + 1)
    setTimeout(() => input.current?.focus(), 0)
  }
  const onType = (v: string) => {
    const clean = v.replace(/\D/g, '').slice(0, 4)
    setTyped(clean)
    if (sum && clean !== '' && Number(clean) === sum.answer) {
      const n = solved + 1
      setSolved(n); setSum(makeSum(n, rand)); setTyped('')
    }
  }
  const key = (d: string) => (d === '⌫' ? onType(typed.slice(0, -1)) : onType(typed + d))

  return (
    <Frame code="sprint" onBack={onBack} confetti={phase === 'done' && solved >= 15 ? round : 0}
      aside={<><Stat label="solved" value={solved} hot bump /><Stat label="best" value={best} /></>}>
      {phase === 'play' && sum ? (
        <>
          <TimeBar left={left} total={SPRINT_SECONDS} />
          <Hint>{left} seconds left</Hint>
          <View accessibilityLiveRegion="polite"><Pop key={sum.text + solved}><SumText text={`${sum.text} = ?`} /></Pop></View>
          <GameInput ref={input} value={typed} onChangeText={onType} accessibilityLabel="Answer" autoComplete="off"
            keyboardType="number-pad" inputMode="numeric" showSoftInputOnFocus={false} />
          <NumPad onKey={key} />
        </>
      ) : phase === 'done' ? (
        <>
          <Pop duration={500}><Result big={String(solved)} what={`solved in ${SPRINT_SECONDS} seconds`}
            sub={solved >= best && solved > 0 ? 'Your best this session.' : `Best this session: ${best}`} /></Pop>
          <Key title="Play again" onPress={start} />
        </>
      ) : (
        <>
          <SumText text="12 + 7 = ?" />
          <Hint>Sums start easy and get harder the more you solve. No minus answers.</Hint>
          <Key title="Start" size="lg" onPress={start} />
        </>
      )}
    </Frame>
  )
}

// ═════════════════════════════════════════════════════════════════════════
// COLOUR CLASH
// ═════════════════════════════════════════════════════════════════════════

/** design/funzone.css `.ink-*`, light and `[data-ez-theme="dark"]`. */
const INK: Record<string, { l: string; d: string }> = {
  red:    { l: '#DC2626', d: '#F87171' },
  blue:   { l: '#2563EB', d: '#60A5FA' },
  green:  { l: '#16A34A', d: '#4ADE80' },
  yellow: { l: '#CA8A04', d: '#FACC15' },
  purple: { l: '#9333EA', d: '#C084FC' },
}
function useInk() {
  const { isDark } = useFz()
  return (key: string) => (isDark ? INK[key].d : INK[key].l)
}

/**
 * `.clash-word` — pops in on every card and shakes when the last pick was
 * wrong. (On the web the later `.clash-word` animation overrides `.shake`, so
 * the shake never actually plays there; the spec and the markup both mean it
 * to, so it plays here.)
 */
function ClashWord({ word, ink, wrong, label }: { word: string; ink: string; wrong?: boolean; label?: string }) {
  const fz = useFz()
  const calm = useReduceMotion()
  const x = React.useState(() => new Animated.Value(0))[0]
  React.useEffect(() => {
    if (!wrong || calm) return
    Animated.sequence([-7, 7, -7, 7, 0].map(v => Animated.timing(x, { toValue: v, duration: 84, useNativeDriver: true }))).start()
  }, [wrong, calm, x])
  return (
    <Pop>
      <Animated.View accessibilityLabel={label} style={{ transform: [{ translateX: x }], paddingVertical: 18, paddingHorizontal: 30, borderRadius: 20, backgroundColor: fz.C.sunken }}>
        <Txt size={56} w={800} color={ink} center style={{ fontFamily: DISPLAY, lineHeight: 62, letterSpacing: -1.7 }}>{word}</Txt>
      </Animated.View>
    </Pop>
  )
}

function Swatch({ name, colour, onPress }: { name: string; colour: string; onPress: () => void }) {
  const fz = useFz()
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={name}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 12,
        backgroundColor: fz.C.surface, borderWidth: 1.5, borderColor: fz.edge,
        boxShadow: pressed ? undefined : `0 3px 0 ${fz.keycap}`, transform: [{ translateY: pressed ? 3 : 0 }],
      })}>
      <View style={{ width: 16, height: 16, borderRadius: 5, backgroundColor: colour }} />
      <Txt size={14} w={700}>{name}</Txt>
    </Pressable>
  )
}

export function ColourClash({ onBack }: Props) {
  const ink = useInk()
  const [phase, setPhase] = React.useState<'ready' | 'play' | 'done'>('ready')
  const [card, setCard] = React.useState<ClashCard | null>(null)
  const [n, setN] = React.useState(0)
  const [right, setRight] = React.useState(0)
  const [streak, setStreak] = React.useState(0)
  const [wrong, setWrong] = React.useState(false)
  const [ms, setMs] = React.useState<number[]>([])
  const shownAt = React.useRef(0)

  const deal = () => { setCard(clashCard(rand)); shownAt.current = perfNow() }
  const start = () => { setN(0); setRight(0); setStreak(0); setMs([]); setWrong(false); setPhase('play'); deal() }

  const pick = (k: number) => {
    if (!card || phase !== 'play') return
    const ok = k === card.ink
    setMs(x => [...x, perfNow() - shownAt.current])
    if (ok) { setRight(r => r + 1); setStreak(s => s + 1) } else { setStreak(0) }
    setWrong(!ok)
    const next = n + 1
    setN(next)
    if (next >= CLASH_ROUNDS) setPhase('done'); else deal()
  }

  return (
    <Frame code="clash" onBack={onBack} confetti={phase === 'done' && right === CLASH_ROUNDS ? ms.length + right : 0}
      aside={<><Stat label="right" value={`${right}/${CLASH_ROUNDS}`} hot bump /><Stat label="streak" value={streak} bump /></>}>
      {phase === 'play' && card ? (
        <>
          <Hint>Card {n + 1} of {CLASH_ROUNDS}: tap the colour of the ink</Hint>
          <ClashWord key={n} word={CLASH_COLOURS[card.word].name.toUpperCase()} ink={ink(CLASH_COLOURS[card.ink].key)}
            wrong={wrong} label={`The word ${CLASH_COLOURS[card.word].name}`} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
            {CLASH_COLOURS.map((c, k) => <Swatch key={c.key} name={c.name} colour={ink(c.key)} onPress={() => pick(k)} />)}
          </View>
        </>
      ) : phase === 'done' ? (
        <>
          <Pop duration={500}><Result big={`${right}/${CLASH_ROUNDS}`} what={`right, averaging ${(average(ms) / 1000).toFixed(2)} s a card`}
            sub={right === CLASH_ROUNDS ? 'Not fooled once.' : 'The word tries to win. The ink is the answer.'} /></Pop>
          <Key title="Play again" onPress={start} />
        </>
      ) : (
        <>
          <ClashWord word="RED" ink={ink('blue')} />
          <Hint>That one is <Txt size={12.5} w={700} tone="muted">Blue</Txt>. {CLASH_ROUNDS} cards. Be quick and be right.</Hint>
          <Key title="Start" size="lg" onPress={start} />
        </>
      )}
    </Frame>
  )
}
