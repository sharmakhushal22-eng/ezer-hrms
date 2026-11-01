'use client'
// components/learning/PlayerReading.tsx — lessons that are read rather than played: documents,
// articles and links, plus the "mark complete" bar and the lesson's downloads.
import { useEffect, useRef, useState } from 'react'
import { C, F, W, S, R, Button, Skeleton, numeric, IconCheck, IconDownload, IconLetters } from '@/lib/ui'
import PdfPages, { loadPdf, useFitWidth } from '@/components/esign/PdfPages'
import { IconExternal, SectionHead, errorWords, webUrl, type OpenedLesson, type PlayerLesson } from './shared'

const READ_KINDS = ['DOCUMENT', 'SLIDES', 'ARTICLE', 'LINK']

const isPdf = (o: OpenedLesson) => o.mime === 'application/pdf' || /\.pdf$/i.test(o.file_name || '')

/** Supabase turns this on a signed URL into a file download rather than a page. */
const asDownload = (url: string, name: string | null) =>
  `${url}${url.includes('?') ? '&' : '?'}download=${encodeURIComponent(name || 'download')}`

function PdfViewer({ url }: { url: string }) {
  const [doc, setDoc] = useState<Awaited<ReturnType<typeof loadPdf>> | null>(null)
  const [failed, setFailed] = useState(false)
  const { ref, width } = useFitWidth(860, 24)
  useEffect(() => {
    let live = true
    let opened: Awaited<ReturnType<typeof loadPdf>> | null = null
    fetch(url)
      .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer() })
      .then(loadPdf)
      .then(d => { opened = d; if (live) setDoc(d); else void d.destroy() })
      .catch(() => { if (live) setFailed(true) })
    return () => { live = false; void opened?.destroy() }
  }, [url])
  return (
    <div ref={ref} className="ezl-pdf" style={{ background: C.sunken, borderRadius: R.md, padding: 12 }}>
      {failed ? <div style={{ padding: S.xl, textAlign: 'center', fontSize: F.small, color: C.muted }}>This file would not open here. Use the links below to read it.</div>
        : doc ? <PdfPages doc={doc} width={width} gap={12} />
        : <div style={{ display: 'grid', gap: S.sm }}><Skeleton h={420} r={R.sm} /></div>}
    </div>
  )
}

export function DocumentLesson({ opened, url }: { opened: OpenedLesson; url: string | null }) {
  // The viewer keeps the URL it opened with. `url` is the live one, refreshed for the links.
  const [first] = useState(opened.url)
  if (!first || !url) return <div style={{ padding: S.lg, fontSize: F.small, color: C.muted, background: C.sunken, borderRadius: R.lg }}>This file is not available right now. Please tell HR.</div>
  const pdf = isPdf(opened)
  return (
    <div style={{ display: 'grid', gap: S.sm }}>
      {pdf ? <PdfViewer url={first} /> : (
        <div style={{ display: 'flex', alignItems: 'center', gap: S.md, padding: S.lg, background: C.surface, border: `1px solid ${C.line}`, borderRadius: R.lg }}>
          <span style={{ width: 44, height: 44, borderRadius: R.md, background: C.brandTint, color: C.brand, display: 'grid', placeItems: 'center', flexShrink: 0 }}><IconLetters size={20} /></span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: W.semi, fontSize: F.small }}>{opened.file_name || 'Document'}</div>
            <div style={{ fontSize: F.tiny, color: C.muted, marginTop: 2 }}>This file cannot be shown here. Open or download it, then come back.</div>
          </div>
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: S.lg, fontSize: F.small }}>
        <a className="ezl-linkbtn ezl-tap" href={url} target="_blank" rel="noopener noreferrer">{pdf ? 'Open in a new tab' : 'Open'} <IconExternal size={14} /></a>
        <a className="ezl-linkbtn ezl-tap" href={asDownload(url, opened.file_name)} rel="noopener noreferrer"><IconDownload size={14} /> Download</a>
      </div>
    </div>
  )
}

/** Plain text, always. A body that happens to contain markup shows that markup as text. */
export function ArticleLesson({ body }: { body: string | null }) {
  return (
    <article style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: R.lg, padding: `${S.xl}px ${S.xl}px`, fontSize: F.lead, lineHeight: 1.75, color: C.inkSoft, whiteSpace: 'pre-wrap' }}>
      <div style={{ maxWidth: '68ch' }}>{body || ''}</div>
    </article>
  )
}

export function LinkLesson({ href, onVisited }: { href: string | null | undefined; onVisited: () => void }) {
  const url = webUrl(href)
  if (!url) return <div style={{ padding: S.lg, fontSize: F.small, color: C.muted, background: C.sunken, borderRadius: R.lg }}>This link is not available right now. Please tell HR.</div>
  let host = ''
  try { host = new URL(url).hostname.replace(/^www\./, '') } catch { /* shown without the name */ }
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: R.lg, padding: S.lg, display: 'grid', gap: S.md, justifyItems: 'start' }}>
      <div style={{ fontSize: F.small, color: C.inkSoft, lineHeight: 1.55 }}>This lesson is on {host || 'another website'}. It opens in a new tab. Come back here when you are done.</div>
      <a className="ezl-tap" href={url} target="_blank" rel="noopener noreferrer" onClick={onVisited}
        style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, height: 38, padding: '0 16px', borderRadius: R.md, background: C.brand, color: C.onAccent, fontSize: F.small, fontWeight: W.semi, textDecoration: 'none' }}>
        Open the link <IconExternal size={14} />
      </a>
    </div>
  )
}

/** Mark complete and the attestation. The dwell time is the server's to judge: the countdown
 *  here only saves a wasted click, and a 409 carries the true number of seconds left. */
export function MarkBar({ lesson, readOnly, needsVisit, dwellLeft, onMark }: {
  lesson: PlayerLesson
  readOnly: boolean
  /** A link lesson: it has to be opened first. */
  needsVisit?: boolean
  /** What the server says is left of the minimum time, so a return visit does not restart it. */
  dwellLeft?: number
  onMark: (body: { done?: boolean; ack?: boolean }) => Promise<unknown>
}) {
  const reading = READ_KINDS.includes(lesson.kind)
  const needsDone = reading && !lesson.content_done
  const needsAck = lesson.require_ack && !lesson.ack_at && (reading || lesson.content_done || lesson.kind === 'ASSESSMENT')
  const [left, setLeft] = useState(needsDone ? dwellLeft ?? lesson.min_seconds ?? 0 : 0)
  const [ticked, setTicked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const deadline = useRef(0)

  useEffect(() => {
    if (left <= 0) return
    if (!deadline.current) deadline.current = Date.now() + left * 1000
    const id = setInterval(() => {
      const s = Math.max(0, Math.ceil((deadline.current - Date.now()) / 1000))
      setLeft(s)
      if (!s) clearInterval(id)
    }, 500)
    return () => clearInterval(id)
  }, [left > 0]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!needsDone && !needsAck) return null

  const blocked = busy || readOnly || (needsDone && left > 0) || (needsAck && !ticked) || (needsDone && !!needsVisit)
  const submit = async () => {
    setBusy(true); setErr('')
    try {
      await onMark({ ...(needsDone ? { done: true } : {}), ...(needsAck ? { ack: true } : {}) })
    } catch (e) {
      setErr(errorWords(e))
      const wait = /(\d+) seconds? to go/.exec(errorWords(e))
      if (wait) { deadline.current = Date.now() + Number(wait[1]) * 1000; setLeft(Number(wait[1])) }
    } finally { setBusy(false) }
  }
  const mm = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: R.lg, padding: S.md, display: 'grid', gap: S.md }}>
      {needsAck && (
        <label style={{ display: 'flex', gap: S.sm, alignItems: 'flex-start', fontSize: F.small, color: C.inkSoft, lineHeight: 1.5, cursor: readOnly ? 'default' : 'pointer', padding: '6px 0' }}>
          <input type="checkbox" checked={ticked} disabled={readOnly} onChange={e => setTicked(e.target.checked)} style={{ width: 18, height: 18, marginTop: 1, flexShrink: 0, accentColor: C.brand }} />
          <span>{lesson.ack_text || 'I have read and understood this.'}</span>
        </label>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: S.md, flexWrap: 'wrap' }}>
        <Button variant="primary" icon={<IconCheck size={15} />} disabled={blocked} onClick={submit}>{busy ? 'Saving' : needsDone ? 'Mark complete' : 'Confirm'}</Button>
        {needsDone && left > 0 && <span style={{ fontSize: F.small, color: C.muted, ...numeric }}>You can mark this complete in {mm}</span>}
        {needsDone && !!needsVisit && !left && <span style={{ fontSize: F.small, color: C.muted }}>Open the link first.</span>}
      </div>
      {err && <div role="alert" style={{ fontSize: F.small, color: C.critical }}>{err}</div>}
    </div>
  )
}

export function Resources({ items }: { items: OpenedLesson['resources'] }) {
  const usable = items.filter(r => webUrl(r.url))
  if (!usable.length) return null
  return (
    <section>
      <SectionHead title="Resources" />
      <div style={{ border: `1px solid ${C.line}`, borderRadius: R.md, overflow: 'hidden', background: C.surface }}>
        {usable.map((r, i) => (
          <a key={r.id} className="ezl-navrow ezl-tap" href={webUrl(r.url)!} target="_blank" rel="noopener noreferrer"
            style={{ display: 'flex', alignItems: 'center', gap: S.sm, padding: `${S.sm + 2}px ${S.md}px`, borderTop: i ? `1px solid ${C.line}` : 0, fontSize: F.small, color: C.ink, textDecoration: 'none' }}>
            <span style={{ color: C.brand }}>{r.external ? <IconExternal size={15} /> : <IconDownload size={15} />}</span>
            <span style={{ minWidth: 0 }}>{r.title}</span>
          </a>
        ))}
      </div>
    </section>
  )
}
