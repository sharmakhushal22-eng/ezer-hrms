// ================================================================
// EZER HRMS — ESIC — Data Access
// Path: lib/esic/actions.ts
//
// checkEsicApplicability() is THE function payroll calls per
// employee per month. It handles the coverage-continuity rule
// internally — once called for an employee in a period, later calls
// in the same period return CONTINUING_COVERAGE automatically, on
// whatever the current wage is, even above the ceiling. Call it in
// period-month order (don't skip months) for the continuity tracking
// to build up correctly.
// ================================================================
import { supabase } from '@/lib/supabase'
import type { EsicConfig, EsicApplicabilityResult } from './types'

export async function getCurrentEsicConfig(): Promise<EsicConfig | null> {
  const { data } = await supabase.from('esic_config').select('*').is('effective_to', null).maybeSingle()
  return data as EsicConfig | null
}

/**
 * THE monthly payroll call. Pass daily_avg_wage only if you want the
 * low-wage exemption checked (employee share waived below the
 * threshold, employer share still applies) — omit it to skip that check.
 */
export async function checkEsicApplicability(args: {
  employeeId: string; periodMonth: string; grossWage: number
  isPwd?: boolean; dailyAvgWage?: number
}): Promise<EsicApplicabilityResult> {
  const { data, error } = await supabase.rpc('check_esic_applicability', {
    p_employee_id: args.employeeId, p_period_month: args.periodMonth, p_gross_wage: args.grossWage,
    p_is_pwd: args.isPwd ?? false, p_daily_avg_wage: args.dailyAvgWage ?? null,
  })
  if (error) throw new Error(error.message)
  return (data as EsicApplicabilityResult[])[0]
}

export async function getEsicDepositDueDate(periodMonth: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('get_esic_deposit_due_date', { p_period_month: periodMonth })
  if (error) throw new Error(error.message)
  return data as string | null
}

/** For the compliance dashboard — flags companies that must file a NIL return this period. */
export async function companyNeedsNilReturn(companyId: string, periodMonth: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('company_needs_nil_return', { p_company_id: companyId, p_period_month: periodMonth })
  if (error) throw new Error(error.message)
  return data as boolean
}
