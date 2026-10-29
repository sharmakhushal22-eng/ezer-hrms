'use client'
// components/onboarding/AnchoredPopover.tsx — a small panel anchored to a trigger, for the
// onboarding table: the approvals trail behind the "2/4 · with Payroll" summary, and the "⋯"
// menu of a row's secondary actions.
//
// Why a portal: the table scrolls sideways inside its own overflow container, and the page is
// mounted inside a PageTransition that animates a transform — an absolutely positioned panel
// in a cell is clipped by the first, a position:fixed one is displaced by the second. Rendered
// into <body> with fixed coordinates taken from the trigger, it is neither.
//
// How it opens:
//   hover   (optional) — after a short pause; leaving the trigger AND the panel closes it
//   click / tap        — pins it open (or closes a pinned one); this is the touch path
//   Enter / Space      — the same as a click (it is a real <button>)
//   Escape, a click elsewhere, or scrolling the page far away — closes it; Escape puts focus
//   back on the trigger
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { C, E, R, Z } from '@/lib/ui'
import { useDismiss } from '@/lib/ui/useDismiss'

type OpenState = false | 'hover' | 'pinned'

export function AnchoredPopover({ trigger, children, label, hover = false, width = 340, align = 'start', triggerStyle, triggerTitle }: {
  /** What the trigger button shows. */
  trigger: React.ReactNode
  /** The panel. A function gets `close` — for a menu item that should close it. */
  children: React.ReactNode | ((close: () => void) => React.ReactNode)
  /** Accessible name of the trigger, e.g. "Approvals for Arun Varma". */
  label: string
  hover?: boolean
  width?: number
  align?: 'start' | 'end'
  triggerStyle?: React.CSSProperties
  triggerTitle?: string
}) {
  const id = useId().replace(/:/g, '')
  const [open, setOpen] = useState<OpenState>(false)
  const [pos, setPos] = useState<{ top: number; left: number; maxH: number } | null>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clear = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null } }
  const close = useCallback(() => { clear(); setOpen(false) }, [])
  const panel = useDismiss<HTMLDivElement>(!!open, close, `[data-ob-pop="${id}"]`)

  const place = useCallback(() => {
    const b = btn.current?.getBoundingClientRect()
    if (!b) return
    const vw = window.innerWidth, vh = window.innerHeight, gap = 6, pad = 8
    const w = Math.min(width, vw - pad * 2)
    let left = align === 'end' ? b.right - w : b.left
    left = Math.max(pad, Math.min(left, vw - w - pad))
    const below = vh - b.bottom - gap - pad, above = b.top - gap - pad
    // Below unless there is clearly more room above.
    const down = below >= 220 || below >= above
    const maxH = Math.max(140, down ? below : above)
    const top = down ? b.bottom + gap : Math.max(pad, b.top - gap - Math.min(maxH, panel.current?.offsetHeight || maxH))
    setPos({ top, left, maxH })
  }, [width, align, panel])

  useLayoutEffect(() => { if (open) place() }, [open, place])
  // Follow the trigger while the page scrolls; close once it has left the screen.
  useEffect(() => {
    if (!open) return
    const onMove = () => {
      const b = btn.current?.getBoundingClientRect()
      if (!b || b.bottom < 0 || b.top > window.innerHeight) { close(); return }
      place()
    }
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    return () => { window.removeEventListener('scroll', onMove, true); window.removeEventListener('resize', onMove) }
  }, [open, place, close])
  // Escape returns focus to the trigger (useDismiss closes on it).
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') btn.current?.focus() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])
  useEffect(() => clear, [])

  const enter = () => { if (!hover) return; clear(); timer.current = setTimeout(() => setOpen(o => o || 'hover'), 140) }
  const leave = () => { if (!hover) return; clear(); timer.current = setTimeout(() => setOpen(o => (o === 'hover' ? false : o)), 180) }

  return (
    <>
      <button ref={btn} type="button" data-ob-pop={id}
        aria-haspopup="dialog" aria-expanded={!!open} aria-controls={open ? `ob-pop-${id}` : undefined} aria-label={label}
        title={triggerTitle}
        onMouseEnter={enter} onMouseLeave={leave}
        onClick={() => { clear(); setOpen(o => (o === 'pinned' ? false : 'pinned')) }}
        style={{ fontFamily: 'inherit', cursor: 'pointer', ...triggerStyle }}>
        {trigger}
      </button>
      {open && typeof document !== 'undefined' && createPortal(
        <div ref={panel} id={`ob-pop-${id}`} role="dialog" aria-label={label}
          onMouseEnter={() => { if (hover) clear() }} onMouseLeave={leave}
          style={{
            position: 'fixed', top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: Math.min(width, typeof window !== 'undefined' ? window.innerWidth - 16 : width),
            maxHeight: pos?.maxH, overflowY: 'auto', zIndex: Z.navMenu,
            background: C.surface, color: C.ink, border: `1px solid ${C.lineStrong}`, borderRadius: R.lg,
            boxShadow: E.floating, fontFamily: '"DM Sans","Segoe UI",sans-serif', fontSize: 12.5, textAlign: 'left',
            visibility: pos ? 'visible' : 'hidden',
          }}>
          {typeof children === 'function' ? children(close) : children}
        </div>,
        document.body,
      )}
    </>
  )
}

/** One item of a "⋯" menu. */
export function MenuItem({ children, onClick, disabled, tone, hint }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; tone?: 'critical'; hint?: string }) {
  return (
    <button type="button" role="menuitem" disabled={disabled} onClick={onClick} className="ob-mi"
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1, width: '100%', textAlign: 'left', padding: '8px 11px', border: 'none', borderRadius: R.sm,
        background: 'transparent', color: tone === 'critical' ? C.critical : C.ink, fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer' }}>
      <span>{children}</span>
      {hint && <span style={{ fontSize: 11, fontWeight: 400, color: C.muted }}>{hint}</span>}
    </button>
  )
}
