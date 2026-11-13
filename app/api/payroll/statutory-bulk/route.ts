// app/api/payroll/statutory-bulk/route.ts — bulk maintain the per-employee statutory MASTER
// INPUTS behind Payroll → Statutory & Tax, for four sections:
//
//   epf   → employees.uan_number, pf_applicable, epf_wage_limit
//   esic  → employees.esic_number, esic_applicable
//   vpf   → vpf_declarations (supersede-then-insert, server computes the amounts)
//   nps   → nps_declarations (supersede-then-insert, server computes basic × regime %)
//
//   GET  ?kind=&company_id=   one row per in-scope employee, prefilled with their current values
//   POST { kind, company_id, rows }   apply the edited rows; the next payroll run picks them up
//
// These are the inputs the month's Data Sync reads — not the computed figures. Writing them
// here changes what the next Run/Calculate produces; it never edits a frozen month directly.
// Service-role client behind requireAccess('Payroll', …); company-scoped to the caller's grant.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAccess, refuse } from '@/lib/rms/authz'
import { allowedCompanies } from '@/lib/rms/resolve'

export const runtime = 'nodejs'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!,
)

const CURRENT_FY = '2026-27'
const EPF_CEILING = 15000
const VPF_MAX_PCT = 88
const NPS_RATE = { OLD: 10, NEW: 14 }
const KINDS = ['epf', 'esic', 'pt', 'lwf', 'vpf', 'nps'] as const
type Kind = typeof KINDS[number]

const num = (v: any) => (v === '' || v === null || v === undefined ? null : Number(v))
const bool = (v: any) => { const s = String(v ?? '').trim().toLowerCase(); return ['y', 'yes', 'true', '1'].includes(s) }
const digits = (v: any) => String(v ?? '').replace(/\D/g, '')

// The columns each kind downloads/uploads/edits. `key` is the sheet column key; `label` the
// header; `type` tells the inline editor which control to render ('bool' → Y/N select).
type Col = { key: string; label: string; type: 'text' | 'bool' | 'num' }
const COLUMNS: Record<Kind, Col[]> = {
  epf: [
    { key: 'uan_number', label: 'UAN Number', type: 'text' },
    { key: 'pf_applicable', label: 'PF Applicable (Y/N)', type: 'bool' },
    { key: 'epf_wage_limit', label: 'EPF Wage Ceiling (15000 = capped, 999999999 = uncapped)', type: 'num' },
  ],
  esic: [
    { key: 'esic_number', label: 'ESIC IP Number', type: 'text' },
    { key: 'esic_applicable', label: 'ESIC Applicable (Y/N)', type: 'bool' },
  ],
  pt: [
    { key: 'pt_applicable', label: 'PT Applicable (Y/N)', type: 'bool' },
    { key: 'professional_tax_state', label: 'PT State', type: 'text' },
  ],
  lwf: [
    { key: 'lwf_applicable', label: 'LWF Applicable (Y/N)', type: 'bool' },
    { key: 'lwf_state', label: 'LWF State', type: 'text' },
  ],
  vpf: [{ key: 'vpf_percent', label: 'VPF % (0 to stop, max 88)', type: 'num' }],
  nps: [
    { key: 'pran_number', label: 'PRAN Number (12 digits, blank = skip)', type: 'text' },
    { key: 'tier_type', label: 'Tier (Tier I / Tier II)', type: 'text' },
  ],
}

/** Companies this grant may act on. null = all (cross-company/legacy/super). [] = none. */
function scopeCompanies(grant: any, companyIdParam: string): string[] | null {
  if (grant.crossCompany || grant.legacy || grant.isSuperAdmin) return companyIdParam ? [companyIdParam] : null
  const allowed = allowedCompanies(grant, 'Payroll')
  if (companyIdParam) return allowed.includes(companyIdParam) ? [companyIdParam] : []
  return allowed
}

async function activeEmployees(cos: string[] | null) {
  let q = sb.from('employees')
    .select('id, emp_code, full_name, company_id, tds_regime, uan_number, pf_applicable, epf_wage_limit, esic_number, esic_applicable, pt_applicable, professional_tax_state, lwf_applicable, lwf_state')
    .eq('employment_type', 'Employee').order('emp_code')
  if (cos) { if (!cos.length) return []; q = q.in('company_id', cos) }
  const { data } = await q
  return data || []
}

// ── GET: prefilled rows ──────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const kind = (req.nextUrl.searchParams.get('kind') || '') as Kind
  if (!KINDS.includes(kind)) return refuse(400, 'Unknown section.')
  const auth = await requireAccess(req, 'Payroll', 'VIEW')
  if (auth.error) return auth.error
  const cos = scopeCompanies(auth.grant, req.nextUrl.searchParams.get('company_id') || '')

  const emps = await activeEmployees(cos)
  const byId = new Map(emps.map(e => [e.id, e]))

  // For NPS / VPF the current value lives in a declaration table, not on the employee.
  const current: Record<string, any> = {}
  if (kind === 'nps' && emps.length) {
    const { data } = await sb.from('nps_declarations').select('employee_id, pran_number, tier_type')
      .in('employee_id', [...byId.keys()]).in('status', ['ACTIVE', 'PENDING_PRAN'])
    ;(data || []).forEach(d => { current[d.employee_id] = d })
  } else if (kind === 'vpf' && emps.length) {
    const { data } = await sb.from('vpf_declarations').select('employee_id, vpf_percent')
      .in('employee_id', [...byId.keys()]).eq('status', 'ACTIVE')
    ;(data || []).forEach(d => { current[d.employee_id] = d })
  }

  const rows = emps.map(e => {
    const base: any = { emp_code: e.emp_code, full_name: e.full_name }
    if (kind === 'epf') { base.uan_number = e.uan_number ?? ''; base.pf_applicable = e.pf_applicable ? 'Y' : 'N'; base.epf_wage_limit = e.epf_wage_limit ?? EPF_CEILING }
    else if (kind === 'esic') { base.esic_number = e.esic_number ?? ''; base.esic_applicable = e.esic_applicable ? 'Y' : 'N' }
    else if (kind === 'pt') { base.pt_applicable = e.pt_applicable ? 'Y' : 'N'; base.professional_tax_state = e.professional_tax_state ?? '' }
    else if (kind === 'lwf') { base.lwf_applicable = e.lwf_applicable ? 'Y' : 'N'; base.lwf_state = e.lwf_state ?? '' }
    else if (kind === 'vpf') { base.vpf_percent = current[e.id]?.vpf_percent ?? 0 }
    else if (kind === 'nps') { base.pran_number = current[e.id]?.pran_number ?? ''; base.tier_type = current[e.id]?.tier_type ?? 'Tier I' }
    return base
  })

  return NextResponse.json({ kind, columns: COLUMNS[kind], rows })
}

// ── POST: apply edited rows ──────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const kind = (body?.kind || '') as Kind
  const uploaded: any[] = Array.isArray(body?.rows) ? body.rows : []
  if (!KINDS.includes(kind)) return refuse(400, 'Unknown section.')
  if (!uploaded.length) return refuse(400, 'The sheet has no rows.')

  const auth = await requireAccess(req, 'Payroll', 'EDIT')
  if (auth.error) return auth.error
  const grant = auth.grant
  const cos = scopeCompanies(grant, body?.company_id || '')
  if (cos && !cos.length) return refuse(403, 'You have no payroll company in scope.')

  // Resolve emp_code → employee, only within the caller's scope.
  const codes = [...new Set(uploaded.map(r => String(r.emp_code || '').trim().toUpperCase()).filter(Boolean))]
  if (!codes.length) return refuse(400, 'No employee codes in the sheet.')
  let eq = sb.from('employees').select('id, emp_code, full_name, company_id, tds_regime').in('emp_code', codes)
  if (cos) eq = eq.in('company_id', cos)
  const { data: emps } = await eq
  const byCode = new Map((emps || []).map(e => [String(e.emp_code).toUpperCase(), e]))

  // CTC per employee is needed to recompute NPS/VPF amounts.
  const ctcById = new Map<string, any>()
  if ((kind === 'vpf' || kind === 'nps') && emps?.length) {
    const { data: ctcs } = await sb.from('ctc_master')
      .select('employee_id, annual_ctc, annual_variable, basic_annual, hra_annual, epf_wage_limit')
      .in('employee_id', emps.map(e => e.id)).order('created_at', { ascending: false })
    ;(ctcs || []).forEach(c => { if (!ctcById.has(c.employee_id)) ctcById.set(c.employee_id, c) }) // first = latest
  }

  const actor = grant.employeeId ?? null
  const results: { emp_code: string; status: 'updated' | 'skipped' | 'error'; message?: string }[] = []
  const nowIso = new Date().toISOString()

  for (const raw of uploaded) {
    const code = String(raw.emp_code || '').trim().toUpperCase()
    if (!code) { results.push({ emp_code: '', status: 'error', message: 'Missing employee code' }); continue }
    const emp = byCode.get(code)
    if (!emp) { results.push({ emp_code: code, status: 'error', message: 'Not found or outside your access' }); continue }

    try {
      if (kind === 'epf') {
        const patch: any = {}
        if ('uan_number' in raw) { const u = digits(raw.uan_number); if (u && u.length !== 12) { results.push({ emp_code: code, status: 'error', message: 'UAN must be 12 digits' }); continue } patch.uan_number = u || null }
        if ('pf_applicable' in raw) patch.pf_applicable = bool(raw.pf_applicable)
        if ('epf_wage_limit' in raw && raw.epf_wage_limit !== '') { const n = num(raw.epf_wage_limit); if (n == null || n < 0) { results.push({ emp_code: code, status: 'error', message: 'Invalid wage ceiling' }); continue } patch.epf_wage_limit = n }
        if (!Object.keys(patch).length) { results.push({ emp_code: code, status: 'skipped' }); continue }
        const { error } = await sb.from('employees').update(patch).eq('id', emp.id)
        results.push(error ? { emp_code: code, status: 'error', message: error.message } : { emp_code: code, status: 'updated' })
      }

      else if (kind === 'esic') {
        const patch: any = {}
        if ('esic_number' in raw) patch.esic_number = String(raw.esic_number ?? '').trim() || null
        if ('esic_applicable' in raw) patch.esic_applicable = bool(raw.esic_applicable)
        if (!Object.keys(patch).length) { results.push({ emp_code: code, status: 'skipped' }); continue }
        const { error } = await sb.from('employees').update(patch).eq('id', emp.id)
        results.push(error ? { emp_code: code, status: 'error', message: error.message } : { emp_code: code, status: 'updated' })
      }

      else if (kind === 'pt') {
        const patch: any = {}
        if ('pt_applicable' in raw) patch.pt_applicable = bool(raw.pt_applicable)
        if ('professional_tax_state' in raw) patch.professional_tax_state = String(raw.professional_tax_state ?? '').trim() || null
        if (!Object.keys(patch).length) { results.push({ emp_code: code, status: 'skipped' }); continue }
        const { error } = await sb.from('employees').update(patch).eq('id', emp.id)
        results.push(error ? { emp_code: code, status: 'error', message: error.message } : { emp_code: code, status: 'updated' })
      }

      else if (kind === 'lwf') {
        const patch: any = {}
        if ('lwf_applicable' in raw) patch.lwf_applicable = bool(raw.lwf_applicable)
        if ('lwf_state' in raw) patch.lwf_state = String(raw.lwf_state ?? '').trim() || null
        if (!Object.keys(patch).length) { results.push({ emp_code: code, status: 'skipped' }); continue }
        const { error } = await sb.from('employees').update(patch).eq('id', emp.id)
        results.push(error ? { emp_code: code, status: 'error', message: error.message } : { emp_code: code, status: 'updated' })
      }

      else if (kind === 'vpf') {
        const ctc = ctcById.get(emp.id)
        const limit = ctc?.epf_wage_limit ?? EPF_CEILING
        const annualFixed = (ctc?.annual_ctc ?? 0) - (ctc?.annual_variable ?? 0)
        const monthlyGross = Math.round(annualFixed / 12)
        const monthlyHra = Math.round((ctc?.hra_annual ?? 0) / 12)
        const wageBase = Math.round(Math.min(Math.max(0, monthlyGross - monthlyHra), limit))
        let pct = Number(raw.vpf_percent)
        if (!Number.isFinite(pct) || pct < 0) { results.push({ emp_code: code, status: 'error', message: 'Invalid VPF %' }); continue }
        if (pct > VPF_MAX_PCT) pct = VPF_MAX_PCT

        const { data: active } = await sb.from('vpf_declarations').select('*').eq('employee_id', emp.id).eq('status', 'ACTIVE').maybeSingle()
        if (pct === 0) {
          if (!active) { results.push({ emp_code: code, status: 'skipped' }); continue }
          await sb.from('vpf_declarations').update({ status: 'STOPPED', stopped_at: nowIso, stopped_reason: 'Bulk update' }).eq('id', active.id)
          await sb.from('vpf_audit_log').insert({ declaration_id: active.id, employee_id: emp.id, action: 'STOPPED', old_value: { vpf_percent: active.vpf_percent }, monthly_vpf_amount: 0, performed_by: actor, source: 'HR' })
          results.push({ emp_code: code, status: 'updated', message: 'VPF stopped' }); continue
        }
        if (active && Number(active.vpf_percent) === pct) { results.push({ emp_code: code, status: 'skipped' }); continue }
        const monthlyVpf = Math.round(wageBase * pct / 100)
        if (active) await sb.from('vpf_declarations').update({ status: 'SUPERSEDED' }).eq('id', active.id)
        const { data: created, error } = await sb.from('vpf_declarations').insert({
          employee_id: emp.id, company_id: emp.company_id, fy: CURRENT_FY,
          vpf_percent: pct, epf_wage_limit: limit, epf_wage_base: wageBase,
          monthly_vpf_amount: monthlyVpf, annual_vpf_amount: monthlyVpf * 12,
          is_recurring: true, effective_from_fy: CURRENT_FY, effective_from_month: 1,
          status: 'ACTIVE', acknowledged: true, acknowledged_at: nowIso, created_by: actor,
        }).select('id').single()
        if (error || !created) { results.push({ emp_code: code, status: 'error', message: error?.message || 'insert failed' }); continue }
        await sb.from('vpf_audit_log').insert({ declaration_id: created.id, employee_id: emp.id, employee_code: emp.emp_code, company_id: emp.company_id, action: active ? 'MODIFIED' : 'DECLARED', old_value: active ? { vpf_percent: active.vpf_percent } : null, new_value: { vpf_percent: pct, base: wageBase, monthly_vpf: monthlyVpf }, monthly_vpf_amount: monthlyVpf, performed_by: actor, source: 'HR' })
        results.push({ emp_code: code, status: 'updated' })
      }

      else if (kind === 'nps') {
        const pran = digits(raw.pran_number)
        if (!pran) { results.push({ emp_code: code, status: 'skipped' }); continue }  // blank PRAN = no change (stopping is not a bulk action)
        if (pran.length !== 12) { results.push({ emp_code: code, status: 'error', message: 'PRAN must be 12 digits' }); continue }
        const tier = String(raw.tier_type || '').trim() === 'Tier II' ? 'Tier II' : 'Tier I'
        const ctc = ctcById.get(emp.id)
        const basicMonthly = Math.round((ctc?.basic_annual ?? 0) / 12)
        const regime = String(emp.tds_regime || 'NEW').toUpperCase() === 'OLD' ? 'OLD' : 'NEW'
        const percent = NPS_RATE[regime as 'OLD' | 'NEW']
        const monthlyNps = Math.round(basicMonthly * percent / 100)

        const { data: active } = await sb.from('nps_declarations').select('*').eq('employee_id', emp.id).in('status', ['ACTIVE', 'PENDING_PRAN']).maybeSingle()
        if (active && active.pran_number === pran && active.tier_type === tier && active.status === 'ACTIVE') { results.push({ emp_code: code, status: 'skipped' }); continue }
        if (active) await sb.from('nps_declarations').update({ status: 'SUPERSEDED' }).eq('id', active.id)
        const { data: created, error } = await sb.from('nps_declarations').insert({
          employee_id: emp.id, company_id: emp.company_id, fy: CURRENT_FY,
          has_existing_pran: true, pran_number: pran, pran_holder_name: emp.full_name, tier_type: tier,
          tax_regime: regime, contribution_percent: percent, basic_at_declaration: basicMonthly,
          monthly_nps_amount: monthlyNps, annual_nps_amount: monthlyNps * 12,
          effective_date: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toISOString().slice(0, 10),
          is_recurring: true, status: 'ACTIVE', acknowledged: true, acknowledged_at: nowIso, created_by: actor,
        }).select('id').single()
        if (error || !created) { results.push({ emp_code: code, status: 'error', message: error?.message || 'insert failed' }); continue }
        await sb.from('nps_audit_log').insert({ declaration_id: created.id, employee_id: emp.id, employee_code: emp.emp_code, company_id: emp.company_id, action: 'DECLARED', new_value: { pran_number: pran, tier, regime, percent, monthly_nps: monthlyNps, via: 'bulk' }, monthly_nps_amount: monthlyNps, performed_by: actor, source: 'HR' })
        results.push({ emp_code: code, status: 'updated' })
      }
    } catch (e: any) {
      results.push({ emp_code: code, status: 'error', message: e?.message || 'failed' })
    }
  }

  const updated = results.filter(r => r.status === 'updated').length
  const skipped = results.filter(r => r.status === 'skipped').length
  const errors = results.filter(r => r.status === 'error').length
  return NextResponse.json({ ok: true, summary: { updated, skipped, errors, total: results.length }, results })
}
