// ================================================================
// EZER HRMS — Bonus Configuration — Data Access
// Path: lib/bonus/actions.ts
// Config CRUD is live-ready (bonus_config, migration sql65).
// The accrual RPC wrappers (calculateBonusAccrual / processYearEndBonus)
// call functions that ship in the follow-up accrual migration and are
// wired once the payroll run/snapshot chain (fy/month) is live.
// ================================================================
import { supabase } from '@/lib/supabase'
import type { BonusConfig, BonusAccrual, YearEndPayoutResult, PaymentFrequency, PercentPreset } from './types'

export async function getBonusConfig(fy: string): Promise<BonusConfig | null> {
  const { data } = await supabase.from('bonus_config').select('*').eq('fy', fy).eq('is_active', true).maybeSingle()
  return data as BonusConfig | null
}

export async function saveBonusConfig(args: {
  fy: string
  paymentFrequency: PaymentFrequency
  percentPreset: PercentPreset
  bonusPercent: number
  calculationCeiling: number
  eligibilitySalaryCeiling: number
  createdBy?: string
}) {
  const { data, error } = await supabase.from('bonus_config').upsert({
    fy: args.fy,
    payment_frequency: args.paymentFrequency,
    percent_preset: args.percentPreset,
    bonus_percent: args.bonusPercent,
    calculation_ceiling: args.calculationCeiling,
    eligibility_salary_ceiling: args.eligibilitySalaryCeiling,
    created_by: args.createdBy ?? null,
  }, { onConflict: 'fy' }).select().single()
  if (error) throw new Error(error.message)
  return data as BonusConfig
}

/** Run once per payroll_run during CALCULATE, after the month is synced. */
export async function calculateBonusAccrual(payrollRunId: string): Promise<number> {
  const { data, error } = await supabase.rpc('calculate_bonus_accrual', { p_payroll_run_id: payrollRunId })
  if (error) throw new Error(error.message)
  return data as number
}

export async function getBonusAccrualsForRun(payrollRunId: string): Promise<BonusAccrual[]> {
  const { data } = await supabase.from('bonus_accrual').select('*').eq('payroll_run_id', payrollRunId)
  return (data ?? []) as BonusAccrual[]
}

export async function getBonusAccrualsForEmployee(employeeId: string, fy: string): Promise<BonusAccrual[]> {
  const { data } = await supabase.from('bonus_accrual').select('*').eq('employee_id', employeeId).eq('fy', fy).order('period_month')
  return (data ?? []) as BonusAccrual[]
}

/** Year-end payout — only relevant when payment_frequency = YEAR_END. Safe to call more than once: a repeat call returns an empty array, never re-reporting an already-settled amount. */
export async function processYearEndBonus(fy: string): Promise<YearEndPayoutResult[]> {
  const { data, error } = await supabase.rpc('process_year_end_bonus', { p_fy: fy })
  if (error) throw new Error(error.message)
  return (data ?? []) as YearEndPayoutResult[]
}
