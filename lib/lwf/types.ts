// ================================================================
// EZER HRMS — LWF Configuration — Types
// Path: lib/lwf/types.ts
// ================================================================

export const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

export interface LwfConfig {
  id: string
  state: string
  applicable_months: number[]         // 1-12
  employee_contribution: number
  employer_contribution: number
  exit_exemption_if_before_period_end: boolean
  effective_from: string
  effective_to: string | null
  notification_reference: string | null
}

export interface LwfCalculationResult {
  is_month_applicable: boolean
  is_exempt_due_to_exit: boolean
  employee_contribution: number | null
  employer_contribution: number | null
  rate_found: boolean
}
