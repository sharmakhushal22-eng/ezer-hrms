// lib/onboarding/salary-breakdown.ts — the joiner's salary structure, for the Payroll head's
// approval form (ESS → Tasks & Approvals → Onboarding approvals). What they approve is the
// structure the joiner will be paid on, so it is shown line by line, from the best record we
// hold, in this order:
//   negotiation   the saved Automated CTC model of the recruitment negotiation
//                 (ctc_negotiations.calculation_data = computeCtc() result + its inputs) —
//                 the same statement the recruiter and the candidate's salary link saw
//   stipend       a fees / stipend negotiation (interns, consultants): monthly amount, TDS, net
//   offer_letter  the figures printed on the offer letter, when no negotiation was saved
//   computed      the CTC on the onboarding record, run through the CTC model with defaults
// The pure part (buildBreakdown) is shared with the approval form, which recomputes the
// statement live when the Payroll head corrects the annual CTC.

import { computeCtc, hraMaxFor } from '@/lib/recruitment/ctc-model'
import { ctcStatementRows, hasStatement, type StmtRow } from '@/lib/recruitment/ctc-statement'

export type SalarySource = 'negotiation' | 'stipend' | 'offer_letter' | 'computed' | 'none'
export interface SalaryBreakdown {
  source: SalarySource
  /** One line saying where the figures come from. */
  label: string
  annual_ctc: number
  basic_monthly: number | null
  /** Basic as % of annual CTC, rounded — what the Payroll checklist stores. */
  basic_pct: number | null
  /** The CTC model's result + inputs when the statement can be recomputed for another CTC. */
  calc?: Record<string, any> | null
  rows: StmtRow[]
  /** Set when the CTC model could not fit the structure (CTC below the statutory minimum). */
  too_low?: { minReqFixedAnn: number } | null
  note?: string | null
}

const r0 = (n: any) => Math.round(Number(n) || 0)
const pct = (basicMonthly: number | null, annual: number) => basicMonthly && annual ? Math.round((basicMonthly * 12 / annual) * 1000) / 10 : null

/** The statement from a saved CTC model, optionally re-run for a different annual CTC
 *  (the variable part is kept at the same percentage of the package). */
export function buildBreakdown(calc: Record<string, any>, annualOverride?: number | null, label?: string): SalaryBreakdown {
  const state = String(calc.state || '')
  const saved = Number(calc.ctcAnnual) || Number(calc.annual) || 0
  const target = annualOverride && annualOverride > 0 ? annualOverride : saved
  let merged: Record<string, any> = calc
  if (target !== saved || !hasStatement(calc)) {
    const varPct = saved > 0 ? (Number(calc.variable) || 0) / saved : 0
    const re = computeCtc({
      ctcAnnual: target, variableAnnual: target * varPct, minWage: Number(calc.minWage) || 0, state,
      gratuity: calc.gratuity === 'no' ? 'no' : 'yes', bonusPct: Number(calc.bonusPct) || 0, bonusMode: calc.bonusMode === 'ctc' ? 'ctc' : 'salary',
      epfCeiling: calc.epfCeiling || undefined, hraMax: calc.hraMax || hraMaxFor(calc.city || state),
    })
    if (!re.ok) return { source: 'negotiation', label: label || 'CTC model', annual_ctc: target, basic_monthly: null, basic_pct: null, calc, rows: [], too_low: { minReqFixedAnn: re.minReqFixedAnn }, note: `₹${r0(target).toLocaleString('en-IN')} a year is below the statutory minimum for this structure (₹${r0(re.minReqFixedAnn).toLocaleString('en-IN')} fixed).` }
    merged = { ...calc, ...re }
  }
  return {
    source: 'negotiation', label: label || 'Automated CTC model', annual_ctc: Number(merged.ctcAnnual) || target,
    basic_monthly: r0(merged.basic), basic_pct: pct(r0(merged.basic), Number(merged.ctcAnnual) || target), calc: merged,
    rows: ctcStatementRows(merged, { state }),
  }
}

/** A fees / stipend engagement: no statutory structure, just the monthly amount and TDS. */
export function stipendBreakdown(cd: Record<string, any>, annualOverride?: number | null): SalaryBreakdown {
  const monthly = annualOverride && annualOverride > 0 ? annualOverride / 12 : Number(cd.stipend_monthly) || (Number(cd.annual) || 0) / 12
  const tdsPct = cd.tds_applicable ? Number(cd.tds_pct) || 0 : 0
  const tds = monthly * tdsPct / 100
  const what = String(cd.pay_label || (cd.pay_kind === 'FEES' ? 'Fees' : 'Stipend'))
  const rows: StmtRow[] = [
    { kind: 'row', label: `Monthly ${what.toLowerCase()}`, basis: cd.employment_type ? String(cd.employment_type) : undefined, monthly, annual: monthly * 12 },
    { kind: 'ded', label: `(−) TDS`, basis: tdsPct ? `${tdsPct}%` : 'not applicable', monthly: tds, annual: tds * 12, remark: 'Deduction' },
    { kind: 'net', label: `Net monthly ${what.toLowerCase()}`, monthly: monthly - tds, annual: (monthly - tds) * 12 },
    { kind: 'total', label: `Annual ${what.toLowerCase()}`, monthly, annual: monthly * 12 },
    { kind: 'note', label: 'No PF, ESIC, gratuity or bonus — this is a fees / stipend engagement, not a salary structure.' },
  ]
  if (cd.additional_amount) rows.splice(1, 0, { kind: 'muted', label: `Additional (${cd.additional_freq || 'one-time'})`, monthly: null, annual: Number(cd.additional_amount) || 0 })
  return { source: 'stipend', label: `${what} negotiation`, annual_ctc: monthly * 12, basic_monthly: null, basic_pct: null, calc: null, rows }
}

/** The figures on an offer letter, as printed. */
export function offerLetterBreakdown(ol: Record<string, any>): SalaryBreakdown {
  const n = (k: string) => Number(ol[k]) || 0
  const rows: StmtRow[] = [
    { kind: 'row', label: 'Basic Salary', monthly: n('basic'), annual: n('basic') * 12 },
    { kind: 'row', label: 'House Rent Allowance (HRA)', monthly: n('hra'), annual: n('hra') * 12 },
    ...(n('statutory_bonus') ? [{ kind: 'bonus', label: 'Statutory Bonus', monthly: n('statutory_bonus'), annual: n('statutory_bonus') * 12 } as StmtRow] : []),
    { kind: 'row', label: 'Other Allowance', monthly: n('other_allowance'), annual: n('other_allowance') * 12 },
    { kind: 'sum', label: 'Gross Earnings (A)', monthly: n('gross_monthly'), annual: n('gross_monthly') * 12 },
    { kind: 'emp', label: 'Employer EPF', monthly: n('employer_pf'), annual: n('employer_pf') * 12 },
    { kind: 'emp', label: 'Employer ESIC', monthly: n('employer_esic'), annual: n('employer_esic') * 12 },
    { kind: 'sum', label: 'Fixed CTC Package', monthly: n('fixed_ctc_monthly'), annual: n('fixed_ctc_monthly') * 12 },
    { kind: 'muted', label: 'Variable / Performance CTC', monthly: n('variable_monthly'), annual: n('variable_monthly') * 12 },
    { kind: 'total', label: 'Total Annual CTC Package', monthly: n('final_ctc_monthly') || n('annual_ctc') / 12, annual: n('annual_ctc') || n('final_ctc_monthly') * 12 },
    { kind: 'head', label: 'Employee deductions & net in-hand' },
    { kind: 'ded', label: '(−) Employee PF', monthly: n('employee_pf'), annual: n('employee_pf') * 12, remark: 'Deduction' },
    { kind: 'ded', label: '(−) Employee ESIC', monthly: n('employee_esic'), annual: n('employee_esic') * 12, remark: 'Deduction' },
    { kind: 'ded', label: '(−) Professional Tax', monthly: n('professional_tax'), annual: n('professional_tax') * 12, remark: 'Deduction' },
    { kind: 'ded', label: '(−) Labour Welfare Fund', monthly: n('lwf'), annual: n('lwf') * 12, remark: 'Deduction' },
    { kind: 'net', label: 'Net In-Hand Salary', basis: 'before TDS', monthly: n('net_take_home'), annual: n('net_take_home') * 12 },
  ]
  const annual = n('annual_ctc') || n('final_ctc_monthly') * 12
  return { source: 'offer_letter', label: `Offer letter${ol.offer_number ? ` ${ol.offer_number}` : ''}${ol.generated_at ? ` · ${new Date(ol.generated_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}`, annual_ctc: annual, basic_monthly: n('basic') || null, basic_pct: pct(n('basic') || null, annual), calc: null, rows }
}

/** The structure for an annual CTC with no saved model — the CTC model with defaults for the state. */
export function computedBreakdown(annual: number, state: string, city?: string | null): SalaryBreakdown {
  const b = buildBreakdown({ ctcAnnual: 0, variable: 0, minWage: 0, state, city, gratuity: 'yes', bonusPct: 0, bonusMode: 'salary' }, annual, `Computed from the CTC on record (₹${r0(annual).toLocaleString('en-IN')}, ${state || 'state not set'})`)
  return { ...b, source: 'computed', note: b.note || 'No negotiation or offer letter figures were found; this is the CTC model with defaults (50% basic, no variable, no bonus). Correct the CTC above if the offer differs.' }
}

/** The best available breakdown for an onboarding record. `annualOverride` re-runs a model-based
 *  one for the CTC the Payroll head typed. */
export async function loadSalaryBreakdown(sb: any, oc: { id: string; candidate_id?: string | null; annual_ctc?: number | null; offered_ctc?: number | null; pt_state?: string | null; form_data?: any; location_id?: string | null }, annualOverride?: number | null): Promise<SalaryBreakdown> {
  const state = String(oc.pt_state || oc.form_data?.step_4?.curr_state || oc.form_data?.step_4?.perm_state || '')
  const city = String(oc.form_data?.step_4?.curr_city || oc.form_data?.step_4?.perm_city || '')
  if (oc.candidate_id) {
    const [{ data: neg }, { data: ol }] = await Promise.all([
      sb.from('ctc_negotiations').select('calculation_data, offered_ctc, variable_pct, is_stipend, created_at').eq('candidate_id', oc.candidate_id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      sb.from('offer_letters').select('offer_number, generated_at, basic, hra, other_allowance, statutory_bonus, employer_pf, employer_esic, gross_monthly, employee_pf, employee_esic, professional_tax, lwf, total_deduction, net_take_home, fixed_ctc_monthly, variable_monthly, final_ctc_monthly, annual_ctc').eq('candidate_id', oc.candidate_id).order('generated_at', { ascending: false }).limit(1).maybeSingle(),
    ])
    const cd = neg?.calculation_data || null
    if (cd && (neg?.is_stipend || cd.is_stipend)) return stipendBreakdown(cd, annualOverride)
    if (cd && hasStatement(cd)) {
      const when = neg?.created_at ? ` · ${new Date(neg.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''
      return buildBreakdown({ state, city, ...cd }, annualOverride, `Recruitment negotiation (Automated CTC model)${when}`)
    }
    if (ol && (Number(ol.annual_ctc) > 0 || Number(ol.final_ctc_monthly) > 0)) return offerLetterBreakdown(ol)
    if (cd && Number(cd.annual) > 0) return computedBreakdown(annualOverride || Number(cd.annual), state, city)
  }
  const annual = annualOverride || Number(oc.annual_ctc) || Number(oc.offered_ctc) || 0
  if (annual > 0) return computedBreakdown(annual, state, city)
  return { source: 'none', label: 'No CTC on record', annual_ctc: 0, basic_monthly: null, basic_pct: null, calc: null, rows: [], note: 'No negotiation, offer letter or CTC was found for this joiner. Enter the annual CTC above and the structure is computed.' }
}

/** Re-derive for a CTC the Payroll head typed, without another database round trip. */
export function rebuildFor(b: SalaryBreakdown, annual: number): SalaryBreakdown {
  if (!annual || annual <= 0 || annual === b.annual_ctc) return b
  if (b.calc) { const n = buildBreakdown(b.calc, annual, b.label); return { ...n, source: b.source === 'none' ? 'computed' : b.source } }
  if (b.source === 'stipend') return { ...b, annual_ctc: annual, rows: b.rows.map(r => r.monthly != null && r.annual != null && r.kind !== 'ded' ? r : r) }
  if (b.source === 'offer_letter') return { ...b, note: `The offer letter said ₹${r0(b.annual_ctc).toLocaleString('en-IN')}; the CTC entered is ₹${r0(annual).toLocaleString('en-IN')}. The structure below is the letter's; payroll will be set up on the CTC entered.` }
  return computedBreakdown(annual, '')
}
