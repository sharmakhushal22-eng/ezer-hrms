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
// Month Master snapshot — freeze employee org/statutory/bank/CTC/salary at Month Create.
// Re-runnable; never touches attendance columns. Returns the number of employees frozen.
export async function syncPayrollMonth(runId: string): Promise<{ error: string | null; count: number }> {
  const { data, error } = await supabase.rpc('sync_payroll_month', { p_run_id: runId })
  return { error: error?.message || null, count: (data as number) || 0 }
}

export interface AttendanceUploadRow {
  emp_code: string; earned_leave?: number; casual_leave?: number
  sick_leave?: number; other_leave?: number; absent_days?: number; weekly_off?: number
}
export interface OtUploadRow { emp_code: string; ot_hours: number }
export interface BatchResult { emp_code: string; result: string }

// Attendance/leave upload — matches emp_code within a run. paid_days is
// computed server-side as (EL+CL+SL+Other) − Absent. Never touches ot_hours.
export async function uploadAttendanceBatch(runId: string, rows: AttendanceUploadRow[]): Promise<{ error: string | null; results: BatchResult[] }> {
  const { data, error } = await supabase.rpc('upload_attendance_batch', { p_run_id: runId, p_rows: rows })
  return { error: error?.message || null, results: (data as any[]) || [] }
}
// Separate OT upload — touches ONLY ot_hours, so it can't overwrite attendance.
export async function uploadOtBatch(runId: string, rows: OtUploadRow[]): Promise<{ error: string | null; results: BatchResult[] }> {
  const { data, error } = await supabase.rpc('upload_ot_batch', { p_run_id: runId, p_rows: rows })
  return { error: error?.message || null, results: (data as any[]) || [] }
}
// The run's valid emp codes — fetched once for the client-side "% checking"
// validation pass before Process (no per-row round-trip).
export async function getValidEmpCodesForRun(runId: string): Promise<Set<string>> {
  const { data, error } = await supabase.rpc('get_valid_emp_codes_for_run', { p_run_id: runId })
  if (error) throw new Error(error.message)
  return new Set(((data as any[]) || []).map(r => String(r.employee_code)))
}
// Attendance Edit tab — per-employee. Only the fields passed change; the rest stay.
// Paid Days is NOT accepted here: the server always recomputes it as
// (EL+CL+SL+Other) − Absent, the same rule the upload uses, so the two can't drift.
// runStatusReset is true when the run had already been calculated and was rolled back
// to SYNCED — the caller should tell the user payroll must be recalculated.
export async function editEmployeeAttendance(runId: string, empCode: string, fields: {
  earned_leave?: number | null; casual_leave?: number | null
  sick_leave?: number | null; other_leave?: number | null; absent_days?: number | null
  ot_hours?: number | null; weekly_off?: number | null
}): Promise<{ error: string | null; paidDays: number | null; runStatusReset: boolean }> {
  const { data, error } = await supabase.rpc('edit_employee_attendance', {
    p_run_id: runId, p_employee_code: empCode,
    p_earned_leave: fields.earned_leave ?? null, p_casual_leave: fields.casual_leave ?? null,
    p_sick_leave: fields.sick_leave ?? null, p_other_leave: fields.other_leave ?? null,
    p_absent_days: fields.absent_days ?? null, p_ot_hours: fields.ot_hours ?? null,
    p_weekly_off: fields.weekly_off ?? null,
  })
  if (error) return { error: error.message, paidDays: null, runStatusReset: false }
  const row = ((data as any[]) || [])[0] || {}
  return { error: null, paidDays: row.updated_row?.paid_days ?? null, runStatusReset: !!row.run_status_reset }
}
// Arrear days from a prior period, landing in the CURRENT run. Source month untouched.
export async function addArrearDays(runId: string, empCode: string, arrearDays: number, sourcePeriod: string, reason: string): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('add_arrear_days', {
    p_run_id: runId, p_employee_code: empCode, p_arrear_days: arrearDays,
    p_source_period: sourcePeriod, p_reason: reason || null,
  })
  return { error: error?.message || null }
}

// The arrear / taxable side-table shapes, prefixed as they appear in the export.
const ARREAR_COLS = [
  'arrear_basic', 'arrear_hra', 'arrear_conveyance', 'arrear_special_allowance', 'arrear_statutory_bonus',
  'arrear_employer_pf', 'arrear_employer_esic', 'arrear_gratuity', 'arrear_employee_pf', 'arrear_employee_esic',
  'arrear_pt', 'arrear_lwf', 'arrear_hostel_allowance', 'arrear_children_education',
  'arrear_flexi_car_lease', 'arrear_flexi_driver_salary', 'arrear_flexi_fuel_maintenance',
  'arrear_flexi_telephone_internet', 'arrear_flexi_meal_card', 'arrear_flexi_gadget_device',
  'arrear_flexi_attire_uniform', 'arrear_flexi_books_periodicals', 'arrear_flexi_lta',
  'arrear_epf_wage', 'arrear_appraisal_effective_date',
]
const TAXABLE_COLS = [
  'taxable_adjustment_lwf', 'taxable_hostel_allowance', 'taxable_children_education',
  'taxable_flexi_car_lease', 'taxable_flexi_driver_salary', 'taxable_flexi_fuel_maintenance',
  'taxable_flexi_telephone_internet', 'taxable_flexi_meal_card', 'taxable_flexi_gadget_device',
  'taxable_flexi_attire_uniform', 'taxable_flexi_books_periodicals', 'taxable_flexi_lta',
]

// Full Month Master rows for one or more runs — every frozen column, ready for export.
// Paginated because PostgREST caps a response at 1000 rows, and a group month spans
// several companies. Internal keys are dropped; Company is prefixed for group exports.
export async function loadMonthMaster(runs: { id: string; company_name?: string | null; fy?: string }[]): Promise<Record<string, any>[]> {
  const out: Record<string, any>[] = []
  const empIds: string[] = []
  const fys = new Set<string>()
  for (const r of runs) {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from('payroll_employee_snapshot')
        .select('*').eq('run_id', r.id).order('employee_code').range(from, from + 999)
      if (error) throw new Error(error.message)
      const batch = data || []
      batch.forEach((row: any) => {
        empIds.push(row.employee_id)
        if (row.fy) fys.add(row.fy)
        // id / run_id / employee_id are part of the agreed column spec (System / Base),
        // so they are carried through rather than stripped as internal keys.
        out.push({ Company: r.company_name || '', ...row })
      })
      if (batch.length < 1000) break
    }
  }
  if (!out.length) return out
  if (runs[0]?.fy) fys.add(runs[0].fy as string)

  // Arrear and taxable are financial-year scoped and keep moving through the year, so
  // they are joined live at export time rather than frozen into the snapshot — a frozen
  // copy would show figures that were already out of date.
  const ids = Array.from(new Set(empIds))
  const fyList = Array.from(fys)
  const side = async (table: string, prefix: string) => {
    const by = new Map<string, any>()
    for (let i = 0; i < ids.length; i += 300) {
      let q = supabase.from(table).select('*').in('employee_id', ids.slice(i, i + 300))
      if (fyList.length) q = q.in('fy', fyList)
      const { data } = await q
      ;(data || []).forEach((row: any) => {
        const { id, employee_id, company_id, fy, created_at, updated_at, ...rest } = row
        const clean: Record<string, any> = {}
        Object.entries(rest).forEach(([k, v]) => { clean[k.startsWith(prefix) ? k : `${prefix}${k}`] = v })
        by.set(employee_id, clean)
      })
    }
    return by
  }
  let arrearBy = new Map<string, any>(), taxableBy = new Map<string, any>()
  try { arrearBy = await side('arrear', 'arrear_') } catch { /* table optional */ }
  try { taxableBy = await side('taxable', 'taxable_') } catch { /* table optional */ }

  // Column lists are pinned rather than derived from the returned rows: both tables are
  // empty until the arrear / tax runs populate them, and a shape derived from data would
  // silently drop every one of these columns from the report while that is true.
  const arrearCols = new Set<string>(ARREAR_COLS)
  const taxableCols = new Set<string>(TAXABLE_COLS)
  arrearBy.forEach(v => Object.keys(v).forEach(k => arrearCols.add(k)))
  taxableBy.forEach(v => Object.keys(v).forEach(k => taxableCols.add(k)))
  return out.map(row => {
    const eid = row.employee_id
    const a = arrearBy.get(eid) || {}, t = taxableBy.get(eid) || {}
    const merged: Record<string, any> = { ...row }
    arrearCols.forEach(k => { merged[k] = a[k] ?? '' })
    taxableCols.forEach(k => { merged[k] = t[k] ?? '' })
    return merged
  })
}

// Directly set a run's status — used by the Payroll Month controls (Freeze / Lock / reopen).
export async function setRunStatus(run: PayrollRun, status: string): Promise<{ error: string | null }> {
  const patch: any = { status, updated_at: new Date().toISOString() }
  patch.locked_at = status === 'LOCKED' ? new Date().toISOString() : null
  const { error } = await supabase.from('payroll_runs').update(patch).eq('id', run.id)
  if (error) return { error: error.message }
  await supabase.from('payroll_audit_log').insert({ run_id: run.id, company_id: run.company_id, action: 'STATUS_' + status, performed_by: 'HR' })
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
  company: string | null; department: string | null; location: string | null
  annual_ctc: number; basic_monthly: number; hra_monthly: number
  bank_name: string | null; ifsc_code: string | null; bank_account_last4: string | null
  pf_applicable: boolean; esic_applicable: boolean; pt_applicable: boolean; lwf_applicable: boolean
  tds_regime: string | null
}
export async function loadPayrollEmployees(companyId: string): Promise<PayrollEmployee[]> {
  let q = supabase.from('employees')
    .select('id, emp_code, full_name, designation, tds_regime, pf_applicable, esic_applicable, pt_applicable, lwf_applicable, bank_name, ifsc_code, bank_account_last4, companies(company_name), departments(dept_name), locations!location_id(location_name)')
    .eq('employment_status', 'Active').order('emp_code')
  if (companyId) q = q.eq('company_id', companyId)   // '' = all companies (Group Companies mode)
  const { data: emps } = await q
  const list = (emps as any[]) || []
  if (!list.length) return []
  const ids = list.map(e => e.id)
  const { data: ctcs } = await supabase.from('ctc_master').select('employee_id, annual_ctc, annual_variable, basic_annual, hra_annual').in('employee_id', ids)
  const ctcBy = new Map<string, any>((ctcs || []).map((c: any) => [c.employee_id, c]))
  return list.map(e => {
    const c = ctcBy.get(e.id)
    return {
      id: e.id, emp_code: e.emp_code, full_name: e.full_name, designation: e.designation,
      company: e.companies?.company_name || null,
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
