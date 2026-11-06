'use client'
// components/learning/motion/Scroller.tsx — a row that scrolls sideways: course shelves, the
// category chips. Arrow buttons move it a page at a time and disappear at either end, the edge
// that still has more to show fades out, and a thin bar under a shelf shows how far along it is
// (CSS scroll-driven, where the browser has it; motion.css). Swipe and trackpad work as ever.
//
// With `auto`, a shelf also moves on by one card every few seconds, the way a streaming
// service's rows glide, and goes back to the start after the last card. It holds still while the
// pointer is over it, while anything in it has focus, for a few seconds after a touch, while it
// is off screen or the tab is hidden, and for anyone who has asked for less motion. A pause
// button under the shelf stops it for good.
import { useEffect, useRef, useState, type CSSProperties, type FocusEvent, type PointerEvent, type ReactNode } from 'react'
import { GLeft, GPause, GPlay, GRight } from '../glyphs'
import { useInView, useReducedMotion } from './useInView'

export function Scroller({ children, className, n, progress, variant, label, role, style, auto }: {
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
  /** Move on by one item every this many milliseconds. */
  auto?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const touch = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [edge, setEdge] = useState({ start: true, end: true })
  const [held, setHeld] = useState(false)
  const [stopped, setStopped] = useState(false)
  const seen = useInView(wrap)
  const reduce = useReducedMotion()
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
  useEffect(() => () => { if (touch.current) clearTimeout(touch.current) }, [])

  const over = !(edge.start && edge.end)
  const moving = !!auto && over && !reduce && !stopped
  const running = moving && seen && !held
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => {
      const el = ref.current
      if (!el || document.visibilityState !== 'visible') return
      if (el.scrollLeft + el.clientWidth >= el.scrollWidth - 8) { el.scrollTo({ left: 0, behavior: 'smooth' }); return }
      const first = el.firstElementChild as HTMLElement | null
      const gap = parseFloat(getComputedStyle(el).columnGap) || 0
      el.scrollBy({ left: (first?.offsetWidth || el.clientWidth) + gap, behavior: 'smooth' })
    }, auto)
    return () => clearInterval(t)
  }, [running, auto])

  const by = (dir: 1 | -1) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.85, behavior: 'smooth' })
  const hold = auto ? {
    onPointerEnter: (e: PointerEvent) => { if (e.pointerType === 'mouse') setHeld(true) },
    onPointerLeave: (e: PointerEvent) => { if (e.pointerType === 'mouse') setHeld(false) },
    onPointerDown: (e: PointerEvent) => {
      if (e.pointerType === 'mouse') return
      // A finger on the shelf: leave it where they put it for a while.
      setHeld(true)
      if (touch.current) clearTimeout(touch.current)
      touch.current = setTimeout(() => setHeld(false), 8000)
    },
    onFocus: () => setHeld(true),
    onBlur: (e: FocusEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHeld(false) },
  } : {}
  return (
    <div ref={wrap} className={`lx-rail-wrap lx-scroller ${variant ? `lx-scroller--${variant}` : ''}`} data-start={edge.start ? '1' : '0'} data-end={edge.end ? '1' : '0'} data-over={over ? '1' : '0'} {...hold}>
      <button type="button" className="lx-rail-btn" data-dir="prev" disabled={edge.start} onClick={() => by(-1)} aria-label="Scroll back"><GLeft size={18} /></button>
      <div ref={ref} className={className} data-n={n} onScroll={check} role={role} aria-label={label} style={style}>{children}</div>
      <button type="button" className="lx-rail-btn" data-dir="next" disabled={edge.end} onClick={() => by(1)} aria-label="Scroll on"><GRight size={18} /></button>
      {(progress || (auto && over && !reduce)) && (
        <div className="lx-rail-foot">
          {progress && <div className="lx-scroll-prog" aria-hidden><i /></div>}
          {auto && over && !reduce && (
            <button type="button" className="lx-rail-auto" aria-pressed={stopped} onClick={() => setStopped(s => !s)}
              aria-label={stopped ? 'Play this row again' : 'Stop this row moving'} title={stopped ? 'Play' : 'Pause'}>
              {stopped ? <GPlay size={11} /> : <GPause size={11} />}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
