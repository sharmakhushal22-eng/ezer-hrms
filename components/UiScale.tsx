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

  // ── Design notes ────────────────────────────────────────────────────────
  // The previous version was a pill containing two pale circles and a green
  // "100% ·auto". Three problems, seen once it was actually rendered:
  //   - pill-within-pill: floating circles inside a rounded container read as
  //     three disconnected blobs rather than one control;
  //   - the circles were #EFF6FF on white, so they barely registered at all;
  //   - the green readout was the loudest thing in the dock and the least
  //     important, and it clashed with the blue either side of it.
  //
  // Now: one pill, three zones, hairline dividers. The dividers are what say
  // "this is a single control with parts", which is exactly what a stepper is.
  const zone: React.CSSProperties = {
    width: 30, height: 34, border: 'none', background: 'transparent',
    color: TK.inkSoft, cursor: 'pointer', display: 'flex',
    alignItems: 'center', justifyContent: 'center', padding: 0,
    fontFamily: 'inherit',
  }
  const pct = Math.round(scale * 100)

  return (
    <div className="ez-zoom"
      title="Interface size — click the value to auto-fit"
      style={{
        display: 'flex', alignItems: 'center',
        height: 36, background: TK.surface,
        border: `1px solid ${TK.lineStrong}`,
        borderRadius: 999, overflow: 'hidden',
        // A hairline ring on top of the border. lineStrong alone is 1.47:1 on a
        // white surface, so on a light card the pill lost its own edge; the
        // ring is what keeps the silhouette without darkening the border into
        // something heavy in dark mode.
        boxShadow: '0 0 0 1px rgba(15,23,42,.06), 0 8px 20px rgba(15,23,42,.20), 0 2px 5px rgba(15,23,42,.14)',
        fontFamily: '"DM Sans","Segoe UI",sans-serif',
      }}>
      <style>{`
        .ez-zoom button { transition: background .15s ease, color .15s ease; }
        .ez-zoom button:hover { background: var(--ez-brand-tint); color: var(--ez-brand-deep); }
        .ez-zoom button:active { background: var(--ez-brand-edge); }
        .ez-zoom .ez-zoom-div { width:1px; height:16px; background: var(--ez-line-strong); opacity:.9; flex:none; }
        @media (prefers-reduced-motion: reduce) { .ez-zoom button { transition: none; } }
      `}</style>

      <button onClick={() => nudge(-0.25)} style={zone}
        title="Smaller" aria-label="Decrease interface size">
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
          <rect x="1.8" y="5.9" width="10.4" height="2.2" rx="1.1" fill="currentColor" />
        </svg>
      </button>

      <span className="ez-zoom-div" aria-hidden />

      <button onClick={resetAuto} style={{
          ...zone, width: 'auto', padding: '0 10px', gap: 5,
          // Ink, not green. This is a readout, and it should be quieter than
          // the two things you actually press.
          color: TK.ink, fontSize: 12, fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
        }}
        title={manual ? 'Click to auto-fit to screen' : 'Auto-fit is on'}
        aria-label={`Interface size ${pct} percent${manual ? '' : ', auto-fit on'}. Click to auto-fit.`}>
        {/* "·auto" was cramped text doing a badge's job. A dot states the same
            thing without competing with the number for width. */}
        {/* Was TK.positive. Rendered, a green speck beside the number reads as
            a status LED — and green means "success", which auto-fit is not. The
            brand blue says "the app is handling this" without claiming
            anything. */}
        {!manual && (
          <span aria-hidden style={{
            width: 5, height: 5, borderRadius: '50%',
            background: TK.brand, flex: 'none',
          }} />
        )}
        {pct}%
      </button>

      <span className="ez-zoom-div" aria-hidden />

      <button onClick={() => nudge(0.25)} style={zone}
        title="Bigger" aria-label="Increase interface size">
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
          <rect x="1.8" y="5.9" width="10.4" height="2.2" rx="1.1" fill="currentColor" />
          <rect x="5.9" y="1.8" width="2.2" height="10.4" rx="1.1" fill="currentColor" />
        </svg>
      </button>
    </div>
  )
}
