'use client'
// components/payroll/BonusConfig.tsx — Payroll → Configuration → Bonus.
// Payment of Bonus Act 1965 config: payment frequency (monthly vs year-end),
// bonus % (statutory min 8.33 / max 20 / custom), calculation & eligibility ceilings.
// Reads/writes bonus_config (migration sql65). Rendered inline in the payroll
// config dropdown — no full-page wrapper, takes the active FY as a prop.
import { useState, useEffect, useCallback } from 'react'
import { getBonusConfig, saveBonusConfig } from '@/lib/bonus/actions'
import { STATUTORY_MIN_PERCENT, STATUTORY_MAX_PERCENT } from '@/lib/bonus/types'
import type { PaymentFrequency, PercentPreset } from '@/lib/bonus/types'
// Design tokens, aliased as TK — many of these files already declare
// their own C. See lib/ui/tokens.ts.
import { C as TK } from '@/lib/ui'

const C = {
  navy: TK.ink, purple: TK.brand, purpleD: TK.brandDeep, card: TK.surface,
  border: TK.line, muted: TK.muted, green: TK.positive, gray: TK.sunken,
  amber: TK.warning, amberBg: TK.warningTint, amberBd: '#FDE8C8', purpleBg: TK.brandTint,
}
const font = '"DM Sans","Segoe UI",sans-serif'
const inputStyle: React.CSSProperties = { width: '100%', padding: '9px 11px', border: '1px solid #DDD6FE', borderRadius: 7, fontSize: 13, boxSizing: 'border-box', fontFamily: font, outline: 'none', background: TK.sunken, color: C.navy }

function ToggleButton({ label, sub, active, onClick }: { label: string; sub?: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      onMouseEnter={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.borderColor = C.purple }}
      onMouseLeave={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.borderColor = C.border }}
      style={{
        flex: 1, padding: '11px 14px', borderRadius: 10, textAlign: 'left', cursor: 'pointer',
        border: `1.5px solid ${active ? C.purple : C.border}`,
        background: active ? 'linear-gradient(135deg,#2563EB,#5B21B6)' : '#fff',
        color: active ? '#fff' : C.navy, transition: 'border-color .12s',
        boxShadow: active ? '0 3px 10px rgba(37,99,235,0.22)' : 'none',
      }}>
      <div style={{ fontSize: 12.5, fontWeight: 700 }}>{label}</div>
      {sub && <div style={{ fontSize: 10, marginTop: 2, color: active ? 'rgba(255,255,255,0.8)' : C.muted, fontWeight: 500 }}>{sub}</div>}
    </button>
  )
}

function SectionCard({ step, title, children }: { step: string; title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px', marginBottom: 14, boxShadow: '0 1px 6px rgba(37,99,235,0.07)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ width: 22, height: 22, borderRadius: 7, background: C.purpleBg, color: C.purpleD, fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{step}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: C.purple, textTransform: 'uppercase', letterSpacing: '.05em' }}>{title}</span>
      </div>
      {children}
    </div>
  )
}

export default function BonusConfig({ fy = '2026-27' }: { fy?: string }) {
  const FY = fy
  const [paymentFrequency, setPaymentFrequency] = useState<PaymentFrequency>('YEAR_END')
  const [percentPreset, setPercentPreset] = useState<PercentPreset>('STATUTORY_MIN')
  const [bonusPercent, setBonusPercent] = useState(STATUTORY_MIN_PERCENT)
  const [calculationCeiling, setCalculationCeiling] = useState(7000)
  const [eligibilityCeiling, setEligibilityCeiling] = useState(21000)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')

  const notify = (m: string) => { setToast(m); setTimeout(() => setToast(''), 4000) }

  const load = useCallback(async () => {
    const cfg = await getBonusConfig(FY)
    if (cfg) {
      setPaymentFrequency(cfg.payment_frequency)
      setPercentPreset(cfg.percent_preset)
      setBonusPercent(cfg.bonus_percent)
      setCalculationCeiling(cfg.calculation_ceiling)
      setEligibilityCeiling(cfg.eligibility_salary_ceiling)
    }
  }, [FY])
  useEffect(() => { load() }, [load])

  function pickPreset(preset: PercentPreset) {
    setPercentPreset(preset)
    if (preset === 'STATUTORY_MIN') setBonusPercent(STATUTORY_MIN_PERCENT)
    if (preset === 'STATUTORY_MAX') setBonusPercent(STATUTORY_MAX_PERCENT)
    // CUSTOM leaves bonusPercent as whatever the admin types next
  }

  async function handleSave() {
    setSaving(true)
    try {
      await saveBonusConfig({
        fy: FY, paymentFrequency, percentPreset, bonusPercent,
        calculationCeiling, eligibilitySalaryCeiling: eligibilityCeiling,
      })
      notify('Bonus configuration saved for FY ' + FY)
    } catch (err: any) {
      notify('Could not save: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  const isAboveStatutoryMax = bonusPercent > STATUTORY_MAX_PERCENT

  return (
    <div style={{ fontFamily: font, fontSize: 13, maxWidth: 580 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: 'linear-gradient(135deg,#2563EB,#5B21B6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, boxShadow: '0 3px 10px rgba(37,99,235,0.28)' }}></div>
        <div>
          <div style={{ fontSize: 17, fontWeight: 800, color: C.navy, lineHeight: 1.1 }}>Statutory Bonus</div>
          <div style={{ fontSize: 10.5, color: C.muted, marginTop: 3 }}>
            <span style={{ fontWeight: 700, color: C.purpleD, background: C.purpleBg, borderRadius: 99, padding: '1px 7px' }}>FY {FY}</span>
            <span> · Payment of Bonus Act 1965</span>
          </div>
        </div>
      </div>

      {/* 1 — Payment frequency */}
      <SectionCard step="1" title="When is bonus paid?">
        <div style={{ display: 'flex', gap: 8 }}>
          <ToggleButton label="Monthly" sub="Paid with salary" active={paymentFrequency === 'MONTHLY'} onClick={() => setPaymentFrequency('MONTHLY')} />
          <ToggleButton label="Year-end" sub="One lump sum" active={paymentFrequency === 'YEAR_END'} onClick={() => setPaymentFrequency('YEAR_END')} />
        </div>
        <div style={{ fontSize: 11, color: C.muted, marginTop: 10, lineHeight: 1.5 }}>
          {paymentFrequency === 'MONTHLY'
            ? 'Bonus is calculated and paid out every month, along with salary.'
            : 'Bonus accrues every month but is only paid as one lump sum — trigger the year-end payout when ready.'}
        </div>
      </SectionCard>

      {/* 2 — Percentage */}
      <SectionCard step="2" title="Bonus percentage">
        <div style={{ display: 'flex', gap: 8, marginBottom: percentPreset === 'CUSTOM' || isAboveStatutoryMax ? 12 : 0 }}>
          <ToggleButton label={`${STATUTORY_MIN_PERCENT}%`} sub="Statutory min" active={percentPreset === 'STATUTORY_MIN'} onClick={() => pickPreset('STATUTORY_MIN')} />
          <ToggleButton label={`${STATUTORY_MAX_PERCENT}%`} sub="Statutory max" active={percentPreset === 'STATUTORY_MAX'} onClick={() => pickPreset('STATUTORY_MAX')} />
          <ToggleButton label="Custom" sub="Your policy" active={percentPreset === 'CUSTOM'} onClick={() => pickPreset('CUSTOM')} />
        </div>
        {percentPreset === 'CUSTOM' && (
          <div>
            <label style={{ fontSize: 10, color: C.muted, display: 'block', marginBottom: 4 }}>Percentage (%) — can go above the statutory 20% max for a discretionary bonus</label>
            <input type="number" step="0.01" min="0" value={bonusPercent} onChange={e => setBonusPercent(Number(e.target.value))} style={inputStyle} />
          </div>
        )}
        {isAboveStatutoryMax && (
          <div style={{ fontSize: 11, color: C.amber, background: C.amberBg, border: `1px solid ${C.amberBd}`, padding: '8px 11px', borderRadius: 8, marginTop: 10, lineHeight: 1.5 }}>
            ⚠ {bonusPercent}% is above the statutory maximum of {STATUTORY_MAX_PERCENT}% — a discretionary bonus beyond the Act&apos;s requirement, which is allowed but worth confirming is intentional.
          </div>
        )}
      </SectionCard>

      {/* 3 — Calculation base */}
      <SectionCard step="3" title="Calculation base">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <label style={{ fontSize: 10, color: C.muted, display: 'block', marginBottom: 4 }}>Calculation ceiling (₹)</label>
            <input type="number" value={calculationCeiling} onChange={e => setCalculationCeiling(Number(e.target.value))} style={inputStyle} />
          </div>
          <div>
            <label style={{ fontSize: 10, color: C.muted, display: 'block', marginBottom: 4 }}>Eligibility salary ceiling (₹)</label>
            <input type="number" value={eligibilityCeiling} onChange={e => setEligibilityCeiling(Number(e.target.value))} style={inputStyle} />
          </div>
        </div>
        <div style={{ fontSize: 11, color: C.muted, marginTop: 10, lineHeight: 1.6, background: C.gray, borderRadius: 8, padding: '9px 11px' }}>
          Bonus is calculated on <strong style={{ color: C.navy }}>earned basic</strong> (structured basic pro-rated by paid days) — capped at the
          calculation ceiling if earned basic exceeds it. Only employees with structured basic at or below the eligibility
          ceiling accrue bonus at all.
        </div>
      </SectionCard>

      <button onClick={handleSave} disabled={saving}
        onMouseEnter={e => { if (!saving) (e.currentTarget as HTMLButtonElement).style.filter = 'brightness(1.08)' }}
        onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.filter = 'none'}
        style={{ padding: '11px 24px', borderRadius: 9, border: 'none', background: 'linear-gradient(120deg,#2563EB,#5B21B6)', color: TK.onAccent, fontWeight: 700, fontSize: 13, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1, boxShadow: '0 3px 10px rgba(37,99,235,0.22)', transition: 'filter .12s' }}>
        {saving ? 'Saving…' : 'Save bonus configuration'}
      </button>

      {toast && (
        <div style={{ position: 'fixed', bottom: 20, right: 20, background: C.navy, color: TK.onAccent, padding: '10px 18px', borderRadius: 8, fontSize: 12, fontWeight: 600, zIndex: 999, boxShadow: '0 4px 16px rgba(0,0,0,0.2)' }}>
          {toast}
        </div>
      )}
    </div>
  )
}
