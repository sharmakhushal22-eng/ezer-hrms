// ================================================================
// EZER HRMS — EPF Configuration — Types
// Path: lib/epf/types.ts
// ================================================================

export interface EpfConfig {
  id: string
  employee_contribution_percent: number
  employer_contribution_percent: number
  eps_percent: number
  eps_wage_ceiling: number
  eps_max_amount: number
  reduced_rate_percent: number
  reduced_rate_headcount_threshold: number
  edli_percent: number
  edli_wage_ceiling: number
  edli_max_amount: number
  admin_charges_percent: number
  admin_charges_wage_ceiling: number
  admin_charges_minimum: number
  admin_charges_minimum_no_members: number
  iw_return_due_days: number
  effective_from: string
  effective_to: string | null
}

export interface EpfCalculationResult {
  epf_wages: number
  employee_contribution: number
  employer_eps_contribution: number
  employer_epf_contribution: number
  employer_total_contribution: number
  is_excluded_employee: boolean
}

export interface EpfChargesResult {
  prorated_base: number
  edli_charge: number
  admin_charge: number
}
