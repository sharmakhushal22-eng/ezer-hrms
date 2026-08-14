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
// The calendar month before a payroll period, rolling the financial year back at April
// (month 1) — Apr 2026-27's predecessor is Mar 2025-26, which loadRuns(fy) would never see.
export function prevPeriod(fy: string, month: number): { fy: string; month: number } {
  if (month > 1) return { fy, month: month - 1 }
  const start = Number(String(fy).split('-')[0]) - 1
  return { fy: `${start}-${String(start + 1).slice(-2)}`, month: 12 }
}
// All runs for one calendar period. companyId '' → every company (group mode), where a
// single month legitimately spans several runs.
export async function loadRunsForPeriod(companyId: string, fy: string, month: number): Promise<PayrollRun[]> {
  let q = supabase.from('payroll_runs').select('*, companies(company_name)')
    .eq('fy', fy).eq('month', month).neq('status', 'CANCELLED')
  if (companyId) q = q.eq('company_id', companyId)
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
// ── Month sequencing: a month can only be created once the PREVIOUS month is closed off.
// "Closed off" means all three of: attendance processed for every employee, the month
// frozen, and payroll locked. Checked per company, because in group mode one company can
// be behind the others. A previous month that was never created is not a blocker — that
// would deadlock anyone starting mid-year — only an existing, unfinished one is.
export interface MonthReadiness {
  companyId: string; companyName: string
  prevMonth: number; prevLabel: string
  prevExists: boolean
  attendanceDone: boolean; attendanceDetail: string
  frozen: boolean; frozenDetail: string
  locked: boolean; lockedDetail: string
  ok: boolean
}
const FROZEN_OR_BEYOND = ['ATTENDANCE_LOCKED', 'CALCULATED', 'AI_CHECKED', 'APPROVED', 'DISBURSED', 'LOCKED']

export async function checkMonthReadiness(
  companies: { id: string; company_name: string }[], fy: string, month: number,
): Promise<MonthReadiness[]> {
  if (month <= 1) return []                      // April is the first month of the FY
  const prev = month - 1
  const prevLabel = `${MONTHS[prev - 1]} ${fy.split('-')[0]}`
  const out: MonthReadiness[] = []
  for (const c of companies) {
    const { data: runs } = await supabase.from('payroll_runs')
      .select('id, status, period_label').eq('company_id', c.id).eq('fy', fy).eq('month', prev).neq('status', 'CANCELLED')
    const run = (runs || [])[0]
    if (!run) {
      out.push({
        companyId: c.id, companyName: c.company_name, prevMonth: prev, prevLabel, prevExists: false,
        attendanceDone: true, attendanceDetail: '', frozen: true, frozenDetail: '', locked: true, lockedDetail: '',
        ok: true,
      })
      continue
    }
    const { count: total } = await supabase.from('payroll_employee_snapshot')
      .select('*', { count: 'exact', head: true }).eq('run_id', run.id)
    const { count: pending } = await supabase.from('payroll_employee_snapshot')
      .select('*', { count: 'exact', head: true }).eq('run_id', run.id).is('attendance_uploaded_at', null)

    const attendanceDone = (total || 0) > 0 && (pending || 0) === 0
    const frozen = FROZEN_OR_BEYOND.includes(run.status)
    const locked = run.status === 'LOCKED'
    out.push({
      companyId: c.id, companyName: c.company_name, prevMonth: prev,
      prevLabel: run.period_label || prevLabel, prevExists: true,
      attendanceDone,
      attendanceDetail: attendanceDone ? 'all employees processed'
        : (total || 0) === 0 ? 'month master is empty' : `${pending} of ${total} employees still not processed`,
      frozen, frozenDetail: frozen ? 'frozen' : `status is ${run.status} — freeze the month first`,
      locked, lockedDetail: locked ? 'locked' : `status is ${run.status} — payroll not locked yet`,
      ok: attendanceDone && frozen && locked,
    })
  }
  return out
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
  // when supplied this is stored as-is; blank falls back to the leave formula
  paid_days?: number | null
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
  ot_hours?: number | null; weekly_off?: number | null; paid_days?: number | null
}): Promise<{ error: string | null; paidDays: number | null; runStatusReset: boolean }> {
  const { data, error } = await supabase.rpc('edit_employee_attendance', {
    p_run_id: runId, p_employee_code: empCode,
    p_earned_leave: fields.earned_leave ?? null, p_casual_leave: fields.casual_leave ?? null,
    p_sick_leave: fields.sick_leave ?? null, p_other_leave: fields.other_leave ?? null,
    p_absent_days: fields.absent_days ?? null, p_ot_hours: fields.ot_hours ?? null,
    p_weekly_off: fields.weekly_off ?? null, p_paid_days: fields.paid_days ?? null,
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
// Declared BEFORE MM_ORDER: it spreads them at module-load time, so a later
// declaration would be in the temporal dead zone and throw on import.
const ARREAR_COLS = [
  'arrear_basic', 'arrear_hra', 'arrear_conveyance', 'arrear_special_allowance', 'arrear_statutory_bonus',
  'arrear_employer_pf', 'arrear_employer_esic', 'arrear_gratuity', 'arrear_employee_pf', 'arrear_employee_esic',
  'arrear_pt', 'arrear_lwf', 'arrear_hostel_allowance', 'arrear_children_education',
  'arrear_flexi_car_lease', 'arrear_flexi_driver_salary', 'arrear_flexi_fuel_maintenance',
  'arrear_flexi_telephone_internet', 'arrear_flexi_meal_card', 'arrear_flexi_gadget_device',
  'arrear_flexi_attire_uniform', 'arrear_flexi_books_periodicals', 'arrear_flexi_lta',
  'arrear_epf_wage', 'arrear_appraisal_effective_date',
]
// The earned counterpart of each structural component — the same 16 heads, pro-rated by
// paid_days. Kept next to the structural names on purpose: a reader comparing
// basic_monthly with earn_basic_monthly is exactly how a pro-rata query gets answered.
const EARN_COLS = [
  'earn_basic_monthly', 'earn_hra_monthly', 'earn_conveyance',
  'earn_special_allowance', 'earn_statutory_bonus',
  'earn_flexi_car', 'earn_flexi_driver', 'earn_flexi_fuel', 'earn_flexi_tel',
  'earn_flexi_meal', 'earn_flexi_device', 'earn_flexi_attire', 'earn_flexi_pda',
  'earn_flexi_lta', 'earn_flexi_chedu', 'earn_flexi_hostel',
]
const TAXABLE_COLS = [
  'taxable_adjustment_lwf', 'taxable_hostel_allowance', 'taxable_children_education',
  'taxable_flexi_car_lease', 'taxable_flexi_driver_salary', 'taxable_flexi_fuel_maintenance',
  'taxable_flexi_telephone_internet', 'taxable_flexi_meal_card', 'taxable_flexi_gadget_device',
  'taxable_flexi_attire_uniform', 'taxable_flexi_books_periodicals', 'taxable_flexi_lta',
]

// ── Month Master column groups ─────────────────────────────────────────────
// The export is grouped so related fields sit together and each block reads as a
// section: Sync → Employee → Statutory → Salary (incl. attendance & arrear, which are
// what salary is computed on) → Flexi → Investment → Bank.
// These groups are the single source of truth for BOTH the column order of the export
// and the per-category counters on the month-over-month change table, so a column can
// never sit in one section on the sheet and be counted under another in the comparison.
// `skipDiff` marks columns that carry no comparable meaning across months — row ids and
// the month's own stamps differ by definition, so counting them would flag every employee.
export interface MmGroup { key: string; label: string; cols: string[]; skipDiff?: string[] }
export const MM_GROUPS: MmGroup[] = [
  {
    key: 'sync', label: 'Sync data',
    cols: ['id', 'run_id', 'employee_id', 'Company', 'fy', 'period_month', 'payday', 'synced_at', 'created_at'],
    // Only Company is comparable — a transfer between group companies is a real change.
    // payday moves with the month by definition, so it sits with the other month stamps.
    skipDiff: ['id', 'run_id', 'employee_id', 'fy', 'period_month', 'payday', 'synced_at', 'created_at'],
  },
  {
    key: 'employee', label: 'Employee details',
    cols: [
      'employee_code', 'full_name', 'father_name', 'mother_name',
      'employment_type', 'employment_status', 'designation', 'grade',
      'department', 'sub_department', 'cost_centre', 'location',
      'group_doj', 'company_doj', 'date_of_joining', 'date_of_leaving',
      'office_email', 'personal_email', 'l1_manager_id',
      'company_id', 'department_id', 'location_id',
      'location_state', 'location_district', 'location_city', 'location_pin_code',
      'actual_posted_state', 'actual_posted_district', 'self_declared_state',
      'res_state', 'res_city', 'perm_state', 'perm_city',
      'international_employee', 'certificate_of_coverage',
    ],
  },
  {
    key: 'statutory', label: 'Statutory',
    cols: [
      'pan_number', 'uan_number', 'previous_uan', 'esic_number', 'pf_account_number',
      'pf_applicable', 'pf_gross_limit', 'pf_wage_type', 'pf_existing_member', 'pf_scheme_certificate',
      'epf_method', 'epf_wage_limit', 'epf_exemption_reason',
      'voluntary_pf_applicable', 'vpf_percent',
      'epf_pension_applicable', 'pension_applicable', 'pension_number', 'eps_monthly',
      'esic_applicable', 'esic_wage_limit', 'esi_dispensary_name',
      'pt_applicable', 'professional_tax_state',
      'lwf_applicable', 'lwf_state',
      'tds_regime', 'wage_category', 'gratuity_eligible',
      'is_international_worker', 'has_certificate_of_coverage',
    ],
  },
  {
    key: 'salary', label: 'Salary',
    cols: [
      'annual_ctc', 'total_ctc', 'variable_annual',
      'basic_monthly', 'hra_monthly', 'conveyance',
      'special_allowance', 'special_allowance_gross', 'statutory_bonus',
      'gross_monthly', 'epf_wage',
      'employer_pf', 'employer_esic', 'gratuity_monthly',
      'employee_pf', 'employee_esic', 'pt_monthly', 'lwf_monthly',
      'net_take_home', 'tds_amount', 'perquisite_total', 'bonus_accrued', 'payment_hold',
      // attendance drives the salary for the month, so it sits with it
      'days_in_month', 'total_days', 'weekly_off',
      'earned_leave', 'casual_leave', 'sick_leave', 'other_leave', 'absent_days',
      'paid_days', 'ot_hours', 'attendance_uploaded_at', 'ot_uploaded_at',
      'arrear_days', 'arrear_source_period', 'arrear_reason',
      ...ARREAR_COLS,
    ],
  },
  {
    key: 'flexi', label: 'Flexi',
    cols: [
      'flexi_regime', 'flexi_car', 'flexi_driver', 'flexi_fuel', 'flexi_tel', 'flexi_meal',
      'flexi_device', 'flexi_attire', 'flexi_pda', 'flexi_lta', 'flexi_chedu', 'flexi_hostel', 'flexi_total',
    ],
  },
  {
    // What the employee actually earned this month, as opposed to what the structure
    // says a full month is worth. Every column here is computed inside the month from
    // columns already frozen above it — attendance × structure, plus whatever the Bulk
    // Uploader posted — so it is the last block to settle and the first one HR reads.
    key: 'earnings', label: 'Earned salary',
    cols: [...EARN_COLS, 'earn_gross_monthly',
      'pay_incentive', 'pay_variable', 'pay_bonus', 'pay_buyout',
      'ded_parking', 'ded_insurance', 'ded_canteen',
      'total_deduction', 'net_pay'],
  },
  { key: 'investment', label: 'Investment', cols: [...TAXABLE_COLS] },
  {
    key: 'bank', label: 'Bank details',
    cols: ['bank_name', 'bank_account_number', 'bank_account_last4', 'ifsc_code', 'account_type'],
  },
]

// ── The sheet a payroll run hands back ─────────────────────────────────────
// Not the Month Master. The Month Master is 167 columns of everything the month knows;
// this is the working out: who, the inputs each formula read, and the numbers those
// formulas produced — in that order, so a row reads left to right as the calculation
// itself. Everything else (addresses, PF scheme flags, arrear side-tables, taxable
// perquisites) is real data that has no part in this arithmetic, and carrying it here
// only makes the one thing HR is checking harder to find.
//
// It deliberately matches the layout of the April salary-calculation sheet, because
// that is the sheet these numbers get checked against.
export const RUN_SHEET_COLS: string[] = [
  // who
  'Company', 'employee_code', 'full_name', 'department', 'employment_status',
  // what the pro-rata ratio is built from
  'payday', 'days_in_month', 'paid_days',
  // the structured monthly figures each Earn_X is computed from
  'basic_monthly', 'hra_monthly', 'conveyance', 'special_allowance', 'statutory_bonus',
  'flexi_car', 'flexi_driver', 'flexi_fuel', 'flexi_tel', 'flexi_meal', 'flexi_device',
  'flexi_attire', 'flexi_pda', 'flexi_lta', 'flexi_chedu', 'flexi_hostel',
  'gross_monthly',
  // what the formulas produced
  ...EARN_COLS,
  // paid as uploaded — never pro-rated
  'pay_incentive', 'pay_variable', 'pay_bonus', 'pay_buyout',
  'earn_gross_monthly',
  // the deduction side, in the order the April sheet totals them
  // The structural statutory figures (epf_wage, employee_pf, employee_esic, pt_monthly,
  // lwf_monthly) are deliberately NOT here. They come frozen from salary_structures and
  // are now superseded by the computed blocks below — epf_wage_base / epf_employee and
  // esic_wages / esic_employee. Showing both invites the reader to reconcile two numbers
  // that were never meant to agree.
  'ded_parking', 'ded_insurance', 'ded_canteen',
  'total_deduction',

  // Code of Wages — the 50% basic floor. Reported alongside the structured basic
  // rather than replacing it: this figure is a compliance measure, and folding it
  // into basic would raise gross and quietly breach the CTC it came from.
  // annual_ctc and ctc_monthly are left out: the same employee has three defensible
  // "CTC" figures (agreed CTC, fixed cost, total cost) that differ from each other, and
  // putting one of them next to earned pay reads as a contradiction rather than context.
  'basic_50_floor', 'basic_for_wages', 'earn_basic_for_wages', 'basic_50_applied',

  // EPF · EPS · EDLI · Admin. The inputs sit next to the outputs on purpose — a
  // ceiling that did or did not apply is unarguable when pf_gross_limit, the actual
  // wage and the resulting base are all on the same row.
  'pf_applicable', 'pf_gross_limit', 'epf_capped',
  'epf_wages_actual', 'epf_wage_base',
  'epf_employee', 'epf_employer_total', 'epf_employer_diff',
  'eps_wages', 'eps_contribution',
  'edli_wages', 'edli_contribution',
  'admin_wages', 'admin_charges', 'admin_charges_payable',

  // ESIC. The reason column earns its place: "covered" and "not covered" are both
  // answers an inspector can question, and the row has to say which rule decided it.
  'esic_applicable', 'esic_number', 'esic_wage_limit',
  // Both wage definitions, side by side. esic_wages_cw is always computed; whether the
  // ceiling is tested on it or on plain gross is a config switch, and esic_basis records
  // which one this row was actually judged by — otherwise a covered/not-covered call
  // cannot be explained six months later when the switch has since been flipped.
  'esic_wages_cw', 'esic_threshold_wage', 'esic_basis',
  'esic_covered', 'esic_cover_reason',
  'esic_wages', 'esic_daily_wage', 'esic_employee_exempt',
  'esic_employee', 'esic_employer', 'esic_total',

  // Professional Tax. pt_rate_found is here because a ₹0 PT has two very different
  // causes — the state levies none, or nobody has configured the state — and only that
  // flag separates them. pt_reason spells out which, in words.
  'pt_state', 'pt_gross', 'pt_slab', 'pt_rate_found', 'pt_amount', 'pt_reason',

  // Labour Welfare Fund. The employer half is reported alongside the employee half
  // because LWF is one of the few deductions where the employer pays the larger share —
  // Maharashtra is ₹25 from the employee and ₹75 from the company — and a challan built
  // from the employee column alone would be short by three quarters.
  'lwf_state_used', 'lwf_month_applicable', 'lwf_exit_exempt', 'lwf_rate_found',
  'lwf_employee', 'lwf_employer', 'lwf_reason',

  // Appraisal arrear, head by head. arrear_months is here so the employee's first
  // question — "which months is this for?" — is answered on the row itself rather than
  // by someone re-deriving it from an effective date months later.
  'arrear_appraisal_effective_date', 'arrear_months',
  'arrear_basic', 'arrear_hra', 'arrear_special_allowance',
  'arrear_epf_wage', 'arrear_employee_pf', 'arrear_employer_pf',
  'arrear_total', 'final_net_pay',
]

// Month-to-month attendance columns. These are *expected* to differ every month, so the
// change table can hold them out on request rather than drowning the salary count in them.
export const MM_ATTENDANCE_COLS: string[] = [
  'days_in_month', 'total_days', 'weekly_off',
  'earned_leave', 'casual_leave', 'sick_leave', 'other_leave', 'absent_days',
  'paid_days', 'ot_hours', 'attendance_uploaded_at', 'ot_uploaded_at',
  'arrear_days', 'arrear_source_period', 'arrear_reason', ...ARREAR_COLS,
]

// Anything not listed in a group is appended at the end rather than dropped, so a column
// added later still reaches the sheet even before it is placed in a group above.
export const MM_ORDER: string[] = MM_GROUPS.flatMap(g => g.cols)
// Rebuild a row so its keys follow MM_ORDER; unlisted keys keep their order at the end.
function orderRow(row: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {}
  for (const k of MM_ORDER) if (k in row) out[k] = row[k]
  for (const k of Object.keys(row)) if (!(k in out)) out[k] = row[k]
  return out
}

// The arrear / taxable side-table shapes, prefixed as they appear in the export.

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
    return orderRow(merged)
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
// The FULL account number, not last4 — a bank file with a masked account cannot be
// uploaded anywhere. The masked column stays in the Month Master for on-screen display.
export async function buildNeftRows(runId: string): Promise<Record<string, string>[]> {
  const [{ data: lines }, { data: snap }] = await Promise.all([
    supabase.from('payroll_lines').select('employee_id, net_pay').eq('run_id', runId),
    supabase.from('payroll_employee_snapshot')
      .select('employee_id, employee_code, full_name, bank_name, bank_account_number, bank_account_last4, ifsc_code').eq('run_id', runId),
  ])
  const snapBy = new Map<string, any>((snap || []).map((x: any) => [x.employee_id, x]))
  return (lines || []).filter((l: any) => Number(l.net_pay) > 0).map((l: any) => {
    const x = snapBy.get(l.employee_id) || {}
    const acct = x.bank_account_number || ''
    return {
      beneficiary_name: x.full_name || '', emp_code: x.employee_code || '',
      bank_name: x.bank_name || '',
      // Leading apostrophe so Excel keeps leading zeros and never uses scientific notation.
      account_number: acct ? `'${acct}` : '',
      ifsc_code: x.ifsc_code || '',
      amount: (Number(l.net_pay) || 0).toFixed(2), narration: 'SALARY',
    }
  })
}

// Employees who cannot be paid — a payslip exists but there is nowhere to send the money.
// Worth surfacing before a NEFT file is generated, not after the bank rejects it.
export async function loadUnbankable(runId: string): Promise<{ employee_code: string; full_name: string; net_pay: number; missing: string }[]> {
  const [{ data: lines }, { data: snap }] = await Promise.all([
    supabase.from('payroll_lines').select('employee_id, net_pay').eq('run_id', runId),
    supabase.from('payroll_employee_snapshot').select('employee_id, employee_code, full_name, bank_account_number, ifsc_code').eq('run_id', runId),
  ])
  const snapBy = new Map<string, any>((snap || []).map((x: any) => [x.employee_id, x]))
  const out: { employee_code: string; full_name: string; net_pay: number; missing: string }[] = []
  ;(lines || []).forEach((l: any) => {
    if (!(Number(l.net_pay) > 0)) return
    const x = snapBy.get(l.employee_id) || {}
    const gaps: string[] = []
    if (!x.bank_account_number) gaps.push('account number')
    if (!x.ifsc_code) gaps.push('IFSC')
    if (gaps.length) out.push({ employee_code: x.employee_code || '', full_name: x.full_name || '', net_pay: Number(l.net_pay) || 0, missing: gaps.join(' + ') })
  })
  return out
}

// Register for a run = payroll_lines + attendance snapshot + employee snapshot (names),
// flattened into one row per employee for an Excel export.
export async function loadRunRegister(runId: string): Promise<Record<string, any>[]> {
  const [{ data: lines }, { data: att }, { data: snap }] = await Promise.all([
    supabase.from('payroll_lines').select('*').eq('run_id', runId),
    // Attendance comes from the Month Master, same as the engine. payroll_attendance_snapshot
    // is a legacy table that nothing populates, so reading it left these columns blank.
    // arrear_total / arrear_months ride along because the register is what gets checked
    // when an employee asks why this month's pay is higher — "Apr, May arrear" answers it
    // on the row, instead of sending someone back to the Month Master to work it out.
    supabase.from('payroll_employee_snapshot').select('employee_id, paid_days, total_days, days_in_month, absent_days, arrear_days, ot_hours, arrear_total, arrear_months').eq('run_id', runId),
    supabase.from('payroll_employee_snapshot').select('employee_id, employee_code, full_name, department, location, annual_ctc, basic_monthly, hra_monthly, bank_account_last4, ifsc_code').eq('run_id', runId),
  ])
  const attBy = new Map<string, any>((att || []).map((a: any) => [a.employee_id, a]))
  const snapBy = new Map<string, any>((snap || []).map((s: any) => [s.employee_id, s]))
  return (lines || []).map((l: any) => {
    const a = attBy.get(l.employee_id) || {}
    const s = snapBy.get(l.employee_id) || {}
    // Objects are dropped, not stringified. earnings_json and deductions_json are the two
    // that exist today; they were landing in the register as raw JSON blobs, which is
    // unreadable in a spreadsheet cell and unusable in a salary register. Everything they
    // hold is already a real column here — paid_days, total_days, ded_epf, ded_pt and the
    // rest — so nothing is lost. The typeof check keeps any JSONB column added later from
    // silently reappearing the same way.
    const clean = (o: any, skip: string[]) => {
      const r: any = {}
      for (const [k, v] of Object.entries(o || {})) {
        if (skip.includes(k) || (v !== null && typeof v === 'object')) continue
        r[k] = v === null || v === undefined ? '' : v
      }
      return r
    }
    return {
      employee_code: s.employee_code || '', full_name: s.full_name || '', department: s.department || '', location: s.location || '',
      annual_ctc: s.annual_ctc ?? '', basic_monthly: s.basic_monthly ?? '', hra_monthly: s.hra_monthly ?? '',
      paid_days: a.paid_days ?? '', total_days: a.total_days ?? '', days_in_month: a.days_in_month ?? '',
      absent_days: a.absent_days ?? '', arrear_days: a.arrear_days ?? '', ot_hours: a.ot_hours ?? '',
      arrear_total: a.arrear_total ?? '', arrear_months: a.arrear_months ?? '',
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

// ── Bank details view: salary account per employee, with the org / date context
//    needed to identify who the account belongs to. companyId '' = all companies. ──
export interface BankRow {
  emp_code: string; full_name: string; company: string | null
  department: string | null; location: string | null
  doj: string | null; dol: string | null
  bank_name: string | null; account_number: string | null; account_last4: string | null
  ifsc_code: string | null; account_type: string | null
}
export async function loadBankDetails(companyId: string): Promise<BankRow[]> {
  let q = supabase.from('employees')
    .select('emp_code, full_name, company_doj, date_of_leaving, last_working_date, relieving_date, bank_name, bank_account_number, bank_account_last4, ifsc_code, account_type, companies(company_name), departments(dept_name), locations!location_id(location_name)')
    .neq('is_test', true).order('emp_code')
  if (companyId) q = q.eq('company_id', companyId)
  const { data } = await q
  return ((data as any[]) || []).map(e => ({
    emp_code: e.emp_code, full_name: e.full_name,
    company: e.companies?.company_name || null,
    department: e.departments?.dept_name || null,
    location: e.locations?.location_name || null,
    doj: e.company_doj || null,
    dol: e.date_of_leaving || e.last_working_date || e.relieving_date || null,
    bank_name: e.bank_name, account_number: e.bank_account_number, account_last4: e.bank_account_last4,
    ifsc_code: e.ifsc_code, account_type: e.account_type,
  }))
}

// Employee sync used to live here as syncRunEmployees(): it DELETED the run's whole
// Month Master and rewrote eleven columns, wiping attendance, statutory flags, flexi,
// bank and salary in one click — and its button sat next to Calculate. sql96's
// category-wise sync replaced it (each category writes only its own columns and refuses
// on a locked month), so the old one is gone rather than left around to be re-wired.
// See lib/payroll/sync.ts.
