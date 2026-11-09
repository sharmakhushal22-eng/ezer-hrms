'use client'
// components/learning/PlayerScorm.tsx — a SCORM package inside the course player.
//
// The package runs in a sandboxed frame without allow-same-origin: it is somebody's uploaded
// JavaScript and must not reach the learner's session in this page. It talks to the SCORM API
// that lib/lms/scorm-core.ts put into its own pages, and that API posts each commit here. This
// component checks the message carries this lesson's token, and passes it to the server, which
// decides what it means (lib/lms/engine.ts, scormCommit).
import { useCallback, useEffect, useRef, useState } from 'react'
import { lmsApi } from '@/lib/lms/client'
import { errorWords, type OpenedLesson } from './shared'
import { GFull, GFullExit, GRedo } from './glyphs'
import './live.css'

const SANDBOX = 'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads allow-presentation'

export default function ScormLesson({ opened, path, lessonId, title, done, readOnly, onFinished }: {
  opened: OpenedLesson
  path: string
  lessonId: string
  title: string
  done: boolean
  readOnly: boolean
  /** The server said this run finished the lesson. */
  onFinished: () => void
}) {
  const sc = opened.scorm!
  const token = sc.url.split('/')[2]
  const box = useRef<HTMLDivElement>(null)
  const [loaded, setLoaded] = useState(false)
  const [label, setLabel] = useState(sc.label)
  const [score, setScore] = useState(sc.score_pct)
  const [saved, setSaved] = useState<string>('')
  const [err, setErr] = useState('')
  const [full, setFull] = useState(false)
  const [run, setRun] = useState(0)
  const pending = useRef<any>(null), sending = useRef(false), finished = useRef(done)

  /** Send what the package last committed. One request at a time, the newest commit next; each
   *  is sent with keepalive, so leaving or reloading the page does not cut the last one off. */
  const flush = useCallback(async () => {
    if (readOnly || sending.current || !pending.current) return
    sending.current = true
    while (pending.current) {
      const commit = pending.current
      pending.current = null
      try {
        const r = await lmsApi<{ content_done: boolean; label: string; score_pct: number | null }>(path, { event: 'scorm', lesson_id: lessonId, ...commit }, undefined, { keepalive: true })
        setLabel(r.label); setScore(r.score_pct); setErr('')
        setSaved(`Saved ${new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}`)
        if (r.content_done && !finished.current) { finished.current = true; onFinished() }
      } catch (e) {
        // Kept for the next try rather than lost: a newer commit replaces it, else it goes again.
        pending.current = pending.current || commit
        setErr(errorWords(e))
        sending.current = false
        setTimeout(() => void flush(), 4000)
        return
      }
    }
    sending.current = false
  }, [path, lessonId, readOnly, onFinished])

  useEffect(() => {
    const on = (e: MessageEvent) => {
      const m = e.data
      // Only this lesson's package: its token is in the message, and the frame is sandboxed, so
      // its origin is the opaque "null".
      if (!m || m.ezlScorm !== 1 || m.token !== token || e.origin !== 'null') return
      if (m.kind === 'start') return
      pending.current = { cmi: m.cmi, launch: m.launch, session: m.session }
      void flush()
    }
    window.addEventListener('message', on)
    return () => { window.removeEventListener('message', on); void flush() }
  }, [token, flush])

  useEffect(() => {
    const f = () => setFull(document.fullscreenElement === box.current)
    document.addEventListener('fullscreenchange', f)
    return () => document.removeEventListener('fullscreenchange', f)
  }, [])

  const restart = async () => {
    if (!window.confirm('Start this module again from the beginning? Where you were in it will be cleared.')) return
    try { await lmsApi(path, { event: 'scorm_reset', lesson_id: lessonId }); setLabel('Not started'); setScore(null); setLoaded(false); setRun(n => n + 1) }
    catch (e) { setErr(errorWords(e)) }
  }

  const tone = label === 'Passed' || label === 'Completed' ? 'positive' : label === 'Not passed' ? 'critical' : label === 'In progress' ? 'brand' : ''
  return (
    <div className="lx-sc" ref={box}>
      <div className="lx-sc-bar">
        <b title={sc.title}>{sc.title || title}</b>
        <span className={`lx-tag ${tone ? `lx-tag--${tone}` : 'lx-tag--glass'}`}>{label}{score != null ? ` · ${score}%` : ''}</span>
        <span className="lx-tag lx-tag--glass">SCORM {sc.version}</span>
        {saved && !err && <span className="lx-sc-saved" aria-live="polite">{saved}</span>}
        {err && <span className="lx-sc-saved" role="alert" style={{ color: 'var(--ez-critical)' }}>Not saved yet: {err}</span>}
        {!readOnly && !done && label !== 'Not started' && <button className="lx-btn lx-btn--sm" onClick={restart}><GRedo size={14} /> Start over</button>}
        <button className="lx-btn lx-btn--sm" aria-pressed={full} onClick={() => full ? document.exitFullscreen() : box.current?.requestFullscreen?.()}>{full ? <GFullExit size={15} /> : <GFull size={15} />} {full ? 'Exit full screen' : 'Full screen'}</button>
      </div>
      <div className="lx-sc-frame">
        <iframe key={run} src={sc.url} title={sc.title || title} sandbox={SANDBOX} allow="fullscreen; autoplay; clipboard-write" onLoad={() => setLoaded(true)} />
        {!loaded && <div className="lx-sc-wait"><div className="lx-vp-spin" style={{ position: 'static', margin: 0 }} />Opening the module…</div>}
      </div>
    </div>
  )
}
