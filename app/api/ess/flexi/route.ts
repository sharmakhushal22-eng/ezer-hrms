// app/api/ess/flexi/route.ts — an employee's flexi entitlements, in one call.
//
// WHY THIS ROUTE EXISTS
//
// Flexi entitlement resolution is written three times in this product: once in
// lib/flexi/claims.ts, again inside components/ess/EmployeePortal.tsx, and a
// third time in the Android app's repository. All three do the same seven
// steps in the same order, against seven tables read directly on the anon key:
//
//   1. annual fixed = (gross + employer PF + employer ESIC + gratuity) × 12
//   2. the company's slab whose band contains it — else the last slab
//   3. that slab's per-component limits for the employee's regime
//   4. any filed declaration refines them
//   5. a submitted Flexi & TDS form REPLACES them outright, because the
//      employee's own declaration in their chosen regime is authoritative
//   6. admin overrides replace whatever is left
//   7. claims are subtracted to leave what is actually available
//
// Seven steps × three implementations is six chances to drift. Leave already
// proved what that costs. This is the one implementation; the clients render
// what it returns, and POST enforces exactly what GET showed, because both
// call the same resolver below.
//
// flexi_claims is RLS-locked to payroll staff (sql97), which is why the other
// clients fetch claims through /api/flexi/claims with an employee_id in the
// query — one of the routes that still trusts a caller-supplied id. Here the
// service role reads the table directly and the employee comes from the
// session, so no id is passed anywhere.
import { NextRequest, NextResponse } from 'next/server'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { essRoute, forbidden, audit } from '@/lib/ess/session'

export const dynamic = 'force-dynamic'

// Kept here rather than imported from lib/flexi/claims: that module builds a
// browser Supabase client at import time, and no API route in this repo pulls
// it in. These are display labels and a constant — worth a copy to keep a
// server route free of a client data layer. lib/flexi/claims.ts is the copy to
// change first if the catalogue moves.
const FY = '2026-27'

const COMP_NAMES: Record<string, string> = {
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
interface Head {
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
const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * The seven steps, once. Both GET and POST go through this, so what the
 * employee is shown and what the server will accept cannot disagree.
 */
async function resolveFlexi(me: string) {
  const now = new Date(Date.now() + 5.5 * 3600_000)
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth() + 1

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
    companyId
      ? sb.from('flexi_windows').select('id, status, opens_at, closes_at')
          .eq('company_id', companyId).eq('year', year).eq('month', month).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  // 1. The band the employee sits in.
  const salary = rows<SalaryRow>(salaryR.data)[0]
  const annualFixed = salary
    ? (num(salary.gross_monthly) + num(salary.employer_pf) + num(salary.employer_esic)
        + num(salary.gratuity_monthly)) * 12
    : 0

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
  const windowOpen = String(window?.status ?? '').toUpperCase() === 'OPEN'

  return {
    companyId, regime, annualFixed, slab, heads, claims, window, windowOpen,
    diagnostics: {
      noSalaryStructure: !salary,
      noSlab: !slab,
      noDeclaration: !declared,
      noHeads: !heads.length,
      noWindow: !window,
      windowClosed: !!window && !windowOpen,
    },
  }
}

export async function GET(req: NextRequest) {
  const r = await essRoute(req)
  if (r.error) return r.error
  const f = await resolveFlexi(r.ctx.caller.employeeId)

  return NextResponse.json({
    fy: FY,
    regime: f.regime,
    annual_fixed: f.annualFixed,
    slab: f.slab ? { id: f.slab.id, label: f.slab.slab_label } : null,
    window: f.window
      ? {
          id: f.window.id, status: f.window.status, open: f.windowOpen,
          opens_at: f.window.opens_at, closes_at: f.window.closes_at,
        }
      : null,
    heads: f.heads,
    claims: f.claims.slice()
      .sort((a, b) => String(b.bill_date ?? '').localeCompare(String(a.bill_date ?? ''))),
    // Why a head list is empty, which is the common case until HR publishes a
    // policy and the employee files their declaration.
    diagnostics: f.diagnostics,
  })
}

// ═══════════════════════════════════════════════════════════════════════════
// POST — submit a claim, against the entitlement this route just worked out
//
// /api/flexi/claims already accepts a SUBMIT, but it takes employee_id from the
// body and checks only the window and that the amount is positive. Nothing
// stops a claim larger than the entitlement the screen displayed. Here the
// employee comes from the session and the limit is enforced against the same
// resolver that produced the number they saw.
// ═══════════════════════════════════════════════════════════════════════════
export async function POST(req: NextRequest) {
  const r = await essRoute(req)
  if (r.error) return r.error
  const { ctx } = r
  if (ctx.caller.viewAs) return forbidden('A claim cannot be submitted while viewing as somebody else.')

  const me = ctx.caller.employeeId
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const bad = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status })
  const text = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

  const code = text(body.component_code, 20).toUpperCase()
  const amount = num(body.claim_amount)
  if (!code) return bad('Say which flexi head this claim is against.')
  if (!(amount > 0)) return bad('The claim amount has to be more than zero.')

  const f = await resolveFlexi(me)

  // The window the claim belongs to: the one asked for, or this month's.
  const windowId = text(body.window_id, 64) || f.window?.id || ''
  if (!windowId) return bad('There is no flexi submission window open for your company this month.')
  if (windowId === f.window?.id) {
    if (!f.windowOpen) return bad('The submission window is closed.')
  } else {
    // A window from another month, named explicitly: check it directly, and
    // that it is this employee's company's.
    const { data } = await sb.from('flexi_windows')
      .select('id, status, company_id').eq('id', windowId).maybeSingle()
    const w = (data ?? null) as { status?: string | null; company_id?: string | null } | null
    if (!w || (f.companyId && w.company_id !== f.companyId)) return bad('That submission window does not exist.', 404)
    if (String(w.status ?? '').toUpperCase() !== 'OPEN') return bad('The submission window is closed.')
  }

  const head = f.heads.find(h => h.code === code)
  if (!head) {
    return bad(f.diagnostics.noDeclaration
      ? `${COMP_NAMES[code] ?? code} is not one of your flexi heads. File your Flexi & TDS declaration first.`
      : `${COMP_NAMES[code] ?? code} is not one of your flexi heads this year.`)
  }
  if (amount > head.available) {
    return bad(`You have ₹${Math.round(head.available).toLocaleString('en-IN')} of ${head.name} left; this claim is ₹${Math.round(amount).toLocaleString('en-IN')}.`, 409)
  }

  // The same rule /api/flexi/claims applies, so a claim looks the same to
  // payroll whichever door it came through.
  const aiFlag = amount > 15000 ? 'flag' : 'clear'
  const agency = text(body.agency_name) || text(body.vendor_desc) || null

  const { data, error } = await sb.from('flexi_claims').insert({
    window_id: windowId,
    employee_id: me,                       // the session's, never the body's
    company_id: f.companyId,
    component_code: code,
    claim_amount: amount,
    bill_date: text(body.bill_date, 10) || null,
    bill_no: text(body.bill_no, 60) || null,
    agency_name: agency,
    vendor_desc: agency,
    remark: text(body.remark, 500) || null,
    supporting_remark: text(body.supporting_remark, 500) || null,
    status: 'PENDING',
    ai_flag: aiFlag,
    ai_notes: aiFlag === 'flag' ? 'Amount above ₹15,000 — manual review recommended' : null,
  }).select('id, status').maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await audit(ctx.caller, 'FLEXI_CLAIM_SUBMITTED', me, { component_code: code, amount })

  const claim = (data ?? null) as { id?: string; status?: string } | null
  return NextResponse.json({
    ok: true,
    claim_id: claim?.id,
    status: claim?.status ?? 'PENDING',
    // What is left after this one, so the screen need not refetch to update.
    available_after: Math.max(0, head.available - amount),
  })
}
