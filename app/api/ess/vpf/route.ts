// app/api/ess/vpf/route.ts — VPF ESS API (GET / POST / PATCH)
// VPF = EPF wage base × percent. base = min(monthly_gross − monthly_hra, epf_wage_limit).
// Adapted to the real repo: emp_code (not employee_code), anon-key fallback (no service role),
// left-join ctc_master (no !inner) so employees without a CTC row don't 404.
import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!
)

const CURRENT_FY = '2026-27'
const MAX_PCT = 88          // 12% mandatory + 88% = 100% of PF wage
const EPF_CEILING = 15000

function epfWageBase(monthlyGross: number, monthlyHra: number, limit: number): number {
  const actual = Math.max(0, monthlyGross - monthlyHra)
  return Math.round(Math.min(actual, limit))
}
// Load employee + its CTC row in TWO independent queries so a missing/empty
// ctc_master (or an unresolved embed) never 404s the whole request.
async function loadEmpCtc(employeeId: string): Promise<{ emp: any; ctc: any } | null> {
  const { data: emp, error } = await supabase
    .from('employees').select('id, emp_code, full_name, company_id').eq('id', employeeId).single()
  if (error || !emp) return null
  let ctc: any = null
  try {
    const { data } = await supabase.from('ctc_master')
      .select('annual_ctc, annual_variable, basic_annual, hra_annual, epf_wage_limit')
      .eq('employee_id', employeeId).order('created_at', { ascending: false }).limit(1).maybeSingle()
    ctc = data || null
  } catch { ctc = null }
  return { emp, ctc }
}

// GET ?employee_id=xxx → EPF wage base + current active VPF
export async function GET(req: NextRequest) {
  const employeeId = req.nextUrl.searchParams.get('employee_id')
  if (!employeeId) return NextResponse.json({ error: 'employee_id required' }, { status: 400 })

  const r = await loadEmpCtc(employeeId)
  if (!r) return NextResponse.json({ error: 'Employee not found' }, { status: 404 })
  const { emp, ctc } = r
  const hasCtc = !!ctc
  const annualFixed = (ctc?.annual_ctc ?? 0) - (ctc?.annual_variable ?? 0)
  const monthlyGross = Math.round(annualFixed / 12)
  const monthlyHra = Math.round((ctc?.hra_annual ?? 0) / 12)
  const limit = ctc?.epf_wage_limit ?? EPF_CEILING
  const wageBase = epfWageBase(monthlyGross, monthlyHra, limit)
  const mandatoryEpfMonthly = Math.round(wageBase * 0.12)

  const { data: current } = await supabase.from('vpf_declarations')
    .select('*').eq('employee_id', employeeId).eq('status', 'ACTIVE').maybeSingle()

  return NextResponse.json({
    employee: {
      id: emp.id, code: (emp as any).emp_code, name: emp.full_name,
      has_ctc: hasCtc,
      epf_wage_limit: limit,
      is_capped: limit <= EPF_CEILING,
      epf_wage_base: wageBase,
      mandatory_epf_monthly: mandatoryEpfMonthly,
      epf_annual: mandatoryEpfMonthly * 12,
      c80_limit: 150000,
    },
    current_vpf: current ?? null,
  })
}

// POST — declare / modify (percent only)
export async function POST(req: NextRequest) {
  const { employee_id, vpf_percent, effective_from_month, acknowledged } = await req.json()
  if (!acknowledged) return NextResponse.json({ error: 'Acknowledgement required' }, { status: 400 })

  const r = await loadEmpCtc(employee_id)
  if (!r) return NextResponse.json({ error: 'Employee not found' }, { status: 404 })
  const { emp, ctc } = r
  const annualFixed = (ctc?.annual_ctc ?? 0) - (ctc?.annual_variable ?? 0)
  const monthlyGross = Math.round(annualFixed / 12)
  const monthlyHra = Math.round((ctc?.hra_annual ?? 0) / 12)
  const limit = ctc?.epf_wage_limit ?? EPF_CEILING
  const wageBase = epfWageBase(monthlyGross, monthlyHra, limit)

  let safePercent = parseFloat(vpf_percent)
  if (!safePercent || safePercent < 1) return NextResponse.json({ error: 'Percent must be at least 1' }, { status: 400 })
  if (safePercent > MAX_PCT) safePercent = MAX_PCT   // silently cap to 88

  const monthlyVpf = Math.round(wageBase * safePercent / 100)
  const annualVpf = monthlyVpf * 12

  const { data: existing } = await supabase.from('vpf_declarations')
    .select('*').eq('employee_id', employee_id).eq('status', 'ACTIVE').maybeSingle()
  if (existing) await supabase.from('vpf_declarations').update({ status: 'SUPERSEDED' }).eq('id', existing.id)

  const { data: created, error: insErr } = await supabase.from('vpf_declarations').insert({
    employee_id, company_id: (emp as any).company_id, fy: CURRENT_FY,
    vpf_percent: safePercent, epf_wage_limit: limit, epf_wage_base: wageBase,
    monthly_vpf_amount: monthlyVpf, annual_vpf_amount: annualVpf,
    is_recurring: true, effective_from_fy: CURRENT_FY, effective_from_month: effective_from_month || 1,
    status: 'ACTIVE', acknowledged: true, acknowledged_at: new Date().toISOString(), created_by: employee_id,
  }).select().single()
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 400 })

  await supabase.from('vpf_audit_log').insert({
    declaration_id: created.id, employee_id, employee_code: (emp as any).emp_code, company_id: (emp as any).company_id,
    action: existing ? 'MODIFIED' : 'DECLARED',
    old_value: existing ? { vpf_percent: existing.vpf_percent, base: existing.epf_wage_base, monthly_vpf: existing.monthly_vpf_amount } : null,
    new_value: { vpf_percent: safePercent, base: wageBase, monthly_vpf: monthlyVpf },
    monthly_vpf_amount: monthlyVpf, performed_by: employee_id, source: 'ESS',
  })
  return NextResponse.json({ success: true, declaration: created })
}

// PATCH — stop VPF
export async function PATCH(req: NextRequest) {
  const { employee_id, stopped_reason, stopped_from_month } = await req.json()
  const { data: active } = await supabase.from('vpf_declarations')
    .select('*').eq('employee_id', employee_id).eq('status', 'ACTIVE').maybeSingle()
  if (!active) return NextResponse.json({ error: 'No active VPF found' }, { status: 404 })

  await supabase.from('vpf_declarations').update({
    status: 'STOPPED', stopped_at: new Date().toISOString(), stopped_reason, stopped_from_month,
  }).eq('id', active.id)

  await supabase.from('vpf_audit_log').insert({
    declaration_id: active.id, employee_id, action: 'STOPPED',
    old_value: { vpf_percent: active.vpf_percent, monthly_vpf: active.monthly_vpf_amount },
    monthly_vpf_amount: 0, performed_by: employee_id, source: 'ESS',
  })
  return NextResponse.json({ success: true })
}
