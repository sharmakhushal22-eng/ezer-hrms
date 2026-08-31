'use client'
// Global UI auto-fit. Scales the whole app to the viewport width using CSS `zoom`
// so it fills the screen and reads comfortably on any monitor. Auto by default
// (recomputes on resize); a small control lets the user nudge it, and the choice
// persists in localStorage. Disabled on the public onboarding portal.
import { useEffect, useState, useCallback } from 'react'
import { usePathname } from 'next/navigation'
// Design tokens, aliased as TK — many of these files already declare
// their own C. See lib/ui/tokens.ts.
import { C as TK } from '@/lib/ui'

const KEY = 'ezer_ui_scale'      // saved value: a number (manual) or 'auto'
const BASE = 1150                 // design width at which zoom = 1
const MIN = 0.8, MAX = 1.6

/**
 * Auto-fit, snapped to quarter steps.
 *
 * The previous version rounded to two decimals, which typically landed on
 * 1.3 — and at 1.3 a 1px hairline renders as 1.3 device pixels, an even
 * icon stroke lands between pixels, and the whole interface reads very
 * slightly soft. It is not the text rasteriser; `zoom` re-lays-out and
 * re-rasterises text correctly. It is every 1px rule and 1.6px icon stroke
 * being drawn off the pixel grid.
 *
 * 1.0 / 1.25 / 1.5 are the factors where the 4px spacing grid and even icon
 * sizes stay whole, which is what actually makes the UI look sharp.
 */
function autoScale(): number {
  if (typeof window === 'undefined') return 1
  const raw = window.innerWidth / BASE
  const snapped = Math.round(raw * 4) / 4
  return Math.min(MAX, Math.max(1, snapped))
}

export default function UiScale() {
  const pathname = usePathname()
  const enabled = !(pathname?.startsWith('/onboarding'))
  const [scale, setScale] = useState(1)
  const [manual, setManual] = useState(false)

  const apply = useCallback((v: number) => {
    setScale(v)
    ;(document.documentElement.style as any).zoom = String(v)
  }, [])

  // initialise from saved preference or auto-fit
  useEffect(() => {
    if (!enabled) { (document.documentElement.style as any).zoom = ''; return }
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null
    if (saved && saved !== 'auto') { setManual(true); apply(parseFloat(saved) || autoScale()) }
    else { setManual(false); apply(autoScale()) }
  }, [enabled, apply])

  // re-fit on window resize while in auto mode
  useEffect(() => {
    if (!enabled || manual) return
    const onResize = () => apply(autoScale())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [enabled, manual, apply])

  const nudge = (delta: number) => {
    // Manual nudges move in the same quarter steps, for the same reason.
    const v = Math.min(MAX, Math.max(MIN, Math.round((scale + delta) * 4) / 4))
    setManual(true); localStorage.setItem(KEY, String(v)); apply(v)
  }
  const resetAuto = () => { setManual(false); localStorage.setItem(KEY, 'auto'); apply(autoScale()) }

  if (!enabled) return null

  // The steppers carry a filled brand tint rather than sitting bare on the
  // pill: they are the two things you press, and on a control that floats over
  // whatever content happens to be underneath, a borderless glyph on a plain
  // surface is the first thing to disappear. brandDeep on brandTint measures
  // 6.16:1 in light and 9.02:1 in dark.
  const btn: React.CSSProperties = {
    width: 26, height: 26, borderRadius: '50%', border: 'none',
    background: TK.brandTint, color: TK.brandDeep,
    fontSize: 17, fontWeight: 700, cursor: 'pointer', lineHeight: 1,
    fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center',
    transition: 'background .16s ease, transform .16s cubic-bezier(.2,.8,.2,1)',
  }
  return (
    <div title="Adjust UI size — click % for auto-fit"
      className="ez-zoom"
      style={{
        display: 'flex', alignItems: 'center', gap: 4,
        background: TK.surface,
        // Was TK.brandEdge — 1.22:1 on white, an edge nobody can see. This
        // control floats over arbitrary page content, so its own silhouette
        // has to hold on its own.
        border: `1px solid ${TK.lineStrong}`,
        borderRadius: 99, padding: '4px 6px',
        boxShadow: '0 6px 18px rgba(15,23,42,.18), 0 1px 3px rgba(15,23,42,.12)',
        fontFamily: '"DM Sans","Segoe UI",sans-serif',
      }}>
      <style>{`
        .ez-zoom button { transition: background .16s ease, transform .16s cubic-bezier(.2,.8,.2,1); }
        .ez-zoom button:hover { transform: translateY(-1px); }
        .ez-zoom button:active { transform: translateY(0) scale(.92); }
        @media (prefers-reduced-motion: reduce) {
          .ez-zoom button, .ez-zoom button:hover, .ez-zoom button:active { transition: none; transform: none; }
        }
      `}</style>
      <button title="Smaller" aria-label="Decrease interface size" onClick={() => nudge(-0.25)} style={btn}>−</button>
      <button title={manual ? 'Click to auto-fit to screen' : 'Auto-fit (on)'} onClick={resetAuto}
        aria-label={`Interface size ${Math.round(scale * 100)} percent${manual ? '' : ', auto-fit'}. Click to auto-fit.`}
        style={{
          minWidth: 56, textAlign: 'center', fontSize: 11, fontWeight: 700,
          // TK.ink, not brandDeep: this is a readout first and a button second,
          // and it has to stay legible at 11px in both themes.
          color: manual ? TK.ink : TK.positive,
          background: 'none', border: 'none', cursor: 'pointer',
          fontFamily: 'inherit', fontVariantNumeric: 'tabular-nums',
        }}>
        {Math.round(scale * 100)}%{manual ? '' : ' ·auto'}
      </button>
      <button title="Bigger" aria-label="Increase interface size" onClick={() => nudge(0.25)} style={btn}>+</button>
    </div>
  )
}
