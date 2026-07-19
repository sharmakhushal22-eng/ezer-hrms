// ============================================================
// EZER HRMS — Loan Admin/Finance API
// Path: app/api/loans/admin/route.ts
// Approval chain, finance disburse, closure approval
// ============================================================
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
export const runtime = 'nodejs';
import { generateSchedule } from '@/lib/loans/schedule-generator';
import { notifyFinance } from '@/lib/loans/notify';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!
);

// ============================================================
// POST — approve / reject an approval level
// Body: { request_id, approver_id, approver_role, action: 'APPROVED'|'REJECTED', remarks }
// ============================================================
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { request_id, approver_id, approver_role, action, remarks } = body;

  const { data: request } = await supabase
    .from('loan_requests').select('*').eq('id', request_id).single();
  if (!request) return NextResponse.json({ error: 'Request not found' }, { status: 404 });

  // Current pending level for this role
  const { data: level } = await supabase
    .from('loan_approvals').select('*')
    .eq('request_id', request_id)
    .eq('level_order', request.current_approval_level)
    .single();

  if (!level || level.approver_role !== approver_role) {
    return NextResponse.json({ error: 'Not authorized for this level' }, { status: 403 });
  }

  await supabase.from('loan_approvals').update({
    approver_id, action, remarks, acted_at: new Date().toISOString()
  }).eq('id', level.id);

  if (action === 'REJECTED') {
    await supabase.from('loan_requests').update({ status: 'REJECTED' }).eq('id', request_id);
    await supabase.from('loan_audit_log').insert({
      request_id, employee_id: request.employee_id, action: 'LOAN_REJECTED',
      new_value: { level: level.level_order, role: approver_role, remarks },
      performed_by: approver_id, source: 'ADMIN'
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
    return NextResponse.json({ success: true, status: 'IN_APPROVAL', next_level: nextLevel.level_order });
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
    new_value: { agreement_number: agreementNumber }, performed_by: approver_id, source: 'ADMIN'
  });

  return NextResponse.json({ success: true, status: 'APPROVED', agreement });
}

// ============================================================
// PUT — finance disburse (after agreement signed + reviewed)
// Body: { agreement_id, disbursed_by, utr_number, sanction_date, disbursement_date }
// ============================================================
export async function PUT(req: NextRequest) {
  const body = await req.json();
  const { agreement_id, disbursed_by, utr_number, sanction_date, disbursement_date } = body;

  const { data: agr } = await supabase
    .from('loan_agreements').select('*').eq('id', agreement_id).single();
  if (!agr) return NextResponse.json({ error: 'Agreement not found' }, { status: 404 });
  if (agr.status !== 'APPROVED') {
    return NextResponse.json({ error: 'Agreement not approved/signed yet' }, { status: 400 });
  }

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
