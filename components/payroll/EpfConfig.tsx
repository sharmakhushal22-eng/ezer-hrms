'use client'
// components/payroll/EpfConfig.tsx — Payroll → Configuration → EPF.
// EPF reference (contribution split, EPS cap, EDLI/Admin charges, reduced rate) from
// epf_config (migrations sql76 + sql77) + a live contribution calculator (domestic +
// International Worker) and an EDLI/Admin charges estimate. calculate_epf_contribution /
// calculate_epf_charges are pure (no writes), so calling them here is safe. Inline in config.
import { useState, useEffect, useCallback } from 'react'
import { getCurrentEpfConfig, calculateEpfContribution, calculateEpfCharges } from '@/lib/epf/actions'
import type { EpfConfig as EpfCfg, EpfCalculationResult, EpfChargesResult } from '@/lib/epf/types'
import {
  C, F, W, S, R, numeric,
  IconUser, IconBuilding, IconLoans, IconSliders, IconHeart, IconReceipt, IconCalendar, IconCompliance,
} from '@/lib/ui'
import { SectionCard, KpiTile, KpiGrid, InfoCallout, PButton, StatusPill, SubHead } from '@/components/payroll/kit'
import { RuleSummary, CField, FormGrid, ToggleChip, FigureStrip, ResultWell, cfgInput } from '@/components/payroll/configKit'

const inr = (n: number) => `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`

// Segmented bar visualising the employer's total split into EPS (pension) + EPF-proper.
function SplitBar({ eps, epf }: { eps: number; epf: number }) {
  const total = eps + epf || 1
  const epsPct = Math.round((eps / total) * 100)
  return (
    <div>
      <div style={{ display: 'flex', height: 10, borderRadius: R.pill, overflow: 'hidden', background: C.sunken, gap: 2 }}>
        <div style={{ width: `${epsPct}%`, background: C.info, minWidth: eps > 0 ? 2 : 0, borderRadius: R.pill }} title={`EPS ₹${eps}`} />
        <div style={{ flex: 1, background: C.brand, borderRadius: R.pill }} title={`EPF ₹${epf}`} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: S.md, flexWrap: 'wrap', fontSize: F.tiny, fontWeight: W.semi, color: C.muted, marginTop: 6, ...numeric }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: C.info }} />EPS (pension) {epsPct}%</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: C.brand }} />EPF-proper {100 - epsPct}%</span>
      </div>
    </div>
  )
}

export default function EpfConfig() {
  const [cfg, setCfg] = useState<EpfCfg | null>(null)
  const [error, setError] = useState('')

  const [gross, setGross] = useState('30000')
  const [hra, setHra] = useState('0')
  const [limit, setLimit] = useState('999999999')
  const [reduced, setReduced] = useState(false)
  const [isIw, setIsIw] = useState(false)
  const [hasCoc, setHasCoc] = useState(false)
  const [result, setResult] = useState<EpfCalculationResult | null>(null)

  const [paidDays, setPaidDays] = useState('30')
  const [daysInMonth, setDaysInMonth] = useState('30')
  const [hasMembers, setHasMembers] = useState(true)
  const [charges, setCharges] = useState<EpfChargesResult | null>(null)

  const load = useCallback(async () => {
    setError('')
    try {
      const c = await getCurrentEpfConfig()
      if (!c) setError('No EPF config found. Run sql76 + sql77 first.')
      setCfg(c)
    } catch (e: any) { setError(e.message || 'Could not load. Run sql76 + sql77 first.') }
  }, [])
  useEffect(() => { load() }, [load])

  async function runCalc() {
    try {
      setResult(await calculateEpfContribution({
        grossWage: Number(gross), hra: Number(hra), pfGrossLimit: Number(limit),
        useReducedRate: reduced, isInternationalWorker: isIw, hasCertificateOfCoverage: isIw && hasCoc,
      }))
    } catch (e: any) { setError(e.message) }
  }
  async function runCharges() {
    try {
      setCharges(await calculateEpfCharges({ paidDays: Number(paidDays), daysInMonth: Number(daysInMonth), hasContributingMembers: hasMembers }))
    } catch (e: any) { setError(e.message) }
  }

  return (
    <div style={{ fontFamily: F.family, fontSize: F.small, color: C.ink, minWidth: 0 }}>
      <RuleSummary icon={<IconCompliance size={20} />} eyebrow="Statutory · Provident Fund" title="EPF"
        rule={<>Provident Fund: EPF Wages = Gross − HRA, capped at each employee&apos;s PF limit</>}>
        {cfg && (
          <>
          <SubHead>Contribution split</SubHead>
            <KpiGrid min={170}>
              <KpiTile label="Employee" value={`${cfg.employee_contribution_percent}%`} icon={<IconUser size={15} />} />
              <KpiTile label="Employer" value={`${cfg.employer_contribution_percent}%`} icon={<IconBuilding size={15} />} />
              <KpiTile label="EPS (pension)" value={`${cfg.eps_percent}%`} sub={`capped at ${inr(cfg.eps_max_amount)}`} t="info" icon={<IconLoans size={15} />} />
              <KpiTile label="Reduced rate" value={`${cfg.reduced_rate_percent}%`} sub={`under ${cfg.reduced_rate_headcount_threshold} employees`} t="warning" icon={<IconSliders size={15} />} />
            </KpiGrid>
            <SubHead>Employer charges (on ₹15,000 base, pro-rated)</SubHead>
            <KpiGrid min={170} style={{ marginBottom: 0 }}>
              <KpiTile label="EDLI" value={`${cfg.edli_percent}%`} sub={`max ${inr(cfg.edli_max_amount)}/mo`} icon={<IconHeart size={15} />} />
              <KpiTile label="Admin charges" value={`${cfg.admin_charges_percent}%`} sub={`min ${inr(cfg.admin_charges_minimum)} (${inr(cfg.admin_charges_minimum_no_members)} if nil)`} icon={<IconReceipt size={15} />} />
              <KpiTile label="IW-1 return" value={`${cfg.iw_return_due_days} days`} sub="after month-end" t="info" icon={<IconCalendar size={15} />} />
            </KpiGrid>
          </>
        )}
      </RuleSummary>

      {error && <InfoCallout t="warning" compact>{error}</InfoCallout>}

      {cfg && (
        <>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(440px, 100%), 1fr))', gap: S.lg, alignItems: 'start' }}>
            {/* Contribution calculator */}
            <SectionCard title="Contribution calculator" icon={<IconUser size={16} />} hint="One employee, one month. Nothing is saved." style={{ marginBottom: 0 }}
              bodyStyle={{ display: 'flex', flexDirection: 'column', gap: S.md + 2 }}>
              <FormGrid min={140}>
                <CField label="Gross (₹/mo)"><input type="number" value={gross} onChange={e => setGross(e.target.value)} style={cfgInput} /></CField>
                <CField label="HRA (₹/mo)"><input type="number" value={hra} onChange={e => setHra(e.target.value)} style={cfgInput} /></CField>
                <CField label="PF limit">
                  <select value={limit} onChange={e => setLimit(e.target.value)} style={{ ...cfgInput, cursor: 'pointer' }}>
                    <option value="15000">₹15,000 (capped)</option>
                    <option value="999999999">Actual (uncapped)</option>
                  </select>
                </CField>
              </FormGrid>
              <div style={{ display: 'flex', gap: S.sm, flexWrap: 'wrap' }}>
                <ToggleChip checked={reduced} onChange={setReduced} label="Reduced 10% rate" />
                <ToggleChip checked={isIw} onChange={v => { setIsIw(v); if (!v) setHasCoc(false) }} label="International Worker" />
                {isIw && <ToggleChip checked={hasCoc} onChange={setHasCoc} label="Has Certificate of Coverage (excluded)" />}
              </div>
              <div><PButton variant="primary" onClick={runCalc}>Calculate</PButton></div>

              {result && (result.is_excluded_employee ? (
                <ResultWell>
                  <div><StatusPill t="neutral" solid size="sm">Excluded employee</StatusPill></div>
                  <div style={{ fontSize: F.small, color: C.inkSoft }}>COC-holding International Worker: zero EPF applies in India.</div>
                </ResultWell>
              ) : (
                <ResultWell>
                  <div style={{ display: 'flex', alignItems: 'center', gap: S.sm, flexWrap: 'wrap', fontSize: F.small, color: C.muted }}>
                    EPF wages: <strong style={{ color: C.ink, fontSize: F.lead, ...numeric }}>{inr(result.epf_wages)}</strong>
                    {isIw && <StatusPill t="brand" size="sm">IW · full gross, no cap</StatusPill>}
                  </div>
                  <FigureStrip items={[
                    { label: 'Employee', value: inr(result.employee_contribution) },
                    { label: 'Employer EPS', value: inr(result.employer_eps_contribution), t: 'info' },
                    { label: 'Employer EPF', value: inr(result.employer_epf_contribution), t: 'brand' },
                    { label: 'Employer total', value: inr(result.employer_total_contribution), strong: true },
                  ]} />
                  <SplitBar eps={result.employer_eps_contribution} epf={result.employer_epf_contribution} />
                </ResultWell>
              ))}
            </SectionCard>

            {/* EDLI + Admin charges (establishment) */}
            <SectionCard title="EDLI + Admin charges" icon={<IconBuilding size={16} />} hint="Establishment-level (employer only), on ₹15,000 base, pro-rated by paid days." style={{ marginBottom: 0 }}
              bodyStyle={{ display: 'flex', flexDirection: 'column', gap: S.md + 2 }}>
              <FormGrid min={130}>
                <CField label="Paid days"><input type="number" value={paidDays} onChange={e => setPaidDays(e.target.value)} style={cfgInput} /></CField>
                <CField label="Days in month"><input type="number" value={daysInMonth} onChange={e => setDaysInMonth(e.target.value)} style={cfgInput} /></CField>
              </FormGrid>
              <div style={{ display: 'flex', gap: S.sm, flexWrap: 'wrap', alignItems: 'center' }}>
                <ToggleChip checked={hasMembers} onChange={setHasMembers} label="Has contributing members" />
                <PButton variant="secondary" onClick={runCharges}>Estimate</PButton>
              </div>
              {charges && (
                <FigureStrip items={[
                  { label: 'Pro-rated base', value: inr(charges.prorated_base) },
                  { label: 'EDLI', value: inr(charges.edli_charge) },
                  { label: 'Admin', value: inr(charges.admin_charge) },
                ]} />
              )}
            </SectionCard>
          </div>
        </>
      )}
    </div>
  )
}
