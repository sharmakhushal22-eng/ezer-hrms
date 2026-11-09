'use client'
// components/learning/motion/Carousel.tsx — a slideshow that moves on by itself, and stops the
// moment anyone engages with it.
//
// It waits while the pointer or keyboard focus is inside it, while it is scrolled out of view,
// while the tab is in the background, and from the start for anyone who has asked for less
// motion (the play button still lets them start it). A pause button is always there. The time
// left on a slide is the fill of its dot, a CSS animation, so pausing freezes the dot and the
// slide moves on when the fill completes.
//
// Every slide sits in the same grid cell, so the carousel is as tall as its tallest slide and
// nothing below it jumps when the slide changes. The slides that are not showing are inert:
// out of the tab order and hidden from screen readers.
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { GLeft, GPause, GPlay, GRight } from '../glyphs'
import { useInView, usePageVisible, useReducedMotion } from './useInView'

const SWIPE_PX = 48

export function Carousel<T>({ items, label, slideLabel, render, interval = 7000, variant = 'overlay', className }: {
  items: T[]
  /** What the whole carousel is, for screen readers: "Spotlight courses". */
  label: string
  slideLabel: (item: T, index: number) => string
  render: (item: T, active: boolean) => ReactNode
  /** How long a slide stays, in milliseconds. */
  interval?: number
  /** Controls over the slide (a picture underneath) or below it. */
  variant?: 'overlay' | 'below'
  className?: string
}) {
  const n = items.length
  const [at, setAt] = useState(0)
  const reduced = useReducedMotion()
  const [playing, setPlaying] = useState(true)
  useEffect(() => { if (reduced) setPlaying(false) }, [reduced])
  const [hover, setHover] = useState(false)
  const [focused, setFocused] = useState(false)
  const held = hover || focused
  const root = useRef<HTMLElement>(null)
  const inView = useInView(root, { threshold: 0.35 })
  const visible = usePageVisible()
  const running = playing && !held && inView && visible && n > 1

  useEffect(() => { if (at >= n) setAt(0) }, [at, n])
  const go = useCallback((i: number) => setAt(((i % n) + n) % n), [n])

  // A drag sideways is a swipe; the click that a mouse drag ends in must not also open a link.
  const start = useRef<{ x: number; y: number } | null>(null)
  const swiped = useRef(false)
  const down = (e: PointerEvent) => { start.current = { x: e.clientX, y: e.clientY }; swiped.current = false }
  const up = (e: PointerEvent) => {
    const s = start.current
    start.current = null
    if (!s) return
    const dx = e.clientX - s.x, dy = e.clientY - s.y
    if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy) * 1.3) { swiped.current = true; go(at + (dx < 0 ? 1 : -1)) }
  }
  const key = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input,textarea,select')) return
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(at - 1) }
    if (e.key === 'ArrowRight') { e.preventDefault(); go(at + 1) }
  }

  if (!n) return null
  return (
    <section ref={root} className={`lx-car lx-car--${variant} ${className || ''}`} aria-roledescription="carousel" aria-label={label} onKeyDown={key}
      onPointerEnter={e => { if (e.pointerType === 'mouse') setHover(true) }} onPointerLeave={e => { if (e.pointerType === 'mouse') setHover(false) }}
      onFocus={e => { if ((e.target as HTMLElement).matches?.(':focus-visible')) setFocused(true) }} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false) }}>
      <div className="lx-car-view" aria-live={running ? 'off' : 'polite'}
        onPointerDown={down} onPointerUp={up} onPointerCancel={() => { start.current = null }}
        onClickCapture={e => { if (swiped.current) { e.preventDefault(); e.stopPropagation(); swiped.current = false } }}
        onDragStart={e => e.preventDefault()}>
        {items.map((it, i) => (
          <div key={i} className="lx-car-slide" data-on={i === at ? '1' : '0'} role="group" aria-roledescription="slide"
            aria-label={`${i + 1} of ${n}: ${slideLabel(it, i)}`} aria-hidden={i !== at} inert={i !== at}>
            {render(it, i === at)}
          </div>
        ))}
      </div>
      {n > 1 && (
        <div className="lx-car-bar">
          <button type="button" className="lx-car-btn" onClick={() => setPlaying(p => !p)} aria-label={playing ? 'Pause the slideshow' : 'Play the slideshow'}>
            {playing ? <GPause size={14} /> : <GPlay size={14} />}
          </button>
          <button type="button" className="lx-car-btn" onClick={() => go(at - 1)} aria-label="Previous slide"><GLeft size={16} /></button>
          <div className="lx-car-dots">
            {items.map((it, i) => (
              <button key={i} type="button" className="lx-car-dot" aria-current={i === at ? 'true' : undefined} aria-label={`Show slide ${i + 1}: ${slideLabel(it, i)}`} onClick={() => go(i)}>
                <span className="lx-car-pip">
                  {i === at && (playing
                    ? <i key={at} className="lx-car-fill lx-motion-keep" data-run={running ? '1' : '0'} style={{ animationDuration: `${interval}ms` }} onAnimationEnd={() => go(at + 1)} />
                    : <i className="lx-car-fill" data-still="1" />)}
                </span>
              </button>
            ))}
          </div>
          <button type="button" className="lx-car-btn" onClick={() => go(at + 1)} aria-label="Next slide"><GRight size={16} /></button>
        </div>
      )}
    </section>
  )
}
