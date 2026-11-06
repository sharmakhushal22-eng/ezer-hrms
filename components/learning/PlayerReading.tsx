'use client'
// components/learning/PlayerReading.tsx — lessons that are read rather than played: documents,
// articles and links, plus the "mark complete" bar and the lesson's downloads.
import { useEffect, useRef, useState } from 'react'
import { IconCheck, IconDownload } from '@/lib/ui'
import { lmsApi } from '@/lib/lms/client'
import PdfDeck from './PdfDeck'
import { IconExternal, errorWords, webUrl, type OpenedLesson, type PlayerLesson } from './shared'
import { GDoc, GLink } from './glyphs'

const READ_KINDS = ['DOCUMENT', 'SLIDES', 'ARTICLE', 'LINK']
/** Page bookmarks go to the server at most this often while someone flicks through. */
const PAGE_SAVE_MS = 1500

const isPdf = (o: OpenedLesson) => o.mime === 'application/pdf' || /\.pdf$/i.test(o.file_name || '')
export const isCaption = (r: { title: string; url: string | null }) => /\.vtt(\?|$)/i.test(r.url || '') || /\.vtt$/i.test(r.title) || /caption|subtitle/i.test(r.title)

/** Supabase turns this on a signed URL into a file download rather than a page. */
const asDownload = (url: string, name: string | null) =>
  `${url}${url.includes('?') ? '&' : '?'}download=${encodeURIComponent(name || 'download')}`

/** Pages seen, from the [first, last] runs the server keeps. */
const pagesOf = (runs: [number, number][]) => runs.flatMap(([a, b]) => Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i))

export function DocumentLesson({ opened, url, title, path, lessonId, readOnly, onPages }: {
  opened: OpenedLesson; url: string | null; title: string; path: string; lessonId: string; readOnly: boolean
  /** Seen pages and total, for the lesson's own progress line. */
  onPages?: (seen: number, pages: number) => void
}) {
  // The viewer keeps the URL it opened with. `url` is the live one, refreshed for the links.
  const [first] = useState(opened.url)
  const [start] = useState(() => Math.max(1, Math.round(Number(opened.position_s) || 1)))
  const [seen] = useState(() => pagesOf((opened.watched_ranges || []) as [number, number][]))
  const pending = useRef<{ page: number; pages: number; seen: number[] } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flush = () => {
    const p = pending.current
    pending.current = null
    if (!p || readOnly) return
    lmsApi(path, { event: 'page', lesson_id: lessonId, ...p }).catch(() => { /* a bookmark is not worth an error */ })
  }
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); flush() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (!first || !url) return <div className="lx-gatecard"><p>This file is not available right now. Please tell HR.</p></div>
  if (!isPdf(opened)) {
    return (
      <div className="lx-linkcard" style={{ margin: 0, borderRadius: 0 }}>
        <span className="lx-empty-art" style={{ transform: 'none' }}><GDoc size={32} /></span>
        <div style={{ fontWeight: 700, fontSize: 17 }}>{opened.file_name || 'Document'}</div>
        <div style={{ color: 'var(--ez-muted)', maxWidth: 420 }}>This file cannot be shown inside the course. Open or download it, then come back.</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
          <a className="lx-btn lx-btn--primary" href={url} target="_blank" rel="noopener noreferrer">Open <IconExternal size={14} /></a>
          <a className="lx-btn" href={asDownload(url, opened.file_name)} rel="noopener noreferrer"><IconDownload size={15} /> Download</a>
        </div>
      </div>
    )
  }
  return (
    <PdfDeck url={first} title={title} startPage={start} seenPages={seen}
      onPage={(page, pages, s) => {
        onPages?.(s.length, pages)
        pending.current = { page, pages, seen: s }
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(flush, PAGE_SAVE_MS)
      }} />
  )
}

export function DocumentLinks({ opened, url }: { opened: OpenedLesson; url: string | null }) {
  if (!url) return null
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <a className="lx-btn lx-btn--sm" href={url} target="_blank" rel="noopener noreferrer">Open in a new tab <IconExternal size={13} /></a>
      <a className="lx-btn lx-btn--sm" href={asDownload(url, opened.file_name)} rel="noopener noreferrer"><IconDownload size={14} /> Download</a>
    </div>
  )
}

/** Plain text, always. A body that happens to contain markup shows that markup as text. */
export function ArticleLesson({ body }: { body: string | null }) {
  return <article className="lx-article"><div>{body || ''}</div></article>
}

export function LinkLesson({ href, onVisited }: { href: string | null | undefined; onVisited: () => void }) {
  const url = webUrl(href)
  if (!url) return <div className="lx-linkcard"><p>This link is not available right now. Please tell HR.</p></div>
  let host = ''
  try { host = new URL(url).hostname.replace(/^www\./, '') } catch { /* shown without the name */ }
  return (
    <div className="lx-linkcard">
      <span className="lx-empty-art" style={{ transform: 'none' }}><GLink size={32} /></span>
      <div style={{ fontWeight: 700, fontSize: 18 }}>This lesson is on {host || 'another website'}</div>
      <div style={{ color: 'var(--ez-muted)', maxWidth: 440, lineHeight: 1.6 }}>It opens in a new tab. Come back here when you are done and mark it complete.</div>
      <a className="lx-btn lx-btn--primary lx-btn--lg" href={url} target="_blank" rel="noopener noreferrer" onClick={onVisited}>Open {host || 'the link'} <IconExternal size={15} /></a>
    </div>
  )
}

/** Mark complete and the attestation. The dwell time is the server's to judge: the countdown
 *  here only saves a wasted click, and a 409 carries the true number of seconds left. */
export function MarkBar({ lesson, readOnly, needsVisit, dwellLeft, pagesLeft, onMark }: {
  lesson: PlayerLesson
  readOnly: boolean
  /** A link lesson: it has to be opened first. */
  needsVisit?: boolean
  /** What the server says is left of the minimum time, so a return visit does not restart it. */
  dwellLeft?: number
  /** A document: pages not looked at yet. */
  pagesLeft?: number
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

  const unread = needsDone && (pagesLeft || 0) > 0
  const blocked = busy || readOnly || (needsDone && left > 0) || (needsAck && !ticked) || (needsDone && !!needsVisit) || unread
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
    <div className="lx-panel" style={{ padding: 18, display: 'grid', gap: 14 }}>
      {needsAck && (
        <label style={{ display: 'flex', gap: 12, alignItems: 'flex-start', fontSize: 14.5, color: 'var(--ez-ink-soft)', lineHeight: 1.55, cursor: readOnly ? 'default' : 'pointer' }}>
          <input type="checkbox" checked={ticked} disabled={readOnly} onChange={e => setTicked(e.target.checked)} style={{ width: 20, height: 20, marginTop: 1, flexShrink: 0, accentColor: 'var(--ez-brand)' }} />
          <span>{lesson.ack_text || 'I have read and understood this.'}</span>
        </label>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <button className="lx-btn lx-btn--primary" disabled={blocked} onClick={submit}><IconCheck size={16} /> {busy ? 'Saving' : needsDone ? 'Mark as complete' : 'Confirm'}</button>
        {needsDone && unread && <span style={{ fontSize: 13.5, color: 'var(--ez-muted)' }}>Go through every page first: {pagesLeft} to go.</span>}
        {needsDone && !unread && left > 0 && <span className="lx-num" style={{ fontSize: 13.5, color: 'var(--ez-muted)' }}>You can mark this complete in {mm}</span>}
        {needsDone && !!needsVisit && !left && <span style={{ fontSize: 13.5, color: 'var(--ez-muted)' }}>Open the link first.</span>}
      </div>
      {err && <div role="alert" style={{ fontSize: 13.5, color: 'var(--ez-critical)' }}>{err}</div>}
    </div>
  )
}

export function Resources({ items }: { items: OpenedLesson['resources'] }) {
  const usable = items.filter(r => webUrl(r.url))
  if (!usable.length) return <div style={{ fontSize: 14, color: 'var(--ez-muted)', padding: '6px 0' }}>This lesson has no downloads.</div>
  return (
    <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))' }}>
      {usable.map(r => (
        <a key={r.id} className="lx-res" href={webUrl(r.url)!} target="_blank" rel="noopener noreferrer">
          <span>{r.external ? <IconExternal size={16} /> : <IconDownload size={16} />}</span>
          <span style={{ minWidth: 0, flex: 1 }}>
            <span style={{ display: 'block' }}>{r.title}</span>
            <span style={{ display: 'block', fontSize: 12, color: 'var(--ez-muted)', fontWeight: 500 }}>{isCaption(r) ? 'Captions file, also shown in the player' : r.external ? 'Website' : 'Download'}</span>
          </span>
        </a>
      ))}
    </div>
  )
}
