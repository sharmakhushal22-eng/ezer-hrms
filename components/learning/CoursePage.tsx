'use client'
// components/learning/CoursePage.tsx — one course, before and after enrolling: what it is, what
// you will learn, every lesson in it, how it is assessed and what completing it takes, and the
// one action that applies to you (enrol, ask, start, continue, retake).
//
// "What you will learn" comes from the course description: lines HR starts with a dash or a
// bullet become the checklist, and the rest stays as the description. No separate field.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { IconCheck, IconChevronDown, IconClose, IconLock } from '@/lib/ui'
import { lmsApi } from '@/lib/lms/client'
import { navigate, to } from './app/router'
import { cached, fetchInto, forget, keys, paths } from './app/cache'
import type { CatCourse } from './CourseCard'
import VideoPlayer from './VideoPlayer'
import PdfDeck from './PdfDeck'
import {
  CourseArt, IconStar, KIND_WORD, KindGlyph, LEVEL, Oops, Ring, STATUS, Skel, Stars, dayWords, durationWords, errorWords, plural, webUrl,
} from './shared'
import { GArrowLeft, GArrowRight, GCert, GClock, GLayers, GPlay, GTarget, GUsers } from './glyphs'
import { Aurora } from './motion/Aurora'
import { Clip } from './showcase/Clip'
import { usePreviewPrefs } from './showcase/preview'

interface Mine { id: string; status: string; progress_pct?: number }
interface OutlineLesson {
  id: string; title: string; kind: string; est_minutes: number | null; has_quiz: boolean; is_preview?: boolean; is_required?: boolean; is_final?: boolean
  require_ack?: boolean; duration_s?: number | null
  quiz?: { pass_pct: number; max_attempts: number | null; time_limit_minutes: number | null; questions: number; required: boolean } | null
}
interface OutlineModule { id: string; title: string; lessons: OutlineLesson[] }
interface Info {
  course: {
    id: string; code?: string; title: string; summary: string | null; description: string | null; difficulty: string | null; est_minutes: number | null; language: string | null
    skills: string[] | null; tags?: string[] | null; enrolment_mode: string; is_compliance: boolean; validity_months: number | null; certificate_enabled: boolean; thumbnail: string | null
    category?: string | null; learners?: number; published_at?: string | null; rating?: number | null; ratings?: number
  }
  rules?: { order_mode: string; completion_mode: string; completion_pct: number; require_all_quizzes: boolean; require_final: boolean; min_overall_pct: number | null } | null
  outline: OutlineModule[]; prerequisites: { id: string; title: string }[]; reviews: { rating: number; comment: string | null; created_at: string }[]; mine: Mine | null
}
interface Preview { id: string; title: string; summary: string | null; kind: string; url: string | null; poster: string | null; mime: string | null; file_name: string | null; body: string | null; external_url: string | null }

const ORDER: Record<string, string> = { SEQUENTIAL: 'Lessons open in order, one after another', MODULE_SEQUENTIAL: 'Each module opens when the one before it is done', FREE: 'Take the lessons in any order' }
const lengthWords = (s?: number | null, m?: number | null) => s ? (s >= 60 ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : `0:${String(Math.round(s)).padStart(2, '0')}`) : durationWords(m)

/** Bullet lines out of the description, and what is left. */
function splitDescription(text?: string | null) {
  const points: string[] = [], rest: string[] = []
  for (const line of String(text || '').split('\n')) {
    const m = /^\s*(?:[-*•✓✔]|\d+[.)])\s+(.+)$/.exec(line)
    if (m) points.push(m[1].trim()); else rest.push(line)
  }
  return { points, about: rest.join('\n').trim() }
}

function completionWords(r: NonNullable<Info['rules']>, quizzes: number, final: boolean): string[] {
  const out: string[] = []
  if (r.completion_mode === 'ALL_REQUIRED') out.push('Finish every required lesson')
  else if (r.completion_mode === 'PERCENT') out.push(`Finish at least ${r.completion_pct}% of the required lessons`)
  else if (r.completion_mode === 'FINAL_ONLY') out.push('Pass the final assessment')
  if (quizzes && r.require_all_quizzes) out.push('Pass every required quiz')
  if (r.require_final && final) out.push('Pass the final assessment')
  if (r.min_overall_pct != null) out.push(`Score at least ${r.min_overall_pct}% overall`)
  return [...new Set(out)]
}

function PreviewModal({ courseId, lesson, onClose }: { courseId: string; lesson: OutlineLesson; onClose: () => void }) {
  const [p, setP] = useState<Preview | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    lmsApi<Preview>(`/api/lms/me/catalog/${courseId}?preview=${lesson.id}`).then(setP).catch(e => setErr(errorWords(e)))
  }, [courseId, lesson.id])
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  const link = webUrl(p?.external_url)
  return (
    <div className="lx-modal" role="dialog" aria-modal="true" aria-label={`Preview: ${lesson.title}`} onClick={onClose}>
      <div className="lx-modal-box" onClick={e => e.stopPropagation()}>
        <div className="lx-modal-head">
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 750, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--lx-hero-c)' }}>Free preview</div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{lesson.title}</div>
          </div>
          <button className="lx-btn lx-btn--light lx-btn--icon lx-btn--sm" onClick={onClose} aria-label="Close the preview"><IconClose size={16} /></button>
        </div>
        {err ? <div style={{ padding: 20 }}><Oops message={err} /></div>
          : !p ? <div style={{ aspectRatio: '16 / 9', display: 'grid', placeItems: 'center' }}><div className="lx-vp-spin" style={{ position: 'static', margin: 0 }} /></div>
          : (p.kind === 'VIDEO' || p.kind === 'AUDIO') && p.url ? <VideoPlayer src={p.url} poster={p.poster} kind={p.kind as 'VIDEO' | 'AUDIO'} title={p.kind === 'AUDIO' ? p.title : undefined} globalKeys />
          : (p.kind === 'DOCUMENT' || p.kind === 'SLIDES') && p.url && (p.mime === 'application/pdf' || /\.pdf$/i.test(p.file_name || '')) ? <PdfDeck url={p.url} title={p.title} height="min(72vh, 680px)" />
          : p.kind === 'ARTICLE' ? <div style={{ padding: 24, background: 'var(--ez-canvas)' }}><article className="lx-article"><div>{p.body}</div></article></div>
          : link ? <div className="lx-gatecard"><a className="lx-btn lx-btn--white" href={link} target="_blank" rel="noopener noreferrer">Open the link</a></div>
          : <div className="lx-gatecard"><p>This preview cannot be shown here.</p></div>}
        <div style={{ padding: '12px 18px', fontSize: 13, color: 'var(--lx-on-stage-soft)' }}>Previews are not recorded. Enrol to take the whole course and have your progress saved.</div>
      </div>
    </div>
  )
}

function Curriculum({ outline, onPreview }: { outline: OutlineModule[]; onPreview: (l: OutlineLesson) => void }) {
  const [shut, setShut] = useState<Set<string>>(() => new Set(outline.slice(3).map(m => m.id)))
  const all = outline.every(m => !shut.has(m.id))
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button className="lx-sec-link" onClick={() => setShut(all ? new Set(outline.map(m => m.id)) : new Set())}>{all ? 'Collapse all' : 'Expand all'}</button>
      </div>
      <div className="lx-acc">
        {outline.map((m, i) => {
          const open = !shut.has(m.id)
          const mins = m.lessons.reduce((a, l) => a + (l.duration_s ? l.duration_s / 60 : l.est_minutes || 0), 0)
          return (
            <div key={m.id} className="lx-acc-mod">
              <button className="lx-acc-head" aria-expanded={open} onClick={() => setShut(s => { const x = new Set(s); if (x.has(m.id)) x.delete(m.id); else x.add(m.id); return x })}>
                <IconChevronDown size={18} />
                <span className="lx-acc-title">Module {i + 1}: {m.title}</span>
                <span className="lx-acc-meta lx-num">{plural(m.lessons.length, 'lesson')}{mins ? ` · ${durationWords(Math.round(mins))}` : ''}</span>
              </button>
              {/* Always rendered, so opening and closing can animate; inert while shut, so the
                  hidden rows are out of the tab order and away from screen readers. */}
              <div className="lx-acc-body" data-open={open ? '1' : '0'} inert={!open}><div>
              {m.lessons.map(l => (
                <div key={l.id} className="lx-acc-row">
                  <span className="lx-kind" data-k={l.kind}><KindGlyph kind={l.kind} size={15} /></span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', color: 'var(--ez-ink)', fontWeight: 550 }}>{l.title}</span>
                    <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 12.5, color: 'var(--ez-muted)', marginTop: 2 }}>
                      <span>{KIND_WORD[l.kind]}</span>
                      {l.quiz && l.kind !== 'ASSESSMENT' && <span style={{ color: 'var(--ez-brand)', fontWeight: 650 }}>+ quiz, {plural(l.quiz.questions, 'question')}</span>}
                      {l.kind === 'ASSESSMENT' && l.quiz && <span>{plural(l.quiz.questions, 'question')} · pass at {l.quiz.pass_pct}%</span>}
                      {l.is_final && <span>Final</span>}
                      {l.is_required === false && <span>Optional</span>}
                      {l.require_ack && <span>Sign-off required</span>}
                    </span>
                  </span>
                  <span className="lx-acc-right lx-num">
                    {l.is_preview && <button className="lx-preview-btn" onClick={() => onPreview(l)}>Preview</button>}
                    <span>{lengthWords(l.duration_s, l.est_minutes)}</span>
                  </span>
                </div>
              ))}
              </div></div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Action({ info, readOnly, busy, onEnrol, onPlay }: { info: Info; readOnly?: boolean; busy: boolean; onEnrol: () => void; onPlay: (id: string) => void }) {
  const mode = info.course.enrolment_mode
  const mine = info.mine
  const can = mode !== 'ASSIGN_ONLY'
  if (mine?.status === 'PENDING_APPROVAL') return <div className="lx-note" data-t="warning"><IconCheck size={16} /> Request sent. Your manager will decide, and you will hear back in your notifications.</div>
  if (mine?.status === 'NOT_STARTED') return <button className="lx-btn lx-btn--primary lx-btn--lg lx-btn--full" onClick={() => onPlay(mine.id)}><GPlay size={16} /> {readOnly ? 'View course' : 'Start the course'}</button>
  if (mine && ['IN_PROGRESS', 'FAILED'].includes(mine.status)) return <button className="lx-btn lx-btn--primary lx-btn--lg lx-btn--full" onClick={() => onPlay(mine.id)}><GPlay size={16} /> {readOnly ? 'View course' : 'Continue learning'}</button>
  if (mine?.status === 'COMPLETED') return (
    <div style={{ display: 'grid', gap: 8 }}>
      <button className="lx-btn lx-btn--primary lx-btn--lg lx-btn--full" onClick={() => onPlay(mine.id)}>Review the course</button>
      {can && <button className="lx-btn lx-btn--full" disabled={busy || readOnly} onClick={onEnrol}>{busy ? 'Starting again…' : 'Take it again'}</button>}
    </div>
  )
  if (!can) return <div className="lx-note"><IconLock size={16} /> HR assigns this course. Ask them if you need it.</div>
  const asks = mode === 'APPROVAL'
  const word = mine ? (asks ? 'Ask to retake' : 'Retake') : asks ? 'Request access' : 'Enrol now, it’s free'
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <button className="lx-btn lx-btn--primary lx-btn--lg lx-btn--full" disabled={busy || readOnly} onClick={onEnrol}>{busy ? 'One moment…' : word}</button>
      <div style={{ fontSize: 12.5, color: 'var(--ez-muted)', textAlign: 'center' }}>{asks ? 'Your manager approves this first.' : 'Start right away. Your progress is saved as you go.'}</div>
    </div>
  )
}

export default function CoursePage({ id, card, readOnly, onChanged, onBack, onPlay }: {
  id: string
  card?: CatCourse
  categories?: { id: string; name: string }[]
  readOnly?: boolean
  onChanged: () => void
  /** For an embedded portal; by default the app's own addresses. */
  onBack?: () => void
  onPlay?: (enrollmentId: string) => void
}) {
  const [info, setInfo] = useState<Info | null>(() => cached<Info>(keys.course(id)))
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<OutlineLesson | null>(null)
  const previewsOff = !!usePreviewPrefs().blocked

  // Through the cache: a hover on the card may already have this in flight.
  const load = useCallback(() => {
    setErr('')
    return fetchInto<Info>(keys.course(id), paths.course(id)).then(setInfo).catch(e => setErr(errorWords(e)))
  }, [id])
  useEffect(() => { setInfo(cached<Info>(keys.course(id))); void load() }, [load, id])

  const play = (eid: string) => (onPlay ? onPlay(eid) : navigate(to.play(eid)))
  const back = () => (onBack ? onBack() : window.history.length > 1 ? window.history.back() : navigate(to.catalog()))
  const enrol = async () => {
    setBusy(true); setErr('')
    try {
      const r = await lmsApi<{ id: string; status: string }>('/api/lms/me/enrol', { course_id: id })
      forget(keys.course(id))
      onChanged()
      if (r.status === 'PENDING_APPROVAL') await load()
      else play(r.id)
    } catch (e) { setErr(errorWords(e)) } finally { setBusy(false) }
  }

  const desc = useMemo(() => splitDescription(info?.course.description), [info])
  if (err && !info) return <div style={{ display: 'grid', gap: 16 }}><button className="lx-sec-link" onClick={back}><GArrowLeft size={15} /> Back</button><Oops message={err} onRetry={() => void load()} /></div>
  if (!info && card) {
    // The card that was clicked already holds the title, picture and figures: draw those at once.
    return (
      <div>
        <section className="lx-cp-hero">
          {card.thumbnail && <div className="lx-cp-hero-bg" style={{ backgroundImage: `url("${card.thumbnail}")` }} aria-hidden />}
          <div className="lx-cp-hero-grid">
            <div style={{ minWidth: 0 }}>
              <nav className="lx-crumbs"><button onClick={() => (onBack ? onBack() : navigate(to.catalog()))}>Explore</button></nav>
              <h1>{card.title}</h1>
              {card.summary && <p className="lx-cp-sum">{card.summary}</p>}
              <div className="lx-cp-facts lx-num">
                {!!card.est_minutes && <span><GClock size={15} /> {durationWords(card.est_minutes)}</span>}
                {!!card.lesson_count && <span><GLayers size={15} /> {plural(card.lesson_count, 'lesson')}</span>}
                {card.difficulty && <span>{LEVEL[card.difficulty]}</span>}
              </div>
            </div>
            <aside className="lx-cp-card"><CourseArt src={card.thumbnail} id={card.id} title={card.title} /><div className="lx-cp-card-body"><Skel h={48} r={13} /><Skel h={14} w="70%" /><Skel h={14} w="55%" /></div></aside>
          </div>
        </section>
        <div className="lx-cp-grid"><div className="lx-cp-main"><Skel h={140} r={16} /><Skel h={300} r={16} /></div></div>
      </div>
    )
  }
  if (!info) return <div style={{ display: 'grid', gap: 24 }}><Skel h={320} r={24} /><div className="lx-cp-grid"><div style={{ display: 'grid', gap: 16 }}><Skel h={160} /><Skel h={300} /></div><Skel h={260} /></div></div>

  const c = info.course
  const lessons = info.outline.flatMap(m => m.lessons)
  const mins = Math.round(lessons.reduce((a, l) => a + (l.duration_s ? l.duration_s / 60 : l.est_minutes || 0), 0)) || c.est_minutes || 0
  const byKind = (k: string[]) => lessons.filter(l => k.includes(l.kind)).length
  const quizzes = lessons.filter(l => l.quiz)
  const final = lessons.some(l => l.is_final)
  const firstPreview = lessons.find(l => l.is_preview)
  const rating = c.rating ?? card?.rating ?? null
  const ratings = c.ratings ?? card?.ratings ?? 0
  const st = info.mine ? STATUS[info.mine.status] : null
  const pct = Math.round(Number(info.mine?.progress_pct ?? card?.mine?.progress_pct) || 0)
  const points = desc.points.length ? desc.points : (c.skills || []).map(s => `Build your ${s.toLowerCase()} skills`)
  const includes = [
    byKind(['VIDEO']) && `${plural(byKind(['VIDEO']), 'video')}`,
    byKind(['AUDIO']) && `${plural(byKind(['AUDIO']), 'audio lesson')}`,
    byKind(['DOCUMENT', 'SLIDES']) && `${plural(byKind(['DOCUMENT', 'SLIDES']), 'document')} and slide decks`,
    byKind(['ARTICLE']) && `${plural(byKind(['ARTICLE']), 'reading')}`,
    quizzes.length && `${plural(quizzes.length, 'quiz', 'quizzes')} to check what you learned`,
    c.certificate_enabled && 'Certificate when you finish',
    c.validity_months && `Renew every ${plural(c.validity_months, 'month')}`,
  ].filter(Boolean) as string[]

  return (
    <div className="lx-in">
      <section className="lx-cp-hero">
        {c.thumbnail && <div className="lx-cp-hero-bg" style={{ backgroundImage: `url("${c.thumbnail}")` }} aria-hidden />}
        <Aurora specks={8} />
        <div className="lx-cp-hero-grid">
          <div style={{ minWidth: 0 }}>
            <nav className="lx-crumbs" aria-label="You are here">
              <button onClick={() => (onBack ? onBack() : navigate(to.catalog()))}>Explore</button>
              {c.category && <><span aria-hidden>›</span><span>{c.category}</span></>}
            </nav>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
              {c.is_compliance && <span className="lx-tag lx-tag--glass">Compliance</span>}
              {card?.is_featured && <span className="lx-tag lx-tag--gold">★ Featured</span>}
              {st && <span className="lx-tag lx-tag--glass">{st.label}</span>}
              {c.code && <span className="lx-tag lx-tag--glass lx-num">{c.code}</span>}
            </div>
            <h1>{c.title}</h1>
            {c.summary && <p className="lx-cp-sum">{c.summary}</p>}
            <div className="lx-cp-facts lx-num">
              {rating != null && <span style={{ color: 'var(--lx-glow)', fontWeight: 700 }}><IconStar size={15} filled /> {rating.toFixed(1)} <span style={{ color: 'rgba(255,255,255,.75)', fontWeight: 500 }}>({plural(ratings, 'rating')})</span></span>}
              {!!c.learners && <span><GUsers size={15} /> {plural(c.learners, 'learner')}</span>}
              {!!mins && <span><GClock size={15} /> {durationWords(mins)}</span>}
              <span><GLayers size={15} /> {plural(lessons.length, 'lesson')}</span>
              {c.difficulty && <span>{LEVEL[c.difficulty]}</span>}
              {c.language && <span>{c.language}</span>}
              {c.published_at && <span>Updated {dayWords(c.published_at)}</span>}
            </div>
          </div>
          <aside className="lx-cp-card" aria-label="Take this course">
            <CourseArt src={c.thumbnail} id={c.id} title={c.title} kind={lessons[0]?.kind}>
              {/* The course's trailer loops muted behind the artwork until the free preview opens. */}
              {card?.preview && !previewsOff && !preview && <Clip p={card.preview} play owned />}
              {firstPreview && (
                <>
                  <button className="lx-cc-play" style={{ opacity: 1, border: 0, cursor: 'pointer' }} onClick={() => setPreview(firstPreview)} aria-label="Watch a free preview">
                    <span><GPlay size={22} /></span>
                  </button>
                  <span className="lx-tag lx-tag--glass" style={{ position: 'absolute', left: 12, bottom: 12, zIndex: 'var(--ez-z-local-2)', pointerEvents: 'none' }}>Free preview</span>
                </>
              )}
            </CourseArt>
            <div className="lx-cp-card-body">
              {info.mine && ['IN_PROGRESS', 'NOT_STARTED', 'FAILED', 'COMPLETED'].includes(info.mine.status) && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <Ring pct={info.mine.status === 'COMPLETED' ? 100 : pct} size={54} />
                  <div style={{ fontSize: 13.5, color: 'var(--ez-muted)', lineHeight: 1.5 }}><b style={{ color: 'var(--ez-ink)' }}>{info.mine.status === 'COMPLETED' ? 'You completed this course' : pct ? 'You are on your way' : 'Ready when you are'}</b><div>{st?.label}</div></div>
                </div>
              )}
              <Action info={info} readOnly={readOnly} busy={busy} onEnrol={enrol} onPlay={play} />
              {err && <div role="alert" style={{ fontSize: 13.5, color: 'var(--ez-critical)' }}>{err}</div>}
              {includes.length > 0 && (
                <div style={{ display: 'grid', gap: 8 }}>
                  <div style={{ fontWeight: 750, fontSize: 13.5 }}>This course includes</div>
                  {includes.map(t => <div key={t} style={{ display: 'flex', gap: 10, fontSize: 13.5, color: 'var(--ez-ink-soft)' }}><span style={{ color: 'var(--ez-positive)' }}><IconCheck size={15} /></span>{t}</div>)}
                </div>
              )}
            </div>
          </aside>
        </div>
      </section>

      <div className="lx-cp-grid">
        <div className="lx-cp-main">
          {points.length > 0 && (
            <section>
              <div className="lx-sec-head"><h2 className="lx-sec-title">What you&apos;ll learn</h2></div>
              <ul className="lx-learn">{points.map(p => <li key={p}><IconCheck size={17} />{p}</li>)}</ul>
            </section>
          )}

          <section className="lx-facts">
            <div className="lx-fact"><GLayers size={20} /><b className="lx-num">{lessons.length}</b><span>Lessons in {plural(info.outline.length, 'module')}</span></div>
            <div className="lx-fact"><GClock size={20} /><b className="lx-num">{durationWords(mins) || '—'}</b><span>Total length</span></div>
            <div className="lx-fact"><GTarget size={20} /><b className="lx-num">{quizzes.length}</b><span>{quizzes.length === 1 ? 'Quiz' : 'Quizzes'}</span></div>
            <div className="lx-fact"><GCert size={20} /><b>{c.certificate_enabled ? 'Yes' : 'No'}</b><span>Certificate</span></div>
          </section>

          <section>
            <div className="lx-sec-head">
              <div><h2 className="lx-sec-title">Course content</h2><div className="lx-sec-sub lx-num">{plural(info.outline.length, 'module')} · {plural(lessons.length, 'lesson')}{mins ? ` · ${durationWords(mins)} in total` : ''}</div></div>
            </div>
            <Curriculum outline={info.outline} onPreview={setPreview} />
          </section>

          {(info.rules || quizzes.length > 0) && (
            <section>
              <div className="lx-sec-head"><h2 className="lx-sec-title">Assessment and completion</h2></div>
              <div className="lx-panel" style={{ padding: 20, display: 'grid', gap: 16 }}>
                {info.rules && (
                  <div style={{ display: 'grid', gap: 8 }}>
                    <div style={{ fontWeight: 750 }}>To complete this course</div>
                    {completionWords(info.rules, quizzes.length, final).map(t => <div key={t} style={{ display: 'flex', gap: 10, fontSize: 14, color: 'var(--ez-ink-soft)' }}><span style={{ color: 'var(--ez-positive)' }}><IconCheck size={16} /></span>{t}</div>)}
                    <div style={{ fontSize: 13.5, color: 'var(--ez-muted)' }}>{ORDER[info.rules.order_mode]}</div>
                  </div>
                )}
                {quizzes.length > 0 && (
                  <div style={{ display: 'grid', gap: 8 }}>
                    <div style={{ fontWeight: 750 }}>Quizzes</div>
                    {quizzes.map(l => (
                      <div key={l.id} style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', fontSize: 13.5, padding: '10px 12px', borderRadius: 12, background: 'var(--ez-sunken)' }}>
                        <span className="lx-kind" style={{ width: 28, height: 28, borderRadius: 8, display: 'grid', placeItems: 'center', background: 'var(--ez-positive-tint)', color: 'var(--ez-positive)' }}><GTarget size={14} /></span>
                        <span style={{ flex: '1 1 200px', minWidth: 0, fontWeight: 600 }}>{l.kind === 'ASSESSMENT' ? l.title : `After “${l.title}”`}</span>
                        <span className="lx-num" style={{ color: 'var(--ez-muted)' }}>{plural(l.quiz!.questions, 'question')} · pass at {l.quiz!.pass_pct}% · {l.quiz!.max_attempts ? plural(l.quiz!.max_attempts, 'attempt') : 'unlimited attempts'}{l.quiz!.time_limit_minutes ? ` · ${l.quiz!.time_limit_minutes} min` : ''}{l.quiz!.required ? '' : ' · optional'}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          )}

          {info.prerequisites.length > 0 && (
            <section>
              <div className="lx-sec-head"><h2 className="lx-sec-title">Finish these first</h2></div>
              <div style={{ display: 'grid', gap: 8 }}>
                {info.prerequisites.map(p => <button key={p.id} className="lx-res" onClick={() => navigate(to.course(p.id))}><span><GLayers size={16} /></span><span style={{ flex: 1, textAlign: 'left' }}>{p.title}</span><GArrowRight size={16} /></button>)}
              </div>
            </section>
          )}

          {(desc.about || (c.skills || []).length > 0) && (
            <section>
              <div className="lx-sec-head"><h2 className="lx-sec-title">About this course</h2></div>
              {desc.about && <p className="lx-prose">{desc.about}</p>}
              {!!c.skills?.length && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
                  {c.skills.map(s => <span key={s} className="lx-skill"><i />{s}</span>)}
                </div>
              )}
            </section>
          )}

          {info.reviews.length > 0 && (
            <section>
              <div className="lx-sec-head"><div><h2 className="lx-sec-title">What learners say</h2>{rating != null && <div className="lx-sec-sub lx-num">{rating.toFixed(1)} out of 5 from {plural(ratings, 'rating')}</div>}</div></div>
              <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))' }}>
                {info.reviews.map((r, i) => (
                  <div key={i} className="lx-review">
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}><Stars value={r.rating} /><span style={{ fontSize: 12.5, color: 'var(--ez-muted)' }}>{dayWords(r.created_at)}</span></div>
                    <div style={{ fontSize: 14, color: 'var(--ez-ink-soft)', lineHeight: 1.6 }}>{r.comment}</div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
        <div className="lx-cp-aside lx-hide-sm" aria-hidden />
      </div>

      {preview && <PreviewModal courseId={c.id} lesson={preview} onClose={() => setPreview(null)} />}
    </div>
  )
}
