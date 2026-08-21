'use client'
// components/payroll/IncomeTaxConfig.tsx — Payroll → Configuration → Tax Config.
// Income Tax Act 2025, TY 2026-27: Old vs New regime slabs + surcharge shown side by
// side, plus a live Old-vs-New calculator (marginal relief, surcharge, cess all handled
// server-side by compute_income_tax). Backed by tax_regime_config / tax_slabs /
// surcharge_slabs / cess_config (migration sql72 + seed sql73). Inline in the config dropdown.
import { useState, useEffect, useCallback } from 'react'
import { getSlabs, getSurchargeSlabs, getRegimeConfig, computeIncomeTax } from '@/lib/income-tax/actions'
import type { TaxSlab, SurchargeSlab, TaxRegimeConfig, TaxCalculationResult, Regime, AgeCategory } from '@/lib/income-tax/types'
// Design tokens, aliased as TK — many of these files already declare
// their own C. See lib/ui/tokens.ts.
import { C as TK } from '@/lib/ui'

const C = {
  navy: TK.ink, purple: TK.violet, purpleD: TK.violetDeep, card: TK.surface,
  border: TK.line, muted: TK.muted, green: TK.positive, greenBg: TK.positiveTint,
  greenBd: '#BBF7D0', purpleBg: TK.violetTint, gray: TK.sunken, amber: TK.warning, amberBg: TK.warningTint,
}
const font = '"DM Sans","Segoe UI",sans-serif'
const inr = (n: number) => `₹${Number(n).toLocaleString('en-IN')}`

function ratePill(rate: number) {
  const [bg, fg] = rate === 0 ? [TK.positiveTint, TK.positive]
    : rate <= 10 ? ['#EEF2FF', '#4F46E5']
    : rate <= 20 ? [TK.warningTint, TK.warning]
    : [TK.criticalTint, TK.critical]
  return <span style={{ fontSize: 10.5, fontWeight: 800, padding: '2px 8px', borderRadius: 99, background: bg, color: fg, minWidth: 40, display: 'inline-block', textAlign: 'center' }}>{rate}%</span>
}

function RegimeCard({ regime, slabs, surcharge, config }: {
  regime: Regime; slabs: TaxSlab[]; surcharge: SurchargeSlab[]; config: TaxRegimeConfig | null
}) {
  const isNew = regime === 'NEW'
  const accent = isNew ? 'linear-gradient(90deg,#059669,#10B981)' : 'linear-gradient(90deg,#7C3AED,#5B21B6)'
  // zero-tax ceiling = top of the 0% slab + standard deduction (gross figure)
  const zeroSlab = slabs.find(s => s.tax_rate === 0 && s.slab_max != null)
  const zeroUpto = zeroSlab && config ? Number(zeroSlab.slab_max) + Number(config.standard_deduction) : null
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, overflow: 'hidden', flex: 1, minWidth: 250, boxShadow: '0 2px 10px rgba(124,58,237,0.08)' }}>
      <div style={{ height: 4, background: accent }} />
      <div style={{ padding: '14px 16px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span style={{ width: 30, height: 30, borderRadius: 9, background: isNew ? C.greenBg : C.purpleBg, color: isNew ? C.green : C.purpleD, fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{isNew ? '' : ''}</span>
          <span style={{ fontSize: 14, fontWeight: 800, color: C.navy }}>{isNew ? 'New Regime' : 'Old Regime'}</span>
          {isNew && <span style={{ marginLeft: 'auto', fontSize: 9, fontWeight: 800, color: C.green, background: C.greenBg, border: `1px solid ${C.greenBd}`, borderRadius: 99, padding: '2px 8px', textTransform: 'uppercase', letterSpacing: '.03em' }}>Default</span>}
        </div>

        {config && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
            <span style={{ fontSize: 10, color: C.muted, background: C.gray, borderRadius: 8, padding: '4px 9px' }}>Std. deduction <strong style={{ color: C.navy }}>{inr(config.standard_deduction)}</strong></span>
            <span style={{ fontSize: 10, color: C.muted, background: C.gray, borderRadius: 8, padding: '4px 9px' }}>87A rebate <strong style={{ color: C.navy }}>{inr(config.rebate_87a_amount)}</strong></span>
          </div>
        )}

        {zeroUpto != null && (
          <div style={{ fontSize: 11, fontWeight: 700, color: C.green, background: C.greenBg, border: `1px solid ${C.greenBd}`, borderRadius: 8, padding: '7px 10px', marginBottom: 12 }}>
            ₹0 tax up to {inr(zeroUpto)} gross
          </div>
        )}

        <div style={{ fontSize: 9.5, fontWeight: 700, color: C.purple, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>Slabs</div>
        <div style={{ marginBottom: 14 }}>
          {slabs.map((s, i) => (
            <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 8px', borderRadius: 7, background: i % 2 === 0 ? C.gray : '#fff' }}>
              <span style={{ fontSize: 11.5, color: C.navy }}>{inr(s.slab_min)}{s.slab_max != null ? ` – ${inr(s.slab_max)}` : '+'}</span>
              {ratePill(Number(s.tax_rate))}
            </div>
          ))}
        </div>

        <div style={{ fontSize: 9.5, fontWeight: 700, color: C.purple, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>Surcharge</div>
        <div>
          {surcharge.filter(s => s.surcharge_rate > 0).map(s => (
            <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 8px' }}>
              <span style={{ fontSize: 11, color: C.muted }}>{inr(s.income_min)}{s.income_max != null ? ` – ${inr(s.income_max)}` : '+'}</span>
              <span style={{ fontSize: 11, fontWeight: 800, color: C.navy }}>{s.surcharge_rate}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function ResultRow({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: bold ? 'none' : `1px solid ${C.border}` }}>
      <span style={{ fontSize: bold ? 13 : 12, fontWeight: bold ? 700 : 500, color: bold ? C.navy : C.muted }}>{label}</span>
      <span style={{ fontSize: bold ? 14.5 : 12, fontWeight: bold ? 800 : 600, color: C.navy }}>{inr(value)}</span>
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
    } catch (e: any) { setError(e.message || 'Could not load — run sql72 + sql73 first.') }
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

  const inputStyle: React.CSSProperties = { padding: '9px 11px', border: '1px solid #DDD6FE', borderRadius: 7, fontSize: 13, boxSizing: 'border-box', fontFamily: font, outline: 'none', background: TK.sunken, color: C.navy }

  return (
    <div style={{ fontFamily: font, fontSize: 13, maxWidth: 800 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: 'linear-gradient(135deg,#7C3AED,#5B21B6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, boxShadow: '0 3px 10px rgba(124,58,237,0.28)' }}></div>
        <div>
          <div style={{ fontSize: 17, fontWeight: 800, color: C.navy, lineHeight: 1.1 }}>Income Tax — Old vs New</div>
          <div style={{ fontSize: 10.5, color: C.muted, marginTop: 3 }}>
            <span style={{ fontWeight: 700, color: C.purpleD, background: C.purpleBg, borderRadius: 99, padding: '1px 7px' }}>TY 2026-27</span>
            <span> · Income Tax Act 2025</span>
          </div>
        </div>
      </div>

      {error && <div style={{ fontSize: 12, color: C.amber, background: C.amberBg, border: '1px solid #FDE8C8', padding: '10px 12px', borderRadius: 9, marginBottom: 12 }}>{error}</div>}

      {/* Regime reference cards */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <RegimeCard regime="OLD" slabs={slabs.old} surcharge={surcharge.old} config={config.old} />
        <RegimeCard regime="NEW" slabs={slabs.new} surcharge={surcharge.new} config={config.new} />
      </div>

      {/* Calculator */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, boxShadow: '0 1px 6px rgba(124,58,237,0.07)' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.purple, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 12 }}>Compare — test a gross annual income</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
          <input type="number" value={testIncome} onChange={e => setTestIncome(e.target.value)} placeholder="Gross annual (₹)" style={{ ...inputStyle, flex: 1, minWidth: 160 }} />
          <select value={age} onChange={e => setAge(e.target.value as AgeCategory)} style={{ ...inputStyle, width: 160 }}>
            {AGES.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
          </select>
          <button onClick={runCalculation} disabled={calculating}
            style={{ padding: '9px 20px', borderRadius: 9, border: 'none', background: 'linear-gradient(120deg,#7C3AED,#5B21B6)', color: '#fff', fontWeight: 700, fontSize: 12.5, cursor: calculating ? 'not-allowed' : 'pointer', opacity: calculating ? 0.6 : 1, boxShadow: '0 3px 10px rgba(124,58,237,0.22)' }}>
            {calculating ? 'Calculating…' : 'Compare'}
          </button>
        </div>

        {oldResult && newResult && (() => {
          const newWins = newResult.total_tax <= oldResult.total_tax
          return (
            <>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {([['Old Regime', oldResult, !newWins, C.purpleD], ['New Regime', newResult, newWins, C.green]] as const).map(([title, r, win, accent]) => (
                  <div key={title} style={{ flex: 1, minWidth: 220, borderRadius: 12, padding: '12px 14px', background: win ? (accent === C.green ? C.greenBg : C.purpleBg) : C.gray, border: `1.5px solid ${win ? accent : C.border}`, boxShadow: win ? '0 3px 12px rgba(124,58,237,0.12)' : 'none' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                      <span style={{ fontSize: 11.5, fontWeight: 800, color: accent, textTransform: 'uppercase', letterSpacing: '.03em' }}>{title}</span>
                      {win && <span style={{ fontSize: 8.5, fontWeight: 800, color: '#fff', background: accent, borderRadius: 99, padding: '2px 7px', textTransform: 'uppercase' }}>Lower</span>}
                    </div>
                    <ResultRow label="Taxable income" value={r.taxable_income} />
                    <ResultRow label="Tax before rebate" value={r.tax_before_rebate} />
                    <ResultRow label="Rebate (87A)" value={-r.rebate_applied} />
                    <ResultRow label="Surcharge" value={r.surcharge_amount} />
                    <ResultRow label="Cess (4%)" value={r.cess_amount} />
                    <div style={{ marginTop: 6, paddingTop: 6, borderTop: `2px solid ${win ? accent : C.border}` }}>
                      <ResultRow label="Total tax" value={r.total_tax} bold />
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8, padding: '11px 14px', background: C.greenBg, border: `1px solid ${C.greenBd}`, borderRadius: 10, fontSize: 13, color: C.green, fontWeight: 800 }}>
                <span style={{ fontSize: 15 }}></span>
                {newWins
                  ? `New regime is better — saves ${inr(oldResult.total_tax - newResult.total_tax)} vs Old`
                  : `Old regime is better — saves ${inr(newResult.total_tax - oldResult.total_tax)} vs New`}
              </div>
            </>
          )
        })()}
      </div>
    </div>
  )
}
