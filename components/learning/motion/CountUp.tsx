'use client'
// components/learning/motion/CountUp.tsx — a figure that counts up from zero the first time it
// comes into view. Screen readers get the final figure only; the counting is hidden from them.
// With reduced motion, or a zero, the figure simply shows.
import { useEffect, useRef, useState } from 'react'
import { reducedMotion, useIsoLayoutEffect } from './useInView'

const ease = (t: number) => 1 - Math.pow(1 - t, 3)

export function CountUp({ value, format, suffix = '', duration = 1100 }: {
  value: number
  /** How a figure is written, e.g. with Indian digit grouping. Whole numbers by default. */
  format?: (n: number) => string
  suffix?: string
  duration?: number
}) {
  const fmt = format || ((n: number) => String(Math.round(n)))
  const ref = useRef<HTMLSpanElement>(null)
  const [shown, setShown] = useState(value)
  const played = useRef(false)

  // Before the first paint: start from zero if this is going to count, so the final figure
  // never flashes up first.
  const willPlay = useRef(false)
  useIsoLayoutEffect(() => {
    if (played.current) return
    willPlay.current = Number.isFinite(value) && value > 0 && !reducedMotion()
    if (willPlay.current) setShown(0)
    // Only the first figure decides; a later change just shows (see below).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (played.current) { setShown(value); return }
    if (!willPlay.current) { played.current = true; setShown(value); return }
    const el = ref.current
    if (!el) return
    let raf = 0
    const run = () => {
      played.current = true
      const t0 = performance.now()
      const tick = (t: number) => {
        const k = Math.min(1, (t - t0) / duration)
        setShown(value * ease(k))
        if (k < 1) raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
    }
    if (typeof IntersectionObserver === 'undefined') { run(); return () => cancelAnimationFrame(raf) }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { io.disconnect(); run() } }, { threshold: 0.4 })
    io.observe(el)
    return () => { io.disconnect(); cancelAnimationFrame(raf) }
  }, [value, duration])

  const final = `${fmt(value)}${suffix}`
  // The width of the final figure is held from the start, so counting never nudges what sits beside it.
  return (
    <span ref={ref} className="lx-count" style={{ minWidth: `${final.length}ch` }}>
      <span aria-hidden>{fmt(shown)}{suffix}</span>
      <span className="lx-sr">{final}</span>
    </span>
  )
}
