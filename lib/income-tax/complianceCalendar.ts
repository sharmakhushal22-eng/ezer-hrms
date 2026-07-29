// ================================================================
// EZER HRMS — TDS Compliance Calendar
// Path: lib/income-tax/complianceCalendar.ts
//
// Rule-based due-date calculation — not a lookup table of pre-baked
// dates. Correctly handles the March deposit exception and Q3/Q4
// crossing into the next calendar year via real date arithmetic in
// the underlying SQL functions (migration 065), verified against a
// full 12-month walk-through on real Postgres.
// ================================================================
import { supabase } from '@/lib/supabase'

export interface QuarterlyReturnInfo {
  quarter: 'Q1' | 'Q2' | 'Q3' | 'Q4'
  quarter_start: string
  quarter_end: string
  return_due_date: string | null
  form_name: string | null
}

/** For a payroll period_month, when must that month's TDS be deposited? */
export async function getTdsDepositDueDate(periodMonth: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('get_tds_deposit_due_date', { p_period_month: periodMonth })
  if (error) throw new Error(error.message)
  return data as string | null
}

/** For a payroll period_month, which quarter is it in, and when is that quarter's Form 24Q due? */
export async function getTdsQuarterlyReturnDueDate(periodMonth: string): Promise<QuarterlyReturnInfo> {
  const { data, error } = await supabase.rpc('get_tds_quarterly_return_due_date', { p_period_month: periodMonth })
  if (error) throw new Error(error.message)
  return (data as QuarterlyReturnInfo[])[0]
}

/** For a given FY (e.g. '2026-27'), when must Form 16 be issued to employees? */
export async function getForm16DueDate(fy: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('get_form16_due_date', { p_fy: fy })
  if (error) throw new Error(error.message)
  return data as string | null
}

/** Convenience — everything relevant for one payroll period in one call, e.g. for a "compliance due soon" banner on the payroll run screen. */
export async function getComplianceSummaryForPeriod(periodMonth: string, fy: string) {
  const [depositDue, quarterlyInfo, form16Due] = await Promise.all([
    getTdsDepositDueDate(periodMonth),
    getTdsQuarterlyReturnDueDate(periodMonth),
    getForm16DueDate(fy),
  ])
  return { depositDue, quarterlyInfo, form16Due }
}
