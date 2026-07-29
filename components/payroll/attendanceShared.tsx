'use client'
// components/payroll/attendanceShared.tsx — shared primitives for the Attendance tab
// (Attendance Upload · OT Upload · Attendance Edit). Palette + searchable dropdowns +
// the bulk-paste employee-code multi-select + the "% checking" validation animation card.
import { useState } from 'react'

export const C = {
  navy: '#1E1B4B', purple: '#7C3AED', purpleD: '#3C3489', card: '#FFFFFF',
  border: '#E9E7F5', muted: '#6B7280', green: '#059669', greenBg: '#ECFDF5',
  greenBd: '#BBF7D0', red: '#DC2626', redBg: '#FEF2F2', amber: '#B45309', amberBg: '#FFFBEB',
  purpleBg: '#EEEDFE', gray: '#F8F7FF',
}
export const font = '"DM Sans","Segoe UI",sans-serif'
export const num = (v: any) => { const n = Number(v); return isNaN(n) ? null : n }
export const ddInp: React.CSSProperties = { width: '100%', padding: '9px 11px', border: '1px solid #DDD6FE', borderRadius: 8, fontSize: 12.5, boxSizing: 'border-box', background: '#fff', color: C.navy, fontFamily: font, outline: 'none' }
export const lbl: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: C.purpleD, textTransform: 'uppercase', letterSpacing: '.04em', display: 'block', marginBottom: 5 }
export type Opt = { value: string; label: string }
export const GROUP = '__group__'   // Company dropdown sentinel → all companies at once

// Split a pasted / typed blob of codes into clean tokens.
// Handles "OXYZO680,\nOXYZO741,\n OXYZO1013 , OXYZO1022" and the like.
export const splitCodes = (text: string): string[] =>
  text.split(/[\s,;]+/).map(t => t.trim()).filter(Boolean)

// ── Searchable single-select ────────────────────────────────────────
export function SearchSelect({ value, options, placeholder, onChange, disabled }: { value: string; options: Opt[]; placeholder: string; onChange: (v: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const sel = options.find(o => o.value === value)
  const filtered = (q.trim() ? options.filter(o => o.label.toLowerCase().includes(q.toLowerCase())) : options).slice(0, 150)
  return (
    <div style={{ position: 'relative' }}>
      <div onClick={() => { if (!disabled) { setOpen(o => !o); setQ('') } }}
        style={{ ...ddInp, cursor: disabled ? 'not-allowed' : 'pointer', display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'center', color: sel ? C.navy : '#94A3B8', background: disabled ? '#F1F5F9' : '#fff' }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sel ? sel.label : placeholder}</span>
        <span style={{ color: '#94A3B8', fontSize: 11 }}>▾</span>
      </div>
      {open && !disabled && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 500 }} />
          <div style={{ position: 'absolute', top: 'calc(100% + 3px)', left: 0, width: '100%', minWidth: 200, background: '#fff', border: '1px solid #DDD6FE', borderRadius: 8, boxShadow: '0 8px 24px rgba(30,27,75,0.18)', zIndex: 501, overflow: 'hidden' }}>
            <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search…" style={{ width: '100%', padding: '8px 10px', border: 'none', borderBottom: '1px solid #EEF', fontSize: 12.5, outline: 'none', boxSizing: 'border-box', fontFamily: font }} />
            <div style={{ maxHeight: 210, overflowY: 'auto' }}>
              {filtered.length === 0 && <div style={{ padding: '8px 10px', fontSize: 12, color: '#94A3B8' }}>No matches</div>}
              {filtered.map(o => (
                <div key={o.value} onClick={() => { onChange(o.value); setOpen(false) }}
                  style={{ padding: '7px 10px', fontSize: 12.5, cursor: 'pointer', background: o.value === value ? '#EEF2FF' : '#fff', color: C.navy }}>{o.label}</div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ── Searchable multi-select (chips) — for employee codes.
// Accepts a pasted / typed bulk list (comma / newline / space separated),
// e.g. "OXYZO680, OXYZO741, OXYZO1013" → four chips at once.
export function MultiSelect({ values, options, placeholder, onChange }: { values: string[]; options: Opt[]; placeholder: string; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const filtered = (q.trim() ? options.filter(o => o.label.toLowerCase().includes(q.toLowerCase())) : options).slice(0, 150)
  const toggle = (v: string) => onChange(values.includes(v) ? values.filter(x => x !== v) : [...values, v])

  // Add many tokens at once, canonicalising each against the option list
  // (case-insensitive) and de-duplicating against what's already selected.
  const addTokens = (text: string) => {
    const byUpper = new Map(options.map(o => [o.value.toUpperCase(), o.value]))
    const next = [...values]
    for (const tok of splitCodes(text)) {
      const canon = byUpper.get(tok.toUpperCase()) ?? tok
      if (!next.includes(canon)) next.push(canon)
    }
    if (next.length !== values.length) onChange(next)
    setQ('')
  }
  const onQChange = (v: string) => { if (/[\s,;]/.test(v)) addTokens(v); else setQ(v) }

  return (
    <div style={{ position: 'relative' }}>
      <div onClick={() => { setOpen(o => !o); setQ('') }}
        style={{ ...ddInp, cursor: 'pointer', minHeight: 36, display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
        {values.length === 0 && <span style={{ color: '#94A3B8' }}>{placeholder}</span>}
        {values.map(v => (
          <span key={v} onClick={e => { e.stopPropagation(); toggle(v) }} style={{ fontSize: 11, background: C.purpleBg, color: C.purpleD, borderRadius: 99, padding: '2px 8px', fontWeight: 700 }}>{v} ✕</span>
        ))}
        <span style={{ marginLeft: 'auto', color: '#94A3B8', fontSize: 11 }}>▾</span>
      </div>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 500 }} />
          <div style={{ position: 'absolute', top: 'calc(100% + 3px)', left: 0, width: '100%', minWidth: 240, background: '#fff', border: '1px solid #DDD6FE', borderRadius: 8, boxShadow: '0 8px 24px rgba(30,27,75,0.18)', zIndex: 501, overflow: 'hidden' }}>
            <input autoFocus value={q}
              onChange={e => onQChange(e.target.value)}
              onPaste={e => { const t = e.clipboardData.getData('text'); if (/[\s,;]/.test(t)) { e.preventDefault(); addTokens(t) } }}
              onKeyDown={e => { if (e.key === 'Enter' && q.trim()) { e.preventDefault(); addTokens(q) } }}
              placeholder="Search or paste codes (comma / newline separated)…"
              style={{ width: '100%', padding: '8px 10px', border: 'none', borderBottom: '1px solid #EEF', fontSize: 12.5, outline: 'none', boxSizing: 'border-box', fontFamily: font }} />
            <div style={{ maxHeight: 210, overflowY: 'auto' }}>
              {filtered.length === 0 && <div style={{ padding: '8px 10px', fontSize: 12, color: '#94A3B8' }}>Press Enter to add “{q.trim()}”</div>}
              {filtered.map(o => (
                <div key={o.value} onClick={() => toggle(o.value)}
                  style={{ padding: '7px 10px', fontSize: 12.5, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', gap: 8, background: values.includes(o.value) ? '#EEF2FF' : '#fff', color: C.navy }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.label}</span>
                  {values.includes(o.value) && <span style={{ color: C.green }}>✓</span>}
                </div>
              ))}
            </div>
            {values.length > 0 && (
              <div style={{ borderTop: '1px solid #EEF', padding: '6px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 10.5, color: C.muted }}>{values.length} selected</span>
                <span onClick={() => onChange([])} style={{ fontSize: 10.5, color: C.red, cursor: 'pointer', fontWeight: 700 }}>Clear all</span>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ── The "% checking" validation progress card (Process / Cancel) ──
// Pure presentational: pct 0–100, matched/unmatched counts, the two actions.
export function ValidationCard({ pct, checking, total, matched, unmatched, onProcess, onCancel, busy, kind }: {
  pct: number; checking: boolean; total: number; matched: string[]; unmatched: string[]
  onProcess: () => void; onCancel: () => void; busy: boolean; kind: string
}) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginBottom: 14, boxShadow: '0 1px 6px rgba(124,58,237,0.06)' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.purple, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 10 }}>
        {checking ? `Checking ${kind}…` : `Ready to process · ${total} rows`}
      </div>
      <div style={{ height: 10, borderRadius: 99, background: '#EDE9FE', overflow: 'hidden', marginBottom: 8 }}>
        <div style={{ width: `${pct}%`, height: '100%', borderRadius: 99, background: `linear-gradient(90deg,#10B981,${C.green})`, transition: 'width .12s linear' }} />
      </div>
      <div style={{ display: 'flex', gap: 14, fontSize: 11.5, color: C.muted, marginBottom: 12, flexWrap: 'wrap' }}>
        <span>{pct}% checked</span>
        <span style={{ color: C.green, fontWeight: 700 }}>✓ {matched.length} in this month</span>
        {unmatched.length > 0 && <span style={{ color: C.amber, fontWeight: 700 }}>⚠ {unmatched.length} not in this month</span>}
      </div>
      {!checking && unmatched.length > 0 && (
        <div style={{ fontSize: 11, color: C.amber, background: C.amberBg, border: '1px solid #FDE8C8', borderRadius: 8, padding: '8px 10px', marginBottom: 12 }}>
          Skipped (wrong code / extra person / not in this month's master): <b>{unmatched.slice(0, 40).join(', ')}</b>{unmatched.length > 40 ? ` +${unmatched.length - 40} more` : ''}
        </div>
      )}
      {!checking && (
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onProcess} disabled={busy || matched.length === 0}
            style={{ padding: '10px 22px', borderRadius: 9, border: 'none', background: `linear-gradient(120deg,#10B981,${C.green})`, color: '#fff', fontWeight: 700, fontSize: 13, cursor: busy || matched.length === 0 ? 'not-allowed' : 'pointer', opacity: busy || matched.length === 0 ? 0.6 : 1, boxShadow: '0 3px 10px rgba(5,150,105,0.22)' }}>
            {busy ? 'Processing…' : `Process ${matched.length} rows`}
          </button>
          <button onClick={onCancel} disabled={busy}
            style={{ padding: '10px 20px', borderRadius: 9, border: `1px solid ${C.border}`, background: '#fff', color: C.muted, fontWeight: 700, fontSize: 13, cursor: busy ? 'not-allowed' : 'pointer' }}>
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}
