// lib/onboarding/ctc-master.ts — a new joiner's payroll CTC (ctc_master), written when their
// employee code is generated.
//
// Payroll (lib/payroll/core.ts loadPayrollEmployees), the ESS Flexi Benefits calculator and the
// appraisal read an employee's CTC from ctc_master only. It used to be filled by the salary
// bulk upload alone, so a joiner who came through onboarding had none and ESS → Payroll →
// Flexi Benefits said "Not on record". The row now comes from the salary agreed for them:
//   - the recruitment negotiation's statement (lib/onboarding/salary-breakdown negotiatedSalary:
//     the HR Head's revision, else the negotiated calculation) — the offer the candidate
//     accepted, the same figures as the appointment letter's Annexure A;
//   - without a negotiation, the best breakdown for the CTC on the onboarding record.
// An existing row for the year is never overwritten.

import { loadSalaryBreakdown, negotiatedSalary } from './salary-breakdown'
import type { StmtRow } from '@/lib/recruitment/ctc-statement'
import { fyOf, ctcFigures } from './ctc-figures'

export { fyOf, ctcFigures }

/** The joiner's ctc_master row for the year they join — read only; null with the reason when
 *  there is nothing to write (a row exists, or no CTC is known). */
export async function ctcMasterRowFor(sb: any, onboardingId: string, employeeId: string): Promise<{ row: Record<string, any> | null; skipped?: string; error?: string }> {
  const { data: oc } = await sb.from('onboarding_candidates')
    .select('id, candidate_id, company_id, annual_ctc, offered_ctc, date_of_joining, pt_state, form_data, location_id')
    .eq('id', onboardingId).maybeSingle()
  if (!oc) return { row: null, error: 'onboarding record not found' }
  const { data: e0 } = await sb.from('employees').select('company_doj').eq('id', employeeId).maybeSingle()
  const fy = fyOf(oc.date_of_joining || e0?.company_doj)
  const { data: existing } = await sb.from('ctc_master').select('id').eq('employee_id', employeeId).eq('fy', fy).maybeSingle()
  if (existing) return { row: null, skipped: `a ${fy} CTC is already on record` }

  const approved = Number(oc.annual_ctc) || 0
  const neg = oc.candidate_id ? await negotiatedSalary(sb, oc.candidate_id).catch(() => null) : null
  // The offer the candidate accepted (with the HR Head's revision) is the contract; the
  // onboarding record's CTC only when there was no negotiation.
  let rows: StmtRow[] = [], ctc = 0
  if (neg && neg.ctc > 0) { rows = neg.rows; ctc = neg.ctc }
  else {
    const b = await loadSalaryBreakdown(sb, oc, approved || null).catch(() => null)
    if (b && b.annual_ctc > 0) { rows = b.rows; ctc = approved || b.annual_ctc }
  }
  const fig = ctcFigures(rows, ctc || approved || Number(oc.offered_ctc) || 0)
  if (!(fig.annual_ctc > 0)) return { row: null, skipped: 'no CTC on the onboarding record or the negotiation' }

  const { data: emp } = await sb.from('employees').select('epf_wage_limit, company_doj').eq('id', employeeId).maybeSingle()
  return { row: {
    employee_id: employeeId, company_id: oc.company_id, fy, effective_from: String(oc.date_of_joining || emp?.company_doj || '').slice(0, 10) || null,
    ...fig, epf_wage_limit: Number(emp?.epf_wage_limit) || 15000, status: 'ACTIVE',
  } }
}

/** Write the joiner's ctc_master row for the year they join, unless one exists. */
export async function writeCtcMaster(sb: any, onboardingId: string, employeeId: string): Promise<{ ok: boolean; skipped?: string; error?: string; row?: Record<string, any> }> {
  const r = await ctcMasterRowFor(sb, onboardingId, employeeId)
  if (!r.row) return r.error ? { ok: false, error: r.error } : { ok: true, skipped: r.skipped }
  const { error } = await sb.from('ctc_master').insert(r.row)
  if (error) return /duplicate|unique/i.test(error.message) ? { ok: true, skipped: 'already on record' } : { ok: false, error: error.message }
  return { ok: true, row: r.row }
}
