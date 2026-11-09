// lib/flexi/resolve-server.ts — an employee's flexi entitlements, worked out once, server-side.
//
// Moved out of app/api/ess/flexi/route.ts so both doors a claim comes through — that route
// (the app) and /api/flexi/claims (the web ESS and HR's Submit Bill) — enforce the same
// balance the screen showed. See the route's header for the seven steps.
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { currentClaimWindow } from './window-server'
import { windowOpenAt, nextOpening } from './window'

// Kept here rather than imported from lib/flexi/claims: that module builds a
// browser Supabase client at import time, and no API route in this repo pulls
// it in. These are display labels and a constant — worth a copy to keep a
// server route free of a client data layer. lib/flexi/claims.ts is the copy to
// change first if the catalogue moves.
export const FY = '2026-27'

export const COMP_NAMES: Record<string, string> = {
  PDA: 'Prof. Dev. Allowance', TEL: 'Telephone / WiFi', DEVICE: 'Device Leasing',
  LTA: 'Leave Travel Allowance', CAR: 'Car Lease', DRIVER: 'Driver Allowance', FUEL: 'Fuel Reimbursement',
  MEAL: 'Meal (Zaggle)', ATTIRE: 'Corporate Attire', CHEDU: "Children's Education", HOSTEL: 'Hostel Allowance',
}

/** The Flexi & TDS Calculator's form keys → claims component codes. */
const FORM_KEY_TO_CODE: Record<string, string> = {
  pda: 'PDA', tel: 'TEL', device: 'DEVICE', lta: 'LTA', car: 'CAR', driver: 'DRIVER',
  fuel: 'FUEL', meal: 'MEAL', attire: 'ATTIRE', childEdu: 'CHEDU', hostel: 'HOSTEL',
}

interface SalaryRow {
  gross_monthly: number | null
  employer_pf: number | null
  employer_esic: number | null
  gratuity_monthly: number | null
}
interface SlabRow { id: string; slab_label: string | null; fixed_from: number | null; fixed_to: number | null }
interface SlabLimitRow { component_id: string; old_regime_max: number | null; new_regime_max: number | null }
interface ComponentRow { id: string; code: string; name: string | null }
interface DeclarationRow { component_code: string; old_regime_amt: number | null; new_regime_amt: number | null }
interface OverrideRow { component_code: string; override_limit: number | null }
interface FormRow { form_data: unknown; regime: string | null }
interface WindowRow { id: string; status: string | null; opens_at: string | null; closes_at: string | null }
interface ClaimRow {
  id: string
  component_code: string
  claim_amount: number | null
  approved_amount: number | null
  status: string | null
  bill_date: string | null
  bill_no: string | null
  rejection_reason: string | null
}
export interface Head {
  code: string
  name: string
  annual_limit: number
  claimed: number
  approved: number
  pending: number
  rejected: number
  available: number
  overridden: boolean
}

const rows = <T>(data: unknown): T[] => (Array.isArray(data) ? (data as T[]) : [])
export const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * The seven steps, once. Both GET and POST go through this, so what the
 * employee is shown and what the server will accept cannot disagree.
 */
export async function resolveFlexi(me: string) {
  const { data: empRow } = await sb.from('employees')
    .select('company_id, tds_regime').eq('id', me).maybeSingle()
  const emp = (empRow ?? null) as { company_id?: string | null; tds_regime?: string | null } | null
  const companyId = emp?.company_id ?? null
  const regime: 'old' | 'new' =
    String(emp?.tds_regime ?? '').toLowerCase().includes('new') ? 'new' : 'old'

  const [salaryR, slabR, compR, declR, formR, ovrR, claimR, windowR] = await Promise.all([
    sb.from('salary_structures')
      .select('gross_monthly, employer_pf, employer_esic, gratuity_monthly')
      .eq('employee_id', me).order('effective_date', { ascending: false }).limit(1),
    companyId
      ? sb.from('flexi_policy_slabs').select('id, slab_label, fixed_from, fixed_to')
          .eq('company_id', companyId).eq('is_active', true).order('sort_order')
      : Promise.resolve({ data: [] }),
    sb.from('flexi_components').select('id, code, name'),
    sb.from('flexi_declarations')
      .select('component_code, old_regime_amt, new_regime_amt').eq('employee_id', me).eq('fy', FY),
    sb.from('flexi_tds_forms')
      .select('form_data, regime').eq('employee_id', me).eq('fy', FY).maybeSingle(),
    sb.from('flexi_limit_overrides')
      .select('component_code, override_limit').eq('employee_id', me).eq('fy', FY).eq('is_active', true),
    sb.from('flexi_claims')
      .select('id, component_code, claim_amount, approved_amount, status, bill_date, bill_no, rejection_reason')
      .eq('employee_id', me),
    // This month's claim window row (the 1st–20th, lib/flexi/window), made if missing.
    companyId ? currentClaimWindow(sb, companyId).then(data => ({ data })) : Promise.resolve({ data: null }),
  ])

  // 1. The band the employee sits in.
  const salary = rows<SalaryRow>(salaryR.data)[0]
  let annualFixed = salary
    ? (num(salary.gross_monthly) + num(salary.employer_pf) + num(salary.employer_esic)
        + num(salary.gratuity_monthly)) * 12
    : 0
  // No salary structure yet (a fresh joiner): fixed CTC from ctc_master, as lib/flexi/claims
  // does, so the web screen and this resolver put the employee in the same slab.
  if (!salary) {
    const { data: cm } = await sb.from('ctc_master').select('annual_ctc, annual_variable')
      .eq('employee_id', me).order('effective_from', { ascending: false }).limit(1)
    const c = rows<{ annual_ctc: number | null; annual_variable: number | null }>(cm)[0]
    if (c) annualFixed = num(c.annual_ctc) - num(c.annual_variable)
  }

  // 2. The slab covering it, or the last one — an employee above every band
  //    keeps the top slab rather than losing flexi altogether.
  const slabs = rows<SlabRow>(slabR.data)
  const slab = slabs.find(s => annualFixed >= num(s.fixed_from) && annualFixed <= num(s.fixed_to))
    ?? slabs[slabs.length - 1]

  const components = rows<ComponentRow>(compR.data)
  const codeById = new Map(components.map(c => [c.id, c.code]))
  const nameByCode = new Map(components.map(c => [c.code, c.name ?? c.code]))

  // 3. Slab limits for this regime. A limit of -1 or a formula (LTA, gratuity)
  //    carries no rupee cap, so it is not claimable through this desk.
  const limits: Record<string, number> = {}
  if (slab) {
    const { data } = await sb.from('flexi_slab_limits')
      .select('component_id, old_regime_max, new_regime_max')
      .eq('slab_id', slab.id).eq('is_active', true)
    for (const l of rows<SlabLimitRow>(data)) {
      const code = codeById.get(l.component_id)
      const max = num(regime === 'old' ? l.old_regime_max : l.new_regime_max)
      if (code && max > 0) limits[code] = max
    }
  }

  // 4. A filed declaration refines the slab default.
  for (const d of rows<DeclarationRow>(declR.data)) {
    const amt = Math.max(num(d.old_regime_amt), num(d.new_regime_amt))
    if (amt > 0) limits[d.component_code] = amt
  }

  // 5. A submitted Flexi & TDS form replaces them entirely, in the regime the
  //    employee actually submitted under — so a new-regime employee never sees
  //    an old-regime-only component, and vice versa.
  const form = (formR.data ?? null) as FormRow | null
  let formData: unknown = form?.form_data
  if (typeof formData === 'string') {
    try { formData = JSON.parse(formData) } catch { formData = null }
  }
  const declared = !!formData && typeof formData === 'object'
  if (declared) {
    const chosen = String(form?.regime ?? regime).toLowerCase().includes('new') ? 'new' : 'old'
    const fd = formData as Record<string, unknown>
    const src = (fd[chosen === 'new' ? 'nFlexi' : 'oFlexi'] ?? {}) as Record<string, unknown>
    for (const key of Object.keys(limits)) delete limits[key]
    for (const [formKey, code] of Object.entries(FORM_KEY_TO_CODE)) {
      const amt = num(src[formKey])
      if (amt > 0) limits[code] = amt
    }
  }

  // 6. Admin overrides win over everything above.
  const overridden = new Set<string>()
  for (const o of rows<OverrideRow>(ovrR.data)) {
    limits[o.component_code] = num(o.override_limit)
    overridden.add(o.component_code)
  }

  // 7. What has already been claimed against each head.
  const claims = rows<ClaimRow>(claimR.data)
  const totals: Record<string, { claimed: number; approved: number; pending: number; rejected: number }> = {}
  for (const c of claims) {
    const t = totals[c.component_code]
      ?? (totals[c.component_code] = { claimed: 0, approved: 0, pending: 0, rejected: 0 })
    const amt = num(c.claim_amount)
    const status = String(c.status ?? '').toUpperCase()
    if (status === 'APPROVED' || status === 'PAYROLL_PROCESSED') { t.approved += amt; t.claimed += amt }
    else if (status === 'PENDING') { t.pending += amt; t.claimed += amt }
    else if (status === 'REJECTED') t.rejected += amt
  }

  const heads: Head[] = Object.keys(limits).sort().map(code => {
    const t = totals[code] ?? { claimed: 0, approved: 0, pending: 0, rejected: 0 }
    return {
      code,
      name: COMP_NAMES[code] ?? nameByCode.get(code) ?? code,
      annual_limit: limits[code],
      claimed: t.claimed,
      approved: t.approved,
      pending: t.pending,
      rejected: t.rejected,
      // What is actually left to claim, computed once, here.
      available: Math.max(0, limits[code] - t.claimed),
      overridden: overridden.has(code),
    }
  })

  const window = (windowR.data ?? null) as WindowRow | null
  // The 1st–20th of every month (lib/flexi/window); inside it, what stops a bill is a
  // component with nothing left (heads[].available).
  const windowOpen = !!window && windowOpenAt(new Date())

  return {
    companyId, regime, annualFixed, slab, heads, claims, window, windowOpen,
    diagnostics: {
      noSalaryStructure: !salary,
      noSlab: !slab,
      noDeclaration: !declared,
      noHeads: !heads.length,
      noWindow: !window,
      windowClosed: !!window && !windowOpen,
      /** YYYY-MM-DD the window opens again when it is closed (the 1st of next month). */
      reopensOn: windowOpen ? null : nextOpening(new Date()),
    },
  }
}

