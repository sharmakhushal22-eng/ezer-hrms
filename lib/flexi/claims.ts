// lib/flexi/claims.ts — Flexi claims data layer (entitlements, balance, submission).
// Entitlement source of truth = the company's flexi policy slab for the employee's
// salary band (flexi_policy_slabs + flexi_slab_limits), with per-employee overrides.
import { supabase } from '@/lib/supabase'

export const NO_INVOICE = ['MEAL', 'DEVICE']   // auto-claimed, no bill needed
export const ACCEPTED_TYPES = '.zip,.png,.jpg,.jpeg,.pdf,.doc,.docx,.xls,.xlsx'
export const FY = '2026-27'

export const COMP_NAMES: Record<string, string> = {
  PDA: 'Prof. Dev. Allowance', TEL: 'Telephone / WiFi', DEVICE: 'Device Leasing',
  LTA: 'Leave Travel Allowance', CAR: 'Car Lease', DRIVER: 'Driver Allowance', FUEL: 'Fuel Reimbursement',
  MEAL: 'Meal (Zaggle)', ATTIRE: 'Corporate Attire', CHEDU: "Children's Education", HOSTEL: 'Hostel Allowance',
}

// Maps the Flexi & TDS Calculator's form keys (COMPS.k) → claims component codes.
const FORM_KEY_TO_CODE: Record<string, string> = {
  pda: 'PDA', tel: 'TEL', device: 'DEVICE', lta: 'LTA', car: 'CAR', driver: 'DRIVER',
  fuel: 'FUEL', meal: 'MEAL', attire: 'ATTIRE', childEdu: 'CHEDU', hostel: 'HOSTEL',
}

export interface ComponentLimit {
  code: string; name: string; annual_limit: number
  claimed: number; approved: number; pending: number; rejected: number
  overridden: boolean
}

const n = (v: any) => (v === null || v === undefined || v === '' ? 0 : Number(v) || 0)

// Annual "fixed" (CTC − variable) — determines the flexi slab band.
async function annualFixed(employeeId: string): Promise<number> {
  const { data: ss } = await supabase.from('salary_structures')
    .select('gross_monthly, employer_pf, employer_esic, gratuity_monthly').eq('employee_id', employeeId)
    .order('effective_date', { ascending: false }).limit(1)
  if (ss?.[0]) {
    const s = ss[0]
    return (n(s.gross_monthly) + n(s.employer_pf) + n(s.employer_esic) + n(s.gratuity_monthly)) * 12
  }
  const { data: cm } = await supabase.from('ctc_master').select('annual_ctc, annual_variable')
    .eq('employee_id', employeeId).order('effective_from', { ascending: false }).limit(1)
  if (cm?.[0]) return n(cm[0].annual_ctc) - n(cm[0].annual_variable)
  return 0
}

// The employee's own claims, via the service-role API route. Falls back to a direct read
// so an admin screen (which does have a session) still works if the route is unavailable.
async function loadClaimsForEmployee(employeeId: string): Promise<any[]> {
  try {
    const r = await fetch(`/api/flexi/claims?employee_id=${encodeURIComponent(employeeId)}`)
    if (r.ok) {
      const j = await r.json()
      if (Array.isArray(j?.claims)) return j.claims
    }
  } catch { /* fall through to the direct read below */ }
  const { data } = await supabase.from('flexi_claims')
    .select('component_code, claim_amount, status').eq('employee_id', employeeId)
  return data || []
}

// Resolve an employee's flexi entitlements for the FY: policy slab limits (regime-aware)
// overlaid with any admin overrides, minus what they've already claimed/approved.
export async function loadEntitlements(employeeId: string): Promise<{
  companyId: string | null; regime: 'old' | 'new'; fixed: number; slabLabel: string | null; limits: ComponentLimit[]
}> {
  const { data: emp } = await supabase.from('employees').select('company_id, tds_regime').eq('id', employeeId).maybeSingle()
  const companyId = (emp as any)?.company_id || null
  const regime: 'old' | 'new' = String((emp as any)?.tds_regime || '').toLowerCase().includes('new') ? 'new' : 'old'
  const fixed = await annualFixed(employeeId)
  if (!companyId) return { companyId, regime, fixed, slabLabel: null, limits: [] }

  // Applicable slab for this company + band.
  const { data: slabs } = await supabase.from('flexi_policy_slabs').select('*')
    .eq('company_id', companyId).eq('is_active', true).order('sort_order')
  const slab = (slabs || []).find((sl: any) => fixed >= n(sl.fixed_from) && fixed <= n(sl.fixed_to)) || (slabs || [])[slabs?.length ? slabs.length - 1 : 0]

  const perComp: Record<string, number> = {}   // slab default limit per component
  if (slab) {
    const [{ data: sl }, { data: comps }] = await Promise.all([
      supabase.from('flexi_slab_limits').select('*').eq('slab_id', slab.id).eq('is_active', true),
      supabase.from('flexi_components').select('id, code'),
    ])
    const codeById: Record<string, string> = {}
    ;(comps || []).forEach((c: any) => { codeById[c.id] = c.code })
    ;(sl || []).forEach((l: any) => {
      const code = codeById[l.component_id]
      if (!code) return
      const max = regime === 'old' ? l.old_regime_max : l.new_regime_max
      // -1 / formula (LTA) → skip a fixed rupee limit; only components with a positive cap are claimable here.
      if (max != null && Number(max) > 0) perComp[code] = Number(max)
    })
  }

  // Declared components (if the employee filed a declaration) refine availability but slab is the base.
  const { data: decls } = await supabase.from('flexi_declarations')
    .select('component_code, old_regime_amt, new_regime_amt').eq('employee_id', employeeId).eq('fy', FY)
  ;(decls || []).forEach((d: any) => {
    const amt = Math.max(n(d.old_regime_amt), n(d.new_regime_amt))
    if (amt > 0) perComp[d.component_code] = amt
  })

  // The employee's own Flexi & TDS Calculator declaration is AUTHORITATIVE: when it
  // exists, only the components they declared in their CHOSEN regime are claimable, at
  // exactly the declared amount. This replaces slab defaults entirely — so a NEW-regime
  // employee never sees an OLD-regime-only component (e.g. Car/Driver) and vice-versa.
  const { data: formRow } = await supabase.from('flexi_tds_forms')
    .select('form_data, regime').eq('employee_id', employeeId).eq('fy', FY).maybeSingle()
  let fd: any = (formRow as any)?.form_data
  if (typeof fd === 'string') { try { fd = JSON.parse(fd) } catch { fd = null } }
  if (fd) {
    // Use the regime the employee actually submitted with; fall back to their tds_regime.
    const chosen = String((formRow as any)?.regime || regime).toLowerCase().includes('new') ? 'new' : 'old'
    const src = chosen === 'new' ? (fd.nFlexi || {}) : (fd.oFlexi || {})
    for (const key of Object.keys(perComp)) delete perComp[key]   // declaration is the source of truth
    ;(Object.keys(FORM_KEY_TO_CODE) as string[]).forEach(k => {
      const amt = n(src[k])
      if (amt > 0) perComp[FORM_KEY_TO_CODE[k]] = amt
    })
  }

  // Overrides replace slab/declaration limits.
  const { data: ovrs } = await supabase.from('flexi_limit_overrides')
    .select('component_code, override_limit').eq('employee_id', employeeId).eq('fy', FY).eq('is_active', true)
  const ovrSet = new Set<string>()
  ;(ovrs || []).forEach((o: any) => { perComp[o.component_code] = n(o.override_limit); ovrSet.add(o.component_code) })

  // Existing claims → totals per component.
  // Fetched through the API, not straight off the table: flexi_claims is RLS-locked to
  // payroll staff (sql97), and ESS runs on the anon key with no Supabase session. Reading
  // it directly would quietly return zero rows here — which does not throw, it just shows
  // the employee a full unused limit and lets them over-claim.
  const claims = await loadClaimsForEmployee(employeeId)
  const tot: Record<string, { claimed: number; approved: number; pending: number; rejected: number }> = {}
  ;(claims || []).forEach((c: any) => {
    const t = tot[c.component_code] || (tot[c.component_code] = { claimed: 0, approved: 0, pending: 0, rejected: 0 })
    const amt = n(c.claim_amount)
    if (c.status === 'APPROVED' || c.status === 'PAYROLL_PROCESSED') { t.approved += amt; t.claimed += amt }
    else if (c.status === 'PENDING') { t.pending += amt; t.claimed += amt }
    else if (c.status === 'REJECTED') t.rejected += amt
  })

  const limits: ComponentLimit[] = Object.keys(perComp).sort().map(code => {
    const t = tot[code] || { claimed: 0, approved: 0, pending: 0, rejected: 0 }
    return { code, name: COMP_NAMES[code] || code, annual_limit: perComp[code], ...t, overridden: ovrSet.has(code) }
  })
  return { companyId, regime, fixed, slabLabel: slab?.slab_label || null, limits }
}

// Current-month window for a company.
export async function loadWindow(companyId: string, year: number, month: number) {
  const { data } = await supabase.from('flexi_windows').select('*')
    .eq('company_id', companyId).eq('year', year).eq('month', month).maybeSingle()
  return data
}
