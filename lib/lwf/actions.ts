// ================================================================
// EZER HRMS — LWF Configuration — Data Access
// Path: lib/lwf/actions.ts
//
// calculateLwfDeduction() is the ONE function payroll should call —
// per employee, per month. It already knows whether this month is
// even an LWF month for that state, and whether this employee's exit
// date exempts them — the caller doesn't re-implement either check.
// ================================================================
import { supabase } from '@/lib/supabase'
import type { LwfConfig, LwfCalculationResult } from './types'

export async function getCurrentLwfRates(): Promise<LwfConfig[]> {
  const { data } = await supabase
    .from('lwf_config')
    .select('*')
    .is('effective_to', null)
    .order('state')
  return (data ?? []) as LwfConfig[]
}

export async function getLwfHistory(state: string): Promise<LwfConfig[]> {
  const { data } = await supabase
    .from('lwf_config')
    .select('*')
    .eq('state', state)
    .order('effective_from', { ascending: false })
  return (data ?? []) as LwfConfig[]
}

/** Revise a state's LWF config — closes the current open row and inserts the new one, same pattern as Minimum Wage. */
export async function reviseLwfConfig(args: {
  state: string
  applicableMonths: number[]
  employeeContribution: number
  employerContribution: number
  exitExemptionIfBeforePeriodEnd: boolean
  effectiveFrom: string
  notificationReference?: string
  createdBy?: string
}) {
  const closeDate = new Date(args.effectiveFrom)
  closeDate.setDate(closeDate.getDate() - 1)

  await supabase.from('lwf_config')
    .update({ effective_to: closeDate.toISOString().slice(0, 10) })
    .eq('state', args.state).is('effective_to', null)

  const { data, error } = await supabase.from('lwf_config').insert({
    state: args.state, applicable_months: args.applicableMonths,
    employee_contribution: args.employeeContribution, employer_contribution: args.employerContribution,
    exit_exemption_if_before_period_end: args.exitExemptionIfBeforePeriodEnd,
    effective_from: args.effectiveFrom, effective_to: null,
    notification_reference: args.notificationReference ?? null, created_by: args.createdBy ?? null,
  }).select().single()

  if (error) throw new Error(error.message)
  return data as LwfConfig
}

/**
 * THE monthly payroll call — per employee, per period. Pass the
 * employee's date_of_leaving if they've exited; pass null/undefined
 * for active employees.
 */
export async function calculateLwfDeduction(args: {
  state: string; periodMonth: string; dateOfLeaving?: string | null
}): Promise<LwfCalculationResult> {
  const { data, error } = await supabase.rpc('calculate_lwf_deduction', {
    p_state: args.state, p_period_month: args.periodMonth,
    p_date_of_leaving: args.dateOfLeaving ?? null,
  })
  if (error) throw new Error(error.message)
  return (data as LwfCalculationResult[])[0]
}
