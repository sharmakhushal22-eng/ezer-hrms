'use client'
// components/learning/PlayerDone.tsx — the end of a course: what they got, a word about the
// course if they care to leave one, and what comes next.
import { useEffect, useState } from 'react'
import { IconDownload } from '@/lib/ui'
import { lmsApi, lmsDownload } from '@/lib/lms/client'
import { CourseArt, DueTag, IconStar, dayWords, errorWords, type Dashboard, type LearnItem, type PlayerView } from './shared'
import { GArrowRight, GCert, GRedo, GTrophy } from './glyphs'
import { Aurora } from './motion/Aurora'
import { Earned } from './game/Earned'

const CONFETTI = Array.from({ length: 28 }, (_, i) => ({
  left: `${(i * 37) % 100}%`, delay: `${(i % 7) * 0.35}s`, dur: `${2.6 + (i % 5) * 0.4}s`,
  color: ['var(--lx-glow)', 'var(--lx-hero-c)', 'var(--ez-on-dark)', 'var(--ez-positive)'][i % 4], rot: `${(i * 47) % 360}deg`,
}))

function StarInput({ value, disabled, onChange }: { value: number; disabled: boolean; onChange: (n: number) => void }) {
  const [hover, setHover] = useState(0)
  const shown = hover || value
  const words = ['', 'Poor', 'Could be better', 'Good', 'Very good', 'Excellent']
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <div className="lx-stars" role="radiogroup" aria-label="Your rating" onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map(n => (
          <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} out of 5`} disabled={disabled} data-on={n <= shown ? '1' : '0'}
            onMouseEnter={() => setHover(n)} onClick={() => onChange(n)}>
            <IconStar size={30} filled={n <= shown} />
          </button>
        ))}
      </div>
      {shown > 0 && <span style={{ fontWeight: 650, color: 'var(--lx-gold)' }}>{words[shown]}</span>}
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
    <section className="lx-panel" style={{ padding: 22, display: 'grid', gap: 12 }}>
      <div>
        <div style={{ fontWeight: 750, fontSize: 16 }}>How was this course?</div>
        <div style={{ fontSize: 13.5, color: 'var(--ez-muted)', marginTop: 3 }}>Your rating helps colleagues choose, and tells HR what to keep.</div>
      </div>
      <StarInput value={rating} disabled={disabled} onChange={n => { setRating(n); setState('idle') }} />
      {rating > 0 && (
        <>
          <textarea className="lx-textarea" aria-label="Your comment" rows={3} maxLength={2000} disabled={disabled} placeholder="What did you like, or what would make it better? (optional)" value={comment}
            onChange={e => { setComment(e.target.value); setState('idle') }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button className="lx-btn lx-btn--primary" disabled={busy || disabled || state === 'saved'} onClick={save}>{busy ? 'Saving…' : state === 'saved' ? 'Saved' : 'Send feedback'}</button>
            {state === 'saved' && <span style={{ fontSize: 13.5, color: 'var(--ez-positive)', fontWeight: 600 }}>Thank you!</span>}
          </div>
        </>
      )}
      {err && <div role="alert" style={{ fontSize: 13.5, color: 'var(--ez-critical)' }}>{err}</div>}
    </section>
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
    <section style={{ display: 'grid', gap: 12 }}>
      {next && (
        <button className="lx-wc" onClick={() => onOpen?.(next.id)}>
          <CourseArt src={next.course?.thumbnail} id={next.course_id} title={next.course?.title} word={false} />
          <span style={{ minWidth: 0, display: 'grid', gap: 6 }}>
            <span className="lx-cc-kicker">Up next</span>
            <span className="lx-cc-title">{next.course?.title || 'Course'}</span>
            <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{next.mandatory && <span className="lx-tag lx-tag--brand">Mandatory</span>}<DueTag dueAt={next.due_at} overdue={next.overdue} /></span>
            <span className="lx-sec-link" style={{ padding: 0 }}>{next.status === 'IN_PROGRESS' ? 'Resume' : 'Start'} <GArrowRight size={14} /></span>
          </span>
        </button>
      )}
      <div><button className={`lx-btn ${next ? 'lx-btn--ghost' : 'lx-btn--primary'}`} onClick={onClose}>Back to {backLabel.replace(/^Back$/, 'where you were')}</button></div>
    </section>
  )
}

export default function CourseDone({ view, path, backLabel, onClose, onOpenCourse, onReview }: {
  view: PlayerView; path: string; backLabel: string; onClose: () => void; onOpenCourse?: (id: string) => void
  /** Go back through the lessons, for reference. */
  onReview?: () => void
}) {
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
    <div style={{ display: 'grid', gap: 20, padding: '24px 0 48px' }}>
      <section className="lx-done lx-in">
        <Aurora specks={6} />
        <div className="lx-confetti" aria-hidden>
          {CONFETTI.map((c, i) => <i key={i} style={{ left: c.left, background: c.color, animationDelay: c.delay, animationDuration: c.dur, transform: `rotate(${c.rot})` }} />)}
        </div>
        <span className="lx-trophy"><GTrophy size={40} /></span>
        <div style={{ fontSize: 12.5, fontWeight: 750, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ez-on-dark-muted)' }}>Course complete</div>
        <h2>{view.course.title}</h2>
        <div className="lx-num" style={{ fontSize: 14.5, color: 'var(--ez-on-dark-muted)' }}>
          {[e.completed_at && `Finished ${dayWords(e.completed_at)}`, score != null && `Score ${score}%`, e.expires_at && `Valid until ${dayWords(e.expires_at)}`].filter(Boolean).join(' · ')}
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center', marginTop: 8 }}>
          {cert && <button className="lx-btn lx-btn--white lx-btn--lg" disabled={busy} onClick={save}><IconDownload size={17} /> {busy ? 'Preparing…' : 'Download certificate'}</button>}
          {onReview && <button className="lx-btn lx-btn--light lx-btn--lg" onClick={onReview}><GRedo size={17} /> Review the lessons</button>}
        </div>
        {err && <div role="alert" style={{ fontSize: 13.5, color: 'var(--ez-on-dark)' }}>{err}</div>}
      </section>

      {!view.read_only && <Earned />}

      {cert && (
        <section className="lx-cert" style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <i className="lx-holo" aria-hidden />
          <span className="lx-cert-seal"><GCert size={24} /></span>
          <div style={{ flex: '1 1 220px', minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 750, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--lx-gold)' }}>Certificate of completion</div>
            <div style={{ fontWeight: 750, fontSize: 16, marginTop: 2 }}>{view.course.title}</div>
            <div className="lx-num" style={{ fontSize: 13, color: 'var(--ez-muted)', marginTop: 2 }}>{cert.cert_no} · kept in Achievements</div>
          </div>
          <button className="lx-btn" disabled={busy} onClick={save}><IconDownload size={15} /> PDF</button>
        </section>
      )}

      <Rating path={path} saved={view.feedback} disabled={view.read_only} />
      <NextUp currentId={e.id} onOpen={onOpenCourse} backLabel={backLabel} onClose={onClose} />
    </div>
  )
}
