'use client'
// components/learning/showcase/LiveTiles.tsx — tiles that keep changing while you look at them:
// the next live session counting down, what was just added turning over one course at a time,
// and categories whose artwork cycles through their courses. All of it holds still for anyone
// who asked for less motion and while the tab is in the background.
import { useEffect, useState } from 'react'
import { lmsApi } from '@/lib/lms/client'
import { linkProps, to } from '../app/router'
import { cached, remember } from '../app/cache'
import { CourseArt, hueOf, plural } from '../shared'
import { GCalendar, GLive, GSparkle } from '../glyphs'
import type { CatCourse } from '../CourseCard'
import { usePageVisible, useReducedMotion } from '../motion/useInView'
import './showcase.css'

/** A counter that moves on every `ms`, starting `offset` into the cycle so tiles side by side
 *  never turn together. It stops while the tab is hidden or motion is reduced. */
export function useTicker(ms: number, offset = 0): number {
  const [n, setN] = useState(0)
  const reduce = useReducedMotion()
  const visible = usePageVisible()
  useEffect(() => {
    if (reduce || !visible) return
    let iv: ReturnType<typeof setInterval> | null = null
    const t = setTimeout(() => { setN(x => x + 1); iv = setInterval(() => setN(x => x + 1), ms) }, ms + offset)
    return () => { clearTimeout(t); if (iv) clearInterval(iv) }
  }, [ms, offset, reduce, visible])
  return n
}

interface LiveSession { id: string; title: string; host_name: string | null; starts_at: string; phase: string; can_join: boolean; course_title: string | null; me: { registered: boolean } | null; room_enabled?: boolean }

function parts(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000))
  return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60) }
}

/** The next live session, counting down, or live now. */
export function NextLiveTile() {
  const [data, setData] = useState<{ upcoming: LiveSession[] } | null>(() => (typeof window === 'undefined' ? null : cached('live')))
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { lmsApi<{ upcoming: LiveSession[] }>('/api/lms/me/sessions').then(x => setData(remember('live', x))).catch(() => {}) }, [])
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t) }, [])
  const next = data?.upcoming?.[0]
  if (!data) return null
  if (!next) {
    return (
      <a className="lx-tile" {...linkProps(to.live())}>
        <div className="lx-tile-body">
          <div className="lx-tile-k" style={{ color: 'var(--ez-muted)' }}><GLive size={15} /> Live sessions</div>
          <div><div className="lx-tile-t">Nothing scheduled right now</div><div className="lx-tile-s" style={{ color: 'var(--ez-muted)' }}>Recordings of past sessions are on the Live sessions page.</div></div>
        </div>
      </a>
    )
  }
  const live = next.phase === 'live' || next.phase === 'joinable'
  const left = parts(new Date(next.starts_at).getTime() - now)
  const when = new Date(next.starts_at).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })
  return (
    <a className="lx-tile" {...linkProps(next.room_enabled && live ? to.room(next.id) : to.live(next.id))}>
      <div className="lx-tile-body">
        <div className="lx-tile-k" style={{ color: live ? 'var(--ez-critical)' : 'var(--ez-brand)' }}>
          {live ? <><i className="lx-live-dot" /> {next.phase === 'live' ? 'Live now' : 'Starting soon'}</> : <><GCalendar size={15} /> Next live session</>}
        </div>
        <div>
          <div className="lx-tile-t lx-clamp2">{next.title}</div>
          <div className="lx-tile-s" style={{ color: 'var(--ez-muted)', marginTop: 4 }}>{when} IST{next.host_name ? ` · ${next.host_name}` : ''}</div>
        </div>
        {live
          ? <span className="lx-btn lx-btn--primary lx-btn--sm" style={{ justifySelf: 'start' }}>{next.room_enabled ? 'Enter the room' : 'Join now'}</span>
          : <div className="lx-count lx-num" aria-label={`Starts in ${left.d} days, ${left.h} hours and ${left.m} minutes`}>
              <span><b>{left.d}</b><small>days</small></span><span><b>{left.h}</b><small>hrs</small></span><span><b>{left.m}</b><small>min</small></span>
            </div>}
      </div>
    </a>
  )
}

/** The newest courses, one at a time, rising into place. */
export function FreshTile({ courses }: { courses: CatCourse[] }) {
  const n = useTicker(4800, 900)
  if (!courses.length) return null
  const at = n % courses.length
  return (
    <a className="lx-tile lx-tile--pic" {...linkProps(to.course(courses[at].id))} aria-label={`Just added: ${courses[at].title}`}>
      {courses.map((c, i) => (
        <div key={c.id} className="lx-tile-face" data-on={i === at ? '1' : '0'} data-gone={i === (at - 1 + courses.length) % courses.length && courses.length > 1 ? '1' : '0'} aria-hidden={i !== at}>
          <CourseArt src={c.thumbnail} id={c.id} title={c.title} word={false} />
          <div className="lx-tile-k"><GSparkle size={13} /> Just added</div>
          <div className="lx-tile-t lx-clamp2">{c.title}</div>
          {c.summary && <div className="lx-tile-s lx-clamp1">{c.summary}</div>}
        </div>
      ))}
      {courses.length > 1 && <div className="lx-tile-dots" aria-hidden>{courses.map((c, i) => <i key={c.id} data-on={i === at ? '1' : '0'} />)}</div>}
    </a>
  )
}

/** One category whose picture turns over through its own courses. */
function CategoryTile({ id, name, courses, offset }: { id: string; name: string; courses: CatCourse[]; offset: number }) {
  const n = useTicker(5200, offset)
  const pics = courses.slice(0, 5)
  const at = pics.length ? n % pics.length : 0
  return (
    <a className="lx-cat lx-cat--live" data-h={hueOf(id)} {...linkProps(to.catalog({ cat: id }))}>
      {pics.map((c, i) => (
        <div key={c.id} className="lx-cat-pic" data-on={i === at ? '1' : '0'} aria-hidden><CourseArt src={c.thumbnail} id={c.id} title={c.title} word={false} /></div>
      ))}
      <b>{name}</b><span className="lx-num">{plural(courses.length, 'course')}</span>
    </a>
  )
}

export function CategoryTiles({ categories, courses }: { categories: { id: string; name: string }[]; courses: CatCourse[] }) {
  const list = categories.map(x => ({ ...x, courses: courses.filter(c => c.category_id === x.id) })).filter(x => x.courses.length)
  if (!list.length) return null
  return (
    <div className="lx-cats lx-cats--live">
      {list.map((x, i) => <CategoryTile key={x.id} id={x.id} name={x.name} courses={x.courses} offset={(i * 1300) % 5200} />)}
    </div>
  )
}
