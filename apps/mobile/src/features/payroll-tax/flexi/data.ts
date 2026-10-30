// src/features/payroll-tax/flexi/data.ts — every Supabase read and write the Flexi &
// TDS calculator makes, copied verbatim from components/ess/FlexiTdsCalculator.tsx
// (mount effect lines 131–174, persistForm 177–186, submitRegime 783–836).
import { supabase } from '@/core/supabase'
import {
  FY, N, initialChild, initialForm, joinedMidYear, norm,
  type Child, type Flexi, type Form, type Regime, type Tax,
} from '../tax'

export interface FlexiLoad { cm: any | null; emp: any | null; decl: any | null; form: any | null }

/** The four parallel reads on mount. Errors are swallowed exactly as the website does. */
export async function loadFlexi(employeeId: string): Promise<FlexiLoad> {
  const [{ data: cm }, { data: emp }, declRes, formRes] = await Promise.all([
    supabase.from('ctc_master').select('annual_ctc, annual_variable').eq('employee_id', employeeId).order('effective_from', { ascending: false }).limit(1),
    supabase.from('employees').select('company_id, company_doj, group_doj, tds_regime').eq('id', employeeId).maybeSingle(),
    supabase.from('tds_declarations').select('regime, declaration_status').eq('employee_id', employeeId).eq('fy', FY).maybeSingle().then(r => r, () => ({ data: null })),
    supabase.from('flexi_tds_forms').select('regime, status, form_data').eq('employee_id', employeeId).eq('fy', FY).maybeSingle().then(r => r, () => ({ data: null })),
  ])
  return { cm: (cm as any)?.[0] || null, emp: emp || null, decl: (declRes as any)?.data || null, form: (formRes as any)?.data || null }
}

export interface FlexiInit {
  companyId: string | null
  f: Form; oFlexi: Flexi; nFlexi: Flexi; child: Child
  chosenRegime: Regime | null; userPicked: boolean
  status: 'NEW' | 'DRAFT' | 'SUBMITTED'; saved: boolean
  defaultedByRule: string | null; defaultedNew: boolean
}

/** The mount effect's state transitions, applied to a fresh state. */
export function initFrom(d: FlexiLoad): FlexiInit {
  const s: FlexiInit = {
    companyId: d.emp?.company_id || null,
    f: initialForm(), oFlexi: {}, nFlexi: {}, child: initialChild(),
    chosenRegime: null, userPicked: false, status: 'NEW', saved: false, defaultedByRule: null, defaultedNew: false,
  }
  const doj = d.emp?.company_doj || d.emp?.group_doj
  // CTC, variable and DOJ always come from the record, never from the saved form: they are not
  // the employee's to change, and a form saved before a revision holds stale pay (web 2e43849).
  const prefill = () => {
    if (d.cm) s.f = { ...s.f, ctc: String(Math.round(d.cm.annual_ctc || 0)), variable: String(Math.round(d.cm.annual_variable || 0)) }
    if (doj) s.f = { ...s.f, doj: String(doj).slice(0, 10) }
  }

  // Restore a previously saved form (draft or submitted).
  const savedForm = d.form
  if (savedForm?.form_data) {
    let fd: any = savedForm.form_data || {}
    if (typeof fd === 'string') { try { fd = JSON.parse(fd) } catch { fd = {} } }
    if (fd.f) s.f = { ...s.f, ...fd.f }
    if (fd.oFlexi) s.oFlexi = fd.oFlexi
    if (fd.nFlexi) s.nFlexi = fd.nFlexi
    if (fd.child) s.child = fd.child
    if (savedForm.regime) { s.chosenRegime = norm(savedForm.regime); s.userPicked = true }
    s.status = savedForm.status === 'SUBMITTED' ? 'SUBMITTED' : 'DRAFT'
    if (savedForm.status === 'SUBMITTED') s.saved = true
    prefill()
    return s
  }

  // No saved form — fresh prefill, then the default regime.
  prefill()
  const decl = d.decl
  if (decl?.declaration_status === 'SUBMITTED' && decl?.regime) { s.chosenRegime = norm(decl.regime); s.userPicked = true; return s }
  // updated_at / created_at are not selected on the website either, so this is always 'the 5th'.
  if (decl?.declaration_status === 'DEFAULTED') s.defaultedByRule = decl.updated_at || decl.created_at || 'the 5th'
  if (d.emp?.tds_regime) { s.chosenRegime = norm(d.emp.tds_regime); s.userPicked = true; return s }
  if (doj && joinedMidYear(doj)) { s.chosenRegime = 'NEW'; s.defaultedNew = true }
  return s
}

export interface FormState { f: Form; oFlexi: Flexi; nFlexi: Flexi; child: Child }

/** persistForm(newStatus) — the full calculator state to flexi_tds_forms. */
export function persistForm(employeeId: string, companyId: string | null, chosenRegime: Regime | null, newStatus: 'DRAFT' | 'SUBMITTED', st: FormState) {
  const payload = {
    employee_id: employeeId, company_id: companyId, fy: FY,
    regime: chosenRegime, status: newStatus,
    form_data: { f: st.f, oFlexi: st.oFlexi, nFlexi: st.nFlexi, child: st.child },
    submitted_at: newStatus === 'SUBMITTED' ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  }
  return supabase.from('flexi_tds_forms').upsert(payload, { onConflict: 'employee_id,fy' })
}

/** submitRegime() after the confirm: the four writes. Returns the only error the website checks. */
export async function submitWrites(employeeId: string, companyId: string | null, chosenRegime: Regime, T: Tax, st: FormState): Promise<{ message: string } | null> {
  const f = st.f
  const isOld = chosenRegime === 'OLD'
  const monthlyTds = isOld ? T.moO : T.moN
  // Primary store: employees.tds_regime (read by flexi / claims / payroll).
  const { error } = await supabase.from('employees').update({ tds_regime: chosenRegime }).eq('id', employeeId)
  try { await persistForm(employeeId, companyId, chosenRegime, 'SUBMITTED', st) } catch { /* form store optional */ }
  try {
    await supabase.from('tds_declarations').upsert({
      employee_id: employeeId, company_id: companyId, fy: FY, regime: chosenRegime,
      sec_80c: T.c80, sec_80d: T.medS + T.medP, sec_80e: T.eduLoan, sec_24b: T.hlI,
      hra_claimed: T.hE, lta_claimed: T.ltaAmt, nps_80ccd1b: T.npsS,
      employer_nps_80ccd2: isOld ? T.eNpsO : T.eNpsN,
      total_declared: T.c80 + T.medS + T.medP + T.hlI + T.eduLoan + T.npsS,
      annual_tax_old: T.fO, annual_tax_new: T.fN, monthly_tds: monthlyTds,
      monthly_rent: N(f.rentM), is_metro: f.cityType === 'metro',
      landlord_pan: f.landlordPAN ? String(f.landlordPAN).toUpperCase() : null,
      sec_80d_self: T.medS, sec_80d_parents: T.medP,
      declaration_status: 'SUBMITTED', submitted_at: new Date().toISOString(),
    }, { onConflict: 'employee_id,fy' })
  } catch { /* tds_declarations optional */ }
  try {
    // 80G (pmFund) is written under 80CCC — as the website does.
    const lines = [
      ['80C_LIC', N(f.lic)], ['80C_PPF', N(f.ppf)], ['80C_ELSS', N(f.elss)], ['80C_TUITION', N(f.tuit)],
      ['80C_PRINCIPAL', N(f.hlP)], ['80CCC', N(f.pmFund)], ['80CCD_1B', N(f.npsSelf)],
      ['80D_SELF', N(f.medSelf)], ['80D_PARENTS', N(f.medParents)], ['80E', N(f.eduLoan)], ['24B_SELF', N(f.hlInt)],
    ] as [string, number][]
    const rows = lines.map(([section_code, declared_amount]) => ({
      employee_id: employeeId, fy: FY, section_code, declared_amount, source: 'calculator', updated_at: new Date().toISOString(),
    }))
    await supabase.from('investment_declaration_lines').upsert(rows, { onConflict: 'employee_id,fy,section_code' })
  } catch { /* lines table optional */ }
  return error ? { message: error.message } : null
}
