'use client'
// components/learning/game/GamePanel.tsx — the points part of Achievements: level, streak, this
// week, where the points came from, every badge, and the leaderboard.
import { useCallback, useEffect, useState } from 'react'
import { lmsApi } from '@/lib/lms/client'
import { cached, remember } from '../app/cache'
import { Ring, Skel } from '../shared'
import { CountUp } from '../motion/CountUp'
import { GameIcon } from './icons'
import { Badges } from './Badges'
import { Leaderboard } from './Leaderboard'
import { GAME_KEY, type GameFull } from './data'
import './game.css'

const KEY = 'game:full'

export function GamePanel() {
  const [g, setG] = useState<GameFull | null>(() => cached<GameFull>(KEY))
  const [failed, setFailed] = useState(false)
  const load = useCallback(() => {
    lmsApi<GameFull>('/api/lms/me/game?board=week').then(x => {
      setG(remember(KEY, x)); setFailed(false)
      // The full answer holds everything the top bar shows, so the chip catches up too.
      if (x.enabled) remember(GAME_KEY, x)
    }).catch(() => setFailed(true))
  }, [])
  useEffect(() => { load() }, [load])

  // Points are a bonus on this page: switched off, or not reachable, the rest of it still shows.
  if (failed && !g) return null
  if (!g) return <div style={{ display: 'grid', gap: 14 }}><Skel h={26} w={220} /><div className="lx-gsum">{[0, 1, 2, 3].map(i => <Skel key={i} h={104} r={18} />)}</div></div>
  if (!g.enabled) return null

  const lv = g.level
  const weekPct = Math.min(100, Math.round((g.week.xp / Math.max(1, g.week.goal)) * 100))
  return (
    <>
      <section>
        <div className="lx-sec-head"><div><h2 className="lx-sec-title">Points &amp; badges</h2><div className="lx-sec-sub">Earned from what you finish: lessons, quizzes, courses, live sessions and paths</div></div></div>
        <div style={{ display: 'grid', gap: 14 }}>
          <div className="lx-gsum">
            <div className="lx-gsum-level lx-in">
              <Ring pct={lv.pct} size={76} stroke={7} text={<span className="lx-num">{lv.level}</span>} label="Level progress" />
              <div style={{ minWidth: 0, flex: 1 }}>
                <h3>Level {lv.level} · {lv.name}</h3>
                <p className="lx-num">{g.xp.toLocaleString('en-IN')} XP · {lv.need.toLocaleString('en-IN')} XP to level {lv.level + 1}</p>
                <span className="lx-bar"><i style={{ width: `${lv.pct}%` }} /></span>
              </div>
            </div>
            <div className="lx-kpi lx-in" data-t="gold"><i><GameIcon name="flame" size={20} /></i><b className="lx-num"><CountUp value={g.streak.current} /></b><span>Day streak · best {g.streak.best}</span></div>
            <div className="lx-kpi lx-in"><i><GameIcon name="bolt" size={20} /></i><b className="lx-num"><CountUp value={g.week.xp} /></b><span>XP this week · goal {g.week.goal} ({weekPct}%)</span></div>
            <div className="lx-kpi lx-in" data-t="positive"><i><GameIcon name="trophy" size={20} /></i><b className="lx-num"><CountUp value={g.badges_earned} /></b><span>Badges of {g.badges_total}</span></div>
          </div>
          {g.breakdown.length > 0 && (
            <div className="lx-gbreak" aria-label="Where your points came from">
              {g.breakdown.map(b => <span key={b.kind}>{b.label} · {b.count} · <b className="lx-num">{b.xp.toLocaleString('en-IN')} XP</b></span>)}
            </div>
          )}
          <Badges badges={g.badges} />
        </div>
      </section>

      {g.leaderboard && g.board?.enabled && (
        <section>
          <div className="lx-sec-head"><div><h2 className="lx-sec-title">Leaderboard</h2><div className="lx-sec-sub">Points earned in the period, across the company or within your department</div></div></div>
          <Leaderboard initial={g.board} />
        </section>
      )}
    </>
  )
}
