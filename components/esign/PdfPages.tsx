'use client'
// components/esign/PdfPages.tsx — renders a PDF's pages with pdf.js and lets the caller draw
// on top of each one (signature boxes, the "sign here" tags). Shared by the HR composer
// (placing boxes) and the signer page (filling them).
//
// Each page is a canvas rendered at devicePixelRatio for crispness, inside a relatively
// positioned frame of the displayed size; `overlay(page, size)` is rendered into that frame,
// so overlays can position themselves in percentages of the page and never need to know the
// zoom. Pages render lazily as they scroll near the viewport — a 40-page policy stays quick.
import { useEffect, useRef, useState } from 'react'
import { C, E, R } from '@/lib/ui'

type PdfDoc = { numPages: number; getPage(n: number): Promise<any>; destroy(): Promise<void> }

let workerSet = false
async function pdfjs() {
  const lib: any = await import('pdfjs-dist')
  if (!workerSet) {
    lib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
    workerSet = true
  }
  return lib
}

export async function loadPdf(src: ArrayBuffer | Uint8Array): Promise<PdfDoc> {
  const lib = await pdfjs()
  const data = src instanceof Uint8Array ? src.slice() : new Uint8Array(src.slice(0))
  return lib.getDocument({ data, isEvalSupported: false }).promise
}

export interface PageSize { w: number; h: number }

function PdfPage({ doc, n, width, overlay, onSize }: {
  doc: PdfDoc; n: number; width: number
  overlay?: (page: number, size: PageSize) => React.ReactNode
  onSize?: (page: number, size: PageSize) => void
}) {
  const frame = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState<PageSize | null>(null)
  const [visible, setVisible] = useState(n <= 2)

  useEffect(() => {
    let live = true
    doc.getPage(n).then((p: any) => {
      if (!live) return
      const vp = p.getViewport({ scale: 1 })
      const s = { w: width, h: (width * vp.height) / vp.width }
      setSize(s); onSize?.(n, s)
    })
    return () => { live = false }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, n, width])

  useEffect(() => {
    const el = frame.current
    if (!el || visible) return
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { setVisible(true); io.disconnect() } }, { rootMargin: '600px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [visible, size])

  useEffect(() => {
    if (!visible || !size || !canvas.current) return
    let task: any = null, live = true
    doc.getPage(n).then((p: any) => {
      if (!live || !canvas.current) return
      const base = p.getViewport({ scale: 1 })
      const dpr = Math.min(2.5, window.devicePixelRatio || 1)
      const vp = p.getViewport({ scale: (size.w / base.width) * dpr })
      const c = canvas.current
      c.width = Math.floor(vp.width); c.height = Math.floor(vp.height)
      task = p.render({ canvasContext: c.getContext('2d')!, viewport: vp })
      task.promise.catch(() => {})
    })
    return () => { live = false; try { task?.cancel() } catch { /* already done */ } }
  }, [doc, n, size, visible])

  return (
    <div ref={frame} data-page={n} style={{ position: 'relative', width, height: size?.h || width * 1.414, background: C.surface, borderRadius: R.sm, boxShadow: E.raised, overflow: 'hidden', flexShrink: 0 }}>
      <canvas ref={canvas} style={{ width: '100%', height: '100%', display: 'block' }} aria-label={`Page ${n}`} />
      {size && overlay?.(n, size)}
    </div>
  )
}

export default function PdfPages({ doc, width, overlay, onSize, gap = 18, label = true }: {
  doc: PdfDoc | null; width: number
  overlay?: (page: number, size: PageSize) => React.ReactNode
  onSize?: (page: number, size: PageSize) => void
  gap?: number; label?: boolean
}) {
  if (!doc) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap }}>
      {Array.from({ length: doc.numPages }, (_, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          <PdfPage doc={doc} n={i + 1} width={width} overlay={overlay} onSize={onSize} />
          {label && <div style={{ fontSize: 11, color: C.faint, fontVariantNumeric: 'tabular-nums' }}>Page {i + 1} of {doc.numPages}</div>}
        </div>
      ))}
    </div>
  )
}

/** Width that fits the container, re-measured on resize. */
export function useFitWidth(max = 820, pad = 32) {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(Math.min(max, 640))
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setW(Math.max(260, Math.min(max, el.clientWidth - pad))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [max, pad])
  return { ref, width: w }
}
