'use client'
// components/funzone/MindGames.tsx — the ten solo mind games (Sep 2026).
//
// Screens and timers only. Every rule is in lib/funzone/mindgames.ts, pure and
// tested. Nothing here calls the network or the database: like the original
// solo games, leaving a screen forgets it, and no score is kept anywhere.
//
// Each game opens straight in — there is one way to play it, so the hub
// skips the mode screen exactly as it does for the wheel.
//
// Every component is declared at module scope (no remount, no focus loss).

import { useState, useEffect, useRef, useCallback, type CSSProperties, type ReactNode, type ComponentType } from 'react'
import {
  mindGameByCode, type MindCode, type Dir,
  newTiles, slideTiles, spawnTile, tilesStuck, tilesWon, TILES_GOAL,
  echoExtend, echoCheck, echoStepMs,
  reflexWait, reflexVerdict, average, REFLEX_ROUNDS,
  scrambleDeck, scramble, normaliseWord, SCRAMBLE_SECONDS, type WordItem,
  slideShuffle, slideMove, slideSolved, slideAdjacent,
  makeSum, SPRINT_SECONDS, type Sum,
  clashCard, CLASH_COLOURS, CLASH_ROUNDS, type ClashCard,
  newCode, scoreGuess, CODE_COLOURS, CODE_LENGTH, CODE_TRIES,
  lightsPuzzle, lightsPress, lightsOut,
  layMines, mineCounts, openSquare, minesCleared, MINES_SIZE, MINES_COUNT,
} from '@/lib/funzone/mindgames'
import { Stage, Stat, Status, cx, useTimers, useCountdown, type Cat } from './ui'

const rand = () => Math.random()

type Props = { onBack: () => void }

/** The stage, pre-filled from the catalogue so every game reads the same. */
function Frame({ code, onBack, aside, children, confetti, sub }: {
  code: MindCode; onBack: () => void; aside?: ReactNode; children: ReactNode
  confetti?: number; sub?: ReactNode
}) {
  const g = mindGameByCode(code)!
  return (
    <Stage cat={g.cat as Cat} icon={g.icon} title={g.name} sub={sub ?? g.how}
           onBack={onBack} aside={aside} confetti={confetti}>
      {children}
    </Stage>
  )
}

// ═════════════════════════════════════════════════════════════════════════
// 2048
// ═════════════════════════════════════════════════════════════════════════

const ARROWS: Record<string, Dir> = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  w: 'up', s: 'down', a: 'left', d: 'right',
}

function Tiles({ onBack }: Props) {
  const [grid, setGrid] = useState<number[]>(() => newTiles(rand))
  const [score, setScore] = useState(0)
  const [best, setBest] = useState(0)
  const [fresh, setFresh] = useState<number>(-1)
  const [merged, setMerged] = useState<number[]>([])
  const [stamp, setStamp] = useState(0)
  const [keepGoing, setKeepGoing] = useState(false)
  const [round, setRound] = useState(1)
  const touch = useRef<{ x: number; y: number } | null>(null)

  const won = tilesWon(grid) && !keepGoing
  const stuck = tilesStuck(grid)

  const move = useCallback((dir: Dir) => {
    if (tilesStuck(grid) || (tilesWon(grid) && !keepGoing)) return
    const r = slideTiles(grid, dir)
    if (!r.moved) return
    const s = spawnTile(r.grid, rand)
    const nx = score + r.gained
    setGrid(s.grid); setFresh(s.at); setMerged(r.merged); setStamp(n => n + 1)
    setScore(nx); setBest(b => Math.max(b, nx))
  }, [grid, score, keepGoing])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return
      const d = ARROWS[e.key]
      if (!d) return
      e.preventDefault(); move(d)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [move])

  const restart = () => {
    setGrid(newTiles(rand)); setScore(0); setFresh(-1); setMerged([]); setKeepGoing(false); setRound(r => r + 1)
  }

  const onDown = (e: React.PointerEvent) => { touch.current = { x: e.clientX, y: e.clientY } }
  const onUp = (e: React.PointerEvent) => {
    const t = touch.current; touch.current = null
    if (!t) return
    const dx = e.clientX - t.x, dy = e.clientY - t.y
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return
    move(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'))
  }

  const top = Math.max(...grid)
  return (
    <Frame code="tiles" onBack={onBack} confetti={won ? round : 0}
      aside={<><Stat label="score" value={score} hot bump /><Stat label="best" value={best} /></>}>
      <Status text={won ? `You made ${TILES_GOAL}!` : stuck ? `No moves left — top tile ${top}` : `Top tile ${top}`}
              tone={won ? 'win' : stuck ? 'lose' : undefined} />
      <div className="t48" onPointerDown={onDown} onPointerUp={onUp} role="grid" aria-label="2048 board">
        {grid.map((v, i) => (
          <div key={`${i}-${v}-${v && (i === fresh || merged.includes(i)) ? stamp : 0}`}
               role="gridcell" data-v={v || undefined} data-big={v > 2048 || undefined}
               className={cx(v > 0 && i === fresh && 'new', merged.includes(i) && 'merged')}>
            {v || ''}
          </div>
        ))}
      </div>
      <div className="fz-row">
        <div className="dpad" aria-label="Move">
          <button type="button" className="fz-key soft sm u" onClick={() => move('up')} aria-label="Up">▲</button>
          <button type="button" className="fz-key soft sm l" onClick={() => move('left')} aria-label="Left">◀</button>
          <button type="button" className="fz-key soft sm d" onClick={() => move('down')} aria-label="Down">▼</button>
          <button type="button" className="fz-key soft sm r" onClick={() => move('right')} aria-label="Right">▶</button>
        </div>
        <div className="fz-row" style={{ flexDirection: 'column' }}>
          {won && <button type="button" className="fz-key soft" onClick={() => setKeepGoing(true)}>Keep going</button>}
          <button type="button" className="fz-key" onClick={restart}>New game</button>
        </div>
      </div>
    </Frame>
  )
}

// ═════════════════════════════════════════════════════════════════════════
// ECHO
// ═════════════════════════════════════════════════════════════════════════

const PAD_NAMES = ['Violet', 'Teal', 'Amber', 'Pink']

function Echo({ onBack }: Props) {
  const [seq, setSeq] = useState<number[]>([])
  const [phase, setPhase] = useState<'idle' | 'show' | 'input' | 'over'>('idle')
  const [at, setAt] = useState(0)
  const [lit, setLit] = useState<number | null>(null)
  const [best, setBest] = useState(0)
  const [shake, setShake] = useState(0)
  const t = useTimers()

  const play = useCallback((s: number[]) => {
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
    : phase === 'input' ? `Your turn — step ${at + 1} of ${seq.length}`
    : `Missed. You reached ${seq.length - 1}.`

  return (
    <Frame code="simon" onBack={onBack}
      aside={<><Stat label="round" value={seq.length} hot bump /><Stat label="best" value={best} /></>}>
      <Status text={text} busy={phase === 'show'} tone={phase === 'over' ? 'lose' : undefined} />
      <div className={cx('echo', shake > 0 && phase === 'over' && 'shake')} key={shake}>
        {PAD_NAMES.map((n, i) => (
          <button key={n} type="button" aria-label={n} disabled={phase !== 'input'}
            className={cx('echo-pad', lit === i && 'lit')} onClick={() => tap(i)} />
        ))}
        <div className="echo-core" aria-hidden="true"><div><b>{seq.length}</b><span>STEPS</span></div></div>
      </div>
      <button type="button" className="fz-key" onClick={start} disabled={phase === 'show' || phase === 'input'}>
        {phase === 'idle' ? 'Start' : 'Play again'}
      </button>
    </Frame>
  )
}

// ═════════════════════════════════════════════════════════════════════════
// QUICK DRAW
// ═════════════════════════════════════════════════════════════════════════

function QuickDraw({ onBack }: Props) {
  const [phase, setPhase] = useState<'ready' | 'wait' | 'go' | 'early' | 'result' | 'done'>('ready')
  const [times, setTimes] = useState<number[]>([])
  const [last, setLast] = useState(0)
  const [best, setBest] = useState<number | null>(null)
  const goAt = useRef(0)
  const t = useTimers()

  const arm = () => {
    setPhase('wait')
    t.after(reflexWait(rand), () => { goAt.current = performance.now(); setPhase('go') })
  }

  const press = () => {
    if (phase === 'ready' || phase === 'early' || phase === 'result') { arm(); return }
    if (phase === 'done') { setTimes([]); arm(); return }
    if (phase === 'wait') { t.clear(); setPhase('early'); return }
    if (phase === 'go') {
      const ms = Math.round(performance.now() - goAt.current)
      const all = [...times, ms]
      setTimes(all); setLast(ms)
      setBest(b => (b === null ? ms : Math.min(b, ms)))
      setPhase(all.length >= REFLEX_ROUNDS ? 'done' : 'result')
    }
  }

  const avg = average(times)
  const face: Record<typeof phase, [string, string]> = {
    ready:  ['Tap to start', `${REFLEX_ROUNDS} rounds. Wait for green.`],
    wait:   ['Wait…', 'Not yet'],
    go:     ['TAP!', 'Now'],
    early:  ['Too soon', 'That was a false start — tap to try again'],
    result: [`${last} ms`, `${reflexVerdict(last)} · tap for round ${times.length + 1}`],
    done:   [`${avg} ms`, `Average of ${REFLEX_ROUNDS} · ${reflexVerdict(avg)} · tap to go again`],
  }

  return (
    <Frame code="reflex" onBack={onBack} confetti={phase === 'done' && avg < 300 ? times.length + avg : 0}
      aside={<><Stat label="round" value={`${Math.min(times.length + (phase === 'done' ? 0 : 1), REFLEX_ROUNDS)}/${REFLEX_ROUNDS}`} />
               <Stat label="best ms" value={best ?? '—'} hot /></>}>
      <button type="button" className={cx('reflex', phase)} onPointerDown={press}
              onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); press() } }}>
        <b>{face[phase][0]}</b><span>{face[phase][1]}</span>
      </button>
      <div className="splits" aria-label="Your times">
        {times.map((ms, i) => (
          <span key={i} className={cx(ms === Math.min(...times) && 'best')}>{ms} ms</span>
        ))}
      </div>
      <div className="fz-hint">Keyboard: focus the panel and press Space.</div>
    </Frame>
  )
}

// ═════════════════════════════════════════════════════════════════════════
// PAYROLL SCRAMBLE
// ═════════════════════════════════════════════════════════════════════════

function Scramble({ onBack }: Props) {
  const [phase, setPhase] = useState<'ready' | 'play' | 'done'>('ready')
  const [deck, setDeck] = useState<WordItem[]>([])
  const [idx, setIdx] = useState(0)
  const [mix, setMix] = useState('')
  const [guess, setGuess] = useState('')
  const [score, setScore] = useState(0)
  const [skipped, setSkipped] = useState<string | null>(null)
  const [good, setGood] = useState(false)
  const [round, setRound] = useState(0)
  const input = useRef<HTMLInputElement>(null)
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
          <div className={cx('timebar', left <= 10 && 'low')} aria-hidden="true">
            <i style={{ '--p': `${left / SCRAMBLE_SECONDS * 100}%` } as CSSProperties} />
          </div>
          <div className="tiles-row" key={`${idx}-${mix}`} aria-label={`Letters ${mix.split('').join(' ')}`}>
            {mix.split('').map((c, i) => (
              <span key={i} className={cx('ltile', used[i] && 'used')} style={{ '--i': i } as CSSProperties}>{c}</span>
            ))}
          </div>
          <div className="fz-hint">Hint: {word.hint} · {word.word.length} letters</div>
          <input ref={input} className={cx('fz-input', good && 'ok')} value={guess}
                 onChange={e => onType(e.target.value)} aria-label="Your answer"
                 autoComplete="off" autoCapitalize="characters" spellCheck={false}
                 maxLength={word.word.length + 2} />
          <div className="fz-row">
            <button type="button" className="fz-key soft sm" onClick={skip}>Skip word</button>
          </div>
          {skipped && <div className="fz-hint">Last one was {skipped}.</div>}
        </>
      ) : phase === 'done' ? (
        <>
          <div className="fz-result">
            <span className="big">{score}</span>
            <span className="what">{score === 1 ? 'word' : 'words'} in {SCRAMBLE_SECONDS} seconds</span>
            {word && <span className="sub">The last word was {word.word}.</span>}
          </div>
          <button type="button" className="fz-key" onClick={start}>Play again</button>
        </>
      ) : (
        <>
          <div className="tiles-row">{'PAYROLL'.split('').map((c, i) => (
            <span key={i} className="ltile" style={{ '--i': i } as CSSProperties}>{c}</span>))}
          </div>
          <div className="fz-hint">You get {SCRAMBLE_SECONDS} seconds. Type each word — it moves on by itself when it is right.</div>
          <button type="button" className="fz-key lg" onClick={start}>Start</button>
        </>
      )}
    </Frame>
  )
}

// ═════════════════════════════════════════════════════════════════════════
// SLIDE PUZZLE
// ═════════════════════════════════════════════════════════════════════════

function SlidePuzzle({ onBack }: Props) {
  const [tiles, setTiles] = useState<number[]>(() => slideShuffle(rand))
  const [moves, setMoves] = useState(0)
  const [best, setBest] = useState<number | null>(null)
  const [round, setRound] = useState(1)
  const solved = slideSolved(tiles)

  const tap = (i: number) => {
    if (solved) return
    const next = slideMove(tiles, i)
    if (next === tiles) return
    setTiles(next)
    const m = moves + 1
    setMoves(m)
    if (slideSolved(next)) setBest(b => (b === null ? m : Math.min(b, m)))
  }
  const restart = () => { setTiles(slideShuffle(rand)); setMoves(0); setRound(r => r + 1) }
  const gap = tiles.indexOf(0)

  // Tiles are rendered in VALUE order so each keeps its element and glides.
  return (
    <Frame code="slide" onBack={onBack} confetti={solved ? round : 0}
      aside={<><Stat label="moves" value={moves} hot bump /><Stat label="best" value={best ?? '—'} /></>}>
      <Status text={solved ? `Solved in ${moves} moves` : 'Tiles next to the gap can move'} tone={solved ? 'win' : undefined} />
      <div className="slide" role="group" aria-label="Slide puzzle">
        {[1, 2, 3, 4, 5, 6, 7, 8].map(v => {
          const at = tiles.indexOf(v)
          return (
            <button key={v} type="button" className={cx('slide-t', at === v - 1 && 'home')}
              disabled={solved || !slideAdjacent(at, gap)}
              onClick={() => tap(at)}
              aria-label={`Tile ${v}${at === v - 1 ? ', in place' : ''}`}
              style={{ '--x': at % 3, '--y': Math.floor(at / 3) } as CSSProperties}>{v}</button>
          )
        })}
      </div>
      <button type="button" className="fz-key" onClick={restart}>Shuffle</button>
    </Frame>
  )
}

// ═════════════════════════════════════════════════════════════════════════
// MATH SPRINT
// ═════════════════════════════════════════════════════════════════════════

function MathSprint({ onBack }: Props) {
  const [phase, setPhase] = useState<'ready' | 'play' | 'done'>('ready')
  const [sum, setSum] = useState<Sum | null>(null)
  const [solved, setSolved] = useState(0)
  const [typed, setTyped] = useState('')
  const [best, setBest] = useState(0)
  const [round, setRound] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const left = useCountdown(SPRINT_SECONDS, phase === 'play', () => setPhase('done'))

  useEffect(() => { if (phase === 'done') setBest(b => Math.max(b, solved)) }, [phase, solved])

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
          <div className={cx('timebar', left <= 10 && 'low')} aria-hidden="true">
            <i style={{ '--p': `${left / SPRINT_SECONDS * 100}%` } as CSSProperties} />
          </div>
          <div className="fz-hint">{left} seconds left</div>
          <div className="sum flash" key={sum.text + solved} aria-live="polite">{sum.text} = ?</div>
          <input ref={input} className="fz-input" value={typed} inputMode="numeric"
                 onChange={e => onType(e.target.value)} aria-label="Answer" autoComplete="off" />
          <div className="numpad">
            {['7', '8', '9', '4', '5', '6', '1', '2', '3', '0', '⌫'].map(d => (
              <button key={d} type="button" className={cx('fz-key soft', d === '0' && 'zero')} onClick={() => key(d)}
                      aria-label={d === '⌫' ? 'Delete' : d}>{d}</button>
            ))}
          </div>
        </>
      ) : phase === 'done' ? (
        <>
          <div className="fz-result">
            <span className="big">{solved}</span>
            <span className="what">solved in {SPRINT_SECONDS} seconds</span>
            <span className="sub">{solved >= best && solved > 0 ? 'Your best this session.' : `Best this session: ${best}`}</span>
          </div>
          <button type="button" className="fz-key" onClick={start}>Play again</button>
        </>
      ) : (
        <>
          <div className="sum">12 + 7 = ?</div>
          <div className="fz-hint">Sums start easy and get harder the more you solve. No minus answers.</div>
          <button type="button" className="fz-key lg" onClick={start}>Start</button>
        </>
      )}
    </Frame>
  )
}

// ═════════════════════════════════════════════════════════════════════════
// COLOUR CLASH
// ═════════════════════════════════════════════════════════════════════════

function ColourClash({ onBack }: Props) {
  const [phase, setPhase] = useState<'ready' | 'play' | 'done'>('ready')
  const [card, setCard] = useState<ClashCard | null>(null)
  const [n, setN] = useState(0)
  const [right, setRight] = useState(0)
  const [streak, setStreak] = useState(0)
  const [wrong, setWrong] = useState(false)
  const [ms, setMs] = useState<number[]>([])
  const shownAt = useRef(0)

  const deal = () => { setCard(clashCard(rand)); shownAt.current = performance.now() }
  const start = () => { setN(0); setRight(0); setStreak(0); setMs([]); setWrong(false); setPhase('play'); deal() }

  const pick = (k: number) => {
    if (!card || phase !== 'play') return
    const ok = k === card.ink
    setMs(x => [...x, performance.now() - shownAt.current])
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
          <div className="fz-hint">Card {n + 1} of {CLASH_ROUNDS} — tap the colour of the ink</div>
          <div className={cx('clash-word', `ink-${CLASH_COLOURS[card.ink].key}`, wrong && 'shake')}
               key={n} aria-label={`The word ${CLASH_COLOURS[card.word].name}`}>
            {CLASH_COLOURS[card.word].name.toUpperCase()}
          </div>
          <div className="swatches">
            {CLASH_COLOURS.map((c, k) => (
              <button key={c.key} type="button" className={cx('swatch', `ink-${c.key}`)} onClick={() => pick(k)}>
                <i aria-hidden="true" /><span>{c.name}</span>
              </button>
            ))}
          </div>
        </>
      ) : phase === 'done' ? (
        <>
          <div className="fz-result">
            <span className="big">{right}/{CLASH_ROUNDS}</span>
            <span className="what">right, averaging {(average(ms) / 1000).toFixed(2)} s a card</span>
            <span className="sub">{right === CLASH_ROUNDS ? 'Not fooled once.' : 'The word tries to win. The ink is the answer.'}</span>
          </div>
          <button type="button" className="fz-key" onClick={start}>Play again</button>
        </>
      ) : (
        <>
          <div className="clash-word ink-blue">RED</div>
          <div className="fz-hint">That one is <b>Blue</b>. {CLASH_ROUNDS} cards — be quick and be right.</div>
          <button type="button" className="fz-key lg" onClick={start}>Start</button>
        </>
      )}
    </Frame>
  )
}

// ═════════════════════════════════════════════════════════════════════════
// CODE BREAKER
// ═════════════════════════════════════════════════════════════════════════

const PEG_NAMES = ['Red', 'Blue', 'Green', 'Yellow', 'Purple', 'Orange']

type CodeRow = { pegs: number[]; exact: number; near: number }

function GuessRow({ i, row, live, cur }: { i: number; row?: CodeRow; live: boolean; cur: number[] }) {
  const pegs = row ? row.pegs : live ? cur : []
  return (
    <div className={cx('cb-row', live && 'now')}>
      <span className="n">{i + 1}</span>
      <div className="cb-pegs">
        {Array.from({ length: CODE_LENGTH }, (_, k) => (
          <span key={k} className="peg" data-c={pegs[k] ?? undefined}
                aria-label={pegs[k] !== undefined ? PEG_NAMES[pegs[k]] : 'empty'} />
        ))}
      </div>
      <div className="keys" aria-label={row ? `${row.exact} exact, ${row.near} near` : undefined}>
        {row && Array.from({ length: CODE_LENGTH }, (_, k) => (
          <i key={k} className={k < row.exact ? 'x' : k < row.exact + row.near ? 'n' : ''} />
        ))}
      </div>
    </div>
  )
}

function CodeBreaker({ onBack }: Props) {
  const [code, setCode] = useState<number[]>(() => newCode(rand))
  const [rows, setRows] = useState<CodeRow[]>([])
  const [cur, setCur] = useState<number[]>([])
  const [round, setRound] = useState(1)
  const won = rows.some(r => r.exact === CODE_LENGTH)
  const lost = !won && rows.length >= CODE_TRIES
  const over = won || lost

  const add = (c: number) => { if (!over && cur.length < CODE_LENGTH) setCur([...cur, c]) }
  const undo = () => setCur(cur.slice(0, -1))
  const submit = () => {
    if (over || cur.length !== CODE_LENGTH) return
    setRows([...rows, { pegs: cur, ...scoreGuess(code, cur) }]); setCur([])
  }
  const restart = () => { setCode(newCode(rand)); setRows([]); setCur([]); setRound(r => r + 1) }

  return (
    <Frame code="codebreak" onBack={onBack} confetti={won ? round : 0}
      aside={<Stat label="tries left" value={CODE_TRIES - rows.length} hot bump />}>
      <Status text={won ? `Cracked in ${rows.length} ${rows.length === 1 ? 'try' : 'tries'}` : lost ? 'Out of tries' : `Guess ${rows.length + 1} of ${CODE_TRIES}`}
              tone={won ? 'win' : lost ? 'lose' : undefined} />
      {over && (
        <div className="cb-row" style={{ gridTemplateColumns: 'auto 1fr' }}>
          <span className="n">Code</span>
          <div className="cb-pegs">{code.map((c, k) => <span key={k} className="peg" data-c={c} aria-label={PEG_NAMES[c]} />)}</div>
        </div>
      )}
      <div className="cb">
        {Array.from({ length: CODE_TRIES }, (_, i) => (
          <GuessRow key={i} i={i} row={rows[i]} cur={cur} live={i === rows.length && !over} />
        ))}
      </div>
      {!over && (
        <>
          <div className="palette">
            {Array.from({ length: CODE_COLOURS }, (_, c) => (
              <button key={c} type="button" data-c={c} aria-label={PEG_NAMES[c]}
                      disabled={cur.length >= CODE_LENGTH} onClick={() => add(c)} />
            ))}
          </div>
          <div className="fz-row">
            <button type="button" className="fz-key soft sm" onClick={undo} disabled={!cur.length}>Undo</button>
            <button type="button" className="fz-key" onClick={submit} disabled={cur.length !== CODE_LENGTH}>Check guess</button>
          </div>
        </>
      )}
      {over && <button type="button" className="fz-key" onClick={restart}>New code</button>}
      <div className="fz-hint">● right colour, right place · ○ right colour, wrong place. Colours can repeat.</div>
    </Frame>
  )
}

// ═════════════════════════════════════════════════════════════════════════
// LIGHTS OUT
// ═════════════════════════════════════════════════════════════════════════

function LightsOut({ onBack }: Props) {
  const [board, setBoard] = useState<boolean[]>(() => lightsPuzzle(rand))
  const [start, setStart] = useState<boolean[]>(board)
  const [moves, setMoves] = useState(0)
  const [round, setRound] = useState(1)
  const done = lightsOut(board)
  const lit = board.filter(Boolean).length

  const press = (i: number) => { if (!done) { setBoard(lightsPress(board, i)); setMoves(m => m + 1) } }
  const fresh = () => { const b = lightsPuzzle(rand); setBoard(b); setStart(b); setMoves(0); setRound(r => r + 1) }
  const retry = () => { setBoard(start); setMoves(0) }

  return (
    <Frame code="lights" onBack={onBack} confetti={done ? round : 0}
      aside={<><Stat label="lit" value={lit} hot bump /><Stat label="moves" value={moves} /></>}>
      <Status text={done ? `Lights out in ${moves} moves` : `${lit} ${lit === 1 ? 'light' : 'lights'} still on`} tone={done ? 'win' : undefined} />
      <div className="lo">
        {board.map((on, i) => (
          <button key={i} type="button" className={cx(on && 'on')} disabled={done}
                  onClick={() => press(i)} aria-label={`Light ${i + 1}, ${on ? 'on' : 'off'}`} aria-pressed={on} />
        ))}
      </div>
      <div className="fz-row">
        <button type="button" className="fz-key soft" onClick={retry} disabled={!moves}>Restart this one</button>
        <button type="button" className="fz-key" onClick={fresh}>New puzzle</button>
      </div>
    </Frame>
  )
}

// ═════════════════════════════════════════════════════════════════════════
// MINESWEEPER
// ═════════════════════════════════════════════════════════════════════════

const CELLS = MINES_SIZE * MINES_SIZE

function Minesweeper({ onBack }: Props) {
  const [mines, setMines] = useState<boolean[]>([])
  const [open, setOpen] = useState<boolean[]>(() => Array(CELLS).fill(false))
  const [flags, setFlags] = useState<boolean[]>(() => Array(CELLS).fill(false))
  const [boom, setBoom] = useState<number | null>(null)
  const [flagMode, setFlagMode] = useState(false)
  const [started, setStarted] = useState<number | null>(null)
  const [now, setNow] = useState(Date.now())
  const [round, setRound] = useState(1)

  const counts = mines.length ? mineCounts(mines) : []
  const won = mines.length > 0 && boom === null && minesCleared(mines, open)
  const over = won || boom !== null
  const flagged = flags.filter(Boolean).length

  useEffect(() => {
    if (started === null || over) return
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [started, over])
  const secs = started === null ? 0 : Math.floor(((over ? now : Date.now()) - started) / 1000)

  const flag = (i: number) => {
    if (over || open[i]) return
    const f = [...flags]; f[i] = !f[i]; setFlags(f)
  }
  const dig = (i: number) => {
    if (over || flags[i] || open[i]) return
    let m = mines
    if (!m.length) { m = layMines(i, rand); setMines(m); setStarted(Date.now()); setNow(Date.now()) }
    if (m[i]) { setBoom(i); setNow(Date.now()); return }
    const o = openSquare(m, open, flags, i)
    setOpen(o)
    if (minesCleared(m, o)) setNow(Date.now())
  }
  const tap = (i: number) => (flagMode ? flag(i) : dig(i))
  const restart = () => {
    setMines([]); setOpen(Array(CELLS).fill(false)); setFlags(Array(CELLS).fill(false))
    setBoom(null); setStarted(null); setRound(r => r + 1)
  }

  return (
    <Frame code="mines" onBack={onBack} confetti={won ? round : 0}
      aside={<><Stat label="mines left" value={MINES_COUNT - flagged} hot /><Stat label="seconds" value={secs} /></>}>
      <Status text={won ? `Field cleared in ${secs} s` : boom !== null ? 'Boom. That one was a mine.' : mines.length ? 'Right-click or use flag mode to mark a mine' : 'Tap anywhere to start — the first square is always safe'}
              tone={won ? 'win' : boom !== null ? 'lose' : undefined} />
      <div className="toggle" role="group" aria-label="Tap action">
        <button type="button" aria-pressed={!flagMode} onClick={() => setFlagMode(false)}>⛏ Dig</button>
        <button type="button" aria-pressed={flagMode} onClick={() => setFlagMode(true)}>🚩 Flag</button>
      </div>
      <div className={cx('ms', boom !== null && 'shake')}>
        {Array.from({ length: CELLS }, (_, i) => {
          const isOpen = open[i]
          const showMine = boom !== null && mines[i]
          const n = counts[i] ?? 0
          const label = isOpen ? (n ? String(n) : '') : showMine ? '💣' : flags[i] ? '🚩' : ''
          return (
            <button key={i} type="button" disabled={over && !isOpen}
              className={cx(isOpen && 'open', showMine && (i === boom ? 'boom' : 'mine'))}
              data-n={isOpen && n ? n : undefined}
              onClick={() => tap(i)}
              onContextMenu={e => { e.preventDefault(); flag(i) }}
              aria-label={`Row ${Math.floor(i / MINES_SIZE) + 1}, column ${i % MINES_SIZE + 1}: ${isOpen ? (n ? `${n} nearby` : 'clear') : flags[i] ? 'flagged' : 'hidden'}`}>
              {label}
            </button>
          )
        })}
      </div>
      <button type="button" className="fz-key" onClick={restart}>New field</button>
    </Frame>
  )
}

// ═════════════════════════════════════════════════════════════════════════

const SCREENS: Record<MindCode, ComponentType<Props>> = {
  tiles: Tiles, simon: Echo, reflex: QuickDraw, scramble: Scramble, slide: SlidePuzzle,
  sprint: MathSprint, clash: ColourClash, codebreak: CodeBreaker, lights: LightsOut, mines: Minesweeper,
}

/** Open one of the ten by its code. Unknown codes go back to the hub rather
 *  than rendering nothing. */
export function MindGame({ code, onBack }: { code: string; onBack: () => void }) {
  const Screen = SCREENS[code as MindCode]
  useEffect(() => { if (!Screen) onBack() }, [Screen, onBack])
  return Screen ? <Screen onBack={onBack} /> : null
}
