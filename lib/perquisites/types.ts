// ================================================================
// EZER HRMS — Perquisite Configuration — Types
// Path: lib/perquisites/types.ts
// ================================================================

export type ValuationMethod =
  | 'FLAT_AMOUNT' | 'PERCENT_OF_SALARY' | 'PERCENT_OF_COST' | 'SLAB_BASED' | 'FMV_BASED' | 'MANUAL'

export type PerquisiteUnit = 'PER_MONTH' | 'PER_YEAR' | 'PER_MEAL' | 'PER_TRANSACTION' | 'LUMP_SUM'

export const VALUATION_METHOD_LABELS: Record<ValuationMethod, string> = {
  FLAT_AMOUNT: 'Flat amount',
  PERCENT_OF_SALARY: '% of salary',
  PERCENT_OF_COST: '% of asset cost',
  SLAB_BASED: 'Slab-based (tiered)',
  FMV_BASED: 'Fair-market-value based',
  MANUAL: 'Manual / case-by-case',
}

export interface PerquisiteType {
  id: string
  code: string
  name: string
  category: string
  description: string | null
  valuation_method: ValuationMethod
  law_reference: string | null
  is_active: boolean
}

export interface PerquisiteValue {
  id: string
  perquisite_type_id: string
  fy: string
  default_amount: number | null
  default_percent: number | null
  unit: PerquisiteUnit | null
  exemption_limit: number | null
  is_taxable: boolean
  notes: string | null
  is_active: boolean
}

export interface PerquisiteSlab {
  id: string
  perquisite_value_id: string
  slab_label: string
  condition_key: string | null
  condition_value: string | null
  rate_amount: number | null
  rate_percent: number | null
  sort_order: number
}

// One row per type, per current FY — what the list/config screen renders from
export interface PerquisiteConfigRow {
  perquisite_type_id: string
  code: string
  name: string
  category: string
  description: string | null
  valuation_method: ValuationMethod
  law_reference: string | null
  type_active: boolean
  perquisite_value_id: string | null
  fy: string | null
  default_amount: number | null
  default_percent: number | null
  unit: PerquisiteUnit | null
  exemption_limit: number | null
  is_taxable: boolean | null
  notes: string | null
  slab_count: number
}
