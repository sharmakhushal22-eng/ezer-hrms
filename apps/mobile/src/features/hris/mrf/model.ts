// The MRF form's data — copied from components/ess/MrfForm.tsx (a DOM file that
// imports @/lib/supabase, so it cannot be shared). EMPTY, mrfToForm, the
// constants, the compensation table and the payload are the website's, field for
// field. The ten Supabase reads are the website's, verbatim.
//
// Web BUG kept (spec §6.2): /api/ess/mrf `create` reads none of the Field-Master
// fields (request_source, headcount_*, agency_*, bgv_*, closure_*, role_summary…),
// so they are sent — exactly as the website sends them — and silently dropped.
import { supabase } from '@/core/supabase'
import { newMrfNumber } from '@web/recruitment/job-code'

export const REQ_TYPES = ['New Hire', 'Replacement', 'Temporary', 'Backfill']
export const REQUEST_SOURCES = ['Manual', 'Manpower plan (AOP)', 'Triggered by separation']
export const PRIORITIES: [string, string][] = [['HIGH', 'High / Urgent'], ['MEDIUM', 'Medium / Normal'], ['LOW', 'Low']]
export const EMP_TYPES = ['Employee', 'Intern', 'Contract', 'Consultant', 'NAPS', 'NATS', 'Live Project']
export const WORK_MODES = ['Onsite', 'Hybrid', 'Remote']
export const SOURCING_MODES = ['External', 'Internal', 'Both']
export const REASON_FOR_HIRE = ['New position', 'Replacement', 'Expansion', 'Attrition']
export const PREV_COMPANY: [string, string][] = [['', 'Select Preference'], ['MNC', 'MNC'], ['STARTUP', 'Startup']]
export const EDUCATION_OPTIONS = ['Any Graduate', 'Bachelors', 'B.Tech/B.E.', 'MBA/PGDM', 'M.Tech', 'B.Com/M.Com', 'BCA/MCA', 'Diploma', '12th Pass', 'Any Post Graduate', 'Masters']
export const QUICK_HIRE_CAP = 600000
export const COMPENSATION: Record<string, { kind: string; label: string; period: string; fixedTerm: boolean; ph: [string, string] }> = {
  Employee:       { kind: 'SALARY',  label: 'Salary',  period: 'ANNUAL',  fixedTerm: false, ph: ['600000', '1200000'] },
  Intern:         { kind: 'STIPEND', label: 'Stipend', period: 'MONTHLY', fixedTerm: true,  ph: ['10000', '25000'] },
  NAPS:           { kind: 'STIPEND', label: 'Stipend', period: 'MONTHLY', fixedTerm: true,  ph: ['9000', '15000'] },
  NATS:           { kind: 'STIPEND', label: 'Stipend', period: 'MONTHLY', fixedTerm: true,  ph: ['9000', '15000'] },
  'Live Project': { kind: 'STIPEND', label: 'Stipend', period: 'MONTHLY', fixedTerm: true,  ph: ['5000', '15000'] },
  Contract:       { kind: 'FEES',    label: 'Fees',    period: 'MONTHLY', fixedTerm: true,  ph: ['50000', '120000'] },
  Consultant:     { kind: 'FEES',    label: 'Fees',    period: 'MONTHLY', fixedTerm: false, ph: ['75000', '200000'] },
}
export const compOf = (t: string) => COMPENSATION[t] || COMPENSATION.Employee
export const perLabel = (p: string) => (p === 'ANNUAL' ? 'per annum' : 'per month')

export type Master = { code: string; label: string }
export type Person = { id: string; full_name: string; emp_code: string; designation: string | null }
export type Form = Record<string, any>

export const EMPTY: Form = {
  mrf_number: '',
  mrf_type: 'Full MRF', hiring_type: 'New Hire', urgency: 'MEDIUM', raised_by_name: '', raised_by_role: '', is_confidential: false,
  job_title: '', designation: '', business_unit: '', grade: '', job_code: '', no_of_openings: '1',
  employment_type: 'Employee', work_mode: 'Onsite', location_id: '',
  cost_center: '', is_budgeted: '', headcount_ref: '', currency: 'INR', budget_min: '', budget_max: '', wage_category: '', duration_months: '',
  reason: '', outgoing_employee_id: '', exit_reason: '', business_justification: '',
  target_joining_date: '', validity_date: '',
  experience_min: '', experience_max: '', education_min: '', education_max: '', previous_company_preference: '',
  skills_required: '', good_to_have_skills: '', job_description: '',
  ctq_questions: [] as string[],
  sourcing_mode: 'External', sourcing_channels: [] as string[],
  request_source: '',
  headcount_sanctioned: '', headcount_actual: '', headcount_open: '',
  agency_vendor: '', agency_fee_pct: '', agency_exclusivity_days: '', agency_ownership_days: '',
  bgv_required: '', bgv_package: '', medical_required: '',
  closure_offered_ctc: '', closure_doj: '', closure_source: '',
  role_summary: '', kras: '',
  specialisation: '', certifications: '',
  relevant_experience_min: '', relevant_experience_max: '',
  industry_preference: '', target_companies: '',
  max_notice_period_days: '', languages: '', travel_percentage: '', relocation_required: '',
  diversity_flag: '', licence_requirement: '',
  variable_percentage: '',
  joining_bonus_allowed: '', joining_bonus_cap: '',
  relocation_allowance_allowed: '', relocation_allowance_cap: '',
  notice_buyout_allowed: '', notice_buyout_cap: '',
  esop_eligible: '', esop_retention_notes: '',
  budget_code: '',
}

const s = (v: any) => (v != null ? String(v) : '')
const yn = (v: any) => (v === true ? 'yes' : v === false ? 'no' : '')

/** MrfForm.tsx mrfToForm — a manpower_requisitions row back into the form (Edit & resubmit). */
export function mrfToForm(m: any): Form {
  return {
    ...EMPTY,
    mrf_number: m.mrf_number || '',
    mrf_type: m.mrf_type || 'Full MRF', hiring_type: m.hiring_type || 'New Hire', urgency: m.urgency || 'MEDIUM', is_confidential: !!m.is_confidential,
    raised_by_name: m.raised_by_name || '', raised_by_role: m.raised_by_role || '',
    job_title: m.job_title || '', designation: m.designation || m.position || '', business_unit: m.business_unit || '',
    grade: m.grade || '', job_code: m.job_code || '', no_of_openings: String(m.no_of_openings || m.openings || 1),
    employment_type: m.employment_type || 'Employee', work_mode: m.work_mode || 'Onsite', location_id: m.location_id || '',
    cost_center: m.cost_center || '', is_budgeted: yn(m.is_budgeted),
    headcount_ref: m.headcount_ref || '', currency: m.currency || 'INR',
    budget_min: s(m.budget_min), budget_max: s(m.budget_max),
    wage_category: m.wage_category || '',
    duration_months: s(m.duration_months),
    reason: m.reason || m.reason_for_hire || '', outgoing_employee_id: m.outgoing_employee_id || '', exit_reason: m.exit_reason || '',
    business_justification: m.business_justification || '',
    target_joining_date: (m.target_joining_date || '').slice(0, 10), validity_date: (m.validity_date || '').slice(0, 10),
    experience_min: s(m.experience_min), experience_max: s(m.experience_max),
    education_min: m.education_min || '', education_max: m.education_max || '', previous_company_preference: m.previous_company_preference || '',
    skills_required: m.skills_required || '', good_to_have_skills: m.good_to_have_skills || '', job_description: m.job_description || '',
    ctq_questions: Array.isArray(m.ctq_questions) ? m.ctq_questions.map(String) : [],
    sourcing_mode: m.sourcing_mode || 'External', sourcing_channels: Array.isArray(m.sourcing_channels) ? m.sourcing_channels : [],
    request_source: m.request_source || '',
    headcount_sanctioned: s(m.headcount_sanctioned), headcount_actual: s(m.headcount_actual), headcount_open: s(m.headcount_open),
    agency_vendor: m.agency_vendor || '',
    agency_fee_pct: s(m.agency_fee_pct), agency_exclusivity_days: s(m.agency_exclusivity_days), agency_ownership_days: s(m.agency_ownership_days),
    bgv_required: yn(m.bgv_required), bgv_package: m.bgv_package || '', medical_required: yn(m.medical_required),
    closure_offered_ctc: s(m.closure_offered_ctc), closure_doj: (m.closure_doj || '').slice(0, 10), closure_source: m.closure_source || '',
    role_summary: m.role_summary || '', kras: m.kras || '',
    specialisation: m.specialisation || '', certifications: m.certifications || '',
    relevant_experience_min: s(m.relevant_experience_min), relevant_experience_max: s(m.relevant_experience_max),
    industry_preference: m.industry_preference || '', target_companies: m.target_companies || '',
    max_notice_period_days: s(m.max_notice_period_days), languages: m.languages || '',
    travel_percentage: s(m.travel_percentage),
    relocation_required: yn(m.relocation_required), diversity_flag: yn(m.diversity_flag),
    licence_requirement: m.licence_requirement || '',
    variable_percentage: s(m.variable_percentage),
    joining_bonus_allowed: yn(m.joining_bonus_allowed), joining_bonus_cap: s(m.joining_bonus_cap),
    relocation_allowance_allowed: yn(m.relocation_allowance_allowed), relocation_allowance_cap: s(m.relocation_allowance_cap),
    notice_buyout_allowed: yn(m.notice_buyout_allowed), notice_buyout_cap: s(m.notice_buyout_cap),
    esop_eligible: yn(m.esop_eligible), esop_retention_notes: m.esop_retention_notes || '',
    budget_code: m.budget_code || '',
  }
}

/** The raiser autofill bundle (MrfForm.tsx `bundle`). */
export interface Auto {
  name: string; code: string; designation: string; role: string
  company_id: string; company_name: string; department_id: string; department_name: string; department_code: string
  rm1: string; rm2: string; rm2_id: string; hod: string; hod_id: string
}
export interface Refs { auto: Auto; masters: Record<string, Master[]>; people: Person[]; locations: { id: string; location_name: string }[]; skills: string[]; canConfidential: boolean }

export async function loadMasters(codes: string[]): Promise<Record<string, Master[]>> {
  const out: Record<string, Master[]> = {}; codes.forEach(c => { out[c] = [] })
  const { data: types } = await supabase.from('master_types').select('id, code').in('code', codes)
  if (!types?.length) return out
  const byId = new Map(types.map((t: any) => [t.id, t.code]))
  const { data: vals } = await supabase.from('master_values')
    .select('type_id, code, label, is_active, sort_order').in('type_id', types.map((t: any) => t.id)).order('sort_order')
  for (const v of (vals as any[]) || []) { if (v.is_active === false) continue; const c = byId.get(v.type_id) as string; if (c) out[c].push({ code: v.code, label: v.label }) }
  return out
}

/** The raiser, their reporting line and the reference lists — the website's reads, in order. */
export async function loadRefs(raiserId: string): Promise<Refs> {
  const { data: me } = await supabase.from('employees')
    .select('id, full_name, emp_code, designation, company_id, department_id, hod_id, l1_manager_id, companies:companies!employees_company_id_fkey(company_name), departments:departments!employees_department_id_fkey(dept_name, dept_code)')
    .eq('id', raiserId).maybeSingle()
  const mm: any = me || {}
  const others = [mm.l1_manager_id, mm.hod_id].filter(Boolean)
  const { data: rel } = others.length
    ? await supabase.from('employees').select('id, full_name, emp_code').in('id', others)
    : { data: [] as any[] }
  const byId: Record<string, any> = {}; ((rel as any[]) || []).forEach((r: any) => { byId[r.id] = r })
  let role = mm.designation || ''
  let canConfidential = false
  const { data: acct } = await supabase.from('ess_accounts').select('id').eq('employee_id', raiserId).maybeSingle()
  if ((acct as any)?.id) {
    const { data: ur } = await supabase.from('ess_user_roles').select('ess_roles(role_name, role_code)').eq('ess_account_id', (acct as any).id).eq('is_active', true)
    const names = ((ur as any[]) || []).map((r: any) => r.ess_roles).filter((r: any) => r && r.role_code !== 'EMPLOYEE')
    if (names.length) role = names[0].role_name
    canConfidential = names.some((r: any) => String(r.role_code).toUpperCase() === 'HR_HEAD')
  }
  const fmt = (p: any) => p ? `${p.full_name} (${p.emp_code})` : '—'
  const auto: Auto = {
    name: mm.full_name || '', code: mm.emp_code || '', designation: mm.designation || '', role,
    company_id: mm.company_id || '', company_name: mm.companies?.company_name || '—',
    department_id: mm.department_id || '', department_name: mm.departments?.dept_name || '—', department_code: mm.departments?.dept_code || '',
    rm1: mm.full_name ? `${mm.full_name} (${mm.emp_code})` : '—',
    rm2: fmt(byId[mm.l1_manager_id]), rm2_id: mm.l1_manager_id || '',
    hod: fmt(byId[mm.hod_id]), hod_id: mm.hod_id || '',
  }
  const [mst, ppl, locs, sk] = await Promise.all([
    loadMasters(['grade', 'shift_type', 'candidate_source', 'separation_reason', 'business_unit', 'cost_center', 'currency']),
    mm.company_id ? supabase.from('employees').select('id, full_name, emp_code, designation').eq('company_id', mm.company_id).eq('employment_status', 'Active').order('full_name') : Promise.resolve({ data: [] as any[] }),
    mm.company_id ? supabase.from('locations').select('id, location_name').eq('company_id', mm.company_id).eq('status', 'Active').order('location_name') : Promise.resolve({ data: [] as any[] }),
    supabase.from('skills').select('name').order('name'),
  ])
  return {
    auto, masters: mst, canConfidential,
    people: ((ppl as any).data as any[]) || [],
    locations: ((locs as any).data as any[]) || [],
    skills: (((sk as any).data as any[]) || []).map((r: any) => r.name).filter(Boolean),
  }
}

/** Reserve MRF-YYYY-NNNNN, checked against existing rows (up to 6 tries), as the website does. */
export async function reserveMrfNumber(): Promise<string | null> {
  for (let i = 0; i < 6; i++) {
    const cand = newMrfNumber()
    const { data } = await supabase.from('manpower_requisitions').select('id').eq('mrf_number', cand).maybeSingle()
    if (!data) return cand
  }
  return null
}

/** Persist a brand-new skill to the master; duplicates and errors are ignored, as on the web. */
export async function insertSkill(name: string) {
  await supabase.from('skills').insert({ name }).then(() => {}, () => {})
}

/** MrfForm.tsx save() payload, field for field. */
export function buildPayload(form: Form, status: 'DRAFT' | 'SUBMITTED', o: { replaceRef: string | null; canConfidential: boolean; hodId: string | null }) {
  const comp = compOf(form.employment_type)
  const isReplacement = form.hiring_type === 'Replacement' || form.hiring_type === 'Backfill'
  return {
    action: 'create', status, designation: String(form.designation || '').trim(),
    mrf_number: form.mrf_number || null,
    replace_id: o.replaceRef || null,
    mrf_type: form.mrf_type, hiring_type: form.hiring_type, urgency: form.urgency,
    is_confidential: !!form.is_confidential && o.canConfidential,
    raised_by_name: form.raised_by_name || null, raised_by_role: form.raised_by_role || null,
    job_title: form.job_title || null, business_unit: form.business_unit || null, grade: form.grade || null, job_code: form.job_code || null,
    openings: Number(form.no_of_openings) || 1,
    hod_id: o.hodId || null,
    employment_type: form.employment_type, work_mode: form.work_mode, location_id: form.location_id || null,
    cost_center: form.cost_center || null, is_budgeted: form.is_budgeted, headcount_ref: form.headcount_ref || null,
    currency: form.currency || 'INR', budget_min: form.budget_min || null, budget_max: form.budget_max || null,
    wage_category: form.wage_category || null,
    compensation_type: comp.kind, pay_period: comp.period,
    duration_months: (comp.fixedTerm || form.duration_months) ? (Number(form.duration_months) || null) : null,
    reason: form.reason || null,
    outgoing_employee_id: isReplacement ? (form.outgoing_employee_id || null) : null,
    exit_reason: isReplacement ? (form.exit_reason || null) : null,
    business_justification: form.business_justification || null,
    target_joining_date: form.target_joining_date || null, validity_date: form.validity_date || null,
    experience_min: form.experience_min || null, experience_max: form.experience_max || null,
    education_min: form.education_min || null, education_max: form.education_max || null,
    previous_company_preference: form.previous_company_preference || null,
    skills_required: form.skills_required || null, good_to_have_skills: form.good_to_have_skills || null,
    ctq_questions: (form.ctq_questions || []).map((q: string) => String(q).trim()).filter(Boolean),
    job_description: form.job_description || null,
    sourcing_mode: form.sourcing_mode || null, sourcing_channels: form.sourcing_channels || [],
    request_source: form.request_source || null,
    headcount_sanctioned: form.headcount_sanctioned || null,
    headcount_actual: form.headcount_actual || null,
    headcount_open: form.headcount_open || null,
    agency_vendor: form.agency_vendor || null,
    agency_fee_pct: form.agency_fee_pct || null,
    agency_exclusivity_days: form.agency_exclusivity_days || null,
    agency_ownership_days: form.agency_ownership_days || null,
    bgv_required: form.bgv_required, bgv_package: form.bgv_package || null,
    medical_required: form.medical_required,
    closure_offered_ctc: form.closure_offered_ctc || null,
    closure_doj: form.closure_doj || null,
    closure_source: form.closure_source || null,
    role_summary: form.role_summary || null, kras: form.kras || null,
    specialisation: form.specialisation || null, certifications: form.certifications || null,
    relevant_experience_min: form.relevant_experience_min || null,
    relevant_experience_max: form.relevant_experience_max || null,
    industry_preference: form.industry_preference || null, target_companies: form.target_companies || null,
    max_notice_period_days: form.max_notice_period_days || null,
    languages: form.languages || null,
    travel_percentage: form.travel_percentage || null,
    relocation_required: form.relocation_required,
    diversity_flag: form.diversity_flag,
    licence_requirement: form.licence_requirement || null,
    variable_percentage: form.variable_percentage || null,
    joining_bonus_allowed: form.joining_bonus_allowed, joining_bonus_cap: form.joining_bonus_cap || null,
    relocation_allowance_allowed: form.relocation_allowance_allowed, relocation_allowance_cap: form.relocation_allowance_cap || null,
    notice_buyout_allowed: form.notice_buyout_allowed, notice_buyout_cap: form.notice_buyout_cap || null,
    esop_eligible: form.esop_eligible, esop_retention_notes: form.esop_retention_notes || null,
    budget_code: form.budget_code || null,
  }
}
