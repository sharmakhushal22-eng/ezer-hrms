'use client'
// components/payroll/PtConfig.tsx — Payroll → Configuration → PT Slabs.
// State-wise Professional Tax: salary-range slabs, per-month amounts (handles
// Maharashtra's Feb annual-cap bump and Tamil Nadu / Kerala's twice-yearly Mar+Sep
// pattern), and gender-restricted slabs. Backed by pt_config (effective-dated,
// EXCLUDE-protected — migration sql70) + get_pt_amount(). Inline in the config dropdown.
import { useState, useEffect, useCallback } from 'react'
import { getCurrentPtSlabs, reviseSlab } from '@/lib/pt/actions'
import { MONTH_LABELS } from '@/lib/pt/types'
import type { PtConfig as PtRow, Gender } from '@/lib/pt/types'
import { INDIAN_STATES } from '@/lib/geo/india-states-districts'

const C = {
  navy: '#1E1B4B', purple: '#7C3AED', purpleD: '#3C3489', card: '#FFFFFF',
  border: '#E9E7F5', muted: '#6B7280', amber: '#D97706', amberBg: '#FFFBEB',
  purpleBg: '#EEEDFE', gray: '#F8F7FF', red: '#DC2626', redBg: '#FEF2F2', green: '#059669',
}
const font = '"DM Sans","Segoe UI",sans-serif'
const inputStyle: React.CSSProperties = { width: '100%', padding: '8px 10px', border: '1px solid #DDD6FE', borderRadius: 7, fontSize: 12.5, boxSizing: 'border-box', fontFamily: font, outline: 'none', background: '#FAFAF8', color: C.navy }
const labelStyle: React.CSSProperties = { fontSize: 10, color: C.muted, display: 'block', marginBottom: 4 }

function summarizeMonths(r: PtRow): string {
  const amts = [r.jan,r.feb,r.mar,r.apr,r.may,r.jun,r.jul,r.aug,r.sep,r.oct,r.nov,r.dec].map(Number)
  const uniq = Array.from(new Set(amts))
  if (uniq.length === 1) return uniq[0] === 0 ? 'Exempt (₹0)' : `₹${uniq[0]} every month`
  const nonZeroMonths = amts.map((a, i) => a > 0 ? MONTH_LABELS[i] : null).filter(Boolean)
  const zeroCount = amts.filter(a => a === 0).length
  if (zeroCount >= 10) return `₹${Math.max(...amts)} — only ${nonZeroMonths.join(', ')}`
  return `Varies (peak ₹${Math.max(...amts)})`
}
function slabLabel(r: PtRow): string {
  const min = Number(r.slab_min).toLocaleString('en-IN')
  return r.slab_max != null ? `₹${min}–${Number(r.slab_max).toLocaleString('en-IN')}` : `₹${min}+`
}

// ── Searchable dropdown ─────────────────────────────────────────────
function SearchSelect({ value, options, placeholder, onChange }: {
  value: string; options: string[]; placeholder: string; onChange: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const filtered = (q.trim() ? options.filter(o => o.toLowerCase().includes(q.toLowerCase())) : options).slice(0, 100)
  return (
    <div style={{ position: 'relative' }}>
      <div onClick={() => { setOpen(o => !o); setQ('') }}
        style={{ ...inputStyle, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, color: value ? C.navy : '#94A3B8' }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value || placeholder}</span>
        <span style={{ color: '#94A3B8', fontSize: 11 }}>▾</span>
      </div>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 210 }} />
          <div style={{ position: 'absolute', top: 'calc(100% + 3px)', left: 0, width: '100%', minWidth: 200, background: '#fff', border: '1px solid #DDD6FE', borderRadius: 8, boxShadow: '0 8px 24px rgba(30,27,75,0.16)', zIndex: 211, overflow: 'hidden' }}>
            <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search…"
              style={{ width: '100%', padding: '8px 10px', border: 'none', borderBottom: '1px solid #EEF', fontSize: 12.5, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }} />
            <div style={{ maxHeight: 200, overflowY: 'auto' }}>
              {filtered.length === 0 && <div style={{ padding: '8px 10px', fontSize: 12, color: '#94A3B8' }}>No matches</div>}
              {filtered.map(o => (
                <div key={o} onClick={() => { onChange(o); setOpen(false) }}
                  onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = '#F5F3FF'}
                  onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = o === value ? '#EEF2FF' : '#fff'}
                  style={{ padding: '7px 10px', fontSize: 12.5, cursor: 'pointer', background: o === value ? '#EEF2FF' : '#fff', color: C.navy }}>
                  {o}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ── Add / revise slab modal ─────────────────────────────────────────
function ReviseModal({ preset, onClose, onSaved }: { preset?: PtRow | null; onClose: () => void; onSaved: () => void }) {
  const [state, setState] = useState(preset?.state ?? '')
  const [slabMin, setSlabMin] = useState(preset ? String(preset.slab_min) : '')
  const [slabMax, setSlabMax] = useState(preset?.slab_max != null ? String(preset.slab_max) : '')
  const [gender, setGender] = useState<Gender>(preset?.gender ?? 'ALL')
  const [amounts, setAmounts] = useState<string[]>(
    preset ? [preset.jan,preset.feb,preset.mar,preset.apr,preset.may,preset.jun,preset.jul,preset.aug,preset.sep,preset.oct,preset.nov,preset.dec].map(String) : Array(12).fill('')
  )
  const [effectiveFrom, setEffectiveFrom] = useState('')
  const [notificationRef, setNotificationRef] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const valid = state.trim() && slabMin !== '' && amounts.every(a => a !== '') && effectiveFrom

  async function handleSave() {
    setSaving(true); setErr('')
    try {
      await reviseSlab({
        state: state.trim(), slabMin: Number(slabMin), slabMax: slabMax ? Number(slabMax) : null,
        gender, amounts: amounts.map(Number),
        effectiveFrom, notificationReference: notificationRef || undefined,
      })
      onSaved()
    } catch (e: any) { setErr(e.message) } finally { setSaving(false) }
  }

  const quick = (label: string, fn: () => void) => (
    <button type="button" onClick={fn} style={{ fontSize: 10, padding: '3px 9px', borderRadius: 6, border: `1px solid ${C.border}`, background: '#fff', cursor: 'pointer', color: C.purpleD, fontWeight: 700 }}>{label}</button>
  )
  const setSame = () => { const v = amounts.find(a => a) || '200'; setAmounts(Array(12).fill(v)) }
  const setTwice = () => { const v = amounts.find((a, i) => (i === 2 || i === 8) && a) || amounts.find(a => a) || '300'; setAmounts(MONTH_LABELS.map((m) => (m === 'Mar' || m === 'Sep') ? v : '0')) }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(30,27,75,0.45)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, fontFamily: font }}>
      <div style={{ background: '#fff', borderRadius: 14, padding: 22, width: '100%', maxWidth: 580, maxHeight: '92vh', overflowY: 'auto', boxShadow: '0 20px 50px rgba(30,27,75,0.3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg,#7C3AED,#5B21B6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>⚖️</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: C.navy }}>{preset ? 'Revise PT slab' : 'Add PT slab'}</div>
            <div style={{ fontSize: 10.5, color: C.muted }}>Salary band + per-month amount</div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 8, marginBottom: 10 }}>
          <div><label style={labelStyle}>State *</label><SearchSelect value={state} options={INDIAN_STATES} placeholder="Select state" onChange={setState} /></div>
          <div><label style={labelStyle}>Slab min (₹) *</label><input type="number" value={slabMin} onChange={e => setSlabMin(e.target.value)} style={inputStyle} /></div>
          <div><label style={labelStyle}>Slab max (₹)</label><input type="number" value={slabMax} onChange={e => setSlabMax(e.target.value)} placeholder="blank = +" style={inputStyle} /></div>
          <div><label style={labelStyle}>Gender</label>
            <select value={gender} onChange={e => setGender(e.target.value as Gender)} style={inputStyle}>
              <option value="ALL">All</option><option value="MALE">Male only</option><option value="FEMALE">Female only</option>
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <label style={labelStyle}>Amount per month (₹) *</label>
          <div style={{ display: 'flex', gap: 6 }}>
            {quick('Same all months', setSame)}
            {quick('Only Mar + Sep', setTwice)}
            {quick('Clear', () => setAmounts(Array(12).fill('0')))}
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 6, marginBottom: 10 }}>
          {MONTH_LABELS.map((m, i) => (
            <div key={m}>
              <div style={{ fontSize: 9, color: C.muted, textAlign: 'center', marginBottom: 2 }}>{m}</div>
              <input type="number" value={amounts[i]} onChange={e => setAmounts(prev => prev.map((v, j) => j === i ? e.target.value : v))}
                style={{ ...inputStyle, padding: '6px 4px', textAlign: 'center' }} />
            </div>
          ))}
        </div>
        <div style={{ fontSize: 10.5, color: C.muted, background: C.gray, padding: '8px 10px', borderRadius: 7, marginBottom: 10, lineHeight: 1.5 }}>
          Use <b>Only Mar + Sep</b> for twice-yearly states (Tamil Nadu, Kerala). For Maharashtra&apos;s annual-cap adjustment, set February higher than the other months directly.
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
          <div><label style={labelStyle}>Effective from *</label><input type="date" value={effectiveFrom} onChange={e => setEffectiveFrom(e.target.value)} style={inputStyle} /></div>
          <div><label style={labelStyle}>Notification reference</label><input value={notificationRef} onChange={e => setNotificationRef(e.target.value)} placeholder="PT/2026/…" style={inputStyle} /></div>
        </div>

        {err && <div style={{ fontSize: 11, color: C.red, background: C.redBg, padding: '8px 10px', borderRadius: 6, marginBottom: 10 }}>{err}</div>}

        <div style={{ display: 'flex', gap: 8 }}>
          <button disabled={!valid || saving} onClick={handleSave}
            style={{ flex: 1, padding: '11px', borderRadius: 9, border: 'none', background: 'linear-gradient(120deg,#7C3AED,#5B21B6)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: (!valid || saving) ? 'not-allowed' : 'pointer', opacity: (!valid || saving) ? 0.5 : 1, boxShadow: '0 3px 10px rgba(124,58,237,0.22)' }}>
            {saving ? 'Saving…' : '💾 Save slab'}
          </button>
          <button onClick={onClose} style={{ padding: '11px 18px', borderRadius: 9, border: `1px solid ${C.border}`, background: '#fff', cursor: 'pointer', fontSize: 13, color: C.muted, fontWeight: 600 }}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

export default function PtConfig() {
  const [slabs, setSlabs] = useState<PtRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [modal, setModal] = useState<{ open: boolean; preset?: PtRow | null }>({ open: false })

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { setSlabs(await getCurrentPtSlabs()) }
    catch (e: any) { setError(e.message || 'Could not load — run sql70 first.') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const grouped: Record<string, PtRow[]> = {}
  for (const s of slabs) { (grouped[s.state] ??= []).push(s) }
  const states = Object.keys(grouped).sort()

  return (
    <div style={{ fontFamily: font, fontSize: 13, maxWidth: 760 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: 'linear-gradient(135deg,#7C3AED,#5B21B6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, boxShadow: '0 3px 10px rgba(124,58,237,0.28)' }}>⚖️</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: C.navy, lineHeight: 1.1 }}>Professional Tax</div>
          <div style={{ fontSize: 10.5, color: C.muted, marginTop: 3 }}>State + salary slab — the amount can vary by month within the same slab</div>
        </div>
        <button onClick={() => setModal({ open: true, preset: null })}
          onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.filter = 'brightness(1.08)'}
          onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.filter = 'none'}
          style={{ padding: '10px 16px', borderRadius: 9, border: 'none', background: 'linear-gradient(120deg,#7C3AED,#5B21B6)', color: '#fff', fontWeight: 700, fontSize: 12.5, cursor: 'pointer', boxShadow: '0 3px 10px rgba(124,58,237,0.22)', transition: 'filter .12s', whiteSpace: 'nowrap' }}>
          + Add / revise slab
        </button>
      </div>

      {error && <div style={{ fontSize: 12, color: C.amber, background: C.amberBg, border: '1px solid #FDE8C8', padding: '10px 12px', borderRadius: 9, marginBottom: 12 }}>{error}</div>}
      {loading && <div style={{ fontSize: 12, color: C.purple, padding: 8 }}>Loading…</div>}
      {!loading && states.length === 0 && !error && <div style={{ fontSize: 13, color: C.muted, background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 30, textAlign: 'center' }}>No PT slabs configured yet. Click <b>+ Add / revise slab</b> to add the first one.</div>}

      {states.map(state => {
        const rows = grouped[state]
        return (
          <div key={state} style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: C.purpleD }}>{state}</span>
              <span style={{ fontSize: 9.5, fontWeight: 700, color: C.muted, background: C.gray, borderRadius: 99, padding: '1px 8px' }}>{rows.length} slab{rows.length > 1 ? 's' : ''}</span>
            </div>
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 6px rgba(124,58,237,0.07)' }}>
              {rows.map((r, i) => (
                <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: i < rows.length - 1 ? `1px solid ${C.border}` : 'none', background: i % 2 === 0 ? C.gray : C.card }}>
                  <span style={{ color: C.navy, fontWeight: 600 }}>
                    {slabLabel(r)}
                    {r.gender !== 'ALL' && <span style={{ marginLeft: 7, fontSize: 9, padding: '1px 7px', borderRadius: 999, background: C.amberBg, color: C.amber, fontWeight: 700 }}>{r.gender}</span>}
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ color: C.muted, fontSize: 12.5 }}>{summarizeMonths(r)}</span>
                    <button onClick={() => setModal({ open: true, preset: r })} title="Revise this slab"
                      style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 7, border: `1px solid ${C.border}`, background: '#fff', color: C.purpleD, cursor: 'pointer' }}>Revise</button>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )
      })}

      {modal.open && <ReviseModal preset={modal.preset} onClose={() => setModal({ open: false })} onSaved={() => { setModal({ open: false }); load() }} />}
    </div>
  )
}
