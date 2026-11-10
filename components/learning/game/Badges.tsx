'use client'
// components/learning/game/Badges.tsx — every badge, earned or not. An earned one says when; one
// still to earn shows how far along it is, so the next goal is always in sight.
import { dayWords } from '../shared'
import { GameIcon } from './icons'
import type { Badge } from './data'
import './game.css'

export function Badges({ badges }: { badges: Badge[] }) {
  // Earned first, most recent first; then the ones closest to being earned.
  const list = [...badges].sort((a, b) =>
    (a.earned_at ? 0 : 1) - (b.earned_at ? 0 : 1)
    || (a.earned_at && b.earned_at ? b.earned_at.localeCompare(a.earned_at) : b.progress / b.target - a.progress / a.target))
  return (
    <div className="lx-gbadges" role="list">
      {list.map(b => {
        const pct = Math.round((b.progress / b.target) * 100)
        return (
          <div key={b.id} role="listitem" className="lx-gbadge lx-in" data-on={b.earned_at ? '1' : '0'}
            aria-label={`${b.name}: ${b.description}. ${b.earned_at ? `Earned ${dayWords(b.earned_at)}` : `${b.progress} of ${b.target}`}`}>
            <span className="lx-gbadge-medal" aria-hidden><GameIcon name={b.icon} size={24} /></span>
            <span className="lx-gbadge-body">
              <b>{b.name}</b>
              <small>{b.description}</small>
              {b.earned_at
                ? <em className="lx-num">Earned {dayWords(b.earned_at)}</em>
                : <span className="lx-gbadge-prog"><span className="lx-bar"><i style={{ width: `${pct}%` }} /></span><span className="lx-num">{b.progress}/{b.target}</span></span>}
            </span>
          </div>
        )
      })}
    </div>
  )
}
