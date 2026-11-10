'use client'
// components/learning/showcase/preview.ts — what makes a course card come alive on hover, the
// way a streaming service's tiles do: the clip starts buffering the moment the pointer arrives,
// the card grows into a larger one after a short rest, and the clip is already playing by then.
//
//   The store    one hover card for the whole app (HoverLayer draws it); cards only report
//                "the pointer is on me" and "it left".
//   The pool     a few <video> elements kept warm. Pointer on a card: its clip is fetched in
//                full. A card resting in view: only the file's index (preload="metadata"), so
//                the first frame is one request away. When the hover card opens, the warm
//                element itself is moved into it, so nothing buffered is thrown away.
//   The rules    previews play muted (browsers allow nothing else without a click), never on a
//                touch screen, never for someone who asked for less motion or to save data, and
//                never once the person switches them off. Their choice is kept in this browser.
import { useSyncExternalStore } from 'react'
import { lmsApi } from '@/lib/lms/client'
import type { CatCourse } from '../CourseCard'

export interface Preview { src: string; start: number; end: number; source: string }

// ── Preferences ─────────────────────────────────────────────────────────────
const PREF_KEY = 'ezl-previews'
const read = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const write = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* private window */ } }

let autoplayOff: boolean | null = null
/** The person switched previews off, or their device asks for less motion or less data. */
export function previewsBlocked(): 'off' | 'motion' | 'data' | null {
  if (typeof window === 'undefined') return 'off'
  if (autoplayOff == null) autoplayOff = read(PREF_KEY) === 'off'
  if (autoplayOff) return 'off'
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return 'motion'
  const net = (navigator as any).connection
  if (net?.saveData || /(^|-)2g$/.test(net?.effectiveType || '')) return 'data'
  return null
}
export function setAutoplay(on: boolean) { autoplayOff = !on; write(PREF_KEY, on ? 'on' : 'off'); emit() }

/** Muted until someone unmutes a preview; the click that does it is what lets sound play. */
let muted = true
export const isMuted = () => muted
export function setMuted(m: boolean) { muted = m; for (const v of pool.values()) v.muted = m; emit() }

/** Only a real pointer hovers. A touch screen opens the course on tap instead. */
export const canHover = () => typeof window !== 'undefined' && !!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches

// ── The pool ────────────────────────────────────────────────────────────────
const POOL_MAX = 6
const pool = new Map<string, HTMLVideoElement>()   // insertion order = least recently used first

const keyOf = (p: Preview) => p.src

function make(p: Preview): HTMLVideoElement {
  const v = document.createElement('video')
  v.muted = muted
  v.playsInline = true
  v.setAttribute('playsinline', '')
  v.setAttribute('aria-hidden', 'true')
  v.disablePictureInPicture = true
  v.preload = 'metadata'
  v.className = 'lx-pv-video'
  // The #t fragment makes the first request start at the clip, not at the top of the file.
  v.src = `${p.src}${p.src.includes('#') ? '' : `#t=${p.start}`}`
  v.dataset.start = String(p.start)
  v.dataset.end = String(p.end)
  // The clip loops inside its window; outside it the file is never shown.
  v.addEventListener('timeupdate', () => {
    const s = Number(v.dataset.start), e = Number(v.dataset.end)
    if (v.currentTime >= e - 0.12 || v.currentTime < s - 0.5) v.currentTime = s
  })
  v.addEventListener('loadedmetadata', () => { if (v.currentTime < Number(v.dataset.start) - 0.5) v.currentTime = Number(v.dataset.start) })
  v.addEventListener('ended', () => { v.currentTime = Number(v.dataset.start); void v.play().catch(() => {}) })
  return v
}

/** Start fetching a clip. 'full' when the pointer is on its card, 'meta' while it sits in view. */
export function warm(p: Preview | null | undefined, level: 'full' | 'meta' = 'full'): HTMLVideoElement | null {
  if (!p || typeof document === 'undefined' || previewsBlocked() === 'data') return null
  const k = keyOf(p)
  let v = pool.get(k)
  if (v) pool.delete(k)
  else v = make(p)
  pool.set(k, v)
  if (level === 'full' && v.preload !== 'auto') { v.preload = 'auto'; v.load() }
  while (pool.size > POOL_MAX) {
    const [oldKey, old] = pool.entries().next().value as [string, HTMLVideoElement]
    if (old.isConnected) { pool.delete(oldKey); pool.set(oldKey, old); break }   // in use on screen: keep it
    pool.delete(oldKey)
    old.removeAttribute('src'); old.load()   // let the browser drop the connection and the buffer
  }
  return v
}

/** The warm element for a clip, for the hover card to show. */
export function take(p: Preview): HTMLVideoElement | null {
  return warm(p, 'full')
}

/** An element of its own, outside the pool, for something that stays on screen (the billboard),
 *  so a hover card opening on the same course never pulls the video out from under it. */
export function own(p: Preview): HTMLVideoElement | null {
  if (typeof document === 'undefined' || previewsBlocked() === 'data') return null
  const v = make(p)
  v.preload = 'auto'
  return v
}

/** Cards in view warm their clip's index once they have sat still for a moment, a few at a time,
 *  when the browser is idle, and not on a slow or metered connection. */
let io: IntersectionObserver | null = null
const pending = new Map<Element, { p: Preview; t: ReturnType<typeof setTimeout> | null }>()
let warmedMeta = 0
const META_BUDGET = 10
export function watchInView(el: Element, p: Preview | null | undefined): () => void {
  if (!p || typeof IntersectionObserver === 'undefined' || !canHover()) return () => {}
  const net = (navigator as any).connection
  if (net && (/(^|-)[23]g$/.test(net.effectiveType || '') || net.saveData)) return () => {}
  if (!io) {
    io = new IntersectionObserver(entries => {
      for (const e of entries) {
        const w = pending.get(e.target)
        if (!w) continue
        if (e.isIntersecting) {
          w.t = setTimeout(() => {
            if (warmedMeta >= META_BUDGET || previewsBlocked()) return
            const idle = (window as any).requestIdleCallback || ((f: () => void) => setTimeout(f, 200))
            idle(() => { if (!pool.has(keyOf(w.p))) { warmedMeta++; warm(w.p, 'meta') } })
            io?.unobserve(e.target); pending.delete(e.target)
          }, 900)
        } else if (w.t) { clearTimeout(w.t); w.t = null }
      }
    }, { threshold: 0.6 })
  }
  pending.set(el, { p, t: null })
  io.observe(el)
  return () => { const w = pending.get(el); if (w?.t) clearTimeout(w.t); pending.delete(el); io?.unobserve(el) }
}

// ── The hover card's store ──────────────────────────────────────────────────
export interface HoverState { id: number; c: CatCourse; el: HTMLElement; rect: DOMRect; category?: string | null; rank?: number | null }
let opened = 0
let state: HoverState | null = null
let version = 0
const subs = new Set<() => void>()
function emit() { version++; for (const f of subs) f() }
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f) } }

export function useHover() { return useSyncExternalStore(subscribe, () => state, () => null) }
/** Re-render on any preference or My list change. */
export function usePreviewPrefs() { useSyncExternalStore(subscribe, () => version, () => 0); return { muted, blocked: previewsBlocked() } }

/** How long the pointer rests on a card before it grows. Long enough not to fire while the
 *  pointer crosses a row, short enough to feel immediate. */
export const OPEN_AFTER_MS = 450
const CLOSE_AFTER_MS = 140
let openTimer: ReturnType<typeof setTimeout> | null = null
let closeTimer: ReturnType<typeof setTimeout> | null = null
let over: Element | null = null

export const hover = {
  enter(c: CatCourse, el: HTMLElement, extra?: { category?: string | null; rank?: number | null }) {
    if (!canHover()) return
    over = el
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = null }
    warm(c.preview, 'full')
    if (openTimer) clearTimeout(openTimer)
    openTimer = setTimeout(() => {
      openTimer = null
      if (over !== el || !el.isConnected) return
      state = { id: ++opened, c, el, rect: el.getBoundingClientRect(), category: extra?.category, rank: extra?.rank }
      emit()
    }, state ? 120 : OPEN_AFTER_MS)   // moving from one open card to the next is quicker
  },
  leave(el?: HTMLElement) {
    if (el && over !== el) return
    over = null
    if (openTimer) { clearTimeout(openTimer); openTimer = null }
    if (closeTimer) clearTimeout(closeTimer)
    closeTimer = setTimeout(() => { closeTimer = null; if (state) { state = null; emit() } }, CLOSE_AFTER_MS)
  },
  /** The pointer reached the hover card itself: keep it open. */
  hold() { if (closeTimer) { clearTimeout(closeTimer); closeTimer = null } },
  close() {
    over = null
    if (openTimer) { clearTimeout(openTimer); openTimer = null }
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = null }
    if (state) { state = null; emit() }
  },
}

// ── My list ─────────────────────────────────────────────────────────────────
// What the person changed in this tab, over what the catalogue said when it loaded.
const savedNow = new Map<string, boolean>()
export const isSaved = (c: Pick<CatCourse, 'id'> & { saved_at?: string | null }) => savedNow.get(c.id) ?? !!c.saved_at

export async function toggleSaved(c: Pick<CatCourse, 'id'> & { saved_at?: string | null }): Promise<string | null> {
  const on = !isSaved(c)
  savedNow.set(c.id, on); emit()
  try { await lmsApi('/api/lms/me/saved', { course_id: c.id, on }); return null }
  catch (e: any) { savedNow.set(c.id, !on); emit(); return e?.message || 'My list could not be changed.' }
}
