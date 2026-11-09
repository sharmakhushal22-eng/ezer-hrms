// src/features/funzone/vs/VsComputer.tsx — the three Classics against the
// machine. Phone port of components/funzone/VsComputer.tsx (spec 08 §5.8).
//
// Every rule comes from lib/funzone/games.ts (imported unchanged) and every
// decision from lib/funzone/ai.ts (vendored as ../lib/ai), so the bot plays by
// exactly the rules a colleague would. This file is the screen and the timers:
// same state, same effects, same delays (botDelay, 850 ms peek, 1400 ms reveal),
// same copy, same confetti keys as the website.
import * as React from 'react'
import { View } from 'react-native'
import {
  boardFrom, outcome, canApply, memDeck, memReplay, memCanApply, memResult,
  quizFor, MEM_CARDS, type Move, type Mark, type MemTurn,
} from '@web/funzone/games'
import {
  botMove, memBotTurn, remember, botAnswer, botDelay, EMPTY_MIND,
  type Difficulty, type MemMind,
} from '../lib/ai'
import { DifficultyBar, Key, Result, Stage, Status, VsBar } from '../kit'
import { MemGrid, QuizOption, QuizQuestion, TttBoard } from '../boards'

const rand = () => Math.random()

type BackProp = { onBack?: () => void }

// ── tic-tac-toe ──────────────────────────────────────────────────────────

const ME: Mark = 'X'
const BOT: Mark = 'O'

export function TicTacToeVsBot({ onBack }: BackProp = {}) {
  const [level, setLevel] = React.useState<Difficulty>('medium')
  const [moves, setMoves] = React.useState<Move[]>([])
  const [tally, setTally] = React.useState({ me: 0, bot: 0 })
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  React.useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const board = boardFrom(moves)
  const state = outcome(board)
  const myTurn = state.kind === 'playing' && state.turn === ME
  const botsTurn = state.kind === 'playing' && state.turn === BOT

  // The bot moves when it is its turn — in an effect, so a re-render for any
  // other reason cannot make it move twice. (The web lists the derived `state`
  // object in the deps, which re-arms the timer on every render; keyed on the
  // inputs it is derived from instead, so a theme re-render cannot restart the
  // bot's pause. Same moves, same timing.)
  React.useEffect(() => {
    if (!botsTurn) return
    timer.current = setTimeout(() => {
      setMoves(cur => {
        const s = outcome(boardFrom(cur))
        if (s.kind !== 'playing' || s.turn !== BOT) return cur
        const cell = botMove(cur, BOT, level, rand)
        if (cell < 0) return cur
        const m: Move = { n: cur.length, by: BOT, cell }
        return canApply(cur, m).legal ? [...cur, m] : cur
      })
    }, botDelay(level, rand))
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [moves, level, botsTurn])

  // Running tally for this sitting. Counted once per finished board.
  const counted = React.useRef(0)
  const wonBy = state.kind === 'won' ? state.by : null
  React.useEffect(() => {
    if (!wonBy || counted.current === moves.length) return
    counted.current = moves.length
    setTally(t => wonBy === ME ? { ...t, me: t.me + 1 } : { ...t, bot: t.bot + 1 })
  }, [wonBy, moves.length])

  const play = (cell: number) => {
    if (!myTurn) return
    const m: Move = { n: moves.length, by: ME, cell }
    if (!canApply(moves, m).legal) return
    setMoves([...moves, m])
  }
  const reset = () => { counted.current = 0; setMoves([]) }

  const line = state.kind === 'won' ? state.line : []
  const iWon = state.kind === 'won' && state.by === ME
  const status = state.kind === 'won'
    ? (state.by === ME ? 'You win.' : 'The computer wins.')
    : state.kind === 'draw' ? "A draw. That's the game, not the bot."
    : myTurn ? 'Your turn.' : 'Thinking…'

  return (
    <Stage cat="arcade" icon="⭕" title="Tic-Tac-Toe" sub="You are X and you open." onBack={onBack}
      confetti={iWon ? tally.me : 0}>
      <DifficultyBar level={level} onPick={d => { setLevel(d); reset() }} />
      <VsBar left={{ who: 'You', pts: tally.me }} right={{ who: 'Computer', pts: tally.bot }}
        turn={state.kind !== 'playing' ? null : myTurn ? 'left' : 'right'} mid="wins" />
      <Status text={status} busy={state.kind === 'playing' && !myTurn}
        tone={state.kind === 'won' ? (iWon ? 'win' : 'lose') : state.kind === 'draw' ? 'draw' : undefined} />
      <TttBoard board={board} line={line} disabled={i => !!board[i] || !myTurn} onTap={play} />
      <Key title="New Game" onPress={reset} />
    </Stage>
  )
}

// ── memory match ─────────────────────────────────────────────────────────

const HOST = 'HOST' as const
const GUEST = 'GUEST' as const
const newSeed = () => Math.floor(Math.random() * 2 ** 31)

export function MemoryVsBot({ onBack }: BackProp = {}) {
  const [level, setLevel] = React.useState<Difficulty>('medium')
  const [seed, setSeed] = React.useState(newSeed)
  const [turns, setTurns] = React.useState<MemTurn[]>([])
  const [faceUp, setFaceUp] = React.useState<number[]>([])
  const [peek, setPeek] = React.useState<MemTurn | null>(null)
  const [mind, setMind] = React.useState<MemMind>(EMPTY_MIND)
  const busy = React.useRef(false)
  const timers = React.useRef<ReturnType<typeof setTimeout>[]>([])
  React.useEffect(() => () => { timers.current.forEach(clearTimeout) }, [])

  // One deck per seed (the web rebuilds the identical array every render).
  const deck = React.useMemo(() => memDeck(seed), [seed])
  const state = memReplay(deck, turns)
  const myTurn = state.turn === HOST && !state.done

  const commit = React.useCallback((t: MemTurn) => {
    setPeek(t)
    const id = setTimeout(() => {
      setPeek(null); setFaceUp([]); busy.current = false
      setMind(m => remember(m, deck, t, level))
      setTurns(cur => memCanApply(deck, cur, t).legal ? [...cur, t] : cur)
    }, 850)
    timers.current.push(id)
  }, [deck, level])

  // The bot's turn.
  React.useEffect(() => {
    if (state.done || state.turn !== GUEST || busy.current) return
    busy.current = true
    const id = setTimeout(() => {
      const pick = memBotTurn(deck, state.matched, mind, rand)
      if (!pick) { busy.current = false; return }
      const t: MemTurn = { n: turns.length, by: GUEST, a: pick[0], b: pick[1] }
      if (!memCanApply(deck, turns, t).legal) { busy.current = false; return }
      setFaceUp([t.a, t.b])
      commit(t)
    }, botDelay(level, rand))
    timers.current.push(id)
  })

  const flip = (i: number) => {
    if (!myTurn || busy.current || state.matched.includes(i) || faceUp.includes(i)) return
    const next = [...faceUp, i]
    if (next.length < 2) { setFaceUp(next); return }
    const t: MemTurn = { n: turns.length, by: HOST, a: next[0], b: next[1] }
    if (!memCanApply(deck, turns, t).legal) { setFaceUp([]); return }
    busy.current = true
    setFaceUp(next)
    commit(t)
  }

  const restart = () => {
    timers.current.forEach(clearTimeout); busy.current = false
    setSeed(newSeed())
    setTurns([]); setFaceUp([]); setPeek(null); setMind(EMPTY_MIND)
  }

  const shown = new Set<number>([...state.matched, ...faceUp, ...(peek ? [peek.a, peek.b] : [])])
  const result = memResult(deck, turns)
  const iWon = !!result && !result.draw && result.winner === HOST

  return (
    <Stage cat="memory" icon="🧩" title="Memory Match"
      sub={`You ${state.scores.HOST} · Computer ${state.scores.GUEST} · ${MEM_CARDS / 2} pairs`}
      onBack={onBack} confetti={iWon ? seed : 0}>
      <DifficultyBar level={level} onPick={d => { setLevel(d); restart() }} />
      <VsBar left={{ who: 'You', pts: state.scores.HOST }} right={{ who: 'Computer', pts: state.scores.GUEST }}
        turn={state.done ? null : myTurn ? 'left' : 'right'} mid="pairs" />
      <Status
        busy={!result && !myTurn}
        tone={result ? (result.draw ? 'draw' : iWon ? 'win' : 'lose') : undefined}
        text={result
          ? result.draw ? 'A draw.'
            : result.winner === HOST ? 'You win.' : 'The computer wins.'
          : myTurn ? 'Your turn: turn over two.' : 'The computer is looking…'} />
      <MemGrid key={seed} faces={deck} isOpen={i => shown.has(i)} isDone={i => state.matched.includes(i)} onFlip={flip} />
      <Key title="New Game" onPress={restart} />
    </Stage>
  )
}

// ── trivia ───────────────────────────────────────────────────────────────

export function TriviaVsBot({ onBack }: BackProp = {}) {
  const [level, setLevel] = React.useState<Difficulty>('medium')
  const [seed, setSeed] = React.useState(newSeed)
  const [at, setAt] = React.useState(0)
  const [mine, setMine] = React.useState<number | null>(null)
  const [theirs, setTheirs] = React.useState<number | null>(null)
  const [score, setScore] = React.useState({ me: 0, bot: 0 })
  const timers = React.useRef<ReturnType<typeof setTimeout>[]>([])
  React.useEffect(() => () => { timers.current.forEach(clearTimeout) }, [])

  const qs = React.useMemo(() => quizFor(seed), [seed])
  const q = qs[at]
  const done = at >= qs.length

  const answer = (choice: number) => {
    if (mine !== null || done) return
    setMine(choice)
    if (choice === q.correct) setScore(s => ({ ...s, me: s.me + 1 }))

    // The bot answers after a pause, and only then is anything revealed —
    // so its choice cannot influence yours.
    const bot = botAnswer(q, level, rand)
    const id = setTimeout(() => {
      setTheirs(bot)
      if (bot === q.correct) setScore(s => ({ ...s, bot: s.bot + 1 }))
      const next = setTimeout(() => {
        setAt(n => n + 1); setMine(null); setTheirs(null)
      }, 1400)
      timers.current.push(next)
    }, botDelay(level, rand))
    timers.current.push(id)
  }

  const restart = () => {
    timers.current.forEach(clearTimeout)
    setSeed(newSeed())
    setAt(0); setMine(null); setTheirs(null); setScore({ me: 0, bot: 0 })
  }

  const iWon = done && score.me > score.bot

  return (
    <Stage cat="quiz" icon="💡" title="EZER Trivia" sub={`You ${score.me} · Computer ${score.bot}`}
      onBack={onBack} confetti={iWon ? seed : 0}>
      <DifficultyBar level={level} onPick={d => { setLevel(d); restart() }} />
      <VsBar left={{ who: 'You', pts: score.me }} right={{ who: 'Computer', pts: score.bot }}
        mid={done ? 'final' : `Q${at + 1}/${qs.length}`} />

      {done ? (
        <>
          <Result big={`${score.me}–${score.bot}`}
            what={score.me === score.bot ? `A draw, ${score.me} each.`
              : score.me > score.bot ? `You win, ${score.me}–${score.bot}.`
              : `The computer wins, ${score.bot}–${score.me}.`} />
          <Key title="Play Again" onPress={restart} />
        </>
      ) : (
        <View key={`${seed}-${at}`} style={{ alignSelf: 'stretch', gap: 10 }}>
          <QuizQuestion small={`Question ${at + 1} of ${qs.length}`} text={`Q${at + 1}. ${q.q}`} />
          {q.opts.map((o, i) => {
            const reveal = theirs !== null
            const right = reveal && i === q.correct
            const wrongPick = reveal && i === mine && i !== q.correct
            const state = right ? 'right' : wrongPick ? 'wrong' : !reveal && mine === i ? 'mine' : null
            return (
              <QuizOption key={i} i={i} text={o} state={state} locked={mine !== null}
                onPress={() => answer(i)} tag={reveal && theirs === i ? 'computer' : undefined} />
            )
          })}
          <Status busy={mine !== null && theirs === null}
            text={mine !== null && theirs === null ? 'The computer is thinking…' : ''} />
        </View>
      )}
    </Stage>
  )
}
