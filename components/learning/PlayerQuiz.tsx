'use client'
// components/learning/PlayerQuiz.tsx — a quiz: what stands before it, the paper, the result.
//
// The paper carries no answer key and the server does all the marking. The only thing kept in
// the browser is the learner's own unsent answers (sessionStorage, by attempt), so a refresh
// mid-paper does not lose them. The review comes back with the result and is held in state.
//
// The paper is one question at a time, the way people sit a test on a learning site, with a
// map of every question beside it so nothing has to be answered in order.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { IconAlert, IconCheck, IconClock, IconClose, IconLock } from '@/lib/ui'
import { errorWords, plural, timeWords, type PlayerQuiz, type QuizOutcome, type QuizPaper } from './shared'
import { GFlag, GLeft, GRedo, GRight, GTarget, GTrophy } from './glyphs'

type Answers = Record<string, string | string[]>
const draftKey = (attemptId: string) => `ezl-quiz:${attemptId}`
const readDraft = (attemptId: string): Answers => {
  try { return JSON.parse(sessionStorage.getItem(draftKey(attemptId)) || '{}') } catch { return {} }
}
const writeDraft = (attemptId: string, a: Answers) => { try { sessionStorage.setItem(draftKey(attemptId), JSON.stringify(a)) } catch { /* private mode */ } }
const dropDraft = (attemptId: string) => { try { sessionStorage.removeItem(draftKey(attemptId)) } catch { /* private mode */ } }

const answered = (a: string | string[] | undefined) => Array.isArray(a) ? a.length > 0 : !!String(a ?? '').trim()
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
const LETTERS = 'ABCDEFGHIJKLMNOP'
const KIND_HINT: Record<string, string> = { SINGLE: 'Choose one answer', MULTI: 'Choose all that apply', TRUE_FALSE: 'True or false', SHORT_TEXT: 'Type a short answer' }

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
  return <span className="lx-num">{left > 3600 ? `at ${timeWords(at)}` : `in ${clock(left)}`}</span>
}

function Line({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return <div style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 14, color: 'var(--ez-ink-soft)' }}><span style={{ color: 'var(--ez-muted)' }}>{icon}</span><span>{children}</span></div>
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
  const attempts = quiz.max_attempts == null ? 'No limit' : `${quiz.attempts_left ?? 0} of ${quiz.max_attempts}`
  const best = quiz.best_pct != null ? `${Number(quiz.best_pct)}%` : 'None yet'
  const time = quiz.time_limit_minutes ? `${quiz.time_limit_minutes} min` : 'No limit'
  const gate = hasOpenAttempt ? 'READY' : quiz.gate
  const word = kind === 'ASSESSMENT' ? 'assessment' : 'quiz'
  return (
    <section className="lx-qcard" data-passed={gate === 'PASSED' ? '1' : '0'}>
      <div className="lx-qcard-head">
        <span>{gate === 'PASSED' ? <IconCheck size={22} /> : <GTarget size={22} />}</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 750, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--ez-muted)' }}>{kind === 'ASSESSMENT' ? 'Assessment' : 'Knowledge check'}{!quiz.required ? ' · optional' : ''}</div>
          <div style={{ fontWeight: 750, fontSize: 17, marginTop: 2 }}>{quiz.title}</div>
        </div>
        {gate === 'PASSED' && <span className="lx-tag lx-tag--positive">Passed</span>}
      </div>
      <div className="lx-qfacts">
        <div><span>Pass mark</span><b>{quiz.pass_pct}%</b></div>
        <div><span>Attempts left</span><b>{attempts}</b></div>
        <div><span>Best score</span><b>{best}</b></div>
        <div><span>Time limit</span><b>{time}</b></div>
      </div>
      <div style={{ padding: '16px 20px', display: 'grid', gap: 12 }}>
        {quiz.instructions && gate !== 'PASSED' && <div style={{ fontSize: 14, color: 'var(--ez-ink-soft)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{quiz.instructions}</div>}
        {err && <div role="alert" style={{ fontSize: 13.5, color: 'var(--ez-critical)' }}>{err}</div>}
        {complete ? <div style={{ fontSize: 14, color: 'var(--ez-muted)' }}>This course is complete, so the {word} is closed.</div>
          : gate === 'WATCH_FIRST' ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <Line icon={<IconLock size={16} />}>Finish the lesson first. The {word} opens right after it.</Line>
              <button className="lx-sec-link" onClick={onRefresh}>Finished it? Check again</button>
            </div>
          )
          : gate === 'COOLDOWN' ? <Line icon={<IconClock size={16} />}>You can try again <RetryCountdown at={quiz.retry_at!} onZero={onRefresh} />.</Line>
          : gate === 'LOCKED' ? <Line icon={<IconAlert size={16} />}>No attempts left. Ask HR for another attempt.</Line>
          : gate === 'PASSED' ? <Line icon={<GTrophy size={16} />}>Well done. Your best score counts.</Line>
          : gate === 'READY' ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <button className="lx-btn lx-btn--primary lx-btn--lg" disabled={busy || readOnly} onClick={onStart}>
                {busy ? 'Opening…' : hasOpenAttempt ? 'Go back to your attempt' : quiz.best_pct != null ? <><GRedo size={17} /> Try again</> : <><GTarget size={17} /> Start the {word}</>}
              </button>
              {!!quiz.time_limit_minutes && !hasOpenAttempt && <span style={{ fontSize: 13, color: 'var(--ez-muted)' }}>The clock starts as soon as you begin.</span>}
            </div>
          ) : null}
      </div>
    </section>
  )
}

function Choice({ type, name, checked, letter, label, onChange }: { type: 'radio' | 'checkbox'; name: string; checked: boolean; letter: string; label: string; onChange: () => void }) {
  return (
    <label className="lx-opt" data-multi={type === 'checkbox' ? '1' : '0'}>
      <input type={type} name={name} checked={checked} onChange={onChange} />
      <span className="lx-opt-key">{letter}</span>
      <span style={{ minWidth: 0 }}>{label}</span>
      <span className="lx-opt-tick"><IconCheck size={12} /></span>
    </label>
  )
}

function Question({ q, value, onChange }: { q: QuizPaper['questions'][number]; value: string | string[] | undefined; onChange: (v: string | string[]) => void }) {
  const many = Array.isArray(value) ? value : []
  if (q.kind === 'SHORT_TEXT') {
    return <input className="lx-input" data-no-titlecase="" aria-label="Your answer" value={String(value ?? '')} placeholder="Type your answer" maxLength={500} onChange={e => onChange(e.target.value)} />
  }
  if (q.kind === 'TRUE_FALSE') {
    return (
      <div className="lx-tf" role="radiogroup">
        {q.options.map((o, i) => <Choice key={o.id} type="radio" name={q.id} letter={LETTERS[i]} label={o.text} checked={value === o.id} onChange={() => onChange(o.id)} />)}
      </div>
    )
  }
  return (
    <div className="lx-opts" role={q.kind === 'MULTI' ? 'group' : 'radiogroup'}>
      {q.options.map((o, i) => q.kind === 'MULTI'
        ? <Choice key={o.id} type="checkbox" name={q.id} letter={LETTERS[i]} label={o.text} checked={many.includes(o.id)} onChange={() => onChange(many.includes(o.id) ? many.filter(x => x !== o.id) : [...many, o.id])} />
        : <Choice key={o.id} type="radio" name={q.id} letter={LETTERS[i]} label={o.text} checked={value === o.id} onChange={() => onChange(o.id)} />)}
    </div>
  )
}

export function QuizRunner({ paper, onSubmit, onLeave }: { paper: QuizPaper; onSubmit: (answers: Answers) => Promise<void>; onLeave: () => void }) {
  const [answers, setAnswers] = useState<Answers>(() => ({ ...paper.answers, ...readDraft(paper.attempt_id) }))
  const [at, setAt] = useState(0)
  const [flags, setFlags] = useState<Set<string>>(new Set())
  const [left, setLeft] = useState(paper.seconds_left)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [timedOut, setTimedOut] = useState(false)
  const latest = useRef(answers)
  const sending = useRef(false)
  const deadline = useRef<number | null>(null)

  const total = paper.questions.length
  const q = paper.questions[at]
  const missing = useMemo(() => paper.questions.filter(x => !answered(answers[x.id])), [paper.questions, answers])

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

  // Number keys pick an option, Enter moves on: a test can be taken without the mouse.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (/INPUT|TEXTAREA/.test(t.tagName) && (t as HTMLInputElement).type !== 'radio' && (t as HTMLInputElement).type !== 'checkbox') return
      if (!q || q.kind === 'SHORT_TEXT' || e.metaKey || e.ctrlKey || e.altKey) return
      const i = 'abcdefghijklmnop'.indexOf(e.key.toLowerCase())
      const n = Number(e.key) - 1
      const pickAt = i >= 0 && i < q.options.length ? i : n >= 0 && n < q.options.length ? n : -1
      if (pickAt >= 0) {
        const id = q.options[pickAt].id
        if (q.kind === 'MULTI') { const cur = Array.isArray(latest.current[q.id]) ? latest.current[q.id] as string[] : []; set(q.id, cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id]) }
        else set(q.id, id)
      } else if (e.key === 'ArrowRight' && at < total - 1) setAt(at + 1)
      else if (e.key === 'ArrowLeft' && at > 0) setAt(at - 1)
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }) // eslint-disable-line react-hooks/exhaustive-deps

  const set = (id: string, v: string | string[]) => {
    const next = { ...latest.current, [id]: v }
    latest.current = next
    setAnswers(next)
    writeDraft(paper.attempt_id, next)
  }
  const flag = () => setFlags(f => { const x = new Set(f); if (x.has(q.id)) x.delete(q.id); else x.add(q.id); return x })
  const tryHandIn = () => { if (missing.length) { setConfirming(true); setAt(paper.questions.indexOf(missing[0])) } else void send() }
  const low = left != null && left <= 60
  const done = total - missing.length

  return (
    <div className="lx-qrun" style={{ padding: '24px 0 40px' }}>
      <div className="lx-qpaper">
        <div className="lx-qpaper-top">
          <div style={{ flex: '1 1 200px', minWidth: 0 }}>
            <div style={{ fontWeight: 750, fontSize: 16 }}>{paper.title}</div>
            <div className="lx-num" style={{ fontSize: 12.5, color: 'var(--ez-muted)', marginTop: 2 }}>Attempt {paper.attempt_no} · Pass mark {paper.pass_pct}% · {done} of {total} answered</div>
          </div>
          {left != null && <span className="lx-timer" data-low={low ? '1' : '0'} role="timer" aria-label={`${clock(left)} left`}><IconClock size={15} />{clock(left)}</span>}
        </div>
        <div className="lx-bar" style={{ borderRadius: 0, height: 4 }}><i style={{ width: `${total ? (done / total) * 100 : 0}%` }} /></div>
        {q && (
          <div className="lx-qbody lx-in" key={q.id}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <span className="lx-qn">Question {at + 1} of {total}{q.marks !== 1 ? ` · ${q.marks} marks` : ''}</span>
              <span style={{ fontSize: 12.5, color: 'var(--ez-muted)', fontWeight: 600 }}>{KIND_HINT[q.kind]}</span>
            </div>
            {at === 0 && paper.instructions && <div className="lx-note">{paper.instructions}</div>}
            <div className="lx-qprompt">{q.prompt}</div>
            <Question q={q} value={answers[q.id]} onChange={v => set(q.id, v)} />
          </div>
        )}
        <div className="lx-qfoot">
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="lx-btn" disabled={at === 0} onClick={() => setAt(at - 1)}><GLeft size={16} /> Previous</button>
            <button className="lx-btn lx-btn--ghost" aria-pressed={flags.has(q?.id)} onClick={flag} title="Mark this question to come back to"><GFlag size={15} /> {flags.has(q?.id) ? 'Marked' : 'Mark for review'}</button>
          </div>
          {at < total - 1
            ? <button className="lx-btn lx-btn--primary" onClick={() => setAt(at + 1)}>Next question <GRight size={16} /></button>
            : <button className="lx-btn lx-btn--primary" disabled={busy} onClick={tryHandIn}>{busy ? 'Submitting…' : 'Submit answers'}</button>}
        </div>
      </div>

      <aside className="lx-qnav" aria-label="Questions">
        <div style={{ fontWeight: 750, fontSize: 14 }}>Questions</div>
        <div className="lx-qdots">
          {paper.questions.map((x, i) => (
            <button key={x.id} className="lx-qdot" aria-current={i === at ? 'true' : undefined} data-done={answered(answers[x.id]) ? '1' : '0'} data-flag={flags.has(x.id) || (confirming && !answered(answers[x.id])) ? '1' : '0'}
              onClick={() => setAt(i)} aria-label={`Question ${i + 1}${answered(answers[x.id]) ? ', answered' : ''}`}>{i + 1}</button>
          ))}
        </div>
        <div style={{ display: 'grid', gap: 6, fontSize: 12.5, color: 'var(--ez-muted)' }}>
          <span><span className="lx-qdot" data-done="1" style={{ display: 'inline-block', width: 14, height: 14, borderRadius: 4, verticalAlign: '-2px', marginRight: 6 }} />Answered</span>
          <span><span className="lx-qdot" data-flag="1" style={{ display: 'inline-block', width: 14, height: 14, borderRadius: 4, verticalAlign: '-2px', marginRight: 6 }} />Marked or missing</span>
        </div>
        {confirming && missing.length > 0 && (
          <div role="alert" className="lx-note" data-t="warning" style={{ display: 'grid', gap: 10 }}>
            <span>{plural(missing.length, 'question')} not answered yet. Unanswered questions score nothing.</span>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="lx-btn lx-btn--sm" onClick={() => setConfirming(false)}>Keep going</button>
              <button className="lx-btn lx-btn--sm lx-btn--primary" disabled={busy} onClick={() => void send()}>Submit anyway</button>
            </div>
          </div>
        )}
        {timedOut && !err && <div role="status" className="lx-note">Time is up. Handing in your answers.</div>}
        {err && (
          <div role="alert" className="lx-problem" style={{ display: 'grid', gap: 10 }}>
            <span>{err}</span>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="lx-btn lx-btn--sm lx-btn--primary" disabled={busy} onClick={() => void send()}>Try again</button>
              <button className="lx-btn lx-btn--sm" onClick={onLeave}>Back to the lesson</button>
            </div>
          </div>
        )}
        {!confirming && !err && (
          <div style={{ display: 'grid', gap: 8 }}>
            <button className="lx-btn lx-btn--primary lx-btn--full" disabled={busy} onClick={tryHandIn}>{busy ? 'Submitting…' : 'Submit answers'}</button>
            {left == null && <button className="lx-btn lx-btn--full" disabled={busy} onClick={onLeave}>Save and leave</button>}
          </div>
        )}
      </aside>
    </div>
  )
}

function ReviewItem({ r, n }: { r: NonNullable<QuizOutcome['review']>[number]; n: number }) {
  const chosen = Array.isArray(r.your_answer) ? r.your_answer : r.your_answer != null ? [r.your_answer] : []
  return (
    <div className="lx-rv">
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <span aria-label={r.correct ? 'Correct' : 'Not correct'} style={{ width: 26, height: 26, borderRadius: '50%', display: 'grid', placeItems: 'center', flexShrink: 0, background: r.correct ? 'var(--ez-positive)' : 'var(--ez-critical)', color: 'var(--ez-on-accent)' }}>{r.correct ? <IconCheck size={14} /> : <IconClose size={14} />}</span>
        <div style={{ minWidth: 0, fontSize: 15, fontWeight: 650, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{n}. {r.prompt}</div>
        <span className="lx-num" style={{ marginLeft: 'auto', fontSize: 12.5, color: 'var(--ez-muted)', whiteSpace: 'nowrap' }}>{r.earned} / {r.marks}</span>
      </div>
      {r.kind === 'SHORT_TEXT' ? (
        <div style={{ fontSize: 14, color: 'var(--ez-ink-soft)', paddingLeft: 36, display: 'grid', gap: 4 }}>
          <span>Your answer: <b>{chosen[0] ? String(chosen[0]) : 'Not answered'}</b></span>
          {!r.correct && !!r.accepted?.length && <span>Accepted: {r.accepted.join(', ')}</span>}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 6, paddingLeft: 36 }}>
          {r.options.map((o, i) => {
            const mine = chosen.includes(o.id)
            return (
              <div key={o.id} className="lx-rv-opt" data-correct={o.correct ? '1' : '0'} data-wrong={mine && !o.correct ? '1' : '0'}>
                <b style={{ width: 18, color: 'var(--ez-muted)' }}>{LETTERS[i]}</b>
                <span style={{ flex: 1, minWidth: 0 }}>{o.text}</span>
                {o.correct && <span style={{ color: 'var(--ez-positive)', display: 'inline-flex' }}><IconCheck size={15} /></span>}
                {mine && <span className="lx-tag" style={{ height: 20, fontSize: 11 }}>Your answer</span>}
              </div>
            )
          })}
        </div>
      )}
      {r.explanation && <div className="lx-note" style={{ marginLeft: 36 }}>{r.explanation}</div>}
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
  const headline = r.late ? 'Time ran out' : r.passed ? 'You passed!' : 'Not this time'
  const sub = r.late ? 'This attempt ended before it was handed in, so it does not count as a pass.'
    : r.passed ? 'Well done. You can move on.'
    : r.sent_back ? 'You have used all your attempts. Go through the lesson again and you will get a fresh set.'
    : r.locked ? 'You have used all your attempts. Ask HR for another attempt.'
    : retry && cooling ? `You can try again in ${plural(r.cooldown_minutes, 'minute')}.`
    : 'Look over the lesson, then try again.'
  const right = (r.review || []).filter(x => x.correct).length
  return (
    <div style={{ display: 'grid', gap: 18, padding: '24px 0 40px' }}>
      <section className="lx-result lx-in" data-pass={r.passed ? '1' : '0'}>
        <span style={{ position: 'relative' }}>
          <svg width={150} height={150} viewBox="0 0 150 150" style={{ transform: 'rotate(-90deg)' }} aria-hidden>
            <circle cx={75} cy={75} r={64} fill="none" strokeWidth={12} style={{ stroke: 'var(--ez-sunken)' }} />
            <circle cx={75} cy={75} r={64} fill="none" strokeWidth={12} strokeLinecap="round" strokeDasharray={402} strokeDashoffset={402 - (Math.min(100, Number(r.pct)) / 100) * 402}
              style={{ stroke: r.passed ? 'var(--ez-positive)' : 'var(--ez-warning)', transition: 'stroke-dashoffset 1s ease' }} />
          </svg>
          <b className="lx-num" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: 34, fontWeight: 800, letterSpacing: '-.03em' }}>{Number(r.pct)}%</b>
        </span>
        <h2>{headline}</h2>
        <p style={{ color: 'var(--ez-muted)', maxWidth: 480, lineHeight: 1.6 }}>{sub}</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          <span className="lx-tag">Pass mark {r.pass_pct}%</span>
          <span className="lx-tag lx-num">Score {r.score} of {r.max_score}</span>
          {r.review && <span className="lx-tag lx-tag--positive lx-num">{right} of {r.review.length} correct</span>}
          {r.attempts_left != null && !r.passed && <span className="lx-tag lx-tag--warning">{plural(r.attempts_left, 'attempt')} left</span>}
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap', marginTop: 8 }}>
          {complete ? <button className="lx-btn lx-btn--primary lx-btn--lg" onClick={onFinish}><GTrophy size={18} /> See your results</button>
            : r.passed ? (canNext ? <button className="lx-btn lx-btn--primary lx-btn--lg" onClick={onNext}>Next lesson <GRight size={17} /></button> : <button className="lx-btn lx-btn--primary lx-btn--lg" onClick={onBack}>Back to the lesson</button>)
            : r.sent_back ? <button className="lx-btn lx-btn--primary lx-btn--lg" onClick={onRewatch}>Go through the lesson again</button>
            : retry ? (
              <>
                {!cooling && <button className="lx-btn lx-btn--primary lx-btn--lg" disabled={busy} onClick={onRetry}><GRedo size={17} /> {busy ? 'Opening…' : 'Try again'}</button>}
                <button className="lx-btn lx-btn--lg" onClick={onBack}>Back to the lesson</button>
              </>
            ) : <button className="lx-btn lx-btn--lg" onClick={onBack}>Back to the lesson</button>}
        </div>
      </section>
      {r.review && r.review.length > 0 && (
        <section className="lx-panel">
          <div className="lx-panel-head"><div className="lx-panel-title">Your answers</div><span style={{ fontSize: 12.5, color: 'var(--ez-muted)' }}>Correct answers are marked in green</span></div>
          {r.review.map((item, i) => <ReviewItem key={item.question_id} r={item} n={i + 1} />)}
        </section>
      )}
      {r.passed === false && r.review == null && <div style={{ fontSize: 13, color: 'var(--ez-muted)', textAlign: 'center' }}>The answers are shown once you pass.</div>}
    </div>
  )
}
