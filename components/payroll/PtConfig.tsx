'use client'
// components/payroll/PtConfig.tsx — Professional Tax configuration.
// Reached from Configuration → PT Slabs and from Statutory & Tax → Professional Tax;
// both render this one component, because two PT screens would eventually disagree and
// whichever one HR happened to open would decide what they believed.
//
// Two halves: a Quick check that resolves a single employee's PT, and the full month-wise
// grid of every state and slab. A column per month rather than one "monthly amount",
// because PT is not flat across the year — Maharashtra charges ₹300 in February,
// Tamil Nadu and Kerala bill twice a year and nothing in the other ten months.
//
// Quick check calls get_pt_amount(), the same function sync_month_pt() uses during a
// payroll run, so this screen cannot show ₹200 while the run deducts ₹300. Its
// rate_found flag carries the distinction that matters: ₹0 means the state levies no PT,
// null means the state was never configured. Reading the second as the first is what let
// 92 employees be charged for a tax their state does not have.
import { useState, useEffect, useCallback } from 'react'
import { getCurrentPtSlabs, reviseSlab, getPtAmount } from '@/lib/pt/actions'
import { MONTH_KEYS, MONTH_LABELS } from '@/lib/pt/types'
import type { PtConfig as PtRow, Gender } from '@/lib/pt/types'
import { INDIAN_STATES } from '@/lib/geo/india-states-districts'
import { C, F, W, S, Z, numeric, IconPlus, IconCompliance, IconSearch, IconCalendar, IconReceipt } from '@/lib/ui'
import { SectionCard, InfoCallout, PButton, StatusPill, EmptyState, DataTable, dt, IconInfo } from '@/components/payroll/kit'
import { RuleSummary, CField, FormGrid, Modal, StateSelect, QuickButton, ResultWell, cfgInput } from '@/components/payroll/configKit'

function summarizeMonths(r: PtRow): string {
  const amts = [r.jan,r.feb,r.mar,r.apr,r.may,r.jun,r.jul,r.aug,r.sep,r.oct,r.nov,r.dec].map(Number)
  const uniq = Array.from(new Set(amts))
  if (uniq.length === 1) return uniq[0] === 0 ? 'Exempt (₹0)' : `₹${uniq[0]} every month`
  const nonZeroMonths = amts.map((a, i) => a > 0 ? MONTH_LABELS[i] : null).filter(Boolean)
  const zeroCount = amts.filter(a => a === 0).length
  if (zeroCount >= 10) return `₹${Math.max(...amts)}, only ${nonZeroMonths.join(', ')}`
  return `Varies (peak ₹${Math.max(...amts)})`
}
function slabLabel(r: PtRow): string {
  const min = Number(r.slab_min).toLocaleString('en-IN')
  return r.slab_max != null ? `₹${min}–${Number(r.slab_max).toLocaleString('en-IN')}` : `₹${min}+`
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

  const setSame = () => { const v = amounts.find(a => a) || '200'; setAmounts(Array(12).fill(v)) }
  const setTwice = () => { const v = amounts.find((a, i) => (i === 2 || i === 8) && a) || amounts.find(a => a) || '300'; setAmounts(MONTH_LABELS.map((m) => (m === 'Mar' || m === 'Sep') ? v : '0')) }

  return (
    <Modal icon={<IconReceipt size={17} />} title={preset ? 'Revise PT slab' : 'Add PT slab'} subtitle="Salary band + per-month amount" maxWidth={620}
      footer={<>
        <PButton variant="primary" onClick={handleSave} disabled={!valid || saving} style={{ flex: 1 }}>{saving ? 'Saving…' : 'Save slab'}</PButton>
        <PButton variant="secondary" onClick={onClose}>Cancel</PButton>
      </>}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,2fr) repeat(3, minmax(0,1fr))', gap: S.sm + 2 }}>
        <CField as="div" label="State" required><StateSelect value={state} options={INDIAN_STATES} placeholder="Select state" onChange={setState} /></CField>
        <CField label="Slab min (₹)" required><input type="number" value={slabMin} onChange={e => setSlabMin(e.target.value)} style={cfgInput} /></CField>
        <CField label="Slab max (₹)"><input type="number" value={slabMax} onChange={e => setSlabMax(e.target.value)} placeholder="blank = +" style={cfgInput} /></CField>
        <CField label="Gender">
          <select value={gender} onChange={e => setGender(e.target.value as Gender)} style={{ ...cfgInput, cursor: 'pointer' }}>
            <option value="ALL">All</option><option value="MALE">Male only</option><option value="FEMALE">Female only</option>
          </select>
        </CField>
      </div>

      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: S.sm, flexWrap: 'wrap', marginBottom: 7 }}>
          <span style={{ fontSize: F.tiny, fontWeight: W.semi, color: C.inkSoft }}>Amount per month (₹)<span style={{ color: C.critical, marginLeft: 3 }}>*</span></span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <QuickButton onClick={setSame}>Same all months</QuickButton>
            <QuickButton onClick={setTwice}>Only Mar + Sep</QuickButton>
            <QuickButton onClick={() => setAmounts(Array(12).fill('0'))}>Clear</QuickButton>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: 6 }}>
          {MONTH_LABELS.map((m, i) => (
            <label key={m} style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
              <span style={{ fontSize: F.micro, fontWeight: W.semi, color: C.muted, textAlign: 'center' }}>{m}</span>
              <input type="number" value={amounts[i]} onChange={e => setAmounts(prev => prev.map((v, j) => j === i ? e.target.value : v))}
                style={{ ...cfgInput, padding: '0 4px', textAlign: 'center' }} />
            </label>
          ))}
        </div>
      </div>
      <InfoCallout t="neutral" compact icon={<IconInfo size={14} />} style={{ marginBottom: 0 }}>
        Use <b>Only Mar + Sep</b> for twice-yearly states (Tamil Nadu, Kerala). For Maharashtra&apos;s annual-cap adjustment, set February higher than the other months directly.
      </InfoCallout>

      <FormGrid min={200}>
        <CField label="Effective from" required><input type="date" value={effectiveFrom} onChange={e => setEffectiveFrom(e.target.value)} style={cfgInput} /></CField>
        <CField label="Notification reference"><input value={notificationRef} onChange={e => setNotificationRef(e.target.value)} placeholder="PT/2026/…" style={cfgInput} /></CField>
      </FormGrid>

      {err && <InfoCallout t="critical" compact style={{ marginBottom: 0 }}>{err}</InfoCallout>}
    </Modal>
  )
}

export default function PtConfig() {
  const [slabs, setSlabs] = useState<PtRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [modal, setModal] = useState<{ open: boolean; preset?: PtRow | null }>({ open: false })

  // Quick check
  const [qState, setQState] = useState('')
  const [qMonth, setQMonth] = useState('apr')
  const [qGross, setQGross] = useState('')
  const [qBusy, setQBusy] = useState(false)
  const [qErr, setQErr] = useState('')
  const [qRes, setQRes] = useState<{ amount: number | null; found: boolean; row: PtRow | null } | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { setSlabs(await getCurrentPtSlabs()) }
    catch (e: any) { setError(e.message || 'Could not load. Run sql70 first.') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const states = Array.from(new Set(slabs.map(s => s.state))).sort()

  // A state whose every month is zero in every slab levies no PT at all. Said out loud on
  // the row, because a column of zeros otherwise reads as missing data and somebody
  // eventually "fixes" it by typing 200 in.
  const noPt = new Set(
    states.filter(st => slabs.filter(s => s.state === st)
      .every(s => MONTH_KEYS.every(m => Number((s as any)[m]) === 0))))

  async function runCheck() {
    if (!qState || qGross.trim() === '') return
    setQBusy(true); setQErr(''); setQRes(null)
    try {
      // Calendar date for the chosen month — get_pt_amount reads the month off the date,
      // so the year only has to be one the slab's validity range covers.
      const mi = MONTH_KEYS.indexOf(qMonth as any) + 1
      const r = await getPtAmount({
        state: qState, grossSalary: Number(qGross) || 0,
        periodMonth: `2026-${String(mi).padStart(2, '0')}-01`, gender: 'ALL',
      })
      const g = Number(qGross) || 0
      const row = slabs.find(s => s.state === qState && g >= Number(s.slab_min)
        && (s.slab_max == null || g <= Number(s.slab_max))) || null
      setQRes({ amount: r?.pt_amount ?? null, found: !!r?.rate_found, row })
    } catch (e: any) {
      setQErr(/could not find the function/i.test(e?.message || '')
        ? 'get_pt_amount() is not in this database yet. Run sql108, then sql109.'
        : (e?.message || String(e)))
    } finally { setQBusy(false) }
  }

  const stateCol: React.CSSProperties = { position: 'sticky', left: 0, zIndex: Z.raised }
  const mLabel = MONTH_LABELS[MONTH_KEYS.indexOf(qMonth as any)]

  return (
    <div style={{ fontFamily: F.family, fontSize: F.small, color: C.ink, minWidth: 0 }}>
      <RuleSummary icon={<IconCompliance size={20} />} eyebrow="Statutory · Professional Tax" title="Professional Tax Configuration"
        rule={loading ? 'Loading…' : `${states.length} states, ${slabs.length} slabs · exactly what the payroll run reads`}
        actions={<PButton variant="primary" icon={<IconPlus size={15} />} onClick={() => setModal({ open: true, preset: null })}>Add / revise slab</PButton>} />

      {error && <InfoCallout t="warning" compact>{error}</InfoCallout>}

      {/* ── Quick check ─────────────────────────────────────────── */}
      <SectionCard title="Quick check" icon={<IconSearch size={16} />}
        hint="Pick a state, month and gross to see exactly which row payroll will use. Same function the run calls."
        style={{ overflow: 'visible' }} bodyStyle={{ display: 'flex', flexDirection: 'column', gap: S.md + 2 }}>
        <div style={{ display: 'flex', gap: S.md, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <CField as="div" label="State" style={{ flex: '1 1 200px' }}>
            <StateSelect value={qState} options={states} placeholder="Select state"
              onChange={v => { setQState(v); setQRes(null) }} />
          </CField>
          <CField label="Month" style={{ flex: '1 1 140px' }}>
            <select style={{ ...cfgInput, cursor: 'pointer' }} value={qMonth} onChange={e => { setQMonth(e.target.value); setQRes(null) }}>
              {MONTH_KEYS.map((m, i) => <option key={m} value={m}>{MONTH_LABELS[i]}</option>)}
            </select>
          </CField>
          <CField label="Gross Salary" style={{ flex: '1 1 160px' }}>
            <input style={cfgInput} type="number" value={qGross} placeholder="e.g. 22000"
              onChange={e => { setQGross(e.target.value); setQRes(null) }} />
          </CField>
          <PButton variant="primary" onClick={runCheck} disabled={qBusy || !qState || qGross.trim() === ''} style={{ height: 38 }}>
            {qBusy ? 'Checking…' : 'Check PT'}
          </PButton>
        </div>

        {qErr && <InfoCallout t="critical" compact style={{ marginBottom: 0 }}>{qErr}</InfoCallout>}

        {qRes && (
          <ResultWell t={qRes.found ? 'positive' : 'warning'}>
            <div style={{ fontSize: F.display, fontWeight: W.bold, letterSpacing: '-.02em', lineHeight: 1.1, color: qRes.found ? C.positive : C.warning, ...numeric }}>
              {qRes.found ? `₹${Number(qRes.amount ?? 0).toLocaleString('en-IN')}` : 'Not configured'}
            </div>
            <div style={{ fontSize: F.small, color: C.inkSoft, marginTop: -6, ...numeric }}>
              {!qRes.found
                ? `${qState} has no slab covering ₹${Number(qGross).toLocaleString('en-IN')}, so payroll deducts nothing and flags it.`
                : Number(qRes.amount) === 0
                  ? (noPt.has(qState)
                    ? `${qState} does not levy Professional Tax at all.`
                    : `${qState} levies PT, but nothing is due in ${mLabel} for this slab.`)
                  : `${qRes.row ? slabLabel(qRes.row) : 'slab'} · ${mLabel}`}
            </div>
            {qRes.row?.notification_reference && (
              <div style={{ fontSize: F.tiny, color: C.muted, marginTop: -6 }}>{qRes.row.notification_reference}</div>
            )}
          </ResultWell>
        )}
      </SectionCard>

      {/* ── Full grid ───────────────────────────────────────────── */}
      <SectionCard flush title="Full configuration table" icon={<IconCalendar size={16} />}
        hint={<>Every state, slab and month-wise amount. A <b>no PT</b> badge means the state levies none at all.
          That row exists on purpose, so a state with no tax can be told apart from a state nobody configured.</>}>
        {loading ? (
          <EmptyState compact t="neutral" icon={<IconCalendar size={20} />} title="Loading…" />
        ) : (
          <>
            <DataTable minWidth={1040} maxHeight={560}>
              <thead>
                <tr>
                  <th style={{ ...dt.th, ...stateCol, zIndex: Z.sticky }}>State</th>
                  <th style={dt.thNum}>Min Salary</th>
                  <th style={dt.thNum}>Max Salary</th>
                  <th style={dt.th}>Gender</th>
                  {MONTH_LABELS.map(m => <th key={m} style={{ ...dt.thNum, padding: '9px 8px' }}>{m}</th>)}
                  <th style={dt.th}></th>
                </tr>
              </thead>
              <tbody>
                {slabs.map(r => {
                  const hit = !!qRes?.row && qRes.row.id === r.id
                  return (
                    <tr key={r.id} className={dt.rowClass} style={{ background: hit ? C.warningTint : undefined, outline: hit ? `2px solid ${C.warning}` : 'none', outlineOffset: -2 }}>
                      <td style={{ ...dt.tdStrong, ...stateCol, background: hit ? C.warningTint : C.surface, whiteSpace: 'nowrap' }}>
                        {r.state}
                        {noPt.has(r.state) && <span style={{ marginLeft: 6 }}><StatusPill t="positive" size="sm">no PT</StatusPill></span>}
                      </td>
                      <td style={dt.tdNum}>{Number(r.slab_min).toLocaleString('en-IN')}</td>
                      <td style={{ ...dt.tdNum, color: r.slab_max == null ? C.faint : C.ink }}>{r.slab_max == null ? '-' : Number(r.slab_max).toLocaleString('en-IN')}</td>
                      <td style={dt.td}>
                        {r.gender === 'ALL' ? <span style={{ color: C.muted }}>{r.gender}</span> : <StatusPill t="warning" size="sm">{r.gender}</StatusPill>}
                      </td>
                      {MONTH_KEYS.map(m => {
                        const v = Number((r as any)[m]) || 0
                        return <td key={m} style={{ ...dt.tdNum, padding: '9px 8px', color: v === 0 ? C.faint : C.ink, fontWeight: v > 0 ? W.semi : W.regular }}>{v}</td>
                      })}
                      <td style={{ ...dt.td, textAlign: 'center' }}>
                        <PButton size="sm" variant="ghost" onClick={() => setModal({ open: true, preset: r })} title="Revise this slab" style={{ height: 26 }}>Revise</PButton>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </DataTable>
            {!loading && slabs.length === 0 && (
              <EmptyState compact title="No PT slabs configured yet." hint="Click + Add / revise slab to add the first one." />
            )}
          </>
        )}
      </SectionCard>

      <InfoCallout t="info" icon={<IconInfo size={18} />} title="This table is payroll's only source.">
        Run Payroll reads every employee&apos;s PT from here, by their
        <b> state</b>, that month&apos;s <b>column</b> and their <b>gross</b>. No rate is written anywhere in the app,
        so a rate changed here applies to the next run on its own.
        <br />PT is a <b>fixed monthly</b> amount. Taking leave does not reduce it. Revising does not delete the
        old row, it closes it; so re-running an earlier month still applies the rate that was in force then.
      </InfoCallout>

      {modal.open && <ReviseModal preset={modal.preset} onClose={() => setModal({ open: false })} onSaved={() => { setModal({ open: false }); load() }} />}
    </div>
  )
}
