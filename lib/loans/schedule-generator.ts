// ============================================================
// EZER HRMS — Loan Reducing-Balance Schedule Generator
// Path: lib/loans/schedule-generator.ts
// Config (loan_type) drives: rate, interest_type, tenure
// Produces amortization with principal/interest split +
//   opening/closing balance (PayWorks style)
// ============================================================

export interface ScheduleRow {
  installment_number: number;
  fy: string;                 // '2026-27'
  month: number;              // 1=Apr .. 12=Mar
  due_date: string;           // YYYY-MM-DD
  opening_balance: number;
  emi_amount: number;
  principal_component: number;
  interest_component: number;
  closing_balance: number;
  status: 'PENDING';
}

export interface ScheduleInput {
  principal: number;
  annualRate: number;          // from loan_type.interest_rate
  interestType: 'REDUCING' | 'FLAT' | 'ZERO';
  tenureMonths: number;        // EMI count
  recoveryStartDate: string;   // YYYY-MM-DD (first EMI)
}

// FY (Apr-Mar) + payroll month (1=Apr) from a date
function fyMonth(date: Date): { fy: string; month: number } {
  const m = date.getMonth();                 // 0=Jan
  const y = date.getFullYear();
  const payrollMonth = m >= 3 ? m - 2 : m + 10;   // Apr=1..Mar=12
  const fyStart = m >= 3 ? y : y - 1;
  return { fy: `${fyStart}-${String((fyStart + 1) % 100).padStart(2, '0')}`, month: payrollMonth };
}

// EMI via reducing-balance (PMT)
export function calcEMI(principal: number, annualRate: number, months: number): number {
  if (annualRate === 0) return Math.round(principal / months);
  const r = annualRate / 12 / 100;
  return Math.round(principal * r * Math.pow(1 + r, months) / (Math.pow(1 + r, months) - 1));
}

// Full amortization schedule
export function generateSchedule(input: ScheduleInput): ScheduleRow[] {
  const { principal, annualRate, interestType, tenureMonths, recoveryStartDate } = input;
  const rows: ScheduleRow[] = [];
  let balance = principal;
  const monthlyRate = interestType === 'ZERO' ? 0 : annualRate / 12 / 100;

  // EMI
  let emi: number;
  if (interestType === 'REDUCING') emi = calcEMI(principal, annualRate, tenureMonths);
  else if (interestType === 'FLAT') {
    const totalInterest = principal * (annualRate / 100) * (tenureMonths / 12);
    emi = Math.round((principal + totalInterest) / tenureMonths);
  } else emi = Math.round(principal / tenureMonths);   // ZERO

  let due = new Date(recoveryStartDate);

  for (let i = 1; i <= tenureMonths; i++) {
    const opening = balance;
    let interestComp = 0, principalComp = 0;

    if (interestType === 'REDUCING') {
      interestComp = Math.round(balance * monthlyRate);
      principalComp = emi - interestComp;
    } else if (interestType === 'FLAT') {
      interestComp = Math.round(principal * (annualRate / 100) * (1 / 12));
      principalComp = emi - interestComp;
    } else {
      principalComp = emi;
    }

    // Last installment: adjust for rounding
    if (i === tenureMonths) { principalComp = opening; }
    balance = Math.max(0, opening - principalComp);

    const { fy, month } = fyMonth(due);
    rows.push({
      installment_number: i,
      fy, month,
      due_date: due.toISOString().split('T')[0],
      opening_balance: opening,
      emi_amount: (interestType === 'ZERO' ? principalComp : (i === tenureMonths ? principalComp + interestComp : emi)),
      principal_component: principalComp,
      interest_component: interestComp,
      closing_balance: balance,
      status: 'PENDING'
    });

    due = new Date(due.getFullYear(), due.getMonth() + 1, due.getDate());
  }

  return rows;
}

// Eligibility check (config-driven)
export function maxEligibleLoan(
  base: 'CTC' | 'GROSS',
  annualCtc: number,
  annualFixed: number,
  maxPercent: number
): number {
  const baseAmount = base === 'CTC' ? annualCtc : annualFixed;   // GROSS ~ annual fixed
  return Math.round(baseAmount * maxPercent / 100);
}

/*
  USAGE (when loan is created in Part 2):

  const loanType = await getLoanType(typeId);
  const maxLoan = maxEligibleLoan(loanType.eligibility_base, ctc.annual_ctc,
                                  ctc.annual_fixed, loanType.max_loan_percent);
  // validate request amount <= maxLoan, tenure in [min,max]

  const schedule = generateSchedule({
    principal: requestedAmount,
    annualRate: loanType.interest_rate,
    interestType: loanType.interest_type,
    tenureMonths: requestedTenure,
    recoveryStartDate: '2026-08-01'
  });
  // insert rows into loan_schedule
*/
