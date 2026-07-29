// ================================================================
// EZER HRMS — Minimum Wage Configuration — Data Access
// Path: lib/minimum-wage/actions.ts
//
// checkMinimumWageCompliance() is the ONE function every other part
// of the system should call before accepting a proposed Basic —
// Offer Letter generation, Appointment Letter generation, CTC Master
// save, and monthly payroll all wire into this same call, not four
// separate copies of minimum-wage logic.
// ================================================================
import { supabase } from '@/lib/supabase'
import type { MinimumWageConfig, ComplianceResult, WageCategory } from './types'

export async function getCurrentRates(): Promise<MinimumWageConfig[]> {
  const { data } = await supabase
    .from('minimum_wage_config')
    .select('*')
    .is('effective_to', null)
    .order('state').order('category')
  return (data ?? []) as MinimumWageConfig[]
}

export async function getRateHistory(state: string, zone: string, category: WageCategory): Promise<MinimumWageConfig[]> {
  const { data } = await supabase
    .from('minimum_wage_config')
    .select('*')
    .eq('state', state).eq('zone', zone).eq('category', category)
    .order('effective_from', { ascending: false })
  return (data ?? []) as MinimumWageConfig[]
}

/**
 * The correct way to REVISE a rate: closes the currently-open row
 * (sets its effective_to) and inserts the new one — done as two
 * calls here, but the database's EXCLUDE constraint is what actually
 * guarantees no ambiguity results even if this gets called oddly
 * (e.g. twice at once, or with a wrong date) — it will reject rather
 * than silently create an overlapping pair.
 */
export async function reviseRate(args: {
  state: string; zone: string; category: WageCategory
  newBasicAmount: number; newVdaAmount: number
  newEffectiveFrom: string
  notificationReference?: string
  notes?: string
  createdBy?: string
}) {
  const closeDate = new Date(args.newEffectiveFrom)
  closeDate.setDate(closeDate.getDate() - 1)
  const closeDateStr = closeDate.toISOString().slice(0, 10)

  await supabase
    .from('minimum_wage_config')
    .update({ effective_to: closeDateStr })
    .eq('state', args.state).eq('zone', args.zone).eq('category', args.category)
    .is('effective_to', null)

  const { data, error } = await supabase.from('minimum_wage_config').insert({
    state: args.state, zone: args.zone, category: args.category,
    basic_amount: args.newBasicAmount, vda_amount: args.newVdaAmount,
    effective_from: args.newEffectiveFrom, effective_to: null,
    notification_reference: args.notificationReference ?? null,
    notes: args.notes ?? null, created_by: args.createdBy ?? null,
  }).select().single()

  if (error) throw new Error(error.message) // surfaces the EXCLUDE constraint message if dates were somehow wrong
  return data as MinimumWageConfig
}

/**
 * THE compliance check — call this from anywhere a proposed or
 * actual Basic wage needs validating: Offer Letter generation,
 * Appointment Letter generation, CTC Master save, payroll.
 */
export async function checkMinimumWageCompliance(args: {
  state: string; category: WageCategory; proposedBasic: number
  zone?: string; asOf?: string
}): Promise<ComplianceResult> {
  const { data, error } = await supabase.rpc('check_minimum_wage_compliance', {
    p_state: args.state, p_category: args.category, p_proposed_basic: args.proposedBasic,
    p_zone: args.zone ?? 'ALL', p_as_of: args.asOf ?? new Date().toISOString().slice(0, 10),
  })
  if (error) throw new Error(error.message)
  return (data as ComplianceResult[])[0]
}
