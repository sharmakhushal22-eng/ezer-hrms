'use client'
// components/recruitment/RecruiterPicker.tsx — HR Head picks the hiring manager(s) for an
// approved MRF: search by employee code or name, add several, remove with ×. Recruiters
// (RECRUITER role) are suggested first; anyone in the company can be found by code.
// Module-level component (never defined inside a parent) so typing never loses focus.
import { useState } from 'react'

export interface PickerPerson { id: string; name: string; code: string; designation?: string; is_recruiter?: boolean }

/** Shape the /api/ess/mrf GET payload into picker rows (companyPeople + hrOptions flag). */
export function toPickerPeople(d: any): PickerPerson[] {
  const rec = new Set(((d?.hrOptions) || []).map((h: any) => h.id))
  const base: PickerPerson[] = ((d?.companyPeople) || []).map((p: any) => ({ id: p.id, name: p.full_name || p.name, code: p.emp_code || p.code, designation: p.designation || '', is_recruiter: rec.has(p.id) }))
  if (base.length) return base
  return ((d?.hrOptions) || []).map((h: any) => ({ id: h.id, name: h.name, code: h.code, designation: 'Hiring Manager', is_recruiter: true }))
}

const P = { purple: '#7C3AED', purpleD: '#6D28D9', tint: 'rgba(124,58,237,0.08)', border: '#DDD6FE', ink: '#1E1B4B', muted: '#6B7280', faint: '#9CA3AF', green: '#059669', greenBg: '#ECFDF5', sunken: '#FAFAF8', red: '#DC2626' }

export default function RecruiterPicker({ people, value, onChange, placeholder }: { people: PickerPerson[]; value: string[]; onChange: (ids: string[]) => void; placeholder?: string }) {
  const [q, setQ] = useState('')
  const ql = q.trim().toLowerCase()
  const selected = value.map(id => people.find(p => p.id === id)).filter(Boolean) as PickerPerson[]
  const hits = (ql
    ? people.filter(p => !value.includes(p.id) && ((p.code || '').toLowerCase().includes(ql) || (p.name || '').toLowerCase().includes(ql)))
    : people.filter(p => p.is_recruiter && !value.includes(p.id))
  ).slice(0, 10)
  const add = (id: string) => { if (!value.includes(id)) onChange([...value, id]); setQ('') }
  const remove = (id: string) => onChange(value.filter(x => x !== id))
  const initials = (n: string) => (n || '?').split(' ').slice(0, 2).map(x => x[0]).join('').toUpperCase()

  return (
    <div>
      {selected.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          {selected.map(p => (
            <span key={p.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: P.greenBg, color: P.green, border: `1px solid #A7F3D0`, borderRadius: 99, padding: '4px 6px 4px 10px', fontSize: 12, fontWeight: 600 }}>
              {p.name} <span style={{ fontWeight: 500, opacity: .8 }}>({p.code})</span>
              <button type="button" onClick={() => remove(p.id)} aria-label={`Remove ${p.name}`} style={{ border: 'none', background: 'transparent', color: P.green, cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: '0 2px', fontFamily: 'inherit' }}>×</button>
            </span>
          ))}
        </div>
      )}
      <input value={q} onChange={e => setQ(e.target.value)} placeholder={placeholder || 'Search by employee code or name…'}
        style={{ width: '100%', padding: '9px 11px', background: P.sunken, border: `1px solid ${P.border}`, borderRadius: 7, color: P.ink, fontSize: 13, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }} />
      <div style={{ fontSize: 10.5, color: P.faint, margin: '6px 2px 4px', textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 700 }}>
        {ql ? `${hits.length ? hits.length : 'No'} match${hits.length === 1 ? '' : 'es'}` : 'Suggested hiring managers'}
      </div>
      <div style={{ border: `1px solid ${P.border}`, borderRadius: 10, overflow: 'hidden', maxHeight: 260, overflowY: 'auto' }}>
        {hits.length === 0 && (
          <div style={{ fontSize: 12.5, color: P.faint, padding: '14px 16px' }}>
            {ql ? 'No employee matches that code or name.' : (people.length ? 'No recruiters suggested — search by employee code or name to add anyone.' : 'No employees found in your company.')}
          </div>
        )}
        {hits.map((p, i) => (
          <button type="button" key={p.id} onClick={() => add(p.id)}
            style={{ display: 'flex', width: '100%', gap: 11, alignItems: 'center', padding: '10px 14px', cursor: 'pointer', background: '#fff', border: 'none', borderTop: i ? `1px solid ${P.border}` : 'none', textAlign: 'left', fontFamily: 'inherit' }}>
            <span style={{ width: 30, height: 30, borderRadius: '50%', background: P.tint, color: P.purpleD, fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{initials(p.name)}</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: P.ink }}>{p.name}</div>
              <div style={{ fontSize: 11, color: P.faint }}>{p.code}{p.designation ? ` · ${p.designation}` : ''}</div>
            </span>
            {p.is_recruiter && <span style={{ fontSize: 10, fontWeight: 700, color: P.purpleD, background: P.tint, padding: '2px 8px', borderRadius: 99, flexShrink: 0 }}>Recruiter</span>}
            <span style={{ fontSize: 12, fontWeight: 700, color: P.purple, flexShrink: 0 }}>+ Add</span>
          </button>
        ))}
      </div>
      {selected.length > 0 && <div style={{ fontSize: 11.5, color: P.green, fontWeight: 600, marginTop: 8 }}>{selected.length} hiring manager{selected.length > 1 ? 's' : ''} selected</div>}
    </div>
  )
}
