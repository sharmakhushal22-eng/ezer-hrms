'use client'
// components/payroll/LwfConfig.tsx — Payroll → Configuration → LWF.
// State-wise Labour Welfare Fund: applicable months (monthly / Jun+Dec / annual),
// employee + employer contribution, and a per-state exit-exemption flag (Haryana-style:
// exempt if the employee left before the last applicable day). Backed by lwf_config
// (effective-dated, EXCLUDE-protected — migration sql69). Rendered inline in the payroll
// config dropdown — no full-page wrapper.
import { useState, useEffect, useCallback } from 'react'
import { getCurrentLwfRates, reviseLwfConfig } from '@/lib/lwf/actions'
import { MONTH_NAMES } from '@/lib/lwf/types'
import type { LwfConfig as LwfRow } from '@/lib/lwf/types'
import { INDIAN_STATES } from '@/lib/geo/india-states-districts'

const C = {
  navy: '#1E1B4B', purple: '#7C3AED', purpleD: '#3C3489', card: '#FFFFFF',
  border: '#E9E7F5', muted: '#6B7280', green: '#059669', greenBg: '#ECFDF5',
  amber: '#D97706', amberBg: '#FFFBEB', purpleBg: '#EEEDFE', gray: '#F8F7FF',
  red: '#DC2626', redBg: '#FEF2F2',
}
const font = '"DM Sans","Segoe UI",sans-serif'
const inputStyle: React.CSSProperties = { width: '100%', padding: '9px 11px', border: '1px solid #DDD6FE', borderRadius: 7, fontSize: 13, boxSizing: 'border-box', fontFamily: font, outline: 'none', background: '#FAFAF8', color: C.navy }
const labelStyle: React.CSSProperties = { fontSize: 10, color: C.muted, display: 'block', marginBottom: 4 }

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

function MonthPicker({ selected, onToggle }: { selected: number[]; onToggle: (m: number) => void }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 6 }}>
      {MONTH_NAMES.map((name, i) => {
        const m = i + 1
        const active = selected.includes(m)
        return (
          <button key={m} onClick={() => onToggle(m)} type="button"
            style={{ padding: '7px 4px', borderRadius: 7, border: `1px solid ${active ? C.purple : C.border}`, background: active ? 'linear-gradient(135deg,#7C3AED,#5B21B6)' : '#fff', color: active ? '#fff' : C.navy, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
            {name}
          </button>
        )
      })}
    </div>
  )
}

// ── Add / revise modal ──────────────────────────────────────────────
function ReviseModal({ preset, onClose, onSaved }: { preset?: LwfRow | null; onClose: () => void; onSaved: () => void }) {
  const [state, setState] = useState(preset?.state ?? '')
  const [months, setMonths] = useState<number[]>(preset?.applicable_months ?? [])
  const [empContrib, setEmpContrib] = useState(preset ? String(preset.employee_contribution) : '')
  const [erContrib, setErContrib] = useState(preset ? String(preset.employer_contribution) : '')
  const [exitExemption, setExitExemption] = useState(preset?.exit_exemption_if_before_period_end ?? false)
  const [effectiveFrom, setEffectiveFrom] = useState('')
  const [notificationRef, setNotificationRef] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const valid = state.trim() && months.length > 0 && empContrib && erContrib && effectiveFrom

  function toggleMonth(m: number) {
    setMonths(prev => prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m].sort((a, b) => a - b))
  }

  async function handleSave() {
    setSaving(true); setErr('')
    try {
      await reviseLwfConfig({
        state: state.trim(), applicableMonths: months,
        employeeContribution: Number(empContrib), employerContribution: Number(erContrib),
        exitExemptionIfBeforePeriodEnd: exitExemption,
        effectiveFrom, notificationReference: notificationRef || undefined,
      })
      onSaved()
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setSaving(false)
    }
  }

  const quick = (label: string, fn: () => void) => (
    <button type="button" onClick={fn} style={{ fontSize: 10, padding: '3px 9px', borderRadius: 6, border: `1px solid ${C.border}`, background: '#fff', cursor: 'pointer', color: C.purpleD, fontWeight: 700 }}>{label}</button>
  )

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(30,27,75,0.45)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, fontFamily: font }}>
      <div style={{ background: '#fff', borderRadius: 14, padding: 22, width: '100%', maxWidth: 500, maxHeight: '92vh', overflowY: 'auto', boxShadow: '0 20px 50px rgba(30,27,75,0.3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg,#7C3AED,#5B21B6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>🏛️</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: C.navy }}>{preset ? 'Revise LWF config' : 'Add LWF state'}</div>
            <div style={{ fontSize: 10.5, color: C.muted }}>Applicable months + contributions</div>
          </div>
        </div>

        <div style={{ marginBottom: 10 }}>
          <label style={labelStyle}>State *</label>
          <SearchSelect value={state} options={INDIAN_STATES} placeholder="Select state" onChange={setState} />
        </div>

        <div style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <label style={labelStyle}>Applicable months *</label>
            <div style={{ display: 'flex', gap: 6 }}>
              {quick('Monthly', () => setMonths([1,2,3,4,5,6,7,8,9,10,11,12]))}
              {quick('Jun + Dec', () => setMonths([6, 12]))}
              {quick('Dec only', () => setMonths([12]))}
            </div>
          </div>
          <MonthPicker selected={months} onToggle={toggleMonth} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
          <div><label style={labelStyle}>Employee contribution (₹) *</label><input type="number" value={empContrib} onChange={e => setEmpContrib(e.target.value)} style={inputStyle} /></div>
          <div><label style={labelStyle}>Employer contribution (₹) *</label><input type="number" value={erContrib} onChange={e => setErContrib(e.target.value)} style={inputStyle} /></div>
        </div>

        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', background: C.gray, borderRadius: 8, padding: '10px 11px', marginBottom: 10, cursor: 'pointer' }}>
          <input type="checkbox" checked={exitExemption} onChange={e => setExitExemption(e.target.checked)} style={{ marginTop: 2, accentColor: C.purple }} />
          <span style={{ fontSize: 11.5, color: C.navy, lineHeight: 1.5 }}>
            Exempt employees who left before the last day of an applicable month (Haryana-style rule — also fits half-yearly states like Maharashtra, exempting anyone who resigned before the 30 Jun / 31 Dec cutoff).
          </span>
        </label>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
          <div><label style={labelStyle}>Effective from *</label><input type="date" value={effectiveFrom} onChange={e => setEffectiveFrom(e.target.value)} style={inputStyle} /></div>
          <div><label style={labelStyle}>Notification reference</label><input value={notificationRef} onChange={e => setNotificationRef(e.target.value)} placeholder="LWF/2026/…" style={inputStyle} /></div>
        </div>

        {err && <div style={{ fontSize: 11, color: C.red, background: C.redBg, padding: '8px 10px', borderRadius: 6, marginBottom: 10 }}>{err}</div>}

        <div style={{ display: 'flex', gap: 8 }}>
          <button disabled={!valid || saving} onClick={handleSave}
            style={{ flex: 1, padding: '11px', borderRadius: 9, border: 'none', background: 'linear-gradient(120deg,#7C3AED,#5B21B6)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: (!valid || saving) ? 'not-allowed' : 'pointer', opacity: (!valid || saving) ? 0.5 : 1, boxShadow: '0 3px 10px rgba(124,58,237,0.22)' }}>
            {saving ? 'Saving…' : '💾 Save'}
          </button>
          <button onClick={onClose} style={{ padding: '11px 18px', borderRadius: 9, border: `1px solid ${C.border}`, background: '#fff', cursor: 'pointer', fontSize: 13, color: C.muted, fontWeight: 600 }}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

export default function LwfConfig() {
  const [rates, setRates] = useState<LwfRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [modal, setModal] = useState<{ open: boolean; preset?: LwfRow | null }>({ open: false })

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { setRates(await getCurrentLwfRates()) }
    catch (e: any) { setError(e.message || 'Could not load — run sql69 first.') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  function formatMonths(months: number[]): string {
    if (!months?.length) return '—'
    if (months.length === 12) return 'Monthly'
    if (months.length === 2 && months.includes(6) && months.includes(12)) return 'Jun + Dec (half-yearly)'
    return months.map(m => MONTH_NAMES[m - 1]).join(', ')
  }

  return (
    <div style={{ fontFamily: font, fontSize: 13, maxWidth: 900 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: 'linear-gradient(135deg,#7C3AED,#5B21B6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, boxShadow: '0 3px 10px rgba(124,58,237,0.28)' }}>🏛️</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: C.navy, lineHeight: 1.1 }}>Labour Welfare Fund</div>
          <div style={{ fontSize: 10.5, color: C.muted, marginTop: 3 }}>Deduction months &amp; rates vary by state — not every month, unlike PF / ESIC</div>
        </div>
        <button onClick={() => setModal({ open: true, preset: null })}
          onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.filter = 'brightness(1.08)'}
          onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.filter = 'none'}
          style={{ padding: '10px 16px', borderRadius: 9, border: 'none', background: 'linear-gradient(120deg,#7C3AED,#5B21B6)', color: '#fff', fontWeight: 700, fontSize: 12.5, cursor: 'pointer', boxShadow: '0 3px 10px rgba(124,58,237,0.22)', transition: 'filter .12s', whiteSpace: 'nowrap' }}>
          + Add / revise state
        </button>
      </div>

      {error && <div style={{ fontSize: 12, color: C.amber, background: C.amberBg, border: '1px solid #FDE8C8', padding: '10px 12px', borderRadius: 9, marginBottom: 12 }}>{error}</div>}

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 6px rgba(124,58,237,0.07)' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 680 }}>
            <thead>
              <tr style={{ background: C.navy }}>
                {['State', 'Applicable months', 'Employee', 'Employer', 'Exit exemption', 'W.e.f', ''].map((h, i) => (
                  <th key={i} style={{ padding: '10px 12px', textAlign: (i === 2 || i === 3) ? 'right' : 'left', fontSize: 9.5, color: '#A5B4FC', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rates.map((r, i) => (
                <tr key={r.id} style={{ borderBottom: `1px solid ${C.border}`, background: i % 2 === 0 ? C.gray : C.card }}>
                  <td style={{ padding: '9px 12px', fontWeight: 700, color: C.navy }}>{r.state}</td>
                  <td style={{ padding: '9px 12px', color: C.muted }}>{formatMonths(r.applicable_months)}</td>
                  <td style={{ padding: '9px 12px', textAlign: 'right', color: C.navy }}>₹{r.employee_contribution}</td>
                  <td style={{ padding: '9px 12px', textAlign: 'right', color: C.navy }}>₹{r.employer_contribution}</td>
                  <td style={{ padding: '9px 12px' }}>
                    {r.exit_exemption_if_before_period_end
                      ? <span style={{ fontSize: 10, padding: '2px 9px', borderRadius: 999, background: C.greenBg, color: C.green, fontWeight: 700 }}>Yes</span>
                      : <span style={{ fontSize: 10, padding: '2px 9px', borderRadius: 999, background: C.gray, color: C.muted, fontWeight: 700 }}>No</span>}
                  </td>
                  <td style={{ padding: '9px 12px', color: C.muted, whiteSpace: 'nowrap' }}>{new Date(r.effective_from).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                  <td style={{ padding: '9px 12px', textAlign: 'right' }}>
                    <button onClick={() => setModal({ open: true, preset: r })} title="Revise this state"
                      style={{ fontSize: 11, fontWeight: 700, padding: '4px 11px', borderRadius: 7, border: `1px solid ${C.border}`, background: '#fff', color: C.purpleD, cursor: 'pointer' }}>Revise</button>
                  </td>
                </tr>
              ))}
              {!loading && rates.length === 0 && <tr><td colSpan={7} style={{ padding: 34, textAlign: 'center', color: C.muted }}>No states configured yet. Click <b>+ Add / revise state</b> to add the first one.</td></tr>}
              {loading && <tr><td colSpan={7} style={{ padding: 34, textAlign: 'center', color: C.purple }}>Loading…</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {modal.open && <ReviseModal preset={modal.preset} onClose={() => setModal({ open: false })} onSaved={() => { setModal({ open: false }); load() }} />}
    </div>
  )
}
