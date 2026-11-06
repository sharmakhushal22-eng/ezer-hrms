// src/features/funzone/classics.tsx — the four original games in their solo /
// same-screen form (components/ess/FunZone.tsx: TicTacToe, MemoryMatch, Trivia,
// SpinWheel). Same state, same timings, same copy; nothing touches the network.
import * as React from 'react'
import { Animated, Easing, View, useWindowDimensions } from 'react-native'
import Svg, { G, Path, Text as SvgText } from 'react-native-svg'
import { QUIZ, MEM_FACES } from '@web/funzone/games'
import { Txt } from '@/ui/primitives'
import { DISPLAY, Hint, Key, Progress, Result, Stage, Stat, Status, useFz, useReduceMotion, VsBar } from './kit'
import { MemGrid, QuizOption, QuizQuestion, TttBoard } from './boards'

// ── Tic-Tac-Toe ─────────────────────────────────────────────────
const WIN_LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]]

export function TicTacToe({ onBack }: { onBack: () => void }) {
  const [board, setBoard] = React.useState<string[]>(Array(9).fill(''))
  const [turn, setTurn] = React.useState<'X' | 'O'>('X')
  const [tally, setTally] = React.useState({ X: 0, O: 0 })

  const line = WIN_LINES.find(([a, b, c]) => board[a] && board[a] === board[b] && board[a] === board[c])
  const win = line ? board[line[0]] : null
  const draw = !win && board.every(Boolean)
  const over = !!win || draw

  const move = (i: number) => {
    if (board[i] || over) return
    const next = [...board]; next[i] = turn
    const l = WIN_LINES.find(([a, b, c]) => next[a] && next[a] === next[b] && next[a] === next[c])
    if (l) setTally(t => ({ ...t, [turn]: t[turn] + 1 }))
    setBoard(next); setTurn(t => (t === 'X' ? 'O' : 'X'))
  }
  const reset = () => { setBoard(Array(9).fill('')); setTurn('X') }
  const status = win ? `🎉 Player ${win} wins!` : draw ? "It's a draw!" : `Player ${turn}'s turn`

  return (
    <Stage cat="arcade" icon="⭕" title="Tic-Tac-Toe" sub="Two players, take turns tapping a square"
      onBack={onBack} confetti={win ? tally.X + tally.O : 0}>
      <VsBar left={{ who: 'Player X', pts: tally.X }} right={{ who: 'Player O', pts: tally.O }}
        turn={over ? null : turn === 'X' ? 'left' : 'right'} mid="wins" />
      <Status text={status} tone={win ? 'win' : draw ? 'draw' : undefined} />
      <TttBoard board={board} line={line ?? []} disabled={i => !!board[i] || over} onTap={move} />
      <Key title="New Game" onPress={reset} />
    </Stage>
  )
}

// ── Memory Match ────────────────────────────────────────────────
function shuffleDeck(): string[] {
  const d = [...MEM_FACES, ...MEM_FACES]
  for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [d[i], d[j]] = [d[j], d[i]] }
  return d
}

export function MemoryMatch({ onBack }: { onBack: () => void }) {
  // Dealt once up front (the web deals in an effect only to avoid an SSR mismatch).
  const [cards, setCards] = React.useState<string[]>(shuffleDeck)
  const [flipped, setFlipped] = React.useState<number[]>([])
  const [matched, setMatched] = React.useState<number[]>([])
  const [lock, setLock] = React.useState(false)
  const [turns, setTurns] = React.useState(0)
  const [deal, setDeal] = React.useState(1)
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const reset = React.useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    setCards(shuffleDeck()); setFlipped([]); setMatched([]); setLock(false); setTurns(0); setDeal(d => d + 1)
  }, [])
  React.useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const flip = (i: number) => {
    if (lock || flipped.includes(i) || matched.includes(i)) return
    const next = [...flipped, i]
    setFlipped(next)
    if (next.length < 2) return
    setTurns(t => t + 1)
    const [a, b] = next
    if (cards[a] === cards[b]) { setMatched(m => [...m, a, b]); setFlipped([]); return }
    setLock(true)
    timer.current = setTimeout(() => { setFlipped([]); setLock(false) }, 800)
  }

  const pairs = matched.length / 2
  const done = pairs === MEM_FACES.length
  return (
    <Stage cat="memory" icon="🧩" title="Memory Match"
      sub={done ? 'You found them all!' : `Find all 8 pairs · ${pairs} found`}
      aside={<><Stat label="pairs" value={`${pairs}/8`} hot bump /><Stat label="turns" value={turns} /></>}
      onBack={onBack} confetti={done ? deal : 0}>
      <Progress value={pairs / 8} />
      {done && <Status text={`Cleared in ${turns} turns`} tone="win" />}
      <MemGrid key={deal} faces={cards} isOpen={i => flipped.includes(i)} isDone={i => matched.includes(i)} onFlip={flip} />
      <Key title="New Game" onPress={reset} />
    </Stage>
  )
}

// ── EZER Trivia ─────────────────────────────────────────────────
export function Trivia({ onBack }: { onBack: () => void }) {
  const [idx, setIdx] = React.useState(0)
  const [score, setScore] = React.useState(0)
  const [picked, setPicked] = React.useState<number | null>(null)
  const [round, setRound] = React.useState(1)
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  React.useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const restart = () => { if (timer.current) clearTimeout(timer.current); setIdx(0); setScore(0); setPicked(null); setRound(r => r + 1) }
  const answer = (i: number) => {
    if (picked !== null) return
    setPicked(i)
    if (i === QUIZ[idx].correct) setScore(s => s + 1)
    timer.current = setTimeout(() => { setIdx(n => n + 1); setPicked(null) }, 900)
  }

  const done = idx >= QUIZ.length
  const item = done ? null : QUIZ[idx]
  const perfect = done && score === QUIZ.length
  return (
    <Stage cat="quiz" icon="💡" title="EZER Trivia" sub="Four questions on how things work here"
      aside={<Stat label="correct" value={score} hot bump />}
      onBack={onBack} confetti={perfect ? round : 0}>
      <Progress value={Math.min(idx, QUIZ.length) / QUIZ.length} />
      <Hint>Score: {score} / {QUIZ.length}</Hint>
      {done ? (
        <>
          <Result big={`${score}/${QUIZ.length}`} what={`Quiz done! You scored ${score}/${QUIZ.length}`}
            sub={perfect ? 'Every one right.' : 'Play again. The questions stay the same.'} />
          <Key title="Play Again" onPress={restart} />
        </>
      ) : (
        <View key={idx} style={{ width: '100%', maxWidth: 560, gap: 12 }}>
          <QuizQuestion small={`Question ${idx + 1} of ${QUIZ.length}`} text={`Q${idx + 1}. ${item!.q}`} />
          {item!.opts.map((o, i) => {
            const reveal = picked !== null
            const state = reveal && i === item!.correct ? 'right' : reveal && i === picked ? 'wrong' : null
            return <QuizOption key={i} i={i} text={o} state={state} locked={reveal} onPress={() => answer(i)} />
          })}
        </View>
      )}
    </Stage>
  )
}

// ── Spin the Wheel ──────────────────────────────────────────────
const PRIZES = ['Free Coffee ☕', 'Shoutout 📣', 'Extra Break ⏰', 'High-Five 🙌', 'WFH Day 🏠', 'Snack Treat 🍪']
const SEG = 360 / PRIZES.length
/** components/ess/FunZone.tsx SEG_COLOURS. */
const SEG_COLOURS = ['#7C3AED', '#DB2777', '#0F766E', '#C2410C', '#1D4ED8', '#B45309']
/** funzone.css wheel rim bulbs and pointer. */
const BULB_ON = '#FDE68A', BULB_OFF = '#7C6FD1', PIN = '#FBBF24'

/** One wedge, from `a0` to `a1` degrees clockwise from 12 o'clock. */
function wedge(r: number, a0: number, a1: number) {
  const p = (a: number) => { const t = (a - 90) * Math.PI / 180; return `${r + r * Math.cos(t)},${r + r * Math.sin(t)}` }
  return `M${r},${r} L${p(a0)} A${r},${r} 0 0 1 ${p(a1)} Z`
}

function Bulbs({ size, fast }: { size: number; fast: boolean }) {
  const [tick, setTick] = React.useState(0)
  const calm = useReduceMotion()
  React.useEffect(() => {
    if (calm) return
    const t = setInterval(() => setTick(x => x + 1), fast ? 150 : 600)
    return () => clearInterval(t)
  }, [fast, calm])
  const R = size / 2 + 7
  return (
    <>
      {Array.from({ length: 18 }, (_, k) => {
        const a = (k * 20 - 90) * Math.PI / 180
        const on = (tick + (k % 2)) % 2 === 0
        return <View key={k} style={{ position: 'absolute', width: 8, height: 8, borderRadius: 4, left: size / 2 + 14 + R * Math.cos(a) - 4, top: size / 2 + 14 + R * Math.sin(a) - 4, backgroundColor: on ? BULB_ON : BULB_OFF }} />
      })}
    </>
  )
}

export function SpinWheel({ onBack }: { onBack: () => void }) {
  const fz = useFz()
  const { width } = useWindowDimensions()
  const size = width <= 560 ? 260 : 300
  const [deg, setDeg] = React.useState(0)
  const [spinning, setSpinning] = React.useState(false)
  const [result, setResult] = React.useState('')
  const [spins, setSpins] = React.useState(0)
  const rot = React.useState(() => new Animated.Value(0))[0]
  const pin = React.useState(() => new Animated.Value(0))[0]
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  React.useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  React.useEffect(() => {
    if (!spinning) { pin.setValue(0); return }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pin, { toValue: 1, duration: 60, useNativeDriver: true }),
      Animated.timing(pin, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]))
    loop.start()
    return () => loop.stop()
  }, [spinning, pin])

  const spin = () => {
    if (spinning) return
    setSpinning(true); setResult('')
    // Rotation accumulates, so a second spin never animates backwards. The prize is
    // read off where it stops — nothing is picked in advance.
    const next = deg + (5 + Math.random() * 3) * 360 + Math.random() * 360
    setDeg(next)
    Animated.timing(rot, { toValue: next, duration: 4000, easing: Easing.bezier(0.17, 0.67, 0.12, 0.99), useNativeDriver: true }).start()
    timer.current = setTimeout(() => {
      const resting = (360 - (next % 360)) % 360
      setResult(PRIZES[Math.floor(resting / SEG)])
      setSpinning(false); setSpins(s => s + 1)
    }, 4100)
  }

  const r = size / 2
  return (
    <Stage cat="social" icon="🎡" title="Spin the Wheel" sub="Tap spin for today's surprise"
      onBack={onBack} confetti={result ? spins : 0}>
      <View style={{ width: size + 28, height: size + 28, marginTop: 18, marginBottom: 8 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={{ position: 'absolute', left: 0, top: 0, width: size + 28, height: size + 28, borderRadius: (size + 28) / 2, backgroundColor: fz.stage, borderBottomWidth: 6, borderBottomColor: fz.keycap }} />
        <Bulbs size={size} fast={spinning} />
        <Animated.View style={{ position: 'absolute', left: 14, top: 14, width: size, height: size, transform: [{ rotate: rot.interpolate({ inputRange: [0, 360], outputRange: ['0deg', '360deg'] }) }] }}>
          <Svg width={size} height={size}>
            {PRIZES.map((p, i) => <Path key={p} d={wedge(r, i * SEG, (i + 1) * SEG)} fill={SEG_COLOURS[i]} />)}
            {PRIZES.map((p, i) => (
              // The label sits along the segment's centre line, pointing outwards.
              <G key={`t${p}`} rotation={i * SEG + SEG / 2 - 90} origin={`${r}, ${r}`}>
                <SvgText x={r + (size <= 260 ? 94 : 112)} y={r + 4.5} fill="#FFFFFF" fontSize={12.5} fontWeight="800" textAnchor="end">{p.split(' ')[0]}</SvgText>
              </G>
            ))}
          </Svg>
          <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width: size, height: size, borderRadius: r, borderWidth: 4, borderColor: 'rgba(255,255,255,0.35)' }} />
        </Animated.View>
        <View style={{ position: 'absolute', left: r + 14 - 32, top: r + 14 - 32, width: 64, height: 64, borderRadius: 32, backgroundColor: fz.C.surface, borderWidth: 5, borderColor: fz.stage, alignItems: 'center', justifyContent: 'center', zIndex: 2 }}>
          <Txt size={26} style={{ lineHeight: 32 }}>{result ? result.split(' ').pop() : '🎁'}</Txt>
        </View>
        <Animated.View style={{ position: 'absolute', left: r + 14 - 16, top: -12, zIndex: 3, transform: [{ rotate: pin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-14deg'] }) }] }}>
          <Svg width={32} height={40}><Path d="M0 0 L32 0 L16 40 Z" fill={PIN} /></Svg>
        </Animated.View>
      </View>
      <Key size="lg" title={spinning ? 'Spinning…' : 'Spin!'} onPress={spin} disabled={spinning} />
      <View accessibilityLiveRegion="polite">
        {!!result && (
          <View style={{ alignItems: 'center', gap: 4, paddingVertical: 14, paddingHorizontal: 24, borderRadius: 16, backgroundColor: fz.stage }}>
            <Txt size={12} color={fz.onStage2}>You got:</Txt>
            <Txt size={26} w={800} color={fz.onStage} style={{ fontFamily: DISPLAY, lineHeight: 32 }}>{result}</Txt>
          </View>
        )}
      </View>
    </Stage>
  )
}
