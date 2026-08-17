// app/api/ess/nps/route.ts — Corporate NPS ESS API (GET / POST / PATCH)
// Employer % of Basic by regime (10% OLD / 14% NEW), 80CCD(2). Effective 1st of next month.
// Adapted to the real repo: emp_code (not employee_code), anon-key fallback, left-join
// ctc_master, regime from employees.tds_regime (no tds_declarations table), office_email.
import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { sendPranCreationEmail } from '@/lib/nps/pran-email'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!
)

const CURRENT_FY = '2026-27'
const PRAN_LENGTH = 12
const PRAN_DEADLINE_DAYS = 3
const RATE_OLD = 10
const RATE_NEW = 14

const firstOfNextMonth = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth() + 1, 1).toISOString().split('T')[0] }
const addDays = (days: number) => { const d = new Date(); d.setDate(d.getDate() + days); return d.toISOString().split('T')[0] }
const regimeOf = (emp: any) => (String(emp?.tds_regime || 'NEW').toUpperCase() === 'OLD' ? 'OLD' : 'NEW')

// Load employee + CTC row in TWO independent queries so a missing/empty ctc_master never 404s.
async function loadEmpCtc(employeeId: string): Promise<{ emp: any; ctc: any } | null> {
  const { data: emp, error } = await supabase.from('employees')
    .select('id, emp_code, full_name, personal_email, office_email, company_id, tds_regime')
    .eq('id', employeeId).single()
  if (error || !emp) return null
  let ctc: any = null
  try {
    const { data } = await supabase.from('ctc_master').select('basic_annual')
      .eq('employee_id', employeeId).order('created_at', { ascending: false }).limit(1).maybeSingle()
    ctc = data || null
  } catch { ctc = null }
  return { emp, ctc }
}

export async function GET(req: NextRequest) {
  const employeeId = req.nextUrl.searchParams.get('employee_id')
  if (!employeeId) return NextResponse.json({ error: 'employee_id required' }, { status: 400 })

  const r = await loadEmpCtc(employeeId)
  if (!r) return NextResponse.json({ error: 'Employee not found' }, { status: 404 })
  const { emp, ctc } = r
  const basicMonthly = Math.round((ctc?.basic_annual ?? 0) / 12)
  const regime = regimeOf(emp)
  const percent = regime === 'OLD' ? RATE_OLD : RATE_NEW
  const monthlyNps = Math.round(basicMonthly * percent / 100)

  const { data: current } = await supabase.from('nps_declarations').select('*')
    .eq('employee_id', employeeId).in('status', ['ACTIVE', 'PENDING_PRAN']).maybeSingle()

  return NextResponse.json({
    employee: {
      id: emp.id, code: (emp as any).emp_code, name: emp.full_name,
      has_ctc: !!ctc,
      basic_monthly: basicMonthly, tax_regime: regime, contribution_percent: percent,
      monthly_nps_amount: monthlyNps, annual_nps_amount: monthlyNps * 12,
      effective_date: firstOfNextMonth(), pran_length: PRAN_LENGTH,
    },
    current_nps: current ?? null,
  })
}

export async function POST(req: NextRequest) {
  // `source` lets Payroll → Statutory & Tax → NPS enrol on an employee's behalf through
  // this same route. Sharing it is the point: two enrolment paths that each did their own
  // arithmetic would eventually disagree about the same person's contribution.
  const { employee_id, has_existing_pran, pran_number, pran_holder_name, tier_type, acknowledged,
          source, performed_by_name } = await req.json()
  const src = String(source || '').toUpperCase() === 'HR' ? 'HR' : 'ESS'
  if (!acknowledged) return NextResponse.json({ error: 'Acknowledgement required' }, { status: 400 })

  if (has_existing_pran) {
    const clean = String(pran_number ?? '').replace(/\D/g, '')
    if (clean.length !== PRAN_LENGTH) return NextResponse.json({ error: `PRAN must be ${PRAN_LENGTH} digits` }, { status: 400 })
  }

  const r = await loadEmpCtc(employee_id)
  if (!r) return NextResponse.json({ error: 'Employee not found' }, { status: 404 })
  const { emp, ctc } = r
  const basicMonthly = Math.round((ctc?.basic_annual ?? 0) / 12)
  const regime = regimeOf(emp)
  const percent = regime === 'OLD' ? RATE_OLD : RATE_NEW
  const monthlyNps = Math.round(basicMonthly * percent / 100)
  const effectiveDate = firstOfNextMonth()

  const { data: existing } = await supabase.from('nps_declarations').select('*')
    .eq('employee_id', employee_id).in('status', ['ACTIVE', 'PENDING_PRAN']).maybeSingle()
  if (existing) await supabase.from('nps_declarations').update({ status: 'SUPERSEDED' }).eq('id', existing.id)

  const isPending = !has_existing_pran
  const deadline = isPending ? addDays(PRAN_DEADLINE_DAYS) : null

  const { data: created, error: insErr } = await supabase.from('nps_declarations').insert({
    employee_id, company_id: (emp as any).company_id, fy: CURRENT_FY,
    has_existing_pran,
    pran_number: has_existing_pran ? String(pran_number).replace(/\D/g, '') : null,
    pran_holder_name: pran_holder_name ?? emp.full_name, tier_type: tier_type ?? 'Tier I',
    tax_regime: regime, contribution_percent: percent, basic_at_declaration: basicMonthly,
    monthly_nps_amount: monthlyNps, annual_nps_amount: monthlyNps * 12,
    effective_date: effectiveDate, is_recurring: true,
    status: isPending ? 'PENDING_PRAN' : 'ACTIVE',
    pran_deadline: deadline, pran_email_sent_at: isPending ? new Date().toISOString() : null,
    acknowledged: true, acknowledged_at: new Date().toISOString(), created_by: employee_id,
  }).select().single()
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 400 })

  await supabase.from('nps_audit_log').insert({
    declaration_id: created.id, employee_id, employee_code: (emp as any).emp_code, company_id: (emp as any).company_id,
    action: 'DECLARED',
    new_value: { has_existing_pran, regime, percent, monthly_nps: monthlyNps, status: created.status,
                 ...(src === 'HR' ? { enrolled_by: performed_by_name || 'HR' } : {}) },
    monthly_nps_amount: monthlyNps, performed_by: employee_id, source: src,
  })

  if (isPending) {
    const to = (emp as any).office_email || (emp as any).personal_email
    try { if (to) await sendPranCreationEmail({ to, employeeName: emp.full_name, deadline: deadline! }) } catch { /* email best-effort */ }
    await supabase.from('nps_audit_log').insert({
      declaration_id: created.id, employee_id, employee_code: (emp as any).emp_code,
      action: 'PRAN_EMAIL_SENT', new_value: { deadline }, source: src,
    })
  }
  return NextResponse.json({ success: true, declaration: created, pending_pran: isPending, deadline })
}

export async function PATCH(req: NextRequest) {
  const { employee_id, action, pran_number, stopped_reason, source: pSource, performed_by_name } = await req.json()
  const pSrc = String(pSource || '').toUpperCase() === 'HR' ? 'HR' : 'ESS'
  const { data: rec } = await supabase.from('nps_declarations').select('*')
    .eq('employee_id', employee_id).in('status', ['ACTIVE', 'PENDING_PRAN']).maybeSingle()
  if (!rec) return NextResponse.json({ error: 'No NPS declaration found' }, { status: 404 })

  if (action === 'SUBMIT_PRAN') {
    const clean = String(pran_number ?? '').replace(/\D/g, '')
    if (clean.length !== PRAN_LENGTH) return NextResponse.json({ error: `PRAN must be ${PRAN_LENGTH} digits` }, { status: 400 })
    await supabase.from('nps_declarations').update({
      pran_number: clean, has_existing_pran: true, status: 'ACTIVE', pran_generated_at: new Date().toISOString(),
    }).eq('id', rec.id)
    await supabase.from('nps_audit_log').insert({ declaration_id: rec.id, employee_id, action: 'PRAN_SUBMITTED', new_value: { pran_number: clean }, source: pSrc })
    return NextResponse.json({ success: true, status: 'ACTIVE' })
  }
  if (action === 'STOP') {
    // A reason is required when Payroll stops it on somebody's behalf. Their pay goes up
    // and their retirement contribution goes away — six months later, 'why' is the only
    // question anyone asks, and 'the system did it' is not an answer.
    const reason = String(stopped_reason || '').trim()
    if (pSrc === 'HR' && !reason) return NextResponse.json({ error: 'A reason is required to stop NPS on an employee\'s behalf.' }, { status: 400 })
    await supabase.from('nps_declarations').update({ status: 'STOPPED', stopped_at: new Date().toISOString(), stopped_reason: reason || stopped_reason }).eq('id', rec.id)
    await supabase.from('nps_audit_log').insert({
      declaration_id: rec.id, employee_id, action: 'STOPPED',
      old_value: { monthly_nps: rec.monthly_nps_amount, status: rec.status },
      new_value: { reason, ...(pSrc === 'HR' ? { stopped_by: performed_by_name || 'HR' } : {}) },
      source: pSrc,
    })
    return NextResponse.json({ success: true, status: 'STOPPED' })
  }
  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}
