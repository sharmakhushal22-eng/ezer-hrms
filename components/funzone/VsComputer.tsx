'use client'
// components/funzone/VsComputer.tsx — the three games, against the machine.
//
// Every rule comes from lib/funzone/games.ts and every decision from
// lib/funzone/ai.ts, so the bot plays by exactly the rules a colleague would
// and none of it is reimplemented here. This file is the screen and the
// timers, nothing else.
//
// REDESIGN (Sep 2026): markup and styling only. The state, the effects, the
// timers and every call into games.ts / ai.ts are exactly as they were. The
// one addition is an optional `onBack`, so the Back button can sit in the
// stage header instead of floating above it.
//
// THE BOT PAUSES BEFORE IT MOVES. Instantly is technically correct and reads
// as a script rather than an opponent; botDelay decides how long, and it is
// shorter on hard because a stronger player also answers faster.

import { useState, useEffect, useRef, useCallback, type CSSProperties } from 'react'
import {
  boardFrom, outcome, canApply, memDeck, memReplay, memCanApply, memResult,
  quizFor, MEM_CARDS, type Move, type Mark, type MemTurn,
} from '@/lib/funzone/games'
import {
  botMove, memBotTurn, remember, botAnswer, botDelay, EMPTY_MIND,
  type Difficulty, type MemMind,
} from '@/lib/funzone/ai'
import { Stage, Status, VsBar, DifficultyBar as Difficulty3, cx } from './ui'

const rand = () => Math.random()

/** Kept as a named export — it was one before, and something may import it. */
export const DifficultyBar = Difficulty3

type BackProp = { onBack?: () => void }

// ── tic-tac-toe ──────────────────────────────────────────────────────────

export function TicTacToeVsBot({ onBack }: BackProp = {}) {
  const [level, setLevel] = useState<Difficulty>('medium')
  const [moves, setMoves] = useState<Move[]>([])
  const [tally, setTally] = useState({ me: 0, bot: 0 })
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const ME: Mark = 'X', BOT: Mark = 'O'
  const board = boardFrom(moves)
  const state = outcome(board)
  const myTurn = state.kind === 'playing' && state.turn === ME

  // The bot moves when it is its turn — in an effect, so a re-render for any
  // other reason cannot make it move twice.
  useEffect(() => {
    if (state.kind !== 'playing' || state.turn !== BOT) return
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
  }, [moves, state.kind, level, state])

  // Running tally for this sitting. Counted once per finished board.
  const counted = useRef(0)
  useEffect(() => {
    if (state.kind !== 'won' || counted.current === moves.length) return
    counted.current = moves.length
    setTally(t => state.by === ME ? { ...t, me: t.me + 1 } : { ...t, bot: t.bot + 1 })
  }, [state, moves.length])

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
    : state.kind === 'draw' ? "A draw — that's the game, not the bot."
    : myTurn ? 'Your turn.' : 'Thinking…'

  return (
    <Stage cat="arcade" icon="⭕" title="Tic-Tac-Toe" sub="You are X and you open." onBack={onBack}
           confetti={iWon ? tally.me : 0}>
      <DifficultyBar level={level} onPick={d => { setLevel(d); reset() }} />
      <VsBar left={{ who: 'You', pts: tally.me }} right={{ who: 'Computer', pts: tally.bot }}
             turn={state.kind !== 'playing' ? null : myTurn ? 'left' : 'right'} mid="wins" />
      <Status text={status} busy={state.kind === 'playing' && !myTurn}
              tone={state.kind === 'won' ? (iWon ? 'win' : 'lose') : state.kind === 'draw' ? 'draw' : undefined} />
      <div className="ttt">
        {board.map((v, i) => (
          <button key={i} type="button" onClick={() => play(i)} data-ghost="X"
            disabled={!!v || !myTurn}
            aria-label={v ? `Square ${i + 1}, ${v}` : `Square ${i + 1}, empty`}
            className={cx('ttt-sq', line.includes(i) && 'win')}>
            {v && <span className={cx('m', v.toLowerCase())}>{v}</span>}
          </button>
        ))}
      </div>
      <button type="button" onClick={reset} className="fz-key">New Game</button>
    </Stage>
  )
}

// ── memory match ─────────────────────────────────────────────────────────

export function MemoryVsBot({ onBack }: BackProp = {}) {
  const [level, setLevel] = useState<Difficulty>('medium')
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 2 ** 31))
  const [turns, setTurns] = useState<MemTurn[]>([])
  const [faceUp, setFaceUp] = useState<number[]>([])
  const [peek, setPeek] = useState<MemTurn | null>(null)
  const [mind, setMind] = useState<MemMind>(EMPTY_MIND)
  const busy = useRef(false)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  useEffect(() => () => { timers.current.forEach(clearTimeout) }, [])

  const deck = memDeck(seed)
  const state = memReplay(deck, turns)
  const ME = 'HOST' as const, BOT = 'GUEST' as const
  const myTurn = state.turn === ME && !state.done

  const commit = useCallback((t: MemTurn) => {
    setPeek(t)
    const id = setTimeout(() => {
      setPeek(null); setFaceUp([]); busy.current = false
      setMind(m => remember(m, deck, t, level))
      setTurns(cur => memCanApply(deck, cur, t).legal ? [...cur, t] : cur)
    }, 850)
    timers.current.push(id)
  }, [deck, level])

  // The bot's turn.
  useEffect(() => {
    if (state.done || state.turn !== BOT || busy.current) return
    busy.current = true
    const id = setTimeout(() => {
      const pick = memBotTurn(deck, state.matched, mind, rand)
      if (!pick) { busy.current = false; return }
      const t: MemTurn = { n: turns.length, by: BOT, a: pick[0], b: pick[1] }
      if (!memCanApply(deck, turns, t).legal) { busy.current = false; return }
      setFaceUp([t.a, t.b])
      commit(t)
    }, botDelay(level, rand))
    timers.current.push(id)
  }, [turns, state, deck, mind, level, commit])

  const flip = (i: number) => {
    if (!myTurn || busy.current || state.matched.includes(i) || faceUp.includes(i)) return
    const next = [...faceUp, i]
    if (next.length < 2) { setFaceUp(next); return }
    const t: MemTurn = { n: turns.length, by: ME, a: next[0], b: next[1] }
    if (!memCanApply(deck, turns, t).legal) { setFaceUp([]); return }
    busy.current = true
    setFaceUp(next)
    commit(t)
  }

  const restart = () => {
    timers.current.forEach(clearTimeout); busy.current = false
    setSeed(Math.floor(Math.random() * 2 ** 31))
    setTurns([]); setFaceUp([]); setPeek(null); setMind(EMPTY_MIND)
  }

  const shown = new Set<number>([...state.matched, ...faceUp,
                                 ...(peek ? [peek.a, peek.b] : [])])
  const result = memResult(deck, turns)
  const iWon = !!result && !result.draw && result.winner === ME

  return (
    <Stage cat="memory" icon="🧩" title="Memory Match"
           sub={`You ${state.scores.HOST} · Computer ${state.scores.GUEST} — ${MEM_CARDS / 2} pairs`}
           onBack={onBack} confetti={iWon ? seed : 0}>
      <DifficultyBar level={level} onPick={d => { setLevel(d); restart() }} />
      <VsBar left={{ who: 'You', pts: state.scores.HOST }} right={{ who: 'Computer', pts: state.scores.GUEST }}
             turn={state.done ? null : myTurn ? 'left' : 'right'} mid="pairs" />
      <Status
        busy={!result && !myTurn}
        tone={result ? (result.draw ? 'draw' : iWon ? 'win' : 'lose') : undefined}
        text={result
          ? result.draw ? 'A draw.'
            : result.winner === ME ? 'You win.' : 'The computer wins.'
          : myTurn ? 'Your turn — turn over two.' : 'The computer is looking…'} />
      <div className="mem" key={seed}>
        {deck.map((face, i) => {
          const open = shown.has(i), done = state.matched.includes(i)
          return (
            <button key={i} type="button" onClick={() => flip(i)}
              aria-label={open ? `Card ${i + 1}, ${face}` : `Card ${i + 1}, face down`}
              className={cx('mcard', done ? 'done' : open && 'up')}
              style={!myTurn && !done ? { cursor: 'default' } : undefined}>
              <span className="face">{open ? face : ''}</span>
            </button>
          )
        })}
      </div>
      <button type="button" onClick={restart} className="fz-key">New Game</button>
    </Stage>
  )
}

// ── trivia ───────────────────────────────────────────────────────────────

const KEYS = ['A', 'B', 'C', 'D', 'E']

export function TriviaVsBot({ onBack }: BackProp = {}) {
  const [level, setLevel] = useState<Difficulty>('medium')
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 2 ** 31))
  const [at, setAt] = useState(0)
  const [mine, setMine] = useState<number | null>(null)
  const [theirs, setTheirs] = useState<number | null>(null)
  const [score, setScore] = useState({ me: 0, bot: 0 })
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  useEffect(() => () => { timers.current.forEach(clearTimeout) }, [])

  const qs = quizFor(seed)
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
    setSeed(Math.floor(Math.random() * 2 ** 31))
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
          <div className="fz-result">
            <span className="big">{score.me}–{score.bot}</span>
            <span className="what">
              {score.me === score.bot ? `A draw, ${score.me} each.`
                : score.me > score.bot ? `You win, ${score.me}–${score.bot}.`
                : `The computer wins, ${score.bot}–${score.me}.`}
            </span>
          </div>
          <button type="button" onClick={restart} className="fz-key">Play Again</button>
        </>
      ) : (
        <div className="quiz" key={`${seed}-${at}`}>
          <p className="quiz-q"><small>Question {at + 1} of {qs.length}</small>Q{at + 1}. {q.q}</p>
          {q.opts.map((o, i) => {
            const reveal = theirs !== null
            const right = reveal && i === q.correct
            const wrongPick = reveal && i === mine && i !== q.correct
            return (
              <button key={i} type="button" onClick={() => answer(i)} data-key={KEYS[i]}
                aria-disabled={mine !== null}
                // display:block stays inline: scripts/smoke-funzone.py finds options by it.
                style={{ display: 'block', '--i': i } as CSSProperties}
                className={cx('quiz-opt', right && 'right', wrongPick && 'wrong',
                              !reveal && mine === i && 'mine')}>
                {o}
                {reveal && theirs === i && <span className="by">computer</span>}
              </button>
            )
          })}
          <Status busy={mine !== null && theirs === null}
                  text={mine !== null && theirs === null ? 'The computer is thinking…' : ''} />
        </div>
      )}
    </Stage>
  )
}
