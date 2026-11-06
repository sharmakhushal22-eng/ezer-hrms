'use client'
// components/learning/motion/transition.ts — screen changes that glide instead of jump, with the
// View Transitions API. The browser photographs the screen, the update runs, and the old and new
// pictures cross-fade (motion.css says how).
//
// The update is flushed synchronously inside the transition, so the "after" picture is the new
// screen and not a half-rendered one. Where the API is missing, or the person has asked for less
// motion, the update simply runs. While a transition runs, <html data-lx-vt> names its kind so
// the styles can scope themselves to it and leave every other screen of the HRMS alone.
import { flushSync } from 'react-dom'
import { reducedMotion } from './useInView'

type Doc = Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } }

let seq = 0

export function viewTransition(update: () => void, kind: 'page' | 'filter' = 'page') {
  const doc = document as Doc
  if (typeof doc.startViewTransition !== 'function' || reducedMotion()) { update(); rescueFocus(); return }
  const root = document.documentElement
  const mine = ++seq
  root.dataset.lxVt = kind
  try {
    const t = doc.startViewTransition(() => { flushSync(update) })
    t.finished.catch(() => {}).finally(() => {
      if (seq === mine) delete root.dataset.lxVt
      if (kind === 'page') rescueFocus()
    })
  } catch {
    delete root.dataset.lxVt
    update()
  }
}

/** A link that took someone to a new screen has usually gone with the old one. Rather than leave
 *  keyboard focus nowhere, put it at the top of the new screen. */
function rescueFocus() {
  const active = document.activeElement
  if (active && active !== document.body && document.contains(active)) return
  const main = document.querySelector<HTMLElement>('.ezl .lx-content')
  if (!main) return
  if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1')
  main.focus({ preventScroll: true })
}
