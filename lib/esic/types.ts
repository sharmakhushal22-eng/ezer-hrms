// ================================================================
// EZER HRMS — ESIC Configuration — Types
// Path: lib/esic/types.ts
// ================================================================

export type CoverageReason = 'NEW_THIS_PERIOD' | 'CONTINUING_COVERAGE' | 'NOT_ELIGIBLE'

export interface EsicConfig {
  id: string
  wage_ceiling: number
  wage_ceiling_pwd: number
  employee_contribution_percent: number
  employer_contribution_percent: number
  employer_contribution_percent_pwd: number
  daily_wage_exemption_threshold: number
  new_employee_registration_days: number
  monthly_deposit_due_day: number
  establishment_threshold_default: number
  effective_from: string
  effective_to: string | null
}

export interface EsicApplicabilityResult {
  is_covered: boolean
  coverage_reason: CoverageReason
  employee_contribution: number
  employer_contribution: number
  esic_period: string
}
