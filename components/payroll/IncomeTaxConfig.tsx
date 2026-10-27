'use client'
// components/payroll/IncomeTaxConfig.tsx — Payroll → Configuration → Tax Config.
// Income Tax Act 2025, TY 2026-27: Old vs New regime slabs + surcharge shown side by
// side, plus a live Old-vs-New calculator (marginal relief, surcharge, cess all handled
// server-side by compute_income_tax). Backed by tax_regime_config / tax_slabs /
// surcharge_slabs / cess_config (migration sql72 + seed sql73). Inline in the config dropdown.
import { useState, useEffect, useCallback } from 'react'
import { getSlabs, getSurchargeSlabs, getRegimeConfig, computeIncomeTax } from '@/lib/income-tax/actions'
import type { TaxSlab, SurchargeSlab, TaxRegimeConfig, TaxCalculationResult, Regime, AgeCategory } from '@/lib/income-tax/types'
import { C, F, W, S, R, numeric, IconCompliance, IconCalendar, IconReceipt, IconPayroll } from '@/lib/ui'
import { SectionCard, InfoCallout, PButton, StatusPill, SubHead, DataTable, dt, KeyValueGrid, IconCheckCircle, type KitTone } from '@/components/payroll/kit'
import { RuleSummary, RefChip, CField, FormGrid, RateChip, cfgInput } from '@/components/payroll/configKit'

const inr = (n: number) => `₹${Number(n).toLocaleString('en-IN')}`

function rateTone(rate: number): KitTone {
  return rate === 0 ? 'positive' : rate <= 10 ? 'brand' : rate <= 20 ? 'warning' : 'critical'
}
function ratePill(rate: number) {
  return <RateChip t={rateTone(rate)}>{rate}%</RateChip>
}

function RegimeCard({ regime, slabs, surcharge, config }: {
  regime: Regime; slabs: TaxSlab[]; surcharge: SurchargeSlab[]; config: TaxRegimeConfig | null
}) {
  const isNew = regime === 'NEW'
  // zero-tax ceiling = top of the 0% slab + standard deduction (gross figure)
  const zeroSlab = slabs.find(s => s.tax_rate === 0 && s.slab_max != null)
  const zeroUpto = zeroSlab && config ? Number(zeroSlab.slab_max) + Number(config.standard_deduction) : null
  return (
    <SectionCard
      title={isNew ? 'New Regime' : 'Old Regime'}
      icon={<IconReceipt size={16} />} iconTone={isNew ? 'positive' : 'brand'}
      actions={isNew ? <StatusPill t="positive" size="sm" dot>Default</StatusPill> : undefined}
      style={{ marginBottom: 0, height: '100%' }}
      bodyStyle={{ display: 'flex', flexDirection: 'column', gap: S.md }}>
      {config && (
        <KeyValueGrid min={140} dense items={[
          { label: 'Std. deduction', value: inr(config.standard_deduction), mono: true },
          { label: '87A rebate', value: inr(config.rebate_87a_amount), mono: true },
        ]} />
      )}

      {zeroUpto != null && (
        <InfoCallout t="positive" compact icon={<IconCheckCircle size={14} />} style={{ marginBottom: 0 }}>
          <b style={{ color: C.positive, ...numeric }}>₹0 tax up to {inr(zeroUpto)} gross</b>
        </InfoCallout>
      )}

      <div>
        <SubHead>Slabs</SubHead>
        <DataTable framed>
          <thead><tr><th style={dt.th}>Taxable income</th><th style={{ ...dt.thNum, width: 90 }}>Rate</th></tr></thead>
          <tbody>
            {slabs.map(s => (
              <tr key={s.id} className={dt.rowClass}>
                <td style={dt.tdMono}>{inr(s.slab_min)}{s.slab_max != null ? ` – ${inr(s.slab_max)}` : '+'}</td>
                <td style={dt.tdNum}>{ratePill(Number(s.tax_rate))}</td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      </div>

      <div>
        <SubHead>Surcharge</SubHead>
        <DataTable framed>
          <thead><tr><th style={dt.th}>Total income</th><th style={{ ...dt.thNum, width: 90 }}>Surcharge</th></tr></thead>
          <tbody>
            {surcharge.filter(s => s.surcharge_rate > 0).map(s => (
              <tr key={s.id} className={dt.rowClass}>
                <td style={{ ...dt.td, ...numeric }}>{inr(s.income_min)}{s.income_max != null ? ` – ${inr(s.income_max)}` : '+'}</td>
                <td style={{ ...dt.tdNum, fontWeight: W.bold }}>{s.surcharge_rate}%</td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      </div>
    </SectionCard>
  )
}

function ResultRow({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: S.md, padding: '7px 0', borderBottom: bold ? 'none' : `1px solid ${C.line}` }}>
      <span style={{ fontSize: bold ? F.body : F.small, fontWeight: bold ? W.bold : W.medium, color: bold ? C.ink : C.muted }}>{label}</span>
      <span style={{ fontSize: bold ? F.title : F.small, fontWeight: bold ? W.bold : W.semi, color: C.ink, ...numeric }}>{inr(value)}</span>
    </div>
  )
}

const AGES: { key: AgeCategory; label: string }[] = [
  { key: 'BELOW_60', label: 'Below 60' },
  { key: 'SENIOR_60_80', label: 'Senior (60–80)' },
  { key: 'SUPER_SENIOR_80_PLUS', label: 'Super senior (80+)' },
]

export default function IncomeTaxConfig() {
  const [slabs, setSlabs] = useState<{ old: TaxSlab[]; new: TaxSlab[] }>({ old: [], new: [] })
  const [surcharge, setSurcharge] = useState<{ old: SurchargeSlab[]; new: SurchargeSlab[] }>({ old: [], new: [] })
  const [config, setConfig] = useState<{ old: TaxRegimeConfig | null; new: TaxRegimeConfig | null }>({ old: null, new: null })
  const [error, setError] = useState('')

  const [testIncome, setTestIncome] = useState('1275000')
  const [age, setAge] = useState<AgeCategory>('BELOW_60')
  const [oldResult, setOldResult] = useState<TaxCalculationResult | null>(null)
  const [newResult, setNewResult] = useState<TaxCalculationResult | null>(null)
  const [calculating, setCalculating] = useState(false)

  const load = useCallback(async () => {
    setError('')
    try {
      const [os, ns, osc, nsc, oc, nc] = await Promise.all([
        getSlabs('OLD', 'BELOW_60'), getSlabs('NEW', 'BELOW_60'),
        getSurchargeSlabs('OLD'), getSurchargeSlabs('NEW'),
        getRegimeConfig('OLD'), getRegimeConfig('NEW'),
      ])
      setSlabs({ old: os, new: ns }); setSurcharge({ old: osc, new: nsc }); setConfig({ old: oc, new: nc })
    } catch (e: any) { setError(e.message || 'Could not load. Run sql72 + sql73 first.') }
  }, [])
  useEffect(() => { load() }, [load])

  async function runCalculation() {
    setCalculating(true)
    try {
      const income = Number(testIncome)
      const [o, n] = await Promise.all([
        computeIncomeTax({ grossAnnualIncome: income, regime: 'OLD', ageCategory: age }),
        computeIncomeTax({ grossAnnualIncome: income, regime: 'NEW', ageCategory: age }),
      ])
      setOldResult(o); setNewResult(n)
    } catch (e: any) { setError(e.message) } finally { setCalculating(false) }
  }

  return (
    <div style={{ fontFamily: F.family, fontSize: F.small, color: C.ink, minWidth: 0 }}>
      <RuleSummary icon={<IconCompliance size={20} />} eyebrow="Statutory · Income tax" title="Income Tax: Old vs New"
        rule="Both regimes' slabs and surcharge side by side, and a calculator that compares them for one income."
        meta={<><RefChip t="brand" icon={<IconCalendar size={12} />}>TY 2026-27</RefChip><RefChip>Income Tax Act 2025</RefChip></>} />

      {error && <InfoCallout t="warning" compact>{error}</InfoCallout>}

      {/* Regime reference cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(320px, 100%), 1fr))', gap: S.lg, marginBottom: S.lg }}>
        <RegimeCard regime="OLD" slabs={slabs.old} surcharge={surcharge.old} config={config.old} />
        <RegimeCard regime="NEW" slabs={slabs.new} surcharge={surcharge.new} config={config.new} />
      </div>

      {/* Calculator */}
      <SectionCard title="Compare: test a gross annual income" icon={<IconPayroll size={16} />} bodyStyle={{ display: 'flex', flexDirection: 'column', gap: S.md + 2 }}>
        <FormGrid min={180}>
          <CField label="Gross annual (₹)"><input type="number" value={testIncome} onChange={e => setTestIncome(e.target.value)} placeholder="Gross annual (₹)" style={cfgInput} /></CField>
          <CField label="Age">
            <select value={age} onChange={e => setAge(e.target.value as AgeCategory)} style={{ ...cfgInput, cursor: 'pointer' }}>
              {AGES.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
            </select>
          </CField>
          <div><PButton variant="primary" onClick={runCalculation} disabled={calculating} style={{ height: 38 }}>{calculating ? 'Calculating…' : 'Compare'}</PButton></div>
        </FormGrid>

        {oldResult && newResult && (() => {
          const newWins = newResult.total_tax <= oldResult.total_tax
          return (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(260px, 100%), 1fr))', gap: S.md }}>
                {([['Old Regime', oldResult, !newWins], ['New Regime', newResult, newWins]] as const).map(([title, r, win]) => (
                  <div key={title} className="ez-rise" style={{
                    borderRadius: R.lg, padding: '14px 16px', background: win ? C.positiveTint : C.surface,
                    border: `1px solid ${win ? C.positiveEdge : C.line}`, boxShadow: win ? `inset 0 0 0 1px ${C.positive}` : 'none',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: S.sm, marginBottom: 6 }}>
                      <span style={{ fontSize: F.small, fontWeight: W.bold, color: win ? C.positive : C.ink, textTransform: 'uppercase', letterSpacing: '.05em' }}>{title}</span>
                      {win && <StatusPill t="positive" solid size="sm">Lower</StatusPill>}
                    </div>
                    <ResultRow label="Taxable income" value={r.taxable_income} />
                    <ResultRow label="Tax before rebate" value={r.tax_before_rebate} />
                    <ResultRow label="Rebate (87A)" value={-r.rebate_applied} />
                    <ResultRow label="Surcharge" value={r.surcharge_amount} />
                    <ResultRow label="Cess (4%)" value={r.cess_amount} />
                    <div style={{ marginTop: 6, paddingTop: 4, borderTop: `2px solid ${win ? C.positive : C.lineStrong}` }}>
                      <ResultRow label="Total tax" value={r.total_tax} bold />
                    </div>
                  </div>
                ))}
              </div>
              <InfoCallout t="positive" compact style={{ marginBottom: 0 }}>
                <b style={{ color: C.positive, fontSize: F.small }}>
                  {newWins
                    ? `New regime is better: saves ${inr(oldResult.total_tax - newResult.total_tax)} vs Old`
                    : `Old regime is better: saves ${inr(newResult.total_tax - oldResult.total_tax)} vs New`}
                </b>
              </InfoCallout>
            </>
          )
        })()}
      </SectionCard>
    </div>
  )
}
