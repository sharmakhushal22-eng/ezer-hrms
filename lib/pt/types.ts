// ================================================================
// EZER HRMS — Professional Tax Configuration — Types
// Path: lib/pt/types.ts
// ================================================================

export const MONTH_KEYS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'] as const
export const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

export type Gender = 'ALL' | 'MALE' | 'FEMALE'

export interface PtConfig {
  id: string
  state: string
  slab_min: number
  slab_max: number | null
  gender: Gender
  jan: number; feb: number; mar: number; apr: number; may: number; jun: number
  jul: number; aug: number; sep: number; oct: number; nov: number; dec: number
  effective_from: string
  effective_to: string | null
  notification_reference: string | null
}

export interface PtResult {
  pt_amount: number | null
  slab_min: number | null
  slab_max: number | null
  rate_found: boolean
}
