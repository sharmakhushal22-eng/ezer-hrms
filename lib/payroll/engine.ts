// lib/payroll/engine.ts — Payroll calculation engine.
// Adapted from the EZER Payroll build package to the LIVE schema:
//   • payroll_runs uses month (1=Apr..12=Mar) + fy (e.g. '2026-27'), not payroll_month/year
//   • salary_structures uses basic_monthly/hra_monthly/... (migration sql46), no is_current
//   • tds_declarations uses monthly_tds (migration sql44)
// Computes pro-rata earnings + EPF/ESIC/PT/LWF and wires VPF/NPS/Loan/TDS, then writes payroll_lines.
import { supabase } from '@/lib/supabase'
import { loadApprovedFlexiClaims } from '@/lib/payroll/flexi-payroll-sync'

const num = (v: any): number => (v === null || v === undefined || v === '' ? 0 : Number(v) || 0)
const round = (n: number) => Math.round(n)

// fy '2026-27' + month(1=Apr) → real calendar {year, month(1-12)}.
function calendarOf(fy: string, month: number): { year: number; cmonth: number; days: number } {
  const startYear = Number(String(fy).split('-')[0]) || new Date().getFullYear()
  const cmonth = month <= 9 ? month + 3 : month - 9   // 1(Apr)→4 … 10(Jan)→1
  const year = month <= 9 ? startYear : startYear + 1
  const days = new Date(year, cmonth, 0).getDate()
  return { year, cmonth, days }
}

// State-wise Professional Tax slab (monthly, fixed — not pro-rated).
function calcPT(gross: number, state: string): number {
  const PT: Record<string, [number, number, number][]> = {
    Haryana: [[0, 10000, 0], [10001, 999999, 200]],
    Maharashtra: [[0, 7500, 0], [7501, 10000, 175], [10001, 999999, 200]],
    Karnataka: [[0, 15000, 0], [15001, 999999, 200]],
    Telangana: [[0, 15000, 0], [15001, 20000, 150], [20001, 999999, 200]],
    'West Bengal': [[0, 10000, 0], [10001, 15000, 110], [15001, 25000, 130], [25001, 40000, 150], [40001, 999999, 200]],
  }
  const slabs = PT[state] || PT.Haryana
  const s = slabs.find(([lo, hi]) => gross >= lo && gross <= hi)
  return s?.[2] ?? 200
}

interface SalaryBase {
  source: 'salary_structure' | 'ctc_master' | 'pay_column'
  basic: number; hra: number; conveyance: number; special: number; statBonus: number
  gross: number; epfWage: number; ptFixed: number | null
  pf: boolean; esic: boolean; pt: boolean; lwf: boolean; state: string
}

// Resolve an employee's monthly salary base from the best available source.
async function loadBase(employeeId: string, fy: string): Promise<SalaryBase | null> {
  const { data: emp } = await supabase.from('employees')
    .select('employment_type, pf_applicable, esic_applicable, pt_applicable, lwf_applicable, professional_tax_state, intern_pay, consultant_pay, contract_pay')
    .eq('id', employeeId).maybeSingle()
  const type = emp?.employment_type
  const flags = {
    pf: emp?.pf_applicable !== false, esic: emp?.esic_applicable === true,
    pt: emp?.pt_applicable !== false, lwf: emp?.lwf_applicable === true,
    state: emp?.professional_tax_state || 'Haryana',
  }
  const payCol = (p: any): SalaryBase => ({
    source: 'pay_column', basic: num(p), hra: 0, conveyance: 0, special: 0, statBonus: 0,
    gross: num(p), epfWage: 15000, ptFixed: 0, pf: false, esic: false, pt: false, lwf: false, state: flags.state,
  })
  // Interns / consultants: the dedicated pay column is authoritative (no statutory).
  if (type === 'Intern' && num(emp?.intern_pay) > 0) return payCol(emp?.intern_pay)
  if (type === 'Consultant' && num(emp?.consultant_pay) > 0) return payCol(emp?.consultant_pay)

  // Regular + contract: migrated monthly structure.
  const { data: ss } = await supabase.from('salary_structures').select('*')
    .eq('employee_id', employeeId).eq('fy', fy).order('effective_date', { ascending: false }).limit(1)
  const s = ss?.[0]
  if (s) return {
    source: 'salary_structure',
    basic: num(s.basic_monthly), hra: num(s.hra_monthly), conveyance: num(s.conveyance),
    special: num(s.special_allowance), statBonus: num(s.statutory_bonus),
    gross: num(s.gross_monthly) || (num(s.basic_monthly) + num(s.hra_monthly) + num(s.conveyance) + num(s.special_allowance) + num(s.statutory_bonus)),
    epfWage: num(s.epf_wage) || 15000, ptFixed: s.pt_monthly != null ? num(s.pt_monthly) : null, ...flags,
  }
  // Fallback: annual CTC master.
  const { data: cm } = await supabase.from('ctc_master').select('*')
    .eq('employee_id', employeeId).order('effective_from', { ascending: false }).limit(1)
  const c = cm?.[0]
  if (c) {
    const basic = round(num(c.basic_annual) / 12), hra = round(num(c.hra_annual) / 12), gross = round(num(c.annual_ctc) / 12)
    return {
      source: 'ctc_master', basic, hra, conveyance: 1600, special: Math.max(0, gross - basic - hra - 1600),
      statBonus: round(Math.min(basic, 21000) * 0.0833), gross, epfWage: num(c.epf_wage_limit) || 15000, ptFixed: null, ...flags,
    }
  }
  // Last resort: contract pay column.
  if (type === 'Contract' && num(emp?.contract_pay) > 0) return payCol(emp?.contract_pay)
  return null
}

async function optionalMonthly(table: string, col: string, employeeId: string, extra?: (q: any) => any): Promise<number> {
  try {
    let q = supabase.from(table).select(col).eq('employee_id', employeeId)
    if (extra) q = extra(q)
    const { data } = await q.limit(1)
    return num((data as any)?.[0]?.[col])
  } catch { return 0 }
}

export interface PayrollLine { run_id: string; employee_id: string; [k: string]: any }

// Build one payroll_lines row for an employee.
async function calcLine(runId: string, employeeId: string, fy: string, lopDays: number, calDays: number, cal: { year: number; cmonth: number }, tdsMonthly: number, flexiReimb: number): Promise<PayrollLine | null> {
  const base = await loadBase(employeeId, fy)
  if (!base) return null

  const ratio = calDays > 0 ? Math.max(0, (calDays - lopDays) / calDays) : 1
  const basic = round(base.basic * ratio)
  const hra = round(base.hra * ratio)
  const conveyance = round(base.conveyance * ratio)
  const special = round(base.special * ratio)
  const statBonus = round(base.statBonus * ratio)
  const gross = basic + hra + conveyance + special + statBonus

  const epfWage = Math.min(basic, base.epfWage)
  const dedEPF = base.pf ? round(epfWage * 0.12) : 0
  const erPF = base.pf ? round(epfWage * 0.12) : 0
  const gratuity = base.pf ? round(basic * 0.0481) : 0
  const dedESIC = base.esic && gross <= 21000 ? round(gross * 0.0075) : 0
  const erESIC = base.esic && gross <= 21000 ? round(gross * 0.0325) : 0
  const dedPT = base.pt ? (base.ptFixed != null ? base.ptFixed : calcPT(gross, base.state)) : 0
  const dedLWF = base.lwf ? 25 : 0

  const dedVPF = await optionalMonthly('vpf_declarations', 'monthly_vpf_amount', employeeId, q => q.eq('status', 'ACTIVE'))
  const dedNPS = await optionalMonthly('nps_declarations', 'monthly_nps_amount', employeeId, q => q.eq('status', 'ACTIVE'))
  const monthStr = `${cal.year}-${String(cal.cmonth).padStart(2, '0')}`
  const dedLoan = await optionalMonthly('loan_schedule', 'emi_amount', employeeId, q => q.eq('month', monthStr).eq('status', 'PENDING'))
  const dedTDS = num(tdsMonthly)

  const totalDed = dedEPF + dedESIC + dedPT + dedLWF + dedTDS + dedVPF + dedNPS + dedLoan
  // Approved flexi reimbursement is paid out on top of gross (tax-exempt within declared limit).
  const flexi = num(flexiReimb)
  const grossWithFlexi = gross + flexi
  const netPay = grossWithFlexi - totalDed

  return {
    run_id: runId, employee_id: employeeId,
    basic, hra, conveyance, special_allow: special, statutory_bonus: statBonus, other_earnings: 0,
    gross_earning: grossWithFlexi, flexi_reimbursement: flexi,
    ded_epf: dedEPF, ded_vpf: dedVPF, ded_esic: dedESIC, ded_pt: dedPT, ded_lwf: dedLWF,
    ded_tds: dedTDS, ded_nps: dedNPS, ded_loan_emi: dedLoan,
    total_deductions: totalDed, net_pay: netPay,
    employer_pf: erPF, employer_esic: erESIC, gratuity,
    earnings_json: { basic, hra, conveyance, special_allowance: special, statutory_bonus: statBonus, flexi_reimbursement: flexi },
    deductions_json: { epf: dedEPF, esic: dedESIC, pt: dedPT, lwf: dedLWF, tds: dedTDS, vpf: dedVPF, nps: dedNPS, loan_emi: dedLoan },
  }
}

export interface RunResult { processed: number; skipped: number; errors: string[]; totalGross: number; totalNet: number }

// Calculate the whole run → populate payroll_lines + update run totals.
export async function processPayrollRun(runId: string): Promise<RunResult> {
  const empty: RunResult = { processed: 0, skipped: 0, errors: [], totalGross: 0, totalNet: 0 }
  const { data: run } = await supabase.from('payroll_runs').select('id, company_id, fy, month').eq('id', runId).single()
  if (!run) return { ...empty, errors: ['Run not found'] }

  const { data: atts } = await supabase.from('payroll_attendance_snapshot')
    .select('employee_id, lop_days').eq('run_id', runId)
  if (!atts?.length) return { ...empty, errors: ['No employee snapshot for this run — press “Sync employees” first.'] }

  const cal = calendarOf(run.fy, run.month)
  const empIds = atts.map((a: any) => a.employee_id)

  const tdsMap: Record<string, number> = {}
  try {
    const { data: tds } = await supabase.from('tds_declarations').select('employee_id, monthly_tds').in('employee_id', empIds).eq('fy', run.fy)
    ;(tds || []).forEach((t: any) => { tdsMap[t.employee_id] = num(t.monthly_tds) })
  } catch { /* tds optional */ }

  // Approved flexi claims for this run's calendar month → reimbursement per employee.
  let flexiMap = new Map<string, { total_flexi_reimbursement: number }>()
  try { flexiMap = await loadApprovedFlexiClaims(run.company_id, cal.year, cal.cmonth) } catch { /* flexi optional */ }

  let processed = 0, skipped = 0
  const errors: string[] = []
  for (const att of atts as any[]) {
    try {
      const flexi = flexiMap.get(att.employee_id)?.total_flexi_reimbursement || 0
      const line = await calcLine(runId, att.employee_id, run.fy, num(att.lop_days), cal.days, cal, tdsMap[att.employee_id] || 0, flexi)
      if (!line) { skipped++; errors.push(`${att.employee_id}: no salary data on file`); continue }
      const { error } = await supabase.from('payroll_lines').upsert(line, { onConflict: 'run_id,employee_id' })
      if (error) { errors.push(`${att.employee_id}: ${error.message}`); continue }
      processed++
    } catch (e: any) { errors.push(`${att.employee_id}: ${e?.message || 'calc error'}`) }
  }

  const { data: lines } = await supabase.from('payroll_lines').select('gross_earning, net_pay').eq('run_id', runId)
  const totalGross = (lines || []).reduce((s: number, l: any) => s + num(l.gross_earning), 0)
  const totalNet = (lines || []).reduce((s: number, l: any) => s + num(l.net_pay), 0)
  await supabase.from('payroll_runs').update({ total_gross: totalGross, total_net: totalNet, emp_count: processed, updated_at: new Date().toISOString() }).eq('id', runId)

  return { processed, skipped, errors, totalGross, totalNet }
}

// Orchestrator: run the engine then move status OPEN/SYNCED/ATTENDANCE_LOCKED → CALCULATED + audit.
export async function calculateRun(run: { id: string; company_id: string; status: string }): Promise<{ error: string | null; result?: RunResult }> {
  if (!['SYNCED', 'ATTENDANCE_LOCKED', 'CALCULATED'].includes(run.status)) {
    return { error: 'Sync employees into this run before calculating.' }
  }
  const result = await processPayrollRun(run.id)
  if (!result.processed && result.errors.length) return { error: result.errors[0], result }
  await supabase.from('payroll_runs').update({ status: 'CALCULATED', updated_at: new Date().toISOString() }).eq('id', run.id)
  await supabase.from('payroll_audit_log').insert({ run_id: run.id, company_id: run.company_id, action: 'PAYROLL_CALCULATED', detail: { processed: result.processed, skipped: result.skipped, total_net: result.totalNet }, performed_by: 'HR' })
  return { error: null, result }
}
