// ================================================================
// EZER HRMS — Bonus Configuration — Types
// Path: lib/bonus/types.ts
// ================================================================

export type PaymentFrequency = 'MONTHLY' | 'YEAR_END'
export type PercentPreset = 'STATUTORY_MIN' | 'STATUTORY_MAX' | 'CUSTOM'

export interface BonusConfig {
  id: string
  fy: string
  payment_frequency: PaymentFrequency
  percent_preset: PercentPreset
  bonus_percent: number
  calculation_ceiling: number
  eligibility_salary_ceiling: number
  is_active: boolean
}

export interface BonusAccrual {
  id: string
  employee_id: string
  payroll_run_id: string
  fy: string
  period_month: string
  structured_basic: number
  paid_days: number
  days_in_month: number
  earned_basic: number
  calc_base: number
  bonus_percent_applied: number
  bonus_accrued: number
  is_eligible: boolean
  paid_in_month: boolean
  paid_at_year_end: boolean
}

export interface YearEndPayoutResult {
  employee_id: string
  total_bonus_payable: number
}

export const STATUTORY_MIN_PERCENT = 8.33
export const STATUTORY_MAX_PERCENT = 20
