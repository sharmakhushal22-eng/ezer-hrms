'use client'
// components/payroll/EsicConfig.tsx — Payroll → Configuration → ESIC.
// Employees' State Insurance reference (wage ceilings, contribution rates, low-wage
// exemption, registration/deposit deadlines) from esic_config (migration sql75) + a
// side-effect-free contribution estimator. The stateful coverage-continuity check
// (checkEsicApplicability) writes esic_coverage_tracking and is called from the payroll
// run, not this config screen. Inline in the config dropdown.
import { useState, useEffect, useCallback } from 'react'
import { getCurrentEsicConfig } from '@/lib/esic/actions'
import type { EsicConfig as EsicCfg } from '@/lib/esic/types'
import {
  C, F, S, numeric,
  IconUser, IconBuilding, IconHeart, IconReceipt, IconCalendar, IconClock, IconCompliance, IconSliders,
} from '@/lib/ui'
import { SectionCard, KpiTile, KpiGrid, InfoCallout, StatusPill, SubHead, IconInfo } from '@/components/payroll/kit'
import { RuleSummary, CField, FormGrid, CheckRow, FigureStrip, ResultWell, cfgInput } from '@/components/payroll/configKit'

const inr = (n: number) => `₹${Number(n).toLocaleString('en-IN')}`

export default function EsicConfig() {
  const [cfg, setCfg] = useState<EsicCfg | null>(null)
  const [error, setError] = useState('')

  const [wage, setWage] = useState('18000')
  const [isPwd, setIsPwd] = useState(false)
  const [dailyAvg, setDailyAvg] = useState('')

  const load = useCallback(async () => {
    setError('')
    try {
      const c = await getCurrentEsicConfig()
      if (!c) setError('No ESIC config found. Run sql75 first.')
      setCfg(c)
    } catch (e: any) { setError(e.message || 'Could not load. Run sql75 first.') }
  }, [])
  useEffect(() => { load() }, [load])

  // Pure, side-effect-free single-month estimate (mirrors the RPC's rate logic;
  // the mid-period continuity rule is applied during the actual payroll run).
  const est = (() => {
    if (!cfg) return null
    const w = Number(wage) || 0
    const ceiling = isPwd ? Number(cfg.wage_ceiling_pwd) : Number(cfg.wage_ceiling)
    const covered = w > 0 && w <= ceiling
    const erPct = isPwd ? Number(cfg.employer_contribution_percent_pwd) : Number(cfg.employer_contribution_percent)
    let eePct = Number(cfg.employee_contribution_percent)
    const lowWaged = dailyAvg !== '' && Number(dailyAvg) <= Number(cfg.daily_wage_exemption_threshold)
    if (lowWaged) eePct = 0
    return {
      ceiling, covered, lowWaged,
      employee: covered ? Math.round(w * eePct / 100 * 100) / 100 : 0,
      employer: covered ? Math.round(w * erPct / 100 * 100) / 100 : 0,
    }
  })()

  return (
    <div style={{ fontFamily: F.family, fontSize: F.small, color: C.ink, minWidth: 0 }}>
      <RuleSummary icon={<IconCompliance size={20} />} eyebrow="Statutory · State Insurance" title="ESIC"
        rule={<>Employees&apos; State Insurance: wage ceiling, contributions &amp; mid-period coverage continuity</>}>
        {cfg && (
          <>
          <SubHead>Contribution rates</SubHead>
            <KpiGrid min={170}>
              <KpiTile label="Employee share" value={`${cfg.employee_contribution_percent}%`} icon={<IconUser size={15} />} />
              <KpiTile label="Employer share" value={`${cfg.employer_contribution_percent}%`} icon={<IconBuilding size={15} />} />
              <KpiTile label="Employer (PWD)" value={`${cfg.employer_contribution_percent_pwd}%`} sub="reduced rate" t="positive" icon={<IconHeart size={15} />} />
              <KpiTile label="Low-wage exemption" value={`≤ ₹${cfg.daily_wage_exemption_threshold}/day`} sub="employee share waived" t="warning" icon={<IconReceipt size={15} />} />
            </KpiGrid>
            <SubHead>Coverage &amp; deadlines</SubHead>
            <KpiGrid min={170} style={{ marginBottom: 0 }}>
              <KpiTile label="Wage ceiling" value={inr(cfg.wage_ceiling)} sub="standard" icon={<IconSliders size={15} />} />
              <KpiTile label="PWD ceiling" value={inr(cfg.wage_ceiling_pwd)} sub="persons with disability" t="positive" icon={<IconHeart size={15} />} />
              <KpiTile label="New-employee registration" value={`${cfg.new_employee_registration_days} days`} sub="from joining" t="info" icon={<IconClock size={15} />} />
              <KpiTile label="Monthly deposit due" value={`${cfg.monthly_deposit_due_day}th`} sub="of next month" t="info" icon={<IconCalendar size={15} />} />
            </KpiGrid>
          </>
        )}
      </RuleSummary>

      {error && <InfoCallout t="warning" compact>{error}</InfoCallout>}

      {cfg && (
        <>

          {/* Coverage-continuity note */}
          <InfoCallout t="info" title="Coverage continuity">
            Once an employee is within the ceiling in any month of a 6-month contribution period (Apr–Sep / Oct–Mar), they stay covered for the rest of that period even if a raise pushes them above ₹{Number(cfg.wage_ceiling).toLocaleString('en-IN')}. This is applied automatically during the payroll run.
          </InfoCallout>

          {/* Estimator */}
          <SectionCard title="Contribution estimate (single month)" icon={<IconUser size={16} />} bodyStyle={{ display: 'flex', flexDirection: 'column', gap: S.md + 2 }}>
            <FormGrid min={180}>
              <CField label="Gross wage (₹/mo)"><input type="number" value={wage} onChange={e => setWage(e.target.value)} style={cfgInput} /></CField>
              <CField label="Avg daily wage (optional)"><input type="number" value={dailyAvg} onChange={e => setDailyAvg(e.target.value)} placeholder="for low-wage check" style={cfgInput} /></CField>
              <div style={{ paddingBottom: 9 }}><CheckRow checked={isPwd} onChange={e => setIsPwd(e.target.checked)}>PWD</CheckRow></div>
            </FormGrid>

            {est && (
              <ResultWell>
                <div style={{ display: 'flex', alignItems: 'center', gap: S.sm, flexWrap: 'wrap' }}>
                  <StatusPill t={est.covered ? 'positive' : 'neutral'} solid dot>{est.covered ? 'Covered' : 'Not covered'}</StatusPill>
                  {!est.covered && <span style={{ fontSize: F.small, color: C.muted, ...numeric }}>wage above {inr(est.ceiling)} ceiling</span>}
                  {est.lowWaged && est.covered && <StatusPill t="warning" size="sm">low-wage: employee share waived</StatusPill>}
                </div>
                {est.covered && (
                  <FigureStrip items={[
                    { label: 'Employee', value: inr(est.employee) },
                    { label: 'Employer', value: inr(est.employer) },
                    { label: 'Total / month', value: inr(est.employee + est.employer), strong: true },
                  ]} />
                )}
              </ResultWell>
            )}
            <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: F.tiny, color: C.muted, lineHeight: 1.5 }}>
              <span style={{ display: 'inline-flex', color: C.faint, marginTop: 1 }}><IconInfo size={13} /></span>
              Estimate only: a first-month, no-history view. The payroll run uses the stateful check that also applies mid-period continuity.
            </div>
          </SectionCard>
        </>
      )}
    </div>
  )
}
