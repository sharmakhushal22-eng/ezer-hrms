// src/features/payroll-tax/salary.ts — the employee's real salary structure, as the
// Flexi & TDS calculator reads it.
//
// SOURCE: lib/employees/hr-actions.ts loadSalary() + loadSalaryFromMaster() (lines
// 84–205). That module imports @/lib/supabase, so it cannot be shared through @web;
// the queries are copied verbatim here and the SalaryBreakup derivation is copied
// line for line. Only `detail` matters to the calculator (rd = real?.detail), and the
// onboarding path returns no detail at all — exactly as on the website.
import { supabase } from '@/core/supabase'

export interface SalaryBreakup {
  payType: string | null
  basic: number; hra: number; statBonus: number; conveyance: number; special: number; gross: number
  specialGross: number; flexiMonthly: number
  erPf: number; erEsic: number; gratuity: number
  eePf: number; eeEsic: number; pt: number; lwf: number; net: number
  fixedMonthly: number; variableAnnual: number; annualCtc: number; totalCtc: number
  simpleKind?: 'STIPEND' | 'CONSULTANT'
  stipend?: number
  gst?: number
  tds?: boolean
}

/** loadSalary(employeeId) → the `detail` breakup, or null (onboarding CTC path / no data). */
export async function loadSalaryDetail(employeeId: string): Promise<SalaryBreakup | null> {
  const { data: oc } = await supabase.from('onboarding_candidates')
    .select('candidate_id, offered_ctc').eq('employee_id', employeeId)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  let neg: any = null
  if ((oc as any)?.candidate_id) {
    const { data } = await supabase.from('ctc_negotiations').select('*')
      .eq('candidate_id', (oc as any).candidate_id).order('created_at', { ascending: false }).limit(1).maybeSingle()
    neg = data
  }
  // The onboarding path builds no breakup → the calculator's rd is null.
  if (neg || (oc as any)?.offered_ctc) return null
  return loadDetailFromMaster(employeeId)
}

async function loadDetailFromMaster(employeeId: string): Promise<SalaryBreakup | null> {
  let emp: any = null, ctc: any = null, sal: any = null
  try {
    const { data } = await supabase.from('employees')
      .select('employment_type, intern_pay, consultant_pay, contract_pay').eq('id', employeeId).maybeSingle()
    emp = data
  } catch { /* pay columns may not exist yet */ }
  if (!emp) {
    try { const { data } = await supabase.from('employees').select('employment_type').eq('id', employeeId).maybeSingle(); emp = data } catch { /* ignore */ }
  }
  try {
    const { data } = await supabase.from('ctc_master').select('*')
      .eq('employee_id', employeeId).order('effective_from', { ascending: false }).limit(1).maybeSingle()
    ctc = data
  } catch { /* ctc_master optional */ }
  try {
    const { data } = await supabase.from('salary_structures').select('*')
      .eq('employee_id', employeeId).order('effective_date', { ascending: false }).limit(1).maybeSingle()
    sal = data
  } catch { /* salary_structures optional */ }
  return buildDetail(emp, ctc, sal)
}

/** hr-actions.ts lines 136–193, verbatim. */
export function buildDetail(emp: any, ctc: any, sal: any): SalaryBreakup | null {
  const type = emp?.employment_type
  const perMonth = (annual: any) => (annual != null ? Math.round(Number(annual) / 12) : null)
  const n = (v: any) => (v === null || v === undefined || v === '' ? 0 : Number(v) || 0)

  const STIPEND_TYPES = ['Intern', 'NAPS', 'NATS']
  const isStipend = STIPEND_TYPES.includes(type)
  const isConsultant = type === 'Consultant'

  const payMonthly = isStipend ? (emp?.intern_pay ?? perMonth(ctc?.annual_ctc))
    : isConsultant ? emp?.consultant_pay
    : type === 'Contract' ? emp?.contract_pay : null

  if (!ctc && !sal && payMonthly == null) return null

  if ((isStipend || isConsultant) && payMonthly != null) {
    const pay = Number(payMonthly)
    const gst = isConsultant ? Math.round(pay * 0.18) : 0
    return {
      payType: isConsultant ? 'Consultant Fee' : 'Stipend',
      basic: pay, hra: 0, statBonus: 0, conveyance: 0, special: 0, gross: pay, specialGross: 0, flexiMonthly: 0,
      erPf: 0, erEsic: 0, gratuity: 0, eePf: 0, eeEsic: 0, pt: 0, lwf: 0, net: pay,
      fixedMonthly: pay, variableAnnual: 0, annualCtc: pay * 12, totalCtc: pay * 12,
      simpleKind: isConsultant ? 'CONSULTANT' : 'STIPEND',
      stipend: pay, gst, tds: isConsultant,
    }
  }

  let detail: SalaryBreakup | null = null
  if (sal) {
    const gross = n(sal.gross_monthly) || (n(sal.basic_monthly) + n(sal.hra_monthly) + n(sal.statutory_bonus) + n(sal.conveyance) + (n(sal.special_allowance_gross) || n(sal.special_allowance)))
    const fixedMonthly = gross + n(sal.employer_pf) + n(sal.employer_esic) + n(sal.gratuity_monthly)
    const variableAnnual = n(sal.variable_annual) || n(ctc?.annual_variable)
    detail = {
      payType: sal.pay_type || 'Regular',
      basic: n(sal.basic_monthly), hra: n(sal.hra_monthly), statBonus: n(sal.statutory_bonus),
      conveyance: n(sal.conveyance), special: n(sal.special_allowance), gross,
      specialGross: n(sal.special_allowance_gross) || n(sal.special_allowance),
      flexiMonthly: Math.max(0, n(sal.special_allowance_gross) - n(sal.special_allowance)),
      erPf: n(sal.employer_pf), erEsic: n(sal.employer_esic), gratuity: n(sal.gratuity_monthly),
      eePf: n(sal.employee_pf), eeEsic: n(sal.employee_esic), pt: n(sal.pt_monthly), lwf: n(sal.lwf_monthly),
      net: n(sal.net_take_home) || (gross - n(sal.employee_pf) - n(sal.employee_esic) - n(sal.pt_monthly) - n(sal.lwf_monthly)),
      fixedMonthly, variableAnnual,
      annualCtc: n(ctc?.annual_ctc) || fixedMonthly * 12,
      totalCtc: n(sal.total_ctc) || (fixedMonthly * 12 + variableAnnual),
    }
  } else if (ctc) {
    const basic = perMonth(ctc.basic_annual) || 0, hra = perMonth(ctc.hra_annual) || 0
    const gross = perMonth(ctc.annual_ctc) || 0
    detail = {
      payType: 'Regular', basic, hra, statBonus: 0, conveyance: 0, special: Math.max(0, gross - basic - hra), gross,
      specialGross: Math.max(0, gross - basic - hra), flexiMonthly: 0,
      erPf: 0, erEsic: 0, gratuity: 0, eePf: 0, eeEsic: 0, pt: 0, lwf: 0, net: gross,
      fixedMonthly: gross, variableAnnual: n(ctc.annual_variable), annualCtc: n(ctc.annual_ctc), totalCtc: n(ctc.annual_ctc),
    }
  }
  return detail
}
