'use client'
// components/learning/game/GameChip.tsx — points where people see them every day: the streak and
// level in the top bar, and the live tile on Home.
//
// Both read one shared answer (./data.ts) and draw nothing until it arrives, when the company has
// switched points off, or when the request fails: a missing streak is better than an error in the
// top bar. Everything shown is worked out from the learning record (lib/lms/game-core.ts).
import { useEffect, useState } from 'react'
import { linkProps, to } from '../app/router'
import { Ring } from '../shared'
import { useReducedMotion } from '../motion/useInView'
import { CountUp } from '../motion/CountUp'
import { GameIcon } from './icons'
import { useGameLite, type GameLite } from './data'
import './game.css'

const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

/** Flame, streak days and level, opening Achievements. */
export function GameChip() {
  const g = useGameLite()
  if (!g) return null
  const s = g.streak
  const label = `${s.current ? `${plural(s.current, 'day')} learning streak` : 'No streak yet'}. Level ${g.level.level}, ${g.level.name}, ${g.xp} points. Open achievements.`
  return (
    <a className="lx-gchip" data-hot={s.current > 0 ? '1' : '0'} data-today={s.today ? '1' : '0'} aria-label={label} title={label} {...linkProps(to.achievements())}>
      <span className="lx-gchip-flame"><GameIcon name="flame" size={16} /><b className="lx-num">{s.current}</b></span>
      <span className="lx-gchip-lv lx-num">
        <span>Lv {g.level.level}</span>
        <i aria-hidden><i style={{ width: `${g.level.pct}%` }} /></i>
      </span>
    </a>
  )
}

/** What the tile says next, one line at a time. */
function facts(g: GameLite): string[] {
  const out: string[] = []
  out.push(`${g.level.need} XP to level ${g.level.level + 1}`)
  if (g.streak.best > 1) out.push(`Best streak: ${plural(g.streak.best, 'day')}`)
  out.push(`${g.badges_earned} of ${g.badges_total} badges earned`)
  if (g.month_xp) out.push(`${g.month_xp} XP this month`)
  if (g.today_xp) out.push(`${g.today_xp} XP earned today`)
  return out
}

/** The Home tile: the streak, today's state, this week's days and goal, the level ring, and a
 *  line that turns over every few seconds (held still for anyone who asks for less motion). */
export function GameTile() {
  const g = useGameLite()
  const reduce = useReducedMotion()
  const [at, setAt] = useState(0)
  // Monday is 0, in IST. Read once: the tile is not left open across midnight often enough to matter.
  const [todayIdx] = useState(() => (new Date(Date.now() + 330 * 60_000).getUTCDay() + 6) % 7)
  const lines = g ? facts(g) : []
  useEffect(() => {
    if (reduce || lines.length < 2) return
    const t = setInterval(() => setAt(i => i + 1), 4200)
    return () => clearInterval(t)
  }, [reduce, lines.length])
  if (!g) return null

  const s = g.streak
  const status = s.today ? 'Done for today. Your streak is safe.'
    : s.current ? `Learn today to keep your ${plural(s.current, 'day')} going.`
    : 'Finish a lesson today to start a streak.'
  const weekPct = Math.min(100, Math.round((g.week.xp / Math.max(1, g.week.goal)) * 100))
  const line = lines.length ? lines[at % lines.length] : ''
  return (
    <section className="lx-gtile lx-in" aria-label="Your points and streak">
      <div className="lx-gtile-head">
        <div className="lx-gtile-streak" data-hot={s.current > 0 ? '1' : '0'} data-today={s.today ? '1' : '0'}>
          <span className="lx-gtile-flame" aria-hidden><GameIcon name="flame" size={30} /></span>
          <span>
            <b className="lx-num"><CountUp value={s.current} /></b>
            <small>day streak</small>
          </span>
        </div>
        <a className="lx-gtile-level" {...linkProps(to.achievements())} aria-label={`Level ${g.level.level}, ${g.level.name}. ${g.level.pct}% of the way to the next level.`}>
          <Ring pct={g.level.pct} size={58} stroke={5} text={<span className="lx-num">{g.level.level}</span>} label="Level progress" />
          <span><b>{g.level.name}</b><small className="lx-num">{g.xp.toLocaleString('en-IN')} XP</small></span>
        </a>
      </div>
      <p className="lx-gtile-status" data-ok={s.today ? '1' : '0'}>{status}</p>
      <div className="lx-gtile-week" role="list" aria-label="Days you learned this week">
        {g.week.days.map((on, i) => (
          <span key={i} role="listitem" data-on={on ? '1' : '0'} data-today={i === todayIdx ? '1' : '0'} title={`${DAY_NAMES[i]}: ${on ? 'learned' : 'no learning'}`}>
            {on ? <GameIcon name="check" size={12} /> : DAY_LETTERS[i]}
          </span>
        ))}
      </div>
      <div className="lx-gtile-goal">
        <div><span>Weekly goal</span><b className="lx-num">{g.week.xp} / {g.week.goal} XP</b></div>
        <span className="lx-bar" data-done={weekPct >= 100 ? '1' : '0'}><i style={{ width: `${weekPct}%` }} /></span>
      </div>
      <div className="lx-gtile-foot">
        <span key={line} className="lx-gtile-fact" aria-live="off">{line}</span>
        <a className="lx-sec-link" {...linkProps(to.achievements())}>Badges</a>
      </div>
    </section>
  )
}
