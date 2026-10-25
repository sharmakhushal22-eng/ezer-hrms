'use client'
// components/onboarding/PeoplePicker.tsx — picking a person from the company: the search box
// with a dropdown of matches, and the card of the one chosen. Used by Assign managers (L1, L2,
// HOD on the review sheet) and by Generate code (the team). Shared bits: the avatar with
// initials, the styles.
import { useEffect, useMemo, useRef, useState } from 'react'
import { C as TK, E, Z } from '@/lib/ui'

export type Emp = { id: string; emp_code: string; full_name: string; designation: string | null; department: string | null }

export const initials = (name: string) => String(name || '').trim().split(/\s+/).slice(0, 2).map(s => s[0] || '').join('').toUpperCase() || '?'

export const PICKER_CSS = `
  .pp-wrap{position:relative}
  .pp-in{width:100%;padding:10px 12px 10px 36px;border:1px solid ${TK.lineStrong};border-radius:9px;font-size:13px;font-family:inherit;color:${TK.ink};background:${TK.surface};box-sizing:border-box}
  .pp-in:focus{outline:none;border-color:${TK.brand};box-shadow:0 0 0 3px ${TK.brandTint}}
  .pp-ico{position:absolute;left:12px;top:50%;transform:translateY(-50%);color:${TK.muted};font-size:14px;pointer-events:none}
  .pp-list{position:absolute;left:0;right:0;top:calc(100% + 4px);background:${TK.surface};border:1px solid ${TK.line};border-radius:10px;box-shadow:${E.floating};max-height:290px;overflow-y:auto;padding:4px;z-index:${Z.raised}}
  .pp-row{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:8px;cursor:pointer;border:none;background:transparent;width:100%;text-align:left;font-family:inherit;color:${TK.ink}}
  .pp-row:hover,.pp-row.hi{background:${TK.brandTint}}
  .pp-row:disabled{opacity:.45;cursor:not-allowed}
  .pp-name{font-size:13px;font-weight:600;line-height:1.2}
  .pp-meta{font-size:11px;color:${TK.muted};line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .pp-card{display:flex;align-items:center;gap:12px;padding:10px 12px;border:1px solid ${TK.positiveEdge};background:${TK.positiveTint};border-radius:10px}
  .pp-x{all:unset;cursor:pointer;font-size:11.5px;font-weight:600;color:${TK.brandDeep};padding:4px 9px;border-radius:6px;border:1px solid ${TK.brandEdge};background:${TK.surface}}
  .pp-x:hover{background:${TK.brandTint}}
  .pp-empty{padding:12px;font-size:12px;color:${TK.muted};text-align:center}
`

export function Avatar({ name, size = 32, tone = 'brand' }: { name: string; size?: number; tone?: 'brand' | 'positive' | 'muted' | 'warning' }) {
  const bg = tone === 'positive' ? TK.positiveTint : tone === 'muted' ? TK.sunken : tone === 'warning' ? TK.warningTint : TK.brandTint
  const fg = tone === 'positive' ? TK.positive : tone === 'muted' ? TK.muted : tone === 'warning' ? TK.warning : TK.brandDeep
  return <span aria-hidden="true" style={{ flex: 'none', width: size, height: size, borderRadius: 99, background: bg, color: fg, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: Math.round(size * 0.36), fontWeight: 700, letterSpacing: '.02em' }}>{initials(name)}</span>
}

export const describe = (e: Emp) => [e.emp_code, e.designation, e.department].filter(Boolean).join(' · ')

/** Search + dropdown while nothing is chosen; the chosen person's card (with Change) after. */
export function PersonPicker({ label, value, onChange, employees, required, exclude = [], hint, placeholder = 'Type a name or employee code…' }: {
  label: string; value: string; onChange: (id: string) => void; employees: Emp[]; required?: boolean
  /** Ids that cannot be picked here (the same person cannot be L1 and L2). */
  exclude?: string[]; hint?: string; placeholder?: string
}) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(0)
  const wrap = useRef<HTMLDivElement>(null)
  const chosen = employees.find(e => e.id === value) || null
  const list = useMemo(() => {
    const t = q.trim().toLowerCase()
    const pool = t ? employees.filter(e => `${e.full_name} ${e.emp_code} ${e.designation || ''} ${e.department || ''}`.toLowerCase().includes(t)) : employees
    return pool.slice(0, 8)
  }, [q, employees])
  useEffect(() => { setHi(0) }, [q])
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])
  const pick = (e: Emp) => { if (exclude.includes(e.id)) return; onChange(e.id); setQ(''); setOpen(false) }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
        <label style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: TK.brandDeep }}>{label}{required && <span style={{ color: TK.critical }}> *</span>}</label>
        {hint && <span style={{ fontSize: 11, color: TK.muted }}>{hint}</span>}
      </div>
      {chosen ? (
        <div className="pp-card">
          <Avatar name={chosen.full_name} tone="positive" />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="pp-name">{chosen.full_name}</div>
            <div className="pp-meta">{describe(chosen)}</div>
          </div>
          <button type="button" className="pp-x" onClick={() => { onChange(''); setOpen(true) }}>Change</button>
        </div>
      ) : (
        <div className="pp-wrap" ref={wrap}>
          <span className="pp-ico">⌕</span>
          <input className="pp-in" value={q} placeholder={placeholder} onChange={e => { setQ(e.target.value); setOpen(true) }} onFocus={() => setOpen(true)}
            onKeyDown={e => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => Math.min(h + 1, list.length - 1)) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(h - 1, 0)) }
              else if (e.key === 'Enter') { e.preventDefault(); if (list[hi]) pick(list[hi]) }
              else if (e.key === 'Escape') setOpen(false)
            }} />
          {open && (
            <div className="pp-list" role="listbox">
              {list.length === 0 && <div className="pp-empty">{employees.length ? 'Nobody matches — try the employee code.' : 'No active employees in this company yet.'}</div>}
              {list.map((e, i) => (
                <button key={e.id} type="button" role="option" aria-selected={i === hi} className={`pp-row${i === hi ? ' hi' : ''}`} disabled={exclude.includes(e.id)} onMouseEnter={() => setHi(i)} onClick={() => pick(e)} title={exclude.includes(e.id) ? 'Already picked for another level' : undefined}>
                  <Avatar name={e.full_name} size={28} tone="muted" />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="pp-name">{e.full_name}</div>
                    <div className="pp-meta">{describe(e)}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
