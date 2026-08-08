// lib/employees/hr-actions.ts — HR Employee Action Panel data + actions.
import { supabase } from '@/lib/supabase'

export interface By { id?: string | null; name?: string | null }
type Res = { ok?: true; error?: any; [k: string]: any }

export interface OnboardingInfo {
  onboarding_id: string
  employee_code: string | null
  status: string | null
  esic_applicable: boolean | null
  form_data: any
  documents: { doc_code: string; file_name: string | null; ai_status: string | null; hr_verified: boolean | null; storage_path: string | null }[]
  statutory_forms: { form_type: string }[]
}
// Full monthly + annual CTC breakup for the profile Salary tab (mirrors the salary-slip layout).
export interface SalaryBreakup {
  payType: string | null
  // earnings (monthly)
  basic: number; hra: number; statBonus: number; conveyance: number; special: number; gross: number
  // special is NET of declared flexi. specialGross is the contractual figure and
  // flexiMonthly what was carved out, so the components still add up to gross.
  specialGross: number; flexiMonthly: number
  // employer cost (monthly)
  erPf: number; erEsic: number; gratuity: number
  // deductions (monthly) + net take-home
  eePf: number; eeEsic: number; pt: number; lwf: number; net: number
  // CTC summary
  fixedMonthly: number; variableAnnual: number; annualCtc: number; totalCtc: number
  // Simplified views for non-regular staff (intern/naps/nats → STIPEND, consultant → CONSULTANT).
  // When set, the Salary tab shows only these fields instead of the full CTC breakup.
  simpleKind?: 'STIPEND' | 'CONSULTANT'
  stipend?: number        // monthly stipend / fee
  gst?: number            // monthly GST (consultant only, 18%)
  tds?: boolean           // TDS applicable (yes/no)
}
export interface SalaryStructure {
  offered_ctc: number | null
  basic_monthly: number | null; hra_monthly: number | null; epf_monthly: number | null; net_monthly: number | null
  variable_pct: number | null; calc: any
  detail?: SalaryBreakup | null
}
export interface HRAction { id: string; action_type: string; action_detail: any; performed_by_name: string | null; created_at: string }
export interface UpdateRequest { id: string; request_type: string; request_data: any; status: string; created_at: string }
export interface ActiveStates {
  pip: any | null
  sabbatical: any | null
  abscond: any | null
  resignation: any | null
}

const daysBetween = (later?: string | null, earlier?: string | null) =>
  (later && earlier) ? Math.round((new Date(later).getTime() - new Date(earlier).getTime()) / 86400000) : 0

async function logAction(employee_id: string, action_type: string, action_detail: any, by?: By) {
  await supabase.from('employee_hr_actions').insert({
    employee_id, action_type, action_detail,
    performed_by: by?.id || null, performed_by_name: by?.name || 'HR',
  })
}

// ── Onboarding info ────────────────────────────────────────────────
export async function getOnboardingInfo(employeeId: string): Promise<OnboardingInfo | null> {
  const { data: oc } = await supabase.from('onboarding_candidates')
    .select('id, employee_code, status, esic_applicable, form_data')
    .eq('employee_id', employeeId).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (!oc) return null
  const [{ data: docs }, { data: forms }] = await Promise.all([
    supabase.from('onboarding_documents').select('doc_code, file_name, ai_status, hr_verified, storage_path').eq('onboarding_id', oc.id),
    supabase.from('onboarding_statutory_forms').select('form_type').eq('onboarding_id', oc.id),
  ])
  return {
    onboarding_id: oc.id, employee_code: oc.employee_code, status: oc.status,
    esic_applicable: oc.esic_applicable, form_data: oc.form_data || {},
    documents: (docs as any) || [], statutory_forms: (forms as any) || [],
  }
}

// ── Salary structure ───────────────────────────────────────────────
// Primary source: the recruitment CTC negotiation (onboarded employees).
// Fallback: ctc_master / salary_structures / pay columns — so employees whose
// salary was loaded via data migration (no onboarding record) also show a salary.
export async function loadSalary(employeeId: string): Promise<SalaryStructure | null> {
  const { data: oc } = await supabase.from('onboarding_candidates')
    .select('candidate_id, offered_ctc').eq('employee_id', employeeId)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  let neg: any = null
  if (oc?.candidate_id) {
    const { data } = await supabase.from('ctc_negotiations').select('*')
      .eq('candidate_id', oc.candidate_id).order('created_at', { ascending: false }).limit(1).maybeSingle()
    neg = data
  }
  if (neg || oc?.offered_ctc) {
    return {
      offered_ctc: neg?.offered_ctc ?? oc?.offered_ctc ?? null,
      basic_monthly: neg?.basic_monthly ?? null, hra_monthly: neg?.hra_monthly ?? null,
      epf_monthly: neg?.epf_monthly ?? null, net_monthly: neg?.net_monthly ?? null,
      variable_pct: neg?.variable_pct ?? null,
      calc: typeof neg?.calculation_data === 'string' ? JSON.parse(neg.calculation_data) : (neg?.calculation_data || null),
    }
  }
  // No onboarding CTC → fall back to migrated salary data.
  return loadSalaryFromMaster(employeeId)
}

// Build a salary view from migrated data: employees.*_pay (intern/consultant/contract),
// ctc_master (annual breakup) and salary_structures (monthly components).
// Each query is guarded so a not-yet-migrated table/column never breaks the panel.
async function loadSalaryFromMaster(employeeId: string): Promise<SalaryStructure | null> {
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

  // Stipend staff (Intern / NAPS / NATS): show only Stipend + TDS (yes/no).
  // Consultants: show Stipend (fee) + GST (18%) + TDS (yes/no).
  if ((isStipend || isConsultant) && payMonthly != null) {
    const pay = Number(payMonthly)
    const gst = isConsultant ? Math.round(pay * 0.18) : 0
    const detail: SalaryBreakup = {
      payType: isConsultant ? 'Consultant Fee' : 'Stipend',
      basic: pay, hra: 0, statBonus: 0, conveyance: 0, special: 0, gross: pay, specialGross: 0, flexiMonthly: 0,
      erPf: 0, erEsic: 0, gratuity: 0, eePf: 0, eeEsic: 0, pt: 0, lwf: 0, net: pay,
      fixedMonthly: pay, variableAnnual: 0, annualCtc: pay * 12, totalCtc: pay * 12,
      simpleKind: isConsultant ? 'CONSULTANT' : 'STIPEND',
      stipend: pay, gst, tds: isConsultant,   // interns/NAPS/NATS: no TDS; consultants: 194J TDS
    }
    return { offered_ctc: pay * 12, basic_monthly: null, hra_monthly: null, epf_monthly: null, net_monthly: pay, variable_pct: null, calc: null, detail }
  }

  // Regular / contract: full breakup from salary_structures (fallback to ctc_master).
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

  const offered = ctc?.annual_ctc ?? sal?.total_ctc ?? sal?.gross_annual ?? (payMonthly != null ? Number(payMonthly) * 12 : null)
  const variable_pct = (ctc?.annual_ctc && ctc?.annual_variable != null && Number(ctc.annual_ctc) > 0)
    ? Math.round((Number(ctc.annual_variable) / Number(ctc.annual_ctc)) * 100) : null
  return {
    offered_ctc: offered != null ? Number(offered) : null,
    basic_monthly: sal?.basic_monthly ?? perMonth(ctc?.basic_annual),
    hra_monthly: sal?.hra_monthly ?? perMonth(ctc?.hra_annual),
    epf_monthly: sal?.employee_pf ?? null,
    net_monthly: sal?.net_take_home ?? (payMonthly != null ? Number(payMonthly) : null),
    variable_pct,
    calc: null,
    detail,
  }
}

// ── PIP ────────────────────────────────────────────────────────────
export async function markPIP(employeeId: string, p: { start_date: string; review_date?: string; reason?: string; goals?: string }, by?: By): Promise<Res> {
  const { data, error } = await supabase.from('employee_pip').insert({
    employee_id: employeeId, start_date: p.start_date, review_date: p.review_date || null,
    reason: p.reason || null, goals: p.goals || null, status: 'ACTIVE',
    initiated_by: by?.id || null, initiated_by_name: by?.name || 'HR',
  }).select('*').single()
  if (error) return { error }
  await logAction(employeeId, 'PIP', { start_date: p.start_date, review_date: p.review_date }, by)
  return { ok: true, pip: data }
}
export async function closePIP(pipId: string, employeeId: string, outcome: 'PASSED' | 'FAILED', by?: By): Promise<Res> {
  const { error } = await supabase.from('employee_pip').update({ status: outcome, outcome, closed_at: new Date().toISOString() }).eq('id', pipId)
  if (error) return { error }
  await logAction(employeeId, 'PIP_CLOSE', { outcome }, by)
  return { ok: true }
}

// ── Sabbatical ─────────────────────────────────────────────────────
export async function markSabbatical(employeeId: string, p: { from_date: string; to_date?: string; reason?: string }, by?: By): Promise<Res> {
  const { data, error } = await supabase.from('employee_sabbatical').insert({
    employee_id: employeeId, from_date: p.from_date, to_date: p.to_date || null,
    reason: p.reason || null, status: 'ACTIVE',
    initiated_by: by?.id || null, initiated_by_name: by?.name || 'HR',
  }).select('*').single()
  if (error) return { error }
  await supabase.from('employees').update({ employment_status: 'Sabbatical' }).eq('id', employeeId)
  await logAction(employeeId, 'SABBATICAL', { from_date: p.from_date, to_date: p.to_date, reason: p.reason }, by)
  return { ok: true, sabbatical: data }
}
export async function markSabbaticalReturned(sabId: string, employeeId: string, actualReturn: string, by?: By): Promise<Res> {
  const { error } = await supabase.from('employee_sabbatical').update({ actual_return: actualReturn, status: 'RETURNED' }).eq('id', sabId)
  if (error) return { error }
  await supabase.from('employees').update({ employment_status: 'Active' }).eq('id', employeeId)
  await logAction(employeeId, 'SABBATICAL_RETURN', { actual_return: actualReturn }, by)
  return { ok: true }
}

// ── Resignation ────────────────────────────────────────────────────
export async function initiateResignation(employeeId: string, p: {
  date_of_resignation: string; notice_period_days: number; lwd_as_per_policy: string; lwd_confirmed_by_emp: string
}, by?: By): Promise<Res> {
  const shortfall = Math.max(0, daysBetween(p.lwd_as_per_policy, p.lwd_confirmed_by_emp))
  const recovery = shortfall > 0
  const { data: r, error } = await supabase.from('employee_resignation').insert({
    employee_id: employeeId, date_of_resignation: p.date_of_resignation, notice_period_days: p.notice_period_days,
    lwd_as_per_policy: p.lwd_as_per_policy, lwd_confirmed_by_emp: p.lwd_confirmed_by_emp,
    notice_shortfall_days: shortfall, recovery_required: recovery,
    status: recovery ? 'RECOVERY_PENDING' : 'INITIATED',
    initiated_by: by?.id || null, initiated_by_name: by?.name || 'HR',
  }).select('*').single()
  if (error) return { error }
  await supabase.from('employees').update({
    employment_status: 'Resigned', date_of_resignation: p.date_of_resignation, last_working_date: p.lwd_confirmed_by_emp,
  }).eq('id', employeeId)
  await logAction(employeeId, 'RESIGNATION', { date_of_resignation: p.date_of_resignation, shortfall, recovery }, by)

  let mailed = false, mailError: string | null = null
  if (recovery) {
    try {
      const res = await fetch('/api/hr/recovery-mail', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resignation_id: r.id }) })
      const d = await res.json()
      mailed = !!d.ok; if (!d.ok) mailError = d.error || 'mail failed'
    } catch (e: any) { mailError = e?.message || 'network error' }
  }
  return { ok: true, resignation: r, shortfall, recovery, mailed, mailError }
}
export async function withdrawResignation(resId: string, employeeId: string, by?: By): Promise<Res> {
  const { error } = await supabase.from('employee_resignation').update({ status: 'WITHDRAWN' }).eq('id', resId)
  if (error) return { error }
  await supabase.from('employees').update({ employment_status: 'Active', date_of_resignation: null, last_working_date: null }).eq('id', employeeId)
  await logAction(employeeId, 'RESIGNATION_WITHDRAWN', {}, by)
  return { ok: true }
}

// ── Abscond ────────────────────────────────────────────────────────
export async function markAbscond(employeeId: string, abscond_from: string, by?: By): Promise<Res> {
  const { data, error } = await supabase.from('employee_abscond').insert({
    employee_id: employeeId, abscond_from, status: 'ABSCONDING',
    marked_by: by?.id || null, marked_by_name: by?.name || 'HR',
  }).select('*').single()
  if (error) return { error }
  await supabase.from('employees').update({ employment_status: 'Abscond' }).eq('id', employeeId)
  await logAction(employeeId, 'ABSCOND', { abscond_from }, by)
  return { ok: true, abscond: data }
}
export async function closeAbscond(abscondId: string, employeeId: string, abscond_end: string, by?: By): Promise<Res> {
  const { error } = await supabase.from('employee_abscond').update({ abscond_end, status: 'RETURNED' }).eq('id', abscondId)
  if (error) return { error }
  await supabase.from('employees').update({ employment_status: 'Active' }).eq('id', employeeId)
  await logAction(employeeId, 'ABSCOND_CLOSE', { abscond_end }, by)
  return { ok: true }
}

// ── Approval requests ──────────────────────────────────────────────
export async function getPendingRequests(employeeId: string): Promise<UpdateRequest[]> {
  const { data } = await supabase.from('employee_update_requests').select('*').eq('employee_id', employeeId).order('created_at', { ascending: false })
  return (data as any) || []
}
export async function approveRequest(reqId: string, employeeId: string, by?: By): Promise<Res> {
  const { error } = await supabase.from('employee_update_requests').update({ status: 'APPROVED', reviewed_by: by?.id || null, reviewed_by_name: by?.name || 'HR', reviewed_at: new Date().toISOString() }).eq('id', reqId)
  if (error) return { error }
  await logAction(employeeId, 'APPROVE_REQUEST', { request_id: reqId }, by)
  return { ok: true }
}
export async function rejectRequest(reqId: string, employeeId: string, note: string, by?: By): Promise<Res> {
  const { error } = await supabase.from('employee_update_requests').update({ status: 'REJECTED', review_note: note, reviewed_by: by?.id || null, reviewed_by_name: by?.name || 'HR', reviewed_at: new Date().toISOString() }).eq('id', reqId)
  if (error) return { error }
  await logAction(employeeId, 'REJECT_REQUEST', { request_id: reqId, note }, by)
  return { ok: true }
}

// ── History + active states ────────────────────────────────────────
export async function getActionHistory(employeeId: string): Promise<HRAction[]> {
  const { data } = await supabase.from('employee_hr_actions').select('*').eq('employee_id', employeeId).order('created_at', { ascending: false }).limit(50)
  return (data as any) || []
}
export async function getActiveStates(employeeId: string): Promise<ActiveStates> {
  const [pip, sab, abs, res] = await Promise.all([
    supabase.from('employee_pip').select('*').eq('employee_id', employeeId).eq('status', 'ACTIVE').order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('employee_sabbatical').select('*').eq('employee_id', employeeId).eq('status', 'ACTIVE').order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('employee_abscond').select('*').eq('employee_id', employeeId).eq('status', 'ABSCONDING').order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('employee_resignation').select('*').eq('employee_id', employeeId).in('status', ['INITIATED', 'RECOVERY_PENDING']).order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ])
  return { pip: pip.data, sabbatical: sab.data, abscond: abs.data, resignation: res.data }
}

// ════════════════════════════════════════════════════════════════
// TRANSFER MODULE (migration 038) — Type 1 location, Type 2 inter-company
// ════════════════════════════════════════════════════════════════
export interface TransferLocationBatch {
  employee_ids: string[]
  to_branch_id: string
  effective_date: string
  new_reporting_manager_id?: string
  new_designation?: string
  new_department_id?: string
  new_cost_centre?: string
  new_shift_id?: string
  benefit_type?: 'NONE' | 'RELOCATION' | 'ONE_TIME_BONUS'
  benefit_amount?: number
  reason?: string
}

export async function initiateLocationTransfer(
  p: TransferLocationBatch, by?: By
): Promise<{ ok: boolean; batch_id: string; results: any[]; error?: any }> {
  const batchId = (globalThis.crypto?.randomUUID?.() as string) || `${Date.now()}-${Math.floor(Math.random() * 1e9)}`
  const results: any[] = []
  const { data: toBranch } = await supabase.from('locations')
    .select('id, location_name, state, company_id').eq('id', p.to_branch_id).maybeSingle()

  for (const empId of p.employee_ids) {
    const { data: emp } = await supabase.from('employees')
      .select('company_id, location_id, emp_code, group_doj, full_name, personal_email, mobile')
      .eq('id', empId).maybeSingle()
    if (!emp) { results.push({ empId, error: 'not found' }); continue }

    const { data: fromBranch } = await supabase.from('locations')
      .select('state, location_name').eq('id', emp.location_id).maybeSingle()

    const midMonth = new Date(p.effective_date).getDate() !== 1

    const { data: tr } = await supabase.from('employee_transfer').insert({
      employee_id: empId,
      transfer_type: 'LOCATION_MOVEMENT',
      batch_id: batchId,
      from_company_id: emp.company_id,
      from_branch_id: emp.location_id,
      from_branch_state: fromBranch?.state || null,
      from_emp_code: emp.emp_code,
      to_company_id: emp.company_id,
      to_branch_id: p.to_branch_id,
      to_branch_state: toBranch?.state || null,
      effective_date: p.effective_date,
      is_mid_month: midMonth,
      group_doj_preserved: emp.group_doj,
      new_reporting_manager_id: p.new_reporting_manager_id || null,
      new_designation: p.new_designation || null,
      new_department_id: p.new_department_id || null,
      new_cost_centre: p.new_cost_centre || null,
      new_shift_id: p.new_shift_id || null,
      benefit_type: p.benefit_type || 'NONE',
      benefit_amount: p.benefit_amount || null,
      status: 'LETTER_SENT',
      ack_status: 'PENDING',
      reason: p.reason || null,
      initiated_by_name: by?.name || 'HR',
    }).select().single()

    if (tr?.id) {
      try {
        await fetch('/api/transfer/generate-letter', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transfer_id: tr.id, type: 'LOCATION' }),
        })
        await fetch('/api/transfer/notify', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transfer_id: tr.id }),
        })
      } catch { /* letter/notify best-effort */ }
    }

    await logAction(empId, 'TRANSFER_LOCATION', {
      to_branch: toBranch?.location_name, effective_date: p.effective_date, mid_month: midMonth,
    }, by)
    results.push({ empId, transfer_id: tr?.id, mid_month: midMonth })
  }
  return { ok: true, batch_id: batchId, results }
}

// Employee acknowledges (from ESS)
export async function acknowledgeTransfer(transferId: string, remark?: string): Promise<Res> {
  const { data: tr } = await supabase.from('employee_transfer').select('*').eq('id', transferId).maybeSingle()
  if (!tr) return { error: { message: 'Transfer not found' } }
  await supabase.from('employee_transfer').update({
    ack_status: 'ACKNOWLEDGED', ack_at: new Date().toISOString(),
    ack_remark: remark || null, status: 'ACKNOWLEDGED',
  }).eq('id', transferId)
  if (tr.transfer_type === 'LOCATION_MOVEMENT') {
    const applyNow = new Date() >= new Date(tr.effective_date)
    if (applyNow) await applyLocationTransfer(transferId)
  }
  return { ok: true }
}

// Apply the actual employee record changes (Type 1)
export async function applyLocationTransfer(transferId: string): Promise<Res> {
  const { data: tr } = await supabase.from('employee_transfer').select('*').eq('id', transferId).maybeSingle()
  if (!tr) return { error: { message: 'not found' } }
  const upd: any = { location_id: tr.to_branch_id, transferred_at: new Date().toISOString() }
  if (tr.new_reporting_manager_id) upd.reporting_manager_id = tr.new_reporting_manager_id
  if (tr.new_designation) upd.designation = tr.new_designation
  if (tr.new_department_id) upd.department_id = tr.new_department_id
  if (tr.new_cost_centre) upd.cost_centre = tr.new_cost_centre
  // Statutory state changes immediately only when NOT mid-month (else payroll applies next month).
  if (!tr.is_mid_month && tr.to_branch_state) {
    upd.professional_tax_state = tr.to_branch_state
    upd.lwf_state = tr.to_branch_state
  }
  await supabase.from('employees').update(upd).eq('id', tr.employee_id)

  if (tr.new_shift_id) {
    await supabase.from('employee_shift_assignment')
      .update({ is_active: false, effective_till: tr.effective_date })
      .eq('employee_id', tr.employee_id).eq('is_active', true)
    await supabase.from('employee_shift_assignment').insert({
      employee_id: tr.employee_id, shift_id: tr.new_shift_id,
      effective_from: tr.effective_date, is_active: true, assigned_by: 'TRANSFER',
    })
  }
  await supabase.from('employee_transfer').update({
    status: 'COMPLETED', completed_at: new Date().toISOString(),
  }).eq('id', transferId)
  return { ok: true }
}

// ── Type 2 — inter-company ──
export interface TransferInterCompany {
  employee_id: string
  to_company_id: string
  to_branch_id: string
  to_department_id?: string
  new_designation?: string
  transfer_date: string
  benefit_mode: 'REMAIN_SAME' | 'AS_PER_NEW_POLICY'
  reason?: string
}

export async function initiateInterCompanyTransfer(p: TransferInterCompany, by?: By): Promise<Res> {
  const { data: emp } = await supabase.from('employees').select('*').eq('id', p.employee_id).maybeSingle()
  if (!emp) return { error: { message: 'Employee not found' } }

  const lastDay = new Date(p.transfer_date); lastDay.setDate(lastDay.getDate() - 1)
  const lastDayStr = lastDay.toISOString().slice(0, 10)

  // Pre-filled onboarding in the NEW company (status HR_REVIEW so HR can code-gen directly).
  const { data: newOnb } = await supabase.from('onboarding_candidates').insert({
    company_id: p.to_company_id,
    location_id: p.to_branch_id,
    department_id: p.to_department_id || emp.department_id,
    full_name: emp.full_name,
    designation: p.new_designation || emp.designation,
    email: emp.personal_email, mobile: emp.mobile,
    date_of_joining: p.transfer_date,
    employment_type: emp.employment_type,
    status: 'HR_REVIEW',
    form_data: {
      is_transfer: true,
      transfer_from_employee_id: p.employee_id,
      group_doj_carry: emp.group_doj,
      step_3: { full_name: emp.full_name, gender: emp.gender, dob: emp.date_of_birth, blood_group: emp.blood_group, marital_status: emp.marital_status },
      step_4: { mobile: emp.mobile, personal_email: emp.personal_email },
      step_7: { pan_number: emp.pan_number, uan_number: emp.uan_number, bank_name: emp.bank_name, bank_ifsc: emp.ifsc_code },
    },
  }).select().single()

  const { data: tr } = await supabase.from('employee_transfer').insert({
    employee_id: p.employee_id,
    transfer_type: 'INTER_COMPANY',
    from_company_id: emp.company_id, from_branch_id: emp.location_id, from_emp_code: emp.emp_code,
    to_company_id: p.to_company_id, to_branch_id: p.to_branch_id,
    new_department_id: p.to_department_id || null,
    new_designation: p.new_designation || null,
    effective_date: p.transfer_date,
    last_working_date_old: lastDayStr,
    new_doj: p.transfer_date,
    group_doj_preserved: emp.group_doj,
    benefit_type: p.benefit_mode === 'AS_PER_NEW_POLICY' ? 'AS_PER_NEW_POLICY' : 'NONE',
    status: 'PENDING_ONBOARDING',
    ack_status: 'PENDING',
    onboarding_id: newOnb?.id || null,
    reason: p.reason || null,
    initiated_by_name: by?.name || 'HR',
  }).select().single()

  if (tr?.id) {
    try {
      await fetch('/api/transfer/generate-letter', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transfer_id: tr.id, type: 'INTER_COMPANY' }),
      })
      await fetch('/api/transfer/notify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transfer_id: tr.id }),
      })
    } catch { /* best-effort */ }
  }

  await supabase.from('employees').update({
    employment_status: 'Transferred', last_working_date: lastDayStr, transferred_at: new Date().toISOString(),
  }).eq('id', p.employee_id)

  // FNF check — employee_loans table may not exist yet (loan module = July).
  try {
    const { data: loans } = await supabase.from('employee_loans')
      .select('id').eq('employee_id', p.employee_id).eq('status', 'ACTIVE')
    if (loans && loans.length > 0 && tr?.id) {
      await supabase.from('employee_transfer').update({ fnf_triggered: true, fnf_reference: 'PENDING_LOAN' }).eq('id', tr.id)
    }
  } catch { /* loan module not built yet — skip FNF */ }

  await logAction(p.employee_id, 'TRANSFER_INTER', { to_company: p.to_company_id, new_doj: p.transfer_date, last_day: lastDayStr }, by)
  return { ok: true, transfer: tr, onboarding_id: newOnb?.id, last_day: lastDayStr }
}

export async function getPendingTransfers(employeeId: string) {
  const { data } = await supabase.from('employee_transfer')
    .select('*').eq('employee_id', employeeId).eq('ack_status', 'PENDING').order('created_at', { ascending: false })
  return data || []
}
