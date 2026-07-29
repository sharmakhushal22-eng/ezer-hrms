// ================================================================
// EZER HRMS — Income Tax Configuration — Data Access
// Path: lib/income-tax/actions.ts
//
// computeIncomeTax() is THE function every payroll/TDS calculation
// should call — it's the same engine whether it's monthly TDS
// projection, the ESS tax declaration comparison (Old vs New), or
// year-end reconciliation. One engine, verified against real
// Postgres including marginal relief at the exact surcharge
// threshold — don't duplicate this logic client-side.
// ================================================================
import { supabase } from '@/lib/supabase'
import type { TaxSlab, SurchargeSlab, TaxRegimeConfig, TaxCalculationResult, Regime, AgeCategory } from './types'

export async function getSlabs(regime: Regime, ageCategory: AgeCategory = 'BELOW_60'): Promise<TaxSlab[]> {
  const { data } = await supabase
    .from('tax_slabs').select('*')
    .eq('regime', regime).eq('age_category', ageCategory).is('effective_to', null)
    .order('slab_min')
  return (data ?? []) as TaxSlab[]
}

export async function getSurchargeSlabs(regime: Regime): Promise<SurchargeSlab[]> {
  const { data } = await supabase
    .from('surcharge_slabs').select('*')
    .eq('regime', regime).is('effective_to', null)
    .order('income_min')
  return (data ?? []) as SurchargeSlab[]
}

export async function getRegimeConfig(regime: Regime): Promise<TaxRegimeConfig | null> {
  const { data } = await supabase
    .from('tax_regime_config').select('*')
    .eq('regime', regime).is('effective_to', null).maybeSingle()
  return data as TaxRegimeConfig | null
}

/**
 * THE tax calculation. Pass annual gross income — returns the full
 * breakdown (taxable income, tax, rebate, surcharge with marginal
 * relief already applied, cess, and the final total).
 */
export async function computeIncomeTax(args: {
  grossAnnualIncome: number; regime: Regime; ageCategory?: AgeCategory; asOf?: string
}): Promise<TaxCalculationResult> {
  const { data, error } = await supabase.rpc('compute_income_tax', {
    p_gross_annual_income: args.grossAnnualIncome,
    p_regime: args.regime,
    p_age_category: args.ageCategory ?? 'BELOW_60',
    p_as_of: args.asOf ?? new Date().toISOString().slice(0, 10),
  })
  if (error) throw new Error(error.message)
  return (data as TaxCalculationResult[])[0]
}

/** Convenience — compare Old vs New in one call, for the ESS regime-selection screen. */
export async function compareRegimes(args: {
  grossAnnualIncome: number; ageCategory?: AgeCategory; asOf?: string
}): Promise<{ old: TaxCalculationResult; new: TaxCalculationResult; recommendedRegime: Regime }> {
  const [oldResult, newResult] = await Promise.all([
    computeIncomeTax({ ...args, regime: 'OLD' }),
    computeIncomeTax({ ...args, regime: 'NEW' }),
  ])
  return {
    old: oldResult, new: newResult,
    recommendedRegime: oldResult.total_tax <= newResult.total_tax ? 'OLD' : 'NEW',
  }
}
