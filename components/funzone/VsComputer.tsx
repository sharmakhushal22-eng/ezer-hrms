'use client'
// components/funzone/VsComputer.tsx — the three games, against the machine.
//
// Every rule comes from lib/funzone/games.ts and every decision from
// lib/funzone/ai.ts, so the bot plays by exactly the rules a colleague would
// and none of it is reimplemented here. This file is the screen and the
// timers, nothing else.
//
// THE BOT PAUSES BEFORE IT MOVES. Instantly is technically correct and reads
// as a script rather than an opponent; botDelay decides how long, and it is
// shorter on hard because a stronger player also answers faster.

import { useState, useEffect, useRef, useCallback } from 'react'
import { C, F, W, S, R } from '@/lib/ui'
import {
  boardFrom, outcome, canApply, memDeck, memReplay, memCanApply, memResult,
  quizFor, MEM_CARDS, type Move, type Mark, type MemTurn,
} from '@/lib/funzone/games'
import {
  botMove, memBotTurn, remember, botAnswer, botDelay, EMPTY_MIND,
  DIFFICULTY_LABEL, DIFFICULTY_MEANING, type Difficulty, type MemMind,
} from '@/lib/funzone/ai'

const rand = () => Math.random()

const panel: React.CSSProperties = {
  background: C.surface, borderRadius: 14, padding: 24,
  boxShadow: 'var(--ez-shadow-flat)',
}
const title: React.CSSProperties = { fontSize: 18, fontWeight: 700, marginBottom: 4 }
const sub: React.CSSProperties = { fontSize: 12, color: C.muted, marginBottom: 18 }
const primary: React.CSSProperties = {
  fontFamily: 'inherit', fontSize: 14, fontWeight: 700, color: C.onAccent,
  background: C.brand, border: 'none', borderRadius: 10, padding: '10px 24px',
  cursor: 'pointer',
}

export function DifficultyBar({ level, onPick }: {
  level: Difficulty; onPick: (d: Difficulty) => void
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {(['easy', 'medium', 'hard'] as Difficulty[]).map(d => {
          const on = d === level
          return (
            <button key={d} type="button" onClick={() => onPick(d)} aria-pressed={on}
              style={{ fontFamily: 'inherit', fontSize: 12, fontWeight: 700,
                       padding: '6px 13px', borderRadius: 999, cursor: 'pointer',
                       border: `1px solid ${on ? C.brand : C.line}`,
                       background: on ? C.brand : C.surface,
                       color: on ? C.onAccent : C.inkSoft }}>
              {DIFFICULTY_LABEL[d]}
            </button>
          )
        })}
      </div>
      <div style={{ fontSize: 11, color: C.muted, marginTop: 6, lineHeight: 1.6 }}>
        {DIFFICULTY_MEANING[level]}
      </div>
    </div>
  )
}

// ── tic-tac-toe ──────────────────────────────────────────────────────────

export function TicTacToeVsBot() {
  const [level, setLevel] = useState<Difficulty>('medium')
  const [moves, setMoves] = useState<Move[]>([])
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

  const play = (cell: number) => {
    if (!myTurn) return
    const m: Move = { n: moves.length, by: ME, cell }
    if (!canApply(moves, m).legal) return
    setMoves([...moves, m])
  }

  const line = state.kind === 'won' ? state.line : []
  const status = state.kind === 'won'
    ? (state.by === ME ? 'You win.' : 'The computer wins.')
    : state.kind === 'draw' ? "A draw — that's the game, not the bot."
    : myTurn ? 'Your turn.' : 'Thinking…'

  return (
    <div style={panel}>
      <div style={title}>⭕ Tic-Tac-Toe</div>
      <div style={sub}>You are X and you open.</div>
      <DifficultyBar level={level} onPick={d => { setLevel(d); setMoves([]) }} />
      <div style={{ textAlign: 'center', fontWeight: 700, marginBottom: 12,
                    fontSize: 15, color: state.kind === 'won' ? C.positive : C.ink }}>
        {status}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 80px)',
                    gridTemplateRows: 'repeat(3, 80px)', gap: 6,
                    margin: '0 auto 16px', justifyContent: 'center' }}>
        {board.map((v, i) => {
          const inWin = line.includes(i)
          return (
            <button key={i} onClick={() => play(i)}
              aria-label={v ? `Square ${i + 1}, ${v}` : `Square ${i + 1}, empty`}
              style={{ background: inWin ? C.positiveTint : C.brandTint,
                       border: inWin ? `2px solid ${C.positive}` : 'none',
                       borderRadius: 10, fontSize: 32, fontWeight: 700,
                       fontFamily: 'inherit',
                       cursor: v || !myTurn ? 'default' : 'pointer',
                       color: inWin ? C.positive : C.brandDeep }}>{v}</button>
          )
        })}
      </div>
      <div style={{ textAlign: 'center' }}>
        <button onClick={() => setMoves([])} style={primary}>New Game</button>
      </div>
    </div>
  )
}

// ── memory match ─────────────────────────────────────────────────────────

export function MemoryVsBot() {
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

  return (
    <div style={panel}>
      <div style={title}>🧩 Memory Match</div>
      <div style={sub}>
        You {state.scores.HOST} · Computer {state.scores.GUEST} — {MEM_CARDS / 2} pairs
      </div>
      <DifficultyBar level={level} onPick={d => { setLevel(d); restart() }} />
      <div style={{ textAlign: 'center', fontWeight: 700, marginBottom: 12, fontSize: 15,
                    color: result ? C.positive : C.ink }}>
        {result
          ? result.draw ? 'A draw.'
            : result.winner === ME ? 'You win.' : 'The computer wins.'
          : myTurn ? 'Your turn — turn over two.' : 'The computer is looking…'}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 70px)', gap: 8,
                    margin: '0 auto 16px', justifyContent: 'center' }}>
        {deck.map((face, i) => {
          const open = shown.has(i), done = state.matched.includes(i)
          return (
            <button key={i} onClick={() => flip(i)}
              aria-label={open ? `Card ${i + 1}, ${face}` : `Card ${i + 1}, face down`}
              style={{ width: 70, height: 70, border: 'none', borderRadius: 10,
                       display: 'flex', alignItems: 'center', justifyContent: 'center',
                       fontSize: 28, fontFamily: 'inherit',
                       cursor: done || !myTurn ? 'default' : 'pointer',
                       background: done ? C.positiveTint : open ? C.brandTint : C.brand,
                       opacity: done ? .6 : 1 }}>
              {open ? face : ''}
            </button>
          )
        })}
      </div>
      <div style={{ textAlign: 'center' }}>
        <button onClick={restart} style={primary}>New Game</button>
      </div>
    </div>
  )
}

// ── trivia ───────────────────────────────────────────────────────────────

export function TriviaVsBot() {
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

  return (
    <div style={panel}>
      <div style={title}>💡 EZER Trivia</div>
      <div style={sub}>You {score.me} · Computer {score.bot}</div>
      <DifficultyBar level={level} onPick={d => { setLevel(d); restart() }} />

      {done ? (
        <>
          <div style={{ textAlign: 'center', fontSize: 16, fontWeight: 700,
                        color: C.brandDeep, margin: '10px 0 16px' }}>
            {score.me === score.bot ? `A draw, ${score.me} each.`
              : score.me > score.bot ? `You win, ${score.me}–${score.bot}.`
              : `The computer wins, ${score.bot}–${score.me}.`}
          </div>
          <div style={{ textAlign: 'center' }}>
            <button onClick={restart} style={primary}>Play Again</button>
          </div>
        </>
      ) : (
        <>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 14 }}>
            Q{at + 1}. {q.q}
          </div>
          {q.opts.map((o, i) => {
            const reveal = theirs !== null
            const right = reveal && i === q.correct
            const wrongPick = reveal && i === mine && i !== q.correct
            return (
              <button key={i} onClick={() => answer(i)}
                style={{ display: 'block', width: '100%', textAlign: 'left',
                         borderRadius: 10, padding: '10px 14px', marginBottom: 8,
                         cursor: mine !== null ? 'default' : 'pointer',
                         fontFamily: 'inherit', fontSize: 13, color: C.ink,
                         background: right ? C.positiveTint
                                   : wrongPick ? C.criticalTint
                                   : mine === i ? C.brandTint : C.sunken,
                         border: `2px solid ${right ? C.positive
                                   : wrongPick ? C.critical : 'transparent'}` }}>
                {o}
                {reveal && theirs === i && (
                  <span style={{ float: 'right', fontSize: 11, color: C.muted }}>
                    computer
                  </span>
                )}
              </button>
            )
          })}
          <div style={{ fontSize: 11, color: C.muted, minHeight: 16 }}>
            {mine !== null && theirs === null && 'The computer is thinking…'}
          </div>
        </>
      )}
    </div>
  )
}
