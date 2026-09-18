'use client'
// Shared bits for the HRIS redesign: toasts, the KPI count-up, and the two pure
// helpers the cards use. Ported from the handover package.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Ic } from './icons'

/* ------------------------------------------------------------------ toast */

interface ToastMsg { id: number; text: string; kind?: 'error' }
const ToastCtx = createContext<(text: string, kind?: 'error') => void>(() => {})
export const useToast = () => useContext(ToastCtx)

export function ToastHost({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastMsg[]>([])
  const seq = useRef(0)
  const show = useCallback((text: string, kind?: 'error') => {
    const id = ++seq.current
    setItems(t => [...t, { id, text, kind }])
    window.setTimeout(() => setItems(t => t.filter(x => x.id !== id)), 2600)
  }, [])
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div className="hx-toasts" aria-live="polite">
        {items.map(t => (
          <div key={t.id} className={`hx-toast${t.kind === 'error' ? ' err' : ''}`} role="status">
            <Ic k={t.kind === 'error' ? 'x' : 'check'} /><span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

/* ---------------------------------------------------------------- motion */

export function usePrefersReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const f = () => setReduce(mq.matches); f()
    mq.addEventListener('change', f); return () => mq.removeEventListener('change', f)
  }, [])
  return reduce
}

/**
 * Counts a KPI up from zero, once. Large numbers and reduced motion skip
 * straight to the value — an odometer on a four-digit count is noise, not
 * feedback.
 */
export function CountUp({ value, run }: { value: number; run: boolean }) {
  const reduce = usePrefersReducedMotion()
  const [n, setN] = useState(run ? 0 : value)
  const done = useRef(false)
  useEffect(() => {
    if (!run || done.current) { setN(value); return }
    done.current = true
    if (reduce || value > 999) { setN(value); return }
    const dur = 560, t0 = performance.now()
    let raf = 0
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / dur)
      setN(Math.round((1 - Math.pow(1 - p, 3)) * value))
      if (p < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [value, run, reduce])
  useEffect(() => { if (done.current) setN(value) }, [value])
  return <>{n}</>
}

/* --------------------------------------------------------------- helpers */

/** A stable hue per name, so 400 colleagues get spread tints with no palette. */
export function hueOf(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h)
  return Math.abs(h) % 360
}

export function initials(name: string): string {
  return (name || '').trim().split(/\s+/).slice(0, 2).map(w => w[0] ?? '').join('').toUpperCase()
}

/** The avatar's inline hue, paired with the .hx-av class. */
export const avatarStyle = (name: string) =>
  ({ ['--h' as string]: String(hueOf(name)) } as React.CSSProperties)

/** Staggered entrance, first paint only. Capped so a long list does not crawl. */
export const riseStyle = (i: number) => ({ ['--i' as string]: String(Math.min(i, 11)) } as React.CSSProperties)

export function useFirstPaint(): boolean {
  const first = useRef(true)
  const [, force] = useState(0)
  useEffect(() => { if (first.current) { first.current = false; force(x => x + 1) } }, [])
  return first.current
}

/** Formats an ISO stamp the way every HRIS screen already does. */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}
