// lib/payroll/core.ts — Payroll core data layer (migration 044).
// Pay-heads config CRUD + payroll run month lifecycle (create / list / advance status).
import { supabase } from '@/lib/supabase'

export interface PayHead { id: string; company_id: string | null; code: string; name: string; head_type: string; taxable: boolean; calc_type: string; calc_value: number | null; sort_order: number; is_active: boolean }
export interface PayrollRun { id: string; company_id: string; company_name?: string | null; fy: string; month: number; period_label: string | null; run_type: string; status: string; total_gross: number; total_net: number; emp_count: number; created_at: string; locked_at: string | null }

export const MONTHS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar']
// Run status lifecycle (guide §3).
export const RUN_FLOW = ['OPEN', 'SYNCED', 'ATTENDANCE_LOCKED', 'CALCULATED', 'AI_CHECKED', 'APPROVED', 'DISBURSED', 'LOCKED']
export function nextStatus(s: string): string | null {
  const i = RUN_FLOW.indexOf(s)
  return i >= 0 && i < RUN_FLOW.length - 1 ? RUN_FLOW[i + 1] : null
}

export async function loadCompanies() {
  const { data } = await supabase.from('companies').select('id, company_name, group_id, groups(group_name)').eq('status', 'Active').order('company_name')
  return (data || []).map((c: any) => ({ id: c.id, company_name: c.company_name, group_id: c.group_id || null, group_name: c.groups?.group_name || null }))
}

// ── Pay heads ──
export async function loadPayHeads(companyId: string): Promise<PayHead[]> {
  const { data } = await supabase.from('pay_heads').select('*').eq('company_id', companyId).order('sort_order').order('code')
  return (data as any) || []
}
export async function savePayHead(companyId: string, h: Partial<PayHead>): Promise<{ error: string | null }> {
  const { error } = await supabase.from('pay_heads').upsert({
    company_id: companyId, code: h.code, name: h.name, head_type: h.head_type,
    taxable: h.taxable ?? true, calc_type: h.calc_type || 'FIXED', calc_value: h.calc_value ?? null,
    sort_order: h.sort_order ?? 0, is_active: h.is_active ?? true,
  }, { onConflict: 'company_id,code' })
  return { error: error?.message || null }
}
export async function deletePayHead(id: string) { await supabase.from('pay_heads').delete().eq('id', id) }

// ── Payroll runs ──
// companyId '' → all companies. fy '' → all financial years.
export async function loadRuns(companyId: string, fy?: string): Promise<PayrollRun[]> {
  let q = supabase.from('payroll_runs').select('*, companies(company_name)')
    .order('fy', { ascending: false }).order('month', { ascending: false })
  if (companyId) q = q.eq('company_id', companyId)
  if (fy) q = q.eq('fy', fy)
  const { data } = await q
  return ((data as any[]) || []).map(r => ({ ...r, company_name: r.companies?.company_name || null }))
}
export async function createRun(companyId: string, fy: string, month: number, runType = 'REGULAR'): Promise<{ error: string | null; run?: PayrollRun }> {
  const periodLabel = `${MONTHS[month - 1]} ${fy.split('-')[0]}`
  const { data, error } = await supabase.from('payroll_runs').insert({
    company_id: companyId, fy, month, period_label: periodLabel, run_type: runType, status: 'OPEN',
  }).select().single()
  if (error) return { error: error.message }
  await supabase.from('payroll_audit_log').insert({ run_id: data.id, company_id: companyId, action: 'RUN_CREATED', detail: { period: periodLabel }, performed_by: 'HR' })
  return { error: null, run: data as any }
}
export async function advanceRun(run: PayrollRun): Promise<{ error: string | null }> {
  const ns = nextStatus(run.status)
  if (!ns) return { error: 'Run is already at the final stage.' }
  const patch: any = { status: ns, updated_at: new Date().toISOString() }
  if (ns === 'LOCKED') patch.locked_at = new Date().toISOString()
  const { error } = await supabase.from('payroll_runs').update(patch).eq('id', run.id)
  if (error) return { error: error.message }
  await supabase.from('payroll_audit_log').insert({ run_id: run.id, company_id: run.company_id, action: 'STATUS_' + ns, performed_by: 'HR' })
  return { error: null }
}
export async function cancelRun(run: PayrollRun) {
  await supabase.from('payroll_runs').update({ status: 'CANCELLED' }).eq('id', run.id)
  await supabase.from('payroll_audit_log').insert({ run_id: run.id, company_id: run.company_id, action: 'RUN_CANCELLED', performed_by: 'HR' })
}
export async function loadAudit(companyId: string) {
  let q = supabase.from('payroll_audit_log').select('*').order('created_at', { ascending: false }).limit(30)
  if (companyId) q = q.eq('company_id', companyId)   // '' = all companies
  const { data } = await q
  return data || []
}

// ── Run summary: statutory totals for the summary stats bar, + variance vs the previous run ──
export interface RunSummary {
  employees: number; gross: number; net: number
  epf: number; esic: number; pt: number; lwf: number; tds: number
  nps: number; vpf: number; loanEmi: number; flexi: number
  employerPf: number; employerEsic: number; gratuity: number; totalDeductions: number
  prevNet: number | null; variancePct: number | null   // net vs previous run
}
const s = (rows: any[], k: string) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0)

export async function loadRunSummary(run: PayrollRun): Promise<RunSummary> {
  const { data: lines } = await supabase.from('payroll_lines').select('*').eq('run_id', run.id)
  const L = lines || []
  const net = s(L, 'net_pay')

  // Previous run for this company (by fy/month order) that has lines → variance.
  let prevNet: number | null = null
  const { data: runs } = await supabase.from('payroll_runs').select('id, fy, month')
    .eq('company_id', run.company_id).neq('id', run.id).neq('status', 'CANCELLED')
    .order('fy', { ascending: false }).order('month', { ascending: false })
  const cur = `${run.fy}-${String(run.month).padStart(2, '0')}`
  const prev = (runs || []).find(r => `${r.fy}-${String(r.month).padStart(2, '0')}` < cur)
  if (prev) {
    const { data: pl } = await supabase.from('payroll_lines').select('net_pay').eq('run_id', prev.id)
    if (pl && pl.length) prevNet = s(pl, 'net_pay')
  }
  const variancePct = prevNet && prevNet > 0 ? Math.round(((net - prevNet) / prevNet) * 1000) / 10 : null

  return {
    employees: L.length, gross: s(L, 'gross_earning'), net,
    epf: s(L, 'ded_epf'), esic: s(L, 'ded_esic'), pt: s(L, 'ded_pt'), lwf: s(L, 'ded_lwf'), tds: s(L, 'ded_tds'),
    nps: s(L, 'ded_nps'), vpf: s(L, 'ded_vpf'), loanEmi: s(L, 'ded_loan_emi'), flexi: s(L, 'flexi_reimbursement'),
    employerPf: s(L, 'employer_pf'), employerEsic: s(L, 'employer_esic'), gratuity: s(L, 'gratuity'),
    totalDeductions: s(L, 'total_deductions'), prevNet, variancePct,
  }
}

// ── NEFT bank file rows (net pay per employee + bank details) ──
export async function buildNeftRows(runId: string): Promise<Record<string, string>[]> {
  const [{ data: lines }, { data: snap }] = await Promise.all([
    supabase.from('payroll_lines').select('employee_id, net_pay').eq('run_id', runId),
    supabase.from('payroll_employee_snapshot').select('employee_id, employee_code, full_name, bank_account_last4, ifsc_code').eq('run_id', runId),
  ])
  const snapBy = new Map<string, any>((snap || []).map((x: any) => [x.employee_id, x]))
  return (lines || []).filter((l: any) => Number(l.net_pay) > 0).map((l: any) => {
    const x = snapBy.get(l.employee_id) || {}
    return {
      beneficiary_name: x.full_name || '', emp_code: x.employee_code || '',
      account_last4: x.bank_account_last4 || '', ifsc_code: x.ifsc_code || '',
      amount: (Number(l.net_pay) || 0).toFixed(2), narration: 'SALARY',
    }
  })
}

// Register for a run = payroll_lines + attendance snapshot + employee snapshot (names),
// flattened into one row per employee for an Excel export.
export async function loadRunRegister(runId: string): Promise<Record<string, any>[]> {
  const [{ data: lines }, { data: att }, { data: snap }] = await Promise.all([
    supabase.from('payroll_lines').select('*').eq('run_id', runId),
    supabase.from('payroll_attendance_snapshot').select('*').eq('run_id', runId),
    supabase.from('payroll_employee_snapshot').select('employee_id, employee_code, full_name, department, location, annual_ctc, basic_monthly, hra_monthly, bank_account_last4, ifsc_code').eq('run_id', runId),
  ])
  const attBy = new Map<string, any>((att || []).map((a: any) => [a.employee_id, a]))
  const snapBy = new Map<string, any>((snap || []).map((s: any) => [s.employee_id, s]))
  return (lines || []).map((l: any) => {
    const a = attBy.get(l.employee_id) || {}
    const s = snapBy.get(l.employee_id) || {}
    const clean = (o: any, skip: string[]) => { const r: any = {}; for (const [k, v] of Object.entries(o || {})) if (!skip.includes(k)) r[k] = (v === null || v === undefined) ? '' : (typeof v === 'object' ? JSON.stringify(v) : v); return r }
    return {
      employee_code: s.employee_code || '', full_name: s.full_name || '', department: s.department || '', location: s.location || '',
      annual_ctc: s.annual_ctc ?? '', basic_monthly: s.basic_monthly ?? '', hra_monthly: s.hra_monthly ?? '',
      payable_days: a.payable_days ?? '', present_days: a.present_days ?? '', lop_days: a.lop_days ?? '', arrear_days: a.arrear_days ?? '',
      ...clean(l, ['id', 'run_id', 'created_at']),
      bank_account_last4: s.bank_account_last4 || '', ifsc_code: s.ifsc_code || '',
    }
  })
}

// ── Employees & CTC (payroll view) — HRMS is the source of truth ──
export interface PayrollEmployee {
  id: string; emp_code: string; full_name: string; designation: string | null
  department: string | null; location: string | null
  annual_ctc: number; basic_monthly: number; hra_monthly: number
  bank_name: string | null; ifsc_code: string | null; bank_account_last4: string | null
  pf_applicable: boolean; esic_applicable: boolean; pt_applicable: boolean; lwf_applicable: boolean
  tds_regime: string | null
}
export async function loadPayrollEmployees(companyId: string): Promise<PayrollEmployee[]> {
  const { data: emps } = await supabase.from('employees')
    .select('id, emp_code, full_name, designation, tds_regime, pf_applicable, esic_applicable, pt_applicable, lwf_applicable, bank_name, ifsc_code, bank_account_last4, departments(dept_name), locations!location_id(location_name)')
    .eq('company_id', companyId).eq('employment_status', 'Active').order('emp_code')
  const list = (emps as any[]) || []
  if (!list.length) return []
  const ids = list.map(e => e.id)
  const { data: ctcs } = await supabase.from('ctc_master').select('employee_id, annual_ctc, annual_variable, basic_annual, hra_annual').in('employee_id', ids)
  const ctcBy = new Map<string, any>((ctcs || []).map((c: any) => [c.employee_id, c]))
  return list.map(e => {
    const c = ctcBy.get(e.id)
    return {
      id: e.id, emp_code: e.emp_code, full_name: e.full_name, designation: e.designation,
      department: e.departments?.dept_name || null, location: e.locations?.location_name || null,
      annual_ctc: Number(c?.annual_ctc || 0), basic_monthly: Math.round((c?.basic_annual || 0) / 12), hra_monthly: Math.round((c?.hra_annual || 0) / 12),
      bank_name: e.bank_name, ifsc_code: e.ifsc_code, bank_account_last4: e.bank_account_last4,
      pf_applicable: !!e.pf_applicable, esic_applicable: !!e.esic_applicable, pt_applicable: !!e.pt_applicable, lwf_applicable: !!e.lwf_applicable,
      tds_regime: e.tds_regime,
    }
  })
}

// ── Employee sync (HRMS → Payroll): freeze snapshot into a run, OPEN → SYNCED ──
export async function syncRunEmployees(run: PayrollRun): Promise<{ error: string | null; count: number }> {
  const emps = await loadPayrollEmployees(run.company_id)
  if (!emps.length) return { error: 'No active employees to sync for this company.', count: 0 }
  const snapRows = emps.map(e => ({
    run_id: run.id, employee_id: e.id, employee_code: e.emp_code, full_name: e.full_name,
    department: e.department, location: e.location, annual_ctc: e.annual_ctc,
    basic_monthly: e.basic_monthly, hra_monthly: e.hra_monthly,
    bank_account_last4: e.bank_account_last4, ifsc_code: e.ifsc_code,
  }))
  // Replace any prior snapshot for this run, then re-freeze.
  await supabase.from('payroll_employee_snapshot').delete().eq('run_id', run.id)
  const { error: se } = await supabase.from('payroll_employee_snapshot').upsert(snapRows, { onConflict: 'run_id,employee_id' })
  if (se) return { error: se.message, count: 0 }

  // Attendance snapshot for the month (best-effort; days from attendance_records).
  try {
    const y = Number(run.fy.split('-')[0]); const cal = run.month <= 9 ? run.month + 3 : run.month - 9
    const yr = run.month <= 9 ? y : y + 1
    const from = `${yr}-${String(cal).padStart(2, '0')}-01`
    const to = `${yr}-${String(cal).padStart(2, '0')}-${new Date(yr, cal, 0).getDate()}`
    const { data: att } = await supabase.from('attendance_records').select('employee_id, status').gte('attendance_date', from).lte('attendance_date', to).in('employee_id', emps.map(e => e.id))
    const agg = new Map<string, { present: number; lop: number }>()
    ;(att || []).forEach((r: any) => {
      const a = agg.get(r.employee_id) || { present: 0, lop: 0 }
      if (r.status === 'PRESENT' || r.status === 'HALF_DAY') a.present += r.status === 'HALF_DAY' ? 0.5 : 1
      if (r.status === 'ABSENT' || r.status === 'LWP') a.lop += 1
      agg.set(r.employee_id, a)
    })
    await supabase.from('payroll_attendance_snapshot').delete().eq('run_id', run.id)
    const attRows = emps.map(e => { const a = agg.get(e.id) || { present: 0, lop: 0 }; return { run_id: run.id, employee_id: e.id, present_days: a.present, lop_days: a.lop, payable_days: a.present } })
    await supabase.from('payroll_attendance_snapshot').upsert(attRows, { onConflict: 'run_id,employee_id' })
  } catch { /* attendance snapshot best-effort */ }

  const patch: any = { emp_count: emps.length, updated_at: new Date().toISOString() }
  if (run.status === 'OPEN') patch.status = 'SYNCED'
  await supabase.from('payroll_runs').update(patch).eq('id', run.id)
  await supabase.from('payroll_audit_log').insert({ run_id: run.id, company_id: run.company_id, action: 'EMPLOYEES_SYNCED', detail: { count: emps.length }, performed_by: 'HR' })
  return { error: null, count: emps.length }
}
