'use client'
// components/learning/motion/Scroller.tsx — a row that scrolls sideways: course shelves, the
// category chips. Arrow buttons move it a page at a time and disappear at either end, the edge
// that still has more to show fades out, and a thin bar under a shelf shows how far along it is
// (CSS scroll-driven, where the browser has it; motion.css). Swipe and trackpad work as ever.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { GLeft, GRight } from '../glyphs'

export function Scroller({ children, className, n, progress, variant, label, role, style }: {
  children: ReactNode
  /** The class of the scrolling row itself: lx-rail, lx-chips. */
  className: string
  /** How many items, so the edges are measured again when it changes. */
  n: number
  /** Show the position bar under the row. */
  progress?: boolean
  variant?: 'chips'
  label?: string
  role?: string
  style?: CSSProperties
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [edge, setEdge] = useState({ start: true, end: true })
  const check = () => {
    const el = ref.current
    if (!el) return
    const start = el.scrollLeft < 8, end = el.scrollLeft + el.clientWidth >= el.scrollWidth - 8
    setEdge(e => (e.start === start && e.end === end ? e : { start, end }))
  }
  useEffect(() => {
    check()
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [n])
  const by = (dir: 1 | -1) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.85, behavior: 'smooth' })
  const over = !(edge.start && edge.end)
  return (
    <div className={`lx-rail-wrap lx-scroller ${variant ? `lx-scroller--${variant}` : ''}`} data-start={edge.start ? '1' : '0'} data-end={edge.end ? '1' : '0'} data-over={over ? '1' : '0'}>
      <button type="button" className="lx-rail-btn" data-dir="prev" disabled={edge.start} onClick={() => by(-1)} aria-label="Scroll back"><GLeft size={18} /></button>
      <div ref={ref} className={className} data-n={n} onScroll={check} role={role} aria-label={label} style={style}>{children}</div>
      <button type="button" className="lx-rail-btn" data-dir="next" disabled={edge.end} onClick={() => by(1)} aria-label="Scroll on"><GRight size={18} /></button>
      {progress && <div className="lx-scroll-prog" aria-hidden><i /></div>}
    </div>
  )
}
