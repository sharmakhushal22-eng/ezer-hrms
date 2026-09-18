'use client'
// components/funzone/ui.tsx — the pieces every Fun Zone screen is built from.
//
// Presentation only. Nothing here knows a rule or a player; the games pass in
// what to show. Declared at module scope, as this repo requires, so a
// re-render never remounts them.
//
// Styling lives in design/funzone.css, shipped to the browser as
// FZ_CSS (fzStyles.ts) and injected once by <FzStyles/>.

import { useEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react'
import { FZ_CSS } from './fzStyles'
import type { Difficulty } from '@/lib/funzone/ai'
import { DIFFICULTY_LABEL, DIFFICULTY_MEANING } from '@/lib/funzone/ai'

export type Cat =
  | 'arcade' | 'quiz' | 'social' | 'puzzle' | 'memory'
  | 'reflex' | 'words' | 'brain' | 'logic'

/** Injected once, at the Fun Zone root. A <style> element rather than a
 *  global import so the component drops into the portal with no build or
 *  layout change. */
export function FzStyles() {
  return <style data-fz="funzone">{FZ_CSS}</style>
}

export const cx = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(' ')

const Chevron = () => (
  <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

export function BackBtn({ onClick, label = 'Back' }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" className="fz-back" onClick={onClick}>
      <Chevron /><span>{label}</span>
    </button>
  )
}

/**
 * The panel every game sits on: a coloured header with the game's identity
 * and its live numbers, and a body. `onBack` is optional because the bot
 * and live screens used to be wrapped by the hub instead.
 */
export function Stage({ cat, icon, title, sub, aside, onBack, children, bodyClass, confetti }: {
  cat: Cat
  icon: string
  title: string
  sub?: ReactNode
  aside?: ReactNode
  onBack?: () => void
  children: ReactNode
  bodyClass?: string
  /** Bump this number to fire one burst of confetti. 0 fires nothing. */
  confetti?: number
}) {
  return (
    <section className={cx('fz-stage fz-view', `cat-${cat}`)}>
      {!!confetti && <Confetti key={confetti} />}
      <header className="fz-stage-top">
        {onBack && <BackBtn onClick={onBack} />}
        <div className="fz-stage-id">
          <span className="glyph" aria-hidden="true">{icon}</span>
          <div>
            <h2>{title}</h2>
            {sub && <p>{sub}</p>}
          </div>
        </div>
        {aside && <div className="fz-stage-aside">{aside}</div>}
      </header>
      <div className={cx('fz-stage-body', bodyClass)}>{children}</div>
    </section>
  )
}

/** A number with a label. `bump` replays a small pop whenever `value` changes. */
export function Stat({ label, value, hot, bump }: {
  label: string; value: ReactNode; hot?: boolean; bump?: boolean
}) {
  const [n, setN] = useState(0)
  const first = useRef(true)
  useEffect(() => {
    if (first.current) { first.current = false; return }
    if (bump) setN(x => x + 1)
  }, [value, bump])
  return (
    <span className={cx('fz-stat', hot && 'hot', n > 0 && 'bump')} key={n}>
      <b>{value}</b><span>{label}</span>
    </span>
  )
}

/** The one line that says what is happening. `aria-live` so a screen reader
 *  hears the result without hunting for it. Re-keyed on text to replay the pop. */
export function Status({ text, tone, busy }: {
  text: string; tone?: 'win' | 'lose' | 'draw'; busy?: boolean
}) {
  return (
    <div className={cx('fz-status', tone, tone && 'pop')} key={text} role="status" aria-live="polite">
      {busy && <span className="pulse" aria-hidden="true" />}
      {text}
    </div>
  )
}

const CONFETTI = ['#8B5CF6', '#F59E0B', '#14B8A6', '#EC4899', '#3B82F6', '#22C55E', '#F97316']

/** A single burst, positions derived from the index rather than Math.random()
 *  so server and browser render the same markup. */
export function Confetti() {
  return (
    <div className="fz-confetti" aria-hidden="true">
      {Array.from({ length: 36 }, (_, i) => {
        const style = {
          '--x': `${(i * 37) % 100}%`,
          '--c': CONFETTI[i % CONFETTI.length],
          '--d': `${1.3 + ((i * 7) % 10) / 10}s`,
          '--w': `${((i * 13) % 10) / 25}s`,
          '--dx': `${((i * 29) % 120) - 60}px`,
          '--r': `${((i * 53) % 720) - 360}deg`,
        } as CSSProperties
        return <i key={i} style={style} />
      })}
    </div>
  )
}

const LEVELS: Difficulty[] = ['easy', 'medium', 'hard']

/** Same props and the same copy as the old pill row; now a sliding switch. */
export function DifficultyBar({ level, onPick }: {
  level: Difficulty; onPick: (d: Difficulty) => void
}) {
  const pos = LEVELS.indexOf(level)
  return (
    <div className="fz-seg">
      <div className="fz-seg-track" role="group" aria-label="Difficulty"
           style={{ '--pos': pos } as CSSProperties}>
        <span className="fz-seg-thumb" aria-hidden="true" />
        {LEVELS.map(d => (
          <button key={d} type="button" onClick={() => onPick(d)} aria-pressed={d === level}>
            {DIFFICULTY_LABEL[d]}
          </button>
        ))}
      </div>
      <div className="fz-seg-note">{DIFFICULTY_MEANING[level]}</div>
    </div>
  )
}

/** Head-to-head scoreboard. `turn` lights the side whose move it is. */
export function VsBar({ left, right, turn, mid = 'vs' }: {
  left: { who: string; pts: number }
  right: { who: string; pts: number }
  turn?: 'left' | 'right' | null
  mid?: string
}) {
  return (
    <div className="fz-vs">
      <div className={cx('side', turn === 'left' && 'on')}>
        <span className="pts">{left.pts}</span><span className="who">{left.who}</span>
      </div>
      <span className="mid">{mid}</span>
      <div className={cx('side', turn === 'right' && 'on')}>
        <span className="pts">{right.pts}</span><span className="who">{right.who}</span>
      </div>
    </div>
  )
}

/** setTimeout that cleans up after itself when the screen goes away. */
export function useTimers() {
  const ids = useRef<ReturnType<typeof setTimeout>[]>([])
  useEffect(() => () => { ids.current.forEach(clearTimeout) }, [])
  // One object for the life of the screen, so it is safe in a dependency list.
  const api = useRef({
    after(ms: number, fn: () => void) {
      const id = setTimeout(fn, ms); ids.current.push(id); return id
    },
    clear() { ids.current.forEach(clearTimeout); ids.current = [] },
  })
  return api.current
}

/** A countdown in whole seconds that runs while `running` is true. */
export function useCountdown(seconds: number, running: boolean, onEnd: () => void) {
  const [left, setLeft] = useState(seconds)
  const end = useRef(onEnd); end.current = onEnd
  useEffect(() => { if (!running) setLeft(seconds) }, [running, seconds])
  useEffect(() => {
    if (!running) return
    const started = Date.now()
    const t = setInterval(() => {
      const l = Math.max(0, seconds - Math.floor((Date.now() - started) / 1000))
      setLeft(l)
      if (l === 0) { clearInterval(t); end.current() }
    }, 200)
    return () => clearInterval(t)
  }, [running, seconds])
  return left
}
