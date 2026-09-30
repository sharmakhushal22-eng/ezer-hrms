// lib/recruitment/compensation.ts
//
// How an engagement is paid, and on what basis. Trainees draw a stipend;
// contractors and consultants are paid fees. The three are quoted on different
// bases, so a form must not label them all "Salary". `fixedTerm` marks
// engagements that run for a defined period and therefore need a duration — an
// internship without one is not a real requisition.
//
// WHY THIS IS SHARED RATHER THAN PAGE-LOCAL
//
// `period` is the only thing that makes a budget figure comparable to a CTC.
// budget_min/budget_max are quoted in the engagement's own period, while an
// offer's `offered_ctc` is always annual — so comparing them without
// normalising flags every monthly-paid requisition as over-budget. The MRF form
// already normalises (`annualMax = period === 'ANNUAL' ? bMax : bMax * 12`)
// before testing QUICK_HIRE_CAP, and the HR Head's over-ceiling tile has to
// apply exactly the same rule or it paints a false red on the screen where
// someone signs off real money.
//
// It lives here, rather than being exported from the recruitment page, because
// app/dashboard/recruitment/page.tsx already imports ./offer-flow-components,
// and components/ess/RecruitmentModule.tsx imports the page. Exporting these
// back out of the page would close an import cycle that ESS also sits on, and
// `compOf` is a const binding: in a cycle it can read as `undefined` during
// module init, with no error — on the one calculation that must not be wrong.

export interface Compensation {
  kind: 'SALARY' | 'STIPEND' | 'FEES';
  label: string;
  period: 'ANNUAL' | 'MONTHLY';
  fixedTerm: boolean;
  /** Placeholder min/max for the budget inputs, in the engagement's own period. */
  ph: [string, string];
}

export const COMPENSATION: Record<string, Compensation> = {
  'Employee':     { kind:'SALARY',  label:'Salary',  period:'ANNUAL',  fixedTerm:false, ph:['600000','1200000'] },
  'Intern':       { kind:'STIPEND', label:'Stipend', period:'MONTHLY', fixedTerm:true,  ph:['10000','25000'] },
  'NAPS':         { kind:'STIPEND', label:'Stipend', period:'MONTHLY', fixedTerm:true,  ph:['9000','15000'] },
  'NATS':         { kind:'STIPEND', label:'Stipend', period:'MONTHLY', fixedTerm:true,  ph:['9000','15000'] },
  'Live Project': { kind:'STIPEND', label:'Stipend', period:'MONTHLY', fixedTerm:true,  ph:['5000','15000'] },
  'Contract':     { kind:'FEES',    label:'Fees',    period:'MONTHLY', fixedTerm:true,  ph:['50000','120000'] },
  'Consultant':   { kind:'FEES',    label:'Fees',    period:'MONTHLY', fixedTerm:false, ph:['75000','200000'] },
};

export const compOf = (empType?: string): Compensation =>
  COMPENSATION[empType || 'Employee'] || COMPENSATION['Employee'];

/**
 * A requisition's budget ceiling as an ANNUAL rupee figure, whatever period it
 * was quoted in — the form of the number that can be compared with an offer's
 * annual CTC. Returns 0 when there is no ceiling to compare against, so callers
 * can treat "no budget recorded" as "nothing to flag" rather than as zero.
 */
export function annualCeiling(budgetMax?: number | null, empType?: string): number {
  const max = Number(budgetMax) || 0;
  if (max <= 0) return 0;
  return compOf(empType).period === 'ANNUAL' ? max : max * 12;
}

/**
 * Is this offer above the requisition's ceiling? False whenever there is no
 * ceiling recorded — an unknown budget is not an exceeded one.
 */
export function overCeiling(offeredAnnualCtc?: number | null, budgetMax?: number | null, empType?: string): boolean {
  const ceiling = annualCeiling(budgetMax, empType);
  const offered = Number(offeredAnnualCtc) || 0;
  return ceiling > 0 && offered > ceiling;
}
