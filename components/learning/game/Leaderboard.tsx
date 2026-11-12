'use client'
// components/learning/game/Leaderboard.tsx — the top ten for this week, this month or all time,
// across the company or within the learner's department, and the learner's own place even when
// they are not in the ten. When the company hides names, colleagues show by department only.
import { useCallback, useEffect, useRef, useState } from 'react'
import { lmsApi } from '@/lib/lms/client'
import { cached, remember } from '../app/cache'
import { Skel, errorWords } from '../shared'
import { GameIcon } from './icons'
import type { Board, BoardRow } from './data'
import './game.css'

type Period = Board['period']
type Scope = Board['scope']
const PERIODS: { k: Period; label: string }[] = [{ k: 'week', label: 'This week' }, { k: 'month', label: 'This month' }, { k: 'all', label: 'All time' }]

function Row({ r }: { r: BoardRow }) {
  return (
    <li className="lx-gboard-row" data-me={r.me ? '1' : '0'} data-top={r.rank && r.rank <= 3 ? String(r.rank) : undefined}>
      <span className="lx-gboard-rank lx-num" aria-label={r.rank ? `Rank ${r.rank}` : 'Not ranked yet'}>{r.rank ?? '–'}</span>
      <span className="lx-gboard-av" aria-hidden>{r.initials || <GameIcon name="star" size={14} />}</span>
      <span className="lx-gboard-who">
        <b>{r.name}{r.me && <span className="lx-tag lx-tag--brand" style={{ marginLeft: 8, height: 19, fontSize: 10.5 }}>You</span>}</b>
        {r.department && <small>{r.department}</small>}
      </span>
      <span className="lx-gboard-xp lx-num">{r.xp.toLocaleString('en-IN')} <small>XP</small></span>
    </li>
  )
}

const keyOf = (p: Period, s: Scope) => `game:board:${p}:${s}`

export function Leaderboard({ initial }: { initial?: Board | null }) {
  const [period, setPeriod] = useState<Period>(initial?.period || 'week')
  const [scope, setScope] = useState<Scope>(initial?.scope || 'company')
  const [board, setBoard] = useState<Board | null>(() => (initial && initial.period === period && initial.scope === scope ? initial : cached<Board>(keyOf(period, scope))))
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)
  // Only the answer for what is chosen now may land: a slow reply to an earlier tab is dropped.
  const want = useRef(keyOf(period, scope))
  const fetchBoard = useCallback((p: Period, s: Scope) => {
    const key = keyOf(p, s)
    return lmsApi<{ board: Board }>(`/api/lms/me/game?board=${p}&scope=${s}&only=board`)
      .then(x => { remember(key, x.board); if (want.current === key) { setBoard(x.board); setErr('') } })
      .catch(e => { if (want.current === key) setErr(errorWords(e)) })
      .finally(() => { if (want.current === key) setLoading(false) })
  }, [])
  useEffect(() => { void fetchBoard(period, scope) }, [fetchBoard, period, scope])
  useEffect(() => { if (initial) remember(keyOf(initial.period, initial.scope), initial) }, [initial])
  // A switch shows what this tab already has for it, or keeps the last board (dimmed) until the
  // answer lands, so the list never collapses to a skeleton and back.
  const pick = (p: Period, s: Scope) => {
    if (p === period && s === scope) return
    want.current = keyOf(p, s)
    setPeriod(p); setScope(s); setLoading(true); setErr('')
    setBoard(b => cached<Board>(keyOf(p, s)) || b)
  }
  const retry = () => { setErr(''); setLoading(true); void fetchBoard(period, scope) }

  if (board && !board.enabled) return null
  const meOutside = board?.me && !board.rows.some(r => r.me)
  return (
    <div className="lx-gboard">
      <div className="lx-gboard-bar">
        <div className="lx-tabs" role="tablist" aria-label="Period">
          {PERIODS.map(p => <button key={p.k} role="tab" aria-selected={period === p.k} onClick={() => pick(p.k, scope)}>{p.label}</button>)}
        </div>
        <div className="lx-tabs" role="tablist" aria-label="Who to compare with">
          <button role="tab" aria-selected={scope === 'company'} onClick={() => pick(period, 'company')}>Company</button>
          <button role="tab" aria-selected={scope === 'department'} onClick={() => pick(period, 'department')}>My department</button>
        </div>
      </div>
      {err && !board && <div className="lx-problem" role="alert"><span style={{ flex: 1 }}>{err}</span><button className="lx-btn lx-btn--sm" onClick={retry}>Try again</button></div>}
      {!board ? (
        <div style={{ display: 'grid', gap: 8 }}>{[0, 1, 2, 3].map(i => <Skel key={i} h={52} r={12} />)}</div>
      ) : (
        <div className="lx-panel" data-stale={loading && (board.period !== period || (board.scope !== scope && !(scope === 'department' && board.scope === 'company'))) ? '1' : '0'} aria-busy={loading}>
          {!loading && scope === 'department' && board.scope === 'company' && <p className="lx-gboard-note">Your department is not set, so this shows the whole company.</p>}
          {board.rows.length ? (
            <ol className="lx-gboard-list">
              {board.rows.map((r, i) => <Row key={`${r.rank}-${i}`} r={r} />)}
              {meOutside && <li className="lx-gboard-gap" aria-hidden>···</li>}
              {meOutside && <Row r={board.me} />}
            </ol>
          ) : (
            <p className="lx-gboard-note">Nobody has earned points {period === 'week' ? 'this week' : period === 'month' ? 'this month' : 'yet'}. Finish a lesson to be first on the board.</p>
          )}
          <p className="lx-gboard-foot lx-num">
            {board.me.rank ? `You are ${ordinal(board.me.rank)} of ${board.ranked} ${board.ranked === 1 ? 'person' : 'people'} with points` : 'Earn points to appear on the board'}
            {` · ${board.people} ${board.scope === 'department' ? `in ${board.department || 'your department'}` : 'in the company'}`}
            {!board.names && ' · names are hidden by your company'}
          </p>
        </div>
      )}
    </div>
  )
}

function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`
}
