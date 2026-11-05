'use client'
// components/learning/PdfDeck.tsx — a PDF read like a presentation: one page at a time, with
// slide controls, zoom, thumbnails and a full-screen presenter mode.
//
// Pages are drawn by pdf.js as vector graphics at the screen's own pixel density, and redrawn
// whenever the zoom changes, so text stays sharp at any size; nothing is turned into pictures
// on the server. A text layer sits over each page so words can be selected and copied.
//
// The deck reports which page is open and which pages have been seen (onPage). The lesson
// keeps that as a bookmark; completing the lesson is still the server's decision.
import { useCallback, useEffect, useRef, useState } from 'react'
import { loadPdf } from '@/components/esign/PdfPages'
import {
  GFitPage, GFitWidth, GFull, GFullExit, GLeft, GPresent, GRight, GThumbs, GZoomIn, GZoomOut,
} from './glyphs'
import { IconCheck } from '@/lib/ui'

type Doc = Awaited<ReturnType<typeof loadPdf>>
type Mode = 'page' | 'width' | 'zoom'

const PT_TO_PX = 96 / 72
const MAX_PIXELS = 18_000_000
const IDLE_MS = 2500

/** One small page in the side strip, drawn when it scrolls into view. */
function Thumb({ doc, n, on, seen, onPick }: { doc: Doc; n: number; on: boolean; seen: boolean; onPick: (n: number) => void }) {
  const btn = useRef<HTMLButtonElement>(null)
  const cv = useRef<HTMLCanvasElement>(null)
  const [show, setShow] = useState(n <= 6)
  const [drawn, setDrawn] = useState(false)
  useEffect(() => {
    if (show || !btn.current) return
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { setShow(true); io.disconnect() } }, { rootMargin: '300px 0px' })
    io.observe(btn.current)
    return () => io.disconnect()
  }, [show])
  useEffect(() => {
    if (!show || !cv.current) return
    let task: any = null, live = true
    doc.getPage(n).then((p: any) => {
      if (!live || !cv.current) return
      const base = p.getViewport({ scale: 1 })
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const vp = p.getViewport({ scale: (128 / base.width) * dpr })
      cv.current.width = Math.floor(vp.width); cv.current.height = Math.floor(vp.height)
      task = p.render({ canvasContext: cv.current.getContext('2d')!, viewport: vp })
      task.promise.then(() => live && setDrawn(true)).catch(() => {})
    })
    return () => { live = false; try { task?.cancel() } catch { /* done */ } }
  }, [doc, n, show])
  useEffect(() => { if (on) btn.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) }, [on])
  return (
    <button ref={btn} className="lx-thumb" aria-current={on ? 'true' : undefined} aria-label={`Page ${n}`} onClick={() => onPick(n)}>
      <canvas ref={cv} style={drawn ? undefined : { aspectRatio: '4 / 3', background: 'rgba(255,255,255,.08)' }} />
      {seen && !on && <span className="lx-thumb-seen"><IconCheck size={11} /></span>}
      <span className="lx-num">{n}</span>
    </button>
  )
}

export default function PdfDeck({ url, title, startPage = 1, seenPages, onPage, height }: {
  url: string
  title?: string
  startPage?: number
  /** Pages seen on earlier visits. */
  seenPages?: number[]
  onPage?: (page: number, pages: number, seen: number[]) => void
  /** CSS height of the deck; the stylesheet's default fits the player. */
  height?: string
}) {
  const deck = useRef<HTMLDivElement>(null)
  const view = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const textLayer = useRef<HTMLDivElement>(null)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const swipe = useRef<{ x: number; y: number } | null>(null)
  const [doc, setDoc] = useState<Doc | null>(null)
  const [failed, setFailed] = useState(false)
  const [page, setPage] = useState(Math.max(1, startPage))
  const [base, setBase] = useState<{ w: number; h: number } | null>(null)
  const [box, setBox] = useState({ w: 800, h: 560 })
  const [mode, setMode] = useState<Mode>('page')
  const [zoom, setZoom] = useState(1)
  const [thumbs, setThumbs] = useState(false)
  const [full, setFull] = useState(false)
  const [idle, setIdle] = useState(false)
  const [anim, setAnim] = useState<{ dir: 'next' | 'prev'; n: number } | null>(null)
  const [seen, setSeen] = useState<Set<number>>(() => new Set(seenPages || []))
  const onPageRef = useRef(onPage)
  useEffect(() => { onPageRef.current = onPage })

  const pages = doc?.numPages || 0

  useEffect(() => {
    let live = true, opened: Doc | null = null
    setDoc(null); setFailed(false)
    fetch(url)
      .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer() })
      .then(loadPdf)
      .then(d => {
        opened = d
        if (!live) { void d.destroy(); return }
        setDoc(d)
        setPage(p => Math.min(Math.max(1, p), d.numPages))
        // Thumbnails on by default where there is room for them.
        setThumbs(d.numPages > 1 && window.innerWidth > 1100)
      })
      .catch(() => { if (live) setFailed(true) })
    return () => { live = false; void opened?.destroy() }
  }, [url])

  useEffect(() => {
    const el = view.current
    if (!el) return
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [doc])

  // The page's own size, in PDF points.
  useEffect(() => {
    if (!doc) return
    let live = true
    doc.getPage(page).then((p: any) => { if (live) { const v = p.getViewport({ scale: 1 }); setBase({ w: v.width, h: v.height }) } })
    return () => { live = false }
  }, [doc, page])

  // Seen, then reported. Two steps: the report updates the parent's state, which must not happen
  // inside this component's own state update (React refuses a setState during another's render).
  useEffect(() => {
    if (pages) setSeen(s => (s.has(page) ? s : new Set(s).add(page)))
  }, [page, pages])
  useEffect(() => {
    if (pages && seen.has(page)) onPageRef.current?.(page, pages, [...seen])
  }, [seen, page, pages])

  const pad = full ? 0 : 48
  const fit = base ? {
    page: Math.min((box.w - pad) / base.w, (box.h - pad) / base.h),
    width: (box.w - pad - (full ? 0 : 8)) / base.w,
  } : { page: 1, width: 1 }
  const scale = Math.max(0.1, mode === 'zoom' ? zoom : mode === 'width' && !full ? fit.width : fit.page)
  const w = base ? Math.floor(base.w * scale) : 0
  const h = base ? Math.floor(base.h * scale) : 0

  // Draw the page at the screen's pixel density, and its text layer over it.
  useEffect(() => {
    if (!doc || !base || !canvas.current || !w) return
    let live = true, task: any = null, text: any = null
    doc.getPage(page).then(async (p: any) => {
      if (!live || !canvas.current) return
      let dpr = Math.min(3, window.devicePixelRatio || 1)
      if (w * h * dpr * dpr > MAX_PIXELS) dpr = Math.sqrt(MAX_PIXELS / (w * h))
      const vp = p.getViewport({ scale: scale * dpr })
      const c = canvas.current
      c.width = Math.floor(vp.width); c.height = Math.floor(vp.height)
      task = p.render({ canvasContext: c.getContext('2d')!, viewport: vp })
      await task.promise.catch(() => {})
      if (!live || !textLayer.current) return
      const holder = textLayer.current
      holder.replaceChildren()
      holder.style.setProperty('--scale-factor', String(scale))
      try {
        const lib: any = await import('pdfjs-dist')
        text = new lib.TextLayer({ textContentSource: p.streamTextContent(), container: holder, viewport: p.getViewport({ scale }) })
        await text.render()
      } catch { /* a page without text is still a page */ }
    })
    return () => { live = false; try { task?.cancel() } catch { /* done */ } ; try { text?.cancel() } catch { /* done */ } }
  }, [doc, page, base, scale, w, h])

  const go = useCallback((n: number) => {
    if (!pages) return
    const to = Math.max(1, Math.min(pages, n))
    setPage(p => {
      if (to !== p) setAnim(a => ({ dir: to > p ? 'next' : 'prev', n: (a?.n || 0) + 1 }))
      return to
    })
    if (view.current) view.current.scrollTop = 0
  }, [pages])

  const zoomBy = (f: number) => { setZoom(Math.max(0.25, Math.min(6, scale * f))); setMode('zoom') }

  const toggleFull = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await deck.current?.requestFullscreen()
    } catch { /* not allowed */ }
  }, [])
  useEffect(() => {
    const on = () => { const f = document.fullscreenElement === deck.current; setFull(f); if (f) setMode('page') }
    document.addEventListener('fullscreenchange', on)
    return () => document.removeEventListener('fullscreenchange', on)
  }, [])

  const poke = useCallback(() => {
    setIdle(false)
    if (idleTimer.current) clearTimeout(idleTimer.current)
    idleTimer.current = setTimeout(() => setIdle(true), IDLE_MS)
  }, [])
  useEffect(() => () => { if (idleTimer.current) clearTimeout(idleTimer.current) }, [])

  const onKey = useCallback((e: KeyboardEvent | React.KeyboardEvent) => {
    const t = e.target as HTMLElement
    if (/INPUT|TEXTAREA|SELECT/.test(t?.tagName || '') || e.metaKey || e.ctrlKey || e.altKey) return
    const k = e.key
    if (k === 'ArrowRight' || k === 'PageDown' || (k === ' ' && !e.shiftKey && t?.tagName !== 'BUTTON') || k === 'n') { e.preventDefault(); go(page + 1) }
    else if (k === 'ArrowLeft' || k === 'PageUp' || (k === ' ' && e.shiftKey) || k === 'p') { e.preventDefault(); go(page - 1) }
    else if (k === 'Home') { e.preventDefault(); go(1) }
    else if (k === 'End') { e.preventDefault(); go(pages) }
    else if (k === '+' || k === '=') { e.preventDefault(); zoomBy(1.2) }
    else if (k === '-') { e.preventDefault(); zoomBy(1 / 1.2) }
    else if (k === '0') setMode('page')
    else if (k === 'w') setMode('width')
    else if (k === 'f') void toggleFull()
    else return
    poke()
  }, [go, page, pages, toggleFull, poke]) // eslint-disable-line react-hooks/exhaustive-deps

  // In full screen the keys work wherever focus is; otherwise only when the deck has it.
  useEffect(() => {
    if (!full) return
    const k = (e: KeyboardEvent) => onKey(e)
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [full, onKey])

  const onDown = (e: React.PointerEvent) => { if (e.pointerType !== 'mouse') swipe.current = { x: e.clientX, y: e.clientY } }
  const onUp = (e: React.PointerEvent) => {
    const s = swipe.current
    swipe.current = null
    if (!s || mode === 'zoom') return
    const dx = e.clientX - s.x, dy = e.clientY - s.y
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) go(page + (dx < 0 ? 1 : -1))
  }

  if (failed) {
    return (
      <div className="lx-deck" style={height ? { height } : undefined}>
        <div className="lx-deck-msg" style={{ gridRow: '1 / -1' }}>
          <div style={{ fontWeight: 700, color: 'var(--lx-on-stage)' }}>This document would not open here.</div>
          <div>Use Open or Download below the lesson to read it.</div>
        </div>
      </div>
    )
  }

  const pctPx = Math.round((scale / PT_TO_PX) * 100)
  const seenCount = seen.size
  return (
    <div ref={deck} className="lx-deck" data-thumbs={thumbs && !full ? '1' : '0'} data-idle={full && idle ? '1' : '0'} tabIndex={0}
      aria-label={title ? `Document: ${title}` : 'Document'} onKeyDown={full ? undefined : onKey} onMouseMove={full ? poke : undefined}
      style={height ? { height } : undefined}>
      <div className="lx-deck-bar" role="toolbar" aria-label="Document controls">
        <button className="lx-vp-btn lx-hide-sm" aria-pressed={thumbs} onClick={() => setThumbs(t => !t)} aria-label="Page thumbnails" title="Page thumbnails" disabled={!pages || pages < 2}><GThumbs size={19} /></button>
        <span className="lx-deck-sep lx-hide-sm" />
        <button className="lx-vp-btn" onClick={() => go(page - 1)} disabled={page <= 1} aria-label="Previous page" title="Previous (←)"><GLeft size={20} /></button>
        <span className="lx-deck-page">
          <input aria-label="Page number" inputMode="numeric" data-no-titlecase="" value={pages ? page : ''} disabled={!pages}
            onChange={e => { const n = Number(e.target.value.replace(/\D/g, '')); if (n) go(n) }} />
          <span>of {pages || '…'}</span>
        </span>
        <button className="lx-vp-btn" onClick={() => go(page + 1)} disabled={!pages || page >= pages} aria-label="Next page" title="Next (→)"><GRight size={20} /></button>
        <span className="lx-deck-sep" />
        <button className="lx-vp-btn" onClick={() => zoomBy(1 / 1.2)} aria-label="Zoom out" title="Zoom out (−)"><GZoomOut size={19} /></button>
        <span className="lx-deck-zoom" aria-live="polite">{pctPx}%</span>
        <button className="lx-vp-btn" onClick={() => zoomBy(1.2)} aria-label="Zoom in" title="Zoom in (+)"><GZoomIn size={19} /></button>
        <button className="lx-vp-btn lx-hide-sm" aria-pressed={mode === 'width'} onClick={() => setMode('width')} aria-label="Fit to width" title="Fit to width (W)"><GFitWidth size={19} /></button>
        <button className="lx-vp-btn" aria-pressed={mode === 'page'} onClick={() => setMode('page')} aria-label="Fit to page" title="Fit to page (0)"><GFitPage size={19} /></button>
        <span className="lx-deck-sep" />
        <span className="lx-deck-page lx-hide-sm" title="Pages you have looked at">{seenCount} of {pages || '…'} seen</span>
        <button className="lx-vp-btn" onClick={toggleFull} aria-label={full ? 'Exit presentation' : 'Present full screen'} title={full ? 'Exit (Esc)' : 'Present full screen (F)'}>
          {full ? <GFullExit size={19} /> : <GPresent size={20} />}
        </button>
        {!full && <button className="lx-vp-btn lx-hide-sm" onClick={toggleFull} aria-label="Full screen" title="Full screen"><GFull size={18} /></button>}
      </div>

      {thumbs && !full && doc && (
        <div className="lx-deck-thumbs" aria-label="Pages">
          {Array.from({ length: pages }, (_, i) => <Thumb key={i} doc={doc} n={i + 1} on={i + 1 === page} seen={seen.has(i + 1)} onPick={go} />)}
        </div>
      )}

      <div ref={view} className="lx-deck-view" data-fit={mode === 'page' ? 'page' : 'width'} onPointerDown={onDown} onPointerUp={onUp}>
        {!doc ? (
          <div className="lx-deck-msg">
            <div className="lx-vp-spin" style={{ position: 'static', margin: 0 }} />
            <div>Opening the document…</div>
          </div>
        ) : (
          <div key={anim?.n || 0} className="lx-deck-page-frame" data-anim={anim?.dir} style={{ width: w || undefined, height: h || undefined }}>
            <canvas ref={canvas} aria-label={`Page ${page} of ${pages}`} />
            <div ref={textLayer} className="lx-text-layer" />
          </div>
        )}
        {doc && page > 1 && <button className="lx-deck-side-hit" data-dir="prev" onClick={() => go(page - 1)} aria-label="Previous page"><span><GLeft size={22} /></span></button>}
        {doc && page < pages && <button className="lx-deck-side-hit" data-dir="next" onClick={() => go(page + 1)} aria-label="Next page"><span><GRight size={22} /></span></button>}
      </div>
      <div className="lx-deck-progress" aria-hidden><i style={{ width: `${pages ? (page / pages) * 100 : 0}%` }} /></div>
    </div>
  )
}
