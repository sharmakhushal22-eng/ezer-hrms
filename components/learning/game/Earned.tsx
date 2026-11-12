'use client'
// components/learning/game/Earned.tsx — on the course-complete screen: the points earned today,
// the level, and any badge earned today. Asks again rather than reading the cache, since the
// course has only just finished. Draws nothing when points are off or nothing was earned today
// (someone opening a course they finished last month), and nothing on a candidate's pre-joining
// link (/learn/<token>), which has no Achievements page to send them to.
import { useEffect, useState } from 'react'
import { linkProps, to } from '../app/router'
import { GameIcon } from './icons'
import { refreshGame, type GameLite } from './data'
import './game.css'

export function Earned() {
  const [g, setG] = useState<GameLite | null>(null)
  useEffect(() => {
    if (window.location.pathname.startsWith('/learn/')) return
    let live = true
    refreshGame().then(v => { if (live && v?.enabled) setG(v) })
    return () => { live = false }
  }, [])
  if (!g || g.today_xp <= 0) return null
  return (
    <section className="lx-gearned lx-in" aria-label="Points earned">
      <b className="lx-num">+{g.today_xp} XP</b>
      <span style={{ fontSize: 13.5, color: 'var(--ez-ink-soft)', flex: '1 1 200px' }}>
        earned today · level {g.level.level}, {g.level.name}{g.streak.current ? ` · ${g.streak.current}-day streak` : ''}
      </span>
      {g.badges_today.map(b => <span key={b.id} className="lx-tag lx-tag--gold"><GameIcon name={b.icon} size={13} /> {b.name}</span>)}
      <a className="lx-sec-link" {...linkProps(to.achievements())}>Your badges</a>
    </section>
  )
}
