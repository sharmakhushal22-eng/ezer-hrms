'use client'
// components/learning/PlayerDone.tsx — the end of a course: what they got, a word about the
// course if they care to leave one, and what comes next.
import { useEffect, useState } from 'react'
import { C, F, W, S, R, Button, Card, numeric, IconCheck, IconDownload } from '@/lib/ui'
import { lmsApi, lmsDownload } from '@/lib/lms/client'
import { DueBadge, IconStar, dayWords, errorWords, type Dashboard, type LearnItem, type PlayerView } from './shared'

function StarInput({ value, disabled, onChange }: { value: number; disabled: boolean; onChange: (n: number) => void }) {
  const [hover, setHover] = useState(0)
  const shown = hover || value
  return (
    <div role="radiogroup" aria-label="Your rating" style={{ display: 'flex', gap: 2 }} onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map(n => (
        <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} out of 5`} disabled={disabled}
          onMouseEnter={() => setHover(n)} onClick={() => onChange(n)}
          style={{ width: 42, height: 42, display: 'grid', placeItems: 'center', background: 'transparent', border: 0, padding: 0, color: n <= shown ? C.warning : C.lineStrong }}>
          <IconStar size={26} filled={n <= shown} />
        </button>
      ))}
    </div>
  )
}

function Rating({ path, saved, disabled }: { path: string; saved: PlayerView['feedback']; disabled: boolean }) {
  const [rating, setRating] = useState(saved?.rating || 0)
  const [comment, setComment] = useState(saved?.comment || '')
  const [busy, setBusy] = useState(false)
  const [state, setState] = useState<'idle' | 'saved'>(saved ? 'saved' : 'idle')
  const [err, setErr] = useState('')
  const save = async () => {
    setBusy(true); setErr('')
    try { await lmsApi(path, { event: 'feedback', rating, comment: comment.trim() || null }); setState('saved') }
    catch (e) { setErr(errorWords(e)) } finally { setBusy(false) }
  }
  return (
    <Card pad={S.lg} elevation="flat" style={{ display: 'grid', gap: S.sm }}>
      <div style={{ fontWeight: W.semi, fontSize: F.body }}>How was this course?</div>
      <div style={{ fontSize: F.small, color: C.muted, marginTop: -4 }}>A rating helps your colleagues, and tells HR what to keep.</div>
      <StarInput value={rating} disabled={disabled} onChange={n => { setRating(n); setState('idle') }} />
      {rating > 0 && (
        <>
          <textarea aria-label="Your comment" rows={3} maxLength={2000} disabled={disabled} placeholder="Anything to add? (optional)" value={comment}
            onChange={e => { setComment(e.target.value); setState('idle') }}
            style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', fontSize: F.small, fontFamily: 'inherit', color: C.ink, background: C.surface, border: `1px solid ${C.lineStrong}`, borderRadius: R.md, resize: 'vertical', outline: 'none' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: S.md }}>
            <Button disabled={busy || disabled || state === 'saved'} onClick={save}>{busy ? 'Saving' : state === 'saved' ? 'Saved' : 'Save'}</Button>
            {state === 'saved' && <span style={{ fontSize: F.small, color: C.muted }}>Thank you.</span>}
          </div>
        </>
      )}
      {err && <div role="alert" style={{ fontSize: F.small, color: C.critical }}>{err}</div>}
    </Card>
  )
}

function NextUp({ currentId, onOpen, backLabel, onClose }: { currentId: string; onOpen?: (id: string) => void; backLabel: string; onClose: () => void }) {
  const [next, setNext] = useState<LearnItem | null>(null)
  useEffect(() => {
    if (!onOpen) return
    lmsApi<Dashboard>('/api/lms/me/dashboard').then(d => {
      setNext([...(d.overdue || []), ...(d.mandatory || []), ...(d.continue || []), ...(d.optional || [])].find(i => i.id !== currentId) || null)
    }).catch(() => {})
  }, [currentId, onOpen])
  return (
    <div style={{ display: 'grid', gap: S.sm }}>
      {next && (
        <Card pad={S.md} elevation="flat" style={{ display: 'flex', alignItems: 'center', gap: S.md, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 200px', minWidth: 0 }}>
            <div style={{ fontSize: F.tiny, color: C.muted }}>Next up</div>
            <div style={{ fontWeight: W.semi, fontSize: F.body, margin: '2px 0 4px' }}>{next.course?.title || 'Course'}</div>
            <DueBadge dueAt={next.due_at} overdue={next.overdue} />
          </div>
          <Button variant="primary" onClick={() => onOpen?.(next.id)}>{next.status === 'IN_PROGRESS' ? 'Resume' : 'Start'}</Button>
        </Card>
      )}
      <div><Button variant={next ? 'ghost' : 'primary'} onClick={onClose}>Back to {backLabel}</Button></div>
    </div>
  )
}

export default function CourseDone({ view, path, backLabel, onClose, onOpenCourse }: { view: PlayerView; path: string; backLabel: string; onClose: () => void; onOpenCourse?: (id: string) => void }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const e = view.enrollment, cert = view.certificate
  const score = e.score_pct != null ? Number(e.score_pct) : null
  const save = async () => {
    if (!cert) return
    setBusy(true); setErr('')
    try { await lmsDownload(`/api/lms/me/certificates/${cert.id}`, `${cert.cert_no}.pdf`) }
    catch (x) { setErr(errorWords(x)) } finally { setBusy(false) }
  }
  return (
    <div className="ez-rise" style={{ display: 'grid', gap: S.md }}>
      <Card pad={S.xl} style={{ textAlign: 'center' }}>
        <div className="ez-pop" style={{ width: 52, height: 52, margin: '0 auto 12px', borderRadius: R.pill, display: 'grid', placeItems: 'center', background: C.positiveTint, color: C.positive }}><IconCheck size={26} /></div>
        <div style={{ fontSize: F.title, fontWeight: W.bold, letterSpacing: '-.01em' }}>Course complete</div>
        <div style={{ fontSize: F.body, color: C.inkSoft, marginTop: 4 }}>{view.course.title}</div>
        <div style={{ fontSize: F.small, color: C.muted, marginTop: 6, ...numeric }}>
          {e.completed_at ? `Finished ${dayWords(e.completed_at)}` : ''}{score != null ? ` · Score ${score}%` : ''}{e.expires_at ? ` · Valid until ${dayWords(e.expires_at)}` : ''}
        </div>
        {cert && (
          <div style={{ marginTop: S.lg, display: 'grid', justifyItems: 'center', gap: 6 }}>
            <Button variant="primary" icon={<IconDownload size={15} />} disabled={busy} onClick={save}>{busy ? 'Preparing' : 'Download certificate'}</Button>
            <span style={{ fontSize: F.tiny, color: C.muted, ...numeric }}>{cert.cert_no}</span>
            {err && <div role="alert" style={{ fontSize: F.small, color: C.critical }}>{err}</div>}
          </div>
        )}
      </Card>
      <Rating path={path} saved={view.feedback} disabled={view.read_only} />
      <NextUp currentId={e.id} onOpen={onOpenCourse} backLabel={backLabel} onClose={onClose} />
    </div>
  )
}
