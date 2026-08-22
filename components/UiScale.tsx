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

function autoScale(): number {
  if (typeof window === 'undefined') return 1
  const s = window.innerWidth / BASE
  return Math.min(MAX, Math.max(1, Math.round(s * 100) / 100))
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
    const v = Math.min(MAX, Math.max(MIN, Math.round((scale + delta) * 100) / 100))
    setManual(true); localStorage.setItem(KEY, String(v)); apply(v)
  }
  const resetAuto = () => { setManual(false); localStorage.setItem(KEY, 'auto'); apply(autoScale()) }

  if (!enabled) return null

  const btn: React.CSSProperties = { width: 26, height: 26, borderRadius: '50%', border: 'none', background: TK.brandTint, color: TK.brandDeep, fontSize: 16, fontWeight: 700, cursor: 'pointer', lineHeight: 1, fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center' }
  return (
    <div title="Adjust UI size — click % for auto-fit" style={{ position: 'fixed', bottom: 14, right: 14, zIndex: 99999, display: 'flex', alignItems: 'center', gap: 4, background: '#fff', border: '1px solid #DDD6FE', borderRadius: 99, padding: '4px 6px', boxShadow: '0 4px 14px rgba(124,58,237,.18)', fontFamily: '"DM Sans","Segoe UI",sans-serif' }}>
      <button title="Smaller" onClick={() => nudge(-0.1)} style={btn}>−</button>
      <button title={manual ? 'Click to auto-fit to screen' : 'Auto-fit (on)'} onClick={resetAuto}
        style={{ minWidth: 54, textAlign: 'center', fontSize: 11, fontWeight: 700, color: manual ? TK.brandDeep : TK.positive, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
        {Math.round(scale * 100)}%{manual ? '' : ' ·auto'}
      </button>
      <button title="Bigger" onClick={() => nudge(0.1)} style={btn}>+</button>
    </div>
  )
}
