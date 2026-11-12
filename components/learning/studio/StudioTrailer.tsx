'use client'
// components/learning/studio/StudioTrailer.tsx — the clip a course plays when a learner rests the
// pointer on its card, and behind its title on Home's spotlight.
//
// Three ways, as in lib/lms/showcase-core.ts:
//   automatic         nothing set: a free-preview video lesson, or for a course anyone may enrol
//                     in, its first video lesson
//   upload a trailer  a short video made for the course (best: 15 to 45 seconds, MP4)
//   a lesson's clip   one of the course's own videos, from a start and for a length HR picks
// The preview below loops exactly the window learners will see.
import { useEffect, useRef, useState } from 'react'
import { lmsApi } from '@/lib/lms/client'
import { uploadLmsFile } from '@/lib/lms/upload-client'
import type { BuilderApi } from '../admin/builder-api'
import { GPlay } from '../glyphs'
import '../showcase/showcase.css'

const secs = (n: number) => `${Math.floor(n / 60)}:${String(Math.round(n % 60)).padStart(2, '0')}`

function Loop({ src, start, len }: { src: string; start: number; len: number }) {
  const v = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const el = v.current
    if (!el) return
    const jump = () => { el.currentTime = start }
    const tick = () => { if (el.currentTime >= start + len - 0.1 || el.currentTime < start - 0.5) el.currentTime = start }
    el.addEventListener('loadedmetadata', jump)
    el.addEventListener('timeupdate', tick)
    if (el.readyState >= 1) jump()
    void el.play().catch(() => {})
    return () => { el.removeEventListener('loadedmetadata', jump); el.removeEventListener('timeupdate', tick) }
  }, [src, start, len])
  return <video ref={v} className="lx-tr-video" src={src} muted playsInline loop aria-label="Trailer preview" />
}

/** Keyed by the saved trailer in StudioBuilder, so a save from anywhere starts the sliders afresh. */
export default function StudioTrailer({ b }: { b: BuilderApi }) {
  const c = b.course
  const t = c.trailer as null | { id: string; original_name: string; duration_s: number | null; status: string; url: string | null }
  const videos = (b.tree.lessons as any[]).filter(l => l.kind === 'VIDEO' && l.asset?.status === 'READY')
  const fromLesson = t ? videos.find(l => l.asset_id === t.id) : null
  const [start, setStart] = useState<number>(Number(c.trailer_start_s) || 0)
  const [len, setLen] = useState<number>(Number(c.trailer_len_s) || 20)
  const [pct, setPct] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  // Before migration 227 the course row has none of these columns.
  const ready = 'trailer_asset_id' in c

  const save = async (fields: Record<string, unknown>) => {
    setErr(''); setBusy(true)
    try {
      await lmsApi(`/api/lms/admin/courses/${c.id}`, fields, 'PATCH')
      await b.run(async () => null)   // refresh the builder, and its save state
    } catch (e: any) { setErr(e?.message || 'That could not be saved.') }
    finally { setBusy(false) }
  }
  const upload = async (file?: File | null) => {
    if (!file) return
    setErr(''); setPct(0)
    try {
      const a = await uploadLmsFile(file, { kind: 'VIDEO', companyId: c.company_id, onProgress: setPct })
      await save({ trailer_asset_id: a.id, trailer_start_s: 0, trailer_len_s: Math.max(5, Math.min(45, Math.floor(Number(a.duration_s) || 30))) })
    } catch (e: any) { setErr(e?.message || 'That video could not be uploaded.') }
    finally { setPct(null) }
  }
  const dur = Number(t?.duration_s) || 0
  const maxStart = Math.max(0, Math.floor(dur - 5))

  return (
    <section className="lx-panel lx-tr" aria-labelledby="lx-tr-h">
      <div className="lx-panel-head">
        <div>
          <div className="lx-panel-title" id="lx-tr-h">Trailer</div>
          <div style={{ fontSize: 12.5, color: 'var(--ez-muted)', marginTop: 2 }}>Plays muted when someone rests the pointer on this course, and in the spotlight on Home.</div>
        </div>
        {t && b.canEdit && <button type="button" className="lx-btn lx-btn--sm" disabled={busy} onClick={() => save({ trailer_asset_id: null })}>Use automatic</button>}
      </div>
      <div className="lx-tr-grid">
        <div className="lx-tr-stage">
          {t?.url
            ? <Loop src={t.url} start={start} len={len} />
            : <div className="lx-tr-empty"><GPlay size={22} /><span>{videos.some(l => l.is_preview) ? 'Automatic: the free-preview video lesson' : c.enrolment_mode === 'SELF' ? 'Automatic: the first video lesson' : videos.length ? 'No trailer: this course needs approval or HR’s assignment, so its lessons are not shown before then. Upload a trailer, or mark a video lesson as a free preview.' : 'No trailer yet. Add a video lesson or upload a trailer.'}</span></div>}
        </div>
        <div className="lx-tr-side">
          {!ready && <div className="lx-note">Trailers need one database step first: run <b>supabase/migrations/227_lms_showcase_game_room.sql</b>. Until then, cards use the automatic clip.</div>}
          {t && <div style={{ fontSize: 13 }}><b>{fromLesson ? `Clip from “${fromLesson.title}”` : 'Uploaded trailer'}</b><div style={{ color: 'var(--ez-muted)', fontSize: 12.5 }}>{t.original_name}{dur ? ` · ${secs(dur)}` : ''}</div></div>}
          {b.canEdit && ready && (
            <>
              <label className="lx-btn lx-btn--sm" style={{ justifySelf: 'start', cursor: pct != null ? 'default' : 'pointer' }}>
                {pct != null ? `Uploading ${pct}%` : t && !fromLesson ? 'Replace the trailer' : 'Upload a trailer'}
                <input type="file" accept="video/mp4,video/quicktime" hidden disabled={pct != null} onChange={e => { void upload(e.target.files?.[0]); e.target.value = '' }} />
              </label>
              {videos.length > 0 && (
                <label style={{ display: 'grid', gap: 4, fontSize: 12.5, color: 'var(--ez-muted)' }}>
                  Or use a clip from a lesson
                  <select className="lx-select" value={fromLesson?.id || ''} disabled={busy} onChange={e => { const l = videos.find(x => x.id === e.target.value); if (l) void save({ trailer_asset_id: l.asset_id, trailer_start_s: 0, trailer_len_s: 20 }) }}>
                    <option value="">Choose a video lesson…</option>
                    {videos.map(l => <option key={l.id} value={l.id}>{l.title}</option>)}
                  </select>
                </label>
              )}
              {fromLesson && !fromLesson.is_preview && c.enrolment_mode !== 'SELF' && (
                <div className="lx-note" style={{ fontSize: 12.5 }}>Anyone who can see this course can reach this lesson’s whole video through the clip. Upload a separate trailer if the lesson should stay for enrolled learners only.</div>
              )}
              {t && (
                <div className="lx-tr-range">
                  <label>Starts at <b className="lx-num">{secs(start)}</b>
                    <input type="range" min={0} max={maxStart || 0} step={1} value={Math.min(start, maxStart)} disabled={!maxStart || busy} onChange={e => setStart(Number(e.target.value))} onPointerUp={() => save({ trailer_start_s: start })} onKeyUp={() => save({ trailer_start_s: start })} />
                  </label>
                  <label>Plays for <b className="lx-num">{len} s</b>
                    <input type="range" min={5} max={Math.min(90, Math.max(5, Math.floor(dur - start) || 90))} step={1} value={len} disabled={busy} onChange={e => setLen(Number(e.target.value))} onPointerUp={() => save({ trailer_len_s: len })} onKeyUp={() => save({ trailer_len_s: len })} />
                  </label>
                </div>
              )}
            </>
          )}
          {err && <div role="alert" style={{ fontSize: 12.5, color: 'var(--ez-critical)' }}>{err}</div>}
          <div style={{ fontSize: 12, color: 'var(--ez-muted)', lineHeight: 1.5 }}>Best: 15 to 45 seconds, MP4 (H.264), landscape 16:9, the strongest moment first. Previews play without sound until the learner turns it on.</div>
        </div>
      </div>
    </section>
  )
}
