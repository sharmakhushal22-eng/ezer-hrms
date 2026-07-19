// lib/onboarding/activation.ts — HR Activation (code-generation) data layer.
// Loads the candidate + dropdown data, saves the activation payload, runs the
// pure-logic AI validations (Code on Wages / ESIC / EPF / duplicates), and the
// in-app approval toggles + hard-gate computation. (sql24 columns.)
import { supabase } from '@/lib/supabase'

export interface ActivationCandidate {
  id: string; candidate_id: string | null; full_name: string; designation: string | null; employment_type: string | null
  company_id: string | null; location_id: string | null; department_id: string | null
  department: string | null; date_of_joining: string | null; offered_ctc: number | null
  status: string | null; employee_code: string | null; form_data: any
  // activation columns
  grade: string | null; l1_manager_id: string | null; l2_manager_id: string | null
  hod_id: string | null; hr_spoc_id: string | null; cost_centre: string | null; team_name: string | null
  shift_id: string | null; induction_date: string | null; probation_months: number | null
  confirmation_date: string | null; work_location_type: string | null
  annual_ctc: number | null; basic_pct: number | null; tds_regime: string | null
  pf_wage_type: string | null; pf_applicable: boolean | null; pt_state: string | null; lwf_applicable: boolean | null
  it_email: string | null; it_email_created: boolean | null; it_laptop_issued: boolean | null
  it_laptop_tag: string | null; it_access_done: boolean | null
  admin_id_card: boolean | null; admin_access_card: string | null; admin_seating: string | null
  l1_approved_at: string | null; payroll_approved_at: string | null; it_approved_at: string | null; admin_approved_at: string | null
}
export interface EmpLite { id: string; emp_code: string; full_name: string; designation: string | null }
export interface ShiftLite { id: string; shift_code: string; in_time: string | null; out_time: string | null }
export interface DeptLite { id: string; dept_name: string; company_id: string | null }

const CAND_COLS = `id, candidate_id, full_name, designation, employment_type, company_id, location_id, department_id, department,
  date_of_joining, offered_ctc, status, employee_code, form_data,
  grade, l1_manager_id, l2_manager_id, hod_id, hr_spoc_id, cost_centre, team_name, shift_id, induction_date,
  probation_months, confirmation_date, work_location_type, annual_ctc, basic_pct, tds_regime, pf_wage_type,
  pf_applicable, pt_state, lwf_applicable, it_email, it_email_created, it_laptop_issued, it_laptop_tag,
  it_access_done, admin_id_card, admin_access_card, admin_seating,
  l1_approved_at, payroll_approved_at, it_approved_at, admin_approved_at`

export async function loadActivationData(onboardingId: string): Promise<{ cand: ActivationCandidate | null; employees: EmpLite[]; shifts: ShiftLite[] }> {
  const candR = await supabase.from('onboarding_candidates').select(CAND_COLS).eq('id', onboardingId).maybeSingle()
  const cand = (candR.data as any) || null
  // Annual CTC auto-fetch: if the onboarding row has no CTC yet, pull it from the linked
  // recruitment record — the negotiated CTC (ctc_negotiations) first, else candidates.offered_ctc.
  if (cand && !cand.annual_ctc && !cand.offered_ctc && cand.candidate_id) {
    let ctc: number | null = null
    try {
      const neg = await supabase.from('ctc_negotiations').select('offered_ctc')
        .eq('candidate_id', cand.candidate_id).order('created_at', { ascending: false }).limit(1).maybeSingle()
      ctc = (neg.data as any)?.offered_ctc ?? null
    } catch { /* table optional */ }
    if (ctc == null) {
      const c = await supabase.from('candidates').select('offered_ctc, ctc').eq('id', cand.candidate_id).maybeSingle()
      const row: any = c.data
      ctc = row?.offered_ctc ?? (row?.ctc != null ? Number(row.ctc) : null)
    }
    if (ctc != null && !Number.isNaN(Number(ctc))) cand.offered_ctc = Number(ctc)
  }
  const [empR, shR, deptR] = await Promise.all([
    supabase.from('employees').select('id, emp_code, full_name, designation').eq('employment_status', 'Active').order('full_name'),
    cand?.company_id
      ? supabase.from('shift_master').select('id, shift_code, in_time, out_time').eq('company_id', cand.company_id).eq('is_active', true)
      : supabase.from('shift_master').select('id, shift_code, in_time, out_time').eq('is_active', true),
    supabase.from('departments').select('id, dept_name, company_id').eq('status', 'Active').order('dept_name'),
  ])
  return { cand, employees: (empR.data as any) || [], shifts: (shR.data as any) || [], departments: (deptR.data as any) || [] }
}

export async function saveActivation(onboardingId: string, payload: Partial<ActivationCandidate>): Promise<{ error: string | null }> {
  const { error } = await supabase.from('onboarding_candidates')
    .update({ ...payload, activation_saved_at: new Date().toISOString() })
    .eq('id', onboardingId)
  return { error: error?.message || null }
}

export async function markApproval(onboardingId: string, role: 'l1' | 'payroll' | 'it' | 'admin', byName: string): Promise<{ error: string | null }> {
  const patch: any = { [`${role}_approved_at`]: new Date().toISOString(), [`${role}_approved_by`]: byName || null }
  const { error } = await supabase.from('onboarding_candidates').update(patch).eq('id', onboardingId)
  return { error: error?.message || null }
}

// ── Pure-logic AI validations ──
export interface PayrollChecks {
  monthlyGross: number; basicMonthly: number; basicPct: number
  basicOk: boolean              // Code on Wages: Basic ≥ 50% of gross
  esicApplicable: boolean       // gross ≤ 21,000
  epfWage: number; epfCapped: boolean   // EPF capped at 15,000
}
export function computePayrollChecks(annualCtc: number, basicPct: number): PayrollChecks {
  const monthlyGross = annualCtc > 0 ? annualCtc / 12 : 0
  const basicMonthly = monthlyGross * (basicPct / 100)
  return {
    monthlyGross, basicMonthly, basicPct,
    basicOk: basicPct >= 50,
    esicApplicable: monthlyGross > 0 && monthlyGross <= 21000,
    epfWage: Math.min(basicMonthly, 15000),
    epfCapped: basicMonthly > 15000,
  }
}

// Duplicate PAN / mobile against the live employees table (Aadhaar stored as last4 only → matched on last4).
export interface DupResult { pan: string | null; mobile: string | null; aadhaar: string | null }
export async function checkDuplicates(pan: string | null, mobile: string | null, aadhaarLast4: string | null): Promise<DupResult> {
  const out: DupResult = { pan: null, mobile: null, aadhaar: null }
  const [p, m, a] = await Promise.all([
    pan ? supabase.from('employees').select('emp_code').eq('pan_number', pan).limit(1) : Promise.resolve({ data: [] as any }),
    mobile ? supabase.from('employees').select('emp_code').eq('mobile', mobile).limit(1) : Promise.resolve({ data: [] as any }),
    aadhaarLast4 ? supabase.from('employees').select('emp_code').eq('aadhar_last4', aadhaarLast4).limit(1) : Promise.resolve({ data: [] as any }),
  ])
  if (p.data?.[0]) out.pan = p.data[0].emp_code
  if (m.data?.[0]) out.mobile = m.data[0].emp_code
  if (a.data?.[0]) out.aadhaar = a.data[0].emp_code
  return out
}

// ── Hard gates: code button disabled until all required pass ──
export interface Gate { key: string; label: string; ok: boolean; optional?: boolean }
export function computeGates(c: ActivationCandidate, checks: PayrollChecks): Gate[] {
  const st = c.form_data?.step_7 || {}
  const bankVerified = !!(st.penny_drop_verified || st.bank_account)
  return [
    { key: 'form',      label: 'Candidate form submitted',         ok: ['SUBMITTED', 'HR_REVIEW', 'EMPLOYEE_CREATED'].includes(c.status || '') },
    { key: 'l1',        label: 'L1 (reporting) manager assigned',  ok: !!c.l1_manager_id },
    { key: 'dept',      label: 'Department assigned',              ok: !!c.department_id },
    { key: 'induction', label: 'Induction date set',              ok: !!c.induction_date },
    { key: 'ctc',       label: 'CTC > 0 and Basic ≥ 50%',         ok: (c.annual_ctc || 0) > 0 && checks.basicOk },
    { key: 'bank',      label: 'Bank account verified',           ok: bankVerified },
    { key: 'itEmail',   label: 'Official email created (IT)',      ok: !!c.it_email_created },
    { key: 'l1Appr',    label: 'L1 approval received',            ok: !!c.l1_approved_at },
    { key: 'payAppr',   label: 'Payroll approval received',       ok: !!c.payroll_approved_at },
    { key: 'itAppr',    label: 'IT approval (optional)',          ok: !!c.it_approved_at, optional: true },
    { key: 'adminAppr', label: 'Admin approval (optional)',       ok: !!c.admin_approved_at, optional: true },
  ]
}
export function allGatesPass(gates: Gate[]): boolean {
  return gates.filter(g => !g.optional).every(g => g.ok)
}
