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
import { C, F, W, S, numeric, IconPlus, IconFinance, IconCalendar } from '@/lib/ui'
import { SectionCard, InfoCallout, PButton, StatusPill, CountChip, EmptyState, DataTable, dt, IconInfo } from '@/components/payroll/kit'
import { RuleSummary, CField, FormGrid, Modal, StateSelect, cfgInput } from '@/components/payroll/configKit'

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
    <Modal icon={<IconFinance size={17} />} title={preset ? 'Revise zone rates' : 'Add zone rates'} subtitle="All 4 categories, one w.e.f date" maxWidth={580}
      footer={<>
        <PButton variant="primary" onClick={handleSave} disabled={!valid || saving} style={{ flex: 1 }}>{saving ? 'Saving…' : 'Save all 4 rates'}</PButton>
        <PButton variant="secondary" onClick={onClose}>Cancel</PButton>
      </>}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr)', gap: S.md }}>
        <CField as="div" label="State" required><StateSelect value={state} options={INDIAN_STATES} placeholder="Select state" onChange={setState} /></CField>
        <CField label="Zone" required><input value={zone} onChange={e => setZone(e.target.value)} placeholder="ALL / Zone 1" style={cfgInput} /></CField>
      </div>

      <div style={{ fontSize: F.tiny, fontWeight: W.bold, color: C.muted, textTransform: 'uppercase', letterSpacing: '.09em', marginTop: 4 }}>Rates for this zone (₹/month)</div>
      <FormGrid min={110} gap={S.sm}>
        <CField label="Unskilled" required><input type="number" value={unskilled} onChange={e => setUnskilled(e.target.value)} style={cfgInput} /></CField>
        <CField label="Semi-skilled" required><input type="number" value={semiSkilled} onChange={e => setSemiSkilled(e.target.value)} style={cfgInput} /></CField>
        <CField label="Skilled" required><input type="number" value={skilled} onChange={e => setSkilled(e.target.value)} style={cfgInput} /></CField>
        <CField label="Highly skilled" required><input type="number" value={highlySkilled} onChange={e => setHighlySkilled(e.target.value)} style={cfgInput} /></CField>
      </FormGrid>

      <FormGrid min={200}>
        <CField label="W.e.f date" required><input type="date" value={effectiveFrom} onChange={e => setEffectiveFrom(e.target.value)} style={cfgInput} /></CField>
        <CField label="Notification reference"><input value={notificationRef} onChange={e => setNotificationRef(e.target.value)} placeholder="HR/Labour/2026/078" style={cfgInput} /></CField>
      </FormGrid>

      <InfoCallout t="neutral" compact icon={<IconInfo size={14} />} style={{ marginBottom: 0 }}>
        All 4 categories for this state + zone update together with this one w.e.f date. The previous rates are automatically closed off the day before. Overlapping validity is rejected by the database itself.
      </InfoCallout>

      {err && <InfoCallout t="critical" compact style={{ marginBottom: 0 }}>{err}</InfoCallout>}
    </Modal>
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
    catch (e: any) { setError(e.message || 'Could not load rates. Run sql67 + sql68 first.') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const inr = (n: number | null) => n == null ? '-' : `₹${Number(n).toLocaleString('en-IN')}`

  const states = new Set(rows.map(r => r.state)).size

  return (
    <div style={{ fontFamily: F.family, fontSize: F.small, color: C.ink, minWidth: 0 }}>
      <RuleSummary icon={<IconFinance size={20} />} eyebrow="Statutory · Minimum wages" title="Minimum Wages"
        rule={<>State &amp; zone-wise statutory floor · one state can have multiple zones, each tracked independently</>}
        meta={!loading ? <><CountChip t="brand">{states} states</CountChip><CountChip>{rows.length} zones</CountChip></> : undefined}
        actions={<PButton variant="primary" icon={<IconPlus size={15} />} onClick={() => setModal({ open: true, preset: null })}>Add / revise zone</PButton>} />

      {error && <InfoCallout t="warning" compact>{error}</InfoCallout>}

      <SectionCard title="Rates in force" icon={<IconCalendar size={16} />} hint="Monthly rate per skill category, with the date the latest notification took effect." flush>
        <DataTable minWidth={720} maxHeight={600}>
          <thead>
            <tr>
              {['State', 'Zone', 'Unskilled', 'Semi-skilled', 'Skilled', 'Highly skilled', 'W.e.f', ''].map((h, i) => (
                <th key={i} style={i >= 2 && i <= 5 ? dt.thNum : dt.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={`${r.state}-${r.zone}`} className={dt.rowClass}>
                <td style={dt.tdStrong}>{r.state}</td>
                <td style={dt.td}><StatusPill t="brand" size="sm">{r.zone}</StatusPill></td>
                <td style={dt.tdNum}>{inr(r.unskilled)}</td>
                <td style={dt.tdNum}>{inr(r.semi_skilled)}</td>
                <td style={dt.tdNum}>{inr(r.skilled)}</td>
                <td style={dt.tdNum}>{inr(r.highly_skilled)}</td>
                <td style={{ ...dt.td, whiteSpace: 'nowrap', ...numeric }}>
                  {new Date(r.latest_effective_from).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                  {!r.single_effective_date && (
                    <span title="The 4 categories currently have different effective dates" style={{ marginLeft: 6 }}><StatusPill t="warning" size="sm">mixed dates</StatusPill></span>
                  )}
                </td>
                <td style={{ ...dt.td, textAlign: 'right' }}>
                  <PButton size="sm" variant="ghost" onClick={() => setModal({ open: true, preset: r })} title="Revise this zone" style={{ height: 26 }}>Revise</PButton>
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
        {!loading && rows.length === 0 && <EmptyState compact title="No zones configured yet." hint="Click + Add / revise zone to add the first rate." />}
        {loading && <EmptyState compact t="neutral" icon={<IconCalendar size={20} />} title="Loading rates…" />}
      </SectionCard>

      {modal.open && <ZoneFormModal preset={modal.preset} onClose={() => setModal({ open: false })} onSaved={() => { setModal({ open: false }); load() }} />}
    </div>
  )
}
