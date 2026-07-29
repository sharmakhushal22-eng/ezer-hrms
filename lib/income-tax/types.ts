// ================================================================
// EZER HRMS — Income Tax Configuration — Types
// Path: lib/income-tax/types.ts
// ================================================================

export type Regime = 'OLD' | 'NEW'
export type AgeCategory = 'BELOW_60' | 'SENIOR_60_80' | 'SUPER_SENIOR_80_PLUS'

export interface TaxSlab {
  id: string
  regime: Regime
  age_category: AgeCategory
  slab_min: number
  slab_max: number | null
  tax_rate: number
  effective_from: string
  effective_to: string | null
}

export interface SurchargeSlab {
  id: string
  regime: Regime
  income_min: number
  income_max: number | null
  surcharge_rate: number
  effective_from: string
  effective_to: string | null
}

export interface TaxRegimeConfig {
  id: string
  regime: Regime
  standard_deduction: number
  rebate_87a_threshold: number
  rebate_87a_amount: number
  effective_from: string
  effective_to: string | null
}

export interface TaxCalculationResult {
  taxable_income: number
  tax_before_rebate: number
  rebate_applied: number
  tax_after_rebate: number
  surcharge_amount: number
  cess_amount: number
  total_tax: number
}
