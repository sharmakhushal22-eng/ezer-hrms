'use client'
// components/payroll/SubSectionDropdown.tsx — reusable dropdown for a section's sub-views.
// The menu is anchored to the button by layout, not by viewport coordinates written into
// position: fixed. Measuring getBoundingClientRect() and trusting those numbers breaks the
// moment any ancestor creates a containing block (a transform, a filter, contain: paint) —
// fixed then resolves against that ancestor and the panel lands hundreds of pixels away.
// It looks fine on most machines and badly wrong on some, which is the worst way for a
// layout bug to behave. Absolute positioning inside the button's own relative wrapper
// cannot drift.
// Use anywhere a section has sub-sections (e.g. Pay Heads → Standard / Flexi / Non-standard / Rules).
import { useState } from 'react'
// Design tokens, aliased as TK — many of these files already declare
// their own C. See lib/ui/tokens.ts.
import { C as TK, F, W, R, E, M, eyebrow, IconChevronDown, IconCheck } from '@/lib/ui'
import { useDismiss } from '@/lib/ui/useDismiss'

const C = { navy: TK.ink, purple: TK.brand, purpleDark: TK.brandDeep, border: TK.lineStrong, muted: TK.muted }
const font = '"DM Sans","Segoe UI",sans-serif'

export interface SubItem { id: string; label: string }

export default function SubSectionDropdown({ items, active, onChange, kicker = 'View' }: {
  items: SubItem[]; active: string; onChange: (id: string) => void; kicker?: string
}) {
  const [open, setOpen] = useState(false)
  // One click, not two: a document listener lets the click through to whatever
  // is under it, so moving straight to another trigger opens that one.
  const pop = useDismiss<HTMLDivElement>(open, () => setOpen(false))
  const cur = items.find(i => i.id === active) || items[0]
  const toggle = () => setOpen(o => !o)

  return (
    <div ref={pop} style={{ position: 'relative', marginBottom: 14, maxWidth: 340 }}>
      <button onClick={toggle} aria-expanded={open} className="ez-press" style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px 8px 14px', borderRadius: R.md,
        border: `1px solid ${open ? C.purple : C.border}`, background: TK.surface, cursor: 'pointer', fontFamily: font,
        boxShadow: open ? `0 0 0 3px ${TK.brandTint}` : E.flat, transition: `box-shadow ${M.quick}, border-color ${M.quick}`,
      }}>
        <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.2, minWidth: 0, gap: 2 }}>
          <span style={{ ...eyebrow, fontSize: F.micro }}>{kicker}</span>
          <span style={{ fontSize: F.body, fontWeight: W.semi, color: C.navy, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{cur?.label}</span>
        </span>
        <span style={{ marginLeft: 'auto', color: open ? C.purple : C.muted, display: 'inline-flex', transform: open ? 'rotate(180deg)' : 'none', transition: `transform ${M.quick}` }}><IconChevronDown size={15} /></span>
      </button>
      {open && (
        <>
          <div className="ez-scroll" style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, minWidth: 240, width: '100%', zIndex: 1001, background: TK.surface, border: `1px solid ${TK.line}`, borderRadius: R.lg, boxShadow: E.floating, padding: 5, maxHeight: '70vh', overflowY: 'auto' }}>
            {items.map(i => {
              const on = i.id === active
              return (
                <button key={i.id} onClick={() => { onChange(i.id); setOpen(false) }}
                  onMouseEnter={e => { if (!on) (e.currentTarget as HTMLButtonElement).style.background = TK.sunken }}
                  onMouseLeave={e => { if (!on) (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', borderRadius: R.sm, border: 'none', cursor: 'pointer', fontFamily: font, textAlign: 'left', marginBottom: 2, background: on ? TK.brandTint : 'transparent', color: on ? C.purpleDark : C.navy, fontSize: F.small, fontWeight: on ? W.semi : W.medium }}>
                  <span style={{ flex: 1 }}>{i.label}</span>
                  {on && <span style={{ color: C.purple, display: 'inline-flex' }}><IconCheck size={14} /></span>}
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
