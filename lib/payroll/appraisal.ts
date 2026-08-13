// lib/payroll/appraisal.ts — Appraisal & back-month arrear (migration sql111).
//
// An appraisal has two dates that are deliberately not the same: the date the raise takes
// effect, and the month it is paid in. When they differ — effective 1 April, paid in June
// — April and May have already gone out at the old rate, so the difference for those
// months is owed as arrear, head by head.
//
// The pay-out month itself is never part of that arrear. It receives the new rate through
// regular salary, so counting it again would pay the raise twice for one month.
import { supabase } from '@/lib/supabase'

export interface AppraisalBreakup {
  /** CTC ÷ 12 — the employer's PF and ESIC are INSIDE this, not on top of it */
  fixed_monthly: number
  employer_pf_monthly: number
  employer_esic_monthly: number
  /** what the employee actually receives — the letter's "NET IN HAND" line */
  gross_monthly: number
  statutory_bonus_monthly: number
  /** gross − bonus − flexi; the 50% is applied to this, not to the whole CTC */
  wage_base_monthly: number
  basic_monthly: number
  hra_monthly: number
  flexi_monthly: number
  special_allowance_monthly: number
}

export interface AppraisalRecord {
  id: string
  employee_id: string
  employee_code: string
  company_id: string
  previous_ctc: number
  hike_percent: number | null
  new_ctc: number
  new_variable: number
  new_designation: string | null
  additional_lines: { label: string; monthly_amount: number }[]
  effective_from: string
  pay_out_month: string
  requires_data_sync: boolean
  status: string
  created_at: string
}

/**
 * The breakup. Resolved server-side so the screen, the arrear run and the letter agree.
 *
 * The 50% applies to the WAGE BASE, not to the whole CTC: employer PF/ESIC and statutory
 * bonus come out first. Applying it to the full CTC leaves no room inside the CTC for the
 * employer's own contribution, so it lands on top and the agreed CTC quietly overshoots.
 */
export async function appraisalBreakup(
  newCtcAnnual: number, flexiMonthly = 0, effectiveFrom?: string, statutoryBonusMonthly = 0,
): Promise<AppraisalBreakup> {
  const { data, error } = await supabase.rpc('calculate_appraisal_breakup', {
    p_new_fixed_ctc_annual: newCtcAnnual,
    p_flexi_monthly_total: flexiMonthly,
    p_effective_from: effectiveFrom || new Date().toISOString().slice(0, 10),
    p_statutory_bonus_monthly: statutoryBonusMonthly,
  })
  if (error) throw new Error(error.message)
  return (data as AppraisalBreakup[])[0]
}

export interface EmployeeForAppraisal {
  id: string
  emp_code: string
  full_name: string
  designation: string | null
  company_id: string
  company_name: string
  annual_ctc: number
  annual_variable: number
  /** carried forward from the current structure — an appraisal revises CTC, not the bonus */
  statutory_bonus: number
}

/** Look up one employee by code, with their current CTC — what the form pre-fills from. */
export async function findEmployeeForAppraisal(code: string): Promise<EmployeeForAppraisal | null> {
  const { data: e } = await supabase.from('employees')
    .select('id, emp_code, full_name, designation, company_id, companies(company_name)')
    .ilike('emp_code', code.trim()).limit(1).maybeSingle()
  if (!e) return null
  const { data: c } = await supabase.from('ctc_master')
    .select('annual_ctc, annual_variable').eq('employee_id', (e as any).id)
    .order('effective_from', { ascending: false, nullsFirst: false }).limit(1).maybeSingle()
  const { data: ss } = await supabase.from('salary_structures')
    .select('statutory_bonus').eq('employee_id', (e as any).id)
    .order('effective_date', { ascending: false, nullsFirst: false }).limit(1).maybeSingle()
  return {
    id: (e as any).id, emp_code: (e as any).emp_code, full_name: (e as any).full_name,
    designation: (e as any).designation, company_id: (e as any).company_id,
    company_name: (e as any).companies?.company_name || '',
    annual_ctc: Number((c as any)?.annual_ctc) || 0,
    annual_variable: Number((c as any)?.annual_variable) || 0,
    statutory_bonus: Number((ss as any)?.statutory_bonus) || 0,
  }
}

export async function saveAppraisal(a: {
  employeeId: string; employeeCode: string; companyId: string
  previousCtc: number; hikePercent: number | null; newCtc: number; newVariable: number
  newDesignation: string | null
  additionalLines: { label: string; monthly_amount: number }[]
  effectiveFrom: string; payOutMonth: string
}): Promise<{ error: string | null; record?: AppraisalRecord }> {
  const { data, error } = await supabase.rpc('save_appraisal', {
    p_employee_id: a.employeeId, p_employee_code: a.employeeCode, p_company_id: a.companyId,
    p_previous_ctc: a.previousCtc, p_hike_percent: a.hikePercent, p_new_ctc: a.newCtc,
    p_new_variable: a.newVariable, p_new_designation: a.newDesignation,
    p_additional_lines: a.additionalLines, p_effective_from: a.effectiveFrom,
    p_pay_out_month: a.payOutMonth, p_actor_id: null,
  })
  if (error) {
    return {
      error: /could not find the function/i.test(error.message)
        ? 'Appraisal needs migration sql111 — it is not applied to this database yet.'
        : error.message,
    }
  }
  return { error: null, record: data as AppraisalRecord }
}

/** Saved appraisals, newest first. payOutMonth filters to one pay-out month. */
export async function loadAppraisals(payOutMonth?: string): Promise<AppraisalRecord[]> {
  let q = supabase.from('appraisal_records').select('*').order('created_at', { ascending: false }).limit(200)
  if (payOutMonth) q = q.eq('pay_out_month', payOutMonth)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data as any) || []
}

/**
 * Which already-paid months this appraisal owes arrear for. Effective month up to the
 * month before pay-out; the pay-out month is excluded because regular salary covers it.
 */
export function backMonths(effectiveFrom: string, payOutMonth: string): string[] {
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const eff = new Date(effectiveFrom + 'T00:00:00')
  const pay = new Date(payOutMonth + 'T00:00:00')
  const out: string[] = []
  const cur = new Date(eff.getFullYear(), eff.getMonth(), 1)
  const end = new Date(pay.getFullYear(), pay.getMonth(), 1)
  while (cur < end) {
    out.push(`${M[cur.getMonth()]} ${String(cur.getFullYear()).slice(2)}`)
    cur.setMonth(cur.getMonth() + 1)
  }
  return out
}
