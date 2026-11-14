'use client'
// components/analytics/export.tsx — "Download PDF": the analytics page as the reader
// sees it, on A4.
//
// How: the same components the page uses are drawn once more, off-screen, at a fixed
// desktop width and inside <Printing> (lists print 25 rows, screen-only controls step
// aside). html2canvas photographs each section in the LIGHT theme whatever the screen
// is in, the pictures are cut into pages between cards (or between table rows when a
// card is taller than a page), and pdf-lib lays them out with a header and page
// numbers. Nothing leaves the browser — the PDF is made from what is already loaded.
//
// Why a picture and not a rebuilt document: the request was "download it the way I see
// it". A picture of the real components cannot drift from the screen; a second layout
// in a PDF library would.

import * as React from 'react'
import { createPortal } from 'react-dom'
import { C, F, W, R, S, E, Z, Button, IconDownload, IconChevronDown } from '@/lib/ui'
import { useDismiss } from '@/lib/ui/useDismiss'
import { Printing } from './printing'

/** The width the PDF is drawn at (CSS px) — a laptop screen, so grids lay out as there. */
const STAGE_W = 1180

export interface PdfSection { key: string; title?: string; node: React.ReactNode }
export interface PdfJob {
  /** Top of the first page and the running header. */
  title: string
  /** The scope in words: company, filters, period. */
  subtitle: string
  /** Who made it and when — printed on the first page and in every footer. */
  byline: string
  filename: string
  /** Each section starts a new page. */
  sections: PdfSection[]
}

type Stage = { job: PdfJob; resolve: () => void; reject: (e: unknown) => void }

/** The hook a page uses: `run(job)` makes and downloads the PDF; render `stage`
 *  somewhere in the page (it portals itself off-screen). */
export function usePdfExport() {
  const [stage, setStage] = React.useState<Stage | null>(null)
  const [step, setStep] = React.useState<string | null>(null)
  const run = React.useCallback((job: PdfJob) => new Promise<void>((resolve, reject) => {
    setStep('Preparing…')
    setStage({ job, resolve, reject })
  }), [])
  const done = React.useCallback(() => { setStage(null); setStep(null) }, [])
  const node = stage ? <PdfStage stage={stage} onStep={setStep} onDone={done} /> : null
  return { run, stage: node, step }
}

function PdfStage({ stage, onStep, onDone }: { stage: Stage; onStep: (s: string) => void; onDone: () => void }) {
  const ref = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        // Let the charts measure their width and redraw, and the fonts settle.
        await frames(3)
        await new Promise(r => setTimeout(r, 450))
        if (document.fonts?.ready) await document.fonts.ready
        if (cancelled || !ref.current) return
        await makePdf(ref.current, stage.job, onStep)
        stage.resolve()
      } catch (e) {
        stage.reject(e)
      } finally {
        if (!cancelled) onDone()
      }
    })()
    return () => { cancelled = true }
    // One run per stage object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage])

  const { job } = stage
  return createPortal(
    <div ref={ref} data-pdf-stage aria-hidden style={{
      position: 'absolute', top: 0, left: -40000, width: STAGE_W, background: C.canvas, color: C.ink,
      fontFamily: F.family, fontSize: F.body, pointerEvents: 'none',
    }}>
      <Printing.Provider value={true}>
        {job.sections.map((sec, i) => (
          // Each section paints its own background: the picture has no transparency.
          <div key={sec.key} data-pdf-section style={{ padding: `${S.lg}px ${S.xl}px`, background: C.canvas }}>
            <div data-pdf-blocks>
              {i === 0 && <ReportHead job={job} />}
              {sec.title && (i > 0 || job.sections.length > 1) && (
                <h2 style={{ margin: `0 0 ${S.md}px`, fontSize: F.title, fontWeight: W.semi, color: C.ink, letterSpacing: '-.01em' }}>{sec.title}</h2>
              )}
              {sec.node}
            </div>
          </div>
        ))}
      </Printing.Provider>
    </div>,
    document.body,
  )
}

function ReportHead({ job }: { job: PdfJob }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: S.lg, marginBottom: S.lg,
      padding: `${S.lg}px ${S.xl}px`, background: C.surface, border: `1px solid ${C.line}`, borderRadius: R.lg, boxShadow: E.flat,
    }}>
      <div>
        <div style={{ fontSize: F.micro, fontWeight: W.bold, color: C.brandDeep, textTransform: 'uppercase', letterSpacing: '.08em' }}>EZER HRMS</div>
        <div style={{ fontSize: 24, fontWeight: W.semi, color: C.ink, letterSpacing: '-.02em', marginTop: 4 }}>{job.title}</div>
        <div style={{ fontSize: F.small, color: C.inkSoft, marginTop: 4 }}>{job.subtitle}</div>
      </div>
      <div style={{ fontSize: F.tiny, color: C.muted, textAlign: 'right', lineHeight: 1.6 }}>
        {job.byline}<br />Contains employee information — share only with people who may see it.
      </div>
    </div>
  )
}

const frames = (n: number) => new Promise<void>(r => { const go = (k: number) => (k <= 0 ? r() : requestAnimationFrame(() => go(k - 1))); go(n) })

/** Text the PDF's built-in font can draw (WinAnsi); ₹ becomes "Rs". */
const ansi = (s: string) => s.replace(/₹\s?/g, 'Rs ').replace(/[^\x20-\x7E -ÿ–—‘’“”•…]/g, '')

/** The cards of a section: its children, looking inside anything taller than a page
 *  (a page-long wrapper is not a card), so a break can fall between the cards inside. */
function blocksOf(el: Element, pagePx: number): Element[] {
  const out: Element[] = []
  for (const kid of el.children) {
    const h = kid.getBoundingClientRect().height
    if (h > pagePx * 0.9 && kid.children.length > 1) out.push(kid, ...blocksOf(kid, pagePx))
    else out.push(kid)
  }
  return out
}

async function makePdf(stage: HTMLElement, job: PdfJob, onStep: (s: string) => void) {
  const [{ default: html2canvas }, { PDFDocument, StandardFonts, rgb }] = await Promise.all([import('html2canvas'), import('pdf-lib')])

  // A4 landscape, in points.
  const PW = 841.89, PH = 595.28, M = 26, HEAD = 16, FOOT = 16
  const contentW = PW - 2 * M, contentH = PH - 2 * M - HEAD - FOOT
  const ptPerPx = contentW / STAGE_W
  const pagePx = contentH / ptPerPx

  const doc = await PDFDocument.create()
  doc.setTitle(ansi(job.title)); doc.setCreator('EZER HRMS'); doc.setProducer('EZER HRMS')
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const pages: { page: ReturnType<typeof doc.addPage> }[] = []

  const sections = [...stage.querySelectorAll<HTMLElement>('[data-pdf-section]')]
  for (let si = 0; si < sections.length; si++) {
    const sec = sections[si]
    onStep(sections.length > 1 ? `Drawing ${si + 1} of ${sections.length}…` : 'Drawing…')
    const secTop = sec.getBoundingClientRect().top
    const height = Math.ceil(sec.scrollHeight)
    const blocksEl = sec.querySelector('[data-pdf-blocks]') || sec
    const blockTops = blocksOf(blocksEl, pagePx).map(b => b.getBoundingClientRect().top - secTop)
    // Every line of text and every chart, so a page break inside a tall card can be put
    // where it cuts through none of them — in every column, not only the longest.
    const marks = inkBoxes(sec, secTop, pagePx)

    // As sharp as the browser allows: iOS refuses canvases much past 16 megapixels.
    const scale = Math.max(0.8, Math.min(2, Math.sqrt(14e6 / (STAGE_W * Math.max(height, 1)))))
    const fix = baselineFix()
    let canvas: HTMLCanvasElement
    try {
      canvas = await html2canvas(sec, {
        scale, backgroundColor: null, logging: false, useCORS: true,
        scrollX: 0, scrollY: 0, windowWidth: STAGE_W + 80, windowHeight: Math.max(height, 800),
        onclone: (d: Document) => lightClone(d),
      })
    } finally { fix.remove() }

    // Cut into pages, between cards where possible, else between rows.
    const cuts: [number, number][] = []
    let start = 0
    while (start < height - 2) {
      const end = start + pagePx
      if (end >= height) { cuts.push([start, height]); break }
      const at = blockTops.filter(t => t > start + 40 && t <= end).sort((a, b) => b - a)[0] ?? cleanCut(marks, start + pagePx * 0.45, end) ?? end
      cuts.push([start, at])
      start = at
    }

    for (const [a, b] of cuts) {
      const slice = document.createElement('canvas')
      slice.width = canvas.width
      slice.height = Math.max(1, Math.round((b - a) * scale))
      const ctx = slice.getContext('2d')!
      ctx.drawImage(canvas, 0, Math.round(a * scale), canvas.width, slice.height, 0, 0, slice.width, slice.height)
      const jpg = await new Promise<ArrayBuffer>((res, rej) => slice.toBlob(bl => (bl ? bl.arrayBuffer().then(res, rej) : rej(new Error('Could not draw the page.'))), 'image/jpeg', 0.9))
      const img = await doc.embedJpg(jpg)
      const page = doc.addPage([PW, PH])
      const h = (b - a) * ptPerPx
      page.drawImage(img, { x: M, y: PH - M - HEAD - h, width: contentW, height: h })
      pages.push({ page })
    }
  }

  const ink = rgb(0.2, 0.23, 0.3), muted = rgb(0.45, 0.48, 0.55)
  const head = ansi(`${job.title} · ${job.subtitle}`)
  const foot = ansi(`${job.byline} · Confidential — contains employee information`)
  pages.forEach(({ page }, i) => {
    page.drawText('EZER HRMS', { x: M, y: PH - M - 9, size: 8, font: bold, color: ink })
    page.drawText(fit(head, font, 8, contentW - 70), { x: M + 62, y: PH - M - 9, size: 8, font, color: muted })
    page.drawText(fit(foot, font, 7.5, contentW - 80), { x: M, y: M - 4, size: 7.5, font, color: muted })
    const n = `Page ${i + 1} of ${pages.length}`
    page.drawText(n, { x: PW - M - font.widthOfTextAtSize(n, 7.5), y: M - 4, size: 7.5, font, color: muted })
  })

  onStep('Saving…')
  const bytes = await doc.save()
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }))
  const a = document.createElement('a')
  a.href = url; a.download = job.filename
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

/** The boxes a page break must not cut: text lines, charts, pictures, pills. */
function inkBoxes(sec: HTMLElement, top: number, pagePx: number): [number, number][] {
  const out: [number, number][] = []
  const walker = document.createTreeWalker(sec, NodeFilter.SHOW_TEXT)
  const range = document.createRange()
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.textContent?.trim()) continue
    range.selectNodeContents(n)
    for (const r of range.getClientRects()) if (r.height > 0) out.push([r.top - top - 2, r.bottom - top + 2])
  }
  for (const el of sec.querySelectorAll('svg, img, canvas')) {
    if (el.parentElement?.closest('svg')) continue
    const r = el.getBoundingClientRect()
    if (r.height > 0 && r.height < pagePx) out.push([r.top - top - 2, r.bottom - top + 2])
  }
  return out.sort((a, b) => a[0] - b[0])
}

/** The lowest line in [lo, hi] that crosses no box, or null. */
function cleanCut(boxes: [number, number][], lo: number, hi: number): number | null {
  const near = boxes.filter(([a, b]) => b > lo && a < hi)
  const tops = [...new Set([hi, ...near.map(([a]) => a), ...near.map(([, b]) => b)])].filter(y => y >= lo && y <= hi).sort((a, b) => b - a)
  for (const y of tops) if (!near.some(([a, b]) => a < y && b > y)) return Math.round(y)
  return null
}

/** html2canvas finds the text baseline with a 1px image; the app's base CSS makes images
 *  display:block, which moves that image and draws every line a few pixels low. Only
 *  html2canvas's own hidden measuring box is matched, only while a picture is taken. */
function baselineFix(): { remove: () => void } {
  const st = document.createElement('style')
  st.textContent = 'body > div[style*="visibility: hidden"] > img { display: inline !important; }'
  document.head.appendChild(st)
  return { remove: () => st.remove() }
}

function fit(text: string, font: { widthOfTextAtSize: (t: string, s: number) => number }, size: number, max: number): string {
  if (font.widthOfTextAtSize(text, size) <= max) return text
  let t = text
  while (t.length > 4 && font.widthOfTextAtSize(t + '…', size) > max) t = t.slice(0, -1)
  return t + '…'
}

/** Inside html2canvas's copy of the page: light theme, no motion, the stage on-screen,
 *  and every SVG colour written out — a chart's `var(--ez-viz-1)` means nothing once
 *  the SVG is turned into a picture of its own. */
function lightClone(d: Document) {
  const root = d.documentElement
  root.setAttribute('data-theme', 'light')
  root.setAttribute('data-ez-theme', 'light')
  root.style.colorScheme = 'light'
  const st = d.createElement('style')
  st.textContent = '*,*::before,*::after{animation:none!important;transition:none!important}'
  d.head.appendChild(st)
  const stage = d.querySelector<HTMLElement>('[data-pdf-stage]')
  if (stage) stage.style.left = '0px'
  const win = d.defaultView
  if (!win || !stage) return
  const props = ['fill', 'stroke', 'stop-color', 'color', 'opacity', 'fill-opacity', 'stroke-opacity', 'font-family', 'font-size', 'font-weight']
  for (const svg of stage.querySelectorAll('svg')) {
    for (const el of [svg, ...svg.querySelectorAll('*')] as SVGElement[]) {
      const cs = win.getComputedStyle(el)
      for (const p of props) { const v = cs.getPropertyValue(p); if (v) el.style.setProperty(p, v) }
    }
  }
}

// ── The button ──────────────────────────────────────────────────────────────

export interface DownloadOption { key: string; label: string; hint?: string; run: () => void | Promise<void> }

/** "Download ▾" with the formats on offer. Shows progress while a PDF is being drawn. */
export function DownloadMenu({ options, step, disabled, size = 'sm', variant = 'primary' }: {
  options: DownloadOption[]; step?: string | null; disabled?: boolean; size?: 'sm' | 'md'; variant?: 'primary' | 'secondary'
}) {
  const [open, setOpen] = React.useState(false)
  const [err, setErr] = React.useState('')
  const ref = useDismiss<HTMLDivElement>(open, () => setOpen(false))
  const pick = async (o: DownloadOption) => {
    setOpen(false); setErr('')
    try { await o.run() } catch (e: any) { setErr(e?.message || 'The download could not be made.') }
  }
  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end' }}>
      <Button size={size} variant={variant} icon={<IconDownload size={14} />} disabled={disabled || !!step} onClick={() => setOpen(o => !o)}>
        {step || 'Download'} {!step && <IconChevronDown size={12} />}
      </Button>
      {open && (
        <div role="menu" style={{
          position: 'absolute', top: 'calc(100% + 6px)', right: 0, minWidth: 250, padding: 6, zIndex: Z.sticky + 1,
          background: C.surface, border: `1px solid ${C.line}`, borderRadius: R.md, boxShadow: E.floating,
        }}>
          {options.map(o => (
            <button key={o.key} role="menuitem" type="button" onClick={() => pick(o)} className="ez-row" style={{
              display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', border: 'none', borderRadius: R.sm,
              background: 'transparent', cursor: 'pointer', fontFamily: 'inherit',
            }}>
              <span style={{ display: 'block', fontSize: F.small, color: C.ink, fontWeight: W.medium }}>{o.label}</span>
              {o.hint && <span style={{ display: 'block', fontSize: F.micro, color: C.muted, marginTop: 2 }}>{o.hint}</span>}
            </button>
          ))}
        </div>
      )}
      {err && <div role="alert" style={{ fontSize: F.micro, color: C.critical, marginTop: 4, maxWidth: 260, textAlign: 'right' }}>{err}</div>}
    </div>
  )
}

/** Today in India, for file names. */
export const istDay = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10)

/** "Made by Kiran Sharma on 14 Nov 2026, 12:30 pm" */
export function bylineOf(name?: string | null) {
  const when = new Date().toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
  return `Downloaded${name ? ` by ${name}` : ''} on ${when}`
}
