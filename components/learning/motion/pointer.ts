'use client'
// components/learning/motion/pointer.ts — cards that notice the mouse. Over a course card,
// certificate, banner card or tile, a soft light follows the pointer and the card leans a degree
// or two towards it.
//
// One listener for the whole page rather than one per card: it finds the card under the pointer
// and writes four custom properties on it (--lx-mx/--lx-my, the pointer in pixels, and
// --lx-tx/--lx-ty, its offset from the centre from -1 to 1), plus data-tilt while it is there.
// motion.css turns those into the light and the lean, only for a real mouse and only without
// reduced motion. Touch never triggers it. Installed once, on first import, in the browser.
const CARDS = '.lx-cc,.lx-wc,.lx-kpi,.lx-cert,.lx-feature,.lx-cat'

let current: HTMLElement | null = null
let frame = 0
let last: PointerEvent | null = null

function clear() {
  if (!current) return
  current.removeAttribute('data-tilt')
  for (const k of ['--lx-mx', '--lx-my', '--lx-tx', '--lx-ty']) current.style.removeProperty(k)
  current = null
}

function paint() {
  frame = 0
  const e = last
  if (!e) return
  const target = e.target instanceof Element ? e.target.closest<HTMLElement>(CARDS) : null
  const card = target && target.closest('.ezl') ? target : null
  if (card !== current) { clear(); current = card }
  if (!card) return
  const r = card.getBoundingClientRect()
  const x = e.clientX - r.left, y = e.clientY - r.top
  card.style.setProperty('--lx-mx', `${x.toFixed(0)}px`)
  card.style.setProperty('--lx-my', `${y.toFixed(0)}px`)
  card.style.setProperty('--lx-tx', ((x / r.width) * 2 - 1).toFixed(3))
  card.style.setProperty('--lx-ty', ((y / r.height) * 2 - 1).toFixed(3))
  card.setAttribute('data-tilt', '1')
}

function install() {
  const w = window as Window & { __ezlPointer?: boolean }
  if (w.__ezlPointer) return
  w.__ezlPointer = true
  document.addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse') return
    last = e
    if (!frame) frame = requestAnimationFrame(paint)
  }, { passive: true })
  document.addEventListener('pointerout', e => {
    if (!current) return
    const to = e.relatedTarget
    if (!(to instanceof Node) || !current.contains(to)) clear()
  }, { passive: true })
  // A scroll moves the card from under a still pointer.
  window.addEventListener('scroll', clear, { passive: true })
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') install()

export {}
