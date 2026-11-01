'use client'
// components/learning/PlayerQuiz.tsx — a quiz: what stands before it, the paper, the result.
//
// The paper carries no answer key and the server does all the marking. The only thing kept in
// the browser is the learner's own unsent answers (sessionStorage, by attempt), so a refresh
// mid-paper does not lose them. The review comes back with the result and is held in state.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Z, C, F, W, S, R, E, Badge, Button, Card, Input, numeric, IconAlert, IconCheck, IconClock, IconClose, IconLock } from '@/lib/ui'
import { IconQuiz, ProgressBar, errorWords, plural, timeWords, type PlayerQuiz, type QuizOutcome, type QuizPaper } from './shared'

type Answers = Record<string, string | string[]>
const draftKey = (attemptId: string) => `ezl-quiz:${attemptId}`
const readDraft = (attemptId: string): Answers => {
  try { return JSON.parse(sessionStorage.getItem(draftKey(attemptId)) || '{}') } catch { return {} }
}
const writeDraft = (attemptId: string, a: Answers) => { try { sessionStorage.setItem(draftKey(attemptId), JSON.stringify(a)) } catch { /* private mode */ } }
const dropDraft = (attemptId: string) => { try { sessionStorage.removeItem(draftKey(attemptId)) } catch { /* private mode */ } }

const answered = (a: string | string[] | undefined) => Array.isArray(a) ? a.length > 0 : !!String(a ?? '').trim()
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: F.tiny, color: C.muted }}>{label}</div>
      <div style={{ fontSize: F.small, fontWeight: W.semi, color: C.ink, ...numeric }}>{value}</div>
    </div>
  )
}

/** Counts down to a moment, and says when it has passed. */
function RetryCountdown({ at, onZero }: { at: string; onZero: () => void }) {
  const [left, setLeft] = useState(() => Math.max(0, Math.ceil((new Date(at).getTime() - Date.now()) / 1000)))
  const fired = useRef(false)
  useEffect(() => {
    const id = setInterval(() => {
      const s = Math.max(0, Math.ceil((new Date(at).getTime() - Date.now()) / 1000))
      setLeft(s)
      if (!s && !fired.current) { fired.current = true; onZero() }
    }, 1000)
    return () => clearInterval(id)
  }, [at, onZero])
  return <span style={numeric}>{left > 3600 ? `at ${timeWords(at)}` : `in ${clock(left)}`}</span>
}

/** Everything about a quiz before it starts, in each of the states the server can put it in. */
export function QuizCard({ quiz, kind, readOnly, complete, busy, err, hasOpenAttempt, onStart, onRefresh }: {
  quiz: PlayerQuiz
  kind: string
  readOnly: boolean
  complete: boolean
  busy: boolean
  err: string
  /** The last attempt was started and never handed in, so "no attempts left" is not yet true. */
  hasOpenAttempt: boolean
  onStart: () => void
  onRefresh: () => void
}) {
  const attempts = quiz.max_attempts == null ? 'No limit' : `${quiz.attempts_left ?? 0} of ${quiz.max_attempts} left`
  const best = quiz.best_pct != null ? `${Number(quiz.best_pct)}%` : 'None yet'
  const time = quiz.time_limit_minutes ? `${quiz.time_limit_minutes} min` : 'No limit'
  const gate = hasOpenAttempt ? 'READY' : quiz.gate
  const word = kind === 'ASSESSMENT' ? 'assessment' : 'quiz'
  return (
    <Card pad={S.lg} elevation="flat" style={{ display: 'grid', gap: S.md }}>
      <div style={{ display: 'flex', gap: S.md, alignItems: 'center' }}>
        <span style={{ width: 38, height: 38, borderRadius: R.md, display: 'grid', placeItems: 'center', flexShrink: 0, background: gate === 'PASSED' ? C.positiveTint : C.brandTint, color: gate === 'PASSED' ? C.positive : C.brand }}>{gate === 'PASSED' ? <IconCheck size={18} /> : <IconQuiz size={18} />}</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: W.semi, fontSize: F.body }}>{quiz.title}</div>
          {!quiz.required && <div style={{ fontSize: F.tiny, color: C.muted }}>Optional</div>}
        </div>
        {gate === 'PASSED' && <Badge t="positive">Passed</Badge>}
      </div>
      {quiz.instructions && gate !== 'PASSED' && <div style={{ fontSize: F.small, color: C.inkSoft, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{quiz.instructions}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(96px,1fr))', gap: S.md, padding: `${S.sm + 2}px ${S.md}px`, background: C.sunken, borderRadius: R.md }}>
        <Fact label="Pass mark" value={`${quiz.pass_pct}%`} />
        <Fact label="Attempts" value={attempts} />
        <Fact label="Best score" value={best} />
        <Fact label="Time limit" value={time} />
      </div>

      {err && <div role="alert" style={{ fontSize: F.small, color: C.critical }}>{err}</div>}

      {complete ? <div style={{ fontSize: F.small, color: C.muted }}>This course is complete, so the {word} is closed.</div>
        : gate === 'WATCH_FIRST' ? <Line icon={<IconLock size={15} />}>Finish the lesson above first. The {word} opens after it.</Line>
        : gate === 'COOLDOWN' ? <Line icon={<IconClock size={15} />}>You can try again <RetryCountdown at={quiz.retry_at!} onZero={onRefresh} />.</Line>
        : gate === 'LOCKED' ? <Line icon={<IconAlert size={15} />}>No attempts left. Ask HR for another attempt.</Line>
        : gate === 'READY' ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: S.md, flexWrap: 'wrap' }}>
            <Button variant="primary" disabled={busy || readOnly} onClick={onStart}>{busy ? 'Opening' : hasOpenAttempt ? 'Go back to your attempt' : quiz.best_pct != null ? 'Try again' : `Start the ${word}`}</Button>
            {!!quiz.time_limit_minutes && !hasOpenAttempt && <span style={{ fontSize: F.tiny, color: C.muted }}>The clock starts as soon as you begin.</span>}
          </div>
        ) : null}
    </Card>
  )
}

function Line({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return <div style={{ display: 'flex', gap: S.sm, alignItems: 'center', fontSize: F.small, color: C.inkSoft }}><span style={{ color: C.muted }}>{icon}</span><span>{children}</span></div>
}

function Option({ type, name, checked, label, onChange }: { type: 'radio' | 'checkbox'; name: string; checked: boolean; label: string; onChange: () => void }) {
  return (
    <label className="ezl-opt" style={{ display: 'flex', gap: S.sm + 2, alignItems: 'flex-start', padding: `${S.sm + 3}px ${S.md}px`, border: `1px solid ${C.line}`, borderRadius: R.md, cursor: 'pointer', fontSize: F.body, color: C.ink, lineHeight: 1.4, minHeight: 44 }}>
      <input type={type} name={name} checked={checked} onChange={onChange} style={{ width: 18, height: 18, marginTop: 1, flexShrink: 0, accentColor: C.brand }} />
      <span style={{ minWidth: 0 }}>{label}</span>
    </label>
  )
}

function Question({ q, n, total, value, flagged, onChange }: { q: QuizPaper['questions'][number]; n: number; total: number; value: string | string[] | undefined; flagged: boolean; onChange: (v: string | string[]) => void }) {
  const many = Array.isArray(value) ? value : []
  return (
    <Card pad={S.lg} elevation="flat" style={flagged ? { border: `1px solid ${C.warningEdge}` } : undefined}>
      <div id={`ezl-q-${q.id}`} style={{ fontSize: F.tiny, fontWeight: W.semi, color: C.muted, marginBottom: 4, scrollMarginTop: 90, ...numeric }}>Question {n} of {total}{q.marks !== 1 ? ` · ${q.marks} marks` : ''}</div>
      <div style={{ fontSize: F.lead, fontWeight: W.semi, lineHeight: 1.45, whiteSpace: 'pre-wrap', marginBottom: S.md }}>{q.prompt}</div>
      {q.kind === 'MULTI' && <div style={{ fontSize: F.tiny, color: C.muted, marginTop: -6, marginBottom: S.sm }}>Choose all that apply.</div>}
      {q.kind === 'SHORT_TEXT' ? (
        <Input data-no-titlecase="" aria-label={`Answer to question ${n}`} value={String(value ?? '')} placeholder="Type your answer" maxLength={500} onChange={e => onChange(e.target.value)} />
      ) : (
        <div style={{ display: 'grid', gap: 6 }}>
          {q.options.map(o => q.kind === 'MULTI'
            ? <Option key={o.id} type="checkbox" name={q.id} label={o.text} checked={many.includes(o.id)} onChange={() => onChange(many.includes(o.id) ? many.filter(x => x !== o.id) : [...many, o.id])} />
            : <Option key={o.id} type="radio" name={q.id} label={o.text} checked={value === o.id} onChange={() => onChange(o.id)} />)}
        </div>
      )}
    </Card>
  )
}

export function QuizRunner({ paper, onSubmit, onLeave }: { paper: QuizPaper; onSubmit: (answers: Answers) => Promise<void>; onLeave: () => void }) {
  const [answers, setAnswers] = useState<Answers>(() => ({ ...paper.answers, ...readDraft(paper.attempt_id) }))
  const [left, setLeft] = useState(paper.seconds_left)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [timedOut, setTimedOut] = useState(false)
  const latest = useRef(answers)
  const sending = useRef(false)
  const deadline = useRef<number | null>(null)

  const total = paper.questions.length
  const missing = useMemo(() => paper.questions.filter(q => !answered(answers[q.id])), [paper.questions, answers])

  const send = useCallback(async () => {
    if (sending.current) return
    sending.current = true
    setBusy(true); setErr(''); setConfirming(false)
    try {
      await onSubmit(latest.current)
      dropDraft(paper.attempt_id)
    } catch (e) { setErr(errorWords(e)); sending.current = false; setBusy(false) }
  }, [onSubmit, paper.attempt_id])
  const sendRef = useRef(send)
  useEffect(() => { sendRef.current = send }, [send])

  useEffect(() => {
    if (paper.seconds_left == null) return
    deadline.current ??= Date.now() + paper.seconds_left * 1000
    let fired = false
    const tick = () => {
      const s = Math.max(0, Math.ceil((deadline.current! - Date.now()) / 1000))
      setLeft(s)
      if (!s && !fired) { fired = true; setTimedOut(true); void sendRef.current() }
    }
    tick()
    const id = setInterval(tick, 1000)
    // A throttled background tab: catch up the moment it is looked at again.
    document.addEventListener('visibilitychange', tick)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', tick) }
  }, [paper.seconds_left])

  const set = (id: string, v: string | string[]) => {
    const next = { ...latest.current, [id]: v }
    latest.current = next
    setAnswers(next)
    writeDraft(paper.attempt_id, next)
  }
  const tryHandIn = () => { if (missing.length) { setConfirming(true); document.getElementById(`ezl-q-${missing[0].id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) } else void send() }
  const low = left != null && left <= 60

  return (
    <div style={{ display: 'grid', gap: S.md }}>
      <div className="ezl-quizbar" style={{ zIndex: Z.raised, background: C.surface, border: `1px solid ${C.line}`, borderRadius: R.lg, boxShadow: E.raised, padding: `${S.sm + 2}px ${S.md}px`, display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: S.md, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 160px', minWidth: 0 }}>
            <div style={{ fontWeight: W.semi, fontSize: F.body, lineHeight: 1.25 }}>{paper.title}</div>
            <div style={{ fontSize: F.tiny, color: C.muted, ...numeric }}>Attempt {paper.attempt_no} · Pass mark {paper.pass_pct}% · {total - missing.length} of {total} answered</div>
          </div>
          {left != null && (
            <span role="timer" aria-label={`${clock(left)} left`} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: R.pill, fontSize: F.small, fontWeight: W.semi, background: low ? C.criticalTint : C.sunken, color: low ? C.critical : C.inkSoft, ...numeric }}><IconClock size={14} />{clock(left)}</span>
          )}
        </div>
        <ProgressBar pct={total ? ((total - missing.length) / total) * 100 : 0} height={4} label="Questions answered" />
      </div>

      {paper.instructions && <div style={{ fontSize: F.small, color: C.inkSoft, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{paper.instructions}</div>}

      {paper.questions.map((q, i) => (
        <Question key={q.id} q={q} n={i + 1} total={total} value={answers[q.id]} flagged={confirming && !answered(answers[q.id])} onChange={v => set(q.id, v)} />
      ))}

      {confirming && missing.length > 0 && (
        <div role="alert" style={{ display: 'grid', gap: S.sm, background: C.warningTint, border: `1px solid ${C.warningEdge}`, borderRadius: R.md, padding: S.md }}>
          <div style={{ fontSize: F.small, color: C.inkSoft }}>{plural(missing.length, 'question')} not answered yet. Unanswered questions score nothing.</div>
          <div style={{ display: 'flex', gap: S.sm, flexWrap: 'wrap' }}>
            <Button onClick={() => setConfirming(false)}>Keep going</Button>
            <Button variant="primary" disabled={busy} onClick={() => void send()}>Submit anyway</Button>
          </div>
        </div>
      )}
      {timedOut && !err && <div role="status" style={{ fontSize: F.small, color: C.inkSoft }}>Time is up. Handing in your answers.</div>}
      {err && (
        <div role="alert" style={{ display: 'grid', gap: S.sm, background: C.criticalTint, border: `1px solid ${C.criticalEdge}`, borderRadius: R.md, padding: S.md }}>
          <div style={{ fontSize: F.small, color: C.inkSoft }}>{err}</div>
          <div style={{ display: 'flex', gap: S.sm, flexWrap: 'wrap' }}>
            <Button variant="primary" disabled={busy} onClick={() => void send()}>Try again</Button>
            <Button onClick={onLeave}>Back to the lesson</Button>
          </div>
        </div>
      )}
      {!confirming && !err && (
        <div style={{ display: 'flex', gap: S.sm, flexWrap: 'wrap' }}>
          <Button variant="primary" size="lg" disabled={busy} onClick={tryHandIn}>{busy ? 'Submitting' : 'Submit answers'}</Button>
          {left == null && <Button size="lg" disabled={busy} onClick={onLeave}>Save and leave</Button>}
        </div>
      )}
    </div>
  )
}

function ReviewItem({ r, n }: { r: NonNullable<QuizOutcome['review']>[number]; n: number }) {
  const chosen = Array.isArray(r.your_answer) ? r.your_answer : r.your_answer != null ? [r.your_answer] : []
  return (
    <div style={{ padding: S.md, borderTop: n > 1 ? `1px solid ${C.line}` : 0, display: 'grid', gap: S.sm }}>
      <div style={{ display: 'flex', gap: S.sm, alignItems: 'flex-start' }}>
        <span aria-label={r.correct ? 'Correct' : 'Not correct'} style={{ width: 22, height: 22, borderRadius: R.pill, display: 'grid', placeItems: 'center', flexShrink: 0, background: r.correct ? C.positiveTint : C.criticalTint, color: r.correct ? C.positive : C.critical }}>{r.correct ? <IconCheck size={13} /> : <IconClose size={13} />}</span>
        <div style={{ minWidth: 0, fontSize: F.small, fontWeight: W.semi, lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>{n}. {r.prompt}</div>
      </div>
      {r.kind === 'SHORT_TEXT' ? (
        <div style={{ fontSize: F.small, color: C.inkSoft, paddingLeft: 30, display: 'grid', gap: 2 }}>
          <span>Your answer: {chosen[0] ? String(chosen[0]) : 'Not answered'}</span>
          {!r.correct && !!r.accepted?.length && <span>Accepted: {r.accepted.join(', ')}</span>}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 4, paddingLeft: 30 }}>
          {r.options.map(o => {
            const mine = chosen.includes(o.id)
            return (
              <div key={o.id} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', fontSize: F.small, color: o.correct ? C.positive : C.inkSoft, fontWeight: o.correct ? W.semi : W.regular }}>
                {o.correct ? <IconCheck size={13} /> : <span style={{ width: 13, flexShrink: 0 }} />}
                <span style={{ minWidth: 0 }}>{o.text}</span>
                {mine && <span style={{ fontSize: F.tiny, color: C.muted, fontWeight: W.regular }}>Your answer</span>}
              </div>
            )
          })}
        </div>
      )}
      {r.explanation && <div style={{ fontSize: F.small, color: C.muted, lineHeight: 1.5, paddingLeft: 30, whiteSpace: 'pre-wrap' }}>{r.explanation}</div>}
    </div>
  )
}

export function QuizResult({ r, canNext, complete, busy, onNext, onRetry, onRewatch, onFinish, onBack }: {
  r: QuizOutcome
  canNext: boolean
  complete: boolean
  busy: boolean
  onNext: () => void
  onRetry: () => void
  onRewatch: () => void
  onFinish: () => void
  onBack: () => void
}) {
  const cooling = r.cooldown_minutes > 0
  const retry = !r.passed && !r.sent_back && !r.locked && r.attempts_left !== 0
  const headline = r.late ? 'Time ran out' : r.passed ? 'You passed' : 'Not this time'
  const sub = r.late ? 'This attempt ended before it was handed in, so it does not count as a pass.'
    : r.passed ? 'Well done.'
    : r.sent_back ? 'You have used all your attempts. Go through the lesson again and you will get a fresh set.'
    : r.locked ? 'You have used all your attempts. Ask HR for another attempt.'
    : retry && cooling ? `You can try again in ${plural(r.cooldown_minutes, 'minute')}.`
    : 'You can look over the lesson and try again.'
  return (
    <div style={{ display: 'grid', gap: S.md }}>
      <Card pad={S.xl} className="ez-rise" style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 40, fontWeight: W.bold, lineHeight: 1.1, letterSpacing: '-.02em', color: r.passed ? C.positive : C.ink, ...numeric }}>{Number(r.pct)}%</div>
        <div style={{ fontSize: F.title, fontWeight: W.semi, marginTop: 6 }}>{headline}</div>
        <div style={{ fontSize: F.small, color: C.muted, marginTop: 4, lineHeight: 1.55 }}>{sub}</div>
        <div style={{ fontSize: F.tiny, color: C.muted, marginTop: 8, ...numeric }}>
          Pass mark {r.pass_pct}%{r.attempts_left != null && !r.passed ? ` · ${plural(r.attempts_left, 'attempt')} left` : ''}
        </div>
        <div style={{ display: 'flex', gap: S.sm, justifyContent: 'center', flexWrap: 'wrap', marginTop: S.lg }}>
          {complete ? <Button variant="primary" onClick={onFinish}>See your results</Button>
            : r.passed ? (canNext ? <Button variant="primary" onClick={onNext}>Next lesson</Button> : <Button variant="primary" onClick={onBack}>Back to the lesson</Button>)
            : r.sent_back ? <Button variant="primary" onClick={onRewatch}>Go through the lesson again</Button>
            : retry ? (
              <>
                {!cooling && <Button variant="primary" disabled={busy} onClick={onRetry}>{busy ? 'Opening' : 'Try again'}</Button>}
                <Button onClick={onBack}>Back to the lesson</Button>
              </>
            ) : <Button onClick={onBack}>Back to the lesson</Button>}
        </div>
      </Card>
      {r.review && r.review.length > 0 && (
        <Card pad={0} elevation="flat" style={{ overflow: 'hidden' }}>
          <div style={{ padding: `${S.sm + 4}px ${S.md}px`, fontWeight: W.semi, fontSize: F.small, borderBottom: `1px solid ${C.line}` }}>Your answers</div>
          {r.review.map((item, i) => <ReviewItem key={item.question_id} r={item} n={i + 1} />)}
        </Card>
      )}
      {r.passed === false && r.review == null && <div style={{ fontSize: F.tiny, color: C.muted, textAlign: 'center' }}>The answers are shown once you pass.</div>}
    </div>
  )
}

