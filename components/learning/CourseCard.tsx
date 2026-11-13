'use client'
// components/learning/CourseCard.tsx — the two cards every Learn page is made of: a course in
// the catalogue, and a course someone is taking.
import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import { IconCheck } from '@/lib/ui'
import { linkProps, to } from './app/router'
import { keys, paths, prefetch } from './app/cache'
import { CourseArt, DueTag, IconStar, KindGlyph, LEVEL, STATUS, durationWords, plural, type LearnItem } from './shared'
import { GArrowRight, GClock, GLayers, GPlay, GUsers } from './glyphs'
import { hover, watchInView, type Preview } from './showcase/preview'

export interface Mine { id: string; status: string; progress_pct?: number; completed_at?: string | null; expires_at?: string | null }
export interface CatCourse {
  id: string; code?: string; title: string; summary: string | null; category_id: string | null; difficulty: string | null; est_minutes: number | null
  tags: string[] | null; skills: string[] | null; enrolment_mode: string; is_compliance: boolean; is_featured: boolean
  thumbnail: string | null; rating: number | null; ratings: number; mine: Mine | null; recommended_score?: number
  lesson_count?: number; quiz_count?: number; kinds?: string[]; learners?: number; published_at?: string | null
  /** The clip it plays on hover: a window into one video file (lib/lms/showcase-core.ts). */
  preview?: Preview | null
  /** On My list since then. */
  saved_at?: string | null
}

const NEW_DAYS = 30
export const isNew = (c: CatCourse) => !!c.published_at && Date.now() - new Date(c.published_at).getTime() < NEW_DAYS * 86_400_000
const MODE_WORDS: Record<string, string> = { SELF: 'Open to enrol', APPROVAL: 'Manager approves', ASSIGN_ONLY: 'Assigned by HR' }

/** A plain click opens in the app; the caller may take over (an embedded portal does). */
function Shell({ href, onOpen, className, children, label, warm, style, grow }: {
  href: string; onOpen?: () => void; className: string; children: ReactNode; label: string; warm?: () => void; style?: CSSProperties
  /** The course this card grows into on hover (showcase/HoverLayer), with what the card knows about it. */
  grow?: { c: CatCourse; category?: string | null; rank?: number | null }
}) {
  const ref = useRef<HTMLElement | null>(null)
  const preview = grow?.c.preview
  // A card resting in view fetches its clip's index, so the clip starts quickly when hovered.
  useEffect(() => (ref.current ? watchInView(ref.current, preview) : undefined), [preview])
  useEffect(() => () => { if (ref.current) hover.leave(ref.current as HTMLElement) }, [])
  // Pointer on the card, or focus on it: start loading what it opens, so the click lands on data.
  const hints = {
    onPointerEnter: (e: React.PointerEvent<HTMLElement>) => {
      warm?.()
      if (grow && e.pointerType === 'mouse') hover.enter(grow.c, e.currentTarget, { category: grow.category, rank: grow.rank })
    },
    onPointerLeave: (e: React.PointerEvent<HTMLElement>) => { if (grow) hover.leave(e.currentTarget) },
    // A click opens the card's own link; the hover card has nothing more to say then.
    onClickCapture: () => { if (grow) hover.close() },
    ...(warm ? { onFocus: warm } : {}),
  }
  if (onOpen) return <button ref={el => { ref.current = el }} type="button" className={className} onClick={onOpen} aria-label={label} style={style} {...hints}>{children}</button>
  return <a ref={el => { ref.current = el }} className={className} {...linkProps(href)} aria-label={label} style={style} {...hints}>{children}</a>
}

export function CourseCard({ c, category, onOpen, delay, vt, rank }: {
  c: CatCourse; category?: string | null; onOpen?: () => void; delay?: number
  /** Its place in the Top 10, shown on the hover card. */
  rank?: number
  /** A view-transition name, unique on the screen, so the card glides to its new place when a filter changes. */
  vt?: string
}) {
  const st = c.mine ? STATUS[c.mine.status] : null
  const pct = Math.round(Number(c.mine?.progress_pct) || 0)
  const going = c.mine && ['IN_PROGRESS', 'NOT_STARTED', 'FAILED'].includes(c.mine.status)
  const kinds = (c.kinds || []).filter(k => k !== 'ASSESSMENT').slice(0, 4)
  return (
    <Shell href={to.course(c.id)} onOpen={onOpen} className={`lx-cc lx-in ${delay != null ? `lx-in-${Math.min(4, delay)}` : ''}`} label={c.title} warm={() => prefetch(keys.course(c.id), paths.course(c.id))} style={vt ? { viewTransitionName: vt } : undefined}
      grow={onOpen ? undefined : { c, category, rank }}>
      <CourseArt src={c.thumbnail} id={c.id} title={c.title} kind={kinds[0]}>
        <div className="lx-cc-badges">
          {c.is_featured && <span className="lx-tag lx-tag--gold">★ Featured</span>}
          {c.is_compliance && <span className="lx-tag lx-tag--glass">Compliance</span>}
          {isNew(c) && !c.mine && <span className="lx-tag lx-tag--glass">New</span>}
          {st && c.mine?.status === 'COMPLETED' && <span className="lx-tag lx-tag--positive" style={{ marginLeft: 'auto' }}><IconCheck size={11} /> Completed</span>}
        </div>
        <div className="lx-cc-play" aria-hidden><span><GPlay size={22} /></span></div>
        {c.preview && <span className="lx-cc-pv" aria-hidden><GPlay size={9} /> Preview</span>}
        {going && pct > 0 && <div className="lx-cc-prog"><i style={{ width: `${pct}%` }} /></div>}
      </CourseArt>
      <div className="lx-cc-body">
        {category && <div className="lx-cc-kicker">{category}</div>}
        <div className="lx-cc-title lx-clamp2">{c.title}</div>
        {c.summary && <div className="lx-cc-sum lx-clamp2">{c.summary}</div>}
        <div className="lx-cc-meta lx-num">
          {c.rating != null && <span className="lx-rating"><IconStar size={13} filled />{c.rating.toFixed(1)}<span style={{ color: 'var(--ez-muted)', fontWeight: 500 }}>({c.ratings})</span></span>}
          {!!c.est_minutes && <span><GClock size={13} />{durationWords(c.est_minutes)}</span>}
          {!!c.lesson_count && <span><GLayers size={13} />{plural(c.lesson_count, 'lesson')}</span>}
          {c.difficulty && <span>{LEVEL[c.difficulty]}</span>}
        </div>
      </div>
      <div className="lx-cc-foot">
        {kinds.map(k => <span key={k} title={k.toLowerCase()} style={{ color: 'var(--ez-muted)', display: 'inline-flex' }}><KindGlyph kind={k} size={15} /></span>)}
        {!!c.quiz_count && <span className="lx-tag" style={{ height: 20, fontSize: 11 }}>{plural(c.quiz_count, 'quiz', 'quizzes')}</span>}
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          {going ? <b style={{ color: 'var(--ez-brand)' }}>{pct ? `${pct}% done` : st?.label}</b>
            : c.mine?.status === 'PENDING_APPROVAL' ? <b style={{ color: 'var(--ez-warning)' }}>Requested</b>
            : c.learners ? <><GUsers size={13} /> {c.learners}</>
            : MODE_WORDS[c.enrolment_mode]}
        </span>
      </div>
    </Shell>
  )
}

/** A course someone is taking: where they are, what is due, and the one button that matters. */
export function LearnCard({ item, onOpen, readOnly, wide }: { item: LearnItem; onOpen?: () => void; readOnly?: boolean; wide?: boolean }) {
  const c = item.course
  const pct = Math.round(Number(item.progress_pct) || 0)
  const done = item.status === 'COMPLETED'
  const verb = readOnly ? 'View' : done ? 'Review' : item.status === 'IN_PROGRESS' ? 'Resume' : item.status === 'FAILED' ? 'Open' : 'Start'
  if (wide) {
    return (
      <Shell href={to.play(item.id)} onOpen={onOpen} warm={() => prefetch(keys.view(item.id), paths.view(item.id))} className={`lx-wc ${item.overdue ? 'lx-wc--late' : ''}`} label={`${verb} ${c?.title || 'course'}`}>
        <CourseArt src={c?.thumbnail} id={item.course_id} title={c?.title} word={false} />
        <span style={{ minWidth: 0, display: 'grid', gap: 8 }}>
          <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {item.mandatory && <span className="lx-tag lx-tag--brand">Mandatory</span>}
            {c?.is_compliance && <span className="lx-tag lx-tag--info">Compliance</span>}
            <DueTag dueAt={item.due_at} overdue={item.overdue} status={item.status} />
          </span>
          <span className="lx-cc-title lx-clamp2">{c?.title || 'Course'}</span>
          <span style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 10, alignItems: 'center' }}>
            <span className="lx-bar" data-done={done ? '1' : '0'}><i style={{ width: `${done ? 100 : pct}%` }} /></span>
            <span className="lx-num" style={{ fontSize: 12.5, color: 'var(--ez-muted)', fontWeight: 650 }}>{done ? 'Done' : `${pct}%`}</span>
          </span>
          <span className="lx-sec-link" style={{ padding: 0 }}>{verb} <GArrowRight size={14} /></span>
        </span>
      </Shell>
    )
  }
  return (
    <Shell href={to.play(item.id)} onOpen={onOpen} warm={() => prefetch(keys.view(item.id), paths.view(item.id))} className="lx-cc lx-in" label={`${verb} ${c?.title || 'course'}`}>
      <CourseArt src={c?.thumbnail} id={item.course_id} title={c?.title}>
        <div className="lx-cc-badges">
          {item.mandatory && <span className="lx-tag lx-tag--glass">Mandatory</span>}
          {item.overdue && <span className="lx-tag lx-tag--critical">Overdue</span>}
          {done && <span className="lx-tag lx-tag--positive"><IconCheck size={11} /> Completed</span>}
        </div>
        <div className="lx-cc-play" aria-hidden><span><GPlay size={22} /></span></div>
        {!done && pct > 0 && <div className="lx-cc-prog"><i style={{ width: `${pct}%` }} /></div>}
      </CourseArt>
      <div className="lx-cc-body">
        <div className="lx-cc-title lx-clamp2">{c?.title || 'Course'}</div>
        <div className="lx-cc-meta lx-num">
          {!!c?.est_minutes && <span><GClock size={13} />{durationWords(c.est_minutes)}</span>}
          {c?.difficulty && <span>{LEVEL[c.difficulty]}</span>}
          {c?.is_compliance && <span>Compliance</span>}
        </div>
        {!done && <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 10, alignItems: 'center', marginTop: 4 }}>
          <span className="lx-bar"><i style={{ width: `${pct}%` }} /></span>
          <span className="lx-num" style={{ fontSize: 12, color: 'var(--ez-muted)', fontWeight: 650 }}>{pct}%</span>
        </div>}
      </div>
      <div className="lx-cc-foot">
        <DueTag dueAt={item.due_at} overdue={item.overdue} status={item.status} />
        {done && item.score_pct != null && <span className="lx-num">Score {Number(item.score_pct)}%</span>}
        <b style={{ marginLeft: 'auto', color: 'var(--ez-brand)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>{verb} <GArrowRight size={13} /></b>
      </div>
    </Shell>
  )
}
