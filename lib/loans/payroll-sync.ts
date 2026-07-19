// ============================================================
// EZER HRMS — Loan -> Payroll Sync + Exit/FNF + Closure
// Inside /api/payroll/runs/[id]/calculate  (+ FNF trigger)
// ============================================================
import { alertLoanOnExit } from '@/lib/loans/notify';

// ------------------------------------------------------------
// 1. Load due EMIs for this run (fy+month, PENDING, loan RECOVERING)
// ------------------------------------------------------------
async function loadDueLoanEmis(supabase: any, companyId: string, fy: string, month: number) {
  const { data } = await supabase
    .from('loan_schedule')
    .select('*, loans!inner(id, employee_id, company_id, status, outstanding_principal, paid_installments, remaining_installments, tenure_months, recovery_end_date)')
    .eq('fy', fy).eq('month', month).eq('status', 'PENDING')
    .eq('loans.company_id', companyId)
    .eq('loans.status', 'RECOVERING');

  // Also load approved closure / extra-deduction requests for this month
  const { data: closures } = await supabase
    .from('loan_closure_requests')
    .select('*, loans!inner(company_id)')
    .eq('status', 'APPROVED')
    .eq('apply_in_fy', fy).eq('apply_in_month', month)
    .eq('loans.company_id', companyId);

  const emiByEmp: Record<string, any[]> = {};
  for (const row of data ?? []) {
    const empId = row.loans.employee_id;
    (emiByEmp[empId] ||= []).push(row);
  }
  return { emiByEmp, closures: closures ?? [] };
}

// ------------------------------------------------------------
// 2. Per employee — total loan deduction this month
// ------------------------------------------------------------
function computeEmployeeLoanEmi(scheduleRows: any[]): number {
  if (!scheduleRows?.length) return 0;
  return scheduleRows.reduce((s, r) => s + (r.emi_amount ?? 0), 0);
}

/*
  // ---- inside calculate engine ----
  const { emiByEmp, closures } = await loadDueLoanEmis(supabase, run.company_id, run.fy, run.month);

  // employee loop:
  const empEmis = emiByEmp[snap.employee_id] ?? [];
  let dedLoan = computeEmployeeLoanEmi(empEmis);

  // add approved extra-deduction / part-payment for this employee's loans
  const empClosures = closures.filter(c => empEmis.some(e => e.loan_id === c.loan_id) || c.employee_id === snap.employee_id);
  for (const c of empClosures) dedLoan += (c.amount ?? 0);

  const totalDeductions = dedEPF + dedVpf + dedNps + dedLoan + dedESIC + dedPT + dedLWF + dedTDS;

  lines.push({ ..., ded_loan_emi: dedLoan, ... });

  // ---- POST-approve, after run committed: mark schedule DEDUCTED + update loans ----
*/

// ------------------------------------------------------------
// 3. Post-run: mark schedule DEDUCTED + update loan outstanding
// (call after payroll approved/disbursed for the run)
// ------------------------------------------------------------
async function settleLoanSchedule(supabase: any, runId: string, fy: string, month: number) {
  const { data: rows } = await supabase
    .from('loan_schedule')
    .select('*, loans!inner(id, outstanding_principal, paid_installments, remaining_installments, tenure_months)')
    .eq('fy', fy).eq('month', month).eq('status', 'PENDING');

  for (const r of rows ?? []) {
    const loan = r.loans;
    await supabase.from('loan_schedule').update({
      status: 'DEDUCTED', recovered_amount: r.emi_amount,
      balance: r.closing_balance, deducted_in_run: runId,
      deducted_at: new Date().toISOString()
    }).eq('id', r.id);

    const paid = loan.paid_installments + 1;
    const remaining = loan.remaining_installments - 1;
    const newOutstanding = Math.max(0, loan.outstanding_principal - (r.principal_component ?? 0));
    const newStatus = remaining <= 0 ? 'CLOSED' : 'RECOVERING';

    await supabase.from('loans').update({
      paid_installments: paid, remaining_installments: remaining,
      outstanding_principal: newOutstanding, status: newStatus
    }).eq('id', loan.id);

    await supabase.from('loan_transactions').insert({
      loan_id: loan.id, txn_type: 'EMI', amount: r.emi_amount,
      payroll_run_id: runId, outstanding_after: newOutstanding,
      remarks: `EMI ${r.installment_number}`, source: 'PAYROLL'
    });
  }

  // Apply approved closures/part-payments
  const { data: closures } = await supabase
    .from('loan_closure_requests').select('*')
    .eq('status', 'APPROVED').eq('apply_in_fy', fy).eq('apply_in_month', month);

  for (const c of closures ?? []) {
    const { data: loan } = await supabase.from('loans').select('*').eq('id', c.loan_id).single();
    const newOutstanding = Math.max(0, loan.outstanding_principal - c.amount);
    const closed = c.request_type === 'CLOSURE' || newOutstanding <= 0;
    await supabase.from('loans').update({
      outstanding_principal: newOutstanding,
      status: closed ? (c.request_type === 'CLOSURE' ? 'FORECLOSED' : 'CLOSED') : 'RECOVERING'
    }).eq('id', c.loan_id);
    await supabase.from('loan_closure_requests').update({
      status: 'APPLIED', applied_at: new Date().toISOString()
    }).eq('id', c.id);
    await supabase.from('loan_transactions').insert({
      loan_id: c.loan_id,
      txn_type: c.request_type === 'CLOSURE' ? 'FORECLOSURE' : 'PART_PAYMENT',
      amount: c.amount, payroll_run_id: runId, outstanding_after: newOutstanding,
      remarks: `${c.request_type} applied`, source: 'ESS'
    });
    // If foreclosed early, mark remaining schedule WAIVED
    if (closed) {
      await supabase.from('loan_schedule').update({ status: 'WAIVED' })
        .eq('loan_id', c.loan_id).eq('status', 'PENDING');
    }
  }
}

// ------------------------------------------------------------
// 4. Exit / resignation -> alert + recover outstanding in FNF
// Call from employee exit handler (when exit_date is set)
// ------------------------------------------------------------
async function handleLoanOnExit(supabase: any, employeeId: string) {
  const { data: loans } = await supabase
    .from('loans').select('*')
    .eq('employee_id', employeeId)
    .in('status', ['RECOVERING', 'DISBURSED']);

  if (!loans?.length) return { hasLoan: false };

  const { data: emp } = await supabase
    .from('employees').select('id, emp_code, full_name').eq('id', employeeId).single();

  for (const loan of loans) {
    // Alert HR Manager + Payroll
    await alertLoanOnExit({ employee: emp, loan });

    // Mark for FNF recovery
    await supabase.from('loans').update({ status: 'EXIT_RECOVERY' }).eq('id', loan.id);
    await supabase.from('loan_transactions').insert({
      loan_id: loan.id, txn_type: 'FNF_RECOVERY', amount: loan.outstanding_principal,
      outstanding_after: 0, remarks: 'Flagged for FNF recovery on exit', source: 'FNF'
    });
    await supabase.from('loan_audit_log').insert({
      loan_id: loan.id, employee_id: employeeId, action: 'LOAN_FLAGGED_FNF',
      new_value: { outstanding: loan.outstanding_principal }, source: 'FNF'
    });
  }

  // FNF process will pick EXIT_RECOVERY loans and deduct outstanding from settlement
  return { hasLoan: true, loans: loans.length };
}

export { loadDueLoanEmis, computeEmployeeLoanEmi, settleLoanSchedule, handleLoanOnExit };
