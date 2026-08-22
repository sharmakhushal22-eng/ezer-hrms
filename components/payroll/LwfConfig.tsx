'use client'
// components/payroll/LwfConfig.tsx — Payroll → Configuration → LWF.
// State-wise Labour Welfare Fund: applicable months (monthly / Jun+Dec / annual),
// Two grids rather than one, because LWF is the rare deduction where the employer pays
// the larger share — Maharashtra takes ₹25 from the employee and ₹75 from the company —
// and a single table that showed only one of them would build a challan three-quarters
// short. Reached from Configuration → LWF and Statutory & Tax → LWF; one component, not
// two, so the screens cannot drift apart.
//
// employee + employer contribution, and a per-state exit-exemption flag (Haryana-style:
// exempt if the employee left before the last applicable day). Backed by lwf_config
// (effective-dated, EXCLUDE-protected — migration sql69). Rendered inline in the payroll
// config dropdown — no full-page wrapper.
import { useState, useEffect, useCallback } from 'react'
import { getCurrentLwfRates, reviseLwfConfig, calculateLwfDeduction } from '@/lib/lwf/actions'
import { MONTH_NAMES } from '@/lib/lwf/types'
import type { LwfConfig as LwfRow } from '@/lib/lwf/types'
import { INDIAN_STATES } from '@/lib/geo/india-states-districts'
// Design tokens, aliased as TK — many of these files already declare
// their own C. See lib/ui/tokens.ts.
import { C as TK } from '@/lib/ui'

const C = {
  navy: TK.ink, purple: TK.brand, purpleD: TK.brandDeep, card: TK.surface,
  border: TK.line, muted: TK.muted, green: TK.positive, greenBg: TK.positiveTint,
  amber: TK.warning, amberBg: TK.warningTint, purpleBg: TK.brandTint, gray: TK.sunken,
  red: TK.critical, redBg: TK.criticalTint,
}
const font = '"DM Sans","Segoe UI",sans-serif'
const inputStyle: React.CSSProperties = { width: '100%', padding: '9px 11px', border: `1px solid ${TK.brandEdge}`, borderRadius: 7, fontSize: 13, boxSizing: 'border-box', fontFamily: font, outline: 'none', background: TK.sunken, color: C.navy }
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
        style={{ ...inputStyle, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, color: value ? C.navy : TK.faint }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value || placeholder}</span>
        <span style={{ color: TK.faint, fontSize: 11 }}></span>
      </div>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 210 }} />
          <div style={{ position: 'absolute', top: 'calc(100% + 3px)', left: 0, width: '100%', minWidth: 200, background: TK.surface, border: `1px solid ${TK.brandEdge}`, borderRadius: 8, boxShadow: '0 8px 24px rgba(30,27,75,0.16)', zIndex: 211, overflow: 'hidden' }}>
            <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search…"
              style={{ width: '100%', padding: '8px 10px', border: 'none', borderBottom: `1px solid ${TK.brandEdge}`, fontSize: 13, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }} />
            <div style={{ maxHeight: 200, overflowY: 'auto' }}>
              {filtered.length === 0 && <div style={{ padding: '8px 10px', fontSize: 12, color: TK.faint }}>No matches</div>}
              {filtered.map(o => (
                <div key={o} onClick={() => { onChange(o); setOpen(false) }}
                  onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = TK.canvas}
                  onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = o === value ? TK.brandTint : TK.surface}
                  style={{ padding: '7px 10px', fontSize: 13, cursor: 'pointer', background: o === value ? TK.brandTint : TK.surface, color: C.navy }}>
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
            style={{ padding: '7px 4px', borderRadius: 7, border: `1px solid ${active ? C.purple : C.border}`, background: active ? 'linear-gradient(135deg,#2563EB,#5B21B6)' : TK.surface, color: active ? TK.surface : C.navy, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
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
    <button type="button" onClick={fn} style={{ fontSize: 10, padding: '3px 9px', borderRadius: 6, border: `1px solid ${C.border}`, background: TK.surface, cursor: 'pointer', color: C.purpleD, fontWeight: 700 }}>{label}</button>
  )

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(30,27,75,0.45)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, fontFamily: font }}>
      <div style={{ background: TK.surface, borderRadius: 14, padding: 22, width: '100%', maxWidth: 500, maxHeight: '92vh', overflowY: 'auto', boxShadow: '0 20px 50px rgba(30,27,75,0.3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: `linear-gradient(135deg,${TK.brand},${TK.brand})`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}></div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: C.navy }}>{preset ? 'Revise LWF config' : 'Add LWF state'}</div>
            <div style={{ fontSize: 11, color: C.muted }}>Applicable months + contributions</div>
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
          <span style={{ fontSize: 12, color: C.navy, lineHeight: 1.5 }}>
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
            style={{ flex: 1, padding: '11px', borderRadius: 9, border: 'none', background: `linear-gradient(120deg,${TK.brand},${TK.brand})`, color: TK.onAccent, fontWeight: 700, fontSize: 13, cursor: (!valid || saving) ? 'not-allowed' : 'pointer', opacity: (!valid || saving) ? 0.5 : 1, boxShadow: '0 3px 10px rgba(37,99,235,0.22)' }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button onClick={onClose} style={{ padding: '11px 18px', borderRadius: 9, border: `1px solid ${C.border}`, background: TK.surface, cursor: 'pointer', fontSize: 13, color: C.muted, fontWeight: 600 }}>Cancel</button>
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

  // Quick check. The exit checkbox is the one thing LWF needs that PT does not: in
  // Haryana and Maharashtra somebody who leaves before the period ends owes nothing,
  // while Punjab and the rest still deduct. That flag is per state, so it cannot be
  // guessed — the answer has to come from lwf_config.
  const [qState, setQState] = useState('')
  const [qMonth, setQMonth] = useState(4)
  const [qExit, setQExit] = useState(false)
  const [qBusy, setQBusy] = useState(false)
  const [qErr, setQErr] = useState('')
  const [qRes, setQRes] = useState<any>(null)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { setRates(await getCurrentLwfRates()) }
    catch (e: any) { setError(e.message || 'Could not load — run sql69 first.') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  async function runCheck() {
    if (!qState) return
    setQBusy(true); setQErr(''); setQRes(null)
    try {
      // A mid-month date only when the box is ticked — the exemption asks whether they
      // left BEFORE the period ended, so the 15th stands in for "somewhere in the middle".
      const mm = String(qMonth).padStart(2, '0')
      setQRes(await calculateLwfDeduction({
        state: qState, periodMonth: `2026-${mm}-01`,
        dateOfLeaving: qExit ? `2026-${mm}-15` : null,
      }))
    } catch (e: any) {
      setQErr(/could not find the function/i.test(e?.message || '')
        ? 'calculate_lwf_deduction() is not in this database yet — run sql69, then sql110.'
        : (e?.message || String(e)))
    } finally { setQBusy(false) }
  }

  const sorted = [...rates].sort((a, b) => a.state.localeCompare(b.state))

  const card: React.CSSProperties = {
    background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
    padding: '16px 18px', marginBottom: 16, boxShadow: '0 1px 6px rgba(37,99,235,0.07)',
  }
  const th: React.CSSProperties = {
    background: C.navy, color: TK.brand, padding: '7px 6px', textAlign: 'right',
    fontSize: 9, textTransform: 'uppercase', position: 'sticky', top: 0, whiteSpace: 'nowrap',
  }
  const td: React.CSSProperties = {
    padding: '6px 6px', textAlign: 'right', borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap',
  }

  // One grid, rendered twice — once for each side of the contribution. A dash rather
  // than a zero in the off months: zero reads as "we calculated nothing", a dash reads
  // as "this month is not a deduction month", which is what it actually means.
  function Grid({ side }: { side: 'employee' | 'employer' }) {
    const isEmp = side === 'employee'
    return (
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
          <span style={{
            fontSize: 9, fontWeight: 800, letterSpacing: '.05em', padding: '2px 8px', borderRadius: 99,
            background: isEmp ? C.purpleBg : TK.positiveTint, color: isEmp ? C.purpleD : C.green,
          }}>{isEmp ? 'EMPLOYEE' : 'EMPLOYER'}</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: C.navy }}>Contribution Table</span>
        </div>
        <div style={{ fontSize: 11, color: C.muted, marginBottom: 12 }}>
          {isEmp
            ? 'Deducted from the employee’s salary, by state and month. “—” means no deduction that month.'
            : 'Paid by the company on top, by state and month. Usually the larger of the two.'}
        </div>
        <div style={{ overflowX: 'auto', border: `1px solid ${C.border}`, borderRadius: 10 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr>
                <th style={{ ...th, textAlign: 'left' }}>State</th>
                <th style={{ ...th, textAlign: 'left' }}>Exit Exempt?</th>
                {MONTH_NAMES.map(m => <th key={m} style={th}>{m}</th>)}
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, i) => {
                const amt = Number(isEmp ? r.employee_contribution : r.employer_contribution) || 0
                const hit = qRes && qState === r.state
                return (
                  <tr key={r.id} style={{
                    background: hit ? C.amberBg : i % 2 ? C.gray : 'transparent',
                    outline: hit ? `2px solid ${C.amber}` : 'none',
                  }}>
                    <td style={{ ...td, textAlign: 'left', fontWeight: 600, color: C.navy }}>{r.state}</td>
                    <td style={{ ...td, textAlign: 'left' }}>
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 99,
                        background: r.exit_exemption_if_before_period_end ? TK.positiveTint : C.gray,
                        color: r.exit_exemption_if_before_period_end ? C.green : C.muted,
                      }}>{r.exit_exemption_if_before_period_end ? 'Yes' : 'No'}</span>
                    </td>
                    {MONTH_NAMES.map((m, mi) => {
                      const on = (r.applicable_months || []).includes(mi + 1)
                      return (
                        <td key={m} style={{ ...td, color: on ? C.navy: TK.line, fontWeight: on ? 700 : 400 }}>
                          {on ? amt : '—'}
                        </td>
                      )
                    })}
                    <td style={{ ...td, textAlign: 'center' }}>
                      <button onClick={() => setModal({ open: true, preset: r })} title="Revise this state"
                        style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6, border: `1px solid ${C.border}`, background: TK.surface, color: C.purpleD, cursor: 'pointer' }}>Revise</button>
                    </td>
                  </tr>
                )
              })}
              {!loading && sorted.length === 0 && (
                <tr><td colSpan={16} style={{ padding: 24, textAlign: 'center', color: C.muted }}>
                  No LWF states configured yet. Click <b>+ Add / revise state</b> to add the first one.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  return (
    <div style={{ fontFamily: font, fontSize: 13, maxWidth: 1200 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: `linear-gradient(135deg,${TK.brand},${TK.brand})`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, boxShadow: '0 3px 10px rgba(37,99,235,0.28)' }}></div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 19, fontWeight: 800, color: C.navy, lineHeight: 1.1 }}>Labour Welfare Fund Configuration</div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>
            {loading ? 'Loading…' : `${sorted.length} states — employee and employer contribution shown separately`}
          </div>
        </div>
        <button onClick={() => setModal({ open: true, preset: null })}
          style={{ padding: '10px 16px', borderRadius: 9, border: 'none', background: `linear-gradient(120deg,${TK.brand},${TK.brand})`, color: TK.onAccent, fontWeight: 700, fontSize: 13, cursor: 'pointer', boxShadow: '0 3px 10px rgba(37,99,235,0.22)', whiteSpace: 'nowrap' }}>
          + Add / revise state
        </button>
      </div>

      {error && <div style={{ fontSize: 12, color: C.amber, background: C.amberBg, border: `1px solid ${TK.warningTint}`, padding: '10px 12px', borderRadius: 9, marginBottom: 12 }}>{error}</div>}

      {/* ── Quick check ─────────────────────────────────────────── */}
      <div style={card}>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.navy, marginBottom: 3 }}>Quick check</div>
        <div style={{ fontSize: 11, color: C.muted, marginBottom: 13 }}>
          Pick a state and month — optionally mark a mid-month exit. Same function the payroll run calls.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr)) auto auto', gap: 10, alignItems: 'end' }}>
          <div>
            <label style={labelStyle}>State</label>
            <SearchSelect value={qState} options={sorted.map(r => r.state)} placeholder="Select state"
              onChange={v => { setQState(v); setQRes(null) }} />
          </div>
          <div>
            <label style={labelStyle}>Month</label>
            <select style={inputStyle} value={qMonth} onChange={e => { setQMonth(Number(e.target.value)); setQRes(null) }}>
              {MONTH_NAMES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: C.navy, cursor: 'pointer', paddingBottom: 9, whiteSpace: 'nowrap' }}>
            <input type="checkbox" checked={qExit} onChange={e => { setQExit(e.target.checked); setQRes(null) }}
              style={{ accentColor: C.purple, width: 15, height: 15 }} />
            Exiting mid-month
          </label>
          <button onClick={runCheck} disabled={qBusy || !qState}
            style={{ padding: '9px 18px', borderRadius: 8, border: 'none', fontFamily: font, fontSize: 13, fontWeight: 700, color: TK.onAccent, whiteSpace: 'nowrap', background: !qState ? TK.brandTint : C.purple, cursor: !qState ? 'not-allowed' : 'pointer' }}>
            {qBusy ? 'Checking…' : 'Check LWF'}
          </button>
        </div>

        {qErr && <div style={{ marginTop: 12, fontSize: 12, color: C.red, background: C.redBg, borderRadius: 8, padding: '9px 11px' }}>{qErr}</div>}

        {qRes && (() => {
          const found = !!qRes.rate_found
          const ee = Number(qRes.employee_contribution ?? 0)
          const er = Number(qRes.employer_contribution ?? 0)
          const why = !found ? `${qState} is not in lwf_config — payroll deducts nothing and flags it.`
            : qRes.is_exempt_due_to_exit ? `Exempt — left before the period ended, and ${qState} allows that.`
              : !qRes.is_month_applicable ? `${qState} has no LWF deduction in ${MONTH_NAMES[qMonth - 1]}.`
                : `${MONTH_NAMES[qMonth - 1]} is a deduction month in ${qState}.`
          const box: React.CSSProperties = {
            flex: 1, minWidth: 150, borderRadius: 10, padding: '13px 15px',
            background: found ? TK.positiveTint : C.amberBg,
            border: `1px solid ${found ? TK.positiveTint : TK.warningTint}`,
          }
          return (
            <div style={{ marginTop: 13 }}>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <div style={box}>
                  <div style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '.04em' }}>Employee contribution</div>
                  <div style={{ fontSize: 24, fontWeight: 800, color: found ? C.green : C.amber }}>{found ? `₹${ee}` : '—'}</div>
                </div>
                <div style={box}>
                  <div style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '.04em' }}>Employer contribution</div>
                  <div style={{ fontSize: 24, fontWeight: 800, color: found ? C.green : C.amber }}>{found ? `₹${er}` : '—'}</div>
                </div>
              </div>
              <div style={{ fontSize: 12, color: found ? '#047857' : TK.warning, marginTop: 8 }}>{why}</div>
            </div>
          )
        })()}
      </div>

      {loading ? (
        <div style={{ fontSize: 12, color: C.purple, padding: 8 }}>Loading…</div>
      ) : (
        <>
          <Grid side="employee" />
          <Grid side="employer" />
        </>
      )}

      <div style={{ fontSize: 11, color: C.purpleD, background: C.purpleBg, borderRadius: 9, padding: '11px 13px', lineHeight: 1.6 }}>
        <b>This table is payroll&apos;s only source.</b> Run Payroll reads every employee&apos;s LWF from here — by their
        <b> lwf_state</b> and that month. Note that LWF state and PT state are <b>different</b> things, and for
        300 of your 302 employees they genuinely differ.
        <br />LWF is a <b>flat monthly</b> amount — gross and paid days make no difference to it. Revising does not
        delete the old row, it closes it; so re-running an earlier month applies the rate that was in force then.
      </div>

      {modal.open && <ReviseModal preset={modal.preset} onClose={() => setModal({ open: false })} onSaved={() => { setModal({ open: false }); load() }} />}
    </div>
  )
}
