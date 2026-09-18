'use client'
// components/ess/FunZone.tsx — ESS Fun Zone: fourteen break-time games.
// Redesigned September 2026. The flow and every rule are unchanged; the look,
// the motion and ten solo mind games are new. See REDESIGN-NOTES.md.
//
// Nothing here touches the database, deliberately (brief §3 and §7): a refresh resets
// every game and no score history is kept. That is the current design, not an oversight
// — a leaderboard or personal history would need a new table and is an open question.
// The ten new games follow the same rule: lib/funzone/mindgames.ts is pure, and
// nothing in this file or components/funzone/MindGames.tsx calls the network.
//
// Hub-and-spoke (brief §8): a grid of cards, each opening its game in the same
// panel behind a "Back" button. Open to every employee, no role check (brief §9).
//
// All sub-components are defined OUTSIDE the parent (no focus-loss).
import { useState, useEffect, useRef, useCallback, useMemo, type CSSProperties, type ReactNode } from 'react'
import PlayTogether from '@/components/funzone/PlayTogether'
// One copy of the questions and the card faces, shared with the live modes.
// Both were duplicated here and both drifted — see the notes in games.ts.
import { QUIZ, MEM_FACES } from '@/lib/funzone/games'
import { TicTacToeVsBot, MemoryVsBot, TriviaVsBot } from '@/components/funzone/VsComputer'
import { MIND_GAMES, CATEGORY_LABEL, type Category } from '@/lib/funzone/mindgames'
import { MindGame } from '@/components/funzone/MindGames'
import { FzStyles, Stage, Status, Stat, cx, type Cat } from '@/components/funzone/ui'

// ── the catalogue ───────────────────────────────────────────────
// The first four are the originals — same keys, names and copy as before.
// `live` marks the ones that can be played with a colleague.
interface Tile { k: string; icon: string; name: string; desc: string; badge: string; cat: Cat; live?: boolean; bot?: boolean }

const GAMES: Tile[] = [
  { k:'ttt',   icon:'⭕', name:'Tic-Tac-Toe',    desc:'Against the computer, or a colleague',      badge:'Arcade', cat:'arcade', live:true, bot:true },
  { k:'mem',   icon:'🧩', name:'Memory Match',   desc:'Find the pairs — alone or head to head',    badge:'Arcade', cat:'memory', live:true, bot:true },
  { k:'quiz',  icon:'💡', name:'EZER Trivia',    desc:'Company policy, solo or against somebody',  badge:'Quiz',   cat:'quiz',   live:true, bot:true },
  { k:'wheel', icon:'🎡', name:'Spin the Wheel', desc:'Daily spin — win a fun shoutout or a treat', badge:'Social', cat:'social' },
]

const MIND_TILES: Tile[] = MIND_GAMES.map(g => ({
  k: g.code, icon: g.icon, name: g.name, desc: g.desc, badge: CATEGORY_LABEL[g.cat], cat: g.cat,
}))

const ALL_TILES = [...GAMES, ...MIND_TILES]

// ── Tic-Tac-Toe ─────────────────────────────────────────────────
// Standard 2-player, same-screen turns (brief §4). Cross-device play is the
// "With a colleague" mode — this is the break-room version.
const WIN_LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]]
function TicTacToe({ onBack }: { onBack: () => void }) {
  const [board, setBoard] = useState<string[]>(Array(9).fill(''))
  const [turn, setTurn] = useState<'X'|'O'>('X')
  const [tally, setTally] = useState({ X: 0, O: 0 })

  // Winner is derived from the board rather than tracked in its own state, so the
  // status line can never disagree with the squares it is describing.
  const line = WIN_LINES.find(([a,b,c]) => board[a] && board[a] === board[b] && board[a] === board[c])
  const win = line ? board[line[0]] : null
  const draw = !win && board.every(Boolean)
  const over = !!win || draw

  const move = (i: number) => {
    if (board[i] || over) return
    const next = [...board]; next[i] = turn
    const l = WIN_LINES.find(([a,b,c]) => next[a] && next[a] === next[b] && next[a] === next[c])
    if (l) setTally(t => ({ ...t, [turn]: t[turn] + 1 }))
    setBoard(next); setTurn(t => t === 'X' ? 'O' : 'X')
  }
  const reset = () => { setBoard(Array(9).fill('')); setTurn('X') }
  const status = win ? `🎉 Player ${win} wins!` : draw ? "It's a draw!" : `Player ${turn}'s turn`

  return (
    <Stage cat="arcade" icon="⭕" title="Tic-Tac-Toe" sub="Two players, take turns tapping a square"
           onBack={onBack} confetti={win ? tally.X + tally.O : 0}>
      <div className="fz-vs">
        <div className={cx('side', !over && turn === 'X' && 'on')}><span className="pts">{tally.X}</span><span className="who">Player X</span></div>
        <span className="mid">wins</span>
        <div className={cx('side', !over && turn === 'O' && 'on')}><span className="pts">{tally.O}</span><span className="who">Player O</span></div>
      </div>
      <Status text={status} tone={win ? 'win' : draw ? 'draw' : undefined} />
      <div className="ttt">
        {board.map((v, i) => (
          <button key={i} type="button" onClick={() => move(i)} disabled={!!v || over}
            data-ghost={turn}
            aria-label={v ? `Square ${i + 1}, ${v}` : `Square ${i + 1}, empty`}
            className={cx('ttt-sq', line?.includes(i) && 'win')}>
            {v && <span className={cx('m', v.toLowerCase())}>{v}</span>}
          </button>
        ))}
      </div>
      <button type="button" className="fz-key" onClick={reset}>New Game</button>
    </Stage>
  )
}

// ── Memory Match ────────────────────────────────────────────────
// Eight DISTINCT faces, shuffled with Fisher–Yates.
// sort(() => Math.random() - 0.5) — what the prototype used — is not a
// uniform shuffle; some layouts come up far more often than others.
function shuffleDeck(): string[] {
  const d = [...MEM_FACES, ...MEM_FACES]
  for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [d[i], d[j]] = [d[j], d[i]] }
  return d
}
function MemoryMatch({ onBack }: { onBack: () => void }) {
  // Cards are dealt in an effect, not in the initial state: Math.random() during render
  // would deal one deck on the server and a different one in the browser.
  const [cards, setCards] = useState<string[]>([])
  const [flipped, setFlipped] = useState<number[]>([])
  const [matched, setMatched] = useState<number[]>([])
  const [lock, setLock] = useState(false)
  const [turns, setTurns] = useState(0)
  const [deal, setDeal] = useState(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const reset = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    setCards(shuffleDeck()); setFlipped([]); setMatched([]); setLock(false); setTurns(0); setDeal(d => d + 1)
  }, [])
  useEffect(() => { reset(); return () => { if (timer.current) clearTimeout(timer.current) } }, [reset])

  const flip = (i: number) => {
    if (lock || flipped.includes(i) || matched.includes(i)) return
    const next = [...flipped, i]
    setFlipped(next)
    if (next.length < 2) return
    setTurns(t => t + 1)
    const [a, b] = next
    if (cards[a] === cards[b]) { setMatched(m => [...m, a, b]); setFlipped([]); return }
    // Board locks during the flip-back so a third card can't be turned mid-check.
    setLock(true)
    timer.current = setTimeout(() => { setFlipped([]); setLock(false) }, 800)
  }

  const pairs = matched.length / 2
  const done = pairs === MEM_FACES.length
  return (
    <Stage cat="memory" icon="🧩" title="Memory Match"
           sub={done ? 'You found them all!' : `Find all 8 pairs — ${pairs} found`}
           aside={<><Stat label="pairs" value={`${pairs}/8`} hot bump /><Stat label="turns" value={turns} /></>}
           onBack={onBack} confetti={done ? deal : 0}>
      <div className="fz-progress" aria-hidden="true"><i style={{ '--p': `${pairs / 8 * 100}%` } as CSSProperties} /></div>
      {done && <Status text={`Cleared in ${turns} turns`} tone="win" />}
      <div className="mem" key={deal}>
        {cards.map((emoji, i) => {
          const isUp = flipped.includes(i), isDone = matched.includes(i)
          return (
            <button key={i} type="button" onClick={() => flip(i)}
              aria-label={isUp || isDone ? `Card ${i + 1}, ${emoji}` : `Card ${i + 1}, face down`}
              className={cx('mcard', isDone ? 'done' : isUp && 'up')}>
              <span className="face">{(isUp || isDone) ? emoji : ''}</span>
            </button>
          )
        })}
      </div>
      <button type="button" className="fz-key" onClick={reset}>New Game</button>
    </Stage>
  )
}

// ── EZER Trivia ─────────────────────────────────────────────────
// Questions are hardcoded (brief §5). Making them HR-editable is an open question —
// it would need a table and a config screen.
const KEYS = ['A', 'B', 'C', 'D', 'E']
function Trivia({ onBack }: { onBack: () => void }) {
  const [idx, setIdx] = useState(0)
  const [score, setScore] = useState(0)
  const [picked, setPicked] = useState<number | null>(null)
  const [round, setRound] = useState(1)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const restart = () => { if (timer.current) clearTimeout(timer.current); setIdx(0); setScore(0); setPicked(null); setRound(r => r + 1) }
  const answer = (i: number) => {
    if (picked !== null) return   // one answer per question — ignore double taps
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
      <div className="fz-progress" aria-hidden="true"><i style={{ '--p': `${Math.min(idx, QUIZ.length) / QUIZ.length * 100}%` } as CSSProperties} /></div>
      <div className="fz-hint">Score: {score} / {QUIZ.length}</div>
      {done ? (
        <>
          <div className="fz-result">
            <span className="big">{score}/{QUIZ.length}</span>
            <span className="what">Quiz done! You scored {score}/{QUIZ.length}</span>
            <span className="sub">{perfect ? 'Every one right.' : 'Play again — the questions stay the same.'}</span>
          </div>
          <button type="button" className="fz-key" onClick={restart}>Play Again</button>
        </>
      ) : (
        <div className="quiz" key={idx}>
          <p className="quiz-q"><small>Question {idx + 1} of {QUIZ.length}</small>Q{idx + 1}. {item!.q}</p>
          {item!.opts.map((o, i) => {
            const reveal = picked !== null
            const isCorrect = reveal && i === item!.correct
            const isWrong = reveal && i === picked && i !== item!.correct
            return (
              <button key={i} type="button" onClick={() => answer(i)} data-key={KEYS[i]}
                aria-disabled={reveal}
                // display:block stays inline: scripts/smoke-funzone.py finds options by it.
                style={{ display: 'block', '--i': i } as CSSProperties}
                className={cx('quiz-opt', isCorrect && 'right', isWrong && 'wrong')}>{o}</button>
            )
          })}
        </div>
      )}
    </Stage>
  )
}

// ── Spin the Wheel ──────────────────────────────────────────────
const PRIZES = ['Free Coffee ☕','Shoutout 📣','Extra Break ⏰','High-Five 🙌','WFH Day 🏠','Snack Treat 🍪']
const SEG = 360 / PRIZES.length
const SEG_COLOURS = ['#7C3AED', '#DB2777', '#0F766E', '#C2410C', '#1D4ED8', '#B45309']
const WHEEL_BG = `conic-gradient(${SEG_COLOURS.map((c, i) => `${c} ${i * SEG}deg ${(i + 1) * SEG}deg`).join(',')})`
function SpinWheel({ onBack }: { onBack: () => void }) {
  const [deg, setDeg] = useState(0)
  const [spinning, setSpinning] = useState(false)
  const [result, setResult] = useState('')
  const [spins, setSpins] = useState(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const spin = () => {
    if (spinning) return
    setSpinning(true); setResult('')
    // Rotation accumulates instead of restarting from 0, so a second spin never
    // animates backwards. The prize is read off where it stops — nothing is picked
    // in advance, so the wheel genuinely decides.
    const next = deg + (5 + Math.random() * 3) * 360 + Math.random() * 360
    setDeg(next)
    timer.current = setTimeout(() => {
      const resting = (360 - (next % 360)) % 360
      setResult(PRIZES[Math.floor(resting / SEG)])
      setSpinning(false); setSpins(s => s + 1)
    }, 4100)
  }

  return (
    <Stage cat="social" icon="🎡" title="Spin the Wheel" sub="Tap spin for today's surprise"
           onBack={onBack} confetti={result ? spins : 0}>
      <div className="wheel-box" style={{ margin: '18px 0 8px' }}>
        <div className={cx('wheel-rim', spinning && 'fast')} aria-hidden="true">
          {Array.from({ length: 18 }, (_, k) => <i key={k} style={{ '--r': `${k * 20}deg`, '--k': k % 2 } as CSSProperties} />)}
        </div>
        <div className={cx('wheel-pin', spinning && 'tick')} aria-hidden="true" />
        <div className="wheel" style={{ transform: `rotate(${deg}deg)`, background: WHEEL_BG }}>
          {PRIZES.map((p, i) => (
            // Label sits along the segment's centre line, pointing outwards.
            <div key={p} style={{ transform: `rotate(${i * SEG + SEG / 2 - 90}deg)` }}>{p.split(' ')[0]}</div>
          ))}
        </div>
        <div className="wheel-hub" aria-hidden="true">{result ? result.split(' ').pop() : '🎁'}</div>
      </div>
      <button type="button" onClick={spin} disabled={spinning} className="fz-key lg">
        {spinning ? 'Spinning…' : 'Spin!'}
      </button>
      <div role="status" aria-live="polite">
        {result && (
          <div className="prize-card">
            <small>You got:</small>
            <span className="p">{result}</span>
          </div>
        )}
      </div>
    </Stage>
  )
}

// ── Hub ─────────────────────────────────────────────────────────
/**
 * The hub, and the mode each game is played in.
 *
 * Every original game asks HOW before it starts, rather than one card meaning
 * "solo" and a separate card meaning "with somebody". Which modes exist
 * differs per game and the screen says so: the wheel is a solo spin and
 * there is nothing for a second player or a bot to do, so it opens straight
 * into the game instead of offering a choice it cannot honour.
 *
 * The ten mind games follow the wheel's rule for the same reason — each is a
 * solo game with one way to play, so they open straight in.
 *
 * `employeeId` is optional so the solo and bot modes still work for a caller
 * that has not got one — only inviting a colleague needs to know who you are.
 */
type Mode = 'solo' | 'bot' | 'live'

interface ModeDef { k: Mode; label: string; hint: string }

const MODE_ICON: Record<Mode, string> = { bot: '🤖', solo: '🎮', live: '🤝' }

const MODES: Record<string, ModeDef[]> = {
  ttt: [
    { k: 'bot',  label: 'Against the computer', hint: 'Three difficulties. Hard is unbeatable — a draw is the best there is.' },
    { k: 'solo', label: 'Two players, one screen', hint: 'Pass the device back and forth.' },
    { k: 'live', label: 'With a colleague', hint: 'Invite somebody and play on two screens.' },
  ],
  mem: [
    { k: 'bot',  label: 'Against the computer', hint: 'It remembers what it has seen — more of it on harder settings.' },
    { k: 'solo', label: 'On your own', hint: 'Find all eight pairs. Nothing is timed.' },
    { k: 'live', label: 'With a colleague', hint: 'Take turns on two screens.' },
  ],
  quiz: [
    { k: 'bot',  label: 'Against the computer', hint: 'It answers too, and it does not always know.' },
    { k: 'solo', label: 'On your own', hint: 'Four questions, no opponent.' },
    { k: 'live', label: 'With a colleague', hint: 'Head to head on the same questions.' },
  ],
  wheel: [],
  // every mind game: no modes, opens straight in
}

type Filter = 'all' | 'live' | Category

const FILTERS: { k: Filter; label: string }[] = [
  { k: 'all', label: 'All' },
  { k: 'live', label: 'With a colleague' },
  { k: 'puzzle', label: 'Puzzle' },
  { k: 'memory', label: 'Memory' },
  { k: 'logic', label: 'Logic' },
  { k: 'brain', label: 'Brain' },
  { k: 'words', label: 'Words' },
  { k: 'reflex', label: 'Reflex' },
]

const matches = (t: Tile, f: Filter) =>
  f === 'all' ? true : f === 'live' ? !!t.live : t.cat === f

function GameTile({ t, i, onOpen }: { t: Tile; i: number; onOpen: (k: string) => void }) {
  return (
    <button type="button" onClick={() => onOpen(t.k)}
      className={cx('fz-tile', `cat-${t.cat}`)} style={{ '--i': i } as CSSProperties}>
      <span className="scr"><span className="glyph">{t.icon}</span></span>
      <span className="lbl">
        <span className="name">{t.name}</span>
        <span className="desc">{t.desc}</span>
        <span className="tags">
          <span className="fz-tag">{t.badge}</span>
          {t.bot && <span className="fz-tag plain">🤖 Bot</span>}
          {t.live && <span className="fz-tag plain">🤝 Live</span>}
        </span>
      </span>
    </button>
  )
}

const TITLE = 'Fun Zone'.split('')

function Hub({ employeeId, onOpen }: { employeeId?: string; onOpen: (k: string) => void }) {
  const [filter, setFilter] = useState<Filter>('all')
  const shown = useMemo(() => ALL_TILES.filter(t => matches(t, filter)), [filter])
  const surprise = () => {
    const pool = shown.length ? shown : ALL_TILES
    onOpen(pool[Math.floor(Math.random() * pool.length)].k)
  }
  const count = (f: Filter) => ALL_TILES.filter(t => matches(t, f)).length

  return (
    <div className="fz-view">
      <div className="fz-hero">
        <div className="fz-hero-row">
          <div>
            <h1 className="fz-title" aria-label="Fun Zone">
              {TITLE.map((ch, i) => (
                <span key={i} aria-hidden="true" className={ch === ' ' ? 'sp' : undefined}
                      style={{ '--i': i } as CSSProperties}>{ch}</span>
              ))}
            </h1>
            <p className="fz-blurb">
              Take a break. Play on your own, against the computer, or with a colleague
              on two screens — nothing here is scored towards anything.
            </p>
          </div>
          <div>
            <button type="button" className="fz-key lg" onClick={surprise}>
              <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <rect x="2.5" y="2.5" width="15" height="15" rx="3.5" stroke="currentColor" strokeWidth="2" />
                <circle cx="7" cy="7" r="1.4" fill="currentColor" /><circle cx="13" cy="13" r="1.4" fill="currentColor" />
                <circle cx="10" cy="10" r="1.4" fill="currentColor" />
              </svg>
              Surprise me
            </button>
            <div className="fz-hero-meta">{ALL_TILES.length} games, {GAMES.filter(g => g.live).length} of them live</div>
          </div>
        </div>
        <div className="fz-chips" role="group" aria-label="Show games">
          {FILTERS.map(f => (
            <button key={f.k} type="button" className="fz-chip" aria-pressed={filter === f.k}
                    onClick={() => setFilter(f.k)}>
              {f.label} <span className="n">{count(f.k)}</span>
            </button>
          ))}
        </div>
      </div>

      {filter === 'all' ? (
        <>
          <div className="fz-shelf">
            <div className="fz-shelf-h">
              <h3>Classics</h3>
              <p>On your own, against the computer, or head to head with a colleague{employeeId ? '' : ' once you are signed in'}.</p>
            </div>
            <div className="fz-grid big">
              {GAMES.map((t, i) => <GameTile key={t.k} t={t} i={i} onOpen={onOpen} />)}
            </div>
          </div>
          <div className="fz-shelf">
            <div className="fz-shelf-h">
              <h3>Mind games</h3>
              <p>Quick solo puzzles for a five-minute break.</p>
            </div>
            <div className="fz-grid">
              {MIND_TILES.map((t, i) => <GameTile key={t.k} t={t} i={i + 4} onOpen={onOpen} />)}
            </div>
          </div>
        </>
      ) : (
        <div className="fz-shelf">
          <div className="fz-grid" key={filter}>
            {shown.map((t, i) => <GameTile key={t.k} t={t} i={i} onOpen={onOpen} />)}
          </div>
        </div>
      )}
      <p className="fz-foot">Scores reset when you leave a game. Nothing here is saved or ranked.</p>
    </div>
  )
}

function ModeScreen({ game, employeeId, onPick, onBack }: {
  game: string; employeeId?: string; onPick: (m: Mode) => void; onBack: () => void
}) {
  const g = GAMES.find(x => x.k === game)!
  const opts = (MODES[game] ?? []).filter(m => m.k !== 'live' || employeeId)
  return (
    <Stage cat={g.cat} icon={g.icon} title={g.name} sub="How do you want to play?" onBack={onBack}>
      <div className="fz-modes">
        {opts.map((m, i) => (
          <button key={m.k} type="button" className="fz-mode" onClick={() => onPick(m.k)}
                  style={{ '--i': i } as CSSProperties}>
            <span className="ic" aria-hidden="true">{MODE_ICON[m.k]}</span>
            <span className="label">{m.label}</span>
            <span className="hint">{m.hint}</span>
          </button>
        ))}
      </div>
      {!employeeId && (
        <div className="signin-note">
          Playing with a colleague needs you to be signed in to ESS.
        </div>
      )}
    </Stage>
  )
}

export default function FunZone({ employeeId }: { employeeId?: string }) {
  const [game, setGame] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode | null>(null)
  const back = () => { setGame(null); setMode(null) }
  const backToModes = () => setMode(null)
  const top = useRef<HTMLDivElement>(null)

  // Every screen change starts at the top of the panel, not wherever the
  // hub was scrolled to.
  useEffect(() => {
    const el = top.current
    if (!el || typeof el.getBoundingClientRect !== 'function') return
    if (el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: 'start' })
  }, [game, mode])

  let screen: ReactNode

  if (game === 'wheel') {
    // The wheel has no modes — opening it opens the game.
    screen = <SpinWheel onBack={back} />
  } else if (game && MIND_GAMES.some(m => m.code === game)) {
    // Nor do the mind games.
    screen = <MindGame code={game} onBack={back} />
  } else if (game && !mode) {
    screen = <ModeScreen game={game} employeeId={employeeId} onPick={setMode} onBack={back} />
  } else if (game && mode) {
    const g = GAMES.find(x => x.k === game)!
    if (mode === 'live' && employeeId) {
      screen = (
        <Stage cat={g.cat} icon="🤝" title="Play together"
               sub="Invite a colleague and play on two screens, live." onBack={backToModes}
               bodyClass="left">
          <div className="fz-live"><PlayTogether meId={employeeId} /></div>
        </Stage>
      )
    } else if (mode === 'bot' && game === 'ttt')  screen = <TicTacToeVsBot onBack={backToModes} />
    else if (mode === 'bot' && game === 'mem')    screen = <MemoryVsBot onBack={backToModes} />
    else if (mode === 'bot' && game === 'quiz')   screen = <TriviaVsBot onBack={backToModes} />
    else if (game === 'ttt')  screen = <TicTacToe onBack={backToModes} />
    else if (game === 'mem')  screen = <MemoryMatch onBack={backToModes} />
    else if (game === 'quiz') screen = <Trivia onBack={backToModes} />
  }

  return (
    <div className="fz" ref={top}>
      <FzStyles />
      {screen ?? <Hub employeeId={employeeId} onOpen={k => { setGame(k); setMode(null) }} />}
    </div>
  )
}

