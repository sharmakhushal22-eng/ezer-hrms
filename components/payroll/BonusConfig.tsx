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
import { C, F, W, S, R, numeric, IconAward, IconCalendar, IconSliders, IconFinance } from '@/lib/ui'
import { SectionCard, InfoCallout, PButton, KeyValueGrid, IconInfo } from '@/components/payroll/kit'
import { RuleSummary, RefChip, CField, OptionCard, Toast, StepBadge, cfgInput } from '@/components/payroll/configKit'

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
    <div style={{ fontFamily: F.family, fontSize: F.small, color: C.ink, minWidth: 0 }}>
      <RuleSummary icon={<IconAward size={20} />} eyebrow="Statutory · Bonus" title="Statutory Bonus"
        rule="How bonus is paid, at what percentage, and on what salary base."
        meta={<><RefChip t="brand" icon={<IconCalendar size={12} />}>FY {FY}</RefChip><RefChip>Payment of Bonus Act 1965</RefChip></>} />

      <div style={{ display: 'flex', gap: S.lg, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 480px', minWidth: 0 }}>
          {/* 1 — Payment frequency */}
          <SectionCard title="When is bonus paid?" icon={<StepBadge n="1" />}>
            <div style={{ display: 'flex', gap: S.sm, flexWrap: 'wrap' }}>
              <OptionCard label="Monthly" sub="Paid with salary" active={paymentFrequency === 'MONTHLY'} onClick={() => setPaymentFrequency('MONTHLY')} />
              <OptionCard label="Year-end" sub="One lump sum" active={paymentFrequency === 'YEAR_END'} onClick={() => setPaymentFrequency('YEAR_END')} />
            </div>
            <div style={{ fontSize: F.tiny, color: C.muted, marginTop: S.md, lineHeight: 1.5 }}>
              {paymentFrequency === 'MONTHLY'
                ? 'Bonus is calculated and paid out every month, along with salary.'
                : 'Bonus accrues every month but is only paid as one lump sum. Trigger the year-end payout when ready.'}
            </div>
          </SectionCard>

          {/* 2 — Percentage */}
          <SectionCard title="Bonus percentage" icon={<StepBadge n="2" />}>
            <div style={{ display: 'flex', gap: S.sm, flexWrap: 'wrap', marginBottom: percentPreset === 'CUSTOM' || isAboveStatutoryMax ? S.md : 0 }}>
              <OptionCard label={`${STATUTORY_MIN_PERCENT}%`} sub="Statutory min" active={percentPreset === 'STATUTORY_MIN'} onClick={() => pickPreset('STATUTORY_MIN')} />
              <OptionCard label={`${STATUTORY_MAX_PERCENT}%`} sub="Statutory max" active={percentPreset === 'STATUTORY_MAX'} onClick={() => pickPreset('STATUTORY_MAX')} />
              <OptionCard label="Custom" sub="Your policy" active={percentPreset === 'CUSTOM'} onClick={() => pickPreset('CUSTOM')} />
            </div>
            {percentPreset === 'CUSTOM' && (
              <CField label="Percentage (%): can go above the statutory 20% max for a discretionary bonus">
                <input type="number" step="0.01" min="0" value={bonusPercent} onChange={e => setBonusPercent(Number(e.target.value))} style={{ ...cfgInput, maxWidth: 220 }} />
              </CField>
            )}
            {isAboveStatutoryMax && (
              <InfoCallout t="warning" compact style={{ marginTop: S.md, marginBottom: 0 }}>
                {bonusPercent}% is above the statutory maximum of {STATUTORY_MAX_PERCENT}%: a discretionary bonus beyond the Act&apos;s requirement, which is allowed but worth confirming is intentional.
              </InfoCallout>
            )}
          </SectionCard>

          {/* 3 — Calculation base */}
          <SectionCard title="Calculation base" icon={<StepBadge n="3" />}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))', gap: S.md }}>
              <CField label="Calculation ceiling (₹)">
                <input type="number" value={calculationCeiling} onChange={e => setCalculationCeiling(Number(e.target.value))} style={cfgInput} />
              </CField>
              <CField label="Eligibility salary ceiling (₹)">
                <input type="number" value={eligibilityCeiling} onChange={e => setEligibilityCeiling(Number(e.target.value))} style={cfgInput} />
              </CField>
            </div>
            <div style={{ display: 'flex', gap: S.sm, fontSize: F.tiny, color: C.inkSoft, marginTop: S.md, lineHeight: 1.6, background: C.sunken, border: `1px solid ${C.line}`, borderRadius: R.md, padding: "10px 12px" }}>
              <span style={{ display: 'inline-flex', color: C.muted, marginTop: 2 }}><IconInfo size={13} /></span>
              <span>
                Bonus is calculated on <strong style={{ color: C.ink }}>earned basic</strong> (structured basic pro-rated by paid days), capped at the
                calculation ceiling if earned basic exceeds it. Only employees with structured basic at or below the eligibility
                ceiling accrue bonus at all.
              </span>
            </div>
          </SectionCard>
        </div>

        {/* What will be saved — the same four values, read back in one place. */}
        <div style={{ flex: '1 1 260px', maxWidth: 380, minWidth: 0, position: 'sticky', top: 96 }}>
          <SectionCard title="This FY's setting" icon={<IconSliders size={16} />} hint={`FY ${FY}`}>
            <KeyValueGrid min={140} dense items={[
              { label: 'Paid', value: paymentFrequency === 'MONTHLY' ? 'Monthly' : 'Year-end' },
              { label: 'Bonus %', value: `${bonusPercent}%`, mono: true, t: isAboveStatutoryMax ? 'warning' : undefined },
              { label: 'Calculation ceiling', value: `₹${Number(calculationCeiling).toLocaleString('en-IN')}`, mono: true },
              { label: 'Eligibility ceiling', value: `₹${Number(eligibilityCeiling).toLocaleString('en-IN')}`, mono: true },
            ]} />
            <div style={{ marginTop: S.lg, paddingTop: S.md, borderTop: `1px solid ${C.line}`, display: 'flex', flexDirection: 'column', gap: S.sm }}>
              <PButton variant="primary" size="lg" full icon={<IconFinance size={16} />} onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : 'Save bonus configuration'}
              </PButton>
              <span style={{ fontSize: F.tiny, color: C.muted, textAlign: 'center' }}>Saves the bonus configuration for FY <span style={{ ...numeric, fontWeight: W.semi }}>{FY}</span>.</span>
            </div>
          </SectionCard>
        </div>
      </div>

      {toast && <Toast>{toast}</Toast>}
    </div>
  )
}
