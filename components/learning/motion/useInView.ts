'use client'
// components/learning/motion/useInView.ts — the three questions every moving part of EZER Learn
// asks before it moves: has the person asked for less motion, is this on screen, and is the tab
// in front of them. Anything that animates on its own stops when any answer is no.
import { useEffect, useLayoutEffect, useState, type RefObject } from 'react'

const REDUCE = '(prefers-reduced-motion: reduce)'

/** Read once, where a hook cannot be used (an event handler, the router). */
export function reducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.(REDUCE).matches
}

/** Layout effect in the browser, plain effect on the server (where neither runs). */
export const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

/** Follows the setting live, so turning it on in the OS stops things without a reload. */
export function useReducedMotion(): boolean {
  const [on, setOn] = useState(false)
  useEffect(() => {
    const m = window.matchMedia?.(REDUCE)
    if (!m) return
    const sync = () => setOn(m.matches)
    sync()
    m.addEventListener('change', sync)
    return () => m.removeEventListener('change', sync)
  }, [])
  return on
}

/** Whether the element is on screen. `once` keeps the first yes, for effects that play once. */
export function useInView(ref: RefObject<Element | null>, opts?: { once?: boolean; threshold?: number; margin?: string }): boolean {
  const [seen, setSeen] = useState(false)
  const once = !!opts?.once, threshold = opts?.threshold ?? 0, margin = opts?.margin ?? '0px'
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') { setSeen(true); return }
    const io = new IntersectionObserver(([e]) => {
      setSeen(e.isIntersecting)
      if (e.isIntersecting && once) io.disconnect()
    }, { threshold, rootMargin: margin })
    io.observe(el)
    return () => io.disconnect()
  }, [ref, once, threshold, margin])
  return seen
}

/** False while the tab is in the background. */
export function usePageVisible(): boolean {
  const [shown, setShown] = useState(true)
  useEffect(() => {
    const sync = () => setShown(document.visibilityState !== 'hidden')
    sync()
    document.addEventListener('visibilitychange', sync)
    return () => document.removeEventListener('visibilitychange', sync)
  }, [])
  return shown
}
