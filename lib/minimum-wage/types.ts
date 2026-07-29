// ================================================================
// EZER HRMS — Minimum Wage Configuration — Types
// Path: lib/minimum-wage/types.ts
// ================================================================

export type WageCategory = 'UNSKILLED' | 'SEMI_SKILLED' | 'SKILLED' | 'HIGHLY_SKILLED'

export const CATEGORY_LABELS: Record<WageCategory, string> = {
  UNSKILLED: 'Unskilled',
  SEMI_SKILLED: 'Semi-skilled',
  SKILLED: 'Skilled',
  HIGHLY_SKILLED: 'Highly skilled',
}

export interface MinimumWageConfig {
  id: string
  state: string
  zone: string
  category: WageCategory
  basic_amount: number
  vda_amount: number
  total_minimum_wage: number
  effective_from: string
  effective_to: string | null
  notification_reference: string | null
  notes: string | null
}

export interface ComplianceResult {
  is_compliant: boolean
  applicable_minimum_wage: number | null
  shortfall: number | null
  rate_found: boolean
}
