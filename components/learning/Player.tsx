'use client'
// components/learning/Player.tsx — taking a course. One component for employees and candidates:
// the only difference between them is which token lib/lms/client.ts sends.
//
// The browser reports events and draws what the server answers. Locks, watch credit, quiz
// marks and completion are all decided in lib/lms/engine.ts, so after anything that could
// change them this refetches the whole view rather than guessing.
import { useCallback, useEffect, useRef, useState } from 'react'
import { C, F, W, S, R, Badge, Button, Card, Skeleton, numeric, IconCheck, IconChevronDown, IconLock } from '@/lib/ui'
import { LmsApiError, lmsApi } from '@/lib/lms/client'
import { DueBadge, IconBack, IconForward, KIND_WORD, KindIcon, Problem, ProgressBar, durationWords, errorWords, shortDay, type OpenedLesson, type PlayerLesson, type PlayerView, type QuizOutcome, type QuizPaper } from './shared'
import MediaLesson from './PlayerMedia'
import { ArticleLesson, DocumentLesson, LinkLesson, MarkBar, Resources } from './PlayerReading'
import { QuizCard, QuizResult, QuizRunner } from './PlayerQuiz'
import CourseDone from './PlayerDone'

type Panel = 'lesson' | 'quiz' | 'result' | 'done'

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

/** Where to land: the lesson they were on if it is still to do, else the first one to do. */
function pickLesson(v: PlayerView): PlayerLesson | null {
  const last = v.lessons.find(l => l.id === v.enrollment.last_lesson_id)
  if (last && !last.locked && !last.done) return last
  return v.lessons.find(l => !l.locked && !l.done) || (last && !last.locked ? last : null) || v.lessons.find(l => !l.locked) || null
}

function closedWords(status: string) {
  switch (status) {
    case 'EXPIRED': return 'This course has expired. Your record is safe in My Achievements, and you can take it again from the catalogue.'
    case 'WAIVED': return 'HR has waived this course for you, so there is nothing to do here.'
    case 'PENDING_APPROVAL': return 'Your request is with your manager. The course opens once they approve it.'
    case 'CANCELLED': case 'REJECTED': return 'This course is not open to you at the moment.'
    default: return null
  }
}

function NavRow({ l, current, shut, onPick }: { l: PlayerLesson; current: boolean; shut: boolean; onPick: (l: PlayerLesson) => void }) {
  const locked = l.locked || shut
  const sub = locked ? (shut ? 'Not open yet' : lockWords(l))
    : [KIND_WORD[l.kind], durationWords(l.est_minutes), l.quiz && l.kind !== 'ASSESSMENT' ? (l.quiz.passed ? 'Quiz passed' : 'Quiz') : null, !l.is_required ? 'Optional' : null].filter(Boolean).join(' · ')
  const mark = l.done ? { bg: C.positiveTint, fg: C.positive, icon: <IconCheck size={13} /> }
    : locked ? { bg: C.sunken, fg: C.faint, icon: <IconLock size={12} /> }
    : current ? { bg: C.brand, fg: C.onAccent, icon: <KindIcon kind={l.kind} size={12} /> }
    : { bg: C.brandTint, fg: C.brand, icon: <KindIcon kind={l.kind} size={12} /> }
  return (
    <button disabled={locked} onClick={() => onPick(l)} aria-current={current ? 'true' : undefined} className="ezl-navrow"
      style={{ width: '100%', display: 'grid', gridTemplateColumns: '24px minmax(0,1fr)', gap: 10, alignItems: 'start', padding: '9px 10px', minHeight: 44, border: 0, borderRadius: R.md, background: current ? C.brandTint : 'transparent', textAlign: 'left', fontFamily: 'inherit', cursor: locked ? 'default' : 'pointer', opacity: 1 }}>
      <span style={{ width: 24, height: 24, borderRadius: R.pill, display: 'grid', placeItems: 'center', background: mark.bg, color: mark.fg }}>{mark.icon}</span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: F.small, lineHeight: 1.3, fontWeight: current ? W.semi : W.medium, color: locked ? C.muted : C.ink }}>{l.title}</span>
        <span style={{ display: 'block', fontSize: F.tiny, lineHeight: 1.35, color: C.muted, marginTop: 1, ...numeric }}>{sub}</span>
      </span>
    </button>
  )
}

function LessonNav({ view, currentId, shut, open, onToggle, onPick }: { view: PlayerView; currentId: string | null; shut: boolean; open: boolean; onToggle: () => void; onPick: (l: PlayerLesson) => void }) {
  const index = view.lessons.findIndex(l => l.id === currentId)
  return (
    <aside className="ezl-player-nav" aria-label="Lessons" style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: R.lg }}>
      <button className="ezl-navtoggle" aria-expanded={open} onClick={onToggle}
        style={{ width: '100%', alignItems: 'center', gap: S.sm, padding: `${S.sm + 2}px ${S.md}px`, background: 'transparent', border: 0, fontFamily: 'inherit', color: C.ink, textAlign: 'left' }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: F.small, fontWeight: W.semi }}>{index >= 0 ? `Lesson ${index + 1} of ${view.lessons.length}` : `${view.lessons.length} lessons`}</span>
        <span style={{ fontSize: F.tiny, color: C.muted, ...numeric }}>{view.state.done} of {view.state.total} done</span>
        <span style={{ color: C.muted, transform: open ? 'rotate(180deg)' : undefined, transition: 'transform .14s ease' }}><IconChevronDown size={16} /></span>
      </button>
      <div className="ezl-navlist" data-open={open ? '1' : '0'}>
        {view.modules.map(m => {
          const mine = view.lessons.filter(l => l.module_id === m.id)
          if (!mine.length) return null
          return (
            <div key={m.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: S.sm, padding: '4px 10px', fontSize: F.tiny, fontWeight: W.semi, color: C.muted }}>
                <span style={{ minWidth: 0 }}>{m.title}</span>
                <span style={{ flexShrink: 0, ...numeric }}>{mine.filter(l => l.done).length}/{mine.length}</span>
              </div>
              <div style={{ display: 'grid', gap: 1 }}>{mine.map(l => <NavRow key={l.id} l={l} current={l.id === currentId} shut={shut} onPick={onPick} />)}</div>
            </div>
          )
        })}
      </div>
    </aside>
  )
}

function CourseHeader({ view, backLabel, onClose }: { view: PlayerView; backLabel: string; onClose: () => void }) {
  const e = view.enrollment
  return (
    <div className="ezl-player-head" style={{ display: 'grid', gap: S.sm }}>
      <button className="ezl-linkbtn" style={{ fontSize: F.small, justifySelf: 'start' }} onClick={onClose}><IconBack size={15} /> {backLabel}</button>
      <div style={{ display: 'flex', alignItems: 'center', gap: S.sm, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: F.title, fontWeight: W.bold, letterSpacing: '-.015em', lineHeight: 1.25, minWidth: 0 }}>{view.course.title}</h2>
        {e.mandatory && <Badge t="brand" size="sm">Mandatory</Badge>}
        <DueBadge dueAt={e.due_at} overdue={e.overdue} status={e.status} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: S.md, alignItems: 'center' }}>
        <ProgressBar pct={view.state.progress_pct} label="Course progress" />
        <span style={{ fontSize: F.tiny, color: C.muted, ...numeric }}>{Math.round(view.state.progress_pct)}%</span>
      </div>
    </div>
  )
}

/** What the lesson's content needs before anything below it can start. */
function LessonBody({ lesson, opened, links, path, readOnly, onFinished, reopen, onVisited }: {
  lesson: PlayerLesson; opened: OpenedLesson; links: { url: string | null }; path: string; readOnly: boolean
  onFinished: () => void; reopen: () => Promise<OpenedLesson>; onVisited: () => void
}) {
  switch (lesson.kind) {
    case 'VIDEO': case 'AUDIO':
      return <MediaLesson lesson={lesson} opened={opened} path={path} readOnly={readOnly} onFinished={onFinished} reopen={reopen} />
    case 'DOCUMENT': case 'SLIDES':
      return <DocumentLesson opened={opened} url={links.url} />
    case 'ARTICLE':
      return <ArticleLesson body={opened.body} />
    case 'LINK':
      return <LinkLesson href={opened.external_url} onVisited={onVisited} />
    default:
      return null
  }
}

function FinishedNote({ lesson, next, complete, onQuiz, onNext, onFinish }: { lesson: PlayerLesson; next: PlayerLesson | null; complete: boolean; onQuiz: () => void; onNext: () => void; onFinish: () => void }) {
  const quizWaits = !!lesson.quiz && lesson.quiz.gate === 'READY'
  return (
    <div role="status" className="ez-rise" style={{ display: 'flex', alignItems: 'center', gap: S.md, flexWrap: 'wrap', background: C.positiveTint, border: `1px solid ${C.positiveEdge}`, borderRadius: R.md, padding: `${S.sm + 2}px ${S.md}px` }}>
      <span style={{ color: C.positive }}><IconCheck size={16} /></span>
      <span style={{ flex: '1 1 180px', fontSize: F.small, color: C.inkSoft }}>{complete ? 'That was the last step. You have finished this course.' : quizWaits ? 'You have finished this lesson. The quiz is open now.' : 'You have finished this lesson.'}</span>
      {complete ? <Button size="sm" variant="primary" onClick={onFinish}>See your results</Button>
        : quizWaits ? <Button size="sm" variant="primary" onClick={onQuiz}>Start the quiz</Button>
        : next && !next.locked ? <Button size="sm" variant="primary" onClick={onNext}>Next lesson</Button> : null}
    </div>
  )
}

function Footer({ lesson, prev, next, complete, onPick, onFinish }: { lesson: PlayerLesson; prev: PlayerLesson | null; next: PlayerLesson | null; complete: boolean; onPick: (l: PlayerLesson) => void; onFinish: () => void }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: S.sm, alignItems: 'center', flexWrap: 'wrap' }}>
      {prev && !prev.locked ? <Button icon={<IconBack size={14} />} onClick={() => onPick(prev)}>Previous</Button> : <span />}
      {next ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: S.sm, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {next.locked && <span style={{ fontSize: F.tiny, color: C.muted }}>{lesson.quiz?.required && !lesson.quiz.passed ? 'Pass the quiz to move on' : lockWords(next)}</span>}
          <Button variant={lesson.done && !next.locked ? 'primary' : 'secondary'} disabled={next.locked} onClick={() => onPick(next)}>Next lesson <IconForward size={14} /></Button>
        </div>
      ) : complete ? <Button variant="primary" onClick={onFinish}>See your results</Button> : <span />}
    </div>
  )
}

export default function Player({ enrollmentId, onClose, backLabel = 'My Learning', onOpenCourse, onSessionEnded }: {
  enrollmentId: string
  onClose: () => void
  backLabel?: string
  /** Absent means no "next up" card. */
  onOpenCourse?: (enrollmentId: string) => void
  /** A candidate's session ran out: their page goes back to the code step. */
  onSessionEnded?: () => void
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
  const [navOpen, setNavOpen] = useState(false)
  const [justFinished, setJustFinished] = useState(false)
  const [visited, setVisited] = useState(false)
  const openSeq = useRef(0)

  const ended = useCallback((e: unknown) => {
    if (e instanceof LmsApiError && e.status === 401 && onSessionEnded) { onSessionEnded(); return true }
    return false
  }, [onSessionEnded])

  const load = useCallback(async (): Promise<PlayerView | null> => {
    try {
      const v = await lmsApi<PlayerView>(path)
      setView(v); setErr('')
      return v
    } catch (e) {
      if (!ended(e)) setErr(errorWords(e))
      return null
    }
  }, [path, ended])

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

  const select = useCallback((id: string) => {
    setCurrentId(id); setPanel('lesson'); setNavOpen(false)
    setPaper(null); setResult(null); setQuizErr(''); setJustFinished(false); setVisited(false)
    void openLesson(id)
    window.scrollTo({ top: 0 })
  }, [openLesson])

  useEffect(() => {
    let live = true
    setView(null); setCurrentId(null); setOpened(null); setPanel('lesson')
    load().then(v => {
      if (!live || !v || v.gate || closedWords(v.enrollment.status)) return
      if (v.enrollment.status === 'COMPLETED') { setPanel('done'); return }
      const first = pickLesson(v)
      if (first) select(first.id)
    })
    return () => { live = false; openSeq.current++ }
  }, [load, select])

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

  const mark = useCallback(async (body: { done?: boolean; ack?: boolean }) => {
    const r = await lmsApi<{ status: string }>(path, { event: 'mark', lesson_id: lessonId, ...body })
    await load()
    if (r.status === 'COMPLETED') { setPanel('done'); window.scrollTo({ top: 0 }) }
  }, [path, lessonId, load])

  const onFinished = useCallback(() => { setJustFinished(true); void load() }, [load])

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

  if (err && !view) return <div style={{ display: 'grid', gap: S.md }}><button className="ezl-linkbtn" style={{ fontSize: F.small, justifySelf: 'start' }} onClick={onClose}><IconBack size={15} /> {backLabel}</button><Problem message={err} onRetry={() => void load()} /></div>
  if (!view) {
    return (
      <div style={{ display: 'grid', gap: S.md }}>
        <Skeleton w={110} /><Skeleton w="50%" h={22} /><Skeleton h={6} />
        <Skeleton h={320} r={R.lg} />
      </div>
    )
  }

  const shut = !!view.gate || !!closedWords(view.enrollment.status)
  const complete = view.enrollment.status === 'COMPLETED'
  const at = lesson ? view.lessons.indexOf(lesson) : -1
  const prev = at > 0 ? view.lessons[at - 1] : null
  const next = at >= 0 ? view.lessons[at + 1] || null : null
  const moduleOf = lesson ? view.modules.find(m => m.id === lesson.module_id) : null
  const showDone = () => { setPanel('done'); setCurrentId(null); window.scrollTo({ top: 0 }) }
  const media = lesson?.kind === 'VIDEO' || lesson?.kind === 'AUDIO'

  return (
    <div className="ezl-player ez-rise">
      <CourseHeader view={view} backLabel={backLabel} onClose={onClose} />
      <LessonNav view={view} currentId={panel === 'done' ? null : currentId} shut={shut} open={navOpen} onToggle={() => setNavOpen(o => !o)} onPick={pick} />

      <main className="ezl-player-main">
        {view.read_only && (
          <div style={{ fontSize: F.small, color: C.inkSoft, background: C.warningTint, border: `1px solid ${C.warningEdge}`, borderRadius: R.md, padding: `${S.sm + 2}px ${S.md}px` }}>
            This is someone else&apos;s portal. You can look around, but nothing here is saved or submitted.
          </div>
        )}

        {view.gate ? (
          <Card pad={S.xl} style={{ textAlign: 'center' }}>
            <div style={{ width: 44, height: 44, margin: '0 auto 10px', borderRadius: R.lg, background: C.sunken, color: C.muted, display: 'grid', placeItems: 'center' }}><IconLock size={20} /></div>
            <div style={{ fontWeight: W.semi, fontSize: F.lead }}>This course is not open yet</div>
            <div style={{ fontSize: F.small, color: C.muted, marginTop: 4, lineHeight: 1.55 }}>{view.gate}</div>
          </Card>
        ) : closedWords(view.enrollment.status) ? (
          <Card pad={S.xl} style={{ textAlign: 'center', fontSize: F.small, color: C.inkSoft, lineHeight: 1.6 }}>{closedWords(view.enrollment.status)}</Card>
        ) : panel === 'done' ? (
          <CourseDone view={view} path={path} backLabel={backLabel} onClose={onClose} onOpenCourse={onOpenCourse} />
        ) : !lesson ? (
          <Card pad={S.xl} style={{ textAlign: 'center', fontSize: F.small, color: C.muted }}>{view.lessons.length ? 'No lesson is open to you yet. Check the list for when the next one opens.' : 'This course has no lessons yet.'}</Card>
        ) : panel === 'quiz' && paper ? (
          <QuizRunner key={paper.attempt_id} paper={paper} onSubmit={submitQuiz} onLeave={() => { setPaper(null); setPanel('lesson'); void load() }} />
        ) : panel === 'result' && result ? (
          <QuizResult r={result} canNext={!!next && !next.locked} complete={complete} busy={quizBusy}
            onNext={() => next && select(next.id)} onRetry={startQuiz} onRewatch={() => select(lesson.id)} onFinish={showDone}
            onBack={() => { setResult(null); setPanel('lesson') }} />
        ) : (
          <>
            <div>
              <div style={{ fontSize: F.tiny, fontWeight: W.semi, color: C.muted, ...numeric }}>{[moduleOf?.title, `Lesson ${at + 1} of ${view.lessons.length}`].filter(Boolean).join(' · ')}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: S.sm, flexWrap: 'wrap', marginTop: 2 }}>
                <h3 style={{ margin: 0, fontSize: F.lead, fontWeight: W.semi, lineHeight: 1.3, minWidth: 0 }}>{lesson.title}</h3>
                {lesson.done && <Badge t="positive" size="sm">Completed</Badge>}
              </div>
              {lesson.summary && <div style={{ fontSize: F.small, color: C.muted, marginTop: 4, lineHeight: 1.55 }}>{lesson.summary}</div>}
            </div>

            {openErr ? <Problem message={openErr} onRetry={() => void openLesson(lesson.id)} />
              : !opened || opened.lesson_id !== lesson.id ? <Skeleton h={media ? 300 : 180} r={R.lg} />
              : <LessonBody key={`${lesson.id}:${openTick}`} lesson={lesson} opened={opened} links={links} path={path} readOnly={view.read_only} onFinished={onFinished} reopen={reopen} onVisited={() => setVisited(true)} />}

            {!!opened && opened.lesson_id === lesson.id && (
              <MarkBar key={`mark:${lesson.id}:${openTick}`} lesson={lesson} readOnly={view.read_only} dwellLeft={opened?.dwell_left_s} needsVisit={lesson.kind === 'LINK' && !visited && !lesson.content_done} onMark={mark} />
            )}

            {justFinished && media && lesson.content_done && !(lesson.require_ack && !lesson.ack_at) && (
              <FinishedNote lesson={lesson} next={next} complete={complete} onQuiz={startQuiz} onNext={() => next && select(next.id)} onFinish={showDone} />
            )}

            {lesson.quiz && (
              <QuizCard quiz={lesson.quiz} kind={lesson.kind} readOnly={view.read_only} complete={complete} busy={quizBusy} err={quizErr} hasOpenAttempt={!!lesson.quiz.open_attempt} onStart={startQuiz} onRefresh={() => void load()} />
            )}

            {!!opened && opened.lesson_id === lesson.id && <Resources items={links.resources} />}

            <Footer lesson={lesson} prev={prev} next={next} complete={complete} onPick={pick} onFinish={showDone} />
          </>
        )}
      </main>
    </div>
  )
}
