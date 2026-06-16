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
export interface SalaryStructure {
  offered_ctc: number | null
  basic_monthly: number | null; hra_monthly: number | null; epf_monthly: number | null; net_monthly: number | null
  variable_pct: number | null; calc: any
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

// ── Salary structure (from the recruitment CTC negotiation) ────────
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
  if (!neg && !oc?.offered_ctc) return null
  return {
    offered_ctc: neg?.offered_ctc ?? oc?.offered_ctc ?? null,
    basic_monthly: neg?.basic_monthly ?? null, hra_monthly: neg?.hra_monthly ?? null,
    epf_monthly: neg?.epf_monthly ?? null, net_monthly: neg?.net_monthly ?? null,
    variable_pct: neg?.variable_pct ?? null,
    calc: typeof neg?.calculation_data === 'string' ? JSON.parse(neg.calculation_data) : (neg?.calculation_data || null),
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
