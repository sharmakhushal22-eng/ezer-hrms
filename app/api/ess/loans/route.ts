// app/api/ess/loans/route.ts — Loan ESS API (eligibility, request, my-loans, closure/part-payment).
// Adapted: emp_code, anon-key fallback, ctc_master via separate query (no !inner 404).
import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { calcEMI, maxEligibleLoan } from '@/lib/loans/schedule-generator'

export const runtime = 'nodejs'
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!
)
const CURRENT_FY = '2026-27'

async function empWithCtc(employeeId: string) {
  const { data: emp } = await supabase.from('employees').select('id, emp_code, company_id').eq('id', employeeId).single()
  if (!emp) return null
  const { data: ctc } = await supabase.from('ctc_master').select('annual_ctc, annual_variable').eq('employee_id', employeeId).order('created_at', { ascending: false }).limit(1).maybeSingle()
  return { emp, annualCtc: Number(ctc?.annual_ctc || 0), annualFixed: Number(ctc?.annual_ctc || 0) - Number(ctc?.annual_variable || 0) }
}

// GET ?employee_id=xxx → loan types + eligibility + my loans + pending requests
export async function GET(req: NextRequest) {
  const employeeId = req.nextUrl.searchParams.get('employee_id')
  if (!employeeId) return NextResponse.json({ error: 'employee_id required' }, { status: 400 })
  const ctx = await empWithCtc(employeeId)
  if (!ctx) return NextResponse.json({ error: 'Employee not found' }, { status: 404 })

  const { data: types } = await supabase.from('loan_types').select('*').eq('company_id', ctx.emp.company_id).eq('is_active', true)
  const typesWithElig = (types ?? []).map(t => ({ ...t, max_eligible: maxEligibleLoan(t.eligibility_base, ctx.annualCtc, ctx.annualFixed, t.max_loan_percent) }))
  const { data: loans } = await supabase.from('loans').select('*').eq('employee_id', employeeId).order('created_at', { ascending: false })
  const { data: requests } = await supabase.from('loan_requests').select('*').eq('employee_id', employeeId).in('status', ['SUBMITTED', 'IN_APPROVAL', 'APPROVED']).order('created_at', { ascending: false })

  return NextResponse.json({ loan_types: typesWithElig, my_loans: loans ?? [], pending_requests: requests ?? [], has_ctc: ctx.annualCtc > 0 })
}

// POST — submit loan request
export async function POST(req: NextRequest) {
  const { employee_id, loan_type_id, requested_amount, requested_tenure_months, reason } = await req.json()
  const ctx = await empWithCtc(employee_id)
  if (!ctx) return NextResponse.json({ error: 'Employee not found' }, { status: 404 })
  const { data: lt } = await supabase.from('loan_types').select('*').eq('id', loan_type_id).single()
  if (!lt) return NextResponse.json({ error: 'Loan type not found' }, { status: 404 })

  const maxLoan = maxEligibleLoan(lt.eligibility_base, ctx.annualCtc, ctx.annualFixed, lt.max_loan_percent)
  if (Number(requested_amount) > maxLoan) return NextResponse.json({ error: `Max eligible is ₹${maxLoan.toLocaleString('en-IN')}` }, { status: 400 })
  if (requested_tenure_months < lt.min_tenure_months || requested_tenure_months > lt.max_tenure_months) return NextResponse.json({ error: `Tenure must be ${lt.min_tenure_months}-${lt.max_tenure_months} months` }, { status: 400 })

  const emi = calcEMI(Number(requested_amount), lt.interest_type === 'ZERO' ? 0 : lt.interest_rate, requested_tenure_months)
  const { data: request, error: reqErr } = await supabase.from('loan_requests').insert({
    employee_id, company_id: ctx.emp.company_id, fy: CURRENT_FY, loan_type_id,
    requested_amount, requested_tenure_months, eligibility_max: maxLoan, indicative_emi: emi, reason,
    status: 'IN_APPROVAL', current_approval_level: 1, created_by: employee_id,
  }).select().single()
  if (reqErr) return NextResponse.json({ error: reqErr.message }, { status: 400 })

  const { data: levels } = await supabase.from('loan_approval_levels').select('*')
    .eq('company_id', ctx.emp.company_id).eq('is_active', true)
    .or(`loan_type_id.eq.${loan_type_id},loan_type_id.is.null`).order('level_order')
  const approvals = (levels ?? []).map(l => ({ request_id: request.id, company_id: ctx.emp.company_id, level_order: l.level_order, approver_role: l.approver_role, action: 'PENDING' }))
  if (approvals.length) await supabase.from('loan_approvals').insert(approvals)

  await supabase.from('loan_audit_log').insert({ request_id: request.id, employee_id, company_id: ctx.emp.company_id, action: 'LOAN_REQUESTED', new_value: { loan_type: lt.code, amount: requested_amount, tenure: requested_tenure_months }, performed_by: employee_id, source: 'ESS' })
  return NextResponse.json({ success: true, request, emi, approval_levels: approvals.length })
}

// PATCH — closure / part-payment / extra-deduction request
export async function PATCH(req: NextRequest) {
  const { loan_id, employee_id, request_type, amount, apply_in_month } = await req.json()
  const { data: loan } = await supabase.from('loans').select('*').eq('id', loan_id).single()
  if (!loan) return NextResponse.json({ error: 'Loan not found' }, { status: 404 })
  const { data: cr, error } = await supabase.from('loan_closure_requests').insert({
    loan_id, employee_id, request_type,
    amount: request_type === 'CLOSURE' ? loan.outstanding_principal : amount,
    outstanding_at_request: loan.outstanding_principal, status: 'REQUESTED',
    apply_in_fy: CURRENT_FY, apply_in_month,
  }).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  await supabase.from('loan_audit_log').insert({ loan_id, employee_id, action: `${request_type}_REQUESTED`, new_value: { amount: cr.amount }, performed_by: employee_id, source: 'ESS' })
  return NextResponse.json({ success: true, closure_request: cr })
}
