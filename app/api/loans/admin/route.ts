// ============================================================
// EZER HRMS — Loan Admin/Finance API
// Path: app/api/loans/admin/route.ts
// Approval chain, finance disburse, closure approval
//
// Who may act is decided here, from the session — not from approver_id /
// approver_role / disbursed_by in the body. This route used to have no
// authentication at all: any request could walk a loan through every level
// and "disburse" it, which put EMI deductions on a real employee's payroll.
// ============================================================
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
export const runtime = 'nodejs';
import { generateSchedule } from '@/lib/loans/schedule-generator';
import { notifyFinance } from '@/lib/loans/notify';
import { requireAccess, requireGrant, requireCompany, holds, refuse } from '@/lib/rms/authz';
import type { Grant } from '@/lib/rms/resolve';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!
);

/** The role codes (ess_roles.role_code) that stand for each approval level's
 *  approver_role (loan_approval_levels, migration 045). REPORTING_MANAGER is not a role
 *  but a relationship — the employee's own L1 manager — and is checked separately. */
const LEVEL_ROLES: Record<string, string[]> = {
  PAYROLL_MANAGER: ['PAYROLL', 'PAYROLL_ADMIN'],
  HR_MANAGER: ['HR_MANAGER', 'HR_HEAD', 'CHRO'],
  HR_HEAD: ['HR_HEAD', 'CHRO'],
  FINANCE: ['FINANCE_EXECUTIVE', 'CFO'],
};

async function mayApproveLevel(g: Grant, approverRole: string, employeeId: string): Promise<boolean> {
  if (g.isSuperAdmin || g.legacy) return true;
  if (approverRole === 'REPORTING_MANAGER') {
    if (!g.employeeId) return false;
    const { data: emp } = await supabase.from('employees').select('l1_manager_id').eq('id', employeeId).maybeSingle();
    return emp?.l1_manager_id === g.employeeId;
  }
  const codes = LEVEL_ROLES[approverRole] ?? [];
  return g.roles.some(r => codes.includes(r.role_code));
}

// ============================================================
// POST — approve / reject an approval level
// Body: { request_id, action: 'APPROVED'|'REJECTED', remarks }
// ============================================================
export async function POST(req: NextRequest) {
  // Approving or rejecting a loan is authorised by the APPROVAL CHAIN, not by the generic Loans
  // module: loan_approval_levels names the role for each level (Payroll Manager → HR Manager /
  // HR Head), and mayApproveLevel below is what enforces it. Gating on Loans-EDIT as well was a
  // bug — an HR Head is the designated approver for the HR_HEAD level but the HR roles carry only
  // Loans VIEW/NONE in RBAC, so the real approver was refused before the chain check ever ran.
  // Here we only require a signed-in user in the request's company; the level role does the rest.
  const gate = await requireGrant(req);
  if (gate.error) return gate.error;
  const g = gate.grant;

  const body = await req.json();
  const { request_id, action, remarks } = body;
  if (!request_id || (action !== 'APPROVED' && action !== 'REJECTED')) {
    return refuse(400, 'request_id and action (APPROVED | REJECTED) are required');
  }

  const { data: request } = await supabase
    .from('loan_requests').select('*').eq('id', request_id).single();
  if (!request) return NextResponse.json({ error: 'Request not found' }, { status: 404 });
  const scope = requireCompany(g, request.company_id);   // general company scope, not module-bound
  if (scope) return scope;

  // Current pending level for this request
  const { data: level } = await supabase
    .from('loan_approvals').select('*')
    .eq('request_id', request_id)
    .eq('level_order', request.current_approval_level)
    .single();

  if (!level || level.action !== 'PENDING') {
    return NextResponse.json({ error: 'No approval is pending on this request' }, { status: 409 });
  }
  if (!(await mayApproveLevel(g, level.approver_role, request.employee_id))) {
    return refuse(403, `This level is approved by the ${String(level.approver_role).replace(/_/g, ' ').toLowerCase()}.`);
  }
  // The approver is whoever is signed in. The legacy login has no employee row and is
  // recorded by its label instead.
  const approver_id = g.employeeId ?? null;
  const approver_label = g.employeeId ?? g.name ?? 'Admin';

  await supabase.from('loan_approvals').update({
    approver_id, action, remarks, acted_at: new Date().toISOString()
  }).eq('id', level.id);

  if (action === 'REJECTED') {
    await supabase.from('loan_requests').update({ status: 'REJECTED' }).eq('id', request_id);
    await supabase.from('loan_audit_log').insert({
      request_id, employee_id: request.employee_id, action: 'LOAN_REJECTED',
      new_value: { level: level.level_order, role: level.approver_role, remarks },
      performed_by: approver_label, source: 'ADMIN'
    });
    return NextResponse.json({ success: true, status: 'REJECTED' });
  }

  // Approved — check for next level
  const { data: allLevels } = await supabase
    .from('loan_approvals').select('*').eq('request_id', request_id).order('level_order');
  const nextLevel = (allLevels ?? []).find(l => l.level_order > level.level_order);

  if (nextLevel) {
    await supabase.from('loan_requests')
      .update({ current_approval_level: nextLevel.level_order }).eq('id', request_id);
    return NextResponse.json({ success: true, status: 'IN_APPROVAL', next_level: nextLevel.level_order, next_level_role: nextLevel.approver_role });
  }

  // All approved -> notify finance + generate agreement
  await supabase.from('loan_requests').update({ status: 'APPROVED' }).eq('id', request_id);

  const { data: lt } = await supabase.from('loan_types').select('*').eq('id', request.loan_type_id).single();
  const schedule = generateSchedule({
    principal: request.requested_amount,
    annualRate: lt.interest_type === 'ZERO' ? 0 : lt.interest_rate,
    interestType: lt.interest_type,
    tenureMonths: request.requested_tenure_months,
    recoveryStartDate: firstOfNextMonth()
  });

  const agreementNumber = `AGR-${Date.now().toString().slice(-8)}`;
  const { data: agreement } = await supabase.from('loan_agreements').insert({
    request_id, employee_id: request.employee_id, company_id: request.company_id,
    agreement_number: agreementNumber,
    schedule_snapshot: schedule, terms_version: 'v1',
    status: 'GENERATED'
  }).select().single();

  if (lt.notify_finance) await notifyFinance({ request, agreement });

  await supabase.from('loan_audit_log').insert({
    request_id, employee_id: request.employee_id, action: 'LOAN_APPROVED_AGREEMENT_GENERATED',
    new_value: { agreement_number: agreementNumber }, performed_by: approver_label, source: 'ADMIN'
  });

  return NextResponse.json({ success: true, status: 'APPROVED', agreement });
}

// ============================================================
// PUT — finance disburse (after agreement signed + reviewed)
// Body: { agreement_id, utr_number, sanction_date, disbursement_date }
// ============================================================
export async function PUT(req: NextRequest) {
  // Paying money out is Finance's job (or Loans FULL for the one-desk company).
  const gate = await requireAccess(req, ['Finance', 'Loans'], 'EDIT');
  if (gate.error) return gate.error;
  const g = gate.grant;
  if (!holds(g, 'Finance', 'EDIT') && !holds(g, 'Loans', 'FULL')) {
    return refuse(403, 'Disbursing a loan needs Finance access.');
  }

  const body = await req.json();
  const { agreement_id, utr_number, sanction_date, disbursement_date } = body;
  if (!agreement_id || !String(utr_number || '').trim()) return refuse(400, 'agreement_id and utr_number are required');

  const { data: agr } = await supabase
    .from('loan_agreements').select('*').eq('id', agreement_id).single();
  if (!agr) return NextResponse.json({ error: 'Agreement not found' }, { status: 404 });
  const scope = requireCompany(g, agr.company_id, 'Loans');
  if (scope) return scope;
  if (agr.status !== 'APPROVED') {
    return NextResponse.json({ error: 'Agreement not approved/signed yet' }, { status: 400 });
  }
  if (agr.loan_id) return NextResponse.json({ error: 'This agreement has already been disbursed' }, { status: 409 });

  const disbursed_by = g.employeeId ?? g.name ?? 'Finance';

  const { data: request } = await supabase
    .from('loan_requests').select('*').eq('id', agr.request_id).single();
  const { data: lt } = await supabase.from('loan_types').select('*').eq('id', request.loan_type_id).single();

  const schedule = agr.schedule_snapshot as any[];
  const emi = schedule[0]?.emi_amount ?? 0;
  const totalInterest = schedule.reduce((s, r) => s + (r.interest_component ?? 0), 0);
  const first = schedule[0];
  const last = schedule[schedule.length - 1];

  // Create loan
  const loanNumber = `LN-${Date.now().toString().slice(-8)}`;
  const { data: loan } = await supabase.from('loans').insert({
    loan_number: loanNumber,
    request_id: request.id, agreement_id, employee_id: request.employee_id,
    company_id: request.company_id, loan_type_id: request.loan_type_id,
    principal: request.requested_amount,
    interest_rate: lt.interest_rate, interest_type: lt.interest_type,
    tenure_months: request.requested_tenure_months, emi_amount: emi,
    total_interest: totalInterest, total_payable: request.requested_amount + totalInterest,
    sanction_date, disbursement_date,
    recovery_start_date: first?.due_date, recovery_end_date: last?.due_date,
    first_emi_fy: first?.fy, first_emi_month: first?.month,
    outstanding_principal: request.requested_amount,
    paid_installments: 0, remaining_installments: request.requested_tenure_months,
    status: 'RECOVERING', disbursed_by, utr_number
  }).select().single();

  // Insert schedule rows
  const rows = schedule.map(r => ({
    loan_id: loan.id, installment_number: r.installment_number,
    fy: r.fy, month: r.month, due_date: r.due_date,
    opening_balance: r.opening_balance, emi_amount: r.emi_amount,
    principal_component: r.principal_component, interest_component: r.interest_component,
    closing_balance: r.closing_balance, status: 'PENDING',
    recovered_amount: 0, balance: r.closing_balance
  }));
  await supabase.from('loan_schedule').insert(rows);

  // Link agreement -> loan
  await supabase.from('loan_agreements').update({ loan_id: loan.id }).eq('id', agreement_id);

  await supabase.from('loan_transactions').insert({
    loan_id: loan.id, txn_type: 'EMI', amount: 0,
    outstanding_after: request.requested_amount,
    remarks: 'Loan disbursed', performed_by: disbursed_by, source: 'FINANCE'
  });
  await supabase.from('loan_audit_log').insert({
    loan_id: loan.id, request_id: request.id, employee_id: request.employee_id,
    action: 'LOAN_DISBURSED', new_value: { loan_number: loanNumber, utr: utr_number },
    performed_by: disbursed_by, source: 'FINANCE'
  });

  return NextResponse.json({ success: true, loan });
}

function firstOfNextMonth(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 1).toISOString().split('T')[0];
}
