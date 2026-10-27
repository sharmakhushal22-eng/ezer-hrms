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
import { C, F, W, S, R, Z, numeric, IconPlus, IconCompliance, IconSearch, IconUser, IconBuilding, IconCalendar } from '@/lib/ui'
import { SectionCard, InfoCallout, PButton, StatusPill, EmptyState, KpiTile, DataTable, dt, IconInfo } from '@/components/payroll/kit'
import { RuleSummary, CField, FormGrid, Modal, StateSelect, CheckRow, QuickButton, cfgInput } from '@/components/payroll/configKit'

function MonthPicker({ selected, onToggle }: { selected: number[]; onToggle: (m: number) => void }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: 6 }}>
      {MONTH_NAMES.map((name, i) => {
        const m = i + 1
        const active = selected.includes(m)
        return (
          <button key={m} onClick={() => onToggle(m)} type="button" aria-pressed={active} className="ez-press"
            style={{
              height: 34, borderRadius: R.sm, fontFamily: 'inherit', fontSize: F.tiny, fontWeight: W.semi, cursor: 'pointer',
              border: `1px solid ${active ? C.brand : C.lineStrong}`, background: active ? C.brand : C.surface,
              color: active ? C.onAccent : C.inkSoft,
            }}>
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

  return (
    <Modal icon={<IconCompliance size={17} />} title={preset ? 'Revise LWF config' : 'Add LWF state'} subtitle="Applicable months + contributions" maxWidth={540}
      footer={<>
        <PButton variant="primary" onClick={handleSave} disabled={!valid || saving} style={{ flex: 1 }}>{saving ? 'Saving…' : 'Save'}</PButton>
        <PButton variant="secondary" onClick={onClose}>Cancel</PButton>
      </>}>
      <CField as="div" label="State" required>
        <StateSelect value={state} options={INDIAN_STATES} placeholder="Select state" onChange={setState} />
      </CField>

      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: S.sm, flexWrap: 'wrap', marginBottom: 7 }}>
          <span style={{ fontSize: F.tiny, fontWeight: W.semi, color: C.inkSoft }}>Applicable months<span style={{ color: C.critical, marginLeft: 3 }}>*</span></span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <QuickButton onClick={() => setMonths([1,2,3,4,5,6,7,8,9,10,11,12])}>Monthly</QuickButton>
            <QuickButton onClick={() => setMonths([6, 12])}>Jun + Dec</QuickButton>
            <QuickButton onClick={() => setMonths([12])}>Dec only</QuickButton>
          </div>
        </div>
        <MonthPicker selected={months} onToggle={toggleMonth} />
      </div>

      <FormGrid min={180}>
        <CField label="Employee contribution (₹)" required><input type="number" value={empContrib} onChange={e => setEmpContrib(e.target.value)} style={cfgInput} /></CField>
        <CField label="Employer contribution (₹)" required><input type="number" value={erContrib} onChange={e => setErContrib(e.target.value)} style={cfgInput} /></CField>
      </FormGrid>

      <CheckRow well checked={exitExemption} onChange={e => setExitExemption(e.target.checked)}>
        Exempt employees who left before the last day of an applicable month (Haryana-style rule, also fits half-yearly states like Maharashtra, exempting anyone who resigned before the 30 Jun / 31 Dec cutoff).
      </CheckRow>

      <FormGrid min={180}>
        <CField label="Effective from" required><input type="date" value={effectiveFrom} onChange={e => setEffectiveFrom(e.target.value)} style={cfgInput} /></CField>
        <CField label="Notification reference"><input value={notificationRef} onChange={e => setNotificationRef(e.target.value)} placeholder="LWF/2026/…" style={cfgInput} /></CField>
      </FormGrid>

      {err && <InfoCallout t="critical" compact style={{ marginBottom: 0 }}>{err}</InfoCallout>}
    </Modal>
  )
}

// One grid, rendered twice — once for each side of the contribution. A dash rather
// than a zero in the off months: zero reads as "we calculated nothing", a dash reads
// as "this month is not a deduction month", which is what it actually means.
// Top-level (not nested in LwfConfig) so it is a stable component between renders.
function LwfGrid({ side, rows, loading, hitState, onRevise }: {
  side: 'employee' | 'employer'; rows: LwfRow[]; loading: boolean
  /** The state the Quick check last resolved — its row is highlighted. '' for none. */
  hitState: string
  onRevise: (r: LwfRow) => void
}) {
  const isEmp = side === 'employee'
  const stateCol: React.CSSProperties = { position: 'sticky', left: 0, zIndex: Z.raised }
  return (
    <SectionCard flush
      icon={isEmp ? <IconUser size={16} /> : <IconBuilding size={16} />} iconTone={isEmp ? 'brand' : 'positive'}
      title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <StatusPill t={isEmp ? 'brand' : 'positive'} size="sm">{isEmp ? 'EMPLOYEE' : 'EMPLOYER'}</StatusPill>Contribution Table
      </span>}
      hint={isEmp
        ? 'Deducted from the employee’s salary, by state and month. “-” means no deduction that month.'
        : 'Paid by the company on top, by state and month. Usually the larger of the two.'}>
      <DataTable minWidth={900} maxHeight={520}>
        <thead>
          <tr>
            <th style={{ ...dt.th, ...stateCol, zIndex: Z.sticky }}>State</th>
            <th style={dt.th}>Exit Exempt?</th>
            {MONTH_NAMES.map(m => <th key={m} style={{ ...dt.thNum, padding: '9px 8px' }}>{m}</th>)}
            <th style={dt.th}></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const amt = Number(isEmp ? r.employee_contribution : r.employer_contribution) || 0
            const hit = !!hitState && hitState === r.state
            const bg = hit ? C.warningTint : C.surface
            return (
              <tr key={r.id} className={dt.rowClass} style={{ background: hit ? C.warningTint : undefined, outline: hit ? `2px solid ${C.warning}` : 'none', outlineOffset: -2 }}>
                <td style={{ ...dt.tdStrong, ...stateCol, background: bg, whiteSpace: 'nowrap' }}>{r.state}</td>
                <td style={dt.td}>
                  <StatusPill size="sm" t={r.exit_exemption_if_before_period_end ? 'positive' : 'neutral'}>{r.exit_exemption_if_before_period_end ? 'Yes' : 'No'}</StatusPill>
                </td>
                {MONTH_NAMES.map((m, mi) => {
                  const on = (r.applicable_months || []).includes(mi + 1)
                  return (
                    <td key={m} style={{ ...dt.tdNum, padding: '9px 8px', color: on ? C.ink : C.faint, fontWeight: on ? W.bold : W.regular }}>
                      {on ? amt : '-'}
                    </td>
                  )
                })}
                <td style={{ ...dt.td, textAlign: 'center' }}>
                  <PButton size="sm" variant="ghost" onClick={() => onRevise(r)} title="Revise this state" style={{ height: 26 }}>Revise</PButton>
                </td>
              </tr>
            )
          })}
        </tbody>
      </DataTable>
      {!loading && rows.length === 0 && (
        <EmptyState compact title="No LWF states configured yet." hint="Click + Add / revise state to add the first one." />
      )}
    </SectionCard>
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
    catch (e: any) { setError(e.message || 'Could not load. Run sql69 first.') }
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
        ? 'calculate_lwf_deduction() is not in this database yet. Run sql69, then sql110.'
        : (e?.message || String(e)))
    } finally { setQBusy(false) }
  }

  const sorted = [...rates].sort((a, b) => a.state.localeCompare(b.state))

  return (
    <div style={{ fontFamily: F.family, fontSize: F.small, color: C.ink, minWidth: 0 }}>
      <RuleSummary icon={<IconCompliance size={20} />} eyebrow="Statutory · Labour Welfare Fund" title="Labour Welfare Fund Configuration"
        rule={loading ? 'Loading…' : `${sorted.length} states · employee and employer contribution shown separately`}
        actions={<PButton variant="primary" icon={<IconPlus size={15} />} onClick={() => setModal({ open: true, preset: null })}>Add / revise state</PButton>} />

      {error && <InfoCallout t="warning" compact>{error}</InfoCallout>}

      {/* ── Quick check ─────────────────────────────────────────── */}
      <SectionCard title="Quick check" icon={<IconSearch size={16} />}
        hint="Pick a state and month, optionally mark a mid-month exit. Same function the payroll run calls."
        style={{ overflow: 'visible' }} bodyStyle={{ display: 'flex', flexDirection: 'column', gap: S.md + 2 }}>
        <div style={{ display: 'flex', gap: S.md, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <CField as="div" label="State" style={{ flex: '1 1 200px' }}>
            <StateSelect value={qState} options={sorted.map(r => r.state)} placeholder="Select state"
              onChange={v => { setQState(v); setQRes(null) }} />
          </CField>
          <CField label="Month" style={{ flex: '1 1 150px' }}>
            <select style={{ ...cfgInput, cursor: 'pointer' }} value={qMonth} onChange={e => { setQMonth(Number(e.target.value)); setQRes(null) }}>
              {MONTH_NAMES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          </CField>
          <div style={{ paddingBottom: 9 }}>
            <CheckRow checked={qExit} onChange={e => { setQExit(e.target.checked); setQRes(null) }}><span style={{ whiteSpace: 'nowrap', color: C.ink }}>Exiting mid-month</span></CheckRow>
          </div>
          <PButton variant="primary" onClick={runCheck} disabled={qBusy || !qState} style={{ height: 38 }}>
            {qBusy ? 'Checking…' : 'Check LWF'}
          </PButton>
        </div>

        {qErr && <InfoCallout t="critical" compact style={{ marginBottom: 0 }}>{qErr}</InfoCallout>}

        {qRes && (() => {
          const found = !!qRes.rate_found
          const ee = Number(qRes.employee_contribution ?? 0)
          const er = Number(qRes.employer_contribution ?? 0)
          const why = !found ? `${qState} is not in lwf_config, so payroll deducts nothing and flags it.`
            : qRes.is_exempt_due_to_exit ? `Exempt: left before the period ended, and ${qState} allows that.`
              : !qRes.is_month_applicable ? `${qState} has no LWF deduction in ${MONTH_NAMES[qMonth - 1]}.`
                : `${MONTH_NAMES[qMonth - 1]} is a deduction month in ${qState}.`
          return (
            <div className="ez-rise" style={{ display: 'flex', flexDirection: 'column', gap: S.sm + 2 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))', gap: S.md }}>
                <KpiTile label="Employee contribution" value={found ? `₹${ee}` : '-'} t={found ? 'positive' : 'warning'} icon={<IconUser size={15} />} />
                <KpiTile label="Employer contribution" value={found ? `₹${er}` : '-'} t={found ? 'positive' : 'warning'} icon={<IconBuilding size={15} />} />
              </div>
              <InfoCallout t={found ? 'positive' : 'warning'} compact style={{ marginBottom: 0 }}>{why}</InfoCallout>
            </div>
          )
        })()}
      </SectionCard>

      {loading ? (
        <SectionCard><EmptyState compact t="neutral" icon={<IconCalendar size={20} />} title="Loading…" /></SectionCard>
      ) : (
        <>
          <LwfGrid side="employee" rows={sorted} loading={loading} hitState={qRes ? qState : ''} onRevise={r => setModal({ open: true, preset: r })} />
          <LwfGrid side="employer" rows={sorted} loading={loading} hitState={qRes ? qState : ''} onRevise={r => setModal({ open: true, preset: r })} />
        </>
      )}

      <InfoCallout t="info" icon={<IconInfo size={18} />} title="This table is payroll's only source.">
        Run Payroll reads every employee&apos;s LWF from here, by their
        <b> lwf_state</b> and that month. Note that LWF state and PT state are <b>different</b> things, and for
        300 of your 302 employees they genuinely differ.
        <br />LWF is a <b>flat monthly</b> amount. Gross and paid days make no difference to it. Revising does not
        delete the old row, it closes it; so re-running an earlier month applies the rate that was in force then.
      </InfoCallout>

      {modal.open && <ReviseModal preset={modal.preset} onClose={() => setModal({ open: false })} onSaved={() => { setModal({ open: false }); load() }} />}
    </div>
  )
}
