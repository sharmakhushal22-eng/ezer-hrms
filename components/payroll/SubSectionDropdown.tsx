'use client'
// components/payroll/SubSectionDropdown.tsx — reusable dropdown for a section's sub-views.
// Fixed-positioned so it never gets clipped and never needs scrolling to see the options.
// Use anywhere a section has sub-sections (e.g. Pay Heads → Standard / Flexi / Non-standard / Rules).
import { useState, useRef } from 'react'

const C = { navy: '#1E1B4B', purple: '#7C3AED', purpleDark: '#3C3489', border: '#E9E7F5', muted: '#6B6B7B' }
const font = '"DM Sans","Segoe UI",sans-serif'

export interface SubItem { id: string; label: string }

export default function SubSectionDropdown({ items, active, onChange, kicker = 'View' }: {
  items: SubItem[]; active: string; onChange: (id: string) => void; kicker?: string
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const cur = items.find(i => i.id === active) || items[0]

  const toggle = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      const w = Math.max(r.width, 240)
      setPos({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - w - 12)), width: r.width })
    }
    setOpen(o => !o)
  }

  return (
    <div style={{ position: 'relative', marginBottom: 14, maxWidth: 340 }}>
      <button ref={btnRef} onClick={toggle} style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', borderRadius: 10,
        border: `1px solid ${open ? C.purple : C.border}`, background: '#fff', cursor: 'pointer', fontFamily: font,
        boxShadow: open ? '0 6px 20px rgba(124,58,237,0.16)' : '0 1px 3px rgba(124,58,237,0.06)', transition: 'box-shadow .15s, border-color .15s',
      }}>
        <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.2, minWidth: 0 }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '.06em' }}>{kicker}</span>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: C.navy, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{cur?.label}</span>
        </span>
        <span style={{ marginLeft: 'auto', color: C.purple, fontSize: 11, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .18s' }}>▾</span>
      </button>
      {open && pos && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 1000 }} />
          <div style={{ position: 'fixed', top: pos.top, left: pos.left, minWidth: Math.max(pos.width, 240), zIndex: 1001, background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12, boxShadow: '0 14px 38px rgba(30,27,75,0.22)', padding: 6, maxHeight: 'calc(100vh - 96px)', overflowY: 'auto' }}>
            {items.map(i => {
              const on = i.id === active
              return (
                <button key={i.id} onClick={() => { onChange(i.id); setOpen(false) }}
                  onMouseEnter={e => { if (!on) (e.currentTarget as HTMLButtonElement).style.background = '#F7F5FF' }}
                  onMouseLeave={e => { if (!on) (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', borderRadius: 9, border: 'none', cursor: 'pointer', fontFamily: font, textAlign: 'left', marginBottom: 2, background: on ? 'rgba(124,58,237,0.09)' : 'transparent', color: on ? C.purpleDark : C.navy, fontSize: 13, fontWeight: on ? 700 : 500 }}>
                  <span style={{ flex: 1 }}>{i.label}</span>
                  {on && <span style={{ color: C.purple, fontSize: 13 }}>✓</span>}
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
