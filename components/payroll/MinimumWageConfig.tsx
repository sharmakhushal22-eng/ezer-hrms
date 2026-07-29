'use client'
// components/payroll/MinimumWageConfig.tsx — Payroll → Configuration → Minimum Wages.
// Wide zone entry: one state + zone, all 4 skill categories, one w.e.f date — matching
// how a government notification reads. Backed by minimum_wage_config (4 EXCLUDE-protected
// rows per zone, migration sql67) and read from the minimum_wage_pivot view (sql68).
// Rendered inline in the payroll config dropdown — no full-page wrapper.
import { useState, useEffect, useCallback } from 'react'
import { getZoneRates, reviseZoneRates } from '@/lib/minimum-wage/zoneActions'
import type { ZoneRatesPivot } from '@/lib/minimum-wage/zoneActions'
import { INDIAN_STATES } from '@/lib/geo/india-states-districts'

const C = {
  navy: '#1E1B4B', purple: '#7C3AED', purpleD: '#3C3489', card: '#FFFFFF',
  border: '#E9E7F5', muted: '#6B7280', amber: '#D97706', amberBg: '#FFFBEB',
  purpleBg: '#EEEDFE', gray: '#F8F7FF', red: '#DC2626', redBg: '#FEF2F2',
}
const font = '"DM Sans","Segoe UI",sans-serif'
const inputStyle: React.CSSProperties = { width: '100%', padding: '9px 11px', border: '1px solid #DDD6FE', borderRadius: 7, fontSize: 13, boxSizing: 'border-box', fontFamily: font, outline: 'none', background: '#FAFAF8', color: C.navy }
const labelStyle: React.CSSProperties = { fontSize: 10, color: C.muted, display: 'block', marginBottom: 4 }

// ── Searchable dropdown (type to filter) ────────────────────────────
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

// ── Revise / add zone modal ─────────────────────────────────────────
function ZoneFormModal({ preset, onClose, onSaved }: {
  preset?: ZoneRatesPivot | null; onClose: () => void; onSaved: () => void
}) {
  const [state, setState] = useState(preset?.state ?? '')
  const [zone, setZone] = useState(preset?.zone ?? 'ALL')
  const [unskilled, setUnskilled] = useState('')
  const [semiSkilled, setSemiSkilled] = useState('')
  const [skilled, setSkilled] = useState('')
  const [highlySkilled, setHighlySkilled] = useState('')
  const [effectiveFrom, setEffectiveFrom] = useState('')
  const [notificationRef, setNotificationRef] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const valid = state.trim() && zone.trim() && unskilled && semiSkilled && skilled && highlySkilled && effectiveFrom

  async function handleSave() {
    setSaving(true); setErr('')
    try {
      await reviseZoneRates({
        state: state.trim(), zone: zone.trim(),
        unskilled: Number(unskilled), semiSkilled: Number(semiSkilled),
        skilled: Number(skilled), highlySkilled: Number(highlySkilled),
        effectiveFrom, notificationReference: notificationRef || undefined,
      })
      onSaved()
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(30,27,75,0.45)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, fontFamily: font }}>
      <div style={{ background: '#fff', borderRadius: 14, padding: 22, width: '100%', maxWidth: 540, boxShadow: '0 20px 50px rgba(30,27,75,0.3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg,#7C3AED,#5B21B6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>📊</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: C.navy }}>{preset ? 'Revise zone rates' : 'Add zone rates'}</div>
            <div style={{ fontSize: 10.5, color: C.muted }}>All 4 categories, one w.e.f date</div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 8, marginBottom: 10 }}>
          <div><label style={labelStyle}>State *</label><SearchSelect value={state} options={INDIAN_STATES} placeholder="Select state" onChange={setState} /></div>
          <div><label style={labelStyle}>Zone *</label><input value={zone} onChange={e => setZone(e.target.value)} placeholder="ALL / Zone 1" style={inputStyle} /></div>
        </div>

        <div style={{ fontSize: 11, fontWeight: 700, color: C.purple, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>Rates for this zone (₹/month)</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
          <div><label style={labelStyle}>Unskilled *</label><input type="number" value={unskilled} onChange={e => setUnskilled(e.target.value)} style={inputStyle} /></div>
          <div><label style={labelStyle}>Semi-skilled *</label><input type="number" value={semiSkilled} onChange={e => setSemiSkilled(e.target.value)} style={inputStyle} /></div>
          <div><label style={labelStyle}>Skilled *</label><input type="number" value={skilled} onChange={e => setSkilled(e.target.value)} style={inputStyle} /></div>
          <div><label style={labelStyle}>Highly skilled *</label><input type="number" value={highlySkilled} onChange={e => setHighlySkilled(e.target.value)} style={inputStyle} /></div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
          <div><label style={labelStyle}>W.e.f date *</label><input type="date" value={effectiveFrom} onChange={e => setEffectiveFrom(e.target.value)} style={inputStyle} /></div>
          <div><label style={labelStyle}>Notification reference</label><input value={notificationRef} onChange={e => setNotificationRef(e.target.value)} placeholder="HR/Labour/2026/078" style={inputStyle} /></div>
        </div>

        <div style={{ fontSize: 11, color: C.muted, background: C.gray, padding: '9px 11px', borderRadius: 8, marginBottom: 10, lineHeight: 1.5 }}>
          All 4 categories for this state + zone update together with this one w.e.f date — the previous rates are automatically closed off the day before. Overlapping validity is rejected by the database itself.
        </div>

        {err && <div style={{ fontSize: 11, color: C.red, background: C.redBg, padding: '8px 10px', borderRadius: 6, marginBottom: 10 }}>{err}</div>}

        <div style={{ display: 'flex', gap: 8 }}>
          <button disabled={!valid || saving} onClick={handleSave}
            style={{ flex: 1, padding: '11px', borderRadius: 9, border: 'none', background: 'linear-gradient(120deg,#7C3AED,#5B21B6)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: (!valid || saving) ? 'not-allowed' : 'pointer', opacity: (!valid || saving) ? 0.5 : 1, boxShadow: '0 3px 10px rgba(124,58,237,0.22)' }}>
            {saving ? 'Saving…' : '💾 Save all 4 rates'}
          </button>
          <button onClick={onClose} style={{ padding: '11px 18px', borderRadius: 9, border: `1px solid ${C.border}`, background: '#fff', cursor: 'pointer', fontSize: 13, color: C.muted, fontWeight: 600 }}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

export default function MinimumWageConfig() {
  const [rows, setRows] = useState<ZoneRatesPivot[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [modal, setModal] = useState<{ open: boolean; preset?: ZoneRatesPivot | null }>({ open: false })

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { setRows(await getZoneRates()) }
    catch (e: any) { setError(e.message || 'Could not load rates — run sql67 + sql68 first.') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const inr = (n: number | null) => n == null ? '—' : `₹${Number(n).toLocaleString('en-IN')}`

  return (
    <div style={{ fontFamily: font, fontSize: 13, maxWidth: 860 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: 'linear-gradient(135deg,#7C3AED,#5B21B6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, boxShadow: '0 3px 10px rgba(124,58,237,0.28)' }}>📊</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: C.navy, lineHeight: 1.1 }}>Minimum Wages</div>
          <div style={{ fontSize: 10.5, color: C.muted, marginTop: 3 }}>State &amp; zone-wise statutory floor · one state can have multiple zones, each tracked independently</div>
        </div>
        <button onClick={() => setModal({ open: true, preset: null })}
          onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.filter = 'brightness(1.08)'}
          onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.filter = 'none'}
          style={{ padding: '10px 16px', borderRadius: 9, border: 'none', background: 'linear-gradient(120deg,#7C3AED,#5B21B6)', color: '#fff', fontWeight: 700, fontSize: 12.5, cursor: 'pointer', boxShadow: '0 3px 10px rgba(124,58,237,0.22)', transition: 'filter .12s', whiteSpace: 'nowrap' }}>
          + Add / revise zone
        </button>
      </div>

      {error && <div style={{ fontSize: 12, color: C.amber, background: C.amberBg, border: '1px solid #FDE8C8', padding: '10px 12px', borderRadius: 9, marginBottom: 12 }}>{error}</div>}

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 6px rgba(124,58,237,0.07)' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
            <thead>
              <tr style={{ background: C.navy }}>
                {['State', 'Zone', 'Unskilled', 'Semi-skilled', 'Skilled', 'Highly skilled', 'W.e.f', ''].map((h, i) => (
                  <th key={i} style={{ padding: '10px 12px', textAlign: i >= 2 && i <= 5 ? 'right' : 'left', fontSize: 9.5, color: '#A5B4FC', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.state}-${r.zone}`} style={{ borderBottom: `1px solid ${C.border}`, background: i % 2 === 0 ? C.gray : C.card }}>
                  <td style={{ padding: '9px 12px', fontWeight: 700, color: C.navy }}>{r.state}</td>
                  <td style={{ padding: '9px 12px' }}><span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 99, background: C.purpleBg, color: C.purpleD, fontWeight: 700 }}>{r.zone}</span></td>
                  <td style={{ padding: '9px 12px', textAlign: 'right', color: C.navy }}>{inr(r.unskilled)}</td>
                  <td style={{ padding: '9px 12px', textAlign: 'right', color: C.navy }}>{inr(r.semi_skilled)}</td>
                  <td style={{ padding: '9px 12px', textAlign: 'right', color: C.navy }}>{inr(r.skilled)}</td>
                  <td style={{ padding: '9px 12px', textAlign: 'right', color: C.navy }}>{inr(r.highly_skilled)}</td>
                  <td style={{ padding: '9px 12px', color: C.muted, whiteSpace: 'nowrap' }}>
                    {new Date(r.latest_effective_from).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                    {!r.single_effective_date && (
                      <span title="The 4 categories currently have different effective dates" style={{ marginLeft: 6, fontSize: 9, padding: '1px 6px', borderRadius: 999, background: C.amberBg, color: C.amber, fontWeight: 700 }}>mixed dates</span>
                    )}
                  </td>
                  <td style={{ padding: '9px 12px', textAlign: 'right' }}>
                    <button onClick={() => setModal({ open: true, preset: r })} title="Revise this zone"
                      style={{ fontSize: 11, fontWeight: 700, padding: '4px 11px', borderRadius: 7, border: `1px solid ${C.border}`, background: '#fff', color: C.purpleD, cursor: 'pointer' }}>Revise</button>
                  </td>
                </tr>
              ))}
              {!loading && rows.length === 0 && <tr><td colSpan={8} style={{ padding: 34, textAlign: 'center', color: C.muted }}>No zones configured yet. Click <b>+ Add / revise zone</b> to add the first rate.</td></tr>}
              {loading && <tr><td colSpan={8} style={{ padding: 34, textAlign: 'center', color: C.purple }}>Loading rates…</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {modal.open && <ZoneFormModal preset={modal.preset} onClose={() => setModal({ open: false })} onSaved={() => { setModal({ open: false }); load() }} />}
    </div>
  )
}
