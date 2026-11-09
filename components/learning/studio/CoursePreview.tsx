'use client'
// components/learning/studio/CoursePreview.tsx — "Preview as learner" from the builder. The
// version being edited, laid out as a learner would meet it: the lesson on a stage and the
// outline beside it. Files come from /api/lms/admin/preview, which records nothing, so the
// author can play a video or page through slides without making an enrolment.
import { useEffect, useState } from 'react'
import { lmsApi } from '@/lib/lms/client'
import { IconClose, IconDownload } from '@/lib/ui'
import { KindGlyph, durationWords, errorWords, plural, KIND_WORD } from '../shared'
import VideoPlayer from '../VideoPlayer'
import PdfDeck from '../PdfDeck'
import { GArrowRight, GLeft, GRight, GTarget } from '../glyphs'
import { GEye } from './icons'
import '../live.css'

interface Opened {
  lesson_id: string; kind: string; title: string; summary: string | null; body: string | null; external_url: string | null
  url: string | null; poster: string | null; mime: string | null; file_name: string | null; duration_s: number | null
  resources: { id: string; title: string; url: string | null; external: boolean; name: string | null }[]
  quiz: { title: string; pass_pct: number; questions: number } | null
  scorm?: { url: string; version: string; title: string } | null
}

const isPdf = (o: Opened) => o.mime === 'application/pdf' || /\.pdf$/i.test(o.file_name || '')
const isVtt = (r: Opened['resources'][number]) => /\.vtt$/i.test(r.name || '') || /\.vtt(\?|$)/i.test(r.url || '') || /\bcaptions?\b|subtitles?/i.test(r.title)
const webUrl = (s?: string | null) => (s && /^https?:\/\//i.test(s.trim()) ? s.trim() : null)

function Stage({ o }: { o: Opened }) {
  const media = o.kind === 'VIDEO' || o.kind === 'AUDIO'
  if ((media || o.kind === 'DOCUMENT' || o.kind === 'SLIDES') && !o.url) {
    return <div className="lx-gatecard"><span><KindGlyph kind={o.kind} size={24} /></span><b>No file yet</b><p>Upload one in the lesson editor and it will play here.</p></div>
  }
  if (media) {
    const captions = o.resources.filter(r => isVtt(r) && r.url).map(r => ({ label: r.title.replace(/\.vtt$/i, ''), src: r.url! }))
    return <VideoPlayer key={o.lesson_id} src={o.url!} poster={o.poster} kind={o.kind as 'VIDEO' | 'AUDIO'} title={o.title} captions={captions} />
  }
  if (o.kind === 'DOCUMENT' || o.kind === 'SLIDES') {
    if (isPdf(o)) return <PdfDeck key={o.lesson_id} url={o.url!} title={o.title} />
    return <div className="lx-gatecard"><span><KindGlyph kind="DOCUMENT" size={24} /></span><b>{o.file_name}</b><p>This file cannot be shown in the browser. Learners download it.</p></div>
  }
  if (o.kind === 'SCORM') {
    if (!o.scorm) return <div className="lx-gatecard"><span><KindGlyph kind="SCORM" size={24} /></span><b>No package yet</b><p>Upload the SCORM .zip in the lesson editor and it will run here.</p></div>
    // Sandboxed like the learner's player; the preview token is read-only, so nothing it reports is kept.
    return (
      <div className="lx-sc" style={{ width: '100%' }}>
        <div className="lx-sc-bar"><b>{o.scorm.title}</b><span className="lx-tag lx-tag--glass">SCORM {o.scorm.version}</span><span className="lx-sc-saved">Preview: progress is not saved</span></div>
        <div className="lx-sc-frame"><iframe key={o.lesson_id} src={o.scorm.url} title={o.scorm.title} sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads allow-presentation" allow="fullscreen; autoplay" /></div>
      </div>
    )
  }
  if (o.kind === 'LIVE') return <div className="lx-gatecard"><span><KindGlyph kind="LIVE" size={24} /></span><b>Live session</b><p>Learners see this course’s webinars here, with Join, a calendar invitation and the recordings. Attending one, or watching most of a recording, completes the lesson.</p></div>
  if (o.kind === 'ARTICLE') return <div style={{ width: '100%', padding: 24, background: 'var(--ez-canvas)' }}><div className="lx-article"><div>{o.body || 'This article has no text yet.'}</div></div></div>
  if (o.kind === 'LINK') {
    const u = webUrl(o.external_url)
    return (
      <div className="lx-gatecard">
        <span><KindGlyph kind="LINK" size={24} /></span>
        <b>{u ? new URL(u).hostname.replace(/^www\./, '') : 'No link yet'}</b>
        <p>Learners open this page in a new tab and come back.</p>
        {u && <a className="lx-btn lx-btn--white" href={u} target="_blank" rel="noopener noreferrer">Open the link <GArrowRight size={15} /></a>}
      </div>
    )
  }
  return <div className="lx-gatecard"><span><GTarget size={24} /></span><b>Assessment</b><p>Learners answer the questions below. Previewing does not start an attempt.</p></div>
}

export default function CoursePreview({ b, startId, onClose }: { b: { course: any; tree: any }; startId: string | null; onClose: () => void }) {
  const byPos = (x: any, y: any) => x.position - y.position
  const modules = [...b.tree.modules].sort(byPos)
  const ordered: any[] = modules.flatMap((m: any) => b.tree.lessons.filter((l: any) => l.module_id === m.id).sort(byPos))
  const [id, setId] = useState<string | null>(startId || ordered[0]?.id || null)
  const [o, setO] = useState<Opened | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!id) return
    let live = true
    setO(null); setErr('')
    lmsApi<Opened>(`/api/lms/admin/preview?lesson=${encodeURIComponent(id)}`).then(x => { if (live) setO(x) }).catch(e => { if (live) setErr(errorWords(e)) })
    return () => { live = false }
  }, [id])
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.fullscreenElement) onClose() }
    window.addEventListener('keydown', k)
    const was = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = was }
  }, [onClose])

  const at = ordered.findIndex(l => l.id === id)
  const lesson = ordered[at]
  const quiz = lesson ? b.tree.quizzes.find((q: any) => q.id === lesson.quiz_id) : null
  const doc = lesson && (lesson.kind === 'DOCUMENT' || lesson.kind === 'SLIDES')

  return (
    <div className="ezl lx-st-pv" role="dialog" aria-modal="true" aria-label="Course preview">
      <div className="lx-st-pv-top">
        <button className="lx-btn lx-btn--ghost lx-btn--sm" style={{ color: 'var(--lx-on-stage-soft)' }} onClick={onClose}><IconClose size={16} /> Close</button>
        <span className="lx-st-pv-flag"><GEye size={14} /> Preview — nothing is recorded</span>
        <div className="lx-pl-title" style={{ minWidth: 0, flex: 1 }}>
          <b>{b.course.title}</b>
          <span>Version {b.tree.version.version_no} · {plural(ordered.length, 'lesson')}</span>
        </div>
        <button className="lx-btn lx-btn--ghost lx-btn--sm" style={{ color: 'var(--lx-on-stage-soft)' }} disabled={at <= 0} onClick={() => setId(ordered[at - 1].id)}><GLeft size={15} /> Previous</button>
        <button className="lx-btn lx-btn--ghost lx-btn--sm" style={{ color: 'var(--lx-on-stage-soft)' }} disabled={at < 0 || at >= ordered.length - 1} onClick={() => setId(ordered[at + 1].id)}>Next <GRight size={15} /></button>
      </div>
      <div className="lx-st-pv-body">
        <div className="lx-st-pv-main">
          {!lesson ? <div className="lx-empty" style={{ margin: 24 }}><h3>Nothing to preview yet</h3><p>Add a lesson first.</p></div> : (
            <>
              <div className="lx-st-pv-stage" data-doc={doc ? '1' : '0'}>
                {err ? <div className="lx-gatecard"><p>{err}</p></div> : !o || o.lesson_id !== id ? <div className="lx-skel" style={{ aspectRatio: '16 / 9', borderRadius: 0 }} /> : <Stage o={o} />}
              </div>
              <div className="lx-st-pv-under">
                <div className="lx-lesson-kicker">{modules.find((m: any) => m.id === lesson.module_id)?.title} · Lesson {at + 1} of {ordered.length}</div>
                <h2 className="lx-lesson-title" style={{ marginTop: 0 }}>{lesson.title}</h2>
                {lesson.summary && <p className="lx-lesson-sum" style={{ marginTop: 0 }}>{lesson.summary}</p>}
                {quiz && (
                  <div className="lx-qcard">
                    <div className="lx-qcard-head">
                      <span><GTarget size={20} /></span>
                      <div><div style={{ fontWeight: 750 }}>{quiz.title}</div><div className="lx-st-hint">{lesson.kind === 'ASSESSMENT' ? 'Assessment' : 'Quiz after this lesson'}{lesson.quiz_required === false ? ' · optional' : ''}</div></div>
                    </div>
                    <div className="lx-qfacts">
                      <div><span>Questions</span><b>{quiz.questions.length}</b></div>
                      <div><span>Pass mark</span><b>{quiz.pass_pct}%</b></div>
                      <div><span>Attempts</span><b>{quiz.max_attempts ?? 'No limit'}</b></div>
                      <div><span>Time limit</span><b>{quiz.time_limit_minutes ? `${quiz.time_limit_minutes} min` : 'None'}</b></div>
                    </div>
                    {quiz.questions.length > 0 && (
                      <ol style={{ margin: 0, padding: '14px 20px 16px 38px', display: 'grid', gap: 6, fontSize: 13.5, color: 'var(--ez-ink-soft)' }}>
                        {quiz.questions.map((q: any) => <li key={q.id}>{q.prompt}</li>)}
                      </ol>
                    )}
                  </div>
                )}
                {o && o.lesson_id === id && o.resources.length > 0 && (
                  <div style={{ display: 'grid', gap: 8 }}>
                    <div className="lx-st-label">Downloads</div>
                    {o.resources.filter(r => webUrl(r.url)).map(r => (
                      <a key={r.id} className="lx-res" href={webUrl(r.url)!} target="_blank" rel="noopener noreferrer">
                        <span><IconDownload size={16} /></span>{r.title}{isVtt(r) && <span className="lx-tag lx-tag--info" style={{ marginLeft: 'auto' }}>Captions</span>}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
        <aside className="lx-st-pv-side" aria-label="Outline">
          {modules.map((m: any, i: number) => {
            const ls = ordered.filter(l => l.module_id === m.id)
            return (
              <div key={m.id} className="lx-mod">
                <div className="lx-mod-head" style={{ cursor: 'default' }}><div><b>{i + 1}. {m.title}</b><span>{plural(ls.length, 'lesson')}</span></div></div>
                {ls.map(l => (
                  <button key={l.id} className="lx-ls" aria-current={l.id === id ? 'true' : undefined} onClick={() => setId(l.id)}>
                    <span className="lx-ls-mark"><KindGlyph kind={l.kind} size={13} /></span>
                    <span><b>{l.title}</b><small>{KIND_WORD[l.kind]}{l.est_minutes ? ` · ${durationWords(l.est_minutes)}` : ''}{l.quiz_id && l.kind !== 'ASSESSMENT' ? ' · Quiz' : ''}</small></span>
                  </button>
                ))}
              </div>
            )
          })}
        </aside>
      </div>
    </div>
  )
}
