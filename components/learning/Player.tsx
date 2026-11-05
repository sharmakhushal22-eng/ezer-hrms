'use client'
// components/learning/Player.tsx — taking a course. One component for employees and candidates:
// the only difference between them is which token lib/lms/client.ts sends.
//
// The layout is a learning theatre: the lesson on a dark stage, the course outline beside it,
// and below the stage what the lesson asks of the learner (finish it, sit its quiz, take its
// downloads). On a tablet or phone the outline slides in from the side.
//
// The browser reports events and draws what the server answers. Locks, watch credit, quiz
// marks and completion are all decided in lib/lms/engine.ts, so after anything that could
// change them this refetches the whole view rather than guessing.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { IconCheck, IconChevronDown, IconLock } from '@/lib/ui'
import { LmsApiError, lmsApi } from '@/lib/lms/client'
import {
  DueTag, KIND_WORD, KindGlyph, Oops, Ring, Skel, durationWords, errorWords, shortDay,
  type OpenedLesson, type PlayerLesson, type PlayerView, type QuizOutcome, type QuizPaper,
} from './shared'
import { GArrowLeft, GLeft, GRight, GSidebar, GTarget } from './glyphs'
import MediaLesson from './PlayerMedia'
import { ArticleLesson, DocumentLesson, DocumentLinks, LinkLesson, MarkBar, Resources, isCaption } from './PlayerReading'
import { QuizCard, QuizResult, QuizRunner } from './PlayerQuiz'
import CourseDone from './PlayerDone'
import ScormLesson from './PlayerScorm'
import LiveLesson from './PlayerLive'
import { cached, fetchInto, keys, paths, remember } from './app/cache'

type Panel = 'lesson' | 'quiz' | 'result' | 'done'
type Tab = 'overview' | 'downloads' | 'course'

/** Signed document and download links last 15 minutes. These are renewed before they lapse. */
const LINK_REFRESH_MS = 12 * 60_000

function lockWords(l: PlayerLesson) {
  switch (l.lock_reason) {
    case 'PREVIOUS_LESSON': return 'Finish the lesson before this one first'
    case 'PREVIOUS_MODULE': return 'Finish the previous module first'
    case 'DRIP': return l.unlocks_at ? `Opens on ${shortDay(l.unlocks_at)}` : 'Opens later'
    case 'FINAL_LAST': return 'Opens after the other lessons'
    default: return 'Not open yet'
  }
}

const ORDER_WORDS: Record<string, string> = {
  SEQUENTIAL: 'Lessons open one after another',
  MODULE_SEQUENTIAL: 'Modules open one after another',
  FREE: 'Take the lessons in any order',
}

/** Where to land: the lesson they were on if it is still to do, else the first one to do. */
function pickLesson(v: PlayerView, wanted?: string | null): PlayerLesson | null {
  const asked = wanted ? v.lessons.find(l => l.id === wanted && !l.locked) : null
  if (asked) return asked
  const last = v.lessons.find(l => l.id === v.enrollment.last_lesson_id)
  if (last && !last.locked && !last.done) return last
  return v.lessons.find(l => !l.locked && !l.done) || (last && !last.locked ? last : null) || v.lessons.find(l => !l.locked) || null
}

function closedWords(status: string) {
  switch (status) {
    case 'EXPIRED': return 'This course has expired. Your record is safe in Achievements, and you can take it again from the catalogue.'
    case 'WAIVED': return 'HR has waived this course for you, so there is nothing to do here.'
    case 'PENDING_APPROVAL': return 'Your request is with your manager. The course opens once they approve it.'
    case 'CANCELLED': case 'REJECTED': return 'This course is not open to you at the moment.'
    default: return null
  }
}

function LessonRow({ l, n, current, shut, onPick }: { l: PlayerLesson; n: number; current: boolean; shut: boolean; onPick: (l: PlayerLesson) => void }) {
  const locked = l.locked || shut
  const quiz = l.quiz && l.kind !== 'ASSESSMENT'
  return (
    <button className="lx-ls" disabled={locked} onClick={() => onPick(l)} aria-current={current ? 'true' : undefined} data-done={l.done ? '1' : '0'} data-locked={locked ? '1' : '0'}
      title={locked ? (shut ? 'Not open yet' : lockWords(l)) : undefined}>
      <span className="lx-ls-mark">{l.done ? <IconCheck size={14} /> : locked ? <IconLock size={12} /> : current ? <KindGlyph kind={l.kind} size={13} /> : <span className="lx-num" style={{ fontSize: 11.5, fontWeight: 750 }}>{n}</span>}</span>
      <span style={{ minWidth: 0 }}>
        <b>{l.title}</b>
        <small>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><KindGlyph kind={l.kind} size={12} />{KIND_WORD[l.kind]}</span>
          {!!l.est_minutes && <span>· {durationWords(l.est_minutes)}</span>}
          {quiz && <span className="lx-ls-quiz" data-ok={l.quiz!.passed ? '1' : '0'}>· <GTarget size={12} />{l.quiz!.passed ? 'Quiz passed' : 'Quiz'}</span>}
          {!l.is_required && <span>· Optional</span>}
          {locked && !shut && <span style={{ flexBasis: '100%' }}>{lockWords(l)}</span>}
          {!locked && !l.done && l.watched_pct > 0 && <span>· {l.watched_pct}%</span>}
        </small>
      </span>
    </button>
  )
}

function Outline({ view, currentId, shut, onPick }: { view: PlayerView; currentId: string | null; shut: boolean; onPick: (l: PlayerLesson) => void }) {
  const [closed, setClosed] = useState<Set<string>>(new Set())
  const number = new Map(view.lessons.map((l, i) => [l.id, i + 1]))
  return (
    <div>
      {view.modules.map((m, i) => {
        const mine = view.lessons.filter(l => l.module_id === m.id)
        if (!mine.length) return null
        const open = !closed.has(m.id)
        const mins = mine.reduce((a, l) => a + (l.est_minutes || 0), 0)
        return (
          <div key={m.id} className="lx-mod">
            <button className="lx-mod-head" aria-expanded={open} onClick={() => setClosed(s => { const x = new Set(s); if (x.has(m.id)) x.delete(m.id); else x.add(m.id); return x })}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <b>Module {i + 1}: {m.title}</b>
                <span className="lx-num">{mine.filter(l => l.done).length} / {mine.length} done{mins ? ` · ${durationWords(mins)}` : ''}</span>
              </span>
              <IconChevronDown size={16} />
            </button>
            {open && mine.map(l => <LessonRow key={l.id} l={l} n={number.get(l.id) || 0} current={l.id === currentId} shut={shut} onPick={onPick} />)}
          </div>
        )
      })}
    </div>
  )
}

function FinishedNote({ lesson, next, complete, onQuiz, onNext, onFinish }: { lesson: PlayerLesson; next: PlayerLesson | null; complete: boolean; onQuiz: () => void; onNext: () => void; onFinish: () => void }) {
  const quizWaits = !!lesson.quiz && lesson.quiz.gate === 'READY'
  return (
    <div role="status" className="lx-finish">
      <span><IconCheck size={20} /></span>
      <div style={{ flex: '1 1 220px' }}>
        <div style={{ fontWeight: 750, fontSize: 15 }}>{complete ? 'That was the last step.' : 'Lesson finished. Nice work.'}</div>
        <div style={{ fontSize: 13.5, color: 'var(--ez-muted)', marginTop: 2 }}>{complete ? 'You have finished this course.' : quizWaits ? 'The quiz for this lesson is open now.' : next && !next.locked ? `Up next: ${next.title}` : 'Pick the next lesson from the outline.'}</div>
      </div>
      {complete ? <button className="lx-btn lx-btn--primary" onClick={onFinish}>See your results</button>
        : quizWaits ? <button className="lx-btn lx-btn--primary" onClick={onQuiz}><GTarget size={16} /> Start the quiz</button>
        : next && !next.locked ? <button className="lx-btn lx-btn--primary" onClick={onNext}>Next lesson <GRight size={16} /></button> : null}
    </div>
  )
}

export default function Player({ enrollmentId, onClose, backLabel = 'My learning', onOpenCourse, onSessionEnded, initialLesson, onLesson }: {
  enrollmentId: string
  onClose: () => void
  backLabel?: string
  /** Absent means no "next up" card. */
  onOpenCourse?: (enrollmentId: string) => void
  /** A candidate's session ran out: their page goes back to the code step. */
  onSessionEnded?: () => void
  /** Open this lesson first, if it is open to the learner. */
  initialLesson?: string | null
  /** The open lesson changed, for an address that names it. */
  onLesson?: (lessonId: string) => void
}) {
  const path = `/api/lms/me/enrollments/${enrollmentId}`
  const [view, setView] = useState<PlayerView | null>(null)
  const [err, setErr] = useState('')
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [opened, setOpened] = useState<OpenedLesson | null>(null)
  const [openErr, setOpenErr] = useState('')
  const [openTick, setOpenTick] = useState(0)
  const [links, setLinks] = useState<{ url: string | null; resources: OpenedLesson['resources'] }>({ url: null, resources: [] })
  const [panel, setPanel] = useState<Panel>('lesson')
  const [paper, setPaper] = useState<QuizPaper | null>(null)
  const [result, setResult] = useState<QuizOutcome | null>(null)
  const [quizBusy, setQuizBusy] = useState(false)
  const [quizErr, setQuizErr] = useState('')
  const [side, setSide] = useState(false)
  const [tab, setTab] = useState<Tab>('overview')
  const [justFinished, setJustFinished] = useState(false)
  const [visited, setVisited] = useState(false)
  const [autoNext, setAutoNext] = useState(false)
  const [docPages, setDocPages] = useState<{ seen: number; pages: number } | null>(null)
  const openSeq = useRef(0)
  const onLessonRef = useRef(onLesson)
  useEffect(() => { onLessonRef.current = onLesson })

  useEffect(() => { setSide(window.innerWidth > 1100) }, [])

  const ended = useCallback((e: unknown) => {
    if (e instanceof LmsApiError && e.status === 401 && onSessionEnded) { onSessionEnded(); return true }
    return false
  }, [onSessionEnded])

  const load = useCallback(async (): Promise<PlayerView | null> => {
    try {
      const v = await lmsApi<PlayerView>(path)
      setView(remember(keys.view(enrollmentId), v)); setErr('')
      return v
    } catch (e) {
      if (!ended(e)) setErr(errorWords(e))
      return null
    }
  }, [path, ended, enrollmentId])

  const openLesson = useCallback(async (id: string) => {
    const seq = ++openSeq.current
    setOpened(null); setOpenErr('')
    try {
      const o = await lmsApi<OpenedLesson>(path, { event: 'open', lesson_id: id })
      if (seq !== openSeq.current) return
      setOpened(o); setOpenTick(n => n + 1)
      setLinks({ url: o.url, resources: o.resources || [] })
    } catch (e) {
      if (seq === openSeq.current && !ended(e)) setOpenErr(errorWords(e))
    }
  }, [path, ended])

  const select = useCallback((id: string, opts?: { autoplay?: boolean }) => {
    setCurrentId(id); setPanel('lesson'); setTab('overview')
    if (window.innerWidth <= 1100) setSide(false)
    setPaper(null); setResult(null); setQuizErr(''); setJustFinished(false); setVisited(false); setDocPages(null)
    setAutoNext(!!opts?.autoplay)
    void openLesson(id)
    onLessonRef.current?.(id)
    window.scrollTo({ top: 0 })
  }, [openLesson])

  const firstLesson = useRef(initialLesson)
  useEffect(() => {
    let live = true
    setCurrentId(null); setOpened(null); setPanel('lesson')
    // The view this tab last had (or a hover's prefetch) goes up at once, and the lesson starts
    // opening from it; the fresh view replaces it a moment later. Locks are the server's anyway:
    // opening a lesson that is not reachable is refused there.
    const seen = cached<PlayerView>(keys.view(enrollmentId))
    setView(seen)
    let picked = false
    if (seen && !seen.gate && !closedWords(seen.enrollment.status) && !(seen.enrollment.status === 'COMPLETED' && !firstLesson.current)) {
      const first = pickLesson(seen, firstLesson.current)
      if (first) { picked = true; select(first.id) }
    }
    const fresh = seen ? load() : fetchInto<PlayerView>(keys.view(enrollmentId), paths.view(enrollmentId)).then(v => { setView(v); setErr(''); return v }).catch(e => { if (!ended(e)) setErr(errorWords(e)); return null })
    fresh.then(v => {
      if (!live || !v || v.gate || closedWords(v.enrollment.status)) return
      if (v.enrollment.status === 'COMPLETED' && !firstLesson.current) { setPanel('done'); return }
      if (picked) return
      const first = pickLesson(v, firstLesson.current)
      if (first) select(first.id)
    })
    return () => { live = false; openSeq.current++ }
  }, [load, select, enrollmentId, ended])

  // Document and download links lapse in 15 minutes; a lesson can be open for longer.
  useEffect(() => {
    if (!opened || (!opened.resources?.length && !['DOCUMENT', 'SLIDES'].includes(view?.lessons.find(l => l.id === opened.lesson_id)?.kind || ''))) return
    const id = opened.lesson_id
    const t = setInterval(() => {
      lmsApi<OpenedLesson>(path, { event: 'open', lesson_id: id }).then(o => setLinks({ url: o.url, resources: o.resources || [] })).catch(() => {})
    }, LINK_REFRESH_MS)
    return () => clearInterval(t)
  }, [opened, path]) // eslint-disable-line react-hooks/exhaustive-deps

  const lesson = view?.lessons.find(l => l.id === currentId) || null
  const lessonId = lesson?.id

  const reopen = useCallback(() => {
    if (!lessonId) throw new Error('No lesson is open.')
    return lmsApi<OpenedLesson>(path, { event: 'open', lesson_id: lessonId })
  }, [lessonId, path])

  /** The view again, and again if the connection drops: after the server has moved something on,
   *  the screen must not be left showing the old state. */
  const settle = useCallback(async () => {
    for (let i = 0; i < 4; i++) {
      if (await load()) return
      await new Promise(r => setTimeout(r, 1500 * 2 ** i))
    }
  }, [load])

  /** What the server just confirmed for this lesson, shown at once; the refetch fills in the rest
   *  (next lesson unlocking, progress). The quiz itself is still opened by the server's say-so. */
  const confirmDone = useCallback((id: string, ack: boolean) => {
    setView(v => v && ({ ...v, lessons: v.lessons.map(x => x.id !== id ? x : {
      ...x, content_done: true, ack_at: ack ? new Date().toISOString() : x.ack_at,
      quiz: x.quiz && x.quiz.gate === 'WATCH_FIRST' ? { ...x.quiz, gate: 'READY' } : x.quiz,
    }) }))
  }, [])

  const mark = useCallback(async (body: { done?: boolean; ack?: boolean }) => {
    const r = await lmsApi<{ status: string }>(path, { event: 'mark', lesson_id: lessonId, ...body })
    if (lessonId && body.done) confirmDone(lessonId, !!body.ack)
    setJustFinished(true)
    if (r.status === 'COMPLETED') { setPanel('done'); window.scrollTo({ top: 0 }) }
    await settle()
  }, [path, lessonId, settle, confirmDone])

  const onFinished = useCallback(() => {
    if (lessonId) confirmDone(lessonId, false)
    setJustFinished(true)
    void settle()
  }, [lessonId, settle, confirmDone])

  // Back on the tab (or back online): the last progress report may have gone as the page was
  // hidden, and its answer was never read. Ask again while the open lesson is not yet done.
  const behind = !!view && !!currentId && !view.lessons.find(x => x.id === currentId)?.done
  useEffect(() => {
    if (!behind) return
    const again = () => { if (document.visibilityState === 'visible') void load() }
    document.addEventListener('visibilitychange', again)
    window.addEventListener('online', again)
    return () => { document.removeEventListener('visibilitychange', again); window.removeEventListener('online', again) }
  }, [behind, load])

  const startQuiz = useCallback(async () => {
    if (!lessonId) return
    setQuizBusy(true); setQuizErr('')
    try {
      const p = await lmsApi<QuizPaper>(path, { event: 'quiz_start', lesson_id: lessonId })
      setPaper(p); setResult(null); setPanel('quiz')
      window.scrollTo({ top: 0 })
    } catch (e) {
      if (!ended(e)) setQuizErr(errorWords(e))
      void load()
    } finally { setQuizBusy(false) }
  }, [path, lessonId, ended, load])

  const submitQuiz = useCallback(async (answers: Record<string, string | string[]>) => {
    if (!paper) return
    const r = await lmsApi<QuizOutcome>(path, { event: 'quiz_submit', attempt_id: paper.attempt_id, answers })
    setResult(r); setPaper(null); setPanel('result')
    window.scrollTo({ top: 0 })
    await load()
  }, [path, paper, load])

  const pick = useCallback((l: PlayerLesson) => {
    if (panel === 'quiz' && paper?.seconds_left != null && !window.confirm('The clock keeps running while you are away from this quiz. Leave it for now?')) return
    select(l.id)
  }, [panel, paper, select])

  const captions = useMemo(() => links.resources.filter(r => r.url && isCaption(r)).map(r => ({ label: r.title.replace(/\.vtt$/i, '') || 'Captions', src: r.url! })), [links.resources])

  if (err && !view) {
    return (
      <div className="lx-pl">
        <header className="lx-pl-top"><button className="lx-btn lx-btn--ghost lx-btn--sm" onClick={onClose}><GArrowLeft size={16} /> {backLabel}</button></header>
        <div style={{ padding: 32 }}><Oops message={err} onRetry={() => void load()} /></div>
      </div>
    )
  }
  if (!view) {
    return (
      <div className="lx-pl">
        <header className="lx-pl-top"><button className="lx-btn lx-btn--ghost lx-btn--sm" onClick={onClose}><GArrowLeft size={16} /> {backLabel}</button><Skel h={16} w={240} style={{ opacity: .2 }} /></header>
        <div className="lx-pl-body" data-side="0">
          <div className="lx-pl-main"><div className="lx-stage"><div className="lx-stage-inner" style={{ aspectRatio: '16 / 9', display: 'grid', placeItems: 'center' }}><div className="lx-vp-spin" style={{ position: 'static', margin: 0 }} /></div></div>
            <div className="lx-under"><Skel h={14} w={160} /><Skel h={30} w="55%" /><Skel h={90} /></div></div>
        </div>
      </div>
    )
  }

  const shut = !!view.gate || !!closedWords(view.enrollment.status)
  const complete = view.enrollment.status === 'COMPLETED'
  const at = lesson ? view.lessons.indexOf(lesson) : -1
  const prev = at > 0 ? view.lessons[at - 1] : null
  const next = at >= 0 ? view.lessons[at + 1] || null : null
  const moduleIdx = lesson ? view.modules.findIndex(m => m.id === lesson.module_id) : -1
  const moduleOf = moduleIdx >= 0 ? view.modules[moduleIdx] : null
  const showDone = () => { setPanel('done'); setCurrentId(null); window.scrollTo({ top: 0 }) }
  const media = lesson?.kind === 'VIDEO' || lesson?.kind === 'AUDIO'
  const doc = lesson?.kind === 'DOCUMENT' || lesson?.kind === 'SLIDES'
  const ready = !!opened && !!lesson && opened.lesson_id === lesson.id
  const stageKind = shut || panel === 'lesson' ? (media ? 'video' : doc ? 'doc' : lesson?.kind === 'SCORM' ? 'scorm' : 'page') : 'page'
  const downloads = links.resources.filter(r => r.url)
  const goNext = () => next && select(next.id, { autoplay: media && next.kind === 'VIDEO' })
  const pagesLeft = lesson?.kind === 'SLIDES' && docPages && !lesson.content_done ? Math.max(0, docPages.pages - docPages.seen) : 0

  let stage: React.ReactNode
  if (view.gate) {
    stage = <div className="lx-gatecard"><span><IconLock size={24} /></span><div style={{ fontWeight: 700, fontSize: 18 }}>This course is not open yet</div><p>{view.gate}</p></div>
  } else if (closedWords(view.enrollment.status)) {
    stage = <div className="lx-gatecard"><p>{closedWords(view.enrollment.status)}</p></div>
  } else if (panel === 'done') {
    stage = <CourseDone view={view} path={path} backLabel={backLabel} onClose={onClose} onOpenCourse={onOpenCourse} onReview={() => { const l = view.lessons[0]; if (l) select(l.id) }} />
  } else if (!lesson) {
    stage = <div className="lx-gatecard"><p>{view.lessons.length ? 'No lesson is open to you yet. Check the outline for when the next one opens.' : 'This course has no lessons yet.'}</p></div>
  } else if (panel === 'quiz' && paper) {
    stage = <QuizRunner key={paper.attempt_id} paper={paper} onSubmit={submitQuiz} onLeave={() => { setPaper(null); setPanel('lesson'); void load() }} />
  } else if (panel === 'result' && result) {
    stage = <QuizResult r={result} canNext={!!next && !next.locked} complete={complete} busy={quizBusy}
      onNext={goNext} onRetry={startQuiz} onRewatch={() => select(lesson.id)} onFinish={showDone}
      onBack={() => { setResult(null); setPanel('lesson') }} />
  } else if (openErr) {
    stage = <div style={{ padding: 32 }}><Oops message={openErr} onRetry={() => void openLesson(lesson.id)} /></div>
  } else if (!ready) {
    stage = media ? <div style={{ aspectRatio: '16 / 9', display: 'grid', placeItems: 'center' }}><div className="lx-vp-spin" style={{ position: 'static', margin: 0 }} /></div>
      : doc ? <div className="lx-deck"><div className="lx-deck-msg" style={{ gridRow: '1 / -1' }}><div className="lx-vp-spin" style={{ position: 'static', margin: 0 }} />Opening the document…</div></div>
      : <Skel h={320} r={20} />
  } else if (media) {
    stage = <MediaLesson key={`${lesson.id}:${openTick}`} lesson={lesson} opened={opened!} path={path} readOnly={view.read_only} onFinished={onFinished} reopen={reopen} captions={captions} autoPlay={autoNext} />
  } else if (doc) {
    stage = <DocumentLesson key={`${lesson.id}:${openTick}`} opened={opened!} url={links.url} title={lesson.title} path={path} lessonId={lesson.id} readOnly={view.read_only} onPages={(seen, pages) => setDocPages({ seen, pages })} />
  } else if (lesson.kind === 'SCORM' && opened!.scorm) {
    stage = <ScormLesson key={`${lesson.id}:${openTick}`} opened={opened!} path={path} lessonId={lesson.id} title={lesson.title} done={lesson.content_done} readOnly={view.read_only} onFinished={onFinished} />
  } else if (lesson.kind === 'LIVE' && opened!.live) {
    stage = <LiveLesson key={`${lesson.id}:${openTick}`} opened={opened!} done={lesson.content_done} reopen={reopen} onFinished={onFinished} />
  } else if (lesson.kind === 'ARTICLE') {
    stage = <ArticleLesson body={opened!.body} />
  } else if (lesson.kind === 'LINK') {
    stage = <LinkLesson href={opened!.external_url} onVisited={() => setVisited(true)} />
  } else {
    // An assessment has no content of its own: the quiz card below is the lesson.
    stage = (
      <div className="lx-result" data-pass={lesson.done ? '1' : '0'} style={{ background: 'var(--ez-surface)' }}>
        <span className="lx-empty-art" style={{ transform: 'none' }}><GTarget size={34} /></span>
        <h2>{lesson.title}</h2>
        <p style={{ color: 'var(--ez-muted)', maxWidth: 520, lineHeight: 1.6 }}>{lesson.summary || 'Answer the questions to show what you have learned.'}</p>
      </div>
    )
  }

  const lessonMode = panel === 'lesson' && !!lesson && !shut
  return (
    <div className="lx-pl">
      <header className="lx-pl-top">
        <button className="lx-btn lx-btn--ghost lx-btn--sm" onClick={onClose} aria-label={`Back to ${backLabel}`}><GArrowLeft size={16} /> <span className="lx-hide-sm">{backLabel}</span></button>
        <div className="lx-pl-title">
          <b>{view.course.title}</b>
          <span>{lesson && panel !== 'done' ? `${moduleOf ? `Module ${moduleIdx + 1} · ` : ''}Lesson ${at + 1} of ${view.lessons.length}: ${lesson.title}` : complete ? 'Completed' : `${view.lessons.length} lessons`}</span>
        </div>
        <div className="lx-pl-prog">
          {view.enrollment.mandatory && <span className="lx-tag lx-tag--glass lx-hide-sm">Mandatory</span>}
          <span className="lx-hide-sm"><DueTag dueAt={view.enrollment.due_at} overdue={view.enrollment.overdue} status={view.enrollment.status} /></span>
          <Ring pct={view.state.progress_pct} size={38} stroke={4} track="var(--lx-on-stage-faint)" color={view.state.progress_pct >= 100 ? 'var(--ez-positive)' : 'var(--lx-hero-c)'} text={<span style={{ fontSize: 10, color: 'var(--lx-on-stage)' }}>{Math.round(view.state.progress_pct)}%</span>} />
          <span className="lx-hide-sm lx-num">{view.state.done} of {view.state.total} done</span>
        </div>
        <button className="lx-btn lx-btn--ghost lx-btn--icon lx-btn--sm" aria-pressed={side} onClick={() => setSide(s => !s)} aria-label={side ? 'Hide the course outline' : 'Show the course outline'} title="Course outline"><GSidebar size={18} /></button>
      </header>

      <div className="lx-pl-body" data-side={side ? '1' : '0'}>
        <main className="lx-pl-main">
          {view.read_only && <div className="lx-note" data-t="warning" style={{ borderRadius: 0 }}>This is someone else&apos;s portal. You can look around, but nothing here is saved or submitted.</div>}
          <section className="lx-stage" data-kind={stageKind}>
            <div className="lx-stage-inner">{stage}</div>
          </section>

          {lessonMode && lesson && (
            <div className="lx-under">
              <div className="lx-lesson-head">
                <div style={{ minWidth: 0, flex: '1 1 320px' }}>
                  <div className="lx-lesson-kicker">{moduleOf ? `Module ${moduleIdx + 1} · ${moduleOf.title}` : KIND_WORD[lesson.kind]}</div>
                  <h1 className="lx-lesson-title">{lesson.title}</h1>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                    <span className="lx-tag"><KindGlyph kind={lesson.kind} size={12} /> {KIND_WORD[lesson.kind]}</span>
                    {!!lesson.est_minutes && <span className="lx-tag">{durationWords(lesson.est_minutes)}</span>}
                    {lesson.done && <span className="lx-tag lx-tag--positive"><IconCheck size={12} /> Completed</span>}
                    {!lesson.is_required && <span className="lx-tag">Optional</span>}
                    {lesson.quiz && lesson.kind !== 'ASSESSMENT' && <span className={`lx-tag ${lesson.quiz.passed ? 'lx-tag--positive' : 'lx-tag--brand'}`}><GTarget size={12} /> {lesson.quiz.passed ? 'Quiz passed' : `Quiz · pass at ${lesson.quiz.pass_pct}%`}</span>}
                    {doc && docPages && <span className="lx-tag lx-num">{docPages.seen} of {docPages.pages} pages seen</span>}
                  </div>
                </div>
                <div className="lx-pn">
                  <button className="lx-btn" disabled={!prev || prev.locked} onClick={() => prev && pick(prev)}><GLeft size={16} /> <span>Previous</span></button>
                  {next
                    ? <button className={`lx-btn ${lesson.done && !next.locked ? 'lx-btn--primary' : ''}`} disabled={next.locked} title={next.locked ? (lesson.quiz?.required && !lesson.quiz.passed ? 'Pass the quiz to move on' : lockWords(next)) : undefined} onClick={goNext}><span>Next lesson</span> <GRight size={16} /></button>
                    : complete ? <button className="lx-btn lx-btn--primary" onClick={showDone}>See your results</button> : null}
                </div>
              </div>
              {next?.locked && !lesson.done && <div style={{ fontSize: 13, color: 'var(--ez-muted)', marginTop: -8 }}>{lesson.quiz?.required && !lesson.quiz.passed ? 'Pass this lesson’s quiz to open the next one' : lockWords(next)}.</div>}

              {justFinished && lesson.content_done && !(lesson.require_ack && !lesson.ack_at) && (
                <FinishedNote lesson={lesson} next={next} complete={complete} onQuiz={startQuiz} onNext={goNext} onFinish={showDone} />
              )}
              {ready && (
                <MarkBar key={`mark:${lesson.id}:${openTick}`} lesson={lesson} readOnly={view.read_only} dwellLeft={opened?.dwell_left_s}
                  needsVisit={lesson.kind === 'LINK' && !visited && !lesson.content_done} pagesLeft={pagesLeft} onMark={mark} />
              )}
              {lesson.quiz && (
                <QuizCard quiz={lesson.quiz} kind={lesson.kind} readOnly={view.read_only} complete={complete} busy={quizBusy} err={quizErr} hasOpenAttempt={!!lesson.quiz.open_attempt} onStart={startQuiz} onRefresh={() => void load()} />
              )}

              <div className="lx-subtabs" role="tablist">
                <button role="tab" aria-selected={tab === 'overview'} onClick={() => setTab('overview')}>Overview</button>
                <button role="tab" aria-selected={tab === 'downloads'} onClick={() => setTab('downloads')}>Downloads{downloads.length ? ` (${downloads.length})` : ''}</button>
                <button role="tab" aria-selected={tab === 'course'} onClick={() => setTab('course')}>About this course</button>
              </div>
              {tab === 'overview' && (
                <div style={{ display: 'grid', gap: 14 }}>
                  <p style={{ fontSize: 15, lineHeight: 1.7, color: 'var(--ez-ink-soft)', whiteSpace: 'pre-wrap' }}>{lesson.summary || 'No notes for this lesson.'}</p>
                  {doc && ready && <DocumentLinks opened={opened!} url={links.url} />}
                </div>
              )}
              {tab === 'downloads' && <Resources items={links.resources} />}
              {tab === 'course' && (
                <div style={{ display: 'grid', gap: 12 }}>
                  {view.course.summary && <p style={{ fontSize: 15, lineHeight: 1.7, color: 'var(--ez-ink-soft)' }}>{view.course.summary}</p>}
                  {view.course.description && <p className="lx-prose">{view.course.description}</p>}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <span className="lx-tag">{ORDER_WORDS[view.rules.order_mode] || 'Lessons in order'}</span>
                    {view.rules.require_final && <span className="lx-tag">Final assessment required</span>}
                    {view.rules.min_overall_pct != null && <span className="lx-tag">Overall score of {view.rules.min_overall_pct}% needed</span>}
                    {view.course.certificate_enabled && <span className="lx-tag lx-tag--gold">Certificate on completion</span>}
                    <span className="lx-tag lx-num">Version {view.rules.version_no}</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </main>

        <aside className="lx-pl-side" aria-label="Course outline">
          <div className="lx-pl-side-head">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <div style={{ fontWeight: 750, fontSize: 15 }}>Course content</div>
              <button className="lx-btn lx-btn--ghost lx-btn--icon lx-btn--sm" onClick={() => setSide(false)} aria-label="Hide the course outline"><GRight size={16} /></button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Ring pct={view.state.progress_pct} size={46} stroke={5} />
              <div style={{ fontSize: 13, color: 'var(--ez-muted)', lineHeight: 1.45 }}>
                <b className="lx-num" style={{ color: 'var(--ez-ink)' }}>{view.state.done} of {view.state.total}</b> lessons done
                <div>{ORDER_WORDS[view.rules.order_mode] || ''}</div>
              </div>
            </div>
          </div>
          <Outline view={view} currentId={panel === 'done' ? null : currentId} shut={shut} onPick={pick} />
          {complete && panel !== 'done' && <div style={{ padding: 16 }}><button className="lx-btn lx-btn--full" onClick={showDone}>Your results and certificate</button></div>}
        </aside>
      </div>
    </div>
  )
}
